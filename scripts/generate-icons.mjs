import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

// Reproduce with: node scripts/generate-icons.mjs
// The SVG master uses three rotated rounded rectangles, matching the sidebar V.
// This intentionally small rasterizer supports that native vector subset and
// needs neither an image service nor third-party image-processing dependencies.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'apps/extension/public/icons');
const master = await readFile(resolve(directory, 'icon.svg'), 'utf8');
assert.match(master, /viewBox="0 0 32 32"/, 'The master must retain its 32 × 32 coordinate system.');
const rectangles = [...master.matchAll(/<rect\s+([^>]+)\/>/g)].map((match) => {
  const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
  const rotation = /^rotate\((-?[\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(attributes.transform);
  assert(rotation, 'Each rectangle must specify rotate(angle centerX centerY).');
  assert.match(attributes.fill, /^#[\dA-Fa-f]{6}$/);
  const degrees = Number(rotation[1]) * Math.PI / 180;
  const rectangle = {
    x: Number(attributes.x), y: Number(attributes.y), width: Number(attributes.width), height: Number(attributes.height),
    radius: Number(attributes.rx), cx: Number(rotation[2]), cy: Number(rotation[3]),
    cosine: Math.cos(degrees), sine: Math.sin(degrees),
    color: [1, 3, 5].map((offset) => Number.parseInt(attributes.fill.slice(offset, offset + 2), 16)),
  };
  assert(Object.entries(rectangle).filter(([key]) => key !== 'color').every(([, value]) => Number.isFinite(value)), 'Invalid rectangle attributes.');
  assert(rectangle.width > 0 && rectangle.height > 0 && rectangle.radius >= 0);
  return rectangle;
});
assert.equal(rectangles.length, 3, 'Expected the three-stroke Vclarity mark.');

function contains(rectangle, x, y) {
  // Inverse SVG rotation followed by a rounded-rectangle signed-distance test.
  const dx = x - rectangle.cx, dy = y - rectangle.cy;
  const localX = rectangle.cosine * dx + rectangle.sine * dy + rectangle.cx;
  const localY = -rectangle.sine * dx + rectangle.cosine * dy + rectangle.cy;
  const qx = Math.abs(localX - rectangle.x - rectangle.width / 2) - rectangle.width / 2 + rectangle.radius;
  const qy = Math.abs(localY - rectangle.y - rectangle.height / 2) - rectangle.height / 2 + rectangle.radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= rectangle.radius;
}

function rasterize(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const supersampling = 8;
  const samplesPerPixel = supersampling ** 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let red = 0, green = 0, blue = 0, covered = 0;
    for (let sy = 0; sy < supersampling; sy++) for (let sx = 0; sx < supersampling; sx++) {
      const px = (x + (sx + 0.5) / supersampling) * 32 / size;
      const py = (y + (sy + 0.5) / supersampling) * 32 / size;
      let color = null;
      for (const rectangle of rectangles) if (contains(rectangle, px, py)) color = rectangle.color;
      if (color) { red += color[0]; green += color[1]; blue += color[2]; covered++; }
    }
    const offset = (y * size + x) * 4;
    if (covered) {
      pixels[offset] = Math.round(red / covered);
      pixels[offset + 1] = Math.round(green / covered);
      pixels[offset + 2] = Math.round(blue / covered);
      pixels[offset + 3] = Math.round(255 * covered / samplesPerPixel);
    }
  }
  return pixels;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let crc = initial;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(name, contents) {
  const type = Buffer.from(name, 'ascii');
  const output = Buffer.alloc(contents.length + 12);
  output.writeUInt32BE(contents.length, 0);
  type.copy(output, 4);
  contents.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, contents])), contents.length + 8);
  return output;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA, non-interlaced.
  const scanlines = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) pixels.copy(scanlines, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function validatePng(bytes, size) {
  assert(bytes.subarray(0, 8).equals(signature), 'Invalid PNG signature.');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), size);
  assert.equal(bytes.readUInt32BE(20), size);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6);
  let offset = 8;
  const compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(bytes.subarray(offset + 4, offset + 8 + length)), `Invalid ${type} CRC.`);
    if (type === 'IDAT') compressed.push(payload);
    offset += length + 12;
  }
  assert.equal(offset, bytes.length);
  assert.equal(inflateSync(Buffer.concat(compressed)).length, size * (size * 4 + 1));
  assert.equal(bytes.toString('ascii', bytes.length - 8, bytes.length - 4), 'IEND');
}

await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const output = png(size, rasterize(size));
  validatePng(output, size);
  const destination = resolve(directory, `${size}.png`);
  await writeFile(destination, output);
  validatePng(await readFile(destination), size);
  console.log(`Validated ${size} × ${size} RGBA PNG: ${destination} (${output.length} bytes)`);
}
