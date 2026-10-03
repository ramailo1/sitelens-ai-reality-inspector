/**
 * Image metadata.
 *
 * Bounding boxes arrive from the model in normalized [0,1] space. To draw
 * evidence over the image, the renderer needs the real pixel dimensions, so
 * they are read from the file header rather than guessed or hard-coded.
 *
 * Only PNG and JPEG are supported: those are the formats the provider accepts,
 * and adding more parsers would widen the attack surface without product
 * benefit. An unreadable header yields null dimensions and the UI then declines
 * to draw a box, instead of inventing a position.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read dimensions from PNG or JPEG bytes.
 *
 * Returns null when the format is unsupported or the header is malformed or
 * truncated. Callers must treat null as "no geometry available".
 */
export function readImageDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24) return null;

  const png = readPng(bytes);
  if (png) return png;

  return readJpeg(bytes);
}

function readPng(bytes: Buffer): ImageDimensions | null {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // IHDR is required to be the first chunk: 8-byte signature, then an 8-byte
  // length/type pair, then width and height as big-endian uint32.
  if (bytes.length < 24) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

function readJpeg(bytes: Buffer): ImageDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    // Segments are 0xFF marker, 2-byte big-endian length, then payload.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] as number;
    // Start-of-frame markers carry the dimensions and exclude the
    // sample-length byte that other segments have.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = bytes.readUInt16BE(offset + 2);

    if (isSof) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Project a normalized box onto a concrete pixel rectangle.
 *
 * Returns null when there is no box or no geometry, so the caller can render
 * the observation as non-localized rather than implying a position it cannot
 * justify.
 */
export function toPixelBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
  dimensions: ImageDimensions | null,
): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null {
  if (!box || !dimensions) return null;
  if (dimensions.width <= 0 || dimensions.height <= 0) return null;
  return {
    left: Math.round(box.x * dimensions.width),
    top: Math.round(box.y * dimensions.height),
    width: Math.round(box.width * dimensions.width),
    height: Math.round(box.height * dimensions.height),
  };
}