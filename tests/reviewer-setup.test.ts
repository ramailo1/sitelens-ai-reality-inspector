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
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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

test('review actions: nothing that creates evidence is possible without a reviewer identity', async () => {
  await withTestServer({}, async (call) => {
    // No reviewer has been named. Every route that would produce or attribute
    // evidence must refuse, and must refuse BEFORE the work happens.
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 409);
    assert.equal(run.body.error, 'REVIEWER_REQUIRED');
    assert.match(run.body.message, /inspection reviewer/i);

    // Refusing to run must leave nothing behind. The session still reports its
    // seeded PENDING placeholder, which is what it was before the refused call;
    // what must NOT appear is any finding, provenance or inference a run would
    // have produced.
    const session = await call.json('GET', '/api/session');
    assert.equal(session.body.outcome, 'PENDING',
      'a refused run must not produce a result of any kind');
    assert.equal(session.body.provenance.inferenceExecuted, false,
      'a refused run must not claim an inference was executed');
    assert.equal(session.body.inspectionFindings.length, 0,
      'a refused run must not leave findings behind');

    const review = await call.json('POST', '/api/review', {
      observationId: 'anything',
      decision: 'VERIFIED',
    });
    assert.equal(review.status, 409);
    assert.equal(review.body.error, 'REVIEWER_REQUIRED');
  });
});

test('review actions: a reviewer named in the request body does not open the gate', async () => {
  await withTestServer({}, async (call) => {
    // The attribution this product exists to protect is the reviewer's NAME.
    // If a request could supply its own, any caller could attribute a decision
    // to a person the project never recorded, so identity comes from the
    // project alone and a body-supplied name is refused with it.
    const res = await call.json('POST', '/api/review-finding', {
      findingId: 'anything',
      decision: 'VERIFIED',
      reviewer: 'Dr. Who',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'REVIEWER_REQUIRED');
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
    // A real project, not the seeded demo one. Demo projects are re-seeded
    // rather than restored, so a reviewer named on one is expected to be gone.
    // This used to name the demo project and appear to pass, but only because
    // the persistence directory option was being ignored and it was reading the
    // repository's own data/ directory.
    const persistence1 = new WorkspacePersistence({ directory: dir });
    let findingId = '';
    await withTestServer({ persistence: persistence1 }, async (call) => {
      const created = await call.json('POST', '/api/projects', { name: 'Persisted' });
      assert.equal(created.status, 201);

      await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });
      const up = await call.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
      assert.equal(up.status, 200, 'the capture must be stored in the named directory');
      const uploaded = JSON.parse(up.body.toString('utf8')).capture.id;
      // Select it explicitly. Uploading appends to the open group, but a project
      // created here starts with no selection at all, and a run with nothing
      // open is refused before it reaches the model.
      const selected = await call.json('POST', '/api/captures/select', { captureId: uploaded });
      assert.equal(selected.status, 200);

      const run = await call.json('POST', '/api/run', {});
      const finding = run.body.inspectionFindings[0];
      assert.ok(finding, 'the run must produce a finding to review');
      findingId = finding.id;
      const reviewed = await call.json('POST', '/api/review-finding', {
        findingId,
        decision: 'VERIFIED',
      });
      assert.equal(reviewed.status, 200);
    });

    // A genuinely new store against the same directory: this is the restart.
    const persistence2 = new WorkspacePersistence({ directory: dir });
    await withTestServer({ persistence: persistence2 }, async (call) => {
      const ws = await call.json('GET', '/api/workspace');
      assert.equal(ws.status, 200);
      assert.deepEqual(ws.body.project.reviewer, {
        name: 'Takou Rah',
        role: 'Site Engineer',
      });
      // The gate state must be restored too, or the banner would claim the gate
      // is shut after a restart that has just shown a named reviewer.
      assert.equal(ws.body.reviewerGate.required, false);
      assert.ok(ws.body.view);
      const reviewed = ws.body.view.inspectionFindings.find((f: any) => f.id === findingId);
      assert.ok(reviewed, 'the reviewed finding must survive the restart');
      assert.equal(reviewed.verificationStatus, 'VERIFIED');
      assert.match(reviewed.review.reviewer, /Takou Rah/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistence: the named directory is the only one written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-isolation-'));
  try {
    const persistence = new WorkspacePersistence({ directory: dir });
    await withTestServer({ persistence }, async (call) => {
      await call.json('POST', '/api/projects', { name: 'Isolated' });
      await call.json('POST', '/api/reviewer', { name: 'Takou Rah' });
    });
    // The point of honouring the option: a test that named somewhere else must
    // not have written to the repository's own data/ directory.
    assert.ok(existsSync(join(dir, 'workspace.json')),
      'state must be written to the directory the caller named');
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

