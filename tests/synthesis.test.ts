/**
 * Synthesis: findings, priorities, reality brief and counters.
 *
 * The invariants locked in here are the product's credibility guarantees:
 *
 *   - a MATCH never becomes a finding
 *   - a comparison finding is UNVERIFIED and labelled as arithmetic, not vision
 *   - an UNDETERMINED item is never dressed up as a confirmed problem
 *   - the brief reports only real counts, and says when nothing was found
 *   - synthetic (offline demo) runs are flagged, never presented as AI inference
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCounters,
  buildPriorities,
  buildRealityBrief,
  synthesizeFindings,
} from '../src/synthesis.ts';
import { compareExpectedState } from '../src/compare.ts';
import type {
  DetectedElement,
  ExpectedItem,
  ExpectedState,
  InspectionFinding,
} from '../src/types/inspection.ts';

function expected(over: Partial<ExpectedItem> = {}): ExpectedItem {
  return { id: 'e1', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12, note: '', ...over };
}

function detection(over: Partial<DetectedElement> = {}): DetectedElement {
  return {
    element: 'COLUMN',
    present: true,
    count: 4,
    countBasis: 'VISUAL_COUNT',
    confidence: 0.8,
    evidence: 'Four vertical members visible.',
    boundingBox: null,
    ...over,
  };
}

function state(items: ExpectedItem[]): ExpectedState {
  return { zone: 'North Core', source: 'PRESET', items };
}

function modelFinding(over: Partial<InspectionFinding> = {}): InspectionFinding {
  return {
    id: '',
    captureId: '',
    title: 'Open floor edge without visible guardrail',
    category: 'SAFETY_ATTENTION',
    severity: 'HIGH',
    observation: 'An unguarded floor edge is visible.',
    element: 'SLAB',
    location: 'upper left',
    expected: null,
    difference: null,
    reason: 'No continuous barrier is visible along the edge.',
    evidence: 'The floor edge shows no barrier.',
    confidence: 0.87,
    recommendation: 'Confirm edge protection physically before the next pour.',
    boundingBox: null,
    origin: 'AI',
    verificationStatus: 'UNVERIFIED',
    review: null,
    comparisonId: null,
    synthetic: false,
    ...over,
  };
}

test('a matching expectation produces no finding', () => {
  const exp = state([expected({ expectedCount: 4 })]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    modelFindings: [],
    rows,
    synthetic: false,
  });
  assert.equal(findings.length, 0);
});

test('a count shortfall becomes an evidence-backed, UNVERIFIED finding', () => {
  const exp = state([expected()]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    modelFindings: [],
    rows,
    synthetic: false,
  });

  assert.equal(findings.length, 1);
  const finding = findings[0] as InspectionFinding;
  assert.equal(finding.origin, 'COMPARISON');
  assert.equal(finding.verificationStatus, 'UNVERIFIED');
  assert.equal(finding.review, null);
  assert.equal(finding.category, 'DEVIATION');
  assert.match(finding.expected ?? '', /12 columns expected/);
  assert.match(finding.difference ?? '', /visual count 4, expected 12/);
  assert.match(finding.recommendation, /VISUAL COUNT/);
  assert.equal(finding.comparisonId, rows[0]?.id);
});

test('comparison findings state which evidence the image actually provides', () => {
  // Three rows, three evidence states, and the wording must not blur them:
  // a localized region, a real reading with no region, and no reading at all.
  const exp = state([
    expected({ id: 'e_localized', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12 }),
    expected({ id: 'e_fullframe', element: 'WALL', expectation: 'COUNT', expectedCount: 6 }),
    expected({ id: 'e_none', element: 'OPENING', expectation: 'PRESENT', expectedCount: null }),
  ]);
  const detections = [
    detection({ element: 'COLUMN', count: 4, boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 } }),
    detection({
      element: 'WALL',
      count: 2,
      confidence: 0.7,
      evidence: 'Two masonry walls visible at the frame edge.',
      boundingBox: null,
    }),
  ];
  const rows = compareExpectedState(exp, detections);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections,
    modelFindings: [],
    rows,
    synthetic: false,
  });

  const localized = findings.find((f) => f.element === 'COLUMN');
  assert.match(localized?.evidence ?? '', /localised this element .* highlighted region/);

  const fullFrame = findings.find((f) => f.element === 'WALL');
  assert.match(
    fullFrame?.evidence ?? '',
    /Full-frame evidence: the finding is supported by the inspected image, but the model did not return a localised region/,
  );

  const none = findings.find((f) => f.element === 'OPENING');
  assert.match(
    none?.evidence ?? '',
    /No visual reading of this element in this capture; the finding rests on the expected-state comparison/,
  );
});

test('an UNDETERMINED item becomes an UNDETERMINED finding, not a claimed problem', () => {
  const exp = state([expected()]);
  const rows = compareExpectedState(exp, [detection({ count: null })]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection({ count: null })],
    modelFindings: [],
    rows,
    synthetic: false,
  });

  const finding = findings[0] as InspectionFinding;
  assert.equal(finding.category, 'UNDETERMINED');
  assert.match(finding.title, /not confirmable/);
  assert.match(finding.reason, /does not show enough/);
  assert.match(finding.recommendation, /Do not treat this as a shortfall/);
});

test('model findings are carried through and marked AI in origin', () => {
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: state([]),
    detections: [],
    modelFindings: [modelFinding()],
    rows: [],
    synthetic: false,
  });

  const finding = findings[0] as InspectionFinding;
  assert.equal(finding.origin, 'AI');
  assert.equal(finding.severity, 'HIGH');
  assert.equal(finding.captureId, 'cap_1');
  assert.equal(finding.verificationStatus, 'UNVERIFIED');
});

test('identical titles are not duplicated across AI and comparison', () => {
  const exp = state([expected()]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    // Same title the comparison produces, case-insensitively.
    modelFindings: [modelFinding({ title: 'COLUMN COUNT DIFFERS FROM EXPECTED' })],
    rows,
    synthetic: false,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.origin, 'AI');
});

test('priorities rank severity first and never list settled findings', () => {
  const priorities = buildPriorities([
    modelFinding({ id: 'low', title: 'Low thing', severity: 'LOW' }),
    modelFinding({ id: 'high', title: 'High thing', severity: 'HIGH' }),
    modelFinding({
      id: 'done',
      title: 'Settled thing',
      severity: 'HIGH',
      verificationStatus: 'VERIFIED',
    }),
  ]);

  assert.deepEqual(priorities.map((p) => p.title), ['High thing', 'Low thing']);
  assert.equal(priorities[0]?.rank, 1);
  assert.equal(priorities[0]?.attention, 'HIGH');
});

test('a comparison finding outranks an equally severe AI opinion', () => {
  const priorities = buildPriorities([
    modelFinding({ id: 'ai', title: 'AI reading', severity: 'MEDIUM', confidence: 0.9, origin: 'AI' }),
    modelFinding({
      id: 'cmp',
      title: 'Comparison result',
      severity: 'MEDIUM',
      confidence: 0.6,
      origin: 'COMPARISON',
    }),
  ]);
  assert.equal(priorities[0]?.title, 'Comparison result');
  assert.match(priorities[0]?.basis ?? '', /Expected-state comparison/);
});

test('the brief reports real counts and derives its verdict', () => {
  const exp = state([expected()]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    modelFindings: [],
    rows,
    synthetic: false,
  });
  const brief = buildRealityBrief({
    detections: [detection()],
    rows,
    findings,
    priorities: buildPriorities(findings),
    synthetic: false,
  });

  assert.match(brief.lines.join('\n'), /4 site elements counted/);
  assert.equal(brief.overall, 'ATTENTION_REQUIRED');
  assert.equal(brief.synthetic, false);
  assert.ok(brief.highestPriority);
});

test('a clean comparison produces NO_ATTENTION rather than inventing drama', () => {
  const exp = state([expected({ expectedCount: 4 })]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    modelFindings: [],
    rows,
    synthetic: false,
  });
  const brief = buildRealityBrief({
    detections: [detection()],
    rows,
    findings,
    priorities: [],
    synthetic: false,
  });

  assert.equal(brief.overall, 'NO_ATTENTION');
  assert.equal(brief.highestPriority, null);
});

test('a run that detected nothing says so plainly', () => {
  const brief = buildRealityBrief({
    detections: [],
    rows: [],
    findings: [],
    priorities: [],
    synthetic: true,
  });
  assert.match(brief.lines[0] ?? '', /No construction elements were reported/);
  assert.equal(brief.synthetic, true);
});

test('counters add up and expose the highest confidence', () => {
  const exp = state([expected()]);
  const rows = compareExpectedState(exp, [detection()]);
  const findings = synthesizeFindings({
    captureId: 'cap_1',
    expected: exp,
    detections: [detection()],
    modelFindings: [modelFinding()],
    rows,
    synthetic: false,
  });
  const counters = buildCounters({ detections: [detection()], findings, rows });

  assert.equal(counters.totalCounted, 4);
  assert.equal(counters.elementsDetected, 1);
  assert.equal(counters.attentionAreas, 1);
  assert.equal(counters.highestConfidence, 0.87);
  assert.equal(counters.pending, findings.length);
  assert.equal(counters.verified, 0);
});

test('counters report no confidence rather than zero when nothing was found', () => {
  const counters = buildCounters({ detections: [], findings: [], rows: [] });
  assert.equal(counters.highestConfidence, null);
  assert.equal(counters.totalCounted, 0);
});