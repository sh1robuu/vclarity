import { bitmapCrop, samplingDimensions } from './crop';
import { captureBlob } from './decode';
import { blobDataUrl, chooseEncoding } from './optimize';
import { extractPalette } from './palette';
import type { ProcessRequest, ProcessResponse } from './protocol';

const scope = self as unknown as {
  addEventListener(type: 'message', callback: (event: MessageEvent<ProcessRequest>) => void): void;
  postMessage(message: ProcessResponse): void;
};

scope.addEventListener('message', (event) => { void processImage(event.data); });

async function processImage(request: ProcessRequest): Promise<void> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(captureBlob(request.dataUrl));
    const crop = bitmapCrop(request.region, request.viewport, bitmap.width, bitmap.height);
    if (crop.width > 8192 || crop.height > 8192 || crop.width * crop.height > 32_000_000) {
      throw new Error('This capture is too large to process safely. Select a smaller area.');
    }
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Local image processing is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, crop.width, crop.height);
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    bitmap.close(); bitmap = undefined;
    const sample = samplingDimensions(crop.width, crop.height);
    const sampleCanvas = new OffscreenCanvas(sample.width, sample.height);
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!sampleContext) throw new Error('Local pixel analysis is unavailable in this browser.');
    sampleContext.imageSmoothingEnabled = false;
    sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    const started = performance.now();
    const palette = extractPalette(pixels, sample.width, sample.height);
    const computationMs = performance.now() - started;
    const encoded = await chooseEncoding(crop.width, crop.height, async (candidate, mime) => {
      if (candidate.width === crop.width && candidate.height === crop.height) {
        return canvas.convertToBlob({ type: mime, quality: candidate.quality });
      }
      const resized = new OffscreenCanvas(candidate.width, candidate.height);
      const resizedContext = resized.getContext('2d', { alpha: false });
      if (!resizedContext) throw new Error('Image resizing is unavailable.');
      resizedContext.imageSmoothingQuality = 'high';
      resizedContext.drawImage(canvas, 0, 0, candidate.width, candidate.height);
      return resized.convertToBlob({ type: mime, quality: candidate.quality });
    });
    scope.postMessage({ id: request.id, ok: true, result: {
      palette, computationMs, previewBlob: encoded.blob,
      image: { dataUrl: await blobDataUrl(encoded.blob), mimeType: encoded.mimeType, width: encoded.width,
        height: encoded.height, originalWidth: crop.width, originalHeight: crop.height, bytes: encoded.blob.size,
        targetMet: encoded.targetMet, warning: encoded.warning },
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Local image processing failed. Select the region again.';
    scope.postMessage({ id: request.id, ok: false, error: message });
  } finally { bitmap?.close(); }
}
