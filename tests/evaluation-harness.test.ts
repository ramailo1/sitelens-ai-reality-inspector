// Offline evaluation-harness tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVALUATION_MANIFEST,
  EVAL_MANIFEST_VERSION,
  EVAL_DATASET_VERSION,
  OFFLINE_REFERENCE,
  formatEvaluationReport,
  runOfflineEvaluation,
  runLiveEvaluation,
  runRegressionScenarios,
  scoreLiveCase,
} from '../src/evaluation-harness.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { demoCaptures } from '../src/captures.ts';

test('the manifest is internally consistent: ids unique, sources resolve, modes valid', () => {
  const ids = new Set(EVALUATION_MANIFEST.map((c) => c.id));
  assert.equal(ids.size, EVALUATION_MANIFEST.length, 'manifest case ids must be unique');

  const demoIds = new Set(demoCaptures().map((c) => c.id));
  for (const testCase of EVALUATION_MANIFEST) {
    assert.ok(testCase.labels.expectedElements.length > 0, testCase.id + ' needs element labels');
    assert.ok(testCase.source.licence.length > 0, testCase.id + ' needs a licence record');
    assert.ok(['offline', 'live-only'].includes(testCase.mode), testCase.id + ' needs a valid mode');
    if (testCase.source.kind === 'synthetic-demo') {
      assert.ok(demoIds.has(testCase.captureId), testCase.id + ' names an existing generated capture');
    } else {
      assert.ok(
        existsSync(join(process.cwd(), testCase.source.origin)),
        testCase.id + ' names an existing dataset file: ' + testCase.source.origin,
      );
    }
  }
});

test('offline evaluation is deterministic across runs', async () => {
  const first = await runOfflineEvaluation();
  const second = await runOfflineEvaluation();
  // runAt differs by wall clock; every other field must be identical.
  const stable = (r: typeof first) => JSON.stringify({ ...r, runAt: '' });
  assert.equal(stable(first), stable(second), 'two offline runs must produce identical reports');
});

test('offline evaluation reports the rubric and holds the specification', async () => {
  const report = await runOfflineEvaluation();
  assert.equal(report.mode, 'offline');
  assert.equal(report.manifestVersion, EVAL_MANIFEST_VERSION);
  assert.equal(report.datasetVersion, EVAL_DATASET_VERSION);
  assert.equal(report.provider.name, 'demo-fixture', 'offline mode never names a live provider');

  // Sample counts: 7 manifest cases, 4 offline-evaluated, 3 live-only, 2 uncertain.
  assert.equal(report.sampleCounts.manifestCases, 7);
  assert.equal(report.sampleCounts.evaluated, 4);
  assert.equal(report.sampleCounts.liveOnly, 3);
  assert.equal(report.sampleCounts.uncertain, 2);

  // Trust boundary held everywhere; comparison arithmetic matches labels.
  assert.equal(report.metrics.trustConformance, 1);
  assert.equal(report.metrics.comparisonCorrectness.correct, report.metrics.comparisonCorrectness.total);
  assert.equal(report.metrics.comparisonCorrectness.total, 4 * OFFLINE_REFERENCE.items.length);
  assert.equal(report.metrics.regressionPassed.total, 4);
  assert.equal(report.metrics.regressionPassed.passed, 4);
  // Accuracy metrics are live-only by design.
  assert.equal(report.metrics.observationPrecision, null);
  assert.equal(report.metrics.observationRecall, null);
});

test('the report contains no secret-bearing content', async () => {
  const report = await runOfflineEvaluation();
  const serialized = JSON.stringify(report);
  const secretKeys = Object.keys(process.env).filter((k) =>
    /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i.test(k));
  for (const key of secretKeys) {
    const value = process.env[key] ?? '';
    if (value.length >= 8) assert.ok(!serialized.includes(value), key + ' must never appear in the report');
  }
  const markdown = formatEvaluationReport(report);
  assert.match(markdown, /manifest version: 1\.0\.0/);
  assert.match(markdown, /trust-boundary conformance/);
  assert.match(markdown, /Known limitations/);
  for (const key of secretKeys) {
    const value = process.env[key] ?? '';
    if (value.length >= 8) assert.ok(!markdown.includes(value), key + ' must never appear in the markdown');
  }
});

test('regression scenarios cover the four documented failure modes', async () => {
  const cases = await runRegressionScenarios();
  const ids = cases.map((c) => c.id);
  for (const expected of [
    'unsupported-observation-rejected',
    'insufficient-evidence-undetermined',
    'malformed-response-fails-closed',
    'reasoning-overstatement-cannot-verify',
  ]) {
    assert.ok(ids.includes(expected), 'scenario missing: ' + expected);
    assert.equal(cases.find((c) => c.id === expected)!.passed, true, expected + ' must pass');
  }
});

test('live scoring classifies supported, unsupported, unlabeled and missed elements', () => {
  const testCase = EVALUATION_MANIFEST.find((c) => c.id === 'demo-steel-frame')!;
  // A run that detects a labelled-present element, an unlabeled element, and misses the other labelled element: precision.
  const score = scoreLiveCase(testCase, {
    observations: [
      { verificationStatus: 'UNVERIFIED', origin: 'AI_GENERATED' },
      { verificationStatus: 'UNVERIFIED', origin: 'AI_GENERATED' },
    ],
    elements: [
      { element: 'COLUMN', present: true, boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      { element: 'WORKER', present: true, boundingBox: null },
    ],
  });
  assert.deepEqual(score.supportedElements, ['COLUMN']);
  assert.deepEqual(score.unsupportedElements, []);
  assert.deepEqual(score.unlabeledDetections, ['WORKER']);
  assert.deepEqual(score.missedExpectedElements, ['SLAB']);
  assert.equal(score.reviewBoundaryHeld, true);
  assert.equal(score.excludedFromElementMetrics, false);

  // An observation that is not AI_GENERATED breaks the review boundary.
  const bad = scoreLiveCase(testCase, {
    observations: [{ verificationStatus: 'UNVERIFIED', origin: 'HUMAN' }],
    elements: [],
  });
  assert.equal(bad.reviewBoundaryHeld, false);
});

test('uncertain cases are excluded from definitive element metrics', () => {
  const uncertainCase = EVALUATION_MANIFEST.find((c) => c.id === 'sample-007-column-formwork')!;
  const score = scoreLiveCase(uncertainCase, {
    observations: [{ verificationStatus: 'UNVERIFIED', origin: 'AI_GENERATED' }],
    elements: [
      { element: 'COLUMN', present: true, boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      { element: 'FORMWORK', present: true, boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
    ],
  });
  assert.equal(score.excludedFromElementMetrics, true);
  assert.ok(uncertainCase.uncertainReason !== undefined, 'the exclusion reason is recorded');
});

test('live evaluation runs offline with the fixture provider and computes honest metrics', async () => {
  // The fixture is not a model, so this exercises the runner plumbing: report shape, per-case scoring, and honest.
  const report = await runLiveEvaluation(new DemoFixtureProvider());
  assert.equal(report.mode, 'live');
  assert.equal(report.provider.name, 'demo-fixture');
  assert.equal(report.sampleCounts.manifestCases, 7);
  assert.equal(report.cases.length, 7, 'every manifest case is attempted');
  assert.equal(report.liveScores.length, 7);
  // Precision and recall are computed (not n/a) in live mode.
  assert.notEqual(report.metrics.observationPrecision, null);
  assert.notEqual(report.metrics.observationRecall, null);
  // The two uncertain cases are excluded from element metrics.
  const excluded = report.liveScores.filter((s) => s.excludedFromElementMetrics);
  assert.equal(excluded.length, 2);
  // Every scored case held the review boundary.
  for (const score of report.liveScores) {
    assert.equal(score.reviewBoundaryHeld, true, 'no live run may self-verify');
  }
});

test('the demo script gates live mode behind an explicit flag and the package exposes it', () => {
  const script = readFileSync(join(process.cwd(), 'demo/run-eval.ts'), 'utf8');
  assert.match(script, /argv\.includes\('--live'\)/, 'live mode requires an explicit --live');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.match(pkg.scripts['eval:live'], /--live/, 'npm run eval:live passes the opt-in flag');
  assert.ok(!/--live/.test(pkg.scripts.eval), 'the default eval script never opts into live mode');
});
