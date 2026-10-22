import { isCurrent, transition, type BackgroundEvent, type ContentEvent, type InspectorCommand, type PanelCommand, type Report } from '@vclarity/shared';

export interface TabContext { id: number; windowId: number; url: string; active: boolean }
export interface CoordinatorIO {
  read(tabId: number): Promise<Report | null>;
  write(report: Report): Promise<void>;
  tab(tabId: number): Promise<TabContext>;
  active(windowId?: number): Promise<TabContext>;
  inspect(tabId: number, command: InspectorCommand): Promise<{ ok: boolean }>;
  inject(tabId: number): Promise<void>;
  capture(windowId: number, tabId: number): Promise<string>;
  publish(event: BackgroundEvent): Promise<void>;
  id(): string;
  now(): string;
}
const busy = new Set(['live-inspecting', 'ghost-selecting', 'capturing', 'local-processing', 'ai-analyzing']);
export const publicError = (error: unknown) => error instanceof Error ? error.message : 'Vclarity could not complete this operation. Try again.';
export function captureErrorMessage(error: unknown): string {
  const message = publicError(error);
  if (/activeTab|permission|Cannot access/i.test(message)) return 'Chrome has not granted screenshot access to this tab. Click the Vclarity toolbar icon on the website, then select the region again.';
  if (/MAX_CAPTURE|quota|too many/i.test(message)) return 'Chrome’s screenshot rate limit was reached. Wait a moment and select the region again.';
  return 'Chrome could not capture this tab. Keep the website visible, click the Vclarity toolbar icon to renew access, and select again.';
}
export function sanitizePageUrl(url: string): string {
  try { const parsed = new URL(url); parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''; return parsed.toString(); }
  catch { return ''; }
}
export function canInspect(url: string): boolean {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname !== 'chromewebstore.google.com' && !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')); }
  catch { return false; }
}

/** All writes are session-checked. The caller serializes operations for each tab. */
export class InspectionCoordinator {
  constructor(private readonly io: CoordinatorIO) {}
  private async save(report: Report): Promise<Report> { await this.io.write(report); await this.io.publish({ type: 'REPORT', report }); return report; }
  async context(windowId?: number): Promise<{ tabId: number; url: string; report: Report | null }> {
    const tab = await this.io.active(windowId);
    return { tabId: tab.id, url: tab.url, report: await this.io.read(tab.id) };
  }
  private async requireActive(tabId: number): Promise<TabContext> {
    const tab = await this.io.tab(tabId);
    const active = await this.io.active(tab.windowId);
    if (tab.id !== active.id || tab.windowId !== active.windowId || !tab.active) throw new Error('The active tab changed. Start inspection in the current tab.');
    return tab;
  }
  async start(tabId: number, mode: 'live' | 'ghost'): Promise<Report> {
    const tab = await this.requireActive(tabId);
    if (!canInspect(tab.url)) throw new Error('This page cannot be inspected. Open an HTTP(S) website, then click the Vclarity toolbar icon to grant access. Chrome pages and the Chrome Web Store are restricted.');
    await this.io.inspect(tabId, { type: 'STOP' }).catch(() => undefined);
    const report: Report = { tabId, sessionId: this.io.id(), requestId: null, url: tab.url, capturedAt: this.io.now(), mode,
      status: mode === 'live' ? 'live-inspecting' : 'ghost-selecting', element: null, palette: [], analysis: null, region: null, error: null };
    await this.save(report);
    try {
      const ping = await this.io.inspect(tabId, { type: 'PING' }).catch(() => ({ ok: false }));
      if (!ping.ok) await this.io.inject(tabId);
      await this.requireActive(tabId);
      const response = await this.io.inspect(tabId, { type: 'INSPECT', sessionId: report.sessionId, mode });
      if (!response.ok) throw new Error('The page did not accept inspection. Click the Vclarity toolbar icon, then retry.');
      return report;
    } catch {
      return this.save({ ...transition(report, 'local-error'), error: 'Vclarity cannot access this page. Click its toolbar icon to grant access, then retry. Restricted pages and closed frames are unavailable.' });
    }
  }
  async cancel(tabId: number, reason: string, sessionId?: string): Promise<Report | null> {
    const report = await this.io.read(tabId);
    if (!report || (sessionId && !isCurrent(report, sessionId))) return report;
    await this.io.inspect(tabId, { type: 'STOP' }).catch(() => undefined);
    if (!busy.has(report.status) && report.status !== 'local-ready') return report;
    return this.save({ ...transition(report, 'cancelled'), requestId: null, error: reason });
  }
  async panel(command: Exclude<PanelCommand, { type: 'GET_CONTEXT' } | { type: 'START' }>): Promise<Report | null> {
    const report = await this.io.read(command.tabId);
    if (!isCurrent(report, command.sessionId)) return report;
    if (command.type === 'CANCEL') return this.cancel(command.tabId, 'Inspection cancelled.', command.sessionId);
    await this.requireActive(command.tabId);
    if (command.type === 'PROCESSING') return this.save(transition(report, 'local-processing'));
    if (command.type === 'LOCAL_RESULT') return this.save({ ...transition(report, 'local-ready'), palette: command.palette });
    if (command.type === 'AI_START') return this.save({ ...transition(report, 'ai-analyzing'), requestId: command.requestId });
    if (command.type === 'AI_RESULT') {
      if (!isCurrent(report, command.sessionId, command.requestId)) return report;
      return this.save({ ...transition(report, 'completed'), analysis: command.analysis });
    }
    if (command.type === 'FAIL') {
      if (command.requestId && !isCurrent(report, command.sessionId, command.requestId)) return report;
      if (report.status === 'ai-analyzing') return this.save({ ...transition(report, 'ai-error'), error: command.message });
      if (['capturing', 'local-processing', 'ghost-selecting', 'live-inspecting'].includes(report.status)) return this.save({ ...transition(report, 'local-error'), error: command.message });
    }
    return report;
  }
  async content(tabId: number, event: ContentEvent): Promise<Report | null> {
    const report = await this.io.read(tabId);
    if (!isCurrent(report, event.sessionId)) return report;
    if (event.type === 'SELECTION_CANCELLED') return this.cancel(tabId, event.reason, event.sessionId);
    const tab = await this.requireActive(tabId);
    if (tab.url !== report.url) return this.cancel(tabId, 'The page navigated. Start a new inspection.');
    if (event.type === 'ELEMENT_SELECTED') return this.save({ ...transition(report, 'element-selected'), element: event.element });
    const capturing = { ...transition(report, 'capturing'), region: event.region };
    await this.save(capturing);
    try {
      if (event.viewport.visualScale !== 1 || event.viewport.visualOffsetX !== 0 || event.viewport.visualOffsetY !== 0) throw new Error('Pinch zoom and visual viewport panning are not supported. Reset pinch zoom, then select again. Browser page zoom is supported.');
      if (event.region.x < 0 || event.region.y < 0 || event.region.x + event.region.width > event.viewport.width || event.region.y + event.region.height > event.viewport.height) throw new Error('The selected region is outside the captured viewport. Select it again.');
      const valid = await this.io.inspect(tabId, { type: 'VERIFY_VIEWPORT', viewport: event.viewport });
      if (!valid.ok) throw new Error('The page moved before capture. Select the region again.');
      await this.requireActive(tabId);
      const dataUrl = await this.io.capture(tab.windowId, tabId);
      await this.requireActive(tabId);
      const after = await this.io.inspect(tabId, { type: 'VERIFY_VIEWPORT', viewport: event.viewport });
      if (!after.ok || (await this.io.tab(tabId)).url !== report.url) throw new Error('The page changed during capture. Select the region again.');
      if (!isCurrent(await this.io.read(tabId), event.sessionId)) return null;
      await this.io.publish({ type: 'CAPTURE', windowId: tab.windowId, tabId, sessionId: event.sessionId, dataUrl, region: event.region, viewport: event.viewport });
      return capturing;
    } catch (error) {
      await this.io.inspect(tabId, { type: 'STOP' }).catch(() => undefined);
      return this.save({ ...transition(capturing, 'local-error'), error: publicError(error) });
    }
  }
}
