import { create } from 'zustand';
import type { ConnectionInfo, OptimizedImage, Report } from '@vclarity/shared';

export type PanelTab = 'design' | 'insights';
export interface PanelState {
  windowId: number | null;
  tabId: number | null;
  url: string;
  report: Report | null;
  selectedTab: PanelTab;
  token: string;
  rememberToken: boolean;
  connectionStatus: 'unconfigured' | 'restoring' | 'checking' | 'connected' | 'disconnected' | 'invalid' | 'error';
  connectionMessage: string | null;
  connectionInfo: ConnectionInfo | null;
  image: OptimizedImage | null;
  previewUrl: string | null;
  computationMs: number | null;
  connectionError: string | null;
  shortcuts: { live: string; ghost: string };
  set: (state: Partial<Omit<PanelState, 'set'>>) => void;
}

// Captures remain in memory. Only an explicitly saved local service token may persist.
export const usePanel = create<PanelState>((set) => ({
  windowId: null, tabId: null, url: '', report: null, selectedTab: 'design', token: '',
  rememberToken: true, connectionStatus: 'unconfigured', connectionMessage: null, connectionInfo: null,
  image: null, previewUrl: null, computationMs: null, connectionError: null,
  shortcuts: { live: '', ghost: '' },
  set: (state) => set(state),
}));

export function matchesSession(state: Pick<PanelState, 'tabId' | 'report'>, tabId: number, sessionId: string, requestId?: string): boolean {
  return state.tabId === tabId && state.report?.sessionId === sessionId
    && (requestId === undefined || state.report.requestId === requestId);
}
