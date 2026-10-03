/** Schema validation tests: untrusted model output must not become truth. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confidenceBand,
  isObservationCategory,
  OBSERVATION_CATEGORIES,
  validateModelObservation,
} from '../src/types/observation.ts';

test('accepts a well-formed observation', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'Steel columns are visible.',
    evidence: { description: 'Vertical steel members in the mid-ground.' },
    confidence: 0.8,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
    bounding_box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.category, 'OBSERVED_ELEMENT');
  assert.equal(result.value.evidenceDescription, 'Vertical steel members in the mid-ground.');
  assert.deepEqual(result.value.boundingBox, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
});

test('accepts evidence supplied as a plain string', () => {
  const result = validateModelObservation({
    category: 'PROGRESS_OBSERVATION',
    observation: 'Scaffolding is erected.',
    evidence: 'Tubular scaffold visible on the left.',
    confidence: 0.7,
    severity: 'INFO',
    suggested_action: 'HUMAN_REVIEW',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.boundingBox, null, 'absent bounding box normalises to null');
});

test('rejects a non-object payload', () => {
  for (const bad of [null, undefined, 42, 'a string', ['array'], true]) {
    const result = validateModelObservation(bad);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('rejects an unknown category rather than coercing it', () => {
  const result = validateModelObservation({
    category: 'STRUCTURAL_DEFICIT',
    observation: 'The wall is unsafe.',
    evidence: 'x',
    confidence: 0.9,
    severity: 'HIGH',
    suggested_action: 'HUMAN_REVIEW',
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((i) => i.field === 'category'));
});

test('rejects missing required fields', () => {
  const result = validateModelObservation({ confidence: 0.5 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const fields = result.issues.map((i) => i.field);
  for (const expected of ['category', 'observation', 'evidence', 'severity', 'suggested_action']) {
    assert.ok(fields.includes(expected), `expected an issue for '${expected}'`);
  }
});

test('rejects a non-numeric confidence instead of parsing it', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'x',
    evidence: 'y',
    confidence: '0.9',
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((i) => i.field === 'confidence'));
});

test('rejects out-of-range confidence without clamping', () => {
  for (const value of [-0.1, 1.1, 99]) {
    const result = validateModelObservation({
      category: 'OBSERVED_ELEMENT',
      observation: 'x',
      evidence: 'y',
      confidence: value,
      severity: 'INFO',
      suggested_action: 'NO_ACTION',
    });
    assert.equal(result.ok, false, `expected rejection for confidence ${value}`);
  }
});

test('rejects non-normalized bounding boxes (pixel coordinates)', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'x',
    evidence: 'y',
    confidence: 0.5,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
    bounding_box: { x: 120, y: 80, width: 300, height: 200 },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((i) => i.field.startsWith('bounding_box')));
});

test('rejects a malformed bounding box rather than partially using it', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'x',
    evidence: 'y',
    confidence: 0.5,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
    bounding_box: { x: 0.1, y: 'nope', width: 0.3, height: 0.3 },
  });
  assert.equal(result.ok, false);
});

test('rejects an overlong observation string', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'x'.repeat(1001),
    evidence: 'y',
    confidence: 0.5,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((i) => i.field === 'observation'));
});

test('rejects an empty observation string', () => {
  const result = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: '   ',
    evidence: 'y',
    confidence: 0.5,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
  });
  assert.equal(result.ok, false);
});

test('category guard matches the declared vocabulary exactly', () => {
  for (const category of OBSERVATION_CATEGORIES) {
    assert.equal(isObservationCategory(category), true);
  }
  assert.equal(isObservationCategory('NOT_A_CATEGORY'), false);
  assert.equal(isObservationCategory(7), false);
});

test('confidence band is display-only and covers boundaries', () => {
  assert.equal(confidenceBand(0), 'LOW');
  assert.equal(confidenceBand(0.49), 'LOW');
  assert.equal(confidenceBand(0.5), 'MEDIUM');
  assert.equal(confidenceBand(0.79), 'MEDIUM');
  assert.equal(confidenceBand(0.8), 'HIGH');
  assert.equal(confidenceBand(1), 'HIGH');
});