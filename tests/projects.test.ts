/**
 * Project and capture ownership.
 *
 * These assert the store, not the markup: the point of a project is that data is
 * genuinely partitioned, so a passing test here means a capture, its findings and
 * its reference cannot be reached from another project.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, cleanProjectName } from '../src/projects.ts';
import type { ProjectCapture } from '../src/projects.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { demoCaptures } from '../src/captures.ts';

const store = (): ProjectStore =>
  new ProjectStore({ provider: new DemoFixtureProvider(), zoneId: 'zone_level_02' });

function add(s: ProjectStore, id: string, projectName: string): string {
  const created = s.create({ name: projectName });
  assert.ok(created.ok, projectName + ' should be creatable');
  return s.addCapture({
    id,
    label: 'capture ' + id,
    bytes: Buffer.from('bytes-' + id),
    mediaType: 'image/png',
    dimensions: { width: 320, height: 240 },
    content: 'synthetic',
    source: 'UPLOAD',
  }).id;
}

function addTo(s: ProjectStore, id: string): string {
  return s.addCapture({
    id,
    label: 'capture ' + id,
    bytes: Buffer.from('bytes-' + id),
    mediaType: 'image/png',
    dimensions: { width: 320, height: 240 },
    content: 'synthetic',
    source: 'UPLOAD',
  }).id;
}

function capture(s: ProjectStore, id: string): ProjectCapture {
  const found = s.activeCapture(id);
  assert.equal(found.ok, true, 'capture ' + id + ' should be readable');
  if (!found.ok) throw new Error('unreachable');
  return found.value;
}

test('a new project is active immediately and starts empty', () => {
  const s = store();
  const created = s.create({ name: 'Project A', location: 'Site A' });
  assert.equal(created.ok, true);
  assert.equal(s.activeProject()?.name, 'Project A');
  assert.equal(s.list()[0]?.captureCount, 0);
  assert.equal(s.selectedCaptureId(), null);
});

test('a new project inherits no captures and no reference from another project', () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  const first = s.activeProject();
  assert.ok(first);
  s.setReferenceState(first.id, { ...s.expectedFor(first.id), zone: 'Zone A' });

  s.create({ name: 'Project B' });
  const second = s.activeProject();
  assert.ok(second);
  assert.equal(s.capturesOf(second.id).length, 0);
  assert.equal(s.expectedFor(second.id).zone, 'North Core');
});

test('project names are validated', () => {
  assert.equal(cleanProjectName('   ').ok, false);
  assert.equal(cleanProjectName('').ok, false);
  assert.equal(cleanProjectName(42).ok, false);
  assert.equal(cleanProjectName('x'.repeat(81)).ok, false);
  assert.equal(cleanProjectName('  Site A  ').ok, true);
});

test('renaming changes the name without creating a second project', () => {
  const s = store();
  const created = s.create({ name: 'Project A' });
  assert.ok(created.ok);
  const renamed = s.rename(created.value.id, 'Project A renamed');
  assert.equal(renamed.ok, true);
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0]?.name, 'Project A renamed');
});
test('switching projects selects that project\'s own captures', () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);
  const bCapture = addTo(s, 'cap_b');

  const switched = s.switchTo(b.value.id);
  assert.equal(switched.ok, true);
  assert.equal(s.selectedCaptureId(), bCapture);
  assert.deepEqual(s.capturesOf(b.value.id).map((c) => c.id), ['cap_b']);
});

test('a capture from another project is not readable', () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);
  const read = s.activeCapture('cap_a');
  assert.equal(read.ok, false);
  assert.equal(read.ok === false ? read.reason : '', 'NOT_OWNED');
});

test('a capture from another project cannot be selected or deleted', () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);
  assert.equal(s.selectCapture('cap_a').ok, false);
  assert.equal(s.deleteCapture('cap_a').ok, false);
  assert.equal(s.capturesOf(b.value.id).length, 0);
});

test('deleting a capture removes it and its session', async () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  s.selectCapture('cap_a');
  const session = s.sessionFor(capture(s, 'cap_a'));
  await session.run();

  const removed = s.deleteCapture('cap_a');
  assert.equal(removed.ok, true);
  const project = s.activeProject();
  assert.ok(project);
  assert.equal(s.capturesOf(project.id).length, 0);
  assert.equal(s.activeSession(), null);
});

test('deleting the active capture selects another, then falls to empty', () => {
  const s = store();
  s.create({ name: 'Project A' });
  addTo(s, 'c1');
  addTo(s, 'c2');
  s.selectCapture('c2');

  const first = s.deleteCapture('c2');
  assert.equal(first.ok === true ? first.value.activeCaptureId : null, 'c1');

  s.deleteCapture('c1');
  assert.equal(s.selectedCaptureId(), null);
});

test('deleting a project removes its captures and leaves others untouched', () => {
  const s = store();
  add(s, 'cap_a', 'Project A');
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);
  addTo(s, 'cap_b');

  const removed = s.delete(b.value.id);
  assert.equal(removed.ok, true);
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0]?.name, 'Project A');
  assert.equal(s.capturesOf(b.value.id).length, 0);
  assert.equal(s.capturesOf(s.activeProject()?.id ?? '').length, 1);
});

test('deleting the last project leaves the empty-project state', () => {
  const s = store();
  const created = s.create({ name: 'Only project' });
  assert.ok(created.ok);
  s.delete(created.value.id);
  assert.equal(s.list().length, 0);
  assert.equal(s.activeProject(), null);
  assert.equal(s.selectedCaptureId(), null);
});

test('switching to an unknown project is refused', () => {
  const s = store();
  s.create({ name: 'Project A' });
  assert.equal(s.switchTo('proj_missing').ok, false);
  assert.equal(s.activeProject()?.name, 'Project A');
});

test('returning to a project restores its last capture', () => {
  const s = store();
  const a = s.create({ name: 'Project A' });
  assert.ok(a.ok);
  addTo(s, 'cap_a');
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);

  s.switchTo(a.value.id);
  assert.equal(s.selectedCaptureId(), 'cap_a');
});

test('returning to a project lands on its last INSPECTED capture, not a newer un-inspected one', async () => {
  const s = store();
  const a = s.create({ name: 'Project A' });
  assert.ok(a.ok);
  addTo(s, 'cap_first');
  s.selectCapture('cap_first');
  await s.sessionFor(capture(s, 'cap_first')).run();
  // Uploaded afterwards, never inspected: the newest capture is NOT where the
  // operator's results live.
  addTo(s, 'cap_second');
  s.create({ name: 'Project B' });

  s.switchTo(a.value.id);
  assert.equal(s.selectedCaptureId(), 'cap_first');
});

test('a project with nothing inspected falls back to its newest capture', () => {
  const s = store();
  const a = s.create({ name: 'Project A' });
  assert.ok(a.ok);
  addTo(s, 'cap_first');
  addTo(s, 'cap_second');
  s.create({ name: 'Project B' });

  s.switchTo(a.value.id);
  assert.equal(s.selectedCaptureId(), 'cap_second');
});

test('selecting a capture does not by itself inspect it', () => {
  const s = store();
  s.create({ name: 'Project A' });
  addTo(s, 'cap_a');
  assert.equal(s.selectCapture('cap_a').ok, true);
  assert.equal(s.activeSession()?.inspected(), false, 'selection must not run the model');
});

test('the expected reference is stored per project', () => {
  const s = store();
  const a = s.create({ name: 'Project A' });
  assert.ok(a.ok);
  s.setReferenceState(a.value.id, { ...s.expectedFor(a.value.id), zone: 'Zone A' });
  const b = s.create({ name: 'Project B' });
  assert.ok(b.ok);
  assert.equal(s.expectedFor(a.value.id).zone, 'Zone A');
  assert.equal(s.expectedFor(b.value.id).zone, 'North Core');
});

test('a seeded demo project owns the generated fixtures', () => {
  const s = store();
  const seeded = s.seedDemoProject('Demo', 'here');
  assert.equal(s.capturesOf(seeded.id).length, demoCaptures().length);
  assert.equal(s.capturesOf(seeded.id).every((c) => c.source === 'DEMO_FIXTURE'), true);
});

test('renaming rejects an empty name', () => {
  const s = store();
  s.create({ name: 'Project A' });
  assert.equal(s.rename(s.activeProject()?.id ?? '', '  ').ok, false);
  assert.equal(s.activeProject()?.name, 'Project A');
});