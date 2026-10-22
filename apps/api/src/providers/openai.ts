import { analysisSchema, type Analysis, type OptimizedImage } from '@vclarity/shared';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ApiError } from '../errors';
import { ANALYSIS_INSTRUCTIONS } from '../prompts/analysis';
import type { VisionProvider } from './provider';

// Keep the shared shape, required fields and enums. Provider models implement a
// JSON Schema subset (fine-tuned models also reject array/string size keywords).
// Enforce every original length/count limit with the shared Zod schema on return.
const outputSchema = compatibleSchema(zodToJsonSchema(analysisSchema, { $refStrategy: 'none' }));
function compatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compatibleSchema);
  if (value === null || typeof value !== 'object') return value;
  const omitted = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)).map(([key, child]) => [key, compatibleSchema(child)]));
}
const envelopeSchema = z.object({
  status: z.string(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

export interface OpenAIOptions { apiKey: string; model: string; fetch?: typeof fetch }

export class OpenAIVisionProvider implements VisionProvider {
  private readonly send: typeof fetch;
  constructor(private readonly options: OpenAIOptions) { this.send = options.fetch ?? fetch; }

  async analyze(image: OptimizedImage, signal: AbortSignal): Promise<Analysis> {
    let response: Response;
    try {
      response = await this.send('https://api.openai.com/v1/responses', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model, store: false, instructions: ANALYSIS_INSTRUCTIONS,
          input: [{ role: 'user', content: [
            { type: 'input_text', text: 'Analyze only the interface evidence in this user-selected region. Return the required UX and product analysis.' },
            { type: 'input_image', image_url: image.dataUrl, detail: 'high' },
          ] }],
          text: { format: { type: 'json_schema', name: 'vclarity_analysis', strict: true, schema: outputSchema } },
          max_output_tokens: 6000,
        }),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError('provider_unavailable', 'The AI provider could not be reached. Check the backend network connection and retry.', 502);
    }
    if (!response.ok) {
      // Do not expose a provider body: it can contain prompts, credentials or input data.
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) throw new ApiError('provider_rate_limited', 'The AI provider is rate limited or out of quota. Check the provider account and retry later.', 429);
      if (response.status === 401 || response.status === 403) throw new ApiError('provider_authentication', 'The AI provider rejected the backend credentials. Check AI_API_KEY and model access on the server.', 503);
      if (response.status === 400 || response.status === 404) throw new ApiError('provider_configuration', 'The AI provider rejected the request. Check AI_MODEL supports vision and structured output in your account.', 502);
      throw new ApiError('provider_unavailable', 'The AI provider is temporarily unavailable. Retry later.', 502);
    }
    let raw: unknown;
    try {
      raw = await readProviderJson(response);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError('invalid_ai_output', 'The AI provider returned unreadable output. Retry the analysis.', 502);
    }
    return normalizeOpenAIResponse(raw);
  }
}

async function readProviderJson(response: Response): Promise<unknown> {
  // Bound unexpected upstream output even when no Content-Length is supplied.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))) as unknown;
}

export function normalizeOpenAIResponse(raw: unknown): Analysis {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError('invalid_ai_output', 'The AI provider returned an invalid response. Retry the analysis.', 502);
  if (parsed.data.status !== 'completed') throw new ApiError('incomplete_ai_output', 'The AI analysis did not complete. Retry with a smaller, clearer region.', 502);
  const content = parsed.data.output.filter((item) => item.type === 'message').flatMap((item) => item.content ?? []);
  if (content.some((item) => item.type === 'refusal')) throw new ApiError('analysis_refused', 'The AI provider could not analyze this image. Select a different interface region.', 422);
  const text = content.filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('');
  try {
    const result = analysisSchema.safeParse(JSON.parse(text) as unknown);
    if (result.success) return result.data;
  } catch { /* Use one sanitized error for invalid JSON and schema violations. */ }
  throw new ApiError('invalid_ai_output', 'The AI response did not match the analysis format. Retry the analysis.', 502);
}
