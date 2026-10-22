import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectionCoordinator, canInspect, captureErrorMessage, sanitizePageUrl, type CoordinatorIO } from './coordinator';
import type { BackgroundEvent, Report } from '@vclarity/shared';

describe('background integration', () => {
  let reports: Map<number, Report>;
  let events: BackgroundEvent[];
  let io: CoordinatorIO;
  let coordinator: InspectionCoordinator;
  beforeEach(() => {
    reports = new Map(); events = [];
    io = {
      read: async id => reports.get(id) ?? null, write: async report => { reports.set(report.tabId, report); },
      tab: async id => ({ id, windowId: 1, url: 'https://example.com/', active: true }),
      active: async () => ({ id: 1, windowId: 1, url: 'https://example.com/', active: true }),
      inspect: vi.fn(async () => ({ ok: true })), inject: vi.fn(async () => {}), capture: vi.fn(async () => 'data:image/png;base64,actualCapture'),
      publish: async event => { events.push(event); }, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    };
    coordinator = new InspectionCoordinator(io);
  });
  it('starts a session, persists it and sends isolated content commands', async () => {
    const report = await coordinator.start(1, 'live');
    expect(report.status).toBe('live-inspecting');
    expect(reports.get(1)).toEqual(report);
    expect(io.inspect).toHaveBeenLastCalledWith(1, { type: 'INSPECT', mode: 'live', sessionId: report.sessionId });
    expect(events[0]?.type).toBe('REPORT');
  });
  it('reinjects only if inspector is unavailable', async () => {
    io.inspect = vi.fn(async (_id, command) => ({ ok: command.type !== 'PING' }));
    await coordinator.start(1, 'ghost');
    expect(io.inject).toHaveBeenCalledWith(1);
  });
  it('reports missing activeTab permission without fabricated results', async () => {
    io.inspect = vi.fn(async () => { throw new Error('no permission'); });
    io.inject = vi.fn(async () => { throw new Error('no permission'); });
    const report = await coordinator.start(1, 'live');
    expect(report.status).toBe('local-error'); expect(report.element).toBeNull();
    expect(report.error).toContain('toolbar icon');
  });
  it('drops selection messages from superseded sessions', async () => {
    const old = await coordinator.start(1, 'ghost');
    const current = await coordinator.start(1, 'live');
    await coordinator.content(1, { type: 'SELECTION_CANCELLED', sessionId: old.sessionId, reason: 'old cancellation' });
    expect(reports.get(1)?.sessionId).toBe(current.sessionId);
    expect(reports.get(1)?.status).toBe('live-inspecting');
  });
  it('keeps tab reports isolated', async () => {
    const first = await coordinator.start(1, 'ghost');
    io.active = async () => ({ id: 2, windowId: 1, url: 'https://example.com/', active: true });
    const second = await coordinator.start(2, 'live');
    expect((await io.read(1))?.sessionId).toBe(first.sessionId);
    expect((await io.read(2))?.sessionId).toBe(second.sessionId);
    await expect(coordinator.start(1, 'live')).rejects.toThrow('active tab changed');
  });
  const viewport = { width: 1000, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 };
  it('verifies viewport before and after screenshot and publishes ephemeral bitmap', async () => {
    const report = await coordinator.start(1, 'ghost');
    const region = { x: 5, y: 20, width: 100, height: 80 };
    await coordinator.content(1, { type: 'REGION_SELECTED', sessionId: report.sessionId, region, viewport });
    expect(io.capture).toHaveBeenCalledWith(1, 1);
    expect(events.at(-1)).toMatchObject({ type: 'CAPTURE', sessionId: report.sessionId, region });
    expect(JSON.stringify(await io.read(1))).not.toContain('base64');
  });
  it('propagates screenshot failure to sidebar report', async () => {
    const report = await coordinator.start(1, 'ghost');
    io.capture = async () => { throw new Error('Screenshot permission denied. Click the toolbar and retry.'); };
    await coordinator.content(1, { type: 'REGION_SELECTED', sessionId: report.sessionId, region: { x: 0, y: 0, width: 80, height: 80 }, viewport });
    expect(reports.get(1)?.status).toBe('local-error');
    expect(reports.get(1)?.error).toContain('Screenshot permission');
  });
  it('rejects viewport movement and avoids capture', async () => {
    const report = await coordinator.start(1, 'ghost');
    io.inspect = async () => ({ ok: false });
    await coordinator.content(1, { type: 'REGION_SELECTED', sessionId: report.sessionId, region: { x: 0, y: 0, width: 80, height: 80 }, viewport });
    expect(io.capture).not.toHaveBeenCalled(); expect(reports.get(1)?.status).toBe('local-error');
  });
  it('ignores old AI completions and forwards current request errors', async () => {
    const selected = await coordinator.start(1, 'ghost');
    const ready = { ...selected, status: 'local-ready' as const };
    await io.write(ready);
    const requestId = crypto.randomUUID();
    await coordinator.panel({ type: 'AI_START', tabId: 1, sessionId: ready.sessionId, requestId });
    await coordinator.panel({ type: 'FAIL', tabId: 1, sessionId: ready.sessionId, requestId: crypto.randomUUID(), message: 'old timeout' });
    expect(reports.get(1)?.status).toBe('ai-analyzing');
    await coordinator.panel({ type: 'FAIL', tabId: 1, sessionId: ready.sessionId, requestId, message: 'Provider timed out. Retry.' });
    expect(reports.get(1)?.status).toBe('ai-error');
    expect(reports.get(1)?.error).toContain('timed out');
  });
  it('rejects impossible transitions instead of overwriting state', async () => {
    const report = await coordinator.start(1, 'live');
    await expect(coordinator.panel({ type: 'LOCAL_RESULT', tabId: 1, sessionId: report.sessionId, palette: [] })).rejects.toThrow('Invalid workflow');
  });
});
describe('page eligibility and URL minimization', () => {
  it('makes screenshot permission and quota failures actionable', () => {
    expect(captureErrorMessage(new Error('Either activeTab or all_urls permission is required'))).toContain('toolbar icon');
    expect(captureErrorMessage(new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND'))).toContain('Wait a moment');
    expect(captureErrorMessage(new Error('Capture failed'))).toContain('Keep the website visible');
  });
  it('restricts inspection to normal HTTP(S) pages', () => {
    expect(canInspect('https://example.com')).toBe(true);
    expect(canInspect('chrome://extensions')).toBe(false);
    expect(canInspect('https://chromewebstore.google.com/detail/test')).toBe(false);
    expect(canInspect('file:///private')).toBe(false);
  });
  it('strips authentication-looking query, fragment and URL credentials', () => {
    expect(sanitizePageUrl('https://user:pass@example.com/app?token=secret#private')).toBe('https://example.com/app');
  });
});
