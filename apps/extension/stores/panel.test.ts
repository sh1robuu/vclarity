import { describe, expect, it } from 'vitest';
import type { Report } from '@vclarity/shared';
import { matchesSession } from './panel';

describe('panel request ownership', () => {
  const report = { sessionId: 'new-session', requestId: 'new-request' } as Report;
  const state = { tabId: 4, report };
  it('rejects results from an old tab, inspection, or AI retry', () => {
    expect(matchesSession(state, 3, 'new-session', 'new-request')).toBe(false);
    expect(matchesSession(state, 4, 'old-session', 'new-request')).toBe(false);
    expect(matchesSession(state, 4, 'new-session', 'old-request')).toBe(false);
    expect(matchesSession(state, 4, 'new-session', 'new-request')).toBe(true);
  });
  it('rejects results after context removal', () => {
    expect(matchesSession({ tabId: null, report: null }, 4, 'new-session')).toBe(false);
    expect(matchesSession({ tabId: 4, report: null }, 4, 'new-session')).toBe(false);
  });
});
