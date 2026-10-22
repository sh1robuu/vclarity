import { describe, expect, it } from 'vitest';
import { analysisSchema, elementSchema, reportSchema, type Report } from '@vclarity/shared';
import { designMarkdown, productMarkdown, reportMarkdown, uxMarkdown } from './markdown';

const element = elementSchema.parse({
  tag: 'BUTTON', selector: 'main > button', role: 'button', rect: { x: 12.5, y: 20, width: 142.75, height: 38 },
  typography: { 'font-family': 'Inter, sans-serif', 'font-size': '13.25px' }, appearance: { 'background-color': 'rgb(54, 92, 245)' },
  spacing: { 'padding-top': '8px' }, geometry: { 'css-width': '120px', 'box-sizing': 'content-box' }, layout: { display: 'block' },
  parentLayout: { display: 'flex' }, pseudoElements: [], limitations: ['Original authored declarations are unavailable.'], source: 'Exact (DOM)',
});
const analysis = analysisSchema.parse({
  summary: 'The region shows a search form.', uxInsights: [{ id: '1', title: 'Clear primary action', finding: 'Search appears emphasized.', evidence: 'A filled button appears below the field.', principle: null, impact: 'May support discovery.', recommendation: null, classification: 'inferred', confidence: 'medium' }],
  productInsights: { featureName: 'Search', purpose: 'May locate records.', observedElements: ['A search field and button.'], observedStates: ['The button is disabled.'], inferredBehaviors: [{ behavior: 'Typing may enable the button.', evidence: 'The field appears empty beside a disabled button.', confidence: 'low' }], unknowns: ['Server-side validation is unknown.'], validationQuestions: ['Does Enter submit the search?'] }, limitations: ['A single screenshot does not demonstrate behavior.'],
});
const report: Report = reportSchema.parse({ tabId: 1, sessionId: 'e57c3349-7bd7-47ec-936d-9f7f71362042', requestId: null, url: 'https://example.com/path', capturedAt: '2026-10-22T00:00:00.000Z', mode: 'live', status: 'element-selected', element, palette: [{ hex: '#365CF5', rgb: [54, 92, 245], coverage: 65.2, rank: 1, source: 'Measured (Pixels)' }], analysis, region: null, error: null });

describe('portable Markdown notes', () => {
  it('preserves exact fractional geometry independently from computed CSS dimensions', () => {
    const note = designMarkdown(report);
    expect(note).toContain('width: 142.75px');
    expect(note).toContain('css-width: 120px');
    expect(note).toContain('font-size: 13.25px');
    expect(note).toContain('Source: Exact (DOM)');
    expect(note).toContain('Measured (Pixels)');
    expect(note).toContain('approximately 65.2%');
  });
  it('preserves confidence, observed states, unknowns, and validation questions', () => {
    expect(uxMarkdown(analysis)).toContain('Classification: inferred — Confidence: medium');
    const note = productMarkdown(analysis);
    expect(note).toContain('Observed States');
    expect(note).toContain('The button is disabled.');
    expect(note).toContain('Confidence: low');
    expect(note).toContain('Server-side validation is unknown.');
    expect(note).toContain('Does Enter submit the search?');
  });
  it('is deterministic and records source, timestamp, limitations, and missing AI explicitly', () => {
    expect(reportMarkdown(report)).toBe(reportMarkdown(report));
    const note = reportMarkdown({ ...report, analysis: null });
    expect(note).toContain('2026-10-22T00:00:00.000Z');
    expect(note).toContain('https://example.com/path');
    expect(note).toContain('AI analysis has not been completed.');
    expect(note).toContain('not original stylesheet declarations');
  });
  it('escapes untrusted Markdown markup and represents unavailable values honestly', () => {
    const note = designMarkdown({ ...report, element: { ...element, selector: '[click](https://evil.invalid)', role: null } });
    expect(note).toContain('\\[click\\]');
    expect(note).toContain('Role: Unknown / unavailable');
  });
});
