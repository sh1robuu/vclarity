import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewport } from '@vclarity/shared';
import { disposeImageProcessing, disposePreview, processCapture } from './index';
import type { ProcessRequest, ProcessResponse, ProcessResult } from './protocol';

class LocalWorker {
  static instances: LocalWorker[] = [];
  onmessage: ((event: MessageEvent<ProcessResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn<(request: ProcessRequest) => void>();
  terminate = vi.fn();
  constructor() { LocalWorker.instances.push(this); }
  result(response: Omit<Extract<ProcessResponse, { ok: true }>, 'id'>): void {
    const id = this.postMessage.mock.calls[0]![0].id;
    this.onmessage?.({ data: { ...response, id } } as MessageEvent<ProcessResponse>);
  }
}

const viewport: Viewport = { width: 1000, height: 800, scrollX: 0, scrollY: 0,
  devicePixelRatio: 1, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 };
const region = { x: 10, y: 10, width: 100, height: 50 };
const result: ProcessResult = {
  palette: [], computationMs: 2, previewBlob: new Blob(['pixels'], { type: 'image/webp' }),
  image: { dataUrl: 'data:image/webp;base64,AQID', mimeType: 'image/webp', width: 100, height: 50,
    originalWidth: 100, originalHeight: 50, bytes: 3, targetMet: true, warning: null },
};

beforeEach(() => {
  LocalWorker.instances = [];
  vi.stubGlobal('Worker', LocalWorker);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { disposeImageProcessing(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('image worker lifecycle', () => {
  it('creates an in-memory preview, terminates the worker and explicitly revokes the preview', async () => {
    const pending = processCapture('data:image/png;base64,AQID', region, viewport);
    const worker = LocalWorker.instances[0]!;
    worker.result({ ok: true, result });
    expect((await pending).previewUrl).toBe('blob:local-preview');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    disposePreview('blob:local-preview');
    disposePreview('blob:local-preview');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('aborts computation and ignores late messages without leaking previews', async () => {
    const controller = new AbortController();
    const pending = processCapture('data:image/png;base64,AQID', region, viewport, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    const worker = LocalWorker.instances[0]!;
    worker.result({ ok: true, result });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('does not start a worker for an already aborted capture', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(processCapture('', region, viewport, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(LocalWorker.instances).toHaveLength(0);
  });
  it('disposes both completed previews and pending jobs when the panel closes', async () => {
    const completed = processCapture('data:image/png;base64,AQID', region, viewport);
    LocalWorker.instances[0]!.result({ ok: true, result });
    await completed;
    const pending = processCapture('data:image/png;base64,AQID', region, viewport);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    disposeImageProcessing();
    await rejected;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(LocalWorker.instances[1]!.terminate).toHaveBeenCalledOnce();
  });
  it('turns worker failure and timeout into actionable errors', async () => {
    const failed = processCapture('data:image/png;base64,AQID', region, viewport);
    LocalWorker.instances[0]!.onerror?.();
    await expect(failed).rejects.toThrow('worker stopped');
    vi.useFakeTimers();
    const slow = processCapture('data:image/png;base64,AQID', region, viewport);
    const rejected = expect(slow).rejects.toThrow('took too long');
    vi.advanceTimersByTime(30_000);
    await rejected;
    expect(LocalWorker.instances[1]!.terminate).toHaveBeenCalledOnce();
  });
});
