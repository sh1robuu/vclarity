import type { PaletteColor } from '@vclarity/shared';
import { samplingDimensions } from './crop';

export type RGB = [number, number, number];
export type OKLab = [number, number, number];
export const PALETTE_SAMPLE_BUDGET = 12_000;
export const DISTINCT_COLOR_DISTANCE = 0.055;

const linear = Float64Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

/** OKLab gives an inexpensive perceptual distance for sRGB screenshot pixels. */
export function rgbToOKLab([r, g, b]: RGB): OKLab {
  const red = linear[Math.min(255, Math.max(0, Math.round(r)))]!;
  const green = linear[Math.min(255, Math.max(0, Math.round(g)))]!;
  const blue = linear[Math.min(255, Math.max(0, Math.round(b)))]!;
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function colorDistanceSquared(a: OKLab, b: OKLab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function compositeWhite(r: number, g: number, b: number, alpha: number): RGB {
  const opacity = Math.min(255, Math.max(0, alpha)) / 255;
  return [Math.round(r * opacity + 255 * (1 - opacity)), Math.round(g * opacity + 255 * (1 - opacity)), Math.round(b * opacity + 255 * (1 - opacity))];
}

export function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

interface Bucket { count: number; r: number; g: number; b: number; lab: OKLab }

/**
 * Stratified sampling → 5-bit RGB histogram → weighted OKLab k-means → merge
 * near-identical groups. The displayed top five retain their actual sampled
 * coverage, so their percentages can sum to less than 100% on busy imagery.
 */
export function extractPalette(pixels: Uint8ClampedArray, width: number, height: number, budget = PALETTE_SAMPLE_BUDGET): PaletteColor[] {
  const sample = samplingDimensions(width, height, budget);
  if (pixels.length !== width * height * 4) throw new Error('Pixel data does not match the image dimensions.');
  const counts = new Uint32Array(32_768);
  const red = new Uint32Array(32_768);
  const green = new Uint32Array(32_768);
  const blue = new Uint32Array(32_768);
  for (let sy = 0; sy < sample.height; sy++) {
    const y = Math.min(height - 1, Math.floor((sy + 0.5) * height / sample.height));
    for (let sx = 0; sx < sample.width; sx++) {
      const x = Math.min(width - 1, Math.floor((sx + 0.5) * width / sample.width));
      const offset = (y * width + x) * 4;
      const [r, g, b] = compositeWhite(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!);
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts[bin] = counts[bin]! + 1;
      red[bin] = red[bin]! + r;
      green[bin] = green[bin]! + g;
      blue[bin] = blue[bin]! + b;
    }
  }
  const buckets: Bucket[] = [];
  for (let bin = 0; bin < counts.length; bin++) {
    const count = counts[bin]!;
    if (count === 0) continue;
    const r = red[bin]! / count, g = green[bin]! / count, b = blue[bin]! / count;
    buckets.push({ count, r, g, b, lab: rgbToOKLab([r, g, b]) });
  }
  buckets.sort((a, b) => b.count - a.count);
  const centers: OKLab[] = [buckets[0]!.lab];
  const nearest = new Float64Array(buckets.length).fill(Infinity);
  // Extra working clusters preserve a smaller saturated accent alongside broad
  // gradient/background groups. Only the five largest final groups are returned.
  const clusterCount = Math.min(12, buckets.length);
  while (centers.length < clusterCount) {
    let bestIndex = -1, bestScore = 0;
    const last = centers[centers.length - 1]!;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      nearest[i] = Math.min(nearest[i]!, colorDistanceSquared(bucket.lab, last));
      const score = nearest[i]! * bucket.count;
      if (score > bestScore && nearest[i]! > 0.000004) { bestIndex = i; bestScore = score; }
    }
    if (bestIndex < 0) break;
    centers.push([...buckets[bestIndex]!.lab]);
  }
  const assignment = new Int16Array(buckets.length).fill(-1);
  let clusters: Bucket[] = [];
  for (let iteration = 0; iteration < 7; iteration++) {
    clusters = centers.map(() => ({ count: 0, r: 0, g: 0, b: 0, lab: [0, 0, 0] }));
    let changed = false;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      let closest = 0, distance = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const candidate = colorDistanceSquared(bucket.lab, centers[j]!);
        if (candidate < distance) { closest = j; distance = candidate; }
      }
      if (assignment[i] !== closest) changed = true;
      assignment[i] = closest;
      const cluster = clusters[closest]!;
      cluster.count += bucket.count;
      cluster.r += bucket.r * bucket.count;
      cluster.g += bucket.g * bucket.count;
      cluster.b += bucket.b * bucket.count;
      for (let k = 0; k < 3; k++) cluster.lab[k] = cluster.lab[k]! + bucket.lab[k]! * bucket.count;
    }
    for (let j = 0; j < clusters.length; j++) {
      const cluster = clusters[j]!;
      if (cluster.count > 0) {
        cluster.r /= cluster.count; cluster.g /= cluster.count; cluster.b /= cluster.count;
        cluster.lab = cluster.lab.map((value) => value / cluster.count) as OKLab;
        centers[j] = cluster.lab;
      }
    }
    if (!changed) break;
  }
  clusters = clusters.filter((cluster) => cluster.count > 0);
  while (clusters.length > 1) {
    let first = -1, second = -1, closest = DISTINCT_COLOR_DISTANCE ** 2;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const distance = colorDistanceSquared(clusters[i]!.lab, clusters[j]!.lab);
      if (distance < closest) { closest = distance; first = i; second = j; }
    }
    if (first < 0) break;
    const a = clusters[first]!, b = clusters[second]!;
    const count = a.count + b.count;
    a.r = (a.r * a.count + b.r * b.count) / count;
    a.g = (a.g * a.count + b.g * b.count) / count;
    a.b = (a.b * a.count + b.b * b.count) / count;
    a.lab = a.lab.map((value, index) => (value * a.count + b.lab[index]! * b.count) / count) as OKLab;
    a.count = count;
    clusters.splice(second, 1);
  }
  return clusters.sort((a, b) => b.count - a.count).slice(0, 5).map((cluster, index) => {
    const rgb: RGB = [Math.round(cluster.r), Math.round(cluster.g), Math.round(cluster.b)];
    return { hex: rgbToHex(rgb), rgb, coverage: Math.round(cluster.count / (sample.width * sample.height) * 1000) / 10,
      rank: index + 1, source: 'Measured (Pixels)' };
  });
}
