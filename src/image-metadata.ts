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
 *
 * EXIF ORIENTATION
 *
 * A JPEG may store its pixels rotated relative to how a viewer displays them,
 * recording the relationship in EXIF tag 0x0112 (Orientation). Five images in
 * the local validation dataset (`007`, `009`, `015`, `017`, `021`) store
 * LANDSCAPE pixels that are meant to be read as PORTRAIT.
 *
 * That matters here because three coordinate systems have to agree:
 *
 *     MODEL COORDINATES  ->  DISPLAYED IMAGE  ->  EVIDENCE OVERLAY
 *
 * and a model reading a raw JPEG is under no obligation to apply the rotation.
 * Some decoding pipelines transpose, most do not, and we cannot observe which
 * happened from here. Guessing either way would put evidence boxes on the wrong
 * axes, so this module does not guess.
 *
 * Instead there is exactly ONE geometry: `normalizeOrientation` rewrites the
 * orientation tag to 1 before the bytes ever leave the process. A file that
 * says "no rotation" cannot be rotated by anyone, so stored pixels, model
 * pixels and displayed pixels are the same array by construction. The ORIGINAL
 * orientation is still reported in the capture provenance, so nothing is hidden.
 *
 * `transformBox` exists so the axis mapping is executable and testable rather
 * than folklore; it is the transform the normalization makes unnecessary.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/** EXIF tag 0x0112. Values 1-8; anything else is treated as 1 (no rotation). */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const ORIENTATION_TAG = 0x0112;

/**
 * The six-byte Exif block identifier: ASCII "Exif" then two NUL bytes.
 *
 * Built from character codes rather than written as a literal so the source
 * carries no control characters.
 */
const EXIF_IDENTIFIER: Buffer = Buffer.from([
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
]);

/** Everything needed to keep model, display and overlay on one coordinate system. */
export interface ImageGeometry {
  /** Pixels exactly as encoded in the file. */
  readonly stored: ImageDimensions;
  /** Pixels after the EXIF orientation is applied, i.e. what a viewer shows. */
  readonly displayed: ImageDimensions;
  /** The orientation recorded in the file. 1 means no rotation. */
  readonly orientation: ExifOrientation;
  /** True when the bytes already carry orientation 1, so normalization is a no-op. */
  readonly normalized: boolean;
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
 * Locate the APP1/Exif payload.
 *
 * Returns the offset of the TIFF header that follows the `Exif\0\0` identifier,
 * or null when the file carries no Exif block.
 *
 * The JPEG marker chain is walked rather than assuming Exif is the first
 * segment: a JFIF APP0 commonly precedes it, which is exactly the layout of
 * `021` in the local dataset. Only that first APP1 whose payload really begins
 * with the Exif identifier is accepted, so an unrelated APP1 (XMP, ICC, or a
 * nested thumbnail) can never be mistaken for the orientation record.
 *
 * The walk is bounded by the buffer length and bails on a declared length below
 * 2, so a corrupt header can never loop or read out of bounds.
 */
function findExifTiffOffset(bytes: Buffer): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    // Start of scan: everything after it is entropy-coded image data.
    if (marker === 0xda) return null;
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const declared = bytes.readUInt16BE(offset + 2);
    if (declared < 2) return null;
    const payloadStart = offset + 4;
    const payloadEnd = Math.min(bytes.length, offset + 2 + declared);

    if (
      marker === 0xe1 &&
      payloadStart + 6 <= payloadEnd &&
      bytes.subarray(payloadStart, payloadStart + 6).equals(EXIF_IDENTIFIER)
    ) {
      return payloadStart + 6;
    }

    offset = offset + 2 + declared;
  }
  return null;
}

/**
 * Resolve the byte offset of the Orientation tag's value field.
 *
 * TIFF allows either byte order. Only IFD0 is consulted: that is where the
 * orientation lives, and walking into EXIF sub-IFDs would be parsing far more
 * than this product needs in order to fix one number.
 */
function findOrientationValueOffset(bytes: Buffer): number | null {
  const tiff = findExifTiffOffset(bytes);
  if (tiff === null || tiff + 8 > bytes.length) return null;

  const order = bytes.subarray(tiff, tiff + 2).toString('latin1');
  let little: boolean;
  if (order === 'II') little = true;
  else if (order === 'MM') little = false;
  else return null;
  // TIFF magic 42, then the 4-byte offset of IFD0.
  if (bytes.readUInt16BE(tiff + 2) !== 0x002a) return null;

  const read32 = (at: number): number =>
    little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  const read16 = (at: number): number =>
    little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);

  const ifd = tiff + read32(tiff + 4);
  if (ifd + 2 > bytes.length) return null;
  const entries = read16(ifd);

  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) return null;
    if (read16(entry) !== ORIENTATION_TAG) continue;
    // Type 3 is SHORT. Anything else is not the orientation we understand, so
    // the tag is reported as absent rather than reinterpreted.
    if (read16(entry + 2) !== 3) return null;
    // A SHORT is left-aligned inside the 4-byte value field.
    return entry + 8;
  }
  return null;
}

/**
 * Read the EXIF orientation recorded in a JPEG.
 *
 * Returns 1 when there is no orientation, no Exif block, or the tag cannot be
 * read. 1 is the safe answer: it means "no rotation", which is what the byte
 * stream itself says.
 */
export function readExifOrientation(bytes: Buffer): ExifOrientation {
  if (!Buffer.isBuffer(bytes)) return 1;
  try {
    const valueOffset = findOrientationValueOffset(bytes);
    if (valueOffset === null) return 1;
    const raw = bytes.readUInt16BE(valueOffset);
    return isExifOrientation(raw) ? raw : 1;
  } catch {
    // A truncated or hostile header must not take down the caller.
    return 1;
  }
}

function isExifOrientation(value: number): value is ExifOrientation {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

/**
 * Rewrite the EXIF orientation tag to 1, leaving every pixel untouched.
 *
 * This is the single normalization that makes the model, the display and the
 * evidence overlay agree. Only the two-byte value field of tag 0x0112 is
 * written; the entropy-coded scan data and every other EXIF tag are left exactly
 * as they were, so no re-encoding is involved and no pixel can change.
 *
 * Returns the bytes UNCHANGED when there is nothing to normalize (no Exif, no
 * orientation tag, already 1, or a container we do not parse).
 */
export function normalizeOrientation(bytes: Buffer): Buffer {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return bytes;
  if (readExifOrientation(bytes) === 1) return bytes;

  try {
    const valueOffset = findOrientationValueOffset(bytes);
    if (valueOffset === null) return bytes;
    const copy = Buffer.from(bytes);
    copy.writeUInt16BE(1, valueOffset);
    return copy;
  } catch {
    return bytes;
  }
}

/** True when the axes are swapped by this orientation, i.e. the display is portrait. */
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

/**
 * Map a normalized box from STORED pixel space into DISPLAYED pixel space.
 *
 * Provided so the axis relationship is executable and covered by a test rather
 * than assumed. The live path does not need it: `normalizeOrientation` removes
 * the rotation upstream so there is only ever one space.
 */
export function transformBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  stored: ImageDimensions,
  orientation: ExifOrientation,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const W = stored.width;
  const H = stored.height;
  // Normalized to stored-pixel coordinates, then rotated about the frame.
  const left = box.x * W;
  const top = box.y * H;
  const width = box.width * W;
  const height = box.height * H;

  switch (orientation) {
    case 2: // mirror horizontal
      return { x: W - left - width, y: top, width, height };
    case 3: // rotate 180
      return { x: W - left - width, y: H - top - height, width, height };
    case 4: // mirror vertical
      return { x: left, y: H - top - height, width, height };
    case 5: // transpose: stored landscape read as portrait
      return { x: top, y: left, width: height, height: width };
    case 6: // rotate 90 CW
      return { x: H - top - height, y: left, width: height, height: width };
    case 7: // transverse
      return { x: H - top - height, y: W - left - width, width: height, height: width };
    case 8: // rotate 270 CW
      return { x: top, y: W - left - width, width: height, height: width };
    default:
      return { x: left, y: top, width, height };
  }
}

/**
 * Read stored size, EXIF orientation and displayed size in one pass.
 *
 * Null when the container header is unreadable; the caller then has no geometry
 * at all and must decline to draw anything.
 */
export function readImageGeometry(bytes: Buffer): ImageGeometry | null {
  const stored = readImageDimensions(bytes);
  if (stored === null) return null;
  const orientation = readExifOrientation(bytes);
  const swaps = orientationSwapsAxes(orientation);
  return {
    stored,
    displayed: swaps
      ? { width: stored.height, height: stored.width }
      : { width: stored.width, height: stored.height },
    orientation,
    normalized: orientation === 1,
  };
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
  // A box that encloses no area is not a localisation. Models emit
  // {x:0,y:0,width:0,height:0} as a placeholder when they decline to point at
  // anything, and a zero-area rectangle cannot indicate anything on screen.
  // Defence in depth: the validators already normalise these away, but this is
  // the function that decides whether a finding reports itself as localised, so
  // the check belongs here too.
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    left: Math.round(box.x * dimensions.width),
    top: Math.round(box.y * dimensions.height),
    width: Math.round(box.width * dimensions.width),
    height: Math.round(box.height * dimensions.height),
  };
}