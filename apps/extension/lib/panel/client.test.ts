import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, PanelCommand, Report } from '@vclarity/shared';
import { usePanel } from '../../stores/panel';
import { analyzeCapture, clearCapture, connectPanel } from './client';

vi.mock('../image', () => ({ processCapture: vi.fn(), disposePreview: vi.fn(), disposeImageProcessing: vi.fn() }));

const sessionId = 'e57c3349-7bd7-47ec-936d-9f7f71362042';
const analysis: Analysis = { summary: 'Visible form.', uxInsights: [], productInsights: { featureName: 'Search', purpose: 'May search.', observedElements: ['Field'], observedStates: [], inferredBehaviors: [], unknowns: ['Validation rules.'], validationQuestions: [] }, limitations: ['Single image.'] };
const baseReport: Report = { tabId: 4, sessionId, requestId: null, url: 'https://example.com/', capturedAt: '2026-10-22T00:00:00Z', mode: 'ghost', status: 'local-ready', element: null, palette: [], analysis: null, region: null, error: null };
type Handler = (message: unknown, sender?: chrome.runtime.MessageSender, respond?: (response: { accepted: boolean }) => void) => void;
let handlers: Set<Handler>;
let messages: PanelCommand[];
let disconnects: Array<() => void>;
let stop: (() => void) | undefined;

beforeEach(() => {
  handlers = new Set(); messages = []; disconnects = [];
  usePanel.getState().set({ windowId: 2, tabId: 4, url: baseReport.url, report: { ...baseReport }, token: 'service-token', image: { dataUrl: 'data:image/webp;base64,YQ==', mimeType: 'image/webp', width: 10, height: 10, originalWidth: 10, originalHeight: 10, bytes: 1, targetMet: true, warning: null }, previewUrl: null, connectionError: null });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'vclarity-test',
      onMessage: { addListener: (handler: Handler) => handlers.add(handler), removeListener: (handler: Handler) => handlers.delete(handler) },
      connect: vi.fn(() => ({ onDisconnect: { addListener: (handler: () => void) => disconnects.push(handler) }, disconnect: vi.fn(), postMessage: vi.fn() })),
      sendMessage: vi.fn(async (command: PanelCommand) => {
        messages.push(command);
        const current = usePanel.getState().report;
        if (command.type === 'GET_CONTEXT') return { ok: true, tabId: 4, url: baseReport.url, report: current };
        let next = current;
        if (current && command.type === 'AI_START') next = { ...current, requestId: command.requestId, status: 'ai-analyzing' };
        if (current && command.type === 'AI_RESULT') next = { ...current, analysis: command.analysis, status: 'completed' };
        if (current && command.type === 'FAIL') next = { ...current, error: command.message, status: 'ai-error' };
        if (next) for (const handler of handlers) handler({ type: 'REPORT', report: next });
        return { ok: true, report: next };
      }),
    },
    commands: { getAll: async () => [] },
    windows: { getCurrent: async () => ({ id: 2 }) },
  });
});

afterEach(() => {
  stop?.(); stop = undefined;
  clearCapture(); vi.unstubAllGlobals(); vi.useRealTimers();
});

function deferredFetch() {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, resolve: () => resolve(new Response(JSON.stringify({ requestId: usePanel.getState().report?.requestId, analysis }), { status: 200 })) };
}

describe('panel AI request orchestration', () => {
  it('allows only one AI_START during a rapid double click', async () => {
    const pending = deferredFetch();
    const first = analyzeCapture();
    await expect(analyzeCapture()).rejects.toThrow('already starting');
    await vi.waitFor(() => expect(pending.fetcher).toHaveBeenCalledTimes(1));
    pending.resolve(); await first;
    expect(messages.filter((message) => message.type === 'AI_START')).toHaveLength(1);
    expect(messages.filter((message) => message.type === 'AI_RESULT')).toHaveLength(1);
    expect(usePanel.getState().report?.status).toBe('completed');
  });

  it('discards a late AI result after switching tabs and drops image memory', async () => {
    stop = connectPanel();
    await vi.waitFor(() => expect(messages[0]?.type).toBe('GET_CONTEXT'));
    const pending = deferredFetch();
    const first = analyzeCapture();
    await vi.waitFor(() => expect(pending.fetcher).toHaveBeenCalledTimes(1));
    const request = messages.find((message) => message.type === 'AI_START');
    for (const handler of handlers) handler({ type: 'CONTEXT', windowId: 2, tabId: 5, url: 'https://other.example/', report: null });
    expect(usePanel.getState().image).toBeNull();
    // The mocked server ignores cancellation, so ownership guards must still reject it.
    pending.resolve(); await first;
    expect(request?.type).toBe('AI_START');
    expect(messages.some((message) => message.type === 'AI_RESULT')).toBe(false);
    expect(usePanel.getState().tabId).toBe(5);
    expect(usePanel.getState().report).toBeNull();
  });

  it('retains the same image after invalid output for a user-controlled retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"unexpected":true}', { status: 200 })));
    const image = usePanel.getState().image;
    await analyzeCapture();
    expect(usePanel.getState().report?.status).toBe('ai-error');
    expect(usePanel.getState().report?.error).toContain('could not be validated');
    expect(usePanel.getState().image).toBe(image);
    expect(messages.some((message) => message.type === 'AI_RESULT')).toBe(false);
  });
});

describe('panel lifecycle messages', () => {
  it('ignores context and capture broadcasts for another Chrome window', async () => {
    stop = connectPanel();
    await vi.waitFor(() => expect(messages[0]?.type).toBe('GET_CONTEXT'));
    const state = usePanel.getState();
    const respond = vi.fn();
    for (const handler of handlers) {
      handler({ type: 'CONTEXT', windowId: 9, tabId: 8, url: 'https://other.example/', report: null });
      handler({ type: 'CAPTURE', windowId: 9, tabId: 4, sessionId, dataUrl: 'data:image/png;base64,YQ==', region: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 } }, undefined, respond);
    }
    expect(usePanel.getState().tabId).toBe(state.tabId);
    expect(usePanel.getState().image).toBe(state.image);
    expect(respond).not.toHaveBeenCalled();
    expect(messages.some(message => message.type === 'PROCESSING')).toBe(false);
  });

  it('acknowledges only captures belonging to the current tab/session', async () => {
    stop = connectPanel();
    await vi.waitFor(() => expect(messages[0]?.type).toBe('GET_CONTEXT'));
    const respond = vi.fn();
    const capture = { type: 'CAPTURE', windowId: 2, tabId: 7, sessionId, dataUrl: 'data:image/png;base64,YQ==', region: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 } };
    for (const handler of handlers) handler(capture, undefined, respond);
    expect(respond).toHaveBeenCalledWith({ accepted: false });
  });

  it('reconnects and restores context when the service-worker port disconnects', async () => {
    vi.useFakeTimers();
    stop = connectPanel();
    await Promise.resolve(); await Promise.resolve();
    expect(disconnects).toHaveLength(1);
    disconnects[0]?.();
    await vi.advanceTimersByTimeAsync(750);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(messages.filter((message) => message.type === 'GET_CONTEXT')).toHaveLength(2);
  });
});
