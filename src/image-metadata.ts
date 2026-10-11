// Image metadata. Bounding boxes arrive from the model in normalized [0,1] space.

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

// EXIF tag 0x0112. Values 1-8; anything else is treated as 1 (no rotation).
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const ORIENTATION_TAG = 0x0112;

// The six-byte Exif block identifier: ASCII "Exif" then two NUL bytes.
const EXIF_IDENTIFIER: Buffer = Buffer.from([
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
]);

// Everything needed to keep model, display and overlay on one coordinate system.
export interface ImageGeometry {
  // Pixels exactly as encoded in the file.
  readonly stored: ImageDimensions;
  // Pixels after the EXIF orientation is applied, i.e. what a viewer shows.
  readonly displayed: ImageDimensions;
  // The orientation recorded in the file. 1 means no rotation.
  readonly orientation: ExifOrientation;
  // True when the bytes already carry orientation 1, so normalization is a no-op.
  readonly normalized: boolean;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Read dimensions from PNG or JPEG bytes.
export function readImageDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24) return null;

  const png = readPng(bytes);
  if (png) return png;

  return readJpeg(bytes);
}

function readPng(bytes: Buffer): ImageDimensions | null {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // IHDR is required to be the first chunk: 8-byte signature, then an 8-byte length/type pair, then width and height as.
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
    // Start-of-frame markers carry the dimensions and exclude the sample-length byte that other segments have.
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

// Locate the APP1/Exif payload.
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

// Resolve the byte offset of the Orientation tag's value field.
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
    // Type 3 is SHORT. Anything else is not the orientation we understand, so the tag is reported as absent rather than reinterpreted.
    if (read16(entry + 2) !== 3) return null;
    // A SHORT is left-aligned inside the 4-byte value field.
    return entry + 8;
  }
  return null;
}

// Read the EXIF orientation recorded in a JPEG.
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

// Rewrite the EXIF orientation tag to 1, leaving every pixel untouched.
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

// True when the axes are swapped by this orientation, i.e. the display is portrait.
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

// Map a normalized box from STORED pixel space into DISPLAYED pixel space.
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
    case 2:
      return { x: W - left - width, y: top, width, height };
    case 3:
      return { x: W - left - width, y: H - top - height, width, height };
    case 4:
      return { x: left, y: H - top - height, width, height };
    case 5:
      return { x: top, y: left, width: height, height: width };
    case 6:
      return { x: H - top - height, y: left, width: height, height: width };
    case 7:
      return { x: H - top - height, y: W - left - width, width: height, height: width };
    case 8:
      return { x: top, y: W - left - width, width: height, height: width };
    default:
      return { x: left, y: top, width, height };
  }
}

// Read stored size, EXIF orientation and displayed size in one pass.
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

// Project a normalized box onto a concrete pixel rectangle.
export function toPixelBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
  dimensions: ImageDimensions | null,
): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null {
  if (!box || !dimensions) return null;
  if (dimensions.width <= 0 || dimensions.height <= 0) return null;
  // A box that encloses no area is not a localisation.
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    left: Math.round(box.x * dimensions.width),
    top: Math.round(box.y * dimensions.height),
    width: Math.round(box.width * dimensions.width),
    height: Math.round(box.height * dimensions.height),
  };
}