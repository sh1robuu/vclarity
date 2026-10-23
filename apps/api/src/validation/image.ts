import { MAX_ENCODED_IMAGE_PIXELS, type OptimizedImage } from '@vclarity/shared';
import { imageSize } from 'image-size';
import { ApiError } from '../errors';

export const MAX_IMAGE_BYTES = 2_000_000;
export const MAX_IMAGE_PIXELS = MAX_ENCODED_IMAGE_PIXELS;
export const MAX_JSON_BYTES = 2_800_000;

/** Header dimensions come from the bytes, never solely from client metadata. */
export function validateImage(image: OptimizedImage): void {
  const match = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  if (!match || match[1] !== image.mimeType || !match[2] || match[2].length % 4 !== 0) {
    throw new ApiError('invalid_image', 'The screenshot encoding is invalid. Capture the region again.', 400);
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError('image_too_large', 'The screenshot exceeds 2 MB. Select a smaller region.', 413);
  if (bytes.toString('base64') !== match[2] || bytes.length !== image.bytes) {
    throw new ApiError('invalid_image', 'The screenshot byte count or encoding is invalid. Capture the region again.', 400);
  }
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(bytes);
  } catch {
    throw new ApiError('invalid_image', 'The screenshot could not be read as an image. Capture the region again.', 400);
  }
  const expectedType = image.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  if (size.type !== expectedType) throw new ApiError('invalid_image', 'The screenshot content does not match its image type.', 400);
  if (!size.width || !size.height || size.width !== image.width || size.height !== image.height ||
      size.width > 8192 || size.height > 8192 || size.width * size.height > MAX_IMAGE_PIXELS ||
      image.originalWidth < size.width || image.originalHeight < size.height) {
    throw new ApiError('invalid_dimensions', 'The screenshot dimensions are invalid. Capture a smaller region again.', 400);
  }
  if (expectedType === 'webp' && (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length)) {
    throw new ApiError('invalid_image', 'The WebP screenshot is incomplete. Capture the region again.', 400);
  }
  if (expectedType === 'jpg' && (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)) {
    throw new ApiError('invalid_image', 'The JPEG screenshot is incomplete. Capture the region again.', 400);
  }
}

/** Bound streamed bodies as well as Content-Length; never trust that header alone. */
export async function readJsonBounded(request: Request, signal?: AbortSignal): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES)) {
    throw new ApiError('payload_too_large', 'The analysis request is too large. Select a smaller region.', 413);
  }
  if (!request.body) throw new ApiError('invalid_json', 'An analysis request body is required.', 400);
  signal?.throwIfAborted();
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError('payload_too_large', 'The analysis request is too large. Select a smaller region.', 413);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))) as unknown;
  } catch {
    throw new ApiError('invalid_json', 'The analysis request is not valid JSON.', 400);
  }
}
