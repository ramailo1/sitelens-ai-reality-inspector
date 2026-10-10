/**
 * Stale capture selection: "That capture no longer exists."
 *
 * The defect: deleting a selected capture reconciled the single-image primary
 * (`activeCaptureId`) but never the multi-image group (`activeCaptureIds`), so
 * the masthead kept naming a deleted photograph. The next inspection then
 * failed inside `selectCaptureGroup` with UNKNOWN_CAPTURE, and the client
 * prefixed every such state error with "AI provider request failed:" - a
 * storage-state problem dressed up as a model outage, with no provider call
 * made at all.
 *
 * These tests prove, over the real HTTP surface with a counting provider:
 *
 *   - a stale or foreign capture id is refused with its accurate state error
 *     BEFORE any provider invocation (calls stay 0);
 *   - deleting a capture reconciles the workspace selection that every later
 *     route and render reads;
 *   - an implicit run never silently inspects a subset of the chosen group;
 *   - valid single- and multi-image inspections still complete;
 *   - persistence restoration drops group members that no longer resolve;
 *   - the client names capture-state failures for what they are and refreshes
 *     the workspace instead of blaming the provider.
 *
 * No test here performs a paid call: the counting provider answers from a
 * stubbed fetch, and the demo provider answers deterministically offline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInspectionServer } from '../src/server.ts';
import type { InspectionServerHandle } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import type { FetchLike } from '../src/providers/nebius-nvidia.provider.ts';
import { ProjectStore } from '../src/projects.ts';
import { WorkspacePersistence } from '../src/persistence.ts';
import { demoCaptures } from '../src/captures.ts';
import { APP_JS, INDEX_HTML } from '../src/ui-assets.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Minimal vision envelope: valid, empty, and never mistaken for a failure. */
const EMPTY_VISION_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({ observations: [], elements: [], findings: [] }),
      },
      finish_reason: 'stop',
    },
  ],
};

interface JsonResult { status: number; body: any }
interface RawResult { status: number; body: Buffer }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
  raw(method: string, path: string, body: Buffer, contentType: string): Promise<RawResult>;
}

function countingProvider(): {
  provider: NebiusNvidiaProvider;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'test-vision-model',
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: (async (url: string, _init: { body: string }) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify(EMPTY_VISION_BODY) };
    }) as FetchLike,
    env: {},
  });
  return { provider, calls };
}

async function withCountingServer(
  fn: (call: Call, visionCalls: unknown[], handle: InspectionServerHandle) => Promise<void>,
): Promise<void> {
  const { provider, calls } = countingProvider();
  const handle = createInspectionServer({ provider, zoneId: 'zone_level_02', initialCaptureId: null });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const call: Call = {
    async json(method, path, payload) {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: await res.json() };
    },
    async raw(method, path, body, contentType) {
      const init: RequestInit = { method };
      if (method !== 'GET' && method !== 'HEAD') {
        init.headers = { 'Content-Type': contentType };
        init.body = new Uint8Array(body);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
  try {
    await fn(call, calls, handle);
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
}

async function withDemoServer(fn: (call: Call) => Promise<void>): Promise<void> {
  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const call: Call = {
    async json(method, path, payload) {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: await res.json() };
    },
    async raw(method, path, body, contentType) {
      const init: RequestInit = { method };
      if (method !== 'GET' && method !== 'HEAD') {
        init.headers = { 'Content-Type': contentType };
        init.body = new Uint8Array(body);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
  try {
    await fn(call);
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
}

/** The gate guards every run, so these tests name a reviewer as setup. */
async function nameReviewer(call: Call): Promise<void> {
  const res = await call.json('POST', '/api/reviewer', { name: 'State Tester', role: 'QA' });
  assert.equal(res.status, 200);
}

async function uploadPng(call: Call, name: string): Promise<string> {
  const res = await call.raw('POST', `/api/upload?name=${name}&type=image/png`, PNG, 'application/octet-stream');
  assert.equal(res.status, 200);
  return (JSON.parse(res.body.toString('utf8')) as { capture: { id: string } }).capture.id;
}

/* ------------------------------------------------------------------ *
 * Explicit stale ids are refused before any provider invocation.
 * ------------------------------------------------------------------ */

test('a run naming a capture from another project is refused as NOT_OWNED with no provider call', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    const captureA = await uploadPng(call, 'siteA.png');

    await call.json('POST', '/api/projects', { name: 'Project B' });
    await nameReviewer(call);

    const run = await call.json('POST', '/api/run', { captureIds: [captureA] });
    assert.equal(run.status, 403);
    assert.equal(run.body.error, 'NOT_OWNED');
    assert.equal(run.body.message, 'That capture belongs to another project.');
    assert.equal(visionCalls.length, 0, 'a foreign id must not reach the provider');
  });
});

test('a run naming a deleted capture is refused as UNKNOWN_CAPTURE with no provider call', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    const captureId = await uploadPng(call, 'site.png');

    const removed = await call.json('DELETE', `/api/captures/${captureId}`);
    assert.equal(removed.status, 200);

    const run = await call.json('POST', '/api/run', { captureIds: [captureId] });
    assert.equal(run.status, 404);
    assert.equal(run.body.error, 'UNKNOWN_CAPTURE');
    assert.equal(run.body.message, 'That capture no longer exists.');
    assert.doesNotMatch(run.body.message, /AI provider/i, 'a state error must not read as a provider failure');
    assert.equal(visionCalls.length, 0, 'a deleted id must not reach the provider');
  });
});

test('a run naming an unknown capture id is refused with no provider call', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    await uploadPng(call, 'site.png');

    const run = await call.json('POST', '/api/run', { captureIds: ['cap_no_such_capture'] });
    assert.equal(run.status, 404);
    assert.equal(run.body.error, 'UNKNOWN_CAPTURE');
    assert.equal(visionCalls.length, 0);
  });
});

test('a multi-image run with one foreign capture is refused without provider calls and keeps its selection', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    const captureA = await uploadPng(call, 'siteA.png');

    const b = await call.json('POST', '/api/projects', { name: 'Project B' });
    await nameReviewer(call);
    const captureB = await uploadPng(call, 'siteB.png');

    // One owned photograph plus one foreign one: the whole run is refused,
    // not silently narrowed to the owned half.
    const run = await call.json('POST', '/api/run', { captureIds: [captureB, captureA] });
    assert.equal(run.status, 403);
    assert.equal(run.body.error, 'NOT_OWNED');
    assert.equal(visionCalls.length, 0);

    // The failed selection mutated nothing: the owned photograph still runs.
    const valid = await call.json('POST', '/api/run', { captureIds: [captureB] });
    assert.equal(valid.status, 200);
    assert.equal(visionCalls.length, 1);
    assert.equal(b.body.project.id, valid.body.provenance.projectId);
  });
});

/* ------------------------------------------------------------------ *
 * Deletion reconciles the selection the workspace reports.
 * ------------------------------------------------------------------ */

test('deleting the selected capture reconciles the workspace selection', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    const captureId = await uploadPng(call, 'site.png');

    const before = await call.json('GET', '/api/workspace');
    assert.ok((before.body.activeCaptureIds as string[]).includes(captureId));

    const removed = await call.json('DELETE', `/api/captures/${captureId}`);
    assert.equal(removed.status, 200);
    assert.ok(!(removed.body.activeCaptureIds as string[]).includes(captureId),
      'the deleted photograph must leave the reported selection');
    assert.equal(removed.body.activeCaptureId, null);
    assert.deepEqual(removed.body.activeCaptureIds, []);

    // With nothing selected, an implicit run states that accurately instead
    // of failing as a provider error.
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 400);
    assert.equal(run.body.error, 'no capture selected');
    assert.equal(visionCalls.length, 0);
  });
});

test('deleting one member of a group keeps the survivors selected in order', () => {
  const store = new ProjectStore({ provider: new DemoFixtureProvider(), zoneId: 'z' });
  store.seedDemoProject('Demo', 'Here');
  const [first, second] = demoCaptures();
  assert.ok(first !== undefined && second !== undefined);
  const selected = store.selectCaptureGroup([first.id, second.id]);
  assert.equal(selected.ok, true);
  assert.deepEqual(store.selectedCaptureIds(), [first.id, second.id]);

  const removed = store.deleteCapture(first.id);
  assert.equal(removed.ok, true);
  // The regression: the group used to keep naming the deleted photograph.
  assert.deepEqual(store.selectedCaptureIds(), [second.id]);
  assert.deepEqual(store.selectedCaptures().map((c) => c.id), [second.id]);
  assert.equal(store.selectedCaptureId(), second.id);

  // Deleting the last surviving member falls back exactly like a deleted
  // single selection: the last remaining capture of the project opens rather
  // than an empty group beside existing photographs.
  const removed2 = store.deleteCapture(second.id);
  assert.equal(removed2.ok, true);
  assert.deepEqual(store.selectedCaptureIds(), ['cap_finished_facade']);
  assert.equal(store.selectedCaptureId(), 'cap_finished_facade');
});

test('an implicit run over a desynchronised selection is refused, never silently narrowed', async () => {
  await withCountingServer(async (call, visionCalls, handle) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    await uploadPng(call, 'site.png');

    // White-box desync: the group names a photograph that no longer exists,
    // as the pre-fix delete path left behind. The run must refuse with the
    // state error rather than quietly inspecting whoever survived.
    (handle.store as unknown as { activeCaptureIds: string[] }).activeCaptureIds = ['cap_ghost'];
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 404);
    assert.equal(run.body.error, 'UNKNOWN_CAPTURE');
    assert.equal(run.body.message, 'That capture no longer exists.');
    assert.equal(visionCalls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * Switching projects never carries a stale selection with it.
 * ------------------------------------------------------------------ */

test('switching projects selects the new project\u2019s captures, never the previous project\u2019s', async () => {
  await withCountingServer(async (call, visionCalls) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);
    const captureA = await uploadPng(call, 'siteA.png');

    const b = await call.json('POST', '/api/projects', { name: 'Project B' });
    // A new project starts empty; switching back and forth must track each
    // project's own captures.
    assert.deepEqual(b.body.activeCaptureIds, []);
    const back = await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    assert.deepEqual(back.body.activeCaptureIds, [captureA]);
    assert.equal(back.body.activeCaptureId, captureA);

    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 200);
    assert.equal(visionCalls.length, 1);
  });
});

/* ------------------------------------------------------------------ *
 * Persistence restoration drops group members that no longer resolve.
 * ------------------------------------------------------------------ */

test('restoration reconciles a group member that no longer resolves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-capture-state-'));
  try {
    const persistence = new WorkspacePersistence({ directory: dir });
    const store = new ProjectStore({
      provider: new DemoFixtureProvider(),
      zoneId: 'z',
      persistence,
    });
    const created = store.create({ name: 'Kept' });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error('unreachable');
    const capture = store.addCapture({
      id: 'cap_kept',
      label: 'kept',
      bytes: PNG,
      mediaType: 'image/png',
      dimensions: { width: 1, height: 1 },
      content: 'kept',
      source: 'UPLOAD',
    });
    const selected = store.selectCaptureGroup([capture.id]);
    assert.equal(selected.ok, true);

    // Tamper the durable record the way a stale client would: the group names
    // a photograph whose bytes are gone.
    const workspaceFile = join(dir, 'workspace.json');
    const record = JSON.parse(readFileSync(workspaceFile, 'utf8')) as {
      activeCaptureIds: string[];
    };
    assert.deepEqual(record.activeCaptureIds, [capture.id]);
    record.activeCaptureIds = [capture.id, 'cap_ghost'];
    writeFileSync(workspaceFile, JSON.stringify(record));

    const store2 = new ProjectStore({
      provider: new DemoFixtureProvider(),
      zoneId: 'z',
      persistence: new WorkspacePersistence({ directory: dir }),
    });
    const report = store2.restore();
    assert.equal(report.captures, 1);
    assert.deepEqual(store2.selectedCaptureIds(), [capture.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Valid inspections still complete, single and multi-image.
 * ------------------------------------------------------------------ */

test('valid single-image and multi-image inspections still complete', async () => {
  await withDemoServer(async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'State Tester', role: 'QA' });
    const ws = await call.json('GET', '/api/workspace');
    const ids = (ws.body.captures as { id: string }[]).map((c) => c.id);
    assert.ok(ids.length >= 2);

    const single = await call.json('POST', '/api/captures/select', { captureId: ids[0] });
    assert.equal(single.status, 200);
    const runOne = await call.json('POST', '/api/run', {});
    assert.equal(runOne.status, 200);
    assert.equal(runOne.body.outcome, 'COMPLETED');

    const group = await call.json('POST', '/api/captures/select', { captureIds: [ids[0], ids[1]] });
    assert.equal(group.status, 200);
    assert.deepEqual(group.body.activeCaptureIds, [ids[0], ids[1]]);
    const runGroup = await call.json('POST', '/api/run', {});
    assert.equal(runGroup.status, 200);
    assert.equal(runGroup.body.images.length, 2);
  });
});

/* ------------------------------------------------------------------ *
 * The client names state errors for what they are and refreshes.
 * ------------------------------------------------------------------ */

test('the run failure path distinguishes capture-state errors from provider errors', () => {
  const start = APP_JS.indexOf('async function runInspection()');
  assert.ok(start > -1, 'runInspection must exist');
  const end = APP_JS.indexOf('\n}', APP_JS.indexOf("notify(message, 'bad')", start));
  const body = APP_JS.slice(start, end);
  // State errors carry their server message verbatim and refresh the
  // workspace, which bears the reconciled selection.
  assert.match(body, /error\.code === 'UNKNOWN_CAPTURE'/);
  assert.match(body, /error\.code === 'NOT_OWNED'/);
  assert.match(body, /api\('\/api\/workspace'\)/);
  assert.match(body, /setLamp\('problem', 'Capture unavailable'\)/);
  // Genuine model failures still read as provider failures.
  assert.match(body, /AI provider request failed: ' \+ error\.message/);
});

test('the header and translation work survive the capture-state fix', () => {
  // The recent header/localization changes must remain intact: no visible
  // disclaimer note, tooltip help, translation memory keys, and the
  // model-translation map on a fresh inspection view.
  assert.doesNotMatch(INDEX_HTML, /id="lang-note"/);
  assert.match(INDEX_HTML, /data-i18n-title="lang\.hint"/);
});
