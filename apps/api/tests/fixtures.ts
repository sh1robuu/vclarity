import type { Analysis, AnalysisRequest, OptimizedImage } from '@vclarity/shared';

// A real 1x1 WebP. Test data only; production has no fallback analysis.
const webpBase64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
export const image: OptimizedImage = {
  dataUrl: `data:image/webp;base64,${webpBase64}`,
  mimeType: 'image/webp', width: 1, height: 1, originalWidth: 1, originalHeight: 1,
  bytes: Buffer.from(webpBase64, 'base64').length, targetMet: true, warning: null,
};
// A real 2x2 JPEG generated locally with System.Drawing, exercising the fallback codec.
const jpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==';
export const jpegImage: OptimizedImage = {
  ...image, dataUrl: `data:image/jpeg;base64,${jpegBase64}`, mimeType: 'image/jpeg',
  width: 2, height: 2, originalWidth: 2, originalHeight: 2, bytes: Buffer.from(jpegBase64, 'base64').length,
};
export const analysis: Analysis = {
  summary: 'A selected interface region with one action.',
  uxInsights: [{ id: 'ux-1', title: 'Action prominence', finding: 'The action appears prominent.',
    evidence: 'A filled button appears at the bottom of the form.', principle: 'Visual hierarchy', impact: 'The next step may be easier to find.',
    recommendation: null, classification: 'inferred', confidence: 'medium' }],
  productInsights: { featureName: 'Form', purpose: 'The form appears to collect a submission.',
    observedElements: ['A button'], observedStates: ['Button appears enabled'],
    inferredBehaviors: [{ behavior: 'The button may submit the form.', evidence: 'The button label reads Submit.', confidence: 'medium' }],
    unknowns: ['Submission behavior has not been tested.'], validationQuestions: ['What happens when the button is activated?'] },
  limitations: ['Only the selected screenshot region is available.'],
};
export const payload: AnalysisRequest = { requestId: '33ac6f28-9019-4bb9-bd6c-a5e3bb978719', image };
export const token = 'local-api-test-token-32-characters-long';
export const origin = `chrome-extension://${'a'.repeat(32)}`;
export const responseEnvelope = (value: unknown = analysis) => ({ status: 'completed', output: [{
  type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }],
}] });
