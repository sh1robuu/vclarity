import type { OptimizedImage, PaletteColor, Rect, Viewport } from '@vclarity/shared';
import type { ProcessRequest, ProcessResponse } from './protocol';

export interface CaptureResult { palette: PaletteColor[]; image: OptimizedImage; previewUrl: string; computationMs: number }
const active = new Set<() => void>();
const previews = new Set<string>();

/** All decoding, pixel computation, resizing and encoding run in a dedicated worker. */
export function processCapture(dataUrl: string, region: Rect, viewport: Viewport, signal?: AbortSignal): Promise<CaptureResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Image processing cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      active.delete(cancel);
      worker.terminate();
    };
    const cancel = () => {
      if (settled) return;
      cleanup(); reject(new DOMException('Image processing cancelled.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      cleanup(); reject(new Error('Image processing took too long. Select a smaller region and retry.'));
    }, 30_000);
    active.add(cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ProcessResponse>) => {
      if (settled || event.data.id !== id) return;
      cleanup();
      if (!event.data.ok) { reject(new Error(event.data.error)); return; }
      const { previewBlob, ...result } = event.data.result;
      try {
        const previewUrl = URL.createObjectURL(previewBlob);
        previews.add(previewUrl);
        resolve({ ...result, previewUrl });
      } catch { reject(new Error('The captured image could not be previewed. Try capturing again.')); }
    };
    worker.onerror = () => {
      if (settled) return;
      cleanup(); reject(new Error('The local image worker stopped unexpectedly. Try capturing again.'));
    };
    const request: ProcessRequest = { id, dataUrl, region, viewport };
    try { worker.postMessage(request); }
    catch { cleanup(); reject(new Error('The captured image could not be sent to local processing. Try capturing again.')); }
  });
}

export function disposePreview(url: string): void {
  if (previews.delete(url)) URL.revokeObjectURL(url);
}

/** Use when the side panel closes to release in-flight workers and image memory. */
export function disposeImageProcessing(): void {
  for (const cancel of [...active]) cancel();
  for (const url of [...previews]) disposePreview(url);
}
