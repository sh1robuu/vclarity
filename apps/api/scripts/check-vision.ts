import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { analysisResponseSchema } from '@vclarity/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { GeminiVisionProvider } from '../src/providers/gemini';

// Explicit CLI smoke check: submits only the image file named by the caller.
// It exercises authentication, image validation, the real provider and output schema.
try {
  const path = process.argv[2];
  if (!path) throw new Error('Pass a JPEG or WebP test image: pnpm --filter @vclarity/api check:vision <path>');
  const config = loadConfig();
  const bytes = await readFile(path);
  const dimensions = imageSize(bytes);
  const mimeType = dimensions.type === 'jpg' ? 'image/jpeg' : dimensions.type === 'webp' ? 'image/webp' : null;
  if (!mimeType || !dimensions.width || !dimensions.height) throw new Error('Choose a valid JPEG or WebP test image.');
  const requestId = randomUUID();
  const image = { dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType,
    width: dimensions.width, height: dimensions.height, originalWidth: dimensions.width, originalHeight: dimensions.height,
    bytes: bytes.length, targetMet: bytes.length < 100_000, warning: bytes.length < 100_000 ? null : 'Explicit CLI test image exceeds the optimization target.' };
  const transport: typeof fetch = async (input, init) => {
    try {
      const upstream = await fetch(input, init);
      if (!upstream.ok) {
        let providerStatus: string | undefined;
        try {
          const value: unknown = await upstream.clone().json();
          if (value && typeof value === 'object' && 'error' in value && value.error && typeof value.error === 'object' && 'status' in value.error && typeof value.error.status === 'string' && /^[A-Z_]{1,80}$/.test(value.error.status)) providerStatus = value.error.status;
        } catch { /* Never print an upstream body or arbitrary message. */ }
        console.log(JSON.stringify({ upstreamStatus: upstream.status, ...(providerStatus ? { providerStatus } : {}) }));
      }
      return upstream;
    } catch (error) {
      const cause: unknown = error instanceof Error ? error.cause : undefined;
      const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' && /^[A-Z_]{1,80}$/.test(cause.code) ? cause.code : 'NETWORK_OR_ABORT';
      console.log(JSON.stringify({ transportFailure: code }));
      throw error;
    }
  };
  const provider = config.provider === 'gemini' ? new GeminiVisionProvider({ apiKey: config.apiKey, model: config.model, fetch: transport }) : undefined;
  const response = await createApp(config, provider ? { provider } : {}).request(new Request('http://127.0.0.1:4317/analyze', {
    method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, image }),
  }));
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error && typeof body.error.code === 'string' ? body.error.code : 'unknown_error';
    console.log(JSON.stringify({ ok: false, provider: config.provider, model: config.model, status: response.status, code }));
    process.exitCode = 1;
  } else {
    const result = analysisResponseSchema.parse(body);
    if (result.requestId !== requestId) throw new Error('The analysis returned a mismatched request ID.');
    console.log(JSON.stringify({ ok: true, provider: config.provider, model: config.model, status: response.status,
      imageWidth: image.width, imageHeight: image.height, imageBytes: image.bytes,
      schemaValidated: true, uxInsights: result.analysis.uxInsights.length,
      observedElements: result.analysis.productInsights.observedElements.length,
      limitations: result.analysis.limitations.length }));
  }
} catch {
  console.error('The vision smoke check failed. Verify the image path, server configuration and provider availability.');
  process.exitCode = 1;
}
