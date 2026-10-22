import { describe, expect, it } from 'vitest';
import { readJsonBounded, validateImage, MAX_JSON_BYTES } from '../src/validation/image';
import { loadConfig } from '../src/config';
import { image, jpegImage, token } from './fixtures';

describe('image validation', () => {
  it('accepts a WebP whose header matches the metadata', () => {
    expect(() => validateImage(image)).not.toThrow();
  });
  it('accepts the JPEG fallback codec and rejects a truncated JPEG body', () => {
    expect(() => validateImage(jpegImage)).not.toThrow();
    const bytes = Buffer.from(jpegImage.dataUrl.split(',')[1]!, 'base64').subarray(0, -2);
    expect(() => validateImage({ ...jpegImage, bytes: bytes.length, dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` })).toThrow(/incomplete/);
  });
  it.each([
    { dataUrl: 'https://example.com/image.webp' },
    { dataUrl: 'data:image/webp;base64,____' },
    { dataUrl: image.dataUrl + '=' },
    { bytes: image.bytes + 1 },
    { width: 2 },
    { originalWidth: 0 },
    { mimeType: 'image/jpeg' as const },
  ])('rejects malformed or mismatched image metadata %j', (change) => {
    expect(() => validateImage({ ...image, ...change })).toThrow();
  });
  it('rejects a declared JPEG with WebP bytes', () => {
    expect(() => validateImage({ ...image, mimeType: 'image/jpeg', dataUrl: image.dataUrl.replace('image/webp', 'image/jpeg') })).toThrow(/does not match/);
  });
  it('rejects a truncated WebP body even when the header parses', () => {
    const bytes = Buffer.from(image.dataUrl.split(',')[1]!, 'base64').subarray(0, -2);
    expect(() => validateImage({ ...image, bytes: bytes.length, dataUrl: `data:image/webp;base64,${bytes.toString('base64')}` })).toThrow(/incomplete/);
  });
});

describe('bounded JSON reader', () => {
  it('accepts valid JSON and rejects malformed JSON', async () => {
    await expect(readJsonBounded(new Request('http://127.0.0.1/', { method: 'POST', body: '{"ok":true}' }))).resolves.toEqual({ ok: true });
    await expect(readJsonBounded(new Request('http://127.0.0.1/', { method: 'POST', body: '{bad' }))).rejects.toMatchObject({ code: 'invalid_json' });
  });
  it('rejects oversized Content-Length before reading', async () => {
    const request = new Request('http://127.0.0.1/', { method: 'POST', headers: { 'Content-Length': String(MAX_JSON_BYTES + 1) }, body: '{}' });
    await expect(readJsonBounded(request)).rejects.toMatchObject({ code: 'payload_too_large' });
  });
  it('limits chunked data without trusting Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_JSON_BYTES)); controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('http://127.0.0.1/', { method: 'POST', body, duplex: 'half' } as RequestInit);
    await expect(readJsonBounded(request)).rejects.toMatchObject({ code: 'payload_too_large' });
    expect(cancelled).toBe(true);
  });
  it('cancels a stalled upload when its deadline is aborted', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const request = new Request('http://127.0.0.1/', { method: 'POST', body, duplex: 'half' } as RequestInit);
    const controller = new AbortController();
    const pending = readJsonBounded(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(cancelled).toBe(true);
  });
});

describe('environment configuration', () => {
  it('requires a strong local token while allowing the provider to remain unconfigured', () => {
    expect(loadConfig({ API_ACCESS_TOKEN: token })).toMatchObject({ port: 4317, apiKey: '', provider: 'openai', requestsPerMinute: 10 });
    expect(() => loadConfig({ API_ACCESS_TOKEN: 'short' })).toThrow(/API_ACCESS_TOKEN/);
  });
  it('rejects an unsupported provider and out-of-range limits without disclosing values', () => {
    expect(() => loadConfig({ API_ACCESS_TOKEN: token, AI_PROVIDER: 'private-secret-value' })).toThrow(/AI_PROVIDER/);
    expect(() => loadConfig({ API_ACCESS_TOKEN: token, AI_PROVIDER: 'private-secret-value' })).not.toThrow(/private-secret-value/);
    expect(() => loadConfig({ API_ACCESS_TOKEN: token, API_MAX_CONCURRENT: '10000' })).toThrow(/API_MAX_CONCURRENT/);
  });
});
