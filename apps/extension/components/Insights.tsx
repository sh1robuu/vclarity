import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { Report } from '@vclarity/shared';
import { analyzeCapture } from '../lib/panel/client';
import { productMarkdown, uxMarkdown } from '../lib/panel/markdown';
import { usePanel } from '../stores/panel';
import { CopyButton, SectionHeading, SourceBadge, TextList } from './common';

function Consent({ report }: { report: Report }) {
  const image = usePanel((state) => state.image);
  const token = usePanel((state) => state.token);
  const [consent, setConsent] = useState(false);
  const [allowLarge, setAllowLarge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setConsent(false); setAllowLarge(false); setError(null); }, [report.sessionId]);
  if (!image) return <div className="information"><ShieldCheck size={17} /><div><h2>{report.mode === 'live' ? 'Use Ghost Inspect for visual insights' : 'A new capture is needed'}</h2><p>{report.mode === 'live' ? 'Live Inspect measures actual DOM properties. Select a screen region with Ghost Inspect to prepare optional AI analysis.' : 'The selected image is no longer in panel memory. Capture another region to request AI analysis.'}</p></div></div>;
  if (report.status === 'ai-analyzing') return <div className="information progress" role="status"><LoaderCircle size={17} className="spin" /><div><h2>Analyzing your selected region</h2><p>The service is reviewing visible UX and product evidence. Local design data remains available.</p></div></div>;
  if (!['local-ready', 'ai-error', 'completed'].includes(report.status)) return null;
  return <section className="consent-section"><div className="eyebrow"><ShieldCheck size={13} /> OPTIONAL AI ANALYSIS</div><h2>{report.status === 'ai-error' ? 'Retry this image' : report.analysis ? 'Analyze this image again' : 'From pixels to product insight'}</h2><p>Your selected image will be sent to the local service at <code>127.0.0.1:4317</code>, then to its configured AI provider. Screenshots may contain personal or sensitive information. Review your selection before sending.</p><div className="upload-meta"><span>{image.width} × {image.height} px</span><span>{image.mimeType.replace('image/', '').toUpperCase()}</span><span>{(image.bytes / 1024).toFixed(1)} KB</span></div>
    {!image.targetMet && <div className="large-image-warning"><strong>Compression target exceeded</strong><p>{image.warning ?? 'This image is larger than the 100 KB target. Keeping readable detail requires a larger upload.'}</p><label className="checkbox-row"><input type="checkbox" checked={allowLarge} onChange={(event) => setAllowLarge(event.target.checked)} /><span>I accept sending this larger image ({(image.bytes / 1024).toFixed(1)} KB).</span></label></div>}
    <label className="checkbox-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I allow this selected image to be sent for AI analysis.</span></label>
    {!token.trim() && <p className="small">Add your local service access token in <strong>Settings</strong> to continue. The provider API key stays on the server.</p>}
    <button className="primary-button" type="button" disabled={!consent || !token.trim() || (!image.targetMet && !allowLarge)} onClick={() => { setError(null); void analyzeCapture().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Analysis could not start. Please retry.')); }}>Send image & analyze <ArrowUpRight size={14} /></button>
    {error && <p className="inline-error" role="alert">{error}</p>}<p className="fine-print">Images and the access token are kept only while this panel is open. A new tab or inspection discards the current image.</p>
  </section>;
}

export function Insights({ report }: { report: Report }) {
  const analysis = report.analysis;
  return <>
    {analysis ? <>
      <section className="analysis-summary"><div className="eyebrow">VISUAL INTERPRETATION</div><h1>Product & UX Insights</h1><SourceBadge source="ai" /><p>{analysis.summary}</p><p className="fine-print">Based on the selected image. Inferred behavior needs validation.</p></section>
      <section className="report-section"><SectionHeading title="UX analysis" badge={<SourceBadge source="ai" />} action={<CopyButton compact label="Copy UX analysis" text={() => uxMarkdown(analysis)} />} />{analysis.uxInsights.length ? analysis.uxInsights.map((insight, index) => <article className="insight" key={insight.id}><div className="insight-number">{String(index + 1).padStart(2, '0')}</div><div className="insight-content"><div className="insight-classification"><span>{insight.classification}</span><span>{insight.confidence} confidence</span></div><h3>{insight.title}</h3><p>{insight.finding}</p><dl className="evidence"><div><dt>Evidence</dt><dd>{insight.evidence}</dd></div>{insight.principle && <div><dt>Principle</dt><dd>{insight.principle}</dd></div>}<div><dt>Impact</dt><dd>{insight.impact}</dd></div>{insight.recommendation && <div><dt>Recommendation</dt><dd>{insight.recommendation}</dd></div>}</dl></div></article>) : <p className="muted small">No evidence-supported UX findings returned.</p>}</section>
      <section className="report-section product-section"><SectionHeading title="Product logic" badge={<SourceBadge source="ai" />} action={<CopyButton compact label="Copy product logic" text={() => productMarkdown(analysis)} />} /><h3 className="feature-name">{analysis.productInsights.featureName}</h3><span className="classification">Inferred purpose</span><p>{analysis.productInsights.purpose}</p><h3><span className="classification observed">Observed</span> UI elements & actions</h3><TextList items={analysis.productInsights.observedElements} /><h3><span className="classification observed">Observed</span> States</h3><TextList items={analysis.productInsights.observedStates} /><h3><span className="classification">Inferred</span> Behaviors & conditions</h3>{analysis.productInsights.inferredBehaviors.length ? analysis.productInsights.inferredBehaviors.map((item, index) => <div className="behavior" key={index}><p>{item.behavior}</p><p className="small muted"><strong>Evidence:</strong> {item.evidence}</p><span className="confidence">{item.confidence} confidence</span></div>) : <p className="muted small">No supported behavioral inferences returned.</p>}<h3><span className="classification unknown-label">Unknown</span> Conditions</h3><TextList items={analysis.productInsights.unknowns} /><h3>Questions to validate</h3><TextList items={analysis.productInsights.validationQuestions} /></section>
      <section className="report-section"><SectionHeading title="Analysis limitations" /><TextList items={analysis.limitations} /></section>
      <details className="reanalyze-details"><summary>Review consent & analyze again</summary><Consent report={report} /></details>
    </> : <Consent report={report} />}
  </>;
}
