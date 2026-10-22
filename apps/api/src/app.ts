import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { analysisRequestSchema, analysisResponseSchema } from '@vclarity/shared';
import type { ApiConfig } from './config';
import { ApiError, publicError } from './errors';
import { OpenAIVisionProvider } from './providers/openai';
import { OllamaVisionProvider } from './providers/ollama';
import { GeminiVisionProvider } from './providers/gemini';
import type { VisionProvider } from './providers/provider';
import { readJsonBounded, validateImage } from './validation/image';

export interface AppDependencies {
  provider?: VisionProvider;
  now?: () => number;
  /** Only allowlisted status codes and request IDs are logged, never image/error bodies. */
  log?: (entry: { code: string; requestId?: string }) => void;
}

export function createApp(config: ApiConfig, dependencies: AppDependencies = {}) {
  const app = new Hono();
  const options = { apiKey: config.apiKey, model: config.model };
  const Provider = { openai: OpenAIVisionProvider, ollama: OllamaVisionProvider, gemini: GeminiVisionProvider }[config.provider];
  const provider = dependencies.provider ?? (config.apiKey ? new Provider(options) : undefined);
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? (() => undefined);
  const tokenDigest = digest(config.accessToken);
  let windowStart = now();
  let requests = 0;
  let active = 0;

  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('Referrer-Policy', 'no-referrer');
    context.header('Vary', 'Origin');
    // Reject DNS-rebinding requests even though the listener only binds loopback.
    const hostname = new URL(context.req.url).hostname;
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
      return context.json({ error: { code: 'invalid_host', message: 'Use the local loopback backend address.' } }, 403);
    }
    const origin = context.req.header('Origin');
    if (origin) {
      const allowed = /^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
        (!config.extensionId || origin === `chrome-extension://${config.extensionId}`);
      if (!allowed) return context.json({ error: { code: 'forbidden_origin', message: 'This origin cannot access the local analysis backend.' } }, 403);
      context.header('Access-Control-Allow-Origin', origin);
    }
    if (context.req.method === 'OPTIONS') {
      if (!origin) return context.json({ error: { code: 'forbidden_origin', message: 'An allowed extension origin is required.' } }, 403);
      context.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      context.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      context.header('Access-Control-Max-Age', '600');
      if (context.req.header('Access-Control-Request-Private-Network') === 'true') context.header('Access-Control-Allow-Private-Network', 'true');
      return context.body(null, 204);
    }
    await next();
  });

  app.get('/health', (context) => context.json({ status: 'ok', aiConfigured: !!provider }));

  app.post('/analyze', async (context) => {
    let requestId: string | undefined;
    try {
      const authorization = context.req.header('Authorization') ?? '';
      const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (supplied.length > 512 || !timingSafeEqual(digest(supplied), tokenDigest)) {
        throw new ApiError('unauthorized', 'The backend access token is missing or invalid. Check extension settings.', 401);
      }
      if (now() - windowStart >= 60_000) { windowStart = now(); requests = 0; }
      requests += 1;
      if (requests > config.requestsPerMinute) {
        context.header('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60_000 - now()) / 1000))));
        throw new ApiError('rate_limited', 'Too many analyses. Wait a minute and try again.', 429);
      }
      if (!provider) throw new ApiError('provider_not_configured', 'AI is not configured. Set AI_API_KEY on the backend; local inspection remains available.', 503);
      if (active >= config.maxConcurrent) {
        context.header('Retry-After', '5');
        throw new ApiError('backend_busy', 'The backend is processing other analyses. Retry in a few seconds.', 429);
      }
      const mediaType = context.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') throw new ApiError('unsupported_media_type', 'Send an application/json analysis request.', 415);
      // Reserve a slot before awaiting the body, so simultaneous uploads are bounded too.
      active += 1;
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      context.req.raw.signal.addEventListener('abort', cancel, { once: true });
      if (context.req.raw.signal.aborted) controller.abort();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
      try {
        // Include reading/validation in the deadline and race non-cooperative providers.
        const result = await abortable(async () => {
          controller.signal.throwIfAborted();
          const parsed = analysisRequestSchema.safeParse(await readJsonBounded(context.req.raw, controller.signal));
          if (!parsed.success) throw new ApiError('invalid_request', 'The analysis request format is invalid. Capture the region again.', 400);
          requestId = parsed.data.requestId;
          validateImage(parsed.data.image);
          controller.signal.throwIfAborted();
          const analysis = await provider.analyze(parsed.data.image, controller.signal);
          const response = analysisResponseSchema.safeParse({ requestId, analysis });
          if (!response.success) throw new ApiError('invalid_ai_output', 'The AI response did not match the analysis format. Retry the analysis.', 502);
          return response.data;
        }, controller.signal);
        return context.json(result);
      } catch (error) {
        if (controller.signal.aborted) {
          if (timedOut) throw new ApiError('analysis_timeout', 'The analysis timed out. Retry with a smaller region.', 504);
          throw new ApiError('analysis_cancelled', 'The analysis request was cancelled.', 408);
        }
        throw error;
      } finally {
        clearTimeout(timer);
        context.req.raw.signal.removeEventListener('abort', cancel);
        active -= 1;
      }
    } catch (error) {
      const safe = publicError(error);
      log({ code: safe.code, ...(requestId ? { requestId } : {}) });
      return context.json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
  });

  app.notFound((context) => context.json({ error: { code: 'not_found', message: 'This backend route does not exist.' } }, 404));
  app.onError((_error, context) => context.json({ error: { code: 'internal_error', message: 'The backend request failed. Try again.' } }, 500));
  return app;
}

function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }

async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('Aborted');
  let rejectAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('Aborted'));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { return await Promise.race([operation(), cancellation]); }
  finally { if (rejectAbort) signal.removeEventListener('abort', rejectAbort); }
}
