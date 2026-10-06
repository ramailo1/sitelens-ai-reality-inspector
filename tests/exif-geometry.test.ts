/**
 * EXIF orientation: one coordinate system for model, display and overlay.
 *
 * The defect these guard against is concrete and was measured. Five images in
 * the local dataset (`007`, `009`, `015`, `017`, `021`) store landscape pixels
 * tagged EXIF orientation 6, meaning they are meant to be read portrait. Three
 * coordinate systems then disagreed — the model's normalized box, the pixels the
 * browser paints, and the overlay drawn on top — so evidence pointed at the wrong
 * part of the photograph.
 *
 * The strategy is normalization, not CSS rotation: rewrite the orientation tag
 * to 1 before the bytes leave the process. A file that says "no rotation" cannot
 * be rotated by anyone, so all three systems are one array by construction. These
 * tests build synthetic JPEGs with known orientation tags rather than depending
 * on the untracked dataset being present.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOrientation,
  orientationSwapsAxes,
  readExifOrientation,
  readImageGeometry,
  toPixelBox,
  transformBox,
} from '../src/image-metadata.ts';

/** "Exif" then two NUL bytes, built from codes so no escape is involved. */
const EXIF_ID = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);

/** JFIF APP0 identifier: "JFIF" then a NUL, as real files carry it. */
const JFIF_ID = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00]);

/**
 * Build a minimal JPEG carrying a real APP1/Exif block.
 *
 * `orientation` is written into IFD0 tag 0x0112, so these bytes go through the
 * same TIFF walk a real camera file does. Big-endian ("MM") throughout.
 *
 * `jfif` inserts the JFIF APP0 that many real files carry BEFORE the Exif block.
 * `021` is exactly that case and was the image the original scan missed.
 */
function jpegWithOrientation(
  orientation: number | null,
  width = 200,
  height = 100,
  jfif = false,
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];

  if (jfif) {
    // A JPEG marker segment is marker (2 bytes) then length (2 bytes) then the
    // payload, with NO padding. A 4-byte length field would insert two NULs and
    // shift the Exif block, which is exactly the sort of malformed fixture that
    // makes a correct parser look broken.
    const seg = Buffer.alloc(2);
    seg.writeUInt16BE(JFIF_ID.length + 2, 0);
    parts.push(Buffer.from([0xff, 0xe0]), seg, JFIF_ID);
  }

  if (orientation !== null) {
    const tiffHeader = Buffer.alloc(8);
    tiffHeader.write('MM', 0, 'latin1');
    tiffHeader.writeUInt16BE(0x002a, 2);
    tiffHeader.writeUInt32BE(8, 4); // IFD0 starts right after the TIFF header

    // IFD0: 2-byte entry count, then one 12-byte entry, then a 4-byte
    // "no next IFD" pointer. Inside an entry the layout is
    //   tag (2) | type (2) | count (4) | value-or-offset (4)
    // so the orientation value lives 10 bytes into `ifd`.
    const ifd = Buffer.alloc(2 + 12 + 4);
    ifd.writeUInt16BE(1, 0); // one entry
    ifd.writeUInt16BE(0x0112, 2); // entry 0: tag = Orientation
    ifd.writeUInt16BE(3, 4); // entry 0: type = SHORT
    ifd.writeUInt32BE(1, 6); // entry 0: count = 1
    ifd.writeUInt16BE(orientation, 10); // entry 0: value, left-aligned
    ifd.writeUInt32BE(0, 14); // no next IFD

    const payload = Buffer.concat([EXIF_ID, tiffHeader, ifd]);
    const seg = Buffer.alloc(2);
    seg.writeUInt16BE(payload.length + 2, 0);
    parts.push(Buffer.from([0xff, 0xe1]), seg, payload);
  }

  // SOF0 carrying the real frame size, which is what the geometry reader uses.
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(11, 0);
  sof[2] = 8; // 8-bit precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3; // component count
  parts.push(Buffer.from([0xff, 0xc0]), sof);
  parts.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(parts);
}

test('reads orientation from a plain Exif block', () => {
  assert.equal(readExifOrientation(jpegWithOrientation(6)), 6);
  assert.equal(readExifOrientation(jpegWithOrientation(3)), 3);
  assert.equal(readExifOrientation(jpegWithOrientation(8)), 8);
});

test('walks past a JFIF APP0 to find the Exif block', () => {
  // The regression that mattered: `021` has JFIF first, so a parser that only
  // inspected the first segment reported orientation 1 for an image the dataset
  // documents as orientation 6.
  const bytes = jpegWithOrientation(6, 200, 100, true);
  assert.equal(readExifOrientation(bytes), 6);
  assert.equal(readImageGeometry(bytes)?.orientation, 6);
});

test('a file with no Exif block reports orientation 1', () => {
  assert.equal(readExifOrientation(jpegWithOrientation(null)), 1);
  assert.equal(readExifOrientation(Buffer.alloc(0)), 1);
  assert.equal(readExifOrientation(Buffer.from('not an image')), 1);
});

test('an out-of-range or hostile orientation is not trusted', () => {
  for (const bogus of [0, 9, 99, 65535]) {
    assert.equal(readExifOrientation(jpegWithOrientation(bogus)), 1, `orientation ${bogus}`);
  }
});

test('geometry reports stored and displayed sizes, and normalizes the axes', () => {
  const portrait = readImageGeometry(jpegWithOrientation(6, 200, 100));
  assert.ok(portrait);
  // Stored landscape, displayed portrait: the size the dataset docs report.
  assert.deepEqual(portrait.stored, { width: 200, height: 100 });
  assert.deepEqual(portrait.displayed, { width: 100, height: 200 });
  assert.equal(portrait.normalized, false);

  // A 180 degree rotation keeps the axes but flips the frame.
  const rotated = readImageGeometry(jpegWithOrientation(3, 200, 100));
  assert.ok(rotated);
  assert.deepEqual(rotated.displayed, { width: 200, height: 100 });
});

test('orientation 1 means the file is already normalized', () => {
  const plain = readImageGeometry(jpegWithOrientation(1, 200, 100));
  assert.ok(plain);
  assert.equal(plain.normalized, true);
  assert.deepEqual(plain.displayed, plain.stored);
});

test('normalizeOrientation rewrites the tag and changes nothing else', () => {
  const original = jpegWithOrientation(6, 200, 100);
  const normalized = normalizeOrientation(original);

  assert.equal(readExifOrientation(normalized), 1);
  // Byte length is preserved and the input is not mutated, which is what proves
  // no pixel was re-encoded: only the two-byte tag value changed.
  assert.equal(normalized.length, original.length);
  assert.equal(readExifOrientation(original), 6, 'input must not be mutated');
  assert.equal(normalized.equals(original), false);

  let differing = 0;
  for (let i = 0; i < original.length; i += 1) {
    if (original[i] !== normalized[i]) differing += 1;
  }
  assert.ok(differing <= 2, `only the orientation value may change, saw ${differing} bytes differ`);
});

test('normalizeOrientation is a no-op for an already-normalized file', () => {
  const plain = jpegWithOrientation(1, 200, 100);
  assert.equal(normalizeOrientation(plain), plain);
  const none = jpegWithOrientation(null, 200, 100);
  assert.equal(normalizeOrientation(none), none);
});

test('after normalization, stored and displayed geometry are identical', () => {
  // This is the invariant the whole evidence overlay rests on: once normalized,
  // the model's box, the painted pixels and the overlay share one frame.
  const normalized = normalizeOrientation(jpegWithOrientation(6, 200, 100));
  const geometry = readImageGeometry(normalized);
  assert.ok(geometry);
  assert.equal(geometry.orientation, 1);
  assert.equal(geometry.normalized, true);
  assert.deepEqual(geometry.stored, geometry.displayed);
});

test('orientationSwapsAxes matches the EXIF specification', () => {
  for (const o of [5, 6, 7, 8] as const) assert.equal(orientationSwapsAxes(o), true, `o${o}`);
  for (const o of [1, 2, 3, 4] as const) assert.equal(orientationSwapsAxes(o), false, `o${o}`);
});

test('transformBox maps a stored-space box into displayed space', () => {
  const stored = { width: 200, height: 100 };
  // Top-left quadrant of the stored frame.
  const box = { x: 0, y: 0, width: 0.5, height: 0.5 };

  // Orientation 1: identity.
  assert.deepEqual(transformBox(box, stored, 1), { x: 0, y: 0, width: 100, height: 50 });

  // Orientation 6 (rotate 90 CW): rotating clockwise sends the stored top row
  // to the displayed right column, so the stored top-LEFT quadrant lands in the
  // displayed bottom-RIGHT quadrant, with the axes swapped.
  const rotated = transformBox(box, stored, 6);
  assert.deepEqual(rotated, { x: 50, y: 0, width: 50, height: 100 });

  // Orientation 8 (rotate 270 CW): stored top-left becomes displayed top-right.
  assert.deepEqual(transformBox(box, stored, 8), { x: 0, y: 100, width: 50, height: 100 });

  // 180 degrees: opposite corner, same axes.
  assert.deepEqual(transformBox(box, stored, 3), { x: 100, y: 50, width: 100, height: 50 });
});

test('transformBox keeps every corner inside the displayed frame', () => {
  const stored = { width: 200, height: 100 };
  const extremes = [
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0.1, height: 0.1 },
    { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
  ];
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const displayedWidth = orientationSwapsAxes(orientation) ? 100 : 200;
    const displayedHeight = orientationSwapsAxes(orientation) ? 200 : 100;
    for (const box of extremes) {
      const t = transformBox(box, stored, orientation);
      assert.ok(t.x >= -1e-9, `x ${t.x} for o${orientation}`);
      assert.ok(t.y >= -1e-9, `y ${t.y} for o${orientation}`);
      assert.ok(t.x + t.width <= displayedWidth + 1e-9, `right edge for o${orientation}`);
      assert.ok(t.y + t.height <= displayedHeight + 1e-9, `bottom edge for o${orientation}`);
    }
  }
});

test('toPixelBox refuses a box that encloses no area', () => {
  // The placeholder the vision model emits. It is structurally valid and it
  // points at nothing, so it must not make a finding claim to be localised.
  const dimensions = { width: 4752, height: 3168 };
  assert.equal(toPixelBox({ x: 0, y: 0, width: 0, height: 0 }, dimensions), null);
  assert.equal(toPixelBox({ x: 0.2, y: 0.2, width: 0, height: 0.4 }, dimensions), null);
  assert.equal(toPixelBox({ x: 0.2, y: 0.2, width: 0.4, height: 0 }, dimensions), null);
});

test('toPixelBox still projects a real box onto the normalized frame', () => {
  const box = toPixelBox({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, { width: 400, height: 200 });
  assert.deepEqual(box, { left: 100, top: 100, width: 200, height: 50 });
});
