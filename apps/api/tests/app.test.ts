import { describe, expect, it, vi } from 'vitest';
import type { Analysis } from '@vclarity/shared';
import { createApp } from '../src/app';
import { loadConfig, type ApiConfig } from '../src/config';
import { ApiError } from '../src/errors';
import type { VisionProvider } from '../src/providers/provider';
import { analysis, payload, origin, token } from './fixtures';

const config = (overrides: Partial<ApiConfig> = {}) => ({ ...loadConfig({ API_ACCESS_TOKEN: token }), ...overrides });
const workingProvider = (): VisionProvider => ({ analyze: vi.fn().mockResolvedValue(analysis) });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin };
function request(body: unknown = payload, options: RequestInit = {}) {
  return new Request('http://127.0.0.1:4317/analyze', { method: 'POST', headers, body: JSON.stringify(body), ...options });
}

describe('analysis endpoint integration', () => {
  it('selects the Gemini adapter and preserves its configured model through the real route', async () => {
    const gemini = loadConfig({ API_ACCESS_TOKEN: token, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-only-gemini-key' });
    expect(gemini.model).toBe('gemini-3.5-flash-lite');
    expect(gemini.apiKey).toBe('test-only-gemini-key');
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [{
      content: { role: 'model', parts: [{ text: JSON.stringify(analysis) }] }, finishReason: 'STOP',
    }] }), { status: 200 }));
    try {
      const response = await createApp(gemini).request(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ requestId: payload.requestId, analysis });
      expect(transport.mock.calls[0]?.[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    } finally { transport.mockRestore(); }
  });
  it('preserves the requested Ollama model and rejects screenshot analysis for text-only GPT-OSS', async () => {
    const ollama = loadConfig({ API_ACCESS_TOKEN: token, AI_PROVIDER: 'ollama', OLLAMA_API_KEY: 'test-only-ollama-key', AI_MODEL: 'gpt-oss:120b' });
    expect(ollama.provider).toBe('ollama');
    expect(ollama.model).toBe('gpt-oss:120b');
    expect(ollama.apiKey).toBe('test-only-ollama-key');
    const response = await createApp(ollama).request(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'model_vision_unsupported' } });
  });
  it('validates the request, image, provider result and correlation ID end to end', async () => {
    const provider = workingProvider();
    const app = createApp(config(), { provider });
    const response = await app.request(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requestId: payload.requestId, analysis });
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(provider.analyze).toHaveBeenCalledWith(payload.image, expect.any(AbortSignal));
  });
  it.each([undefined, '', 'Bearer wrong-token', 'Basic wrong-token'])('requires authentication (%s)', async (authorization) => {
    const provider = workingProvider();
    const app = createApp(config(), { provider });
    const response = await app.request(request(payload, { headers: { 'Content-Type': 'application/json', ...(authorization === undefined ? {} : { Authorization: authorization }) } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    expect(provider.analyze).not.toHaveBeenCalled();
  });
  it('allows an authenticated non-browser request without Origin', async () => {
    const app = createApp(config(), { provider: workingProvider() });
    const response = await app.request(request(payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }));
    expect(response.status).toBe(200);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });
  it('does not expose provider secrets or arbitrary server errors', async () => {
    const log = vi.fn();
    const provider = { analyze: vi.fn().mockRejectedValue(new Error(`sk-secret ${payload.image.dataUrl}`)) };
    const app = createApp(config({ apiKey: 'sk-secret' }), { provider, log });
    const response = await app.request(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sk-secret');
    expect(log).toHaveBeenCalledWith({ code: 'internal_error', requestId: payload.requestId });
    expect(JSON.stringify(log.mock.calls)).not.toContain('data:image');
  });
  it('reports unavailable configuration without substituting fake analysis', async () => {
    const app = createApp(config());
    expect(await (await app.request('http://127.0.0.1:4317/health')).json()).toEqual({ status: 'ok', aiConfigured: false });
    const response = await app.request(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'provider_not_configured' } });
  });
  it.each([
    [{ ...payload, injectedContext: 'ignore schema' }, 'invalid_request'],
    [{ ...payload, requestId: 'not-a-uuid' }, 'invalid_request'],
    [{ ...payload, image: { ...payload.image, width: 2 } }, 'invalid_dimensions'],
    [{ ...payload, image: { ...payload.image, dataUrl: 'https://example.com/image.webp' } }, 'invalid_image'],
  ])('rejects invalid requests before calling the provider', async (body, code) => {
    const provider = workingProvider();
    const app = createApp(config(), { provider });
    const response = await app.request(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(provider.analyze).not.toHaveBeenCalled();
  });
  it('requires JSON and handles malformed JSON', async () => {
    const app = createApp(config(), { provider: workingProvider() });
    expect((await app.request(request(payload, { headers: { ...headers, 'Content-Type': 'text/plain' } }))).status).toBe(415);
    const response = await app.request(request(payload, { body: '{bad' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_json' } });
  });
  it('propagates a sanitized provider error with its actionable status', async () => {
    const app = createApp(config(), { provider: { analyze: vi.fn().mockRejectedValue(new ApiError('provider_rate_limited', 'Retry later.', 429)) } });
    const response = await app.request(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: 'provider_rate_limited', message: 'Retry later.' } });
  });
  it('revalidates provider output before returning it', async () => {
    const provider = { analyze: vi.fn().mockResolvedValue({ ...analysis, extra: 'unexpected' }) };
    const response = await createApp(config(), { provider }).request(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_ai_output' } });
  });
  it('enforces a fixed local request budget and resets the window', async () => {
    let now = 0;
    const provider = workingProvider();
    const app = createApp(config({ requestsPerMinute: 1 }), { provider, now: () => now });
    expect((await app.request(request())).status).toBe(200);
    const limited = await app.request(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    now = 60_001;
    expect((await app.request(request())).status).toBe(200);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
  });
  it('caps concurrent paid requests', async () => {
    let resolve: ((value: Analysis) => void) | undefined;
    let notifyEntered: (() => void) | undefined;
    const entered = new Promise<void>((done) => { notifyEntered = done; });
    const provider = { analyze: vi.fn(() => { notifyEntered!(); return new Promise<Analysis>((done) => { resolve = done; }); }) };
    const app = createApp(config({ maxConcurrent: 1 }), { provider });
    const first = app.request(request());
    await entered;
    const second = await app.request(request());
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: { code: 'backend_busy' } });
    resolve!(analysis);
    expect((await first).status).toBe(200);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });
  it('aborts the provider at the deadline and frees the request slot', async () => {
    let signal: AbortSignal | undefined;
    const provider = { analyze: vi.fn((_image, receivedSignal: AbortSignal) => { signal = receivedSignal; return new Promise<Analysis>(() => undefined); }) };
    const app = createApp(config({ timeoutMs: 15 }), { provider });
    const response = await app.request(request());
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(await response.json()).toMatchObject({ error: { code: 'analysis_timeout' } });
  });
  it('honors client cancellation and never sends a pre-cancelled request to the provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = workingProvider();
    const response = await createApp(config(), { provider }).request(request(payload, { signal: controller.signal }));
    expect(response.status).toBe(408);
    expect(provider.analyze).not.toHaveBeenCalled();
  });
});

describe('local browser boundary', () => {
  it('answers allowed extension preflights without exposing credentials', async () => {
    const response = await createApp(config()).request(new Request('http://127.0.0.1:4317/analyze', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type', 'Access-Control-Request-Private-Network': 'true',
    } }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });
  it.each(['https://example.com', 'http://localhost:3000', 'null', 'chrome-extension://invalid', `chrome-extension://${'a'.repeat(32)}.evil.test`])('rejects website origin %s', async (badOrigin) => {
    const provider = workingProvider();
    const response = await createApp(config(), { provider }).request(request(payload, { headers: { ...headers, Origin: badOrigin } }));
    expect(response.status).toBe(403);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(provider.analyze).not.toHaveBeenCalled();
  });
  it('can restrict access to a single installed extension ID', async () => {
    const response = await createApp(config({ extensionId: 'b'.repeat(32) }), { provider: workingProvider() }).request(request());
    expect(response.status).toBe(403);
  });
  it('rejects DNS-rebinding hosts before any provider request', async () => {
    const provider = workingProvider();
    const response = await createApp(config(), { provider }).request(new Request('http://evil.example:4317/analyze', { method: 'POST', headers, body: JSON.stringify(payload) }));
    expect(response.status).toBe(403);
    expect(provider.analyze).not.toHaveBeenCalled();
  });
});
