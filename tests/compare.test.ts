/**
 * Reality vs expectation: the deterministic comparison engine.
 *
 * These tests pin the honesty rules that make this product credible:
 *
 *   - a matching count is MATCH, a differing count is ATTENTION
 *   - an element the model could not count is UNDETERMINED, never a shortfall
 *   - an element the model never mentioned is UNDETERMINED, never "missing"
 *   - "reported absent" and "never reported" are different answers
 *   - nothing here is ever allowed to invent a number
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareItem, compareExpectedState, summarizeComparison } from '../src/compare.ts';
import type { DetectedElement, ExpectedItem } from '../src/types/inspection.ts';

function detection(over: Partial<DetectedElement> = {}): DetectedElement {
  return {
    element: 'COLUMN',
    present: true,
    count: 4,
    countBasis: 'VISUAL_COUNT',
    confidence: 0.8,
    evidence: 'Vertical members in the mid-ground.',
    boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    ...over,
  };
}

function expected(over: Partial<ExpectedItem> = {}): ExpectedItem {
  return { id: 'exp_1', element: 'COLUMN', expectation: 'COUNT', expectedCount: 4, note: '', ...over };
}

test('a matching visual count is a MATCH', () => {
  const row = compareItem(expected({ expectedCount: 4 }), detection({ count: 4 }));
  assert.equal(row.status, 'MATCH');
  assert.equal(row.difference, '');
  assert.equal(row.observedCount, 4);
});

test('a differing visual count is ATTENTION and states the delta', () => {
  const row = compareItem(expected({ expectedCount: 12 }), detection({ count: 4 }));
  assert.equal(row.status, 'ATTENTION');
  assert.match(row.difference, /8 fewer columns counted than expected/);
  assert.match(row.difference, /visual count 4, expected 12/);
});

test('a surplus count is ATTENTION and says "more", not "fewer"', () => {
  const row = compareItem(expected({ expectedCount: 2 }), detection({ count: 5 }));
  assert.equal(row.status, 'ATTENTION');
  assert.match(row.difference, /3 more columns counted than expected/);
});

test('an element the model would not count is UNDETERMINED, never a shortfall', () => {
  // The honesty-critical case: the element is visible but no defensible number
  // exists. Turning that into "8 columns missing" would invent the measurement.
  const row = compareItem(
    expected({ expectedCount: 12 }),
    detection({ count: null, countBasis: 'NOT_DETERMINABLE' }),
  );
  assert.equal(row.status, 'UNDETERMINED');
  assert.equal(row.observedCount, null);
  assert.equal(row.countBasis, 'NOT_DETERMINABLE');
  assert.equal(row.difference, '');
});

test('an element the model never reported is UNDETERMINED, not "missing"', () => {
  const row = compareItem(expected({ expectedCount: 12 }), null);
  assert.equal(row.status, 'UNDETERMINED');
  assert.match(row.observedText, /not determinable/);
});

test('reported-absent differs from never-reported', () => {
  const absent = compareItem(expected({ expectation: 'PRESENT' }), detection({ present: false }));
  assert.equal(absent.status, 'ATTENTION');
  assert.match(absent.observedText, /no column detected/);

  const silent = compareItem(expected({ expectation: 'PRESENT' }), null);
  assert.equal(silent.status, 'UNDETERMINED');
});

test('PRESENT passes when detected and fails when explicitly absent', () => {
  const ok = compareItem(expected({ expectation: 'PRESENT', expectedCount: null }), detection());
  assert.equal(ok.status, 'MATCH');

  const missing = compareItem(
    expected({ expectation: 'PRESENT', expectedCount: null }),
    detection({ present: false }),
  );
  assert.equal(missing.status, 'ATTENTION');
  assert.match(missing.difference, /expected but not detected/);
});

test('ABSENT fails when the element is visible and passes when it is not', () => {
  const present = compareItem(
    expected({ element: 'EXCAVATION', expectation: 'ABSENT', expectedCount: null }),
    detection({ element: 'EXCAVATION' }),
  );
test('a row records whether the model reported the element at all', () => {
  // This flag is what separates full-frame evidence from no visual evidence
  // downstream, so both sides of it are pinned here.
  const reported = compareItem(expected({ expectedCount: 12 }), detection({ count: 4 }));
  assert.equal(reported.detectionReported, true);

  const explicitAbsent = compareItem(
    expected({ element: 'SLAB', expectation: 'PRESENT', expectedCount: null }),
    detection({ element: 'SLAB', present: false }),
  );
  assert.equal(explicitAbsent.detectionReported, true, '"looked and not there" is still a reading');

  const silent = compareItem(expected({ expectedCount: 12 }), null);
  assert.equal(silent.detectionReported, false);
  assert.equal(silent.status, 'UNDETERMINED');
});

test('the most confident reading wins when a kind is reported twice', () => {
  const rows = compareExpectedState(
    {
      zone: 'Z',
      source: 'PRESET',
      items: [expected({ element: 'COLUMN', expectation: 'COUNT', expectedCount: 4 })],
    },
    [detection({ confidence: 0.3, count: 1 }), detection({ confidence: 0.9, count: 4 })],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'MATCH');
  assert.equal(rows[0]?.observedCount, 4);
});

test('comparison is order-independent', () => {
  const state = {
    zone: 'Z',
    source: 'PRESET' as const,
    items: [
      expected({ id: 'a', element: 'COLUMN', expectation: 'COUNT', expectedCount: 4 }),
      expected({ id: 'b', element: 'SLAB', expectation: 'PRESENT', expectedCount: null }),
    ],
  };
  const detections = [detection({ element: 'COLUMN' }), detection({ element: 'SLAB' })];
  const forward = compareExpectedState(state, detections).map((r) => r.status);
  const reversed = compareExpectedState(state, [...detections].reverse()).map((r) => r.status);
  assert.deepEqual(forward, reversed);
});

test('expected text reads like site language', () => {
  const count = compareItem(expected({ expectedCount: 12, note: 'grid C1-C12' }), null);
  assert.equal(count.expectedText, '12 columns expected (grid C1-C12)');

  const absent = compareItem(
    expected({ element: 'EXCAVATION', expectation: 'ABSENT', expectedCount: null }),
    null,
  );
  assert.match(absent.expectedText, /no excavation expected/);
});

test('the summary counts every row exactly once', () => {
  const summary = summarizeComparison([
    compareItem(expected({ id: '1' }), detection()),
    compareItem(expected({ id: '2', expectedCount: 12 }), detection()),
    compareItem(expected({ id: '3' }), null),
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.matched, 1);
  assert.equal(summary.attention, 1);
  assert.equal(summary.undetermined, 1);
});

test('an empty expected state produces no rows and no crash', () => {
  const rows = compareExpectedState({ zone: 'Z', source: 'PRESET', items: [] }, [detection()]);
  assert.deepEqual(rows, []);
});
  assert.equal(present.status, 'ATTENTION');
  assert.match(present.difference, /not expected in this zone/);

  const absent = compareItem(
    expected({ element: 'EXCAVATION', expectation: 'ABSENT', expectedCount: null }),
    detection({ element: 'EXCAVATION', present: false }),
  );
  assert.equal(absent.status, 'MATCH');
});