/**
 * The template-echo placeholder defect, and the reasoning stage's trust boundary.
 *
 * Both live in this file because they are the same class of failure: a model
 * response that is STRUCTURALLY VALID and MEANINGLESS, which a permissive
 * validator would let into the product as if it were a reading.
 *
 * The measured defect, from a real run against the live endpoint: the vision
 * model returned one entry for every item on the expected-state list, each with
 * the prompt's own numeric placeholders copied verbatim.
 *
 *   { "element": "COLUMN", "present": true, "confidence": 0.0,
 *     "evidence": "no visible columns",
 *     "bounding_box": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 } }
 *
 * Every field is a legal reading. The deterministic comparison then reported
 * five fabricated MATCHes and one fabricated ATTENTION on a photograph of a
 * worker tying rebar. These tests exist so that can never come back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDetectedElement,
  validateModelFinding,
} from '../src/types/inspection.ts';
import { validateModelObservation } from '../src/types/observation.ts';
import { buildInspectionPrompt } from '../src/providers/nebius-nvidia.provider.ts';
import { compareExpectedState } from '../src/compare.ts';
import {
  buildReasoningContext,
  isDegenerateReasoning,
  validateReasoning,
  describeReasoningFailure,
  REASONING_CERTAINTIES,
} from '../src/reasoning.ts';
import type { ExpectedState } from '../src/types/inspection.ts';

/** The exact placeholder shape the live model returned. */
const ECHOED_ELEMENT = {
  element: 'COLUMN',
  present: true,
  confidence: 0.0,
  evidence: 'no visible columns',
  bounding_box: { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
};

test('an echoed placeholder element is rejected, not compared', () => {
  const result = validateDetectedElement(ECHOED_ELEMENT);
  assert.equal(result.ok, false, 'a zero-confidence element asserts nothing');
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => /asserted no reading/.test(i.message)),
      `expected an assertion-failure reason, got ${JSON.stringify(result.issues)}`,
    );
  }
});

test('a real element with real geometry is still accepted', () => {
  const result = validateDetectedElement({
    element: 'REBAR',
    present: true,
    confidence: 0.95,
    evidence: 'a dense bar mat fills the lower frame',
    bounding_box: { x: 0.1, y: 0.4, width: 0.8, height: 0.5 },
  });
  assert.equal(result.ok, true);
});

test('an element that denies its own presence is rejected', () => {
  // `present: true` with evidence that begins "no visible" is self-contradictory.
  const result = validateDetectedElement({
    element: 'SLAB',
    present: true,
    confidence: 0.7,
    evidence: 'no visible slab surface in this frame',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === 'evidence'));
  }
});

test('a negation later in the sentence does not condemn a real reading', () => {
  // Anchoring matters: this evidence reports a genuine rebar observation and
  // must survive even though it contains the word "no".
  const result = validateDetectedElement({
    element: 'REBAR',
    present: true,
    confidence: 0.8,
    evidence: 'reinforcement is visible throughout the frame; no cover depth can be read',
  });
  assert.equal(result.ok, true, 'a later negation is not a self-contradiction');
});

test('a zero-area bounding box is reported as not localised, not as a region', () => {
  const result = validateDetectedElement({
    element: 'REBAR',
    present: true,
    confidence: 0.9,
    evidence: 'bar mat visible',
    bounding_box: { x: 0.2, y: 0.2, width: 0, height: 0.4 },
  });
  assert.equal(result.ok, true, 'the element is real even though the box is not');
  if (result.ok) assert.equal(result.value.boundingBox, null);
});

test('a zero-confidence observation is discarded rather than shown', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'A worker is interacting with a rebar grid.',
    evidence: { description: 'The worker holds the grid.' },
    confidence: 0.0,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
  });
  assert.equal(result.ok, false);
});

test('a zero-confidence model finding is discarded rather than shown', () => {
  const result = validateModelFinding({
    title: 'Rebar Grid',
    category: 'DEVIATION',
    severity: 'MEDIUM',
    element: 'REBAR',
    observation: 'A rebar grid is visible.',
    reason: 'Rebar where no slab is expected.',
    evidence: 'The grid is clearly visible.',
    confidence: 0.0,
    recommendation: 'Verify the slab below the rebar grid.',
  });
  assert.equal(result.ok, false);
});

test('rejected placeholders cannot manufacture a comparison', () => {
  // The end-to-end consequence: with every element rejected, every
  // PRESENT/COUNT expectation must be UNDETERMINED, never MATCH.
  const expected: ExpectedState = {
    zone: 'North Core',
    source: 'PRESET',
    items: [
      { id: 'e1', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12, note: 'grid C1-C12' },
      { id: 'e2', element: 'SLAB', expectation: 'PRESENT', expectedCount: null, note: '' },
      { id: 'e3', element: 'WALL', expectation: 'PRESENT', expectedCount: null, note: '' },
    ],
  };
  const placeholders = ['COLUMN', 'SLAB', 'WALL'].map((element) => ({
    ...ECHOED_ELEMENT,
    element,
    evidence: `no visible ${element.toLowerCase()}`,
  }));

  const accepted = placeholders
    .map((raw) => validateDetectedElement(raw))
    .filter((r) => r.ok)
    .map((r) => (r.ok ? r.value : null))
    .filter((v): v is NonNullable<typeof v> => v !== null);

  assert.equal(accepted.length, 0, 'no placeholder may survive validation');

  const rows = compareExpectedState(expected, accepted);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.notEqual(row.status, 'MATCH', `${row.element} must not MATCH on nothing`);
  }
  assert.equal(rows.filter((r) => r.status === 'UNDETERMINED').length, 3);
});

test('the inspection prompt no longer contains a copyable numeric placeholder', () => {
  const prompt = buildInspectionPrompt();

  // The defect was caused by the template's own `0.0` and all-zero box. Any
  // concrete number in a JSON example is something the model can copy verbatim,
  // so the template now shows only the closed-vocabulary string fields.
  assert.doesNotMatch(
    prompt,
    /"confidence":\s*0\.0/,
    'the prompt must not offer a zero-confidence value to echo',
  );
  assert.doesNotMatch(
    prompt,
    /"bounding_box":\s*\{\s*"x":\s*0\.0/,
    'the prompt must not offer an all-zero bounding box to echo',
  );
  // ...while still naming the enum values concretely, which demonstrably helps.
  assert.match(prompt, /"category":\s*"OBSERVED_ELEMENT"/);
});

test('the prompt states the anti-echo rule explicitly', () => {
  const prompt = buildInspectionPrompt();
  assert.match(prompt, /NEVER echo the expected-state list/i);
  assert.match(prompt, /never zero/i);
  assert.match(prompt, /LEAVE IT OUT/i);
});

// --- the reasoning stage ---------------------------------------------------

test('a well-formed reasoning payload is accepted', () => {
  const result = validateReasoning({
    summary: 'Reinforcement installation is in progress.',
    whatMatters: 'Whether the mat is complete cannot be read from one frame.',
    rationale: 'Dense bars are visible, but spacing and cover are not.',
    recommendation: 'Walk the bay and check the mat against the approved detail.',
    verification: 'Physically confirm bar spacing and cover on site.',
    confidence: 0.55,
    certainty: 'UNCERTAIN',
  });
  assert.equal(result.ok, true);
});

test('reasoning without a stated certainty is rejected', () => {
  // The single most important rule in the reasoning stage: an answer that never
  // says how sure it is cannot reach the product.
  const result = validateReasoning({
    summary: 's', whatMatters: 'w', rationale: 'r', recommendation: 'rec', verification: 'v',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === 'certainty'));
  }
});

test('an invented certainty word is rejected', () => {
  const result = validateReasoning({
    summary: 's', whatMatters: 'w', rationale: 'r', recommendation: 'rec', verification: 'v',
    certainty: 'SUPPORTED | UNCERTAIN',
  });
  assert.equal(result.ok, false);
});

test('reasoning missing its recommendation or verification is rejected', () => {
  const base = {
    summary: 's', whatMatters: 'w', rationale: 'r', certainty: 'SUPPORTED',
  };
  assert.equal(validateReasoning(base).ok, false, 'no recommendation');
  assert.equal(validateReasoning({ ...base, recommendation: 'rec' }).ok, false, 'no verification');
});

test('reasoning confidence is optional but must be a real number', () => {
  assert.equal(
    validateReasoning({
      summary: 's', whatMatters: 'w', rationale: 'r',
      recommendation: 'rec', verification: 'v', certainty: 'SUPPORTED',
    }).ok,
    true,
    'absent confidence is allowed and means "not stated"',
  );
  assert.equal(
    validateReasoning({
      summary: 's', whatMatters: 'w', rationale: 'r',
      recommendation: 'rec', verification: 'v', certainty: 'SUPPORTED', confidence: 1.4,
    }).ok,
    false,
    'out of range confidence is rejected',
  );
});

test('reasoning confidence is not a verification', () => {
  // A reasoning confidence of 1.0 must not settle anything: certainty and
  // confidence are advisory, and only a human moves a finding.
  const result = validateReasoning({
    summary: 's', whatMatters: 'w', rationale: 'r',
    recommendation: 'rec', verification: 'v', certainty: 'SUPPORTED', confidence: 1.0,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.certainty, 'SUPPORTED');
    // The field exists but the type carries no verification meaning at all.
    assert.ok(!('verificationStatus' in result.value));
  }
});

test('reasoning that merely restates the vision stage is detected', () => {
  const visual = ['A dense reinforcement mat is visible in the frame.'];
  const paraphrase = {
    summary: 's',
    whatMatters: 'w',
    rationale: 'A dense reinforcement mat is visible in the frame.',
    recommendation: 'A dense reinforcement mat is visible in the frame.',
    verification: 'v',
    confidence: null,
    certainty: 'SUPPORTED' as const,
  };
  assert.equal(isDegenerateReasoning(paraphrase, visual), true);

  const real = {
    summary: 's',
    whatMatters: 'w',
    rationale:
      'The photograph cannot establish bar spacing, lap length or concrete cover, and none of those ' +
      'properties may be inferred from an image; the mat may be complete or may still be growing.',
    recommendation:
      'Walk the bay with the approved reinforcement detail and measure lap length and cover before the pour.',
    verification: 'Physically confirm lap length and cover against the scheduled detail sheet.',
    confidence: null,
    certainty: 'UNCERTAIN' as const,
  };
  assert.equal(isDegenerateReasoning(real, visual), false);
});

test('the reasoning context carries the comparison, not the model prose', () => {
  const expected: ExpectedState = {
    zone: 'North Core',
    source: 'PRESET',
    items: [
      { id: 'e1', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12, note: 'grid C1-C12' },
    ],
  };
  const rows = compareExpectedState(expected, []);
  const context = buildReasoningContext({
    projectName: 'North Core Construction',
    captureLabel: '021 — rebar welding',
    expected,
    detections: [],
    observations: [],
    rows,
    findings: [],
  });

  // Every section Nemotron is told to read must be present and labelled.
  for (const heading of [
    'PROJECT CONTEXT',
    'EXPECTED STATE',
    'VISIBLE ELEMENTS',
    'VISUAL OBSERVATIONS',
    'DETERMINISTIC COMPARISON',
    'CURRENT FINDINGS',
  ]) {
    assert.ok(context.includes(heading), `missing section ${heading}`);
  }
  // The comparison status must reach the model, so it can preserve it.
  assert.match(context, /COLUMN COUNT: UNDETERMINED/);
  // The project name must be marked as operator-entered, not as an observation.
  assert.match(context, /NOT evidence of anything on site/);
  // Unverified is stated, so the reasoner cannot treat a candidate as a defect.
  assert.match(context, /Every one is UNVERIFIED/);
});

test('every unavailable reasoning state has its own operator-facing message', () => {
  const kinds = [
    'NOT_CONFIGURED', 'DISABLED', 'TIMEOUT', 'UNAVAILABLE',
    'AUTHENTICATION', 'RATE_LIMITED', 'MALFORMED_RESPONSE',
    'REJECTED_BY_VALIDATION', 'EMPTY', 'ERROR',
  ] as const;
  const messages = kinds.map((kind) => describeReasoningFailure(kind, `raw ${kind}`));
  for (const message of messages) {
    assert.ok(message.trim().length > 10, 'a message must be shown, not a bare code');
  }
  // An outage must never read as "no problems found".
  for (const message of messages) {
    assert.doesNotMatch(message, /no issues|all clear|nothing found/i);
  }
  // The comparison must be explicitly declared unaffected where it is.
  assert.match(describeReasoningFailure('NOT_CONFIGURED', ''), /comparison below are unaffected/);
  assert.match(describeReasoningFailure('REJECTED_BY_VALIDATION', ''), /schema validation/);
});

test('the certainty vocabulary is a closed set', () => {
  assert.deepEqual([...REASONING_CERTAINTIES], [
    'SUPPORTED',
    'UNCERTAIN',
    'INSUFFICIENT_EVIDENCE',
  ]);
});
