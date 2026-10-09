/**
 * Failure-mode coverage.
 *
 * Every case here asserts the same invariant: a failure NEVER produces an
 * observation and NEVER produces verified project truth. These are the paths a
 * reviewer is least likely to click but most likely to be judged on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NebiusNvidiaProvider, ProviderError } from '../src/providers/factory.ts';
import { RealityInspector } from '../src/inspector.ts';
import { InspectionSession } from '../src/session.ts';
import { findingFrom } from '../src/findings.ts';
import { readImageDimensions, toPixelBox } from '../src/image-metadata.ts';
import { demoCaptures } from '../src/captures.ts';
import { classifyEligibility } from '../src/eligibility.ts';

const IMAGE = {
  bytes: Buffer.from('fake-jpeg-bytes'),
  mediaType: 'image/jpeg',
  captureId: 'cap_fail_001',
};

function providerReturning(options: {
  status?: number;
  body?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return new NebiusNvidiaProvider({
    env: options.env ?? { NEBIUS_API_KEY: 'test-key-1234567890' },
    fetchImpl: async () => ({
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      text: async () => options.body ?? '',
    }),
  });
}

/** Envelope helper for model responses. */
function envelope(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

const VALID_ENTRY = {
  category: 'OBSERVED_ELEMENT',
  observation: 'A visible element.',
  evidence: { description: 'Evidence for it.' },
  confidence: 0.7,
  severity: 'INFO',
  suggested_action: 'NO_ACTION',
};

/** Assert that a failing run yields zero observations and no fabricated truth. */
async function assertNoTruthFromFailure(provider: unknown): Promise<void> {
  const inspector = new RealityInspector({ provider: provider as never });
  await assert.rejects(() => inspector.inspectCapture({ image: IMAGE }), ProviderError);

  const outcome = await inspector.inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  assert.equal(inspector.listObservations(IMAGE.captureId).length, 0);
}

// ---- request-level failures ----------------------------------------------

test('missing image yields no observation', async () => {
  const inspector = new RealityInspector({ provider: providerReturning({ body: '{}' }) });
  await assert.rejects(
    () => inspector.inspectCapture({ image: { ...IMAGE, bytes: Buffer.alloc(0) } }),
    ProviderError,
  );
  assert.equal(inspector.listObservations(IMAGE.captureId).length, 0);
});

test('malformed image bytes are refused upstream and yield nothing', async () => {
  const inspector = new RealityInspector({
    provider: providerReturning({ status: 400, body: '{"detail":"invalid image"}' }),
  });
  await assert.rejects(
    () =>
      inspector.inspectCapture({
        image: { ...IMAGE, bytes: Buffer.from([0, 1, 2, 3]), mediaType: 'image/png' },
      }),
    ProviderError,
  );
  assert.equal(inspector.listObservations(IMAGE.captureId).length, 0);
});

test('non-image media type is refused before any request', async () => {
  const provider = providerReturning({ body: '{}' });
  await assert.rejects(
    () => provider.inspect({ image: { ...IMAGE, mediaType: 'application/pdf' } }),
    ProviderError,
  );
});

test('an oversized image is rejected by the provider, not silently truncated', async () => {
  const inspector = new RealityInspector({
    provider: providerReturning({ status: 413, body: '{"detail":"too large"}' }),
  });
  await assert.rejects(
    () => inspector.inspectCapture({ image: { ...IMAGE, bytes: Buffer.alloc(12 * 1024 * 1024, 7) } }),
    ProviderError,
  );
  assert.equal(inspector.listObservations(IMAGE.captureId).length, 0);
});

for (const status of [400, 404, 429, 500, 503] as const) {
  test(`HTTP ${status} produces no observation and no verified truth`, async () => {
    await assertNoTruthFromFailure(
      providerReturning({ status, body: '{"detail":"upstream failure"}' }),
    );
  });
}

test('a missing model is distinguishable from a server outage', async () => {
  const provider = providerReturning({
    status: 404,
    body: '{"detail":"The model `nvidia/whatever` does not exist."}',
  });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') {
    assert.notEqual(outcome.kind, 'UNAVAILABLE', 'a missing model is not a server outage');
    assert.match(outcome.detail ?? '', /does not exist/);
  }
});

test('a rate limit is distinguishable from an outage', async () => {
  const provider = providerReturning({ status: 429, body: '{"detail":"slow down"}' });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'RATE_LIMITED');
});

test('a missing credential fails closed without calling the provider', async () => {
  let called = false;
  const provider = new NebiusNvidiaProvider({
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'NOT_CONFIGURED');
  assert.equal(called, false, 'no network call may be made without a credential');
});

test('a hanging provider is aborted at the deadline and yields nothing', async () => {
  const provider = new NebiusNvidiaProvider({
    env: { NEBIUS_API_KEY: 'test-key-1234567890', NEBIUS_TIMEOUT_MS: '1000' },
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'TIMEOUT');
});

test('a non-JSON body is MALFORMED_RESPONSE, never an empty success', async () => {
  const provider = providerReturning({ body: 'this is not json' });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'MALFORMED_RESPONSE');
});

test('a JSON body without choices is MALFORMED_RESPONSE', async () => {
  const provider = providerReturning({ body: '{"unexpected":true}' });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'MALFORMED_RESPONSE');
});

test('a response with no observations array is MALFORMED_RESPONSE', async () => {
  const provider = providerReturning({ body: envelope('{"items":[]}') });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') assert.equal(outcome.kind, 'MALFORMED_RESPONSE');
});

test('zero observations is a distinct outcome, not a failure', async () => {
  const provider = providerReturning({ body: envelope('{"observations":[]}') });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'VALIDATION_EMPTY');
  assert.equal(outcome.result.observations.length, 0);
});

test('every entry rejected is VALIDATION_FAILED, distinct from a failure', async () => {
  // Inference succeeded and the model answered; the entries were simply invalid.
  const content = JSON.stringify({
    observations: [{ ...VALID_ENTRY, category: 'NOT_A_CATEGORY' }],
  });
  const provider = providerReturning({ body: envelope(content) });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'VALIDATION_FAILED');
  assert.equal(outcome.result.observations.length, 0);
  assert.equal(outcome.result.rejected.length, 1);
});

test('partial acceptance keeps valid entries and reports the rest', async () => {
  const content = JSON.stringify({
    observations: [
      VALID_ENTRY,
      { ...VALID_ENTRY, observation: 'Invalid entry.', category: 'BAD' },
    ],
  });
  const provider = providerReturning({ body: envelope(content) });
  const outcome = await new RealityInspector({ provider }).inspect({ image: IMAGE });
  assert.equal(outcome.status, 'COMPLETED');
  assert.equal(outcome.result.observations.length, 1);
  assert.equal(outcome.result.rejected.length, 1);
});

test('invalid enum, missing field and pixel-space boxes are all rejected', async () => {
  const content = JSON.stringify({
    observations: [
      { ...VALID_ENTRY, category: 'OBSERVED_ELEMENT | PROGRESS_OBSERVATION' },
      { category: 'OBSERVED_ELEMENT', evidence: { description: 'Ev.' }, confidence: 0.5, severity: 'INFO', suggested_action: 'NO_ACTION' },
      { ...VALID_ENTRY, bounding_box: { x: 10, y: 20, width: 100, height: 50 } },
    ],
  });
  const provider = providerReturning({ body: envelope(content) });
  const result = await new RealityInspector({ provider }).inspectCapture({ image: IMAGE });
  assert.equal(result.observations.length, 0);
  assert.equal(result.rejected.length, 3);
});

test('only a VERIFIED decision raises a finding', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const session = new InspectionSession(
    providerReturning({ body: envelope(JSON.stringify({ observations: [VALID_ENTRY] })) }),
    capture,
    'proj',
    'zone',
  );

  const view = await session.run();
  const observation = view.observations[0];
  assert.ok(observation);
  assert.equal(session.getLedger().all().length, 0, 'no finding before review');

  session.review({ observationId: observation.id, decision: 'REJECTED', reviewer: 'engineer' });
  assert.equal(session.getLedger().all().length, 0, 'rejection must not raise a finding');

  session.review({ observationId: observation.id, decision: 'NEEDS_REVIEW', reviewer: 'engineer' });
  assert.equal(session.getLedger().all().length, 0, 'deferral must not raise a finding');

  session.review({ observationId: observation.id, decision: 'VERIFIED', reviewer: 'engineer' });
  assert.equal(session.getLedger().all().length, 1, 'verification raises exactly one finding');
});

test('a recorded review is visible in the rendered view, not just the store', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const session = new InspectionSession(
    providerReturning({ body: envelope(JSON.stringify({ observations: [VALID_ENTRY] })) }),
    capture,
    'proj',
    'zone',
  );
  const before = await session.run();
  const id = (before.observations[0] as { id: string }).id;
  assert.equal(before.provenance.humanReviewPerformed, false);

  const after = session.review({
    observationId: id,
    decision: 'NEEDS_REVIEW',
    reviewer: 'engineer',
  });
  const viewed = after.observations.find((o) => o.id === id);
  assert.equal(viewed?.verificationStatus, 'NEEDS_REVIEW', 'the view must reflect the review');
  assert.equal(after.provenance.humanReviewPerformed, true);
});

test('findingFrom refuses an observation that was never verified', () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const result = findingFrom({
    id: 'obs_x',
    captureId: capture.id,
    captureLabel: capture.label,
    projectId: null,
    zoneId: null,
    category: 'OBSERVED_ELEMENT',
    observation: 'Text.',
    evidence: { description: 'Ev.', boundingBox: null, zoneId: null },
    confidence: 1,
    severity: 'INFO',
    suggestedAction: 'NO_ACTION',
    model: 'm',
    provider: 'p',
    generatedAt: new Date(0).toISOString(),
    origin: 'AI_GENERATED',
    verificationStatus: 'UNVERIFIED',
    review: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'NOT_VERIFIED');
});

test('a 0.99 confidence observation still cannot self-verify', async () => {
  const content = JSON.stringify({ observations: [{ ...VALID_ENTRY, confidence: 0.99 }] });
  const provider = providerReturning({ body: envelope(content) });
  const result = await new RealityInspector({ provider }).inspectCapture({ image: IMAGE });
  assert.equal(result.observations[0]?.confidence, 0.99);
  assert.equal(result.observations[0]?.verificationStatus, 'UNVERIFIED');
  assert.equal(result.observations[0]?.review, null);
});

test('anonymous review is refused rather than recorded unattributed', () => {
  const inspector = new RealityInspector({ provider: providerReturning({ body: '{}' }) });
  const reviewed = inspector.reviewObservation({
    observationId: 'obs_missing',
    decision: 'VERIFIED',
    reviewer: '   ',
  });
  assert.equal(reviewed, null);
});

// ---- session completion status is about usable output, not observations ----

test('elements-only response is COMPLETED, not VALIDATION_EMPTY', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const content = JSON.stringify({
    observations: [],
    elements: [{
      element: 'COLUMN', present: true, count: 4,
      confidence: 0.72, evidence: 'Four poured columns visible mid-frame.',
    }],
    findings: [],
  });
  const session = new InspectionSession(
    providerReturning({ body: envelope(content) }),
    capture, 'proj_elems', 'zone_elems',
  );
  const view = await session.run();

  assert.equal(view.observations.length, 0);
  assert.ok(view.detections.length > 0, 'the elements must survive validation');
  assert.equal(view.outcome, 'COMPLETED');
});

test('findings-only response is COMPLETED, not VALIDATION_EMPTY', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const content = JSON.stringify({
    observations: [],
    elements: [],
    findings: [{
      title: 'Formwork left in place',
      observation: 'Column formwork still on at level 2.',
      reason: 'Not yet struck, which is normal at this stage.',
      evidence: 'Timber shutters visible around the column heads.',
      recommendation: 'Confirm the strike sequence with the site engineer.',
      category: 'INCOMPLETE_WORK', severity: 'LOW', confidence: 0.6,
    }],
  });
  const session = new InspectionSession(
    providerReturning({ body: envelope(content) }),
    capture, 'proj_find', 'zone_find',
  );
  const view = await session.run();

  assert.equal(view.observations.length, 0);
  assert.ok(view.inspectionFindings.length > 0, 'the findings must survive validation');
  assert.equal(view.outcome, 'COMPLETED');
});

test('a genuinely empty response is still VALIDATION_EMPTY', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const session = new InspectionSession(
    providerReturning({ body: envelope('{"observations":[],"elements":[],"findings":[]}') }),
    capture, 'proj_empty2', 'zone_empty2',
  );
  assert.equal((await session.run()).outcome, 'VALIDATION_EMPTY');
});

test('a fully rejected response is still VALIDATION_FAILED, not COMPLETED', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const content = JSON.stringify({
    observations: [{ ...VALID_ENTRY, category: 'NOT_A_CATEGORY' }],
    elements: [{ element: 'NOT_AN_ELEMENT', present: 'yes' }],
    findings: [],
  });
  const session = new InspectionSession(
    providerReturning({ body: envelope(content) }),
    capture, 'proj_bad2', 'zone_bad2',
  );
  assert.equal((await session.run()).outcome, 'VALIDATION_FAILED');
});

test('provenance survives a zero-observation run', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const session = new InspectionSession(
    providerReturning({ body: envelope('{"observations":[]}') }),
    capture,
    'proj_zero',
    'zone_zero',
  );
  const view = await session.run();

  assert.equal(view.outcome, 'VALIDATION_EMPTY');
  assert.equal(view.observations.length, 0);
  // The run must be visibly a run: model, provider and execution all recorded.
  assert.equal(view.provenance.inferenceExecuted, true);
  assert.ok(view.provenance.model.length > 0);
  assert.equal(view.provenance.provider, 'nebius-nvidia');
  assert.equal(view.provenance.observationsAccepted, 0);
  assert.equal(view.provenance.captureId, capture.id);
});

test('provenance records a failed run as not executed, with no observations', async () => {
  const capture = demoCaptures()[0];
  assert.ok(capture);
  const session = new InspectionSession(
    providerReturning({ status: 500, body: '{"detail":"boom"}' }),
    capture,
    'proj_fail',
    'zone_fail',
  );
  const view = await session.run();

  assert.equal(view.outcome, 'FAILED');
  assert.equal(view.observations.length, 0);
  assert.equal(view.provenance.inferenceExecuted, false);
  assert.equal(view.provenance.observationsAccepted, 0);
  assert.ok(view.failure);
});

test('a missing or malformed image header yields no dimensions, not a guess', () => {
  assert.equal(readImageDimensions(Buffer.from('not an image at all')), null);
  assert.equal(readImageDimensions(Buffer.alloc(4)), null);
});

test('generated captures expose correct dimensions', () => {
  for (const capture of demoCaptures()) {
    const dims = readImageDimensions(capture.bytes);
    assert.ok(dims, `${capture.id} must expose dimensions`);
    assert.equal(dims.width, capture.dimensions.width);
    assert.equal(dims.height, capture.dimensions.height);
  }
});

test('an observation without a box is reported as non-localized, never given a position', () => {
  assert.equal(toPixelBox(null, { width: 320, height: 240 }), null);
  assert.equal(toPixelBox({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, null), null);
});

test('normalized boxes project onto real pixel coordinates', () => {
  const projected = toPixelBox(
    { x: 0.2, y: 0.15, width: 0.6, height: 0.5 },
    { width: 320, height: 240 },
  );
  assert.ok(projected);
  assert.equal(projected.left, 64);
  assert.equal(projected.top, 36);
  assert.equal(projected.width, 192);
  assert.equal(projected.height, 120);
});

test('a non-NVIDIA model on the live path is never reported eligible', () => {
  assert.equal(
    classifyEligibility({ provider: 'nebius-nvidia', model: 'Qwen/Qwen3.8-27B' }),
    'NOT_ELIGIBLE',
  );
});

test('an unverified NVIDIA id is NOT_VERIFIED, never ELIGIBLE', () => {
  assert.equal(
    classifyEligibility({ provider: 'nebius-nvidia', model: 'nvidia/nemotron-3-nano-omni' }),
    'NOT_VERIFIED',
  );
});

test('the offline fixture is never eligible', () => {
  assert.equal(
    classifyEligibility({ provider: 'demo-fixture', model: 'demo-fixture-vision-v1' }),
    'NOT_ELIGIBLE',
  );
});