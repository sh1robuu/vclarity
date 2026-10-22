import { analysisSchema, type Analysis, type OptimizedImage } from '@vclarity/shared';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ApiError } from '../errors';
import { ANALYSIS_INSTRUCTIONS } from '../prompts/analysis';
import type { VisionProvider } from './provider';

const CLOUD_ORIGIN = 'https://ollama.com';
const MAX_RESPONSE_BYTES = 1_000_000;
const chatEnvelopeSchema = z.object({
  done: z.boolean(),
  done_reason: z.string().optional(),
  message: z.object({ role: z.literal('assistant'), content: z.string() }),
});
const capabilityEnvelopeSchema = z.object({ models: z.array(z.object({ name: z.string(), capabilities: z.array(z.string()) })) });
const outputSchema = JSON.stringify(zodToJsonSchema(analysisSchema, { $refStrategy: 'none' }));

export interface OllamaCloudOptions { apiKey: string; model: string; fetch?: typeof fetch }
export interface OllamaMessage { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }

/** Native Cloud transport. Keep the credential and model traffic on Ollama's fixed origin. */
export class OllamaCloudClient {
  private readonly send: typeof fetch;
  private knownCapabilities?: string[];

  constructor(private readonly options: OllamaCloudOptions) { this.send = options.fetch ?? fetch; }

  get model(): string { return this.options.model; }

  async chat(messages: OllamaMessage[], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (isGptOss(this.model) && messages.some((message) => message.images?.length)) throw unsupportedVision();
    const raw = await this.request('/api/chat', { model: this.model, messages, stream: false }, signal);
    return normalizeOllamaChatResponse(raw);
  }

  async capabilities(signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted();
    if (this.knownCapabilities) return [...this.knownCapabilities];
    const raw = await this.request('/api/tags', undefined, signal);
    const parsed = capabilityEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw invalidOutput('The AI provider returned invalid model capabilities. Check the selected model.');
    const model = parsed.data.models.find((candidate) => candidate.name === this.model);
    if (!model) throw new ApiError('provider_configuration', 'The selected model is not available in the Ollama Cloud model catalog. Check the exact model name.', 502);
    this.knownCapabilities = model.capabilities;
    return [...this.knownCapabilities];
  }

  private async request(path: '/api/chat' | '/api/tags', body: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.send(`${CLOUD_ORIGIN}${path}`, {
        method: path === '/api/tags' ? 'GET' : 'POST', signal, redirect: 'error',
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError('provider_unavailable', 'Ollama Cloud could not be reached. Check the backend network connection and retry.', 502);
    }
    if (!response.ok) {
      // Provider bodies can contain prompts, credentials or image data.
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new ApiError('provider_authentication', 'Ollama Cloud rejected the backend credentials. Check OLLAMA_API_KEY and model access on the server.', 503);
      }
      if (response.status === 429) {
        throw new ApiError('provider_rate_limited', 'Ollama Cloud is rate limited or out of quota. Check the provider account and retry later.', 429);
      }
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        throw new ApiError('provider_configuration', 'Ollama Cloud rejected the request. Check the selected cloud model and its supported capabilities.', 502);
      }
      throw new ApiError('provider_unavailable', 'Ollama Cloud is temporarily unavailable. Retry later.', 502);
    }
    try {
      const raw = await readBoundedJson(response);
      signal.throwIfAborted();
      return raw;
    } catch (error) {
      if (signal.aborted) throw error;
      throw invalidOutput('Ollama Cloud returned unreadable output. Retry the analysis.');
    }
  }
}

export class OllamaVisionProvider implements VisionProvider {
  private readonly client: OllamaCloudClient;

  constructor(options: OllamaCloudOptions) { this.client = new OllamaCloudClient(options); }

  async analyze(image: OptimizedImage, signal: AbortSignal): Promise<Analysis> {
    signal.throwIfAborted();
    // GPT-OSS is text-only. Refuse locally before any screenshot leaves the server.
    if (isGptOss(this.client.model)) throw unsupportedVision();
    const capabilities = await this.client.capabilities(signal);
    if (!capabilities.includes('vision')) throw unsupportedVision();
    const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
    const text = await this.client.chat([
      { role: 'system', content: `${ANALYSIS_INSTRUCTIONS}\n\nReturn one JSON object matching this JSON Schema exactly:\n${outputSchema}` },
      { role: 'user', content: 'Analyze only the interface evidence in this user-selected screenshot region. Return the required UX and product analysis as JSON.', images: [base64] },
    ], signal);
    return normalizeOllamaAnalysis(text);
  }
}

export function normalizeOllamaChatResponse(raw: unknown): string {
  const parsed = chatEnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw invalidOutput('Ollama Cloud returned an invalid response. Retry the analysis.');
  if (!parsed.data.done || (parsed.data.done_reason && parsed.data.done_reason !== 'stop')) {
    throw new ApiError('incomplete_ai_output', 'The AI response did not complete. Retry with a smaller input.', 502);
  }
  if (!parsed.data.message.content.trim()) throw invalidOutput('Ollama Cloud returned no answer. Retry the analysis.');
  // Deliberately consume only message.content; never expose or log model thinking.
  return parsed.data.message.content;
}

export function normalizeOllamaAnalysis(text: string): Analysis {
  try {
    const parsed = analysisSchema.safeParse(JSON.parse(text) as unknown);
    if (parsed.success) return parsed.data;
  } catch { /* Invalid JSON and schema violations share a sanitized error. */ }
  throw invalidOutput('The AI response did not match the analysis format. Retry the analysis.');
}

function unsupportedVision(): ApiError {
  return new ApiError('model_vision_unsupported', 'The selected Ollama Cloud model cannot analyze screenshots. gpt-oss:120b is text-only. Select a cloud model with verified vision support to use AI screenshot analysis.', 422);
}

function isGptOss(model: string): boolean { return /^gpt-oss(?::|$)/i.test(model); }

function invalidOutput(message: string): ApiError { return new ApiError('invalid_ai_output', message, 502); }

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))) as unknown;
}
