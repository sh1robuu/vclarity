import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, ArrowRight, Check, LoaderCircle, MousePointer2, ScanLine, SlidersHorizontal } from 'lucide-react';
import type { Workflow } from '@vclarity/shared';
import { cancelInspect, connectPanel, startInspect } from '../lib/panel/client';
import { reportMarkdown } from '../lib/panel/markdown';
import { usePanel, type PanelTab } from '../stores/panel';
import { CopyButton } from './common';
import { ConnectionSettings } from './ConnectionSettings';
import { DesignSpecs } from './DesignSpecs';
import { Insights } from './Insights';

const statusLabels: Record<Workflow, string> = {
  idle: 'Ready to inspect', 'live-inspecting': 'Select an element on the page', 'element-selected': 'Element inspected',
  'ghost-selecting': 'Drag to select a screen region', capturing: 'Capturing a clean screenshot', 'local-processing': 'Extracting local pixel colors',
  'local-ready': 'Local analysis ready', 'ai-analyzing': 'Analyzing with AI', completed: 'Analysis complete',
  'ai-error': 'AI analysis needs attention', 'local-error': 'Inspection could not finish', cancelled: 'Inspection cancelled',
};
const activeStatuses: Workflow[] = ['live-inspecting', 'ghost-selecting', 'capturing', 'local-processing', 'ai-analyzing'];
const processingStatuses: Workflow[] = ['capturing', 'local-processing', 'ai-analyzing'];

function host(url: string): string { try { return new URL(url).hostname || 'Current tab'; } catch { return 'No website connected'; } }

function EmptyState({ cancelled = false }: { cancelled?: boolean }) {
  return <section className="empty-state"><div className="empty-symbol"><MousePointer2 size={24} strokeWidth={1.4} /><span /></div><div className="eyebrow">YOUR NEXT INSPECTION</div><h1>{cancelled ? 'Ready when you are.' : 'A closer look starts here.'}</h1><p>Inspect an element for exact design specs, or select a region to explore its colors and product experience.</p><div className="empty-method"><span className="method-index">01</span><div><strong>Measure the interface</strong><p>Live Inspect reads computed CSS and rendered dimensions directly from the browser.</p></div><MousePointer2 size={16} /></div><div className="empty-method"><span className="method-index">02</span><div><strong>Understand the experience</strong><p>Ghost Inspect extracts colors locally. You decide whether to send the selected image for AI insights.</p></div><ScanLine size={16} /></div><div className="privacy-note"><Check size={13} /><span>Local inspection works without an AI service.</span></div></section>;
}

export function Panel() {
  const state = usePanel();
  const [settings, setSettings] = useState(false);
  const [pending, setPending] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => connectPanel(), []);
  const report = state.report;
  const status = report?.status ?? 'idle';
  const active = activeStatuses.includes(status);
  const processing = processingStatuses.includes(status);
  const hasData = !!report && (!!report.element || report.palette.length > 0 || !!report.analysis);
  const perform = async (action: () => Promise<void>) => {
    setPending(true); state.set({ connectionError: null });
    try { await action(); } catch (error) { state.set({ connectionError: error instanceof Error ? error.message : 'The action could not finish. Please retry.' }); }
    finally { setPending(false); }
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % 2;
    if (event.key === 'ArrowLeft') next = (index + 1) % 2;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 1;
    if (next !== undefined) { event.preventDefault(); state.set({ selectedTab: next === 0 ? 'design' : 'insights' }); tabRefs.current[next]?.focus(); }
  };
  return <div className="panel" data-testid="panel">
    <header className="header"><div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>vclarity<span className="brand-period">.</span></span></div><button className={`icon-button ${settings ? 'is-active' : ''}`} type="button" aria-label="Settings" aria-expanded={settings} aria-controls="settings" title="Settings" onClick={() => setSettings(!settings)}><SlidersHorizontal size={17} /></button></header>
    <div className="website"><span className="website-dot" /><span title={state.url}>{host(state.url)}</span><span className="website-caption">CURRENT TAB</span></div>
    {settings && <ConnectionSettings onClose={() => setSettings(false)} />}
    <section className="inspect-controls" aria-label="Inspection modes"><button type="button" className={`mode-button ${status === 'live-inspecting' ? 'selected' : ''}`} data-testid="inspect-live" disabled={pending || state.tabId === null} onClick={() => void perform(() => startInspect('live'))}><span className="mode-title"><MousePointer2 size={16} />Live Inspect</span><span className="mode-description">Exact element properties</span><kbd>{state.shortcuts.live || 'Unassigned'}</kbd></button><button type="button" className={`mode-button ${status === 'ghost-selecting' ? 'selected' : ''}`} data-testid="inspect-ghost" disabled={pending || state.tabId === null} onClick={() => void perform(() => startInspect('ghost'))}><span className="mode-title"><ScanLine size={16} />Ghost Inspect</span><span className="mode-description">Selected UI region</span><kbd>{state.shortcuts.ghost || 'Unassigned'}</kbd></button></section>
    <div className={`workflow-strip ${active ? 'working' : ''}`} role="status" aria-live="polite"><span>{processing ? <LoaderCircle className="spin" size={13} /> : <span className="status-dot" />}{statusLabels[status]}</span>{active ? <button type="button" className="text-button" onClick={() => void perform(cancelInspect)} disabled={pending}>Cancel <span className="escape-hint">Esc</span></button> : <span className="local-label">{report?.mode === 'ghost' ? 'REGION' : report?.mode === 'live' ? 'ELEMENT' : 'LOCAL FIRST'}</span>}</div>
    <nav className="tabs" role="tablist" aria-label="Inspection results">{([{ id: 'design', label: 'Design Specs' }, { id: 'insights', label: 'Product & UX Insights' }] as const).map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} id={`tab-${tab.id}`} type="button" role="tab" aria-selected={state.selectedTab === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={state.selectedTab === tab.id ? 0 : -1} className={state.selectedTab === tab.id ? 'active' : ''} data-testid={`tab-${tab.id}`} onKeyDown={(event) => onTabKey(event, index)} onClick={() => state.set({ selectedTab: tab.id as PanelTab })}>{tab.label}{tab.id === 'insights' && report?.analysis && <span className="tab-dot" />}</button>)}</nav>
    <main className="main-content" id={`panel-${state.selectedTab}`} role="tabpanel" aria-labelledby={`tab-${state.selectedTab}`} tabIndex={0}>
      {(state.connectionError || report?.error) && <div className="error-notice" role="alert"><AlertCircle size={16} /><div><strong>{state.connectionError ? 'Action needs attention' : 'Inspection needs attention'}</strong><p>{state.connectionError || report?.error}</p></div></div>}
      {state.selectedTab === 'insights' ? <Insights report={report} canInspect={state.tabId !== null} pending={pending} onOpenSettings={() => setSettings(true)} onCancel={() => void perform(cancelInspect)} onStartGhost={() => void perform(async () => { await startInspect('ghost'); usePanel.getState().set({ selectedTab: 'insights' }); })} /> : active && !hasData ? <section className="selection-state"><div className="selection-icon">{processing ? <LoaderCircle className="spin" size={26} /> : status === 'live-inspecting' ? <MousePointer2 size={26} /> : <ScanLine size={26} />}</div><div className="eyebrow">{processing ? 'IN PROGRESS' : 'ON YOUR WEBSITE'}</div><h1>{statusLabels[status]}</h1><p>{status === 'live-inspecting' ? 'Hover to preview bounds, then click an element. The selection click will not activate the page control.' : status === 'ghost-selecting' ? 'Click and drag in any direction. Release to capture the selected region.' : 'Your selected image is being processed. No image is sent to AI until you approve it.'}</p><button type="button" className="secondary-button" onClick={() => void perform(cancelInspect)}>Cancel inspection</button></section> : hasData && report ? <DesignSpecs report={report} /> : <EmptyState cancelled={status === 'cancelled'} />}
    </main>
    <footer className="footer">{report && hasData ? <><div className="report-meta"><span>{report.mode === 'live' ? 'Live inspection' : 'Ghost inspection'}</span><time dateTime={report.capturedAt}>{new Date(report.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><CopyButton label="Copy full report" text={() => reportMarkdown(report)} /></> : <><span>Inspect the interface.</span><span>Understand the experience. <ArrowRight size={11} /></span></>}</footer>
  </div>;
}
