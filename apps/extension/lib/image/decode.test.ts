import { describe, expect, it, vi } from 'vitest';
import { captureBlob } from './decode';

describe('capture decoding under extension CSP', () => {
  it('decodes base64 directly into a typed blob without a network request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const blob = captureBlob('data:image/png;base64,AQIDBA==');
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it('accepts browser screenshot formats and rejects executable/remote inputs', () => {
    expect(captureBlob('data:image/webp;base64,AQID').type).toBe('image/webp');
    expect(captureBlob('data:image/jpeg;base64,AQID').type).toBe('image/jpeg');
    for (const url of ['https://example.com/pixel.png', 'data:image/svg+xml;base64,AQID', 'data:image/png;base64,', 'data:image/png;base64,%invalid']) {
      expect(() => captureBlob(url)).toThrow('invalid encoding');
    }
  });
});
