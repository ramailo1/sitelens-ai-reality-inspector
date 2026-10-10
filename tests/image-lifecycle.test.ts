/**
 * Image storage lifecycle over the real HTTP surface.
 *
 * The storage assertions deliberately look at the live store rather than a mock,
 * because the claim being protected is "the bytes are actually gone", which a
 * response body alone cannot prove.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface JsonResult { status: number; body: any }
interface RawResult { status: number; body: Buffer }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
  raw(method: string, path: string, body: Buffer, contentType: string): Promise<RawResult>;
  store(): any;
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
    store: () => (handle as unknown as { store: any }).store,
  };

  try {
    await fn(call);
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
}

async function upload(call: Call, name = 'site.png'): Promise<string> {
  const res = await call.raw('POST', `/api/upload?name=${name}&type=image/png`, PNG, 'application/octet-stream');
  assert.equal(res.status, 200);
  return JSON.parse(res.body.toString('utf8')).capture.id as string;
}

/**
 * Create a project that is allowed to hold evidence.
 *
 * Uploading stores reality, and stored reality is evidence, so the reviewer gate
 * refuses an upload to a project with no named reviewer. These tests are about
 * what happens to those bytes, not about the gate, so the reviewer is part of
 * their fixture rather than something each assertion re-tests. The gate's own
 * behaviour is covered in reviewer-gate.test.ts.
 */
async function projectWithReviewer(call: Call, name: string): Promise<JsonResult> {
  const created = await call.json('POST', '/api/projects', { name });
  assert.equal(created.status, 201, 'project creation must succeed');
  const named = await call.json('POST', '/api/reviewer', { name: 'Lifecycle Tester', role: 'QA' });
  assert.equal(named.status, 200, 'naming a reviewer must succeed');
  return created;
}

test('the API states where imagery is actually stored', async () => {
  await withServer(async (call) => {
    const res = await call.json('GET', '/api/workspace');
    assert.equal(res.body.storage.durable, false);
    assert.equal(res.body.storage.location, 'process memory');
    assert.match(res.body.storage.detail, /lost when the server restarts/i);
  });
});

test('an upload is held in memory as the exact bytes received', async () => {
  await withServer(async (call) => {
    await projectWithReviewer(call, 'Storage');
    const id = await upload(call);
    const record = call.store().captures.get(id);
    assert.equal(Buffer.isBuffer(record.bytes), true);
    assert.equal(Buffer.compare(record.bytes, PNG), 0);
    assert.equal(record.source, 'UPLOAD');
  });
});

test('an authorised capture serves its bytes back unchanged', async () => {
  await withServer(async (call) => {
    await projectWithReviewer(call, 'Storage');
    const id = await upload(call);
    const res = await call.raw('GET', `/api/capture-image/${id}`, Buffer.alloc(0), 'text/plain');
    assert.equal(res.status, 200);
    assert.equal(Buffer.compare(res.body, PNG), 0);
  });
});

test('a capture belonging to another project serves nothing', async () => {
  await withServer(async (call) => {
    const a = await projectWithReviewer(call, 'A');
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    const id = await upload(call);
    await projectWithReviewer(call, 'B');
    const res = await call.raw('GET', `/api/capture-image/${id}`, Buffer.alloc(0), 'text/plain');
    assert.equal(res.status, 403);
  });
});
test('deleting a capture actually releases its bytes and session', async () => {
  await withServer(async (call) => {
    await projectWithReviewer(call, 'A');
    const id = await upload(call);
    const store = call.store();
    assert.equal(store.captures.has(id), true);

    const res = await call.json('DELETE', `/api/captures/${id}`);
    assert.equal(res.status, 200);
    assert.equal(store.captures.has(id), false, 'no orphaned bytes may remain');
    assert.equal(store.sessions.has(id), false, 'no orphaned session may remain');
    const gone = await call.raw('GET', `/api/capture-image/${id}`, Buffer.alloc(0), 'text/plain');
    assert.equal(gone.status, 404);
  });
});

test('deleting a project removes every image it owned', async () => {
  await withServer(async (call) => {
    const a = await projectWithReviewer(call, 'A');
    await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    const id = await upload(call);

    await call.json('DELETE', `/api/projects/${a.body.project.id}`);
    assert.equal(call.store().captures.has(id), false);
    const gone = await call.raw('GET', `/api/capture-image/${id}`, Buffer.alloc(0), 'text/plain');
    assert.equal(gone.status, 404);
  });
});

test('a fresh server starts with only the synthetic demo project', async () => {
  await withServer(async (call) => {
    const projects = call.store().list();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].demo, true);
  });
});

test('an operator-created project is not marked as demo', async () => {
  await withServer(async (call) => {
    const created = await projectWithReviewer(call, 'Mine');
    assert.equal(created.body.project.demo, false);
  });
});

test('a malformed image is refused rather than stored', async () => {
  await withServer(async (call) => {
    await projectWithReviewer(call, 'A');
    const res = await call.raw(
      'POST', '/api/upload?name=broken.png&type=image/png',
      Buffer.from('this is not a png'), 'application/octet-stream',
    );
    assert.equal(res.status, 400);
  });
});

test('an unsupported image type is refused', async () => {
  await withServer(async (call) => {
    await projectWithReviewer(call, 'A');
    const res = await call.raw(
      'POST', '/api/upload?name=notes.txt&type=text/plain',
      Buffer.from('plain text'), 'application/octet-stream',
    );
    assert.equal(res.status, 400);
  });
});

test('an upload with no project is refused', async () => {
  await withServer(async (call) => {
    const ws = await call.json('GET', '/api/workspace');
    for (const project of ws.body.projects) {
      await call.json('DELETE', `/api/projects/${project.id}`);
    }
    const res = await call.raw('POST', '/api/upload?name=x.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(res.status, 400);
  });
});

test('a missing capture image returns 404, not a broken image', async () => {
  await withServer(async (call) => {
    const res = await call.raw('GET', '/api/capture-image/cap_missing', Buffer.alloc(0), 'text/plain');
    assert.equal(res.status, 404);
  });
});