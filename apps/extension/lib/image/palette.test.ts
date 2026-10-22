import { describe, expect, it } from 'vitest';
import { colorDistanceSquared, compositeWhite, DISTINCT_COLOR_DISTANCE, extractPalette, rgbToHex, rgbToOKLab, type RGB } from './palette';

function blocks(colors: { rgb: RGB; count: number; alpha?: number }[]): Uint8ClampedArray {
  const result = new Uint8ClampedArray(colors.reduce((total, color) => total + color.count, 0) * 4);
  let offset = 0;
  for (const color of colors) for (let i = 0; i < color.count; i++) {
    result.set([...color.rgb, color.alpha ?? 255], offset); offset += 4;
  }
  return result;
}

describe('color conversions', () => {
  it('normalizes HEX and composites alpha over white', () => {
    expect(rgbToHex([0, 15, 255])).toBe('#000FFF');
    expect(compositeWhite(255, 0, 0, 0)).toEqual([255, 255, 255]);
    expect(compositeWhite(255, 0, 0, 128)).toEqual([255, 127, 127]);
    expect(compositeWhite(12, 34, 56, 255)).toEqual([12, 34, 56]);
  });
  it('matches known OKLab primary color values and perceptual ordering', () => {
    const red = rgbToOKLab([255, 0, 0]);
    expect(red[0]).toBeCloseTo(0.627955, 5);
    expect(red[1]).toBeCloseTo(0.224863, 5);
    expect(red[2]).toBeCloseTo(0.125846, 5);
    expect(rgbToOKLab([255, 255, 255])[0]).toBeCloseTo(1, 5);
    expect(rgbToOKLab([0, 0, 0])).toEqual([0, 0, 0]);
    expect(colorDistanceSquared(red, rgbToOKLab([250, 5, 5])))
      .toBeLessThan(colorDistanceSquared(red, rgbToOKLab([0, 0, 255])));
  });
});

describe('dominant screenshot palette', () => {
  it('returns five ranked measured colors with actual sample frequencies', () => {
    const pixels = blocks([
      { rgb: [255, 255, 255], count: 400 }, { rgb: [0, 0, 0], count: 250 },
      { rgb: [255, 0, 0], count: 180 }, { rgb: [0, 255, 0], count: 100 }, { rgb: [0, 0, 255], count: 70 },
    ]);
    const palette = extractPalette(pixels, 100, 10);
    expect(palette.map((color) => color.hex)).toEqual(['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF']);
    expect(palette.map((color) => color.coverage)).toEqual([40, 25, 18, 10, 7]);
    expect(palette.map((color) => color.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(palette.every((color) => color.source === 'Measured (Pixels)')).toBe(true);
  });
  it('merges near-identical antialiased colors without fabricating five swatches', () => {
    const pixels = blocks([{ rgb: [248, 249, 250], count: 200 }, { rgb: [252, 253, 254], count: 200 }, { rgb: [10, 10, 10], count: 100 }]);
    const palette = extractPalette(pixels, 50, 10);
    expect(palette).toHaveLength(2);
    expect(palette[0]!.coverage).toBe(80);
    expect(palette[1]!.coverage).toBe(20);
    expect(colorDistanceSquared(rgbToOKLab(palette[0]!.rgb), rgbToOKLab(palette[1]!.rgb)))
      .toBeGreaterThan(DISTINCT_COLOR_DISTANCE ** 2);
  });
  it('normalizes fully transparent colors to their visible white background', () => {
    const pixels = blocks([{ rgb: [10, 20, 30], count: 30, alpha: 0 }, { rgb: [255, 0, 0], count: 10, alpha: 128 }]);
    expect(extractPalette(pixels, 10, 4).map(({ hex, coverage }) => ({ hex, coverage })))
      .toEqual([{ hex: '#FFFFFF', coverage: 75 }, { hex: '#FF7F7F', coverage: 25 }]);
  });
  it('samples the whole image instead of only its first rows', () => {
    const pixels = blocks([{ rgb: [255, 0, 0], count: 200_000 }, { rgb: [0, 0, 255], count: 200_000 }]);
    const palette = extractPalette(pixels, 1000, 400);
    expect(palette).toHaveLength(2);
    expect(palette.every((color) => Math.abs(color.coverage - 50) < 1)).toBe(true);
    expect(new Set(palette.map((color) => color.hex))).toEqual(new Set(['#FF0000', '#0000FF']));
  });
  it('does not assign omitted colors fake coverage', () => {
    const pixels = blocks([
      { rgb: [0, 0, 0], count: 100 }, { rgb: [255, 255, 255], count: 100 }, { rgb: [255, 0, 0], count: 100 },
      { rgb: [0, 255, 0], count: 100 }, { rgb: [0, 0, 255], count: 100 }, { rgb: [255, 255, 0], count: 100 },
    ]);
    const palette = extractPalette(pixels, 60, 10);
    expect(palette).toHaveLength(5);
    expect(palette.reduce((total, color) => total + color.coverage, 0)).toBeCloseTo(83.5, 1);
  });
  it('rejects mismatched pixel dimensions', () => {
    expect(() => extractPalette(new Uint8ClampedArray(4), 2, 2)).toThrow('does not match');
  });
});
