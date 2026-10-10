/**
 * The reviewer gate, enforced by the server.
 *
 * A finding only becomes VERIFIED when a named person moves it, and every
 * observation and finding is attributed to that person. Evidence produced with
 * nobody to attribute it cannot be retroactively attributed honestly, so the
 * work is refused BEFORE it happens rather than flagged afterwards.
 *
 * The bug this covers: the gate existed only as a banner in the browser. The
 * banner rendered "REVIEWER REQUIRED" from the client copy of the project while
 * `POST /api/run` returned 200 and produced unattributed findings. A banner is a
 * claim about server state, not the state itself, so the refusal has to live
 * where the state lives.
 *
 * Every test here therefore drives the real HTTP surface and asserts on the
 * real status code, not on a client-side flag.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { INDEX_HTML, APP_JS } from '../src/ui-assets.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface JsonResult { status: number; body: any }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
  raw(method: string, path: string, body: Buffer, contentType: string): Promise<{ status: number; body: Buffer }>;
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

/** Assert the documented refusal: 409 and the machine-readable code. */
function assertRefused(res: JsonResult, what: string): void {
  assert.equal(res.status, 409, `${what} must be refused with 409 while the gate is closed`);
  assert.equal(res.body.error, 'REVIEWER_REQUIRED', `${what} must report REVIEWER_REQUIRED`);
  assert.match(String(res.body.message), /inspection reviewer/i,
    `${what} must say a reviewer is what is missing`);
}

/* ------------------------------------------------------------------ *
 * The gate is closed by default.
 * ------------------------------------------------------------------ */

test('the workspace payload states the gate, and the banner reads that state', async () => {
  await withServer(async (call) => {
    const ws = await call.json('GET', '/api/workspace');
    // The payload the browser renders the banner from. It must exist, so the
    // banner and the refusal cannot disagree about whether the gate is shut.
    assert.ok(ws.body.reviewerGate !== undefined, 'the payload must carry the gate state');
    assert.equal(ws.body.reviewerGate.required, true, 'no reviewer has been named yet');
    assert.match(String(ws.body.reviewerGate.reason), /inspection reviewer/i);
  });
});

test('naming a reviewer opens the gate in the same payload', async () => {
  await withServer(async (call) => {
    const set = await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });
    assert.equal(set.status, 200);
    const ws = await call.json('GET', '/api/workspace');
    assert.equal(ws.body.reviewerGate.required, false, 'a named reviewer opens the gate');
    assert.equal(ws.body.reviewerGate.reason, null);
  });
});

/* ------------------------------------------------------------------ *
 * Every route that produces or attributes evidence is refused.
 * ------------------------------------------------------------------ */

test('a run without a reviewer is refused', async () => {
  await withServer(async (call) => {
    assertRefused(await call.json('POST', '/api/run', {}), 'a run');
  });
});

test('an upload without a reviewer is refused', async () => {
  await withServer(async (call) => {
    const res = await call.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(res.status, 409, 'an upload must be refused with 409');
    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.error, 'REVIEWER_REQUIRED');
  });
});

test('a dataset import without a reviewer is refused', async () => {
  await withServer(async (call) => {
    assertRefused(await call.json('POST', '/api/dataset/import', { id: 'whatever' }), 'a dataset import');
  });
});

test('recording an observation review without a reviewer is refused', async () => {
  await withServer(async (call) => {
    assertRefused(await call.json('POST', '/api/review', {
      observationId: 'any-observation',
      decision: 'VERIFIED',
    }), 'recording a review');
  });
});

test('recording a finding review without a reviewer is refused', async () => {
  await withServer(async (call) => {
    assertRefused(await call.json('POST', '/api/review-finding', {
      findingId: 'any-finding',
      decision: 'VERIFIED',
    }), 'recording a finding review');
  });
});

test('changing a finding state without a reviewer is refused', async () => {
  await withServer(async (call) => {
    // OPEN -> CLOSED is a claim that a human dealt with the finding, which is an
    // attribution and is gated like recording a decision.
    assertRefused(await call.json('POST', '/api/finding-state', {
      findingId: 'any-finding',
      state: 'CLOSED',
    }), 'changing a finding state');
  });
});

/* ------------------------------------------------------------------ *
 * Identity comes from the project, never from the request.
 * ------------------------------------------------------------------ */

test('a reviewer named in the request body does not open the gate', async () => {
  await withServer(async (call) => {
    // Otherwise any caller could attribute a decision to a person the project
    // never recorded, which is the one thing attribution exists to prevent.
    assertRefused(await call.json('POST', '/api/review-finding', {
      findingId: 'any-finding',
      decision: 'VERIFIED',
      reviewer: 'Dr. Who',
    }), 'a review carrying its own reviewer name');
  });
});

test('a blank reviewer name does not open the gate', async () => {
  await withServer(async (call) => {
    const set = await call.json('POST', '/api/reviewer', { name: '   ' });
    assert.notEqual(set.status, 200, 'a blank name must not be accepted');
    assertRefused(await call.json('POST', '/api/run', {}), 'a run after a blank reviewer name');
  });
});

/* ------------------------------------------------------------------ *
 * A refusal must leave nothing behind.
 * ------------------------------------------------------------------ */

test('a refused upload stores nothing', async () => {
  await withServer(async (call) => {
    const before = call.store().captures.size;
    await call.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
    const after = call.store().captures.size;
    assert.equal(after, before,
      'a refused upload must not store the capture it was carrying');
  });
});

test('a refused run performs no inference and leaves no findings', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/run', {});
    const session = await call.json('GET', '/api/session');
    assert.equal(session.body.outcome, 'PENDING',
      'a refused run must leave the session exactly as it was');
    assert.equal(session.body.provenance.inferenceExecuted, false,
      'a refused run must not claim an inference happened');
    assert.equal(session.body.inspectionFindings.length, 0,
      'a refused run must not produce findings nobody is attributed to');
  });
});

test('a refused run costs no provider call', async () => {
  // The refusal is a setup gate, not an inference result, so it must not reach
  // the provider at all. A provider that answered anyway would have been billed
  // for evidence nobody can attribute.
  let calls = 0;
  const handle = createInspectionServer({
    provider: {
      name: 'counting-provider',
      model: 'counting-model-v1',
      inspect: async () => { calls += 1; throw new Error('must not be called'); },
    },
    zoneId: 'zone_level_02',
    initialCaptureId: null,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 409);
    assert.equal(calls, 0, 'the provider must never be reached through a closed gate');
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
});

/* ------------------------------------------------------------------ *
 * Legitimate work still works.
 * ------------------------------------------------------------------ */

test('naming a reviewer reopens every gated route', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Site Engineer' });

    // The review is checked before the upload, because uploading selects a
    // different capture and would move the session out from under the finding
    // this test is reviewing.
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.status, 200, 'a run must work once the gate is open');

    const finding = run.body.inspectionFindings[0];
    assert.ok(finding, 'the run must produce a finding to review');
    const review = await call.json('POST', '/api/review-finding', {
      findingId: finding.id,
      decision: 'VERIFIED',
    });
    assert.equal(review.status, 200, 'a review must work once the gate is open');
    const settled = review.body.inspectionFindings.find((f: any) => f.id === finding.id);
    assert.ok(settled, 'the reviewed finding must come back in the response');
    assert.equal(settled.verificationStatus, 'VERIFIED');
    assert.match(settled.review.reviewer, /Takou Rah/);

    const upload = await call.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
    assert.equal(upload.status, 200, 'an upload must work once the gate is open');

    const state = await call.json('POST', '/api/finding-state', {
      findingId: finding.id,
      state: 'ACKNOWLEDGED',
    });
    assert.equal(state.status, 200, 'changing a finding state must work once the gate is open');
  });
});

test('read-only routes are never gated', async () => {
  await withServer(async (call) => {
    // Reading the instrument must keep working while the gate is closed,
    // otherwise the operator cannot see WHY it is closed.
    for (const path of ['/api/workspace', '/api/session', '/api/projects', '/api/captures', '/api/dataset']) {
      const res = await call.json('GET', path);
      assert.equal(res.status, 200, `${path} is read-only and must not be gated`);
    }
  });
});

test('a reviewer can always be configured, including while the gate is closed', async () => {
  await withServer(async (call) => {
    // The gate must never trap the operator: the action that opens it cannot
    // itself be behind it.
    const set = await call.json('POST', '/api/reviewer', { name: 'Takou Rah' });
    assert.equal(set.status, 200, 'configuring a reviewer must always be possible');
  });
});

test('a reviewer can be changed, not only set once', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/reviewer', { name: 'Takou Rah' });
    const again = await call.json('POST', '/api/reviewer', { name: 'Second Inspector' });
    assert.equal(again.status, 200);
    assert.equal(again.body.project.reviewer.name, 'Second Inspector');
    const ws = await call.json('GET', '/api/workspace');
    assert.equal(ws.body.reviewerGate.required, false, 'the gate stays open across a change');
  });
});

/* ------------------------------------------------------------------ *
 * UI and API agree.
 * ------------------------------------------------------------------ */

test('the served client reacts to the refusal code, not to a status number', async () => {
  // The browser must react to the SERVER's error code. Matching on 409 alone
  // would open the reviewer dialog for any future 409 from an unrelated cause
  // and send the operator to a problem they do not have.
  assert.match(APP_JS, /err\.code = typeof body\.error === 'string' \? body\.error : ''/);
  assert.match(APP_JS, /error\.code === 'REVIEWER_REQUIRED'/);
  assert.match(APP_JS, /payload\.error === 'REVIEWER_REQUIRED'/);
  // The banner reads the payload the server sent, not its own opinion.
  assert.match(APP_JS, /state\.reviewerGate/);
  assert.match(APP_JS, /server\.required === true/);
});

test('the gate banner markup exists and carries the reason', () => {
  assert.match(INDEX_HTML, /id="reviewer-gate"/);
  assert.match(INDEX_HTML, /id="reviewer-gate-reason"/);
  assert.match(INDEX_HTML, /id="reviewer-gate-btn"/);
});