/**
 * Project and capture isolation over the real HTTP surface.
 *
 * The store tests prove the model; these prove the server actually enforces it,
 * because a route that forgets the ownership check would pass every unit test and
 * still hand another project's capture to the browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/**
 * Open the reviewer gate for the active project.
 *
 * Uploading and running produce evidence attributed to a reviewer, so the
 * server refuses them until one is named. These tests assert project
 * isolation, not the gate, so naming one is fixture setup; the gate itself is
 * covered by reviewer-gate.test.ts.
 */
async function nameReviewer(call: Call): Promise<void> {
  const res = await call.json('POST', '/api/reviewer', { name: 'API Tester', role: 'QA' });
  assert.equal(res.status, 200, 'naming a reviewer must succeed');
}


async function withServer(fn: (call: Call) => Promise<void>): Promise<void> {
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

interface JsonResult { status: number; body: any }
interface RawResult { status: number; body: Buffer }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
  raw(method: string, path: string, body: Buffer, contentType: string): Promise<RawResult>;
}

test('the workspace endpoint opens on the seeded project', async () => {
  await withServer(async (call) => {
    const res = await call.json('GET', '/api/workspace');
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, 'North Core Construction');
    assert.ok(res.body.captures.length > 0);
    assert.equal(res.body.projects.length, 1);
  });
});

test('creating a project returns it active with an empty capture list', async () => {
  await withServer(async (call) => {
    const res = await call.json('POST', '/api/projects', { name: 'Project A', location: 'Site A' });
    assert.equal(res.status, 201);
    assert.equal(res.body.project.name, 'Project A');
    assert.equal(res.body.project.location, 'Site A');
    assert.equal(res.body.captures.length, 0);
    assert.equal(res.body.view, null);
  });
});

test('a project with no captures reports empty rather than borrowing fixtures', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'Empty' });
    const res = await call.json('GET', '/api/captures');
    assert.deepEqual(res.body.captures, []);
  });
});

test('a capture from another project cannot be run, read or deleted', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    const projectA = a.body.project.id;

    await call.json('POST', '/api/projects/switch', { projectId: projectA });
    await nameReviewer(call);

    const upload = await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(upload.status, 200);
    const captureId = JSON.parse(upload.body.toString('utf8')).capture.id;

    const b = await call.json('POST', '/api/projects', { name: 'Project B' });
    assert.equal(b.body.captures.length, 0);

    await nameReviewer(call);

    const run = await call.json('POST', '/api/run', { captureId });
    assert.equal(run.status, 403);

    const image = await call.raw('GET', `/api/capture-image/${captureId}`, Buffer.alloc(0), 'text/plain');
    assert.equal(image.status, 403);

    const del = await call.json('DELETE', `/api/captures/${captureId}`);
    assert.equal(del.status, 403);

    const back = await call.json('POST', '/api/projects/switch', { projectId: projectA });
    assert.equal(back.body.captures.length, 1);
  });
});

test('image bytes are refused across a project boundary', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);

    const upload = await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');
    const captureId = JSON.parse(upload.body.toString('utf8')).capture.id;

    await call.json('POST', '/api/projects', { name: 'Project B' });
    const res = await call.raw('GET', `/api/capture-image/${captureId}`, Buffer.alloc(0), 'text/plain');
    assert.equal(res.status, 403);
  });
});

test('deleting another project\'s capture is refused', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);

    const upload = await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');
    const captureId = JSON.parse(upload.body.toString('utf8')).capture.id;

    await call.json('POST', '/api/projects', { name: 'Project B' });
    const res = await call.json('DELETE', `/api/captures/${captureId}`);
    assert.equal(res.status, 403);
  });
});

test('switching back restores that project\'s inspection and verifications', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);

    await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');

    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 200);
    assert.ok(run.body.inspectionFindings.length > 0);
    const finding = run.body.inspectionFindings[0];
    await call.json('POST', '/api/review-finding', {
      findingId: finding.id,
      decision: 'VERIFIED',
      reviewer: 'qa.lead',
    });

    await call.json('POST', '/api/projects', { name: 'Project B' });
    const back = await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    assert.equal(back.body.captures.length, 1);
    const restored = back.body.view.inspectionFindings.filter(
      (f: { id: string }) => f.id === finding.id,
    )[0];
    assert.equal(restored.verificationStatus, 'VERIFIED');
  });
});

test('deleting a capture removes it from the project list and stops serving its bytes', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);

    const upload = await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');
    const captureId = JSON.parse(upload.body.toString('utf8')).capture.id;

    const before = await call.raw('GET', `/api/capture-image/${captureId}`, Buffer.alloc(0), 'text/plain');
    assert.equal(before.status, 200);

    const after = await call.json('DELETE', `/api/captures/${captureId}`);
    assert.equal(after.status, 200);
    assert.equal(after.body.captures.length, 0);

    const gone = await call.raw('GET', `/api/capture-image/${captureId}`, Buffer.alloc(0), 'text/plain');
    assert.equal(gone.status, 404);
  });
});
test('renaming is reflected in the workspace payload immediately', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    const res = await call.json('PATCH', `/api/projects/${a.body.project.id}`, { name: 'Renamed site' });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, 'Renamed site');
    const listed = res.body.projects.filter((p: { id: string }) => p.id === a.body.project.id)[0];
    assert.equal(listed.name, 'Renamed site');
  });
});

test('an invalid project name is refused with a message', async () => {
  await withServer(async (call) => {
    const res = await call.json('POST', '/api/projects', { name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'NAME_REQUIRED');
  });
});

test('deleting every project yields the empty-project state', async () => {
  await withServer(async (call) => {
    let res = await call.json('POST', '/api/projects', { name: 'Only' });
    for (const project of res.body.projects) {
      res = await call.json('DELETE', `/api/projects/${project.id}`);
    }
    assert.equal(res.body.projects.length, 0);
    assert.equal(res.body.project, null);
    assert.equal(res.body.view, null);
    assert.equal(res.body.captures.length, 0);
  });
});

test('an upload with no project is refused rather than silently accepted', async () => {
  await withServer(async (call) => {
    const ws = await call.json('GET', '/api/workspace');
    for (const project of ws.body.projects) {
      await call.json('DELETE', `/api/projects/${project.id}`);
    }
    const res = await call.raw('POST', '/api/upload?name=x.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(res.status, 400);
  });
});

test('a cached result is never served to another project', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    await nameReviewer(call);

    const upload = await call.raw('POST', '/api/upload?name=siteA.png&type=image/png', PNG, 'application/octet-stream');
    const captureId = JSON.parse(upload.body.toString('utf8')).capture.id;

    const run = await call.json('POST', '/api/run', { captureId, cache: true });
    assert.equal(run.body.provenance.projectId, a.body.project.id);

    await call.json('POST', '/api/projects', { name: 'Project B' });
    // Project B gets a reviewer too. This test is about ownership, so the gate
    // must be open on BOTH projects: otherwise the request is refused for a
    // missing reviewer and the ownership check it was written to prove never
    // runs. The gate's own ordering is asserted in reviewer-gate.test.ts.
    await nameReviewer(call);
    const leak = await call.json('POST', '/api/run', { captureId, cache: true });
    assert.equal(leak.status, 403, 'the cache must not bypass ownership');

    const bView = await call.json('GET', '/api/session');
    assert.equal(bView.body, null, 'no result from another project may be served');
  });
});

test('the demo fixture stays labelled synthetic through a project switch', async () => {
  await withServer(async (call) => {
    const before = await call.json('GET', '/api/workspace');
    assert.equal(before.body.view.isDemoFixture, true);
    assert.equal(before.body.view.inferenceOrigin, 'DEMO_FIXTURE');

    const a = await call.json('POST', '/api/projects', { name: 'Project A' });
    assert.equal(a.body.view, null, 'a new project inherits no result');

    const back = await call.json('POST', '/api/projects/switch', { projectId: before.body.project.id });
    assert.equal(back.body.view.isDemoFixture, true);
  });
});