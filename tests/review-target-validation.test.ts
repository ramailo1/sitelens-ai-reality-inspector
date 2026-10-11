// A review that names something this inspection does not hold must be REFUSED.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { WorkspacePersistence } from '../src/persistence.ts';

interface Harness {
  call(method: string, path: string, payload?: unknown): Promise<{ status: number; body: any }>;
  raw(method: string, path: string, bytes: Buffer, contentType: string): Promise<{ status: number; body: Buffer }>;
  close(): Promise<void>;
}

// A 1x1 PNG. Enough to be a real, valid capture for the deterministic fixture.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function startServer(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-review-target-'));
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
    async close() {
      await new Promise<void>((resolve) => handle.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Open a project, name a reviewer, add a real capture, run a real inspection.
async function inspectedWorkspace(h: Harness & {
  raw(method: string, path: string, bytes: Buffer, contentType: string):
    Promise<{ status: number; body: Buffer }>;
}): Promise<any> {
  await h.call('POST', '/api/projects', { name: 'Review Target' });
  await h.call('POST', '/api/reviewer', { name: 'Takou Rah', role: 'Lead Structural Inspector' });

  const up = await h.raw('POST', '/api/upload?name=site.png&type=image/png', PNG, 'application/octet-stream');
  assert.equal(up.status, 200, 'the setup capture must upload');

  const run = await h.call('POST', '/api/run', {});
  assert.equal(run.status, 200, 'the fixture inspection must run');
  return run.body;
}

test('reviewing an unknown observation is refused, not reported as saved', async () => {
  const h = await startServer();
  try {
    const view = await inspectedWorkspace(h);

    const res = await h.call('POST', '/api/review', {
      observationId: 'obs_does_not_exist',
      decision: 'VERIFIED',
    });

    assert.equal(res.status, 404, 'an unknown observation must not answer 200');
    assert.equal(res.body.error, 'UNKNOWN_OBSERVATION');

    // And nothing actually moved: no observation claims a human reviewed it.
    const after = await h.call('GET', '/api/session');
    const reviewed = (after.body.observations as { review: unknown }[])
      .filter((o) => o.review !== null);
    assert.equal(reviewed.length, 0, 'no observation may carry a review from the refused call');
    assert.equal(after.body.provenance.humanReviewPerformed, false);
    assert.ok(view.observations.length > 0, 'the fixture must have supplied real observations');
  } finally {
    await h.close();
  }
});

test('settling an unknown finding is refused, not reported as saved', async () => {
  const h = await startServer();
  try {
    await inspectedWorkspace(h);

    const res = await h.call('POST', '/api/review-finding', {
      findingId: 'fnd_does_not_exist',
      decision: 'VERIFIED',
    });

    assert.equal(res.status, 404, 'an unknown finding must not answer 200');
    assert.equal(res.body.error, 'UNKNOWN_FINDING');

    const after = await h.call('GET', '/api/session');
    const verified = (after.body.inspectionFindings as { verificationStatus: string }[])
      .filter((f) => f.verificationStatus === 'VERIFIED');
    assert.equal(verified.length, 0, 'nothing may be settled by the refused call');
    assert.equal(after.body.counters.verified, 0);
  } finally {
    await h.close();
  }
});

test('changing the state of an unknown finding is refused', async () => {
  const h = await startServer();
  try {
    await inspectedWorkspace(h);

    const res = await h.call('POST', '/api/finding-state', {
      findingId: 'fnd_does_not_exist',
      state: 'CLOSED',
    });

    assert.equal(res.status, 404, 'an unknown finding must not answer 200');
    assert.equal(res.body.error, 'UNKNOWN_FINDING');
  } finally {
    await h.close();
  }
});

test('a real finding still settles, so the refusal is not a blanket block', async () => {
  const h = await startServer();
  try {
    const view = await inspectedWorkspace(h);
    const finding = view.inspectionFindings[0];
    assert.ok(finding, 'the fixture must produce a finding to settle');

    const res = await h.call('POST', '/api/review-finding', {
      findingId: finding.id,
      decision: 'VERIFIED',
    });

    assert.equal(res.status, 200, 'a genuine finding must still settle');
    const settled = res.body.inspectionFindings.find((f: any) => f.id === finding.id);
    assert.equal(settled.verificationStatus, 'VERIFIED');
    assert.match(String(settled.review.reviewer), /Takou Rah/);
  } finally {
    await h.close();
  }
});

test('a real observation still reviews, so the refusal is not a blanket block', async () => {
  const h = await startServer();
  try {
    const view = await inspectedWorkspace(h);
    const observation = view.observations[0];
    assert.ok(observation, 'the fixture must produce an observation to review');

    const res = await h.call('POST', '/api/review', {
      observationId: observation.id,
      decision: 'VERIFIED',
    });

    assert.equal(res.status, 200, 'a genuine observation must still review');
    const settled = res.body.observations.find((o: any) => o.id === observation.id);
    assert.equal(settled.verificationStatus, 'VERIFIED');
  } finally {
    await h.close();
  }
});

test('a verified finding can then be acknowledged through finding-state', async () => {
  const h = await startServer();
  try {
    const view = await inspectedWorkspace(h);
    // finding-state operates on the LEDGER, which only holds findings raised from a human-verified observation.
    const reviewed = await h.call('POST', '/api/review', {
      observationId: view.observations[0].id,
      decision: 'VERIFIED',
    });
    assert.equal(reviewed.status, 200, 'the observation must review');
    // Read the ledger from the session the route just mutated.
    const ledgerFinding = (await h.call('GET', '/api/session')).body.findings[0];
    assert.ok(ledgerFinding, 'verifying an observation must raise a ledger finding');

    const res = await h.call('POST', '/api/finding-state', {
      findingId: ledgerFinding.id,
      state: 'ACKNOWLEDGED',
    });

    assert.equal(res.status, 200, 'a real ledger finding must accept a state change');
    assert.equal(
      res.body.findings.find((f: any) => f.id === ledgerFinding.id).state,
      'ACKNOWLEDGED',
    );
  } finally {
    await h.close();
  }
});

// Extended review integrity, project/capture isolation & persistence audit

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { demoCaptures } from '../src/captures.ts';
import { inspectionCache } from '../src/cache.ts';
import type { AIProvider, InspectRequest, RawProviderResult } from '../src/providers/provider.ts';

interface PersistentHarness extends Harness {
  readonly dir: string;
  readonly persistence: WorkspacePersistence | null;
  upload(name: string, bytes: Buffer, mediaType?: string): Promise<string>;
  stopServer(): Promise<void>;
}

async function startServerWithDir(options: {
  dir?: string;
  durable?: boolean;
  provider?: AIProvider;
} = {}): Promise<PersistentHarness> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'sitelens-review-audit-'));
  const persistence =
    options.durable === false ? null : new WorkspacePersistence({ directory: dir });
  const handle = createInspectionServer({
    provider: options.provider ?? new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
    persistence,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const rawFn = async (method: string, path: string, bytes: Buffer, contentType: string) => {
    const init: RequestInit = { method, headers: { 'Content-Type': contentType } };
    init.body = new Uint8Array(bytes);
    const res = await fetch(base + path, init);
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  };

  return {
    dir,
    persistence,
    async call(method, path, payload) {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: await res.json() };
    },
    raw: rawFn,
    async upload(name: string, bytes: Buffer, mediaType = 'image/png') {
      const res = await rawFn(
        'POST',
        `/api/upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(mediaType)}`,
        bytes,
        'application/octet-stream',
      );
      assert.equal(res.status, 200, `upload of ${name} must succeed`);
      const parsed = JSON.parse(res.body.toString('utf8')) as { capture: { id: string } };
      return parsed.capture.id;
    },
    async stopServer() {
      await new Promise<void>((resolve) => handle.server.close(() => resolve()));
    },
    async close() {
      await new Promise<void>((resolve) => handle.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('foreign observationId from another capture in the same project or another project is refused', async () => {
  const h = await startServerWithDir();
  try {
    // Project A with two distinct captures
    const projA = await h.call('POST', '/api/projects', { name: 'Project Alpha' });
    assert.equal(projA.status, 201);
    const projectAId = projA.body.project.id as string;
    await h.call('POST', '/api/reviewer', { name: 'Alice Chen', role: 'Structural Lead' });

    const cap1Bytes = demoCaptures()[0]!.bytes;
    const cap2Bytes = demoCaptures()[1]!.bytes;

    const capA1Id = await h.upload('a1.png', cap1Bytes);
    await h.call('POST', '/api/captures/select', { captureId: capA1Id });
    const runA1 = await h.call('POST', '/api/run', { captureId: capA1Id });
    assert.equal(runA1.status, 200);
    const obsA1 = runA1.body.observations[0];
    assert.ok(obsA1);

    const capA2Id = await h.upload('a2.png', cap2Bytes);
    await h.call('POST', '/api/captures/select', { captureId: capA2Id });
    const runA2 = await h.call('POST', '/api/run', { captureId: capA2Id });
    assert.equal(runA2.status, 200);
    const obsA2 = runA2.body.observations[0];
    assert.ok(obsA2);
    assert.notEqual(obsA1.id, obsA2.id);

    // While capA2 is active, reviewing obsA1 (another capture in the same project) must fail 404
    const crossCaptureReview = await h.call('POST', '/api/review', {
      observationId: obsA1.id,
      decision: 'VERIFIED',
    });
    assert.equal(crossCaptureReview.status, 404);
    assert.equal(crossCaptureReview.body.error, 'UNKNOWN_OBSERVATION');

    // Project B with its own reviewer and capture
    const projB = await h.call('POST', '/api/projects', { name: 'Project Beta' });
    assert.equal(projB.status, 201);
    await h.call('POST', '/api/reviewer', { name: 'Bob Malik', role: 'QA Inspector' });
    const capB1Id = await h.upload('b1.png', cap1Bytes);
    await h.call('POST', '/api/captures/select', { captureId: capB1Id });
    const runB1 = await h.call('POST', '/api/run', { captureId: capB1Id });
    assert.equal(runB1.status, 200);

    // Reviewing Project A's observation while Project B is active must fail 404
    const crossProjectReview = await h.call('POST', '/api/review', {
      observationId: obsA2.id,
      decision: 'VERIFIED',
    });
    assert.equal(crossProjectReview.status, 404);
    assert.equal(crossProjectReview.body.error, 'UNKNOWN_OBSERVATION');

    // Verify Project A's captures remained completely unreviewed
    await h.call('POST', '/api/projects/switch', { projectId: projectAId });
    await h.call('POST', '/api/captures/select', { captureId: capA1Id });
    const viewA1 = (await h.call('GET', '/api/session')).body;
    assert.equal(viewA1.observations.every((o: any) => o.verificationStatus === 'UNVERIFIED'), true);
    assert.equal(viewA1.findings.length, 0);

    await h.call('POST', '/api/captures/select', { captureId: capA2Id });
    const viewA2 = (await h.call('GET', '/api/session')).body;
    assert.equal(viewA2.observations.every((o: any) => o.verificationStatus === 'UNVERIFIED'), true);
    assert.equal(viewA2.findings.length, 0);
  } finally {
    await h.close();
  }
});

test('stale observationId and findingId after reference change or superseded run are refused', async () => {
  const h = await startServerWithDir();
  try {
    const firstRun = await inspectedWorkspace(h);
    const staleObsId = firstRun.observations[0].id as string;
    const staleFindingId = firstRun.inspectionFindings[0].id as string;

    // Re-running the inspection supersedes the previous run's observation IDs
    const secondRun = await h.call('POST', '/api/run', {});
    assert.equal(secondRun.status, 200);
    const freshObsId = secondRun.body.observations[0].id as string;
    assert.notEqual(staleObsId, freshObsId, 'each run generates distinct observation IDs');

    const staleObsRes = await h.call('POST', '/api/review', {
      observationId: staleObsId,
      decision: 'VERIFIED',
    });
    assert.equal(staleObsRes.status, 404, 'superseded observationId must be refused');
    assert.equal(staleObsRes.body.error, 'UNKNOWN_OBSERVATION');

    // Changing the reference preset invalidates the active session's inspection outcome
    const refChange = await h.call('POST', '/api/expected', {
      presetId: 'south-wing',
    });
    assert.equal(refChange.status, 200);

    const afterRefObs = await h.call('POST', '/api/review', {
      observationId: freshObsId,
      decision: 'VERIFIED',
    });
    assert.equal(afterRefObs.status, 404, 'observationId after reference change must be refused');
    assert.equal(afterRefObs.body.error, 'UNKNOWN_OBSERVATION');

    const afterRefFinding = await h.call('POST', '/api/review-finding', {
      findingId: staleFindingId,
      decision: 'VERIFIED',
    });
    assert.equal(afterRefFinding.status, 404, 'findingId after reference change must be refused');
    assert.equal(afterRefFinding.body.error, 'UNKNOWN_FINDING');
  } finally {
    await h.close();
  }
});

test('request body reviewer cannot spoof or override the active project reviewer', async () => {
  const h = await startServerWithDir();
  try {
    const view = await inspectedWorkspace(h);
    const obsId = view.observations[0].id as string;
    const findingId = view.inspectionFindings[0].id as string;

    const revObs = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
      reviewer: 'Spoofed Attacker · Fake Role',
      note: 'verified obs',
    });
    assert.equal(revObs.status, 200);
    const updatedObs = revObs.body.observations.find((o: any) => o.id === obsId);
    assert.equal(updatedObs.review.reviewer, 'Takou Rah · Lead Structural Inspector');

    const revFind = await h.call('POST', '/api/review-finding', {
      findingId,
      decision: 'VERIFIED',
      reviewer: 'Spoofed Attacker · Fake Role',
      note: 'verified finding',
    });
    assert.equal(revFind.status, 200);
    const updatedFind = revFind.body.inspectionFindings.find((f: any) => f.id === findingId);
    assert.equal(updatedFind.review.reviewer, 'Takou Rah · Lead Structural Inspector');
  } finally {
    await h.close();
  }
});

test('passing a synthesized inspection findingId to /api/finding-state is refused with 404', async () => {
  const h = await startServerWithDir();
  try {
    const view = await inspectedWorkspace(h);
    const synthesizedFindingId = view.inspectionFindings[0].id as string;

    // Even after verifying the synthesized inspection finding, it is NOT a ledger finding
    const settled = await h.call('POST', '/api/review-finding', {
      findingId: synthesizedFindingId,
      decision: 'VERIFIED',
    });
    assert.equal(settled.status, 200);

    const stateRes = await h.call('POST', '/api/finding-state', {
      findingId: synthesizedFindingId,
      state: 'ACKNOWLEDGED',
    });
    assert.equal(stateRes.status, 404);
    assert.equal(stateRes.body.error, 'UNKNOWN_FINDING');
  } finally {
    await h.close();
  }
});

test('repeated VERIFIED on an observation deduplicates ledger finding and REJECTED removes it', async () => {
  const h = await startServerWithDir();
  try {
    const view = await inspectedWorkspace(h);
    const obsId = view.observations[0].id as string;

    const firstVerify = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
      note: 'First check',
    });
    assert.equal(firstVerify.status, 200);
    assert.equal(firstVerify.body.findings.length, 1);
    const ledgerId = firstVerify.body.findings[0].id as string;

    // Acknowledge the ledger finding
    const ack = await h.call('POST', '/api/finding-state', {
      findingId: ledgerId,
      state: 'ACKNOWLEDGED',
    });
    assert.equal(ack.status, 200);

    // Repeating VERIFIED on the same observation must update in place, keeping id and state
    const secondVerify = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
      note: 'Updated note',
    });
    assert.equal(secondVerify.status, 200);
    assert.equal(secondVerify.body.findings.length, 1, 'must not create duplicate ledger findings');
    assert.equal(secondVerify.body.findings[0].id, ledgerId);
    assert.equal(secondVerify.body.findings[0].state, 'ACKNOWLEDGED');

    // Changing the observation decision to REJECTED removes it from the verified ledger
    const rejected = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'REJECTED',
      note: 'False alarm on closer inspection',
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.findings.length, 0, 'rejected observation must leave the ledger');
  } finally {
    await h.close();
  }
});

test('multi-project, multi-capture, and multi-finding isolation prevents cross-contamination', async () => {
  const h = await startServerWithDir();
  try {
    // Project 1
    const p1 = await h.call('POST', '/api/projects', { name: 'North Tower' });
    const p1Id = p1.body.project.id as string;
    await h.call('POST', '/api/reviewer', { name: 'Reviewer One', role: 'PE' });

    const capAId = await h.upload('north-a.png', demoCaptures()[0]!.bytes);
    await h.call('POST', '/api/captures/select', { captureId: capAId });
    const viewA = (await h.call('POST', '/api/run', { captureId: capAId })).body;

    const capBId = await h.upload('north-b.png', demoCaptures()[1]!.bytes);
    await h.call('POST', '/api/captures/select', { captureId: capBId });
    const viewB = (await h.call('POST', '/api/run', { captureId: capBId })).body;

    // Project 2
    const p2 = await h.call('POST', '/api/projects', { name: 'South Podium' });
    const p2Id = p2.body.project.id as string;
    await h.call('POST', '/api/reviewer', { name: 'Reviewer Two', role: 'Architect' });

    const capCId = await h.upload('south-c.png', demoCaptures()[0]!.bytes);
    await h.call('POST', '/api/captures/select', { captureId: capCId });
    const viewC = (await h.call('POST', '/api/run', { captureId: capCId })).body;

    // In Project 1, Capture A: verify finding[0], reject finding[1], leave finding[2] unverified
    await h.call('POST', '/api/projects/switch', { projectId: p1Id });
    await h.call('POST', '/api/captures/select', { captureId: capAId });
    assert.ok(viewA.inspectionFindings.length >= 3);
    const fA0 = viewA.inspectionFindings[0].id as string;
    const fA1 = viewA.inspectionFindings[1].id as string;
    const fA2 = viewA.inspectionFindings[2].id as string;

    await h.call('POST', '/api/review-finding', { findingId: fA0, decision: 'VERIFIED', note: 'A0 ok' });
    await h.call('POST', '/api/review-finding', { findingId: fA1, decision: 'REJECTED', note: 'A1 no' });

    const sessionA = (await h.call('GET', '/api/session')).body;
    assert.equal(sessionA.inspectionFindings.find((f: any) => f.id === fA0).verificationStatus, 'VERIFIED');
    assert.equal(sessionA.inspectionFindings.find((f: any) => f.id === fA0).review.reviewer, 'Reviewer One · PE');
    assert.equal(sessionA.inspectionFindings.find((f: any) => f.id === fA1).verificationStatus, 'REJECTED');
    assert.equal(sessionA.inspectionFindings.find((f: any) => f.id === fA2).verificationStatus, 'UNVERIFIED');
    for (const f of sessionA.inspectionFindings) {
      assert.deepEqual(f.sourceCaptureIds, [capAId]);
    }

    // Switch to Capture B in Project 1: all findings must still be UNVERIFIED
    await h.call('POST', '/api/captures/select', { captureId: capBId });
    const sessionB = (await h.call('GET', '/api/session')).body;
    assert.equal(sessionB.provenance.captureId, capBId);
    assert.equal(sessionB.inspectionFindings.every((f: any) => f.verificationStatus === 'UNVERIFIED'), true);
    for (const f of sessionB.inspectionFindings) {
      assert.deepEqual(f.sourceCaptureIds, [capBId]);
    }
    assert.ok(viewB.inspectionFindings.length > 0);

    // Switch to Project 2, Capture C (which has identical bytes to Capture A): all findings must be UNVERIFIED
    await h.call('POST', '/api/projects/switch', { projectId: p2Id });
    await h.call('POST', '/api/captures/select', { captureId: capCId });
    const sessionC = (await h.call('GET', '/api/session')).body;
    assert.equal(sessionC.provenance.projectId, p2Id);
    assert.equal(sessionC.provenance.captureId, capCId);
    assert.equal(sessionC.inspectionFindings.every((f: any) => f.verificationStatus === 'UNVERIFIED'), true);
    assert.ok(viewC.inspectionFindings.length > 0);

    // Verify finding[0] in Project 2 -> attributed to Reviewer Two, never overwrites Project 1
    const fC0 = sessionC.inspectionFindings[0].id as string;
    await h.call('POST', '/api/review-finding', { findingId: fC0, decision: 'NEEDS_REVIEW', note: 'P2 check' });
    const sessionCAfter = (await h.call('GET', '/api/session')).body;
    assert.equal(sessionCAfter.inspectionFindings.find((f: any) => f.id === fC0).verificationStatus, 'NEEDS_REVIEW');
    assert.equal(sessionCAfter.inspectionFindings.find((f: any) => f.id === fC0).review.reviewer, 'Reviewer Two · Architect');

    // Switch back to Project 1, Capture A: still VERIFIED by Reviewer One
    await h.call('POST', '/api/projects/switch', { projectId: p1Id });
    await h.call('POST', '/api/captures/select', { captureId: capAId });
    const sessionAReturn = (await h.call('GET', '/api/session')).body;
    assert.equal(sessionAReturn.inspectionFindings.find((f: any) => f.id === fA0).verificationStatus, 'VERIFIED');
    assert.equal(sessionAReturn.inspectionFindings.find((f: any) => f.id === fA0).review.reviewer, 'Reviewer One · PE');
  } finally {
    await h.close();
  }
});

test('multi-photo group inspections persist under distinct group keys without colliding on unknown.json', async () => {
  const h = await startServerWithDir();
  try {
    await h.call('POST', '/api/projects', { name: 'Group Project A' });
    await h.call('POST', '/api/reviewer', { name: 'Eng A' });
    const capA1Id = await h.upload('a1.png', demoCaptures()[0]!.bytes);
    const capA2Id = await h.upload('a2.png', demoCaptures()[1]!.bytes);
    const groupA = [capA1Id, capA2Id];

    const runGroupA = await h.call('POST', '/api/run', { captureIds: groupA });
    assert.equal(runGroupA.status, 200);
    const findingA = runGroupA.body.inspectionFindings[0].id as string;
    const revA = await h.call('POST', '/api/review-finding', {
      findingId: findingA,
      decision: 'VERIFIED',
      note: 'Group A verified',
    });
    assert.equal(revA.status, 200);

    const groupKeyA = `grp_${groupA.join('+')}`;
    assert.ok(h.persistence);
    assert.equal(
      existsSync(h.persistence.inspectionFile(groupKeyA)),
      true,
      'multi-photo group inspection must be written under its own group key file',
    );
    assert.equal(
      existsSync(join(h.dir, 'inspections', 'unknown.json')),
      false,
      'multi-photo group key must never fall back to unknown.json',
    );
  } finally {
    await h.close();
  }
});

test('Scenario A: observation reviews, ledger finding states, and inspection finding reviews all survive server restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-scenario-a-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });

    // Project 1: inspected capture + newer uninspected capture
    const p1 = await h1.call('POST', '/api/projects', { name: 'Durable Tower' });
    const p1Id = p1.body.project.id as string;
    await h1.call('POST', '/api/reviewer', { name: 'Nadia Mansour', role: 'Site QA' });

    const cap1Id = await h1.upload('inspected.png', demoCaptures()[0]!.bytes);
    await h1.call('POST', '/api/captures/select', { captureId: cap1Id });
    const run1 = await h1.call('POST', '/api/run', { captureId: cap1Id });
    assert.equal(run1.status, 200);

    const obsId = run1.body.observations[0].id as string;
    const synthFindingId = run1.body.inspectionFindings[0].id as string;

    // 1. Verify observation -> raises ledger finding
    const revObs = await h1.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
      note: 'Observation verified on site',
    });
    assert.equal(revObs.status, 200);
    const ledgerFindingId = revObs.body.findings[0].id as string;

    // 2. Transition ledger finding to CLOSED
    const closedLedger = await h1.call('POST', '/api/finding-state', {
      findingId: ledgerFindingId,
      state: 'CLOSED',
    });
    assert.equal(closedLedger.status, 200);

    // 3. Verify synthesized inspection finding
    const revSynth = await h1.call('POST', '/api/review-finding', {
      findingId: synthFindingId,
      decision: 'VERIFIED',
      note: 'Comparison finding verified',
    });
    assert.equal(revSynth.status, 200);

    // Add a second, uninspected capture to Project 1 so we also verify default selection after restart
    await h1.upload('uninspected.png', demoCaptures()[1]!.bytes);

    // Switch to a second project before stopping so we test switching back to Project 1 after restart
    await h1.call('POST', '/api/projects', { name: 'Second Project' });
    await h1.stopServer();
    h1 = null;

    // Restart server against the same directory
    h2 = await startServerWithDir({ dir, durable: true });
    const sw = await h2.call('POST', '/api/projects/switch', { projectId: p1Id });
    assert.equal(sw.status, 200);
    // Must prefer the inspected capture on disk (`cap1Id`) over the newer uninspected capture
    assert.equal(sw.body.activeCaptureId, cap1Id);

    const restoredSession = (await h2.call('GET', '/api/session')).body;
    assert.equal(restoredSession.outcome, 'COMPLETED');
    assert.equal(restoredSession.provenance.humanReviewPerformed, true);

    const restoredObs = restoredSession.observations.find((o: any) => o.id === obsId);
    assert.ok(restoredObs, 'original observation ID must be preserved across restart');
    assert.equal(restoredObs.verificationStatus, 'VERIFIED');
    assert.equal(restoredObs.review.reviewer, 'Nadia Mansour · Site QA');
    assert.equal(restoredObs.review.note, 'Observation verified on site');
    assert.equal(restoredObs.findingId, ledgerFindingId);

    assert.equal(restoredSession.findings.length, 1, 'ledger finding must survive restart');
    assert.equal(restoredSession.findings[0].id, ledgerFindingId);
    assert.equal(restoredSession.findings[0].state, 'CLOSED', 'ledger finding state must survive restart');

    const restoredSynth = restoredSession.inspectionFindings.find((f: any) => f.id === synthFindingId);
    assert.ok(restoredSynth, 'synthesized finding must survive restart');
    assert.equal(restoredSynth.verificationStatus, 'VERIFIED');
    assert.equal(restoredSynth.review.reviewer, 'Nadia Mansour · Site QA');
    assert.equal(restoredSynth.review.note, 'Comparison finding verified');
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Scenario B: when persistence is disabled, storage is reported as process memory and nothing persists across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-scenario-b-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: false });
    const ws1 = (await h1.call('GET', '/api/workspace')).body;
    assert.equal(ws1.storage.durable, false);
    assert.equal(ws1.storage.location, 'process memory');

    const view = await inspectedWorkspace(h1);
    const findingId = view.inspectionFindings[0].id as string;
    const rev = await h1.call('POST', '/api/review-finding', {
      findingId,
      decision: 'VERIFIED',
      note: 'In-memory only',
    });
    assert.equal(rev.status, 200);
    assert.equal(existsSync(join(dir, 'workspace.json')), false, 'no workspace file may be written');
    assert.equal(existsSync(join(dir, 'inspections')), false, 'no inspections dir may be written');

    await h1.stopServer();
    h1 = null;

    h2 = await startServerWithDir({ dir, durable: false });
    const ws2 = (await h2.call('GET', '/api/workspace')).body;
    assert.equal(
      ws2.projects.some((p: any) => p.name === 'Review Target'),
      false,
      'in-memory projects must not survive restart',
    );
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Scenario C: when durable persistence fails during review routes, server returns 500 PERSISTENCE_FAILED and rolls back in-memory state', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    const view = await inspectedWorkspace(h);
    const obsId = view.observations[0].id as string;
    const synthFindingId = view.inspectionFindings[0].id as string;

    // Make saveInspection fail to simulate disk/permission failure while persistence is enabled
    assert.ok(h.persistence);
    const origSave = h.persistence.saveInspection.bind(h.persistence);
    h.persistence.saveInspection = () => false;

    // 1. POST /api/review must return 500 and roll back the observation review + ledger finding
    const failedObsReview = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
      note: 'Should roll back',
    });
    assert.equal(failedObsReview.status, 500);
    assert.equal(failedObsReview.body.error, 'PERSISTENCE_FAILED');

    const afterObsFail = (await h.call('GET', '/api/session')).body;
    assert.equal(
      afterObsFail.observations.find((o: any) => o.id === obsId).verificationStatus,
      'UNVERIFIED',
      'observation must roll back to UNVERIFIED when persistence fails',
    );
    assert.equal(afterObsFail.findings.length, 0, 'ledger must remain empty after rollback');

    // 2. POST /api/review-finding must return 500 and roll back the finding review
    const failedFindReview = await h.call('POST', '/api/review-finding', {
      findingId: synthFindingId,
      decision: 'VERIFIED',
      note: 'Should roll back',
    });
    assert.equal(failedFindReview.status, 500);
    assert.equal(failedFindReview.body.error, 'PERSISTENCE_FAILED');

    const afterFindFail = (await h.call('GET', '/api/session')).body;
    assert.equal(
      afterFindFail.inspectionFindings.find((f: any) => f.id === synthFindingId).verificationStatus,
      'UNVERIFIED',
      'inspection finding must roll back to UNVERIFIED when persistence fails',
    );

    // 3. Restore saveInspection so we can create a ledger finding, then fail on POST /api/finding-state
    h.persistence.saveInspection = origSave;
    const okObsReview = await h.call('POST', '/api/review', {
      observationId: obsId,
      decision: 'VERIFIED',
    });
    assert.equal(okObsReview.status, 200);
    const ledgerId = okObsReview.body.findings[0].id as string;

    h.persistence.saveInspection = () => false;
    const failedState = await h.call('POST', '/api/finding-state', {
      findingId: ledgerId,
      state: 'CLOSED',
    });
    assert.equal(failedState.status, 500);
    assert.equal(failedState.body.error, 'PERSISTENCE_FAILED');

    const afterStateFail = (await h.call('GET', '/api/session')).body;
    assert.equal(
      afterStateFail.findings.find((f: any) => f.id === ledgerId).state,
      'OPEN',
      'ledger finding state must roll back to OPEN when persistence fails',
    );
  } finally {
    await h.close();
  }
});

test('content-addressed cache hit preserves capture and project scoping without leaking review state', async () => {
  inspectionCache.clear();
  let calls = 0;
  const stubProvider: AIProvider = {
    name: 'nebius-nvidia',
    model: 'openbmb/MiniCPM-V-4_5',
    async inspect(_req: InspectRequest): Promise<RawProviderResult> {
      calls += 1;
      return {
        provider: 'nebius-nvidia',
        model: 'openbmb/MiniCPM-V-4_5',
        observations: [
          {
            category: 'OBSERVED_ELEMENT',
            observation: 'Visible reinforcement mat across north bay.',
            evidence: { description: 'Dense rebar grid visible in lower frame.' },
            confidence: 0.85,
            severity: 'INFO',
            suggested_action: 'HUMAN_REVIEW',
            bounding_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
          },
        ],
        elements: [
          {
            element: 'REBAR',
            present: true,
            count: null,
            confidence: 0.9,
            evidence: 'Dense rebar grid visible.',
            bounding_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
          },
        ],
        findings: [],
      };
    },
  };

  const h = await startServerWithDir({ provider: stubProvider });
  try {
    // Project 1
    const p1 = await h.call('POST', '/api/projects', { name: 'Cache Project 1' });
    const p1Id = p1.body.project.id as string;
    await h.call('POST', '/api/reviewer', { name: 'Cache Reviewer 1' });
    const cap1Id = await h.upload('same.png', PNG);
    const run1 = await h.call('POST', '/api/run', { captureId: cap1Id, cache: true });
    assert.equal(run1.status, 200);
    assert.equal(run1.body.inferenceOrigin, 'FRESH');
    assert.equal(calls, 1);

    // Verify observation in Project 1
    const obs1Id = run1.body.observations[0].id as string;
    await h.call('POST', '/api/review', { observationId: obs1Id, decision: 'VERIFIED' });

    // Project 2 with identical image bytes and cache: true
    const p2 = await h.call('POST', '/api/projects', { name: 'Cache Project 2' });
    const p2Id = p2.body.project.id as string;
    await h.call('POST', '/api/reviewer', { name: 'Cache Reviewer 2' });
    const cap2Id = await h.upload('same.png', PNG);
    const run2 = await h.call('POST', '/api/run', { captureId: cap2Id, cache: true });
    assert.equal(run2.status, 200);
    assert.equal(run2.body.inferenceOrigin, 'CACHED', 'cache hit must be labelled CACHED');
    assert.equal(calls, 1, 'provider must not be called a second time on cache hit');

    // Ownership and review state on Project 2 must be strictly isolated
    assert.equal(run2.body.provenance.projectId, p2Id);
    assert.equal(run2.body.provenance.captureId, cap2Id);
    assert.equal(run2.body.observations[0].captureId, cap2Id);
    assert.notEqual(run2.body.observations[0].id, obs1Id);
    assert.equal(run2.body.observations[0].verificationStatus, 'UNVERIFIED');
    assert.equal(run2.body.findings.length, 0);
    assert.equal(run1.body.provenance.projectId, p1Id);
  } finally {
    inspectionCache.clear();
    await h.close();
  }
});

test('Scenario C: corrupt inspection JSON on disk is ignored cleanly on restore without crashing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-corrupt-insp-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });
    const view = await inspectedWorkspace(h1);
    const capId = view.provenance.captureId as string;
    assert.ok(h1.persistence);
    const inspPath = h1.persistence.inspectionFile(capId);
    assert.equal(existsSync(inspPath), true);
    await h1.stopServer();
    h1 = null;

    // Corrupt the persisted inspection file on disk
    writeFileSync(inspPath, '{ corrupt json !!!', 'utf8');

    h2 = await startServerWithDir({ dir, durable: true });
    const session = (await h2.call('GET', '/api/session')).body;
    // The project and capture survive, and the corrupt inspection file fails closed to PENDING
    assert.equal(session.outcome, 'PENDING');
    assert.equal(session.observations.length, 0);
    assert.equal(session.findings.length, 0);
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review and finding-state routes refuse when no reviewer is configured or when no active capture exists', async () => {
  const h = await startServerWithDir();
  try {
    // Create a fresh project (no reviewer configured, no captures uploaded)
    const p = await h.call('POST', '/api/projects', { name: 'Empty Project' });
    assert.equal(p.status, 201);

    // Without reviewer -> 409 REVIEWER_REQUIRED across all three review/state routes
    for (const [route, payload] of [
      ['/api/review', { observationId: 'obs_1', decision: 'VERIFIED' }],
      ['/api/review-finding', { findingId: 'ifind_1', decision: 'VERIFIED' }],
      ['/api/finding-state', { findingId: 'find_1', state: 'ACKNOWLEDGED' }],
    ] as const) {
      const res = await h.call('POST', route, payload);
      assert.equal(res.status, 409, `${route} without reviewer must return 409`);
      assert.equal(res.body.error, 'REVIEWER_REQUIRED');
    }

    // Configure reviewer on the empty project (still no captures) -> 400 NO_ACTIVE_CAPTURE
    await h.call('POST', '/api/reviewer', { name: 'Nadia Mansour' });
    for (const [route, payload] of [
      ['/api/review', { observationId: 'obs_1', decision: 'VERIFIED' }],
      ['/api/review-finding', { findingId: 'ifind_1', decision: 'VERIFIED' }],
      ['/api/finding-state', { findingId: 'find_1', state: 'ACKNOWLEDGED' }],
    ] as const) {
      const res = await h.call('POST', route, payload);
      assert.equal(res.status, 400, `${route} without active capture must return 400`);
      assert.equal(res.body.error, 'NO_ACTIVE_CAPTURE');
    }
  } finally {
    await h.close();
  }
});

test('Scenario C: missing uploaded capture file on disk during restore is skipped cleanly without hanging a dead reference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-missing-cap-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });
    await h1.call('POST', '/api/projects', { name: 'Missing File Project' });
    await h1.call('POST', '/api/reviewer', { name: 'Nadia Mansour' });
    const keptCapId = await h1.upload('kept.png', demoCaptures()[0]!.bytes);
    const deletedCapId = await h1.upload('deleted.png', demoCaptures()[1]!.bytes);
    assert.ok(h1.persistence);
    const deletedPath = join(dir, 'uploads', `${deletedCapId}.png`);
    assert.equal(existsSync(deletedPath), true);
    await h1.stopServer();
    h1 = null;

    // Delete the uploaded image file from disk before restarting
    rmSync(deletedPath, { force: true });

    h2 = await startServerWithDir({ dir, durable: true });
    const ws = (await h2.call('GET', '/api/workspace')).body;
    const captureIds = ws.captures.map((c: any) => c.id);
    assert.equal(captureIds.includes(keptCapId), true, 'existing capture file must be restored');
    assert.equal(captureIds.includes(deletedCapId), false, 'missing capture file must not be exposed as a broken capture');
    assert.equal(ws.activeCaptureId, keptCapId);
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Rollback, ledger lifecycle, group isolation and tamper resistance

test('a failed persistence also rolls back an inspection-finding review', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    const view = await inspectedWorkspace(h);
    const findingId = view.inspectionFindings[0].id as string;

    // Prime a real decision so the rollback is observable against a non-empty map.
    const first = await h.call('POST', '/api/review-finding', {
      findingId, decision: 'NEEDS_REVIEW', note: 'first pass',
    });
    assert.equal(first.status, 200);

    assert.ok(h.persistence);
    h.persistence.saveInspection = () => false;

    const failed = await h.call('POST', '/api/review-finding', {
      findingId, decision: 'VERIFIED', note: 'second pass',
    });
    assert.equal(failed.status, 500, 'a failed durable write must not answer 200');
    assert.equal(failed.body.error, 'PERSISTENCE_FAILED');

    const after = (await h.call('GET', '/api/session')).body;
    const settled = after.inspectionFindings.find((f: any) => f.id === findingId);
    assert.equal(settled.verificationStatus, 'NEEDS_REVIEW', 'the refused review must not apply');
    assert.equal(settled.review.note, 'first pass', 'the earlier decision and note must survive');
  } finally {
    await h.close();
  }
});

test('NEEDS_REVIEW and REJECTED both drop the verified ledger entry, and re-verifying raises a fresh one', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    const view = await inspectedWorkspace(h);
    const obsId = view.observations[0].id as string;

    const verified = await h.call('POST', '/api/review', {
      observationId: obsId, decision: 'VERIFIED',
    });
    assert.equal(verified.body.findings.length, 1);

    // NEEDS_REVIEW is a deferral, not a confirmation: it is not a verified finding.
    const deferred = await h.call('POST', '/api/review', {
      observationId: obsId, decision: 'NEEDS_REVIEW',
    });
    assert.equal(deferred.body.findings.length, 0, 'NEEDS_REVIEW must leave the ledger');

    const rejected = await h.call('POST', '/api/review', {
      observationId: obsId, decision: 'REJECTED',
    });
    assert.equal(rejected.body.findings.length, 0, 'REJECTED must leave the ledger');

    const reVerified = await h.call('POST', '/api/review', {
      observationId: obsId, decision: 'VERIFIED',
    });
    assert.equal(reVerified.body.findings.length, 1, 'a later verification must raise a finding again');
    assert.notEqual(
      reVerified.body.findings[0].id,
      verified.body.findings[0].id,
      'a finding dropped from the ledger must not come back under its old id',
    );
  } finally {
    await h.close();
  }
});

test('a ledger finding from one project cannot be triaged while another project is open', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    const view = await inspectedWorkspace(h);
    const obsId = view.observations[0].id as string;
    const raised = await h.call('POST', '/api/review', {
      observationId: obsId, decision: 'VERIFIED',
    });
    const ledgerId = raised.body.findings[0].id as string;

    // A different project, with its own reviewer and capture.
    const other = await h.call('POST', '/api/projects', { name: 'Other Project' });
    assert.equal(other.status, 201);
    await h.call('POST', '/api/reviewer', { name: 'Dana Iyer', role: 'Clerk of Works' });
    await h.upload('other.png', demoCaptures()[1]!.bytes);

    const foreign = await h.call('POST', '/api/finding-state', {
      findingId: ledgerId, state: 'CLOSED',
    });
    assert.equal(foreign.status, 404, 'another project must never close this project\'s finding');
    assert.equal(foreign.body.error, 'UNKNOWN_FINDING');

    // And the original project's finding is untouched.
    const ws = (await h.call('GET', '/api/workspace')).body;
    const originalProject = ws.projects.find((p: any) => p.name === 'Review Target');
    assert.ok(originalProject, 'the original project must still exist');
    await h.call('POST', '/api/projects/switch', { projectId: originalProject.id });
    await h.call('POST', '/api/captures/select', { captureId: view.provenance.captureId });
    const restored = (await h.call('GET', '/api/session')).body;
    assert.equal(restored.findings.length, 1);
    assert.equal(restored.findings[0].state, 'OPEN', 'the foreign call must not have moved the state');
  } finally {
    await h.close();
  }
});

test('a multi-photo group keeps observations, reviews and ledger state across a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-group-restart-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });
    const project = await h1.call('POST', '/api/projects', { name: 'Group Restart' });
    await h1.call('POST', '/api/reviewer', { name: 'Nadia Mansour', role: 'Site QA' });
    const capA = await h1.upload('group-a.png', demoCaptures()[0]!.bytes);
    const capB = await h1.upload('group-b.png', demoCaptures()[1]!.bytes);

    const run = await h1.call('POST', '/api/run', { captureIds: [capA, capB] });
    assert.equal(run.status, 200);
    const fromB = run.body.observations.find((o: any) => o.captureId === capB);
    assert.ok(fromB, 'the group inspection must report which photograph produced each observation');

    const reviewed = await h1.call('POST', '/api/review', {
      observationId: fromB.id, decision: 'VERIFIED', note: 'Confirmed on the second frame',
    });
    assert.equal(reviewed.status, 200);
    const ledgerId = reviewed.body.findings[0].id as string;
    const closed = await h1.call('POST', '/api/finding-state', {
      findingId: ledgerId, state: 'CLOSED',
    });
    assert.equal(closed.status, 200);

    await h1.stopServer();
    h1 = null;

    h2 = await startServerWithDir({ dir, durable: true });
    const session = (await h2.call('GET', '/api/session')).body;
    assert.equal(session.outcome, 'COMPLETED');
    const restored = session.observations.find((o: any) => o.id === fromB.id);
    assert.ok(restored, 'the second frame\'s observation must keep its id across the restart');
    assert.equal(restored.captureId, capB, 'and it must stay attributed to its own photograph');
    assert.equal(restored.verificationStatus, 'VERIFIED');
    assert.equal(restored.review.reviewer, 'Nadia Mansour · Site QA');
    assert.equal(restored.review.note, 'Confirmed on the second frame');
    assert.equal(session.findings.length, 1, 'the ledger finding must survive the restart');
    assert.equal(session.findings[0].id, ledgerId);
    assert.equal(session.findings[0].state, 'CLOSED');

    void project;
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting one photograph of a group removes the group\'s persisted inspection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-group-delete-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });
    await h1.call('POST', '/api/projects', { name: 'Group Delete' });
    await h1.call('POST', '/api/reviewer', { name: 'Eng A' });
    const capA = await h1.upload('gd-a.png', demoCaptures()[0]!.bytes);
    const capB = await h1.upload('gd-b.png', demoCaptures()[1]!.bytes);

    const run = await h1.call('POST', '/api/run', { captureIds: [capA, capB] });
    assert.equal(run.status, 200);
    const reviewed = await h1.call('POST', '/api/review', {
      observationId: run.body.observations[0].id, decision: 'VERIFIED',
    });
    assert.equal(reviewed.body.findings.length, 1);

    const groupFile = join(dir, 'inspections', `grp_${capA}+${capB}.json`);
    assert.equal(existsSync(groupFile), true, 'the group inspection must have been written');

    const del = await h1.call('DELETE', `/api/captures/${capA}`);
    assert.equal(del.status, 200, 'deleting a group member must be accepted');

    assert.equal(
      existsSync(groupFile), false,
      'the group inspection file must be deleted with its capture, not left on disk',
    );

    await h1.stopServer();
    h1 = null;

    h2 = await startServerWithDir({ dir, durable: true });
    await h2.call('POST', '/api/captures/select', { captureId: capB });
    const session = (await h2.call('GET', '/api/session')).body;
    assert.equal(session.findings.length, 0, 'a deleted capture must not resurrect its verified findings');
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tampered state file cannot inject an observation review or a ledger finding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-tamper-'));
  let h1: PersistentHarness | null = null;
  let h2: PersistentHarness | null = null;
  try {
    h1 = await startServerWithDir({ dir, durable: true });
    const view = await inspectedWorkspace(h1);
    const capId = view.provenance.captureId as string;
    assert.ok(h1.persistence);
    const inspPath = h1.persistence.inspectionFile(capId);
    assert.equal(existsSync(inspPath), true);
    await h1.stopServer();
    h1 = null;

    // A hostile record: a review for an observation this inspection never produced, and a ledger finding raised from an.
    const record = JSON.parse(readFileSync(inspPath, 'utf8')) as Record<string, unknown>;
    record['observationReviews'] = [
      {
        observationId: 'obs_injected_by_hand',
        key: 'cap_x|OBSERVED_ELEMENT|something that was never seen',
        status: 'VERIFIED',
        reviewer: 'Nobody Real',
        reviewedAt: '2020-01-01T00:00:00.000Z',
        note: 'injected',
      },
    ];
    record['ledgerFindings'] = [
      {
        id: 'find_injected_by_hand',
        sourceObservationId: 'obs_injected_by_hand',
        captureId: capId,
        projectId: null,
        zoneId: null,
        category: 'OBSERVED_ELEMENT',
        summary: 'Injected summary',
        evidenceDescription: 'Injected evidence',
        suggestedAction: 'HUMAN_REVIEW',
        severity: 'INFO',
        raisedBy: 'Nobody Real',
        raisedAt: '2020-01-01T00:00:00.000Z',
        state: 'CLOSED',
        target: 'sitelens-isolated-hackathon',
      },
    ];
    writeFileSync(inspPath, JSON.stringify(record), 'utf8');

    h2 = await startServerWithDir({ dir, durable: true });
    const session = (await h2.call('GET', '/api/session')).body;
    assert.equal(session.findings.length, 0, 'an injected ledger finding must not be adopted');
    const reviewed = (session.observations as { id: string; review: unknown }[])
      .filter((o) => o.review !== null);
    assert.equal(reviewed.length, 0, 'an injected observation review must not be adopted');
    assert.equal(
      session.observations.some((o: any) => o.id === 'obs_injected_by_hand'),
      false,
      'the restored observations must be the ones the payload actually holds',
    );
  } finally {
    if (h1) await h1.stopServer();
    if (h2) await h2.stopServer();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a closed reviewer gate is not bypassed by a malformed review body', async () => {
  const h = await startServerWithDir();
  try {
    // A fresh project with no reviewer: the gate is closed.
    await h.call('POST', '/api/projects', { name: 'Gate Project' });

    const res = await h.call('POST', '/api/review', { observationId: 'obs_1', decision: 'VERIFIED' });
    assert.equal(res.status, 409, 'the reviewer gate must be reported, not a parse error');
    assert.equal(res.body.error, 'REVIEWER_REQUIRED');

    // A body that is not JSON at all must not slip past the gate either.
    const broken = await h.raw('POST', '/api/review', Buffer.from('not json at all'), 'text/plain');
    assert.equal(
      JSON.parse(broken.body.toString('utf8')).error,
      'REVIEWER_REQUIRED',
      'the gate must be refused before the body is read',
    );

    // The same holds for the other two mutating routes.
    for (const [route, payload] of [
      ['/api/review-finding', { findingId: 'fnd_1', decision: 'VERIFIED' }],
      ['/api/finding-state', { findingId: 'find_1', state: 'CLOSED' }],
    ] as const) {
      void payload;
      const gated = await h.raw('POST', route, Buffer.from('{{{'), 'application/json');
      assert.equal(gated.status, 409, `${route} must refuse before parsing`);
      assert.equal(JSON.parse(gated.body.toString('utf8')).error, 'REVIEWER_REQUIRED');
    }
  } finally {
    await h.close();
  }
});

test('a run whose durable write failed says so instead of answering as though it were saved', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    const view = await inspectedWorkspace(h);
    const capId = view.provenance.captureId as string;
    assert.ok(h.persistence);

    // The control: with storage working, the run carries no storage caveat.
    const good = await h.call('POST', '/api/run', { captureId: capId });
    assert.equal(good.status, 200);
    assert.equal(good.body.outcome, 'COMPLETED');
    assert.equal(
      good.body.persistence, undefined,
      'a durably written run must not warn about durability',
    );

    // Now every durable write fails.
    h.persistence.saveInspection = () => false;
    const lost = await h.call('POST', '/api/run', { captureId: capId });
    assert.equal(lost.status, 200, 'a run that succeeded is still a successful run');
    assert.equal(lost.body.outcome, 'COMPLETED', 'and its findings are still reported');
    assert.ok(lost.body.observations.length > 0, 'the real observations are not discarded');
    assert.equal(lost.body.persistence.written, false);
    assert.match(String(lost.body.persistence.message), /could not be written to durable storage/);

    // A restart must confirm the claim: nothing was saved.
  } finally {
    await h.close();
  }
});

test('a run that produced nothing usable is not reported as a storage failure', async () => {
  const h = await startServerWithDir({ durable: true });
  try {
    // A capture that has never been inspected has no inspection record to write, which is the legitimate reason a.
    await h.call('POST', '/api/projects', { name: 'Nothing Yet' });
    await h.call('POST', '/api/reviewer', { name: 'Nadia Mansour' });
    await h.upload('fresh.png', demoCaptures()[0]!.bytes);

    const pending = (await h.call('GET', '/api/session')).body;
    assert.equal(pending.outcome, 'PENDING');
    assert.equal(
      pending.persistence, undefined,
      'an un-inspected capture is not a durable-write failure',
    );
  } finally {
    await h.close();
  }
});
