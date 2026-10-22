import type { Rect, Viewport } from '@vclarity/shared';

/** Coordinates are layout-viewport CSS pixels, never document/scroll coordinates. */
export function bitmapCrop(region: Rect, viewport: Viewport, bitmapWidth: number, bitmapHeight: number): Rect {
  const numbers = [region.x, region.y, region.width, region.height, viewport.width, viewport.height,
    viewport.visualOffsetX, viewport.visualOffsetY, viewport.visualScale, bitmapWidth, bitmapHeight];
  if (!numbers.every(Number.isFinite) || region.width <= 0 || region.height <= 0 ||
      viewport.width <= 0 || viewport.height <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) {
    throw new Error('The selected region or screenshot has invalid dimensions. Select the region again.');
  }
  // Desktop browser zoom is reflected in the bitmap/viewport ratio. Pinch zoom changes
  // the screenshot viewport in ways captureVisibleTab does not specify consistently.
  if (Math.abs(viewport.visualScale - 1) > 0.001) {
    throw new Error('Pinch zoom is not supported for region capture. Reset visual zoom and select again.');
  }
  const scaleX = bitmapWidth / viewport.width;
  const scaleY = bitmapHeight / viewport.height;
  if (Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > 0.025) {
    throw new Error('The viewport changed before capture. Keep the page still and select the region again.');
  }
  const left = Math.max(0, region.x - viewport.visualOffsetX);
  const top = Math.max(0, region.y - viewport.visualOffsetY);
  const right = Math.min(viewport.width, region.x + region.width - viewport.visualOffsetX);
  const bottom = Math.min(viewport.height, region.y + region.height - viewport.visualOffsetY);
  if (right <= left || bottom <= top) throw new Error('The selected region is outside the captured viewport. Select again.');
  // Round outward so fractional CSS coordinates never lose the final pixel row.
  const x = Math.min(bitmapWidth, Math.max(0, Math.floor(left * scaleX)));
  const y = Math.min(bitmapHeight, Math.max(0, Math.floor(top * scaleY)));
  const endX = Math.min(bitmapWidth, Math.ceil(right * scaleX));
  const endY = Math.min(bitmapHeight, Math.ceil(bottom * scaleY));
  if (endX - x < 2 || endY - y < 2) throw new Error('The captured region is too small. Select a larger area.');
  return { x, y, width: endX - x, height: endY - y };
}

/** A bounded nearest-neighbor sample avoids averaging unrelated neighboring colors. */
export function samplingDimensions(width: number, height: number, budget = 12_000): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isInteger(budget) || budget < 1) {
    throw new Error('Invalid pixel sampling dimensions.');
  }
  if (width * height <= budget) return { width, height };
  const factor = Math.sqrt(budget / (width * height));
  let sampledWidth = Math.max(1, Math.min(width, Math.floor(width * factor)));
  let sampledHeight = Math.max(1, Math.min(height, Math.floor(height * factor)));
  // Handle extremely thin images, where clamping one dimension can exceed budget.
  if (sampledWidth * sampledHeight > budget) {
    if (sampledWidth > sampledHeight) sampledWidth = Math.max(1, Math.floor(budget / sampledHeight));
    else sampledHeight = Math.max(1, Math.floor(budget / sampledWidth));
  }
  return { width: sampledWidth, height: sampledHeight };
}
