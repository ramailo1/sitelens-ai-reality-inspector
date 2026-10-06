/**
 * Comprehensive automated tests for Reviewer Identity Setup & Finding Review UX.
 *
 * Verifies:
 * - Reviewer setup via API (configuring name & role, rejecting blank names, updating identity)
 * - Review actions using stored reviewer identity (VERIFIED, NEEDS_REVIEW, REJECTED)
 * - Behavior when reviewer identity is missing (refuses review with REVIEWER_NOT_CONFIGURED)
 * - Persistence of reviewer identity across process reloads
 * - Workspace/project isolation of reviewer identity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { WorkspacePersistence } from '../src/persistence.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface JsonResult { status: number; body: any }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
  raw(method: string, path: string, body: Buffer, contentType: string): Promise<{ status: number; body: Buffer }>;
}

async function withTestServer(
  options: { persistence?: WorkspacePersistence | null } = {},
  fn: (call: Call, handle: ReturnType<typeof createInspectionServer>) => Promise<void>,
): Promise<void> {
  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
    persistence: options.persistence ?? null,
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
    await fn(call, handle);
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
}

test('reviewer setup: can configure reviewer name and role', async () => {
  await withTestServer({}, async (call) => {
    const ws = await call.json('GET', '/api/workspace');
    assert.equal(ws.status, 200);
    assert.equal(ws.body.project.reviewer, null);

    const setRes = await call.json('POST', '/api/reviewer', {
      name: 'Takou Rah',
      role: 'Site Engineer',
    });
    assert.equal(setRes.status, 200);
    assert.deepEqual(setRes.body.project.reviewer, {
      name: 'Takou Rah',
      role: 'Site Engineer',
    });
  });
});

test('reviewer setup: blank reviewer name is rejected', async () => {
  await withTestServer({}, async (call) => {
    const res = await call.json('POST', '/api/reviewer', { name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'NAME_REQUIRED');
  });
});

test('reviewer setup: reviewer identity can be changed later', async () => {
  await withTestServer({}, async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });

    const updateRes = await call.json('POST', '/api/reviewer', {
      name: 'Sarah Chen',
      role: 'Lead Inspector',
    });
    assert.equal(updateRes.status, 200);
    assert.deepEqual(updateRes.body.project.reviewer, {
      name: 'Sarah Chen',
      role: 'Lead Inspector',
    });
  });
});

test('review actions: review cannot be recorded without reviewer identity', async () => {
  await withTestServer({}, async (call) => {
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 200);
    const targetFinding = run.body.inspectionFindings[0];
    assert.ok(targetFinding);

    const reviewRes = await call.json('POST', '/api/review-finding', {
      findingId: targetFinding.id,
      decision: 'VERIFIED',
    });
    assert.equal(reviewRes.status, 400);
    assert.equal(reviewRes.body.error, 'REVIEWER_NOT_CONFIGURED');
    assert.match(reviewRes.body.message, /Set your reviewer identity/);
  });
});

test('review actions: VERIFIED uses stored reviewer identity automatically', async () => {
  await withTestServer({}, async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });

    const run = await call.json('POST', '/api/run', {});
    const targetFinding = run.body.inspectionFindings[0];

    const reviewRes = await call.json('POST', '/api/review-finding', {
      findingId: targetFinding.id,
      decision: 'VERIFIED',
      note: 'Verified during site walk',
    });

    assert.equal(reviewRes.status, 200);
    const settled = reviewRes.body.inspectionFindings.find((f: any) => f.id === targetFinding.id);
    assert.equal(settled.verificationStatus, 'VERIFIED');
    assert.equal(settled.review.reviewer, 'Takou Rah · Site Engineer');
    assert.equal(settled.review.note, 'Verified during site walk');
  });
});

test('review actions: NEEDS REVIEW and REJECTED use stored reviewer identity', async () => {
  await withTestServer({}, async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Takou Rah' });

    const run = await call.json('POST', '/api/run', {});
    assert.ok(run.body.inspectionFindings.length >= 2);
    const f1 = run.body.inspectionFindings[0];
    const f2 = run.body.inspectionFindings[1];

    const r1 = await call.json('POST', '/api/review-finding', {
      findingId: f1.id,
      decision: 'NEEDS_REVIEW',
    });
    assert.equal(r1.status, 200);
    const s1 = r1.body.inspectionFindings.find((f: any) => f.id === f1.id);
    assert.equal(s1.verificationStatus, 'NEEDS_REVIEW');
    assert.equal(s1.review.reviewer, 'Takou Rah');

    const r2 = await call.json('POST', '/api/review-finding', {
      findingId: f2.id,
      decision: 'REJECTED',
    });
    assert.equal(r2.status, 200);
    const s2 = r2.body.inspectionFindings.find((f: any) => f.id === f2.id);
    assert.equal(s2.verificationStatus, 'REJECTED');
    assert.equal(s2.review.reviewer, 'Takou Rah');
  });
});

test('persistence: reviewer identity survives server restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-reviewer-test-'));
  try {
    const persistence1 = new WorkspacePersistence({ directory: dir });
    await withTestServer({ persistence: persistence1 }, async (call) => {
      await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });
      const run = await call.json('POST', '/api/run', {});
      const finding = run.body.inspectionFindings[0];
      await call.json('POST', '/api/review-finding', {
        findingId: finding.id,
        decision: 'VERIFIED',
      });
    });

    const persistence2 = new WorkspacePersistence({ directory: dir });
    await withTestServer({ persistence: persistence2 }, async (call) => {
      const ws = await call.json('GET', '/api/workspace');
      assert.equal(ws.status, 200);
      assert.deepEqual(ws.body.project.reviewer, {
        name: 'Takou Rah',
        role: 'Site Engineer',
      });
      assert.ok(ws.body.view);
      const reviewed = ws.body.view.inspectionFindings[0];
      assert.equal(reviewed.verificationStatus, 'VERIFIED');
      assert.equal(reviewed.review.reviewer, 'Takou Rah · Site Engineer');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isolation: reviewer identity does not leak between projects', async () => {
  await withTestServer({}, async (call) => {
    const projA = await call.json('POST', '/api/projects', { name: 'Project Alpha' });
    const projAId = projA.body.project.id;

    await call.json('POST', '/api/reviewer', { name: 'Alpha Inspector', role: 'Lead A' });
    const wsA = await call.json('GET', '/api/workspace');
    assert.equal(wsA.body.project.reviewer.name, 'Alpha Inspector');

    const projB = await call.json('POST', '/api/projects', { name: 'Project Beta' });
    const projBId = projB.body.project.id;
    assert.equal(projB.body.project.reviewer, null);

    await call.json('POST', '/api/reviewer', { name: 'Beta Inspector', role: 'Lead B' });
    const wsB = await call.json('GET', '/api/workspace');
    assert.equal(wsB.body.project.reviewer.name, 'Beta Inspector');

    await call.json('POST', '/api/projects/switch', { projectId: projAId });
    const backA = await call.json('GET', '/api/workspace');
    assert.equal(backA.body.project.reviewer.name, 'Alpha Inspector');
    assert.equal(backA.body.project.reviewer.role, 'Lead A');
  });
});

test('historical attribution: changing project reviewer does not rewrite previously recorded review identities', async () => {
  await withTestServer({}, async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Reviewer One', role: 'Inspector 1' });

    const run = await call.json('POST', '/api/run', {});
    assert.ok(run.body.inspectionFindings.length >= 2);
    const findingA = run.body.inspectionFindings[0];
    const findingB = run.body.inspectionFindings[1];

    const reviewA = await call.json('POST', '/api/review-finding', {
      findingId: findingA.id,
      decision: 'VERIFIED',
      note: 'Inspected by One',
    });
    assert.equal(reviewA.status, 200);

    const settledA = reviewA.body.inspectionFindings.find((f: any) => f.id === findingA.id);
    assert.equal(settledA.verificationStatus, 'VERIFIED');
    assert.equal(settledA.review.reviewer, 'Reviewer One · Inspector 1');

    const changeRes = await call.json('POST', '/api/reviewer', { name: 'Reviewer Two', role: 'Inspector 2' });
    assert.equal(changeRes.status, 200);
    assert.equal(changeRes.body.project.reviewer.name, 'Reviewer Two');

    const ws = await call.json('GET', '/api/workspace');
    assert.equal(ws.status, 200);
    const reloadedA = ws.body.view.inspectionFindings.find((f: any) => f.id === findingA.id);

    assert.equal(reloadedA.verificationStatus, 'VERIFIED');
    assert.equal(reloadedA.review.reviewer, 'Reviewer One · Inspector 1');
    assert.equal(reloadedA.review.note, 'Inspected by One');

    const reviewB = await call.json('POST', '/api/review-finding', {
      findingId: findingB.id,
      decision: 'REJECTED',
      note: 'Rejected by Two',
    });
    assert.equal(reviewB.status, 200);

    const settledB = reviewB.body.inspectionFindings.find((f: any) => f.id === findingB.id);
    assert.equal(settledB.verificationStatus, 'REJECTED');
    assert.equal(settledB.review.reviewer, 'Reviewer Two · Inspector 2');

    const finalA = reviewB.body.inspectionFindings.find((f: any) => f.id === findingA.id);
    assert.equal(finalA.verificationStatus, 'VERIFIED');
    assert.equal(finalA.review.reviewer, 'Reviewer One · Inspector 1');
  });
});

