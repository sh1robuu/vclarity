import type { Analysis, OptimizedImage } from '@vclarity/shared';

/** Implement this boundary to add another vision provider without changing routes. */
export interface VisionProvider {
  analyze(image: OptimizedImage, signal: AbortSignal): Promise<Analysis>;
}
