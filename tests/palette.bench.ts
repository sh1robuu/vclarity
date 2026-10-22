import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { extractPalette } from '../apps/extension/lib/image/palette';

// Allocate and generate pixels outside timed sections. A deterministic mixture of
// UI panels, text-like stripes, gradients and photograph-like noise exercises
// clustering without using a captured website or exposing private image content.
function fixture(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let seed = 42;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const at = (y * width + x) * 4;
    const noise = seed & 255;
    const stripe = y % 24 < 4 && x > width * 0.1 && x < width * 0.65;
    const color = stripe ? [20, 28, 40] : x < width * 0.6 ? [247, 248, 250]
      : x < width * 0.8 ? [Math.round(x / width * 255), 88, 210] : [noise, (noise * 7) % 256, (noise * 13) % 256];
    pixels.set([...color, 255], at);
  }
  return pixels;
}

console.log(`Palette computation benchmark | ${process.version} | ${platform()} ${arch()} | ${cpus()[0]?.model ?? 'unknown CPU'}`);
console.log('12,000 sampled pixels maximum; no decoding, screenshot capture, image readback, compression or network included.');
console.log('Times are measured evidence for this host; the under-50ms target is not a universal guarantee.');
for (const [label, width, height] of [['small', 320, 200], ['medium', 1280, 800], ['large', 3840, 2160]] as const) {
  const pixels = fixture(width, height);
  for (let warmup = 0; warmup < 8; warmup++) extractPalette(pixels, width, height);
  const timings: number[] = [];
  for (let run = 0; run < 40; run++) {
    const start = performance.now();
    extractPalette(pixels, width, height);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)]!;
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1]!;
  console.log(`${label.padEnd(6)} ${width} × ${height}: median ${median.toFixed(2)}ms; p95 ${p95.toFixed(2)}ms; ${p95 < 50 ? 'target met' : 'above target'}`);
}
