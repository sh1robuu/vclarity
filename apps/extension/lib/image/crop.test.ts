import { describe, expect, it } from 'vitest';
import type { Viewport } from '@vclarity/shared';
import { bitmapCrop, samplingDimensions } from './crop';

const viewport: Viewport = { width: 1200, height: 800, scrollX: 0, scrollY: 500,
  devicePixelRatio: 2, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 };

describe('screenshot crop mapping', () => {
  it('uses the actual screenshot ratio instead of assuming CSS pixels or DPR', () => {
    expect(bitmapCrop({ x: 100, y: 50, width: 200, height: 100 }, viewport, 1800, 1200))
      .toEqual({ x: 150, y: 75, width: 300, height: 150 });
  });
  it('rounds fractional coordinates outward and clamps all edges', () => {
    expect(bitmapCrop({ x: -5, y: 700.25, width: 1300, height: 200 }, viewport, 2400, 1600))
      .toEqual({ x: 0, y: 1400, width: 2400, height: 200 });
    expect(bitmapCrop({ x: 10.25, y: 20.25, width: 2.5, height: 3.5 }, viewport, 2400, 1600))
      .toEqual({ x: 20, y: 40, width: 6, height: 8 });
  });
  it('maps visual offsets but does not add document scroll offsets to client coordinates', () => {
    const shifted = { ...viewport, visualOffsetX: 20, visualOffsetY: 10, scrollX: 900, scrollY: 2000 };
    expect(bitmapCrop({ x: 100, y: 50, width: 200, height: 100 }, shifted, 2400, 1600))
      .toEqual({ x: 160, y: 80, width: 400, height: 200 });
  });
  it('rejects pinch zoom, a resized viewport, empty crops and malformed inputs', () => {
    const region = { x: 10, y: 10, width: 200, height: 100 };
    expect(() => bitmapCrop(region, { ...viewport, visualScale: 1.5 }, 2400, 1600)).toThrow('Pinch zoom');
    expect(() => bitmapCrop(region, viewport, 2400, 1400)).toThrow('viewport changed');
    expect(() => bitmapCrop({ ...region, x: 1300 }, viewport, 2400, 1600)).toThrow('outside');
    expect(() => bitmapCrop({ ...region, width: 0 }, viewport, 2400, 1600)).toThrow('invalid dimensions');
    expect(() => bitmapCrop({ ...region, x: NaN }, viewport, 2400, 1600)).toThrow('invalid dimensions');
    expect(() => bitmapCrop({ x: 1, y: 1, width: 0.1, height: 0.1 }, viewport, 1200, 800)).toThrow('too small');
  });
});

describe('bounded pixel sampling', () => {
  it('preserves small inputs and caps large and extremely thin inputs', () => {
    expect(samplingDimensions(40, 30)).toEqual({ width: 40, height: 30 });
    for (const [width, height] of [[3840, 2160], [1_000_000, 1], [1, 1_000_000]]) {
      const sample = samplingDimensions(width!, height!);
      expect(sample.width * sample.height).toBeLessThanOrEqual(12_000);
      expect(sample.width).toBeGreaterThanOrEqual(1);
      expect(sample.height).toBeGreaterThanOrEqual(1);
    }
    expect(() => samplingDimensions(0, 10)).toThrow();
    expect(() => samplingDimensions(10, 10, 0)).toThrow();
  });
});
