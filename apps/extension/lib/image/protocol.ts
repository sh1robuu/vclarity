import type { OptimizedImage, PaletteColor, Rect, Viewport } from '@vclarity/shared';

export interface ProcessRequest { id: string; dataUrl: string; region: Rect; viewport: Viewport }
export interface ProcessResult { palette: PaletteColor[]; image: OptimizedImage; previewBlob: Blob; computationMs: number }
export type ProcessResponse = { id: string; ok: true; result: ProcessResult } | { id: string; ok: false; error: string };
