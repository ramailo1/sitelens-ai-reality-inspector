/**
 * Durable state: what survives a restart, and what must not.
 *
 * The claim this file has to defend is specific. It is not "the app saves
 * things". It is: after a restart, the operator's VERIFIED and REJECTED
 * decisions are still there, and a restored result is never presented as a fresh
 * model call or re-attributed to a model that did not run.
 *
 * A real temporary data directory is used throughout, and the server is actually
 * stopped and a new one started against the same directory, because "the file
 * round-trips" and "the product restores correctly" are different claims.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WorkspacePersistence } from '../src/persistence.ts';
import { readExifOrientation } from '../src/image-metadata.ts';
import { ProjectStore } from '../src/projects.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { demoCaptures } from '../src/captures.ts';

function tempDataDir(): { dir: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-data-'));
  return {
    dir,
    env: { SITELENS_DATA_DIR: dir } as NodeJS.ProcessEnv,
    cleanup: () => { rmSync(dir, { recursive: true, force: true }); },
  };
}

function newStore(env: NodeJS.ProcessEnv): ProjectStore {
  return new ProjectStore({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
    persistence: new WorkspacePersistence({ env }),
  });
}

test('without persistence the store reports process memory honestly', () => {
  const store = new ProjectStore({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
  });
  const storage = store.describeStorage();
  assert.equal(storage.location, 'process memory');
  assert.equal(storage.durable, false);
  assert.match(storage.detail, /lost when the server restarts/i);
  assert.equal(store.hasPersistence(), false);
});

test('with persistence the store reports the real directory', () => {
  const fixture = tempDataDir();
  try {
    const store = newStore(fixture.env);
    const storage = store.describeStorage();
    assert.equal(storage.durable, true);
    assert.ok(existsSync(fixture.dir) || storage.location.includes('sitelens-data-'));
    assert.ok(storage.location.length > 0);
    assert.match(storage.detail, /written to this directory/);
    // And it must say what is NOT persisted, or a restored result could be
    // mistaken for a live inference.
    assert.match(storage.detail, /NOT persisted/);
  } finally {
    fixture.cleanup();
  }
});

test('an explicit directory option is used, not silently ignored', () => {
  // The constructor accepted a `directory` and read only the environment, so a
  // caller passing a temporary directory still wrote to the process default.
  // A test believing it had isolated its writes was in fact reading and
  // overwriting the real one.
  const fixture = tempDataDir();
  const other = tempDataDir();
  try {
    const explicit = new WorkspacePersistence({
      directory: fixture.dir,
      env: { ...process.env, SITELENS_DATA_DIR: other.dir },
    });
    assert.equal(explicit.directory, resolve(fixture.dir),
      'the explicit option must win over the environment');
    assert.equal(explicit.location, resolve(fixture.dir),
      'the reported location must be the directory actually used');

    // And it must really write there, not merely report it.
    const store = new ProjectStore({
      provider: new DemoFixtureProvider(),
      zoneId: 'zone_level_02',
      reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
      persistence: explicit,
    });
    store.seedDemoProject('Isolated', 'Somewhere');
    store.persist();
    assert.ok(existsSync(join(fixture.dir, 'workspace.json')),
      'state must land in the directory the caller named');
    assert.equal(existsSync(join(other.dir, 'workspace.json')), false,
      'the environment directory must not be written when an option overrides it');
  } finally {
    fixture.cleanup();
    other.cleanup();
  }
});

test('the environment is used when no explicit directory is given', () => {
  const fixture = tempDataDir();
  try {
    const fromEnv = new WorkspacePersistence({ env: { ...process.env, SITELENS_DATA_DIR: fixture.dir } });
    assert.equal(fromEnv.directory, resolve(fixture.dir));
  } finally {
    fixture.cleanup();
  }
});

test('a blank explicit directory falls back to the environment rather than the cwd', () => {
  const fixture = tempDataDir();
  try {
    // A blank string is not a directory. Resolving it would silently send every
    // write to the process working directory.
    const store = new WorkspacePersistence({
      directory: '   ',
      env: { ...process.env, SITELENS_DATA_DIR: fixture.dir },
    });
    assert.equal(store.directory, resolve(fixture.dir));
  } finally {
    fixture.cleanup();
  }
});

test('with neither an option nor the environment, the documented default is used', () => {
  const store = new WorkspacePersistence({ env: {} });
  assert.equal(store.directory, resolve('data'), 'the fallback must be the documented data directory');
});

test('a project and its reference survive a restart', () => {
  const fixture = tempDataDir();
  try {
    const first = newStore(fixture.env);
    const created = first.create({ name: 'Tower B', location: 'Level 04' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    first.setReferenceState(created.value.id, {
      zone: 'Custom zone',
      source: 'OPERATOR',
      items: [{ id: 'e1', element: 'SLAB', expectation: 'PRESENT', expectedCount: null, note: 'x' }],
    });

    // The state really is on disk before the "restart".
    const persistence = new WorkspacePersistence({ env: fixture.env });
    assert.ok(existsSync(join(fixture.dir, 'workspace.json')), 'state must be written');

    // A genuinely new store against the same directory: this is the restart.
    // `restore()` MUST come before any seeding: seeding persists, and persisting
    // an empty store would overwrite the state this test is about to prove.
    const second = newStore(fixture.env);
    const report = second.restore();
    if (second.list().length === 0) second.seedDemoProject('Demo', 'Somewhere');

    assert.ok(report.projects >= 1, 'the project must come back');
    const restored = second.list().find((p) => p.name === 'Tower B');
    assert.ok(restored, 'Tower B must exist after restart');
    assert.equal(restored.location, 'Level 04');

    // Its edited reference comes back too, still marked as an operator edit.
    const reference = second.referenceFor(restored.id);
    assert.equal(reference.edited, true);
    assert.equal(reference.state.zone, 'Custom zone');
    assert.equal(reference.state.items.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('an uploaded capture survives a restart WITH its bytes', () => {
  const fixture = tempDataDir();
  try {
    const first = newStore(fixture.env);
    // A REAL project, not the generated demo: the demo is deliberately never
    // persisted, so a capture owned by it could never come back and asserting
    // otherwise would be asserting the wrong thing.
    const created = first.create({ name: 'Tower B', location: 'Level 04' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const bytes = demoCaptures()[0]!.bytes;
    const stored = first.addCapture({
      id: 'cap_upload_persist01',
      label: 'site photo.png',
      bytes,
      mediaType: 'image/png',
      dimensions: { width: 320, height: 240 },
      content: 'Uploaded by the operator.',
      source: 'UPLOAD',
    });
    assert.ok(stored.bytesPath, 'the upload must be written to disk');
    assert.ok(existsSync(stored.bytesPath as string), 'the file must exist');

    const second = newStore(fixture.env);
    const report = second.restore();

    assert.ok(report.projects >= 1, 'the project must come back');
    assert.ok(report.captures >= 1, 'the capture must come back');
    assert.equal(report.skippedCaptures, 0);

    const restored = second.capturesOf(stored.projectId).find((c) => c.id === stored.id);
    assert.ok(restored, 'the upload must be found after restart');
    assert.ok(restored.bytes.length > 0, 'its bytes must be resolvable again');
    assert.equal(restored.bytes.equals(bytes), true, 'the bytes must be identical');
    assert.equal(restored.mediaType, 'image/png');
  } finally {
    fixture.cleanup();
  }
});

test('a capture owned by the un-persisted demo project is skipped, not faked', () => {
  const fixture = tempDataDir();
  try {
    const first = newStore(fixture.env);
    first.seedDemoProject('Demo', 'Somewhere');
    first.addCapture({
      id: 'cap_upload_on_demo',
      label: 'p.png',
      bytes: demoCaptures()[0]!.bytes,
      mediaType: 'image/png',
      dimensions: { width: 320, height: 240 },
      content: 'x',
      source: 'UPLOAD',
    });

    const second = newStore(fixture.env);
    const report = second.restore();
    // Reported honestly rather than resurrected without an owning project.
    assert.equal(report.skippedCaptures, 1);
    assert.equal(report.captures, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a human verification survives a restart and stays a human verification', async () => {
  const fixture = tempDataDir();
  try {
    const first = newStore(fixture.env);
    // A real project: the demo shell is not persisted, so a decision about one
    // of its captures could not meaningfully survive a restart.
    const created = first.create({ name: 'Tower B', location: 'Level 04' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const project = created.value;

    // A REAL uploaded capture, because the whole point of the test is that a
    // decision about a real image survives, so the image has to be durable too.
    const uploaded = first.addCapture({
      id: 'cap_upload_review01',
      label: 'site photo.png',
      bytes: demoCaptures()[0]!.bytes,
      mediaType: 'image/png',
      dimensions: { width: 320, height: 240 },
      content: 'Uploaded by the operator.',
      source: 'UPLOAD',
    });

    // Inspect with the offline fixture so there is a real result to review.
    const session = first.sessionFor(uploaded);
    await session.run();
    const finding = session.view().inspectionFindings.find((f) => f.origin === 'COMPARISON');
    assert.ok(finding, 'expected a comparison finding to verify');

    session.reviewFinding({
      findingId: finding.id,
      decision: 'VERIFIED',
      reviewer: 'K. Field Engineer',
      note: 'walked the bay, confirmed',
    });
    first.persistInspection(uploaded.id);

    // --- restart ---
    const second = newStore(fixture.env);
    const report = second.restore();
    if (second.list().length === 0) second.seedDemoProject('Demo', 'Somewhere');
    assert.equal(report.skippedCaptures, 0, 'nothing may be skipped');

    const restored = second.capturesOf(project.id).find((c) => c.id === uploaded.id);
    assert.ok(restored, 'the upload must come back');

    const selected = second.selectCapture(uploaded.id);
    assert.equal(selected.ok, true);
    const view = second.activeSession()!.view();

    assert.equal(view.outcome, 'COMPLETED', 'the inspection result must be restored');
    const restoredFinding = view.inspectionFindings.find((f) => f.id === finding.id);
    assert.ok(restoredFinding, 'the finding must be restored');
    assert.equal(restoredFinding.verificationStatus, 'VERIFIED');
    assert.equal(restoredFinding.review?.reviewer, 'K. Field Engineer');
    assert.equal(restoredFinding.review?.note, 'walked the bay, confirmed');

    // And it is still labelled for exactly what it was. This run used the
    // deterministic offline fixture, so a restart must NOT relabel it as a live
    // or cached AI inference: `synthetic` outranks the restore path.
    assert.equal(view.inferenceOrigin, 'DEMO_FIXTURE');
    assert.equal(view.isDemoFixture, true);
    assert.ok(view.provenance.humanReviewPerformed, 'the review must still be recorded');
  } finally {
    fixture.cleanup();
  }
});

test('deleting a capture removes its persisted record and uploaded bytes', async () => {
  const fixture = tempDataDir();
  try {
    const store = newStore(fixture.env);
    store.seedDemoProject('Demo', 'Somewhere');
    const stored = store.addCapture({
      id: 'cap_upload_delete01',
      label: 'photo.png',
      bytes: demoCaptures()[0]!.bytes,
      mediaType: 'image/png',
      dimensions: { width: 320, height: 240 },
      content: 'x',
      source: 'UPLOAD',
    });
    const bytesPath = stored.bytesPath;
    assert.ok(bytesPath && existsSync(bytesPath));

    // Run an inspection first: only a capture that actually produced a usable
    // result has a persisted record, which is exactly the rule being relied on.
    await store.sessionFor(stored).run();
    store.persistInspection(stored.id);
    const persistence = new WorkspacePersistence({ env: fixture.env });
    assert.ok(existsSync(persistence.inspectionFile(stored.id)));

    const removed = store.deleteCapture(stored.id);
    assert.equal(removed.ok, true);
    assert.equal(existsSync(bytesPath as string), false, 'uploaded bytes must be released');
    assert.equal(
      existsSync(persistence.inspectionFile(stored.id)),
      false,
      'the inspection record must be released',
    );
  } finally {
    fixture.cleanup();
  }
});

test('the synthetic demo project is never persisted', () => {
  const fixture = tempDataDir();
  try {
    const store = newStore(fixture.env);
    const demo = store.seedDemoProject('North Core Construction', 'Dusk Survey');
    store.persist();

    const persistence = new WorkspacePersistence({ env: fixture.env });
    const state = persistence.loadWorkspace();
    assert.ok(state);
    assert.equal(
      state.projects.some((p) => p.id === demo.id),
      false,
      'the demo project is code, not data, and is rebuilt every start',
    );
    assert.equal(
      state.captures.some((c) => c.source === 'DEMO_FIXTURE'),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test('a corrupt or unknown-version state file is ignored, not misread', () => {
  const fixture = tempDataDir();
  try {
    mkdirSync(fixture.dir, { recursive: true });
    writeFileSync(join(fixture.dir, 'workspace.json'), '{ this is not json');
    const persistence = new WorkspacePersistence({ env: fixture.env });
    assert.equal(persistence.loadWorkspace(), null, 'a corrupt file must not be trusted');

    writeFileSync(
      join(fixture.dir, 'workspace.json'),
      JSON.stringify({ schemaVersion: 999, projects: [], captures: [] }),
    );
    assert.equal(
      persistence.loadWorkspace(),
      null,
      'a future schema version must be ignored rather than guessed at',
    );
  } finally {
    fixture.cleanup();
  }
});

test('a tampered dataset path cannot read outside the dataset directory', () => {
  const fixture = tempDataDir();
  try {
    const persistence = new WorkspacePersistence({
      env: { ...fixture.env, SITELENS_DATASET_DIR: join(fixture.dir, 'sample') },
    });
    const capture = {
      id: 'x', projectId: 'p', label: 'l', content: '', mediaType: 'image/jpeg',
      width: 1, height: 1, byteLength: 0, source: 'LOCAL_DATASET' as const,
      zoneId: null, createdAt: '', bytesPath: '../../../../etc/passwd',
      relativeToDataset: true, exifOrientation: 1, geometryNormalized: false,
    };
    assert.equal(persistence.resolveCaptureBytes(capture), null);
  } finally {
    fixture.cleanup();
  }
});

test('a restored dataset capture is orientation-normalized and the source file is untouched', () => {
  // A dataset capture is stored as a PATH, and the dataset file itself is never
  // rewritten. So after a restart the raw bytes come back off the disk carrying
  // their original EXIF rotation, and the restore path must re-apply the same
  // normalization import applied â€” otherwise a capture that displayed upright
  // before the restart would come back sideways, with model, display and
  // evidence overlay in disagreement again.
  const fixture = tempDataDir();
  try {
    const datasetDir = join(fixture.dir, 'sample');
    mkdirSync(datasetDir, { recursive: true });

    // A minimal JPEG carrying EXIF orientation 6, built the same way the exif
    // geometry tests build theirs: real markers, real TIFF walk.
    const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
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
    const payload = Buffer.concat([
      Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
      tiff,
      ifd,
    ]);
    const seg = Buffer.alloc(2);
    seg.writeUInt16BE(payload.length + 2, 0);
    parts.push(Buffer.from([0xff, 0xe1]), seg, payload);
    const sof = Buffer.alloc(11);
    sof.writeUInt16BE(11, 0);
    sof[2] = 8;
    sof.writeUInt16BE(100, 3);
    sof.writeUInt16BE(200, 5);
    sof[7] = 3;
    parts.push(Buffer.from([0xff, 0xc0]), sof, Buffer.from([0xff, 0xd9]));
    const original = Buffer.concat(parts);

    const filename = '099-restart-orientation-fixture.jpg';
    writeFileSync(join(datasetDir, filename), original);

    const persistence = new WorkspacePersistence({
      env: { ...fixture.env, SITELENS_DATASET_DIR: datasetDir },
    });
    const capture = {
      id: 'cap_restored', projectId: 'p', label: 'l', content: '', mediaType: 'image/jpeg',
      width: 200, height: 100, byteLength: original.length, source: 'LOCAL_DATASET' as const,
      zoneId: null, createdAt: '', bytesPath: filename,
      relativeToDataset: true, exifOrientation: 6, geometryNormalized: true,
    };

    const resolved = persistence.resolveCaptureBytes(capture);
    assert.ok(resolved !== null);
    assert.equal(readExifOrientation(resolved), 1, 'restored bytes must be orientation 1');
    assert.equal(resolved.length, original.length, 'normalization must not re-encode');

    // The dataset file itself keeps its original bytes, orientation tag included.
    const onDisk = readFileSync(join(datasetDir, filename));
    assert.equal(readExifOrientation(onDisk), 6, 'the source file must keep its own orientation');
    assert.ok(onDisk.equals(original), 'the source file must be byte-identical');
  } finally {
    fixture.cleanup();
  }
});

test('deleting an upload cannot reach outside the uploads directory', () => {
  const fixture = tempDataDir();
  try {
    const persistence = new WorkspacePersistence({ env: fixture.env });
    const store = newStore(fixture.env);
    store.seedDemoProject('Demo', 'Somewhere');
    store.persist();

    const stateFile = join(fixture.dir, 'workspace.json');
    assert.ok(existsSync(stateFile));

    // An escaping path, and a sibling of the uploads directory. Neither may be
    // removed: only files inside this instance's own uploads directory are ever
    // deleted, and an unresolvable path is refused outright.
    persistence.deleteUpload(join(fixture.dir, '..', 'escaped.jpg'));
    persistence.deleteUpload(join(fixture.dir, 'workspace.json'));
    persistence.deleteUpload('relative/path.jpg');

    assert.ok(existsSync(stateFile), 'the state file must survive');
  } finally {
    fixture.cleanup();
  }
});

test('an inspection record round-trips through disk unchanged', () => {
  const fixture = tempDataDir();
  try {
    const persistence = new WorkspacePersistence({ env: fixture.env });
    const record = {
      captureId: 'cap_test01',
      savedAt: '2026-10-06T00:00:00.000Z',
      inspectedAt: '2026-10-05T23:59:00.000Z',
      provider: 'nebius-nvidia',
      model: 'openbmb/MiniCPM-V-4_5',
      inferenceOrigin: 'FRESH',
      originalInferenceAt: null,
      originalLatencyMs: 5100,
      payload: {
        observations: [{ category: 'OBSERVED_ELEMENT' }],
        elements: [{ element: 'REBAR', present: true }],
        findings: [],
      },
      reviews: [
        { key: 'COMPARISON|cmp_x|Title', status: 'VERIFIED', reviewer: 'A. B', reviewedAt: 'now', note: null },
      ],
      reasoning: null,
    };
    assert.equal(persistence.saveInspection(record), true);
    const loaded = persistence.loadInspection('cap_test01');
    assert.ok(loaded);
    assert.equal(loaded.model, 'openbmb/MiniCPM-V-4_5');
    assert.equal(loaded.inspectedAt, record.inspectedAt);
    assert.equal(loaded.reviews.length, 1);
    assert.equal(loaded.reviews[0]?.reviewer, 'A. B');
    assert.equal(loaded.payload.elements.length, 1);
  } finally {
    fixture.cleanup();
  }
});
