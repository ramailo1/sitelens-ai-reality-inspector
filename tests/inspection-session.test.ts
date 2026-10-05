/**
 * The full inspection session: SEE -> COMPARE -> SYNTHESISE -> VERIFY.
 *
 * These are the integration-level guarantees the UI depends on. The most
 * important one is that a human review SURVIVES a re-render: findings are
 * re-synthesised on every view, so if review state were keyed by a generated id
 * the review would silently vanish the moment anything re-rendered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionSession } from '../src/session.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { demoCaptures } from '../src/captures.ts';
import { NORTH_CORE_EXPECTED, SOUTH_WING_EXPECTED } from '../src/expected-state.ts';

function session(expected = NORTH_CORE_EXPECTED): InspectionSession {
  return new InspectionSession(
    new DemoFixtureProvider(),
    demoCaptures()[1] as never,
    'proj_0247',
    'zone_north_core',
    expected,
  );
}

test('a session runs the whole loop and reports the expected state back', async () => {
  const view = await session().run();
  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(view.expected.zone, 'North Core');
  assert.equal(view.expected.source, 'PRESET');
  assert.ok(view.detections.length > 0);
  assert.ok(view.comparison.length > 0);
  assert.ok(view.inspectionFindings.length > 0);
  assert.ok(view.priorities.length > 0);
  assert.equal(typeof view.brief.overall, 'string');
});

test('the offline fixture is reported as synthetic, never as AI inference', async () => {
  const view = await session().run();
  assert.equal(view.brief.synthetic, true);
  for (const finding of view.inspectionFindings) {
    assert.equal(finding.synthetic, true);
  }
});

test('every finding starts UNVERIFIED and carries no review', async () => {
  const view = await session().run();
  for (const finding of view.inspectionFindings) {
    assert.equal(finding.verificationStatus, 'UNVERIFIED');
    assert.equal(finding.review, null);
  }
});

test('a human CONFIRM survives a re-render and records who did it', async () => {
  const s = session();
  const first = await s.run();
  const target = first.inspectionFindings[0];
  assert.ok(target);

  const reviewed = s.reviewFinding({
    findingId: target.id,
    decision: 'VERIFIED',
    reviewer: 'site.engineer',
    note: 'Confirmed on walk.',
  });

  const settled = reviewed.inspectionFindings.find((f) => f.id === target.id);
  assert.equal(settled?.verificationStatus, 'VERIFIED');
  assert.equal(settled?.review?.reviewer, 'site.engineer');
  assert.equal(settled?.review?.note, 'Confirmed on walk.');

  // The critical regression guard: a fresh view() must not resurrect it.
  const after = s.view().inspectionFindings.find((f) => f.id === target.id);
  assert.equal(after?.verificationStatus, 'VERIFIED', 'a review must survive a re-render');
  assert.equal(after?.review?.reviewer, 'site.engineer');
});

test('a verified finding leaves the priority list', async () => {
  const s = session();
  const first = await s.run();
  const target = first.inspectionFindings[0];
  assert.ok(target);

  const after = s.reviewFinding({
    findingId: target.id,
    decision: 'VERIFIED',
    reviewer: 'site.engineer',
  });
  assert.ok(!after.priorities.some((p) => p.findingId === target.id));
  assert.equal(after.counters.verified, 1);
});

test('a REJECT is recorded and never raises a ledger finding', async () => {
  const s = session();
  const first = await s.run();
  const target = first.inspectionFindings[0];
  assert.ok(target);

  const after = s.reviewFinding({
    findingId: target.id,
    decision: 'REJECTED',
    reviewer: 'qa',
  });
  const settled = after.inspectionFindings.find((f) => f.id === target.id);
  assert.equal(settled?.verificationStatus, 'REJECTED');
  assert.equal(after.counters.rejected, 1);
  // The observation ledger is a separate product and must stay empty.
  assert.equal(s.getLedger().all().length, 0);
});

test('NEEDS REVIEW keeps a finding open but out of the settled count', async () => {
  const s = session();
  const first = await s.run();
  const target = first.inspectionFindings[0];
  assert.ok(target);

  const after = s.reviewFinding({
    findingId: target.id,
    decision: 'NEEDS_REVIEW',
    reviewer: 'site.engineer',
  });
  const settled = after.inspectionFindings.find((f) => f.id === target.id);
  assert.equal(settled?.verificationStatus, 'NEEDS_REVIEW');
  assert.equal(after.counters.verified, 0);
});

test('an anonymous review is refused and changes nothing', async () => {
  const s = session();
  const first = await s.run();
test('a different expected state produces a different comparison', async () => {
  const north = await session(NORTH_CORE_EXPECTED).run();
  const south = await session(SOUTH_WING_EXPECTED).run();

  assert.equal(north.expected.zone, 'North Core');
  assert.equal(south.expected.zone, 'South Wing');
  assert.notEqual(north.comparison.length, south.comparison.length);
  assert.notEqual(south.brief.overall, '');
});

test('the capture count drives the reality headline honestly', async () => {
  const view = await session().run();
  // The fixture counts 4 columns; the brief must report that real number and
  // not invent a total from elements it never counted.
  assert.equal(view.counters.totalCounted, 4);
  assert.match(view.brief.lines.join('\n'), /4 site elements counted/);
});

test('an UNDETERMINED item is never ranked as a defect to look for', async () => {
  const view = await session().run();
  const undetermined = view.inspectionFindings.filter((f) => f.category === 'UNDETERMINED');
  assert.ok(undetermined.length > 0, 'the demo reference must exercise this case');

  for (const finding of undetermined) {
    // It must not be dressed up as a confirmed problem...
    assert.equal(finding.severity, 'INFO');
    // ...and it must not sit in the ranked work list beside a real shortfall.
    assert.ok(!view.priorities.some((p) => p.findingId === finding.id));
  }
  // It is still reported, just separately and honestly.
  assert.match(view.brief.lines.join('\n'), /cannot settle/);
});
  const target = first.inspectionFindings[0];
  assert.ok(target);

  const after = s.reviewFinding({
    findingId: target.id,
    decision: 'VERIFIED',
    reviewer: '   ',
  });
  const settled = after.inspectionFindings.find((f) => f.id === target.id);
  assert.equal(settled?.verificationStatus, 'UNVERIFIED');
  assert.equal(settled?.review, null);
});

test('reviewing an unknown finding id is a no-op, not a fake success', async () => {
  const s = session();
  await s.run();
  const after = s.reviewFinding({
    findingId: 'fnd_does_not_exist',
    decision: 'VERIFIED',
    reviewer: 'site.engineer',
  });
  assert.equal(after.counters.verified, 0);
});