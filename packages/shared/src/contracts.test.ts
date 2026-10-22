import { describe, expect, it } from 'vitest';
import { analysisSchema, contentEventSchema, isCurrent, panelCommandSchema, reportSchema, transition, type Report } from './index';
const sessionId = '11111111-1111-4111-8111-111111111111';
const report: Report = { tabId: 1, sessionId, requestId: null, url: 'https://example.com/', capturedAt: '2026-10-22T00:00:00.000Z', mode: 'ghost', status: 'ghost-selecting', element: null, palette: [], analysis: null, region: null, error: null };
describe('cross-context contracts and workflow', () => {
  it('accepts only explicit workflow transitions', () => {
    let current = transition(report, 'capturing');
    current = transition(current, 'local-processing');
    current = transition(current, 'local-ready');
    current = transition(current, 'ai-analyzing');
    current = transition(current, 'completed');
    expect(current.status).toBe('completed');
    expect(() => transition(report, 'completed')).toThrow('Invalid workflow');
  });
  it('isolates sessions and request ids', () => {
    expect(isCurrent(report, sessionId)).toBe(true);
    expect(isCurrent(report, crypto.randomUUID())).toBe(false);
    expect(isCurrent(report, sessionId, crypto.randomUUID())).toBe(false);
    expect(isCurrent(null, sessionId)).toBe(false);
  });
  it('rejects unrecognized keys in privileged commands', () => {
    expect(panelCommandSchema.safeParse({ type: 'START', tabId: 1, mode: 'live', code: 'alert(1)' }).success).toBe(false);
    expect(panelCommandSchema.safeParse({ type: 'START', tabId: 1.5, mode: 'live' }).success).toBe(false);
    expect(panelCommandSchema.safeParse({ type: 'CANCEL', tabId: 1, sessionId: 'bad' }).success).toBe(false);
  });
  it('rejects invalid crop metadata and fabricated analysis contracts', () => {
    expect(contentEventSchema.safeParse({ type: 'REGION_SELECTED', sessionId, region: { x: 0, y: 0, width: 0, height: 20 }, viewport: {} }).success).toBe(false);
    expect(analysisSchema.safeParse({ summary: 'looks nice' }).success).toBe(false);
    expect(reportSchema.parse(report)).toEqual(report);
  });
});
