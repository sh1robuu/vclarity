/** Decode locally without fetch(), which is governed by extension connect-src. */
export function captureBlob(dataUrl: string): Blob {
  const prefix = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(dataUrl);
  if (!prefix || dataUrl.length > 64_000_000) throw new Error('The captured image has an invalid encoding. Capture the region again.');
  try {
    const binary = atob(dataUrl.slice(prefix[0].length));
    if (binary.length === 0) throw new Error('Empty image.');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: prefix[1] });
  } catch { throw new Error('The captured image has an invalid encoding. Capture the region again.'); }
}
