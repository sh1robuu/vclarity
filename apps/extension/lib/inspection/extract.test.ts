import { describe, expect, it } from 'vitest';
import { cssValue, measuredRect } from './extract';
import { normalizeRegion, sameViewport } from './controller';
describe('measurement and selection geometry', () => {
  it('preserves fractional computed values without inventing unavailable properties', () => {
    expect(cssValue(' 12.125px ')).toBe('12.125px');
    expect(cssValue('')).toBeNull();
    expect(cssValue('auto')).toBe('auto');
  });
  it('preserves rendered transformed fractional geometry', () => {
    expect(measuredRect({ x: -4.5, y: 7, width: 123.456, height: 9.5 } as DOMRect)).toEqual({ x: -4.5, y: 7, width: 123.456, height: 9.5 });
    expect(() => measuredRect({ width: 0, height: 2 } as DOMRect)).toThrow();
  });
  it.each([[10, 20, 100, 80], [100, 80, 10, 20], [10, 80, 100, 20], [100, 20, 10, 80]])('normalizes drag direction %s,%s → %s,%s', (x, y, ex, ey) => {
    expect(normalizeRegion({ x, y }, { x: ex, y: ey }, 1000, 1000)).toEqual({ x: 10, y: 20, width: 90, height: 60 });
  });
  it('clips selection boundaries and rejects tiny regions', () => {
    expect(normalizeRegion({ x: -20, y: -10 }, { x: 120, y: 100 }, 100, 80)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(normalizeRegion({ x: 0, y: 0 }, { x: 7, y: 50 }, 100, 80)).toBeNull();
  });
  it('detects scroll, viewport and scale changes', () => {
    const viewport = { width: 1000, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 };
    expect(sameViewport(viewport, { ...viewport })).toBe(true);
    expect(sameViewport(viewport, { ...viewport, scrollY: 10 })).toBe(false);
    expect(sameViewport(viewport, { ...viewport, visualScale: 1.5 })).toBe(false);
  });
});
