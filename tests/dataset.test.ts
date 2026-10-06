/**
 * The local dataset as a real, truthfully-labelled demo path.
 *
 * The central honesty claim of this feature is that a dataset photograph can
 * become a REAL input to a real inspection without ever being presented as
 * something this application captured on the operator's site. These tests
 * exercise that claim against a REAL temporary dataset folder built here, so
 * they do not depend on the untracked `sample/` directory being present.
 *
 * `LOCAL_DATASET` is a third source alongside UPLOAD and DEMO_FIXTURE. That
 * distinction is load-bearing: folding a dataset image into either existing case
 * would let a photograph from a Wikimedia archive be shown next to a synthetic
 * fixture with no indication of which is which.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  importDatasetCapture,
  readDatasetIndex,
  LOCAL_DATASET_LABEL,
} from '../src/dataset.ts';
import { normalizeOrientation, readImageGeometry } from '../src/image-metadata.ts';
import { ProjectStore } from '../src/projects.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';

/** A real PNG, so the dataset reader parses an actual header. */
function png(width: number, height: number): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let i = 0; i < raw.length; i += 1) raw[i] = 0x40;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const crcTable = ((): number[] => {
    const table: number[] = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table.push(c >>> 0);
    }
    return table;
  })();
  const crc32 = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A JPEG whose bytes start with an Exif orientation 6 tag. */
function orientationSixJpeg(width: number, height: number): Buffer {
  const EXIF_ID = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const tiff = Buffer.alloc(8);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(0x002a, 2);
  tiff.writeUInt32BE(8, 4);
  const ifd = Buffer.alloc(2 + 12 + 4);
  ifd.writeUInt16BE(1, 0);
  ifd.writeUInt16BE(0x0112, 2);
  ifd.writeUInt16BE(3, 4);
  ifd.writeUInt32BE(1, 6);
  ifd.writeUInt16BE(6, 10);
  ifd.writeUInt32BE(0, 14);
  const payload = Buffer.concat([EXIF_ID, tiff, ifd]);
  const exifSeg = Buffer.alloc(2);
  exifSeg.writeUInt16BE(payload.length + 2, 0);

  // SOF0: marker (0xFF 0xC0) then length (2), precision (1), height (2),
  // width (2), component count (1). No separate length buffer: writing one
  // would insert two padding bytes and shift every dimension by two.
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(11, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3;

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]), exifSeg, payload,
    Buffer.from([0xff, 0xc0]), sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/**
 * A valid JPEG over the measured endpoint ceiling.
 *
 * Built from many COM segments because a JPEG segment length is 16-bit, so a
 * single one can only carry 65535 bytes. The file stays a structurally valid
 * JPEG: marker, length, free-form payload, repeated until the size is reached.
 */
function oversizedJpeg(targetBytes: number): Buffer {
  const base = orientationSixJpeg(200, 100);
  const sofIndex = base.indexOf(Buffer.from([0xff, 0xc0]));
  const head = base.subarray(0, sofIndex);
  const tail = base.subarray(sofIndex);

  const chunks: Buffer[] = [head];
  let written = head.length;
  const chunk = Math.min(65000, targetBytes - head.length);
  while (written < targetBytes) {
    const size = Math.min(chunk, targetBytes - written);
    const payload = Buffer.alloc(size, 0x20);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(size + 2, 0);
    chunks.push(Buffer.from([0xff, 0xfe]), len, payload);
    written += size + 4;
  }
  chunks.push(tail);
  return Buffer.concat(chunks);
}

/** Build a throwaway dataset directory; returns its path and a cleanup fn. */
function tempDataset(files: Record<string, Buffer>): { dir: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-dataset-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(dir, name), bytes);
  }
  return {
    dir,
    env: { SITELENS_DATASET_DIR: dir } as NodeJS.ProcessEnv,
    cleanup: () => { rmSync(dir, { recursive: true, force: true }); },
  };
}

test('an absent dataset is reported as absent, not as an error', () => {
  const index = readDatasetIndex({ SITELENS_DATASET_DIR: join(tmpdir(), 'no-such-dataset-xyz') });
  assert.equal(index.present, false);
  assert.equal(index.entries.length, 0);
  assert.match(index.note, /No local dataset found/);
  // The note must tell the operator the product still works without it.
  assert.match(index.note, /runs without it/);
});

test('the index parses ids, titles and sizes from filenames', () => {
  const fixture = tempDataset({
    '021-exterior-rebar-welding-track-a-approach.jpg': png(40, 30),
    '022-exterior-rebar-worker-tie-detail.jpg': png(60, 45),
    'README.md': Buffer.from('# dataset notes'),
  });
  try {
    const index = readDatasetIndex(fixture.env);
    assert.equal(index.present, true);
    assert.equal(index.entries.length, 2, 'markdown is not an image and must be skipped');
    assert.deepEqual(index.entries.map((e) => e.id), ['021', '022']);
    assert.equal(index.entries[0]?.title, 'exterior rebar welding track a approach');
    assert.equal(index.entries[0]?.width, 40);
    assert.equal(index.entries[0]?.hero, true, '021 is documented as a hero pick');
  } finally {
    fixture.cleanup();
  }
});

test('an unreadable image is counted and skipped, not fatal', () => {
  const fixture = tempDataset({
    '001-broken.jpg': Buffer.from('this is not a jpeg'),
    '002-fine.jpg': png(20, 20),
  });
  try {
    const index = readDatasetIndex(fixture.env);
    assert.equal(index.entries.length, 1, 'one good file still loads');
    assert.equal(index.unreadable, 1);
    assert.equal(index.entries[0]?.id, '002');
  } finally {
    fixture.cleanup();
  }
});

test('import produces a real capture labelled as a local dataset image', () => {
  const fixture = tempDataset({
    '022-exterior-rebar-worker-tie-detail.jpg': png(120, 90),
  });
  try {
    const result = importDatasetCapture('022', fixture.env);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Real bytes, readable geometry: this is a genuine input to a real run.
    assert.ok(result.capture.bytes.length > 0);
    assert.equal(result.capture.mediaType, 'image/jpeg');
    assert.deepEqual(result.capture.dimensions, { width: 120, height: 90 });
    assert.match(result.capture.label, /^022 — exterior rebar worker tie detail$/);

    // ...and it says, in its own content, what it is NOT.
    assert.match(result.capture.content, /genuine photograph of real construction work/);
    assert.match(result.capture.content, /NOT captured on this project's site/);
  } finally {
    fixture.cleanup();
  }
});

test('import normalizes EXIF orientation and records the original', () => {
  const fixture = tempDataset({
    '021-exterior-rebar-welding-track-a-approach.jpg': orientationSixJpeg(200, 100),
  });
  try {
    const result = importDatasetCapture('021', fixture.env);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.entry.exifOrientation, 6, 'the source orientation is preserved');
    assert.equal(result.entry.geometryNormalized, true);
    assert.equal(result.capture.geometryNormalized, true);

    // The bytes the application holds now carry orientation 1, so the model,
    // the browser and the overlay cannot disagree.
    assert.equal(readImageGeometry(result.capture.bytes)?.orientation, 1);
    assert.deepEqual(result.capture.dimensions, { width: 200, height: 100 });
    assert.match(result.capture.content, /EXIF orientation 6/);
    assert.match(result.capture.content, /one coordinate system/);

    // And normalization is genuinely applied, not merely declared.
    assert.equal(result.capture.bytes.equals(normalizeOrientation(result.capture.bytes)), true);
  } finally {
    fixture.cleanup();
  }
});

test('an unknown or malformed dataset id is refused without touching disk', () => {
  const fixture = tempDataset({ '022-exterior-rebar-worker-tie-detail.jpg': png(30, 30) });
  try {
    for (const bad of ['999', '022x', '', '../../etc/passwd', '../secret', 'not-an-id']) {
      const result = importDatasetCapture(bad, fixture.env);
      assert.equal(result.ok, false, `id ${JSON.stringify(bad)} must be refused`);
      if (!result.ok) assert.equal(result.reason, 'NOT_FOUND');
    }
  } finally {
    fixture.cleanup();
  }
});

test('a dataset capture is a THIRD source, never an upload or a fixture', () => {
  const fixture = tempDataset({ '022-exterior-rebar-worker-tie-detail.jpg': png(50, 40) });
  try {
    const store = new ProjectStore({
      provider: new DemoFixtureProvider(),
      zoneId: 'zone_level_02',
      reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
    });
    store.seedDemoProject('Demo', 'Somewhere');
    const imported = importDatasetCapture('022', fixture.env);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const stored = store.addCapture({
      ...imported.capture,
      source: 'LOCAL_DATASET',
      bytesPath: imported.entry.filename,
      bytesRelativeToDataset: true,
    });

    assert.equal(stored.source, 'LOCAL_DATASET');
    assert.equal(stored.projectId, store.activeProject()?.id);
    assert.equal(stored.bytesRelativeToDataset, true);
    assert.equal(stored.bytesPath, '022-exterior-rebar-worker-tie-detail.jpg');
    assert.equal(LOCAL_DATASET_LABEL, 'LOCAL DATASET');

    // It is owned by the active project exactly like any other capture.
    assert.ok(store.capturesOf(stored.projectId).some((c) => c.id === stored.id));
    assert.equal(store.activeCapture(stored.id).ok, true);
  } finally {
    fixture.cleanup();
  }
});

test('an over-ceiling dataset image is refused with the real limit named', () => {
  // MAX_PROVIDER_IMAGE_BYTES is measured from the live endpoint: 9.2 MB is
  // accepted, 15.9 MB is rejected. This file is over the 10 MB ceiling.
  const fixture = tempDataset({
    '023-exterior-rebar-mat-slab-crew.jpg': oversizedJpeg(11 * 1024 * 1024),
  });
  try {
    const index = readDatasetIndex(fixture.env);
    assert.equal(index.entries.length, 1);
    // Marked up front so the browser can show it as unavailable.
    assert.equal(index.entries[0]?.inspectable, false);

    const result = importDatasetCapture('023', fixture.env);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'TOO_LARGE');
      assert.match(result.message, /accepts up to 10 MB/);
    }
  } finally {
    fixture.cleanup();
  }
});
