import { describe, expect, it, vi } from 'vitest';
import { MAX_ENCODED_IMAGE_PIXELS } from '@vclarity/shared';
import { blobDataUrl, chooseEncoding, compressionCandidates, IMAGE_TARGET_BYTES } from './optimize';

function encoded(bytes: number, type = 'image/webp'): Blob { return new Blob([new Uint8Array(bytes)], { type }); }

describe('readability-preserving compression controls', () => {
  it('never resizes small text regions and keeps a resolution/quality floor', () => {
    expect(compressionCandidates(600, 400).every((candidate) => candidate.width === 600 && candidate.height === 400)).toBe(true);
    const large = compressionCandidates(2000, 1200);
    expect(large[0]).toEqual({ width: 2000, height: 1200, quality: 0.9 });
    expect(large.every((candidate) => candidate.width >= 1500 && candidate.height >= 900 && candidate.quality >= 0.74)).toBe(true);
    expect(() => compressionCandidates(0, 10)).toThrow();
  });
  it('returns immediately when full quality meets the strict size target', async () => {
    const encoder = vi.fn(async () => encoded(IMAGE_TARGET_BYTES - 1));
    const result = await chooseEncoding(600, 400, encoder);
    expect(result.targetMet).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.width).toBe(600);
    expect(encoder).toHaveBeenCalledTimes(1);
  });
  it('fits high-DPI captures to the API pixel budget even when byte size already meets the target', async () => {
    const encoder = vi.fn(async () => encoded(50_000));
    const result = await chooseEncoding(5000, 4000, encoder);
    expect(result.targetMet).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_ENCODED_IMAGE_PIXELS);
    expect(result.width).toBeGreaterThanOrEqual(3750);
    expect(result.height).toBeGreaterThanOrEqual(3000);
    expect(encoder).toHaveBeenCalledTimes(1);
  });
  it('preserves exact supported resolution and never rounds a candidate above the pixel budget', () => {
    expect(compressionCandidates(4096, 4096)[0]).toEqual({ width: 4096, height: 4096, quality: 0.9 });
    for (const [width, height] of [[4097, 4096], [5461, 4096], [7001, 4001]] as const) {
      const candidates = compressionCandidates(width, height);
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate.width * candidate.height).toBeLessThanOrEqual(MAX_ENCODED_IMAGE_PIXELS);
        expect(candidate.width).toBeGreaterThanOrEqual(Math.ceil(width * 0.75));
        expect(candidate.height).toBeGreaterThanOrEqual(Math.ceil(height * 0.75));
      }
    }
  });
  it('rejects regions that cannot fit the API pixel budget without violating the readability floor', async () => {
    const encoder = vi.fn(async () => encoded(50_000));
    await expect(chooseEncoding(8192, 3900, encoder)).rejects.toThrow('Select a smaller area');
    expect(encoder).not.toHaveBeenCalled();
  });
  it('adjusts quality before reducing dimensions', async () => {
    const encoder = vi.fn(async ({ quality }: { quality: number }) => encoded(quality > 0.8 ? 120_000 : 90_000));
    const result = await chooseEncoding(2000, 1200, encoder);
    expect(result.targetMet).toBe(true);
    expect(result.width).toBe(2000);
    expect(encoder.mock.calls.map(([candidate]) => candidate.quality)).toEqual([0.9, 0.82, 0.74]);
  });
  it('uses JPEG if the browser returns PNG for an unsupported WebP codec', async () => {
    const encoder = vi.fn(async (_candidate: unknown, mime: string) => encoded(50_000, mime === 'image/webp' ? 'image/png' : 'image/jpeg'));
    const result = await chooseEncoding(600, 400, encoder);
    expect(result.mimeType).toBe('image/jpeg');
    expect(encoder).toHaveBeenCalledTimes(2);
  });
  it('returns a controlled warning instead of destroying legibility to meet 100 KB', async () => {
    const encoder = vi.fn(async (_candidate: unknown, mime: string) => encoded(150_000, mime));
    const result = await chooseEncoding(600, 400, encoder);
    expect(result.targetMet).toBe(false);
    expect(result.blob.size).toBe(150_000);
    expect(result.warning).toContain('Readable detail was preserved');
    expect(result.width).toBe(600);
  });
  it('rejects excessive payloads and reports unavailable codecs', async () => {
    await expect(chooseEncoding(600, 400, async (_candidate, mime) => encoded(2_000_001, mime))).rejects.toThrow('too detailed');
    await expect(chooseEncoding(600, 400, async () => { throw new Error('unsupported'); })).rejects.toThrow('could not encode');
  });
  it('produces correct base64 without retaining source metadata', async () => {
    expect(await blobDataUrl(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })))
      .toBe('data:image/webp;base64,AQIDBA==');
  });
});
