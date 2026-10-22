import { z } from 'zod';
import { analysisRequestSchema, analysisResponseSchema, apiErrorSchema, panelCommandSchema, rectSchema, reportSchema, viewportSchema, type BackgroundEvent, type CommandResult, type PanelCommand, type Report } from '@vclarity/shared';
import { processCapture, disposeImageProcessing, disposePreview } from '../image';
import { matchesSession, usePanel } from '../../stores/panel';

const backgroundEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CONTEXT'), windowId: z.number().int(), tabId: z.number().int(), url: z.string().max(2000), report: reportSchema.nullable() }).strict(),
  z.object({ type: z.literal('REPORT'), report: reportSchema }).strict(),
  z.object({ type: z.literal('CAPTURE'), windowId: z.number().int(), tabId: z.number().int(), sessionId: z.string().uuid(), dataUrl: z.string().max(50_000_000), region: rectSchema, viewport: viewportSchema }).strict(),
]);
const commandResultSchema = z.union([
  z.object({ ok: z.literal(true), report: reportSchema.nullable().optional(), tabId: z.number().int().optional(), url: z.string().optional() }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);
let work: AbortController | null = null;
let eventRevision = 0;
let aiFlight: { tabId: number; sessionId: string; controller: AbortController } | null = null;

const usefulError = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Try inspecting again.';
export function clearCapture(): void {
  work?.abort(); work = null;
  aiFlight = null;
  const previous = usePanel.getState();
  if (previous.previewUrl) disposePreview(previous.previewUrl);
  previous.set({ image: null, previewUrl: null, computationMs: null });
}

function applyReport(report: Report): void {
  const state = usePanel.getState();
  if (state.tabId !== report.tabId) return;
  if (state.report?.sessionId !== report.sessionId || report.status === 'cancelled') clearCapture();
  state.set({ report, connectionError: null });
}

export async function sendCommand(command: PanelCommand): Promise<CommandResult> {
  panelCommandSchema.parse(command);
  const revision = eventRevision;
  const result = commandResultSchema.parse(await chrome.runtime.sendMessage(command));
  if (!result.ok) throw new Error(result.error);
  // A broadcast received while awaiting a command is newer than its snapshot result.
  if (result.report && command.type !== 'GET_CONTEXT' && revision === eventRevision) applyReport(result.report);
  return result;
}

async function processRegion(event: Extract<BackgroundEvent, { type: 'CAPTURE' }>): Promise<void> {
  if (!matchesSession(usePanel.getState(), event.tabId, event.sessionId)) return;
  clearCapture();
  const controller = new AbortController(); work = controller;
  try {
    await sendCommand({ type: 'PROCESSING', tabId: event.tabId, sessionId: event.sessionId });
    if (controller.signal.aborted) return;
    const result = await processCapture(event.dataUrl, event.region, event.viewport, controller.signal);
    if (controller.signal.aborted || !matchesSession(usePanel.getState(), event.tabId, event.sessionId)) { disposePreview(result.previewUrl); return; }
    usePanel.getState().set({ image: result.image, previewUrl: result.previewUrl, computationMs: result.computationMs });
    await sendCommand({ type: 'LOCAL_RESULT', tabId: event.tabId, sessionId: event.sessionId, palette: result.palette });
  } catch (error) {
    if (!controller.signal.aborted && matchesSession(usePanel.getState(), event.tabId, event.sessionId)) {
      await sendCommand({ type: 'FAIL', tabId: event.tabId, sessionId: event.sessionId, requestId: null, message: usefulError(error) }).catch((failure: unknown) => usePanel.getState().set({ connectionError: usefulError(failure) }));
    }
  }
}

function acceptEvent(raw: unknown, _sender?: chrome.runtime.MessageSender, respond?: (response: { accepted: boolean }) => void): void {
  const parsed = backgroundEventSchema.safeParse(raw);
  if (!parsed.success) return;
  const event = parsed.data;
  if (event.type !== 'REPORT' && event.windowId !== usePanel.getState().windowId) return;
  eventRevision += 1;
  if (event.type === 'CONTEXT') {
    const state = usePanel.getState();
    if (state.tabId !== event.tabId || state.report?.sessionId !== event.report?.sessionId) clearCapture();
    state.set({ tabId: event.tabId, url: event.url, report: event.report, connectionError: null });
  } else if (event.type === 'REPORT') applyReport(event.report);
  else {
    const owned = matchesSession(usePanel.getState(), event.tabId, event.sessionId);
    respond?.({ accepted: owned });
    if (owned) void processRegion(event);
  }
}

export async function startInspect(mode: 'live' | 'ghost'): Promise<void> {
  const { tabId } = usePanel.getState();
  if (tabId === null) throw new Error('Open a website tab and reopen Vclarity to inspect it.');
  await sendCommand({ type: 'START', mode, tabId });
  usePanel.getState().set({ selectedTab: 'design' });
}

export async function cancelInspect(): Promise<void> {
  const { tabId, report } = usePanel.getState();
  clearCapture();
  if (tabId !== null && report) await sendCommand({ type: 'CANCEL', tabId, sessionId: report.sessionId });
}

export async function analyzeCapture(): Promise<void> {
  const initial = usePanel.getState();
  if (!initial.image || !initial.report || initial.tabId === null) throw new Error('Select a new region to prepare an image for AI analysis.');
  if (!initial.token.trim()) throw new Error('Enter the local service access token in settings first.');
  if (!['local-ready', 'ai-error', 'completed'].includes(initial.report.status)) throw new Error('This capture is not ready for AI analysis.');
  if (aiFlight && !aiFlight.controller.signal.aborted && aiFlight.tabId === initial.tabId && aiFlight.sessionId === initial.report.sessionId) throw new Error('AI analysis is already starting for this image.');
  work?.abort();
  const controller = new AbortController(); work = controller;
  const tabId = initial.tabId, sessionId = initial.report.sessionId, requestId = crypto.randomUUID();
  const request = analysisRequestSchema.parse({ requestId, image: initial.image });
  aiFlight = { tabId, sessionId, controller };
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
  try {
    await sendCommand({ type: 'AI_START', tabId, sessionId, requestId });
    if (controller.signal.aborted || !matchesSession(usePanel.getState(), tabId, sessionId, requestId)) return;
    const response = await fetch('http://127.0.0.1:4317/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${initial.token.trim()}` },
      body: JSON.stringify(request), signal: controller.signal,
    });
    if (Number(response.headers.get('Content-Length') || 0) > 300_000) throw new Error('The AI service returned an oversized response. Try again.');
    const rawBody = await response.text();
    if (rawBody.length > 300_000) throw new Error('The AI service returned an oversized response. Try again.');
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new Error('The AI service returned an unreadable response. Check its configuration and retry.'); }
    if (!response.ok) {
      const apiError = apiErrorSchema.safeParse(body);
      throw new Error(apiError.success ? apiError.data.error.message : `AI service returned HTTP ${response.status}. Check its configuration and retry.`);
    }
    const parsed = analysisResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.requestId !== requestId) throw new Error('The AI response could not be validated. Retry the analysis.');
    if (!controller.signal.aborted && matchesSession(usePanel.getState(), tabId, sessionId, requestId)) await sendCommand({ type: 'AI_RESULT', tabId, sessionId, requestId, analysis: parsed.data.analysis });
  } catch (error) {
    if ((!controller.signal.aborted || timedOut) && matchesSession(usePanel.getState(), tabId, sessionId, requestId)) {
      const message = timedOut ? 'AI analysis timed out. Check the local service and retry this image.' : error instanceof TypeError ? 'Could not reach the AI service. Start it at 127.0.0.1:4317 and retry this image.' : usefulError(error);
      await sendCommand({ type: 'FAIL', tabId, sessionId, requestId, message }).catch((failure: unknown) => usePanel.getState().set({ connectionError: usefulError(failure) }));
    } else if (!controller.signal.aborted && matchesSession(usePanel.getState(), tabId, sessionId)) {
      usePanel.getState().set({ connectionError: usefulError(error) });
    }
  } finally {
    clearTimeout(timeout);
    if (aiFlight?.controller === controller) aiFlight = null;
    if (work === controller) work = null;
  }
}

export function connectPanel(): () => void {
  if (!globalThis.chrome?.runtime?.id) {
    usePanel.getState().set({ connectionError: 'Open Vclarity as a Chrome extension side panel to connect to a website.' });
    return () => undefined;
  }
  let disposed = false;
  let port: chrome.runtime.Port | null = null;
  let windowId: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const syncContext = () => {
    if (windowId === null) return;
    const boundWindowId = windowId;
    const initialRevision = eventRevision;
    void sendCommand({ type: 'GET_CONTEXT', windowId: boundWindowId }).then((result) => {
      if (!disposed && initialRevision === eventRevision && result.ok && result.tabId !== undefined) acceptEvent({ type: 'CONTEXT', windowId: boundWindowId, tabId: result.tabId, url: result.url ?? '', report: result.report ?? null });
    }).catch((error: unknown) => { if (!disposed) usePanel.getState().set({ connectionError: usefulError(error) }); });
  };
  const reconnect = () => {
    if (disposed || windowId === null) return;
    try {
      port = chrome.runtime.connect({ name: 'vclarity-panel' });
      port.postMessage({ type: 'BIND', windowId });
      port.onDisconnect.addListener(() => {
        if (!disposed) retryTimer = setTimeout(reconnect, 750);
      });
      syncContext();
    } catch {
      usePanel.getState().set({ connectionError: 'The extension service is restarting. Reconnecting to this tab…' });
      retryTimer = setTimeout(reconnect, 1500);
    }
  };
  chrome.runtime.onMessage.addListener(acceptEvent);
  void chrome.windows.getCurrent().then((window) => {
    if (disposed) return;
    if (window.id === undefined) throw new Error('The panel could not identify its Chrome window. Close and reopen Vclarity.');
    windowId = window.id;
    usePanel.getState().set({ windowId });
    reconnect();
  }).catch((error: unknown) => { if (!disposed) usePanel.getState().set({ connectionError: usefulError(error) }); });
  void chrome.commands.getAll().then((commands) => {
    usePanel.getState().set({ shortcuts: { live: commands.find((command) => command.name === 'live-inspect')?.shortcut ?? '', ghost: commands.find((command) => command.name === 'ghost-inspect')?.shortcut ?? '' } });
  }).catch(() => usePanel.getState().set({ shortcuts: { live: '', ghost: '' } }));
  return () => { disposed = true; clearTimeout(retryTimer); chrome.runtime.onMessage.removeListener(acceptEvent); port?.disconnect(); clearCapture(); disposeImageProcessing(); };
}

export async function openShortcuts(): Promise<void> {
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
