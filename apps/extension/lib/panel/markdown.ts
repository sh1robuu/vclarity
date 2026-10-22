import type { Analysis, ElementSpecs, PaletteColor, Report } from '@vclarity/shared';

// All model and website content is text. Escape Markdown structure in copy output.
const plain = (value: string | number): string => String(value).replace(/\r\n?/g, '\n').replace(/([\\`*_{}[\]<>#|!])/g, '\\$1').replace(/\n/g, ' ');
const line = (name: string, value: string | number | null): string => `- ${plain(name)}: ${value === null ? 'Unknown / unavailable' : plain(value)}`;
const group = (title: string, values: Record<string, string | null>): string => `### ${title}\n\n${Object.entries(values).map(([name, value]) => line(name, value)).join('\n') || 'No values available.'}`;
const bullets = (items: string[]): string => items.length ? items.map((item) => `- ${plain(item)}`).join('\n') : '- None identified from available evidence.';

export function paletteMarkdown(palette: PaletteColor[]): string {
  return `### Color Palette\n\nSource: Measured (Pixels) — Local Pixel Analysis. Coverage is approximate; these are screenshot colors, not authored CSS tokens.\n\n${palette.length ? palette.map((color) => `- ${color.rank}. ${color.hex} — RGB(${color.rgb.join(', ')}) — approximately ${color.coverage}% — ${color.source}`).join('\n') : 'No local pixel palette available.'}\n\nPhotographs, gradients, illustrations, and antialiasing can influence dominant colors.`;
}

export function elementMarkdown(element: ElementSpecs): string {
  return [
    `### Selected Element\n\n${line('Element', element.tag)}\n${line('Selector', element.selector)}\n${line('Role', element.role)}\n\nSource: Exact (DOM). Browser-computed values and rendered geometry; original authored declarations are unavailable.`,
    `### Rendered Geometry\n\n${Object.entries(element.rect).map(([name, value]) => line(name, `${value}px`)).join('\n')}`,
    group('Typography', element.typography), group('Appearance', element.appearance), group('Spacing', element.spacing),
    group('CSS Dimensions & Geometry', element.geometry), group('Layout', element.layout), group('Parent Layout', element.parentLayout),
    ...element.pseudoElements.map((pseudo) => group(`Pseudo-element ${plain(pseudo.pseudo)}`, pseudo.properties)),
    `### Measurement Limitations\n\n${bullets(element.limitations)}`,
  ].join('\n\n');
}

export function designMarkdown(report: Report): string {
  return `## Design Specs\n\n${report.element ? elementMarkdown(report.element) : 'No DOM element measured for this region. Font, layout, and spacing values cannot be confirmed from pixels alone.'}\n\n${paletteMarkdown(report.palette)}`;
}

export function uxMarkdown(analysis: Analysis | null): string {
  if (!analysis) return '## UX Analysis\n\nAI analysis has not been completed.';
  return `## UX Analysis\n\nSource: Estimated (AI). Visual interpretations require validation.\n\n${analysis.uxInsights.length ? analysis.uxInsights.map((insight) => [
    `### ${plain(insight.title)}`, `Classification: ${insight.classification} — Confidence: ${insight.confidence}`,
    line('Finding', insight.finding), line('Evidence', insight.evidence), line('UX principle', insight.principle),
    line('Impact', insight.impact), line('Recommendation', insight.recommendation),
  ].join('\n\n')).join('\n\n') : 'No evidence-supported UX findings returned.'}`;
}

export function productMarkdown(analysis: Analysis | null): string {
  if (!analysis) return '## Product Logic\n\nAI analysis has not been completed.';
  const product = analysis.productInsights;
  return [
    '## Product Logic', 'Source: Estimated (AI). Inferred behavior is not verified product functionality.',
    `### ${plain(product.featureName)}\n\nApparent purpose (inferred): ${plain(product.purpose)}`,
    `### Observed UI Elements\n\n${bullets(product.observedElements)}`,
    `### Observed States\n\n${bullets(product.observedStates)}`,
    `### Inferred Behaviors\n\n${product.inferredBehaviors.length ? product.inferredBehaviors.map((item) => `- ${plain(item.behavior)}\n  - Evidence: ${plain(item.evidence)}\n  - Confidence: ${item.confidence}`).join('\n') : '- No supported behavioral inferences returned.'}`,
    `### Unknowns\n\n${bullets(product.unknowns)}`,
    `### Validation Questions\n\n${bullets(product.validationQuestions)}`,
  ].join('\n\n');
}

export function reportMarkdown(report: Report): string {
  return [
    '# Vclarity Inspection',
    `Source: ${plain(report.url)}\n\nAnalysis type: ${report.mode === 'live' ? 'Live Inspect' : 'Ghost Inspect'}\n\nCaptured: ${plain(report.capturedAt)}\n\nStatus: ${plain(report.status)}`,
    ...(report.region ? [`Selected region (CSS pixels): x=${report.region.x}, y=${report.region.y}, width=${report.region.width}, height=${report.region.height}`] : []),
    ...(report.analysis ? [`## Summary\n\n${plain(report.analysis.summary)}`] : []),
    designMarkdown(report), uxMarkdown(report.analysis), productMarkdown(report.analysis),
    '## Evidence & Confidence\n\n- Exact (DOM): browser-measured computed CSS and rendered geometry; not original stylesheet declarations.\n- Measured (Pixels): local dominant screenshot colors with approximate area coverage.\n- Estimated (AI): observations and inferences based on the selected image; confidence does not establish verified behavior.',
    `## Analysis Limitations\n\n${report.analysis ? bullets(report.analysis.limitations) : '- AI analysis has not been completed.'}`,
    ...(report.error ? [`## Error\n\n${plain(report.error)}`] : []),
  ].join('\n\n');
}
