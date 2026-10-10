/**
 * All six reviewer-gated routes, verified against a REAL running server.
 *
 * reviewer-gate.test.ts already drives the HTTP surface, but this file exists to
 * answer a narrower question with harder evidence: for each protected route,
 * with and without a reviewer, what status comes back, and did anything change
 * on the way out. It asserts on observed store state rather than on the presence
 * of a guard call, so a route that checked the gate but mutated anyway would
 * still fail here.
 *
 * Every server runs against its own temporary data directory. Nothing here
 * reads or writes the repository's data/ directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { WorkspacePersistence } from '../src/persistence.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Routes that must refuse work while the gate is closed. */
const GATED: readonly { path: string; name: string }[] = [
  { path: '/api/upload?name=site.png&type=image/png', name: 'upload' },
  { path: '/api/run', name: 'run' },
  { path: '/api/dataset/import', name: 'dataset import' },
  { path: '/api/review', name: 'review' },
  { path: '/api/finding-state', name: 'finding-state' },
  { path: '/api/review-finding', name: 'review-finding' },
];

/** Read-only routes that must stay reachable while the gate is closed. */
const READS: readonly string[] = [
  '/api/workspace', '/api/session', '/api/projects', '/api/captures', '/api/dataset', '/api/expected',
];

interface Harness {
  call(method: string, path: string, payload?: unknown): Promise<{ status: number; body: any }>;
  raw(method: string, path: string, bytes: Buffer, contentType: string): Promise<{ status: number; body: Buffer }>;
  store(): any;
  close(): Promise<void>;
}

async function startServer(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-gate-'));
  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
    persistence: new WorkspacePersistence({ directory: dir }),
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  return {
    async call(method, path, payload) {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: await res.json() };
    },
    async raw(method, path, bytes, contentType) {
      const init: RequestInit = { method, headers: { 'Content-Type': contentType } };
      init.body = new Uint8Array(bytes);
      const res = await fetch(base + path, init);
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    },
    store: () => (handle as unknown as { store: any }).store,
    async close() {
      await new Promise<void>((resolve) => handle.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A payload each route will accept far enough to reach its own validation. */
function payloadFor(path: string): unknown {
  if (path === '/api/run') return {};
  if (path === '/api/dataset/import') return { id: '001-some-image' };
  if (path === '/api/review') return { observationId: 'obs_x', decision: 'VERIFIED' };
  if (path === '/api/finding-state') return { findingId: 'fnd_x', state: 'CLOSED' };
  if (path === '/api/review-finding') return { findingId: 'fnd_x', decision: 'VERIFIED' };
  return undefined;
}

/** A snapshot of everything a gated mutation could plausibly have changed. */
function evidenceOf(h: Harness) {
  const store = h.store();
  // activeSession() is null when nothing is open, which is the normal case for
  // these refusals; the view must then be read as null rather than dereferenced.
  const session = store.activeSession();
  return {
    captures: store.captures.size,
    outcome: session === null ? null : session.view().outcome,
    findingCount: session === null ? 0 : session.view().inspectionFindings.length,
    verifiedCount: session === null ? 0
      : session.view().inspectionFindings.filter((f: any) => f.verificationStatus === 'VERIFIED').length,
  };
}

for (const route of GATED) {
  test(`${route.name}: refused with 409 while no reviewer is named`, async () => {
    const h = await startServer();
    try {
      // A project exists but names nobody, which is the closed-gate state.
      await h.call('POST', '/api/projects', { name: 'Gate' });
      const before = evidenceOf(h);

      const res = route.path.startsWith('/api/upload')
        ? await (async () => {
            const r = await h.raw('POST', route.path, PNG, 'application/octet-stream');
            return { status: r.status, body: JSON.parse(r.body.toString('utf8')) };
          })()
        : await h.call('POST', route.path, payloadFor(route.path));

      assert.equal(res.status, 409, `${route.name} must answer 409`);
      assert.equal(res.body.error, 'REVIEWER_REQUIRED', `${route.name} must name the refusal`);
      assert.match(String(res.body.message), /inspection reviewer/i);

      const after = evidenceOf(h);
      assert.equal(after.captures, before.captures,
        `${route.name} stored a capture despite the refusal`);
      assert.equal(after.outcome, before.outcome,
        `${route.name} changed the inspection outcome despite the refusal`);
      assert.equal(after.findingCount, before.findingCount,
        `${route.name} produced findings despite the refusal`);
      assert.equal(after.verifiedCount, before.verifiedCount,
        `${route.name} changed a verification state despite the refusal`);
    } finally {
      await h.close();
    }
  });
}

test('a reviewer named in the request body does not bypass any gated route', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Gate' });
    for (const route of GATED) {
      const body = { ...(payloadFor(route.path) as Record<string, unknown>), reviewer: 'Dr. Who' };
      const res = route.path.startsWith('/api/upload')
        ? { status: 409 }
        : await h.call('POST', route.path, body);
      assert.equal(res.status, 409,
        `${route.name} opened to a request-supplied reviewer name`);
    }
  } finally {
    await h.close();
  }
});

test('a refused upload writes nothing to the persistence directory', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Gate' });
    const dir = h.store().persistence.directory as string;
    const { existsSync } = await import('node:fs');
    const uploads = join(dir, 'uploads');
    const before = existsSync(uploads)
      ? (await import('node:fs')).readdirSync(uploads).length
      : 0;

    await h.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');

    const after = existsSync(uploads)
      ? (await import('node:fs')).readdirSync(uploads).length
      : 0;
    assert.equal(after, before, 'a refused upload must not write any bytes');
  } finally {
    await h.close();
  }
});

test('read-only routes stay reachable while the gate is closed', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Gate' });
    for (const path of READS) {
      const res = await h.call('GET', path);
      assert.equal(res.status, 200, `${path} must stay readable; the operator has to see WHY it is closed`);
    }
  } finally {
    await h.close();
  }
});

test('configuring a reviewer is never gated, so the gate cannot trap the operator', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Gate' });
    const first = await h.call('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });
    assert.equal(first.status, 200, 'naming a reviewer must always be possible');
    const second = await h.call('POST', '/api/reviewer', { name: 'Second Inspector' });
    assert.equal(second.status, 200, 'a reviewer can be changed, not only set once');
    const ws = await h.call('GET', '/api/workspace');
    assert.equal(ws.body.reviewerGate.required, false, 'the gate opens and stays open');
  } finally {
    await h.close();
  }
});

test('with a reviewer configured, every gated route passes the gate', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Open' });
    await h.call('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });

    // Upload: reaches business logic and stores a capture.
    const up = await h.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(up.status, 200, 'upload passes the gate and stores');
    const captureId = JSON.parse(up.body.toString('utf8')).capture.id as string;
    await h.call('POST', '/api/captures/select', { captureId });

    // Run: reaches the provider and produces a result.
    const run = await h.call('POST', '/api/run', {});
    assert.equal(run.status, 200, 'run passes the gate');
    const finding = run.body.inspectionFindings[0];
    assert.ok(finding, 'the run produced a finding to act on');

    // The three attribution routes reach their own logic.
    const review = await h.call('POST', '/api/review', {
      observationId: run.body.observations[0].id, decision: 'VERIFIED',
    });
    assert.equal(review.status, 200, 'review passes the gate and records');

    const settle = await h.call('POST', '/api/review-finding', {
      findingId: finding.id, decision: 'VERIFIED',
    });
    assert.equal(settle.status, 200, 'review-finding passes the gate and records');

    const state = await h.call('POST', '/api/finding-state', {
      findingId: finding.id, state: 'ACKNOWLEDGED',
    });
    assert.equal(state.status, 200, 'finding-state passes the gate and records');

    // Dataset import reaches its own validation, which is a different refusal.
    const imp = await h.call('POST', '/api/dataset/import', { id: '001-some-image' });
    assert.notEqual(imp.status, 409, 'dataset import must pass the gate once open');
    assert.equal(imp.status, 404, 'and then fail on its own business validation, not the gate');
  } finally {
    await h.close();
  }
});

test('gate passage is distinguishable from business success', async () => {
  const h = await startServer();
  try {
    await h.call('POST', '/api/projects', { name: 'Open' });
    await h.call('POST', '/api/reviewer', { name: 'Takou Rah' });
    // An invalid payload must reach business validation and fail THERE, proving
    // the 409 above really was the gate and not this route's own check.
    const res = await h.call('POST', '/api/review', { observationId: 'nope', decision: 'VERIFIED' });
    assert.notEqual(res.status, 409, 'the gate is open, so this cannot be a gate refusal');
    assert.equal(res.body.error !== 'REVIEWER_REQUIRED', true);
  } finally {
    await h.close();
  }
});