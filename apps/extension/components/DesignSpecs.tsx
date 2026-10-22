import type { ElementSpecs, Report } from '@vclarity/shared';
import { ArrowRight, MousePointer2, ScanLine } from 'lucide-react';
import { designMarkdown, paletteMarkdown } from '../lib/panel/markdown';
import { usePanel } from '../stores/panel';
import { CopyButton, Properties, SectionHeading, SourceBadge, TextList } from './common';

function BoxModel({ element }: { element: ElementSpecs }) {
  const spacing = (key: string) => element.spacing[key] ?? '—';
  return <div className="box-model" aria-label="Box model: browser-computed spacing and rendered dimensions">
    <span className="box-label">margin</span><span className="box-top">{spacing('margin-top')}</span><span className="box-left">{spacing('margin-left')}</span><span className="box-right">{spacing('margin-right')}</span><span className="box-bottom">{spacing('margin-bottom')}</span>
    <div className="padding-box"><span className="box-label">padding</span><span className="box-top">{spacing('padding-top')}</span><span className="box-left">{spacing('padding-left')}</span><span className="box-right">{spacing('padding-right')}</span><span className="box-bottom">{spacing('padding-bottom')}</span><div className="content-box"><span>{element.geometry['box-sizing'] ?? 'Unavailable'}</span><small>CSS box sizing</small></div></div>
  </div>;
}

export function DesignSpecs({ report }: { report: Report }) {
  const previewUrl = usePanel((state) => state.previewUrl);
  const computationMs = usePanel((state) => state.computationMs);
  const image = usePanel((state) => state.image);
  const element = report.element;
  return <>
    {element && <section className="selected-element"><div className="eyebrow"><MousePointer2 size={12} /> SELECTED ELEMENT</div><div className="element-title"><h1>{element.tag.toLowerCase()}</h1><SourceBadge source="dom" /></div><code className="selector">{element.selector}</code>{element.role && <p className="small muted">Role: {element.role}</p>}</section>}
    {report.mode === 'ghost' && <section className="region-summary"><div className="eyebrow"><ScanLine size={12} /> SELECTED REGION</div><div className="region-title"><h1>{report.region ? `${report.region.width} × ${report.region.height}` : 'Region capture'}</h1><span className="small muted">CSS px</span></div>{previewUrl && <img className="capture-preview" src={previewUrl} alt="Your selected website region, kept in panel memory" />}{image && <p className="small muted">Original {image.originalWidth} × {image.originalHeight} px · AI image {(image.bytes / 1024).toFixed(1)} KB</p>}</section>}
    {report.palette.length > 0 && <section className="report-section"><SectionHeading title="Color palette" badge={<SourceBadge source="pixels" />} action={<CopyButton compact label="Copy color palette" text={() => paletteMarkdown(report.palette)} />} /><div className="palette">{report.palette.map((color) => <div className="palette-row" key={color.rank}><span className="swatch" style={{ backgroundColor: color.hex }} aria-hidden="true" /><div className="color-value"><code>{color.hex}</code><span>RGB {color.rgb.join(', ')}</span></div><span className="coverage">≈ {color.coverage}%</span><CopyButton compact label={`Copy ${color.hex}`} text={color.hex} /></div>)}</div><p className="fine-print">Local Pixel Analysis{computationMs !== null ? ` · ${computationMs.toFixed(1)} ms computation` : ''}. Coverage is approximate. Images, gradients, and antialiasing influence these colors.</p>{report.mode === 'ghost' && <CopyButton text={() => designMarkdown(report)} label="Copy design specs" />}</section>}
    {element && <>
      <section className="report-section"><SectionHeading title="Typography" badge={<SourceBadge source="dom" />} /><Properties values={element.typography} /><p className="fine-print">Computed font family may differ from the font used for individual glyphs.</p></section>
      <section className="report-section"><SectionHeading title="Dimensions & spacing" badge={<SourceBadge source="dom" />} /><BoxModel element={element} /><h3>Rendered geometry</h3><Properties values={Object.fromEntries(Object.entries(element.rect).map(([key, value]) => [key, `${value}px`]))} /><h3>Computed spacing</h3><Properties values={element.spacing} /><h3>CSS dimensions & geometry</h3><Properties values={element.geometry} /><p className="fine-print">Rendered bounds include transforms. CSS dimensions follow the browser's computed style and box sizing. Original declarations are not available.</p></section>
      <section className="report-section"><SectionHeading title="Layout" badge={<SourceBadge source="dom" />} /><Properties values={element.layout} />{Object.keys(element.parentLayout).length > 0 && <details className="property-details"><summary>Parent layout</summary><Properties values={element.parentLayout} /></details>}</section>
      <section className="report-section"><SectionHeading title="Appearance" badge={<SourceBadge source="dom" />} /><Properties values={element.appearance} /></section>
      {element.pseudoElements.length > 0 && <section className="report-section"><SectionHeading title="Pseudo-elements" badge={<SourceBadge source="dom" />} />{element.pseudoElements.map((pseudo) => <details className="property-details" key={pseudo.pseudo}><summary>{pseudo.pseudo}</summary><Properties values={pseudo.properties} /></details>)}</section>}
      <section className="report-section"><SectionHeading title="Measurement notes" /><TextList items={element.limitations} /><CopyButton text={() => designMarkdown(report)} label="Copy design specs" /></section>
    </>}
    {report.mode === 'ghost' && report.palette.length > 0 && <section className="ai-next"><div><h2>Understand the experience</h2><p>Review UX patterns and possible product behavior with optional AI analysis.</p></div><button className="text-button accent" type="button" onClick={() => usePanel.getState().set({ selectedTab: 'insights' })}>Product & UX Insights <ArrowRight size={14} /></button><p className="fine-print">No image has been sent automatically.</p></section>}
  </>;
}
