import { MAX_ENCODED_IMAGE_PIXELS, type OptimizedImage } from '@vclarity/shared';

export const IMAGE_TARGET_BYTES = 100_000;
export const MAX_IMAGE_BYTES = 2_000_000;
export interface CompressionCandidate { width: number; height: number; quality: number }
export type ImageMime = OptimizedImage['mimeType'];
export type EncodeImage = (candidate: CompressionCandidate, mime: ImageMime) => Promise<Blob>;

/** Conservative readability floor: at least 75% of captured resolution, and no
 * downscaling below a 1024px long edge. Quality never falls below 0.74. */
export function compressionCandidates(width: number, height: number): CompressionCandidate[] {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 8192)) {
    throw new Error('The selected image dimensions are unsupported. Select a smaller region.');
  }
  const floor = Math.min(1, Math.max(0.75, 1024 / Math.max(width, height)));
  const minimumWidth = Math.ceil(width * floor), minimumHeight = Math.ceil(height * floor);
  if (minimumWidth * minimumHeight > MAX_ENCODED_IMAGE_PIXELS) {
    throw new Error('This region exceeds the supported image dimensions while preserving readable text. Select a smaller area and try again.');
  }
  const maximumScale = Math.min(1, Math.sqrt(MAX_ENCODED_IMAGE_PIXELS / (width * height)));
  const scales = [...new Set([1, 0.9, 0.8, floor].map(scale => Math.min(scale, maximumScale)).filter(scale => scale >= floor))];
  const seen = new Set<string>();
  return scales.flatMap((scale) => {
    // Round down to stay inside the API pixel budget, then enforce the readability
    // floor in both dimensions. Rounding can otherwise exceed either boundary.
    const candidateWidth = Math.max(minimumWidth, Math.floor(width * scale));
    const candidateHeight = Math.max(minimumHeight, Math.floor(height * scale));
    const key = `${candidateWidth}x${candidateHeight}`;
    if (candidateWidth * candidateHeight > MAX_ENCODED_IMAGE_PIXELS || seen.has(key)) return [];
    seen.add(key);
    return [0.9, 0.82, 0.74].map(quality => ({ width: candidateWidth, height: candidateHeight, quality }));
  });
}

export interface EncodedImage {
  blob: Blob; width: number; height: number; mimeType: ImageMime; targetMet: boolean; warning: string | null;
}

/** Encoder injection keeps size/readability policy independently testable. */
export async function chooseEncoding(width: number, height: number, encode: EncodeImage, preferWebp = true): Promise<EncodedImage> {
  let smallest: EncodedImage | null = null;
  const formats: ImageMime[] = preferWebp ? ['image/webp', 'image/jpeg'] : ['image/jpeg'];
  for (const mime of formats) {
    for (const candidate of compressionCandidates(width, height)) {
      let blob: Blob;
      try { blob = await encode(candidate, mime); }
      catch { break; } // A codec may be unavailable; try the JPEG fallback.
      if (blob.type !== mime || blob.size === 0) break;
      const result: EncodedImage = { blob, width: candidate.width, height: candidate.height, mimeType: mime,
        targetMet: blob.size < IMAGE_TARGET_BYTES, warning: null };
      if (!smallest || blob.size < smallest.blob.size) smallest = result;
      if (result.targetMet) return result;
    }
  }
  if (!smallest) throw new Error('This browser could not encode the captured image as WebP or JPEG. Try capturing again.');
  if (smallest.blob.size > MAX_IMAGE_BYTES) {
    throw new Error('This region is too detailed to send while preserving readable text. Select a smaller area and try again.');
  }
  return { ...smallest, warning: 'The image exceeds the 100 KB target. Readable detail was preserved; review the image and its size before allowing AI analysis.' };
}

export async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
