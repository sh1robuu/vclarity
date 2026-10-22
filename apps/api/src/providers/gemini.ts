import { analysisSchema, type Analysis, type OptimizedImage } from '@vclarity/shared';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ApiError } from '../errors';
import { ANALYSIS_INSTRUCTIONS } from '../prompts/analysis';
import type { VisionProvider } from './provider';

const API_ORIGIN = 'https://generativelanguage.googleapis.com';
const MAX_RESPONSE_BYTES = 1_000_000;
const outputSchema = compatibleSchema(zodToJsonSchema(analysisSchema, { $refStrategy: 'none' }));
const envelopeSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({
      role: z.string().optional(),
      parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })),
    }).optional(),
  })).optional(),
});
const refusalReasons = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'ESCALATION', 'PUP_LIMITED_DISABLED']);

// The provider ignores string length keywords; enforce those limits with Zod
// after parsing. Keep supported array limits, required fields and nullable types.
function compatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compatibleSchema);
  if (value === null || typeof value !== 'object') return value;
  const omitted = new Set(['$schema', 'minLength', 'maxLength']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)).map(([key, child]) => [key, compatibleSchema(child)]));
}

export interface GeminiOptions { apiKey: string; model: string; fetch?: typeof fetch }

/** The credential stays in a server-side header on Google's fixed API origin. */
export class GeminiVisionProvider implements VisionProvider {
  private readonly send: typeof fetch;

  constructor(private readonly options: GeminiOptions) { this.send = options.fetch ?? fetch; }

  async analyze(image: OptimizedImage, signal: AbortSignal): Promise<Analysis> {
    signal.throwIfAborted();
    const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
    let response: Response;
    try {
      response = await this.send(`${API_ORIGIN}/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`, {
        method: 'POST', signal, redirect: 'error',
        headers: { 'x-goog-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ANALYSIS_INSTRUCTIONS }] },
          contents: [{ role: 'user', parts: [
            { text: 'Analyze only the interface evidence in this user-selected screenshot region. Return the required UX and product analysis as JSON.' },
            { inlineData: { mimeType: image.mimeType, data: base64 } },
          ] }],
          generationConfig: {
            candidateCount: 1, maxOutputTokens: 6000,
            responseMimeType: 'application/json', responseJsonSchema: outputSchema,
          },
        }),
      });
    } catch {
      signal.throwIfAborted();
      throw new ApiError('provider_unavailable', 'Gemini could not be reached. Check the backend network connection and retry.', 502);
    }
    if (signal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
    }
    if (!response.ok) {
      // Never expose an upstream error body: it may contain credentials or input.
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new ApiError('provider_authentication', 'Gemini rejected the backend credentials. Check GEMINI_API_KEY and model access on the server.', 503);
      }
      if (response.status === 429) {
        throw new ApiError('provider_rate_limited', 'Gemini is rate limited or out of quota. Check the provider account and retry later.', 429);
      }
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        throw new ApiError('provider_configuration', 'Gemini rejected the request. Check the selected model supports images and structured output in your account.', 502);
      }
      throw new ApiError('provider_unavailable', 'Gemini is temporarily unavailable. Retry later.', 502);
    }
    let raw: unknown;
    try {
      raw = await readBoundedJson(response, signal);
    } catch {
      signal.throwIfAborted();
      throw invalidOutput('Gemini returned unreadable output. Retry the analysis.');
    }
    signal.throwIfAborted();
    return normalizeGeminiResponse(raw);
  }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))) as unknown;
}

export function normalizeGeminiResponse(raw: unknown): Analysis {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw invalidOutput('Gemini returned an invalid response. Retry the analysis.');
  const blocked = parsed.data.promptFeedback?.blockReason;
  if (blocked && blocked !== 'BLOCK_REASON_UNSPECIFIED') throw refused();
  // Only one candidate was requested. Never splice different candidate answers.
  if (parsed.data.candidates?.length !== 1) throw invalidOutput('Gemini returned no unique answer. Retry the analysis.');
  const candidate = parsed.data.candidates[0]!;
  if (candidate.finishReason && refusalReasons.has(candidate.finishReason)) throw refused();
  if (candidate.finishReason !== 'STOP') {
    throw new ApiError('incomplete_ai_output', 'The AI analysis did not complete. Retry with a smaller, clearer region.', 502);
  }
  if (candidate.content?.role && candidate.content.role !== 'model') throw invalidOutput('Gemini returned an invalid response. Retry the analysis.');
  // Thinking, tool calls, executable code and every other non-text part are
  // ignored. Only final text is parsed; nothing from the provider is executed.
  const text = (candidate.content?.parts ?? []).filter((part) => part.thought !== true).map((part) => part.text ?? '').join('');
  try {
    const result = analysisSchema.safeParse(JSON.parse(text) as unknown);
    if (result.success) return result.data;
  } catch { /* Invalid JSON and schema violations share a sanitized error. */ }
  throw invalidOutput('The AI response did not match the analysis format. Retry the analysis.');
}

function invalidOutput(message: string): ApiError { return new ApiError('invalid_ai_output', message, 502); }
function refused(): ApiError { return new ApiError('analysis_refused', 'Gemini could not analyze this image. Select a different interface region.', 422); }
