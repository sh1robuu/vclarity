import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle, ScanLine, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { Report } from '@vclarity/shared';
import { analyzeCapture } from '../lib/panel/client';
import { productMarkdown, uxMarkdown } from '../lib/panel/markdown';
import { usePanel } from '../stores/panel';
import { CopyButton, SectionHeading, SourceBadge, TextList } from './common';

interface InsightActions {
  onStartGhost: () => void;
  onOpenSettings: () => void;
  onCancel: () => void;
  canInspect: boolean;
  pending: boolean;
}

function CapturePrompt({ title, description, onStartGhost, canInspect, pending }: Pick<InsightActions, 'onStartGhost' | 'canInspect' | 'pending'> & { title: string; description: string }) {
  return <section className="empty-state insights-empty" data-testid="insights-capture-prompt"><div className="empty-symbol"><ScanLine size={25} strokeWidth={1.4} /></div><div className="eyebrow">PRODUCT & UX INSIGHTS</div><h1>{title}</h1><p>{description}</p><button className="primary-button" type="button" data-testid="insights-start-ghost" disabled={pending || !canInspect} onClick={onStartGhost}><ScanLine size={14} />Start Ghost Inspect</button>{!canInspect && <p className="fine-print">Open a website tab to select a region.</p>}<div className="empty-method"><span className="method-index">01</span><div><strong>Select a region</strong><p>Drag around the interface you want to understand. Review the capture and its local color palette.</p></div></div><div className="empty-method"><span className="method-index">02</span><div><strong>Review & analyze</strong><p>Connect your local service, then approve sending the selected image for evidence-based UX findings and product logic.</p></div></div><div className="privacy-note"><ShieldCheck size={14} /><span>Images stay in memory until you choose to send them. AI interpretations require validation.</span></div></section>;
}

function AnalysisProgress() {
  return <div className="information progress" role="status" data-testid="insights-analyzing"><LoaderCircle size={17} className="spin" /><div><h2>Analyzing your selected region</h2><p>The service is reviewing visible UX and product evidence. Local design data remains available. You can cancel from the status bar above.</p></div></div>;
}

function Consent({ report, ...actions }: { report: Report } & InsightActions) {
  const image = usePanel((state) => state.image);
  const previewUrl = usePanel((state) => state.previewUrl);
  const token = usePanel((state) => state.token);
  const connectionStatus = usePanel((state) => state.connectionStatus);
  const connectionInfo = usePanel((state) => state.connectionInfo);
  const [consent, setConsent] = useState(false);
  const [allowLarge, setAllowLarge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => { setConsent(false); setAllowLarge(false); setError(null); }, [report.sessionId]);
  if (report.status === 'ai-analyzing') return <AnalysisProgress />;
  if (report.status === 'ghost-selecting' || report.status === 'capturing' || report.status === 'local-processing') return <section className="selection-state" data-testid="insights-capture-progress"><div className="selection-icon">{report.status === 'ghost-selecting' ? <ScanLine size={26} /> : <LoaderCircle size={26} className="spin" />}</div><div className="eyebrow">PREPARING PRODUCT & UX INSIGHTS</div><h1>{report.status === 'ghost-selecting' ? 'Select an interface region' : report.status === 'capturing' ? 'Capturing your selection' : 'Preparing your selected image'}</h1><p>{report.status === 'ghost-selecting' ? 'Click and drag on your website, then release to capture the region. Your image will appear here for review.' : 'Extracting local pixel colors and preparing a readable image. Nothing is sent to AI until you approve it.'}</p><button className="secondary-button" type="button" disabled={actions.pending} onClick={actions.onCancel}>Cancel inspection</button></section>;
  if (report.mode === 'live') return <CapturePrompt {...actions} title="Use Ghost Inspect for visual insights" description="Live Inspect measures actual element properties. Select a screen region with Ghost Inspect to explore UX patterns and possible product behavior." />;
  if (report.status === 'local-error') return <CapturePrompt {...actions} title="The capture could not finish" description="Select the region again to prepare a new image. The inspection error above explains what needs attention." />;
  if (report.status === 'cancelled') return <CapturePrompt {...actions} title="Ready for a new region" description="Your inspection was cancelled. Start Ghost Inspect when you want to explore another interface." />;
  if (!image) return <CapturePrompt {...actions} title="A new capture is needed" description="The selected image is no longer in panel memory. Capture another region to request AI analysis; any completed report remains available below." />;
  if (!['local-ready', 'ai-error', 'completed'].includes(report.status)) return <CapturePrompt {...actions} title="Capture a region to get started" description="Select an interface region to prepare optional product and UX analysis." />;
  const unavailable = !!connectionInfo && (!connectionInfo.aiConfigured || connectionInfo.imageAnalysisSupported === false);
  const connectionBusy = connectionStatus === 'checking' || connectionStatus === 'restoring';
  const blocked = starting || connectionBusy || connectionStatus === 'invalid' || !consent || !token.trim() || unavailable || (!image.targetMet && !allowLarge);
  return <section className="consent-section"><div className="eyebrow"><ShieldCheck size={13} /> OPTIONAL AI ANALYSIS</div><h2>{report.status === 'ai-error' ? 'Retry this image' : report.analysis ? 'Analyze this image again' : 'From pixels to product insight'}</h2><p>Your selected image will be sent to the local service at <code>127.0.0.1:4317</code>, then to its configured AI provider. Screenshots may contain personal or sensitive information. Review your selection before sending.</p><div className="upload-meta"><span>{image.width} × {image.height} px</span><span>{image.mimeType.replace('image/', '').toUpperCase()}</span><span>{(image.bytes / 1024).toFixed(1)} KB</span></div>
    {previewUrl && <img className="capture-preview" src={previewUrl} alt="Selected region to review before sending for AI analysis" />}
    {!image.targetMet && <div className="large-image-warning"><strong>Compression target exceeded</strong><p>{image.warning ?? 'This image is larger than the 100 KB target. Keeping readable detail requires a larger upload.'}</p><label className="checkbox-row"><input type="checkbox" checked={allowLarge} onChange={(event) => setAllowLarge(event.target.checked)} /><span>I accept sending this larger image ({(image.bytes / 1024).toFixed(1)} KB).</span></label></div>}
    <label className="checkbox-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I allow this selected image to be sent for AI analysis.</span></label>
    {(!token.trim() || unavailable || connectionStatus === 'invalid' || connectionStatus === 'disconnected' || connectionStatus === 'error') && <div className="connection-help"><p className="small">{!token.trim() ? 'Save your local service access token to continue. Provider API keys stay on the server.' : unavailable ? 'Your server needs a configured provider and an image-capable model before this image can be analyzed.' : 'The last connection check needs attention. Review your saved token and local service before retrying.'}</p><button className="text-button accent" type="button" data-testid="insights-open-settings" onClick={actions.onOpenSettings}><SlidersHorizontal size={13} />Open connection settings</button></div>}
    {connectionBusy && <p className="fine-print" role="status">Checking your saved connection…</p>}
    <button className="primary-button" type="button" disabled={blocked} onClick={() => { setError(null); setStarting(true); void analyzeCapture().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Analysis could not start. Please retry.')).finally(() => setStarting(false)); }}>{starting ? <><LoaderCircle size={14} className="spin" />Starting analysis…</> : <>Send image & analyze <ArrowUpRight size={14} /></>}</button>
    {error && <p className="inline-error" role="alert">{error}</p>}<p className="fine-print">Images are kept only while this panel is open. A new tab or inspection discards the current image. Token storage is controlled in Settings.</p>
  </section>;
}

export function Insights({ report, ...actions }: { report: Report | null } & InsightActions) {
  if (!report) return <CapturePrompt {...actions} title="Understand the experience" description="Capture an interface to explore evidence-based UX findings and possible product logic. Start by selecting a region of your website." />;
  const analysis = report.analysis;
  return <>
    {analysis ? <>
      {report.status === 'ai-analyzing' && <AnalysisProgress />}
      {report.status === 'ai-error' && <Consent report={report} {...actions} />}
      <section className="analysis-summary"><div className="eyebrow">VISUAL INTERPRETATION</div><h1>Product & UX Insights</h1><SourceBadge source="ai" /><p>{analysis.summary}</p><p className="fine-print">Based on the selected image. Inferred behavior needs validation.</p></section>
      <section className="report-section"><SectionHeading title="UX analysis" badge={<SourceBadge source="ai" />} action={<CopyButton compact label="Copy UX analysis" text={() => uxMarkdown(analysis)} />} />{analysis.uxInsights.length ? analysis.uxInsights.map((insight, index) => <article className="insight" key={insight.id}><div className="insight-number">{String(index + 1).padStart(2, '0')}</div><div className="insight-content"><div className="insight-classification"><span>{insight.classification}</span><span>{insight.confidence} confidence</span></div><h3>{insight.title}</h3><p>{insight.finding}</p><dl className="evidence"><div><dt>Evidence</dt><dd>{insight.evidence}</dd></div>{insight.principle && <div><dt>Principle</dt><dd>{insight.principle}</dd></div>}<div><dt>Impact</dt><dd>{insight.impact}</dd></div>{insight.recommendation && <div><dt>Recommendation</dt><dd>{insight.recommendation}</dd></div>}</dl></div></article>) : <p className="muted small">No evidence-supported UX findings returned.</p>}</section>
      <section className="report-section product-section"><SectionHeading title="Product logic" badge={<SourceBadge source="ai" />} action={<CopyButton compact label="Copy product logic" text={() => productMarkdown(analysis)} />} /><h3 className="feature-name">{analysis.productInsights.featureName}</h3><span className="classification">Inferred purpose</span><p>{analysis.productInsights.purpose}</p><h3><span className="classification observed">Observed</span> UI elements & actions</h3><TextList items={analysis.productInsights.observedElements} /><h3><span className="classification observed">Observed</span> States</h3><TextList items={analysis.productInsights.observedStates} /><h3><span className="classification">Inferred</span> Behaviors & conditions</h3>{analysis.productInsights.inferredBehaviors.length ? analysis.productInsights.inferredBehaviors.map((item, index) => <div className="behavior" key={index}><p>{item.behavior}</p><p className="small muted"><strong>Evidence:</strong> {item.evidence}</p><span className="confidence">{item.confidence} confidence</span></div>) : <p className="muted small">No supported behavioral inferences returned.</p>}<h3><span className="classification unknown-label">Unknown</span> Conditions</h3><TextList items={analysis.productInsights.unknowns} /><h3>Questions to validate</h3><TextList items={analysis.productInsights.validationQuestions} /></section>
      <section className="report-section"><SectionHeading title="Analysis limitations" /><TextList items={analysis.limitations} /></section>
      {!['ai-analyzing', 'ai-error'].includes(report.status) && <details className="reanalyze-details"><summary>Review consent & analyze again</summary><Consent report={report} {...actions} /></details>}
    </> : <Consent report={report} {...actions} />}
  </>;
}
