import { z } from 'zod';

/** Encoded screenshots must fit the same pixel budget in the extension and API. */
export const MAX_ENCODED_IMAGE_PIXELS = 16_777_216;

const text = z.string().min(1).max(4000);
const confidence = z.enum(['high', 'medium', 'low']);
export const analysisSchema = z.object({
  summary: text,
  uxInsights: z.array(z.object({
    id: z.string().min(1).max(80), title: text, finding: text, evidence: text,
    principle: text.nullable(), impact: text, recommendation: text.nullable(),
    classification: z.enum(['observed', 'inferred']), confidence,
  }).strict()).max(12),
  productInsights: z.object({
    featureName: text, purpose: text,
    observedElements: z.array(text).max(20), observedStates: z.array(text).max(20),
    inferredBehaviors: z.array(z.object({ behavior: text, evidence: text, confidence }).strict()).max(12),
    unknowns: z.array(text).max(15), validationQuestions: z.array(text).max(15),
  }).strict(),
  limitations: z.array(text).max(15),
}).strict();
export type Analysis = z.infer<typeof analysisSchema>;

export const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict();
export type Rect = z.infer<typeof rectSchema>;
export const viewportSchema = z.object({
  width: z.number().positive(), height: z.number().positive(), scrollX: z.number(), scrollY: z.number(),
  devicePixelRatio: z.number().positive(), visualOffsetX: z.number(), visualOffsetY: z.number(), visualScale: z.number().positive(),
}).strict();
export type Viewport = z.infer<typeof viewportSchema>;
const values = z.record(z.string().max(80), z.string().max(4000).nullable());
export const elementSchema = z.object({
  tag: z.string().max(100), selector: z.string().max(500), role: z.string().max(100).nullable(),
  rect: rectSchema, typography: values, appearance: values, spacing: values, geometry: values, layout: values,
  parentLayout: values, pseudoElements: z.array(z.object({ pseudo: z.string(), properties: values }).strict()).max(2),
  limitations: z.array(z.string().max(1000)).max(20), source: z.literal('Exact (DOM)'),
}).strict();
export type ElementSpecs = z.infer<typeof elementSchema>;
export const paletteColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/), rgb: z.tuple([z.number(), z.number(), z.number()]),
  coverage: z.number().min(0).max(100), rank: z.number().int().min(1).max(5), source: z.literal('Measured (Pixels)'),
}).strict();
export type PaletteColor = z.infer<typeof paletteColorSchema>;
export const optimizedImageSchema = z.object({
  dataUrl: z.string().max(3_000_000), mimeType: z.enum(['image/webp', 'image/jpeg']),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192),
  originalWidth: z.number().int().positive(), originalHeight: z.number().int().positive(),
  bytes: z.number().int().positive().max(2_000_000), targetMet: z.boolean(), warning: z.string().nullable(),
}).strict();
export type OptimizedImage = z.infer<typeof optimizedImageSchema>;
export const analysisRequestSchema = z.object({ requestId: z.string().uuid(), image: optimizedImageSchema }).strict();
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export const analysisResponseSchema = z.object({ requestId: z.string().uuid(), analysis: analysisSchema }).strict();
export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }).strict() }).strict();

export const workflowSchema = z.enum(['idle', 'live-inspecting', 'element-selected', 'ghost-selecting', 'capturing', 'local-processing', 'local-ready', 'ai-analyzing', 'completed', 'ai-error', 'local-error', 'cancelled']);
export type Workflow = z.infer<typeof workflowSchema>;
export const reportSchema = z.object({
  tabId: z.number().int(), sessionId: z.string().uuid(), requestId: z.string().uuid().nullable(),
  url: z.string().max(2000), capturedAt: z.string(), mode: z.enum(['live', 'ghost']),
  status: workflowSchema, element: elementSchema.nullable(), palette: z.array(paletteColorSchema).max(5),
  analysis: analysisSchema.nullable(), region: rectSchema.nullable(), error: z.string().nullable(),
}).strict();
export type Report = z.infer<typeof reportSchema>;

export const panelCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_CONTEXT'), windowId: z.number().int() }).strict(),
  z.object({ type: z.literal('START'), tabId: z.number().int(), mode: z.enum(['live', 'ghost']) }).strict(),
  z.object({ type: z.literal('CANCEL'), tabId: z.number().int(), sessionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('PROCESSING'), tabId: z.number().int(), sessionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('LOCAL_RESULT'), tabId: z.number().int(), sessionId: z.string().uuid(), palette: z.array(paletteColorSchema).max(5) }).strict(),
  z.object({ type: z.literal('AI_START'), tabId: z.number().int(), sessionId: z.string().uuid(), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('AI_RESULT'), tabId: z.number().int(), sessionId: z.string().uuid(), requestId: z.string().uuid(), analysis: analysisSchema }).strict(),
  z.object({ type: z.literal('FAIL'), tabId: z.number().int(), sessionId: z.string().uuid(), requestId: z.string().uuid().nullable(), message: z.string().max(1000) }).strict(),
]);
export type PanelCommand = z.infer<typeof panelCommandSchema>;
export const contentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ELEMENT_SELECTED'), sessionId: z.string().uuid(), element: elementSchema }).strict(),
  z.object({ type: z.literal('REGION_SELECTED'), sessionId: z.string().uuid(), region: rectSchema, viewport: viewportSchema }).strict(),
  z.object({ type: z.literal('SELECTION_CANCELLED'), sessionId: z.string().uuid(), reason: z.string().max(500) }).strict(),
]);
export type ContentEvent = z.infer<typeof contentEventSchema>;
export const inspectorCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PING') }).strict(),
  z.object({ type: z.literal('INSPECT'), mode: z.enum(['live', 'ghost']), sessionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('STOP') }).strict(),
  z.object({ type: z.literal('VERIFY_VIEWPORT'), viewport: viewportSchema }).strict(),
]);
export type InspectorCommand = z.infer<typeof inspectorCommandSchema>;
export type BackgroundEvent =
  | { type: 'CONTEXT'; windowId: number; tabId: number; url: string; report: Report | null }
  | { type: 'REPORT'; report: Report }
  | { type: 'CAPTURE'; windowId: number; tabId: number; sessionId: string; dataUrl: string; region: Rect; viewport: Viewport };
export type CommandResult = { ok: true; report?: Report | null; tabId?: number; url?: string } | { ok: false; error: string };

const transitions: Record<Workflow, readonly Workflow[]> = {
  idle: ['live-inspecting', 'ghost-selecting'],
  'live-inspecting': ['element-selected', 'cancelled', 'local-error'],
  'element-selected': [],
  'ghost-selecting': ['capturing', 'cancelled', 'local-error'],
  capturing: ['local-processing', 'local-error', 'cancelled'],
  'local-processing': ['local-ready', 'local-error', 'cancelled'],
  'local-ready': ['ai-analyzing', 'cancelled'],
  'ai-analyzing': ['completed', 'ai-error', 'cancelled'],
  completed: ['ai-analyzing'], 'ai-error': ['ai-analyzing'], 'local-error': [], cancelled: [],
};
export function transition(report: Report, status: Workflow): Report {
  if (!transitions[report.status].includes(status)) throw new Error(`Invalid workflow transition: ${report.status} → ${status}`);
  return { ...report, status, error: null };
}
export function isCurrent(report: Report | null | undefined, sessionId: string, requestId?: string): report is Report {
  return !!report && report.sessionId === sessionId && (requestId === undefined || report.requestId === requestId);
}

/** Local configuration metadata only; neither provider authentication nor inference is tested. */
export const connectionInfoSchema = z.object({
  provider: z.enum(['openai', 'ollama', 'gemini']),
  model: z.string().min(1).max(200),
  aiConfigured: z.boolean(),
  imageAnalysisSupported: z.boolean().nullable(),
}).strict();
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>;
