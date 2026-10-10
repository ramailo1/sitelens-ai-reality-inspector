/**
 * Multi-image inspection.
 *
 * The claim under test is narrow and falsifiable:
 *
 *   If three real photographs are selected, does ONE inspection genuinely use
 *   evidence from all three?
 *
 * So most of these assert on what must NOT happen: one vision call per
 * photograph and no more, one comparison, one reasoning pass, counts never
 * summed, and canonical facts identical whatever the operator selects.
 *
 * The transport is injected throughout. That is stated plainly rather than
 * dressed up: these prove the pipeline shape and the aggregation semantics, not
 * that a live provider was reachable. The live end-to-end run is reported
 * separately in the task report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionSession } from '../src/session.ts';
import { mergeImageResults } from '../src/inspector.ts';
import type { InspectionResult } from '../src/inspector.ts';
import { compareAcrossImages } from '../src/compare.ts';
import {
  describeDisagreement,
  partitionDuplicates,
  reconcileReading,
} from '../src/multi-image.ts';
import type { ImageDetections } from '../src/multi-image.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { NemotronReasoner, UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { ProviderError } from '../src/providers/provider.ts';
import {
  resolveReasoningConfig,
  DEFAULT_NEBIUS_MODEL,
  DEFAULT_REASONING_MODEL,
} from '../src/config.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import { demoCaptures } from '../src/captures.ts';
import type { DetectedElement, ElementKind } from '../src/types/inspection.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore, groupKey } from '../src/projects.ts';
import { WorkspacePersistence } from '../src/persistence.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';

const CREDENTIAL = { apiKey: 'test-key-not-real' };

function newStore(env: NodeJS.ProcessEnv): ProjectStore {
  return new ProjectStore({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
    persistence: new WorkspacePersistence({ env }),
  });
}

/* ------------------------------------------------------------------ *
 * Real images.
 *
 * The four synthetic fixtures are genuinely different byte sequences, so
 * duplicate detection and per-image attribution are exercised against real
 * pixels rather than two copies of one buffer.
 * ------------------------------------------------------------------ */

const PHOTOS = demoCaptures();
const ONE = PHOTOS[0]!;
const TWO = PHOTOS[1]!;
const THREE = PHOTOS[2]!;

function detectionsFor(
  captureId: string,
  overrides: Partial<DetectedElement> & { element: ElementKind } = { element: 'REBAR' },
): ImageDetections {
  const base: DetectedElement = {
    element: 'REBAR',
    present: true,
    count: null,
    countBasis: 'NOT_DETERMINABLE',
    confidence: 0.7,
    evidence: 'a bar mat in ' + captureId,
    boundingBox: null,
  };
  return {
    captureId,
    captureLabel: captureId,
    detections: [{ ...base, ...overrides }],
  };
}

/* ------------------------------------------------------------------ *
 * A session over N images, with the network replaced.
 * ------------------------------------------------------------------ */

/** One provider stub per image, so a per-image response can be programmed. */
function sessionForImages(options: {
  images?: readonly { capture: typeof ONE; label: string }[];
  /** Per-image failure, keyed by capture id. */
  failFor?: Record<string, string>;
  reasonerKind?: 'real' | 'unavailable';
}) {
  const images = options.images ?? [
    { capture: ONE, label: 'north elevation' },
    { capture: TWO, label: 'close-up' },
    { capture: THREE, label: 'adjacent grid' },
  ];

  const visionCalls: string[] = [];
  const reasoningCalls: string[] = [];

  // The session uses ONE provider for every photograph, which is exactly how
  // the architecture works: one vision model, many images. So the stub must
  // identify which photograph a request carries from the image bytes
  // themselves, not from a closure over the capture.
  const byDataUrl = new Map<string, typeof ONE>();
  for (const { capture } of images) byDataUrl.set(capture.bytes.toString('base64'), capture);
  const identify = (body: string): typeof ONE | null => {
    for (const [dataUrl, capture] of byDataUrl) {
      if (body.includes(dataUrl)) return capture;
    }
    return null;
  };

  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: DEFAULT_NEBIUS_MODEL,
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: CREDENTIAL,
    env: {},
    fetchImpl: async (url: string, init: { body: string }) => {
      const capture = identify(init.body);
      assert.ok(capture !== null, 'every vision request must carry a known image');
      visionCalls.push(capture.id);
      const failure = options.failFor?.[capture.id];
      if (failure !== undefined) throw new ProviderError('UNAVAILABLE', failure);
      const payload = JSON.stringify({
        elements: [{
          element: 'REBAR', present: true, count: null, confidence: 0.7,
          evidence: 'rebar in ' + capture.id, bounding_box: null,
        }],
        observations: [{
          category: 'PROGRESS_OBSERVATION',
          observation: 'Reinforcement visible in ' + capture.id,
          evidence: { description: 'bar mat in ' + capture.id },
          confidence: 0.72, severity: 'INFO', suggested_action: 'HUMAN_REVIEW',
        }],
        findings: [],
      });
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: payload } }] }) };
    },
  });

  const reasoner = options.reasonerKind === 'unavailable'
    ? new UnavailableReasoner({ kind: 'DISABLED', message: 'off for this test' })
    : new NemotronReasoner({
        config: resolveReasoningConfig({ NEBIUS_REASONING_MODEL: DEFAULT_REASONING_MODEL }),
        credentials: CREDENTIAL,
        env: {},
        fetchImpl: async (url: string, init: { body: string }) => {
          reasoningCalls.push(url);
          const sent = JSON.parse(init.body) as { messages: { content: string }[] };
          reasoningBodies.push(sent.messages[1]?.content ?? '');
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    summary: 'Three photographs were read.',
                    whatMatters: 'The combined reading matters.',
                    rationale: 'Each photograph contributed its own visual reading.',
                    recommendation: 'Walk the zone against the combined evidence.',
                    verification: 'Confirm on site.',
                    confidence: 0.5, certainty: 'UNCERTAIN',
                  }),
                },
              }],
            }),
          };
        },
      });

  const reasoningBodies: string[] = [];

  const captures = images.map(({ capture, label }) => ({ ...capture, label }));

  const session = new InspectionSession(
    provider,
    captures[0]!,
    'proj_multi',
    'zone_level_02',
    defaultExpectedState(),
    {
      reasoner,
      projectName: 'North Core Construction',
      additionalCaptures: captures.slice(1),
    },
  );

  return { session, visionCalls, reasoningCalls, reasoningBodies, captures };
}

/* ------------------------------------------------------------------ *
 * A — single image regression
 * ------------------------------------------------------------------ */

test('A: one image still produces one valid inspection', async () => {
  const { session, visionCalls, reasoningCalls } = sessionForImages({
    images: [{ capture: ONE, label: 'north elevation' }],
  });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(visionCalls.length, 1, 'exactly one vision call');
  assert.equal(reasoningCalls.length, 1, 'exactly one reasoning call');
  assert.equal(view.images.length, 1);
  assert.equal(view.images[0]?.status, 'ANALYSED');
  assert.equal(view.observations.length, 1);
  assert.equal(view.observations[0]?.captureId, ONE.id);
  // A single image carries no source LIST: it attributes itself through captureId.
  for (const row of view.comparison) {
    assert.deepEqual(row.sourceCaptureIds, [], 'single-image rows need no source list');
  }
});

/* ------------------------------------------------------------------ *
 * B — two images
 * ------------------------------------------------------------------ */

test('B: two images produce ONE inspection carrying evidence from both', async () => {
  const { session, visionCalls, reasoningCalls } = sessionForImages({
    images: [{ capture: ONE, label: 'north elevation' }, { capture: TWO, label: 'close-up' }],
  });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(visionCalls.length, 2, 'one vision call per photograph');
  assert.equal(reasoningCalls.length, 1, 'ONE reasoning pass for the group');
  assert.equal(view.images.length, 2);

  const sources = view.observations.map((o) => o.captureId).sort();
  assert.deepEqual(sources, [ONE.id, TWO.id].sort(), 'both photographs contributed');
  assert.equal(view.observations.length, 2);
});

/* ------------------------------------------------------------------ *
 * C — three images
 * ------------------------------------------------------------------ */

test('C: three images contribute to ONE consolidated inspection', async () => {
  const { session, visionCalls, reasoningCalls } = sessionForImages({});
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(visionCalls.length, 3);
  assert.equal(reasoningCalls.length, 1);
  assert.equal(view.images.length, 3);
  assert.equal(view.observations.length, 3);

  const seen = new Set(view.observations.map((o) => o.captureId));
  for (const photo of [ONE, TWO, THREE]) {
    assert.ok(seen.has(photo.id), photo.id + ' must contribute evidence');
  }
});

/* ------------------------------------------------------------------ *
 * D — provenance
 * ------------------------------------------------------------------ */

test('D: every observation keeps its own photograph', async () => {
  const { session } = sessionForImages({});
  const view = await session.run();

  for (const observation of view.observations) {
    const known = [ONE, TWO, THREE].some((p) => p.id === observation.captureId);
    assert.ok(known, 'observation ' + observation.id + ' has an unknown capture');
    assert.ok(observation.captureLabel.length > 0, 'every observation names its photograph');
  }
});

test('D: every image is reported, including its label and status', async () => {
  const { session } = sessionForImages({});
  const view = await session.run();

  assert.deepEqual(view.images.map((i) => i.captureId), [ONE.id, TWO.id, THREE.id]);
  assert.deepEqual(view.images.map((i) => i.captureLabel), ['north elevation', 'close-up', 'adjacent grid']);
  for (const image of view.images) {
    assert.equal(image.status, 'ANALYSED');
    assert.equal(image.failure, null);
    assert.ok(image.observationCount > 0);
  }
});

test('D: a finding carries the photographs that support it', async () => {
  const { session } = sessionForImages({});
  const view = await session.run();

  const comparisonFinding = view.inspectionFindings.find((f) => f.origin === 'COMPARISON');
  assert.ok(comparisonFinding !== undefined, 'a comparison finding must exist');
  // A comparison finding rests on a reconciled row, so it inherits its sources.
  assert.ok(comparisonFinding.sourceCaptureIds.length > 0);
  assert.equal(
    comparisonFinding.sourceCaptureIds.length,
    comparisonFinding.sourceCaptureLabels.length,
    'ids and labels must align',
  );
});

/* ------------------------------------------------------------------ *
 * E — combined reasoning
 * ------------------------------------------------------------------ */

test('E: the reasoning prompt itself attributes evidence to the right photograph', async () => {
  const { session, reasoningBodies } = sessionForImages({});
  await session.run();
  const prompt = reasoningBodies[0] ?? '';

  // Not merely "the labels appear somewhere": the prompt must say it is reasoning
  // over a SET, forbid summing, and name every photograph. Without those, Nemotron
  // is reasoning over an anonymous blob of evidence.
  assert.match(prompt, /covers 3 photographs/,
    'the prompt must say it is reasoning over three frames, not one');
  assert.match(prompt, /never resolved by adding the photographs up/,
    'the prompt must forbid summing, so no invented total can appear');
  for (const label of ['north elevation', 'close-up', 'adjacent grid']) {
    assert.ok(prompt.includes(label), 'the prompt must name ' + label);
  }

  // A single photograph keeps the historical wording: no group talk at all.
  const single = sessionForImages({ images: [{ capture: ONE, label: 'north elevation' }] });
  await single.session.run();
  const singlePrompt = single.reasoningBodies[0] ?? '';
  assert.doesNotMatch(singlePrompt, /covers 1 photographs/,
    'one photograph must not be described as a set');
  assert.ok(singlePrompt.includes('north elevation'),
    'a single photograph keeps its own label verbatim');
});

test('E: Nemotron receives the COMBINED evidence, not only the first image', async () => {
  const { session, reasoningCalls, reasoningBodies } = sessionForImages({});
  await session.run();

  assert.equal(reasoningCalls.length, 1);
  const prompt = reasoningBodies[0]!;
  for (const photo of [ONE, TWO, THREE]) {
    assert.ok(prompt.includes(photo.id), 'the prompt must carry evidence from ' + photo.id);
  }
  // All three labels, so the model is told what it is reasoning over.
  assert.ok(prompt.includes('north elevation'));
  assert.ok(prompt.includes('close-up'));
  assert.ok(prompt.includes('adjacent grid'));
});

test('E: the capture label names every photograph, not just the first', async () => {
  const { session, reasoningBodies } = sessionForImages({});
  await session.run();
  assert.match(reasoningBodies[0]!, /Capture label: .*north elevation \+ close-up \+ adjacent grid/);
});

test('E: a single-image run keeps its own capture label verbatim', async () => {
  const { session, reasoningBodies } = sessionForImages({
    images: [{ capture: ONE, label: 'north elevation' }],
  });
  await session.run();
  assert.match(reasoningBodies[0]!, /Capture label: north elevation\n/);
});

/* ------------------------------------------------------------------ *
 * F — partial failure
 * ------------------------------------------------------------------ */

test('F: one failed image does not silently become a success', async () => {
  const { session, visionCalls } = sessionForImages({
    failFor: { [TWO.id]: 'Nebius Token Factory unreachable for photo 2.' },
  });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED', 'the surviving evidence still produces an inspection');
  assert.equal(visionCalls.length, 3, 'all three were attempted');

  const failed = view.images.find((i) => i.captureId === TWO.id);
  assert.ok(failed !== undefined);
  assert.equal(failed.status, 'FAILED', 'the failure is recorded, not hidden');
  assert.ok(failed.failure !== null && failed.failure.length > 0);
  assert.equal(failed.observationCount, 0, 'a failed image contributes no observations');

  // And its observations genuinely are absent.
  assert.equal(view.observations.some((o) => o.captureId === TWO.id), false);
  assert.equal(view.images.filter((i) => i.status === 'ANALYSED').length, 2);

  // The top-level result must also say so. A consumer reading only `failure`
  // would otherwise read a 2-of-3 inspection as a clean 3-of-3 and report
  // complete evidence from a photograph that was never read.
  assert.notEqual(view.failure, null,
    'a partial inspection must not report no failure at all');
  assert.equal(view.failure?.kind, 'PARTIAL_ANALYSIS');
  assert.match(String(view.failure?.message), /2 of 3/,
    'the message must state how many of how many photographs produced evidence');
});

test('F: a fully successful run reports no partial-analysis failure', async () => {
  // The counterpart to the case above. If every photograph was read, the same
  // message must NOT appear, or a clean run would cry wolf.
  const { session } = sessionForImages({});
  const view = await session.run();
  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(view.failure, null,
    'a run that read every photograph must not claim a partial analysis');
});

test('F: a run where every photograph failed is a FAILED run, not a partial one', async () => {
  // All-or-nothing is its own state and must not borrow the partial wording.
  const { session } = sessionForImages({
    failFor: { [ONE.id]: 'unreachable 1', [TWO.id]: 'unreachable 2', [THREE.id]: 'unreachable 3' },
  });
  const view = await session.run();
  assert.equal(view.outcome, 'FAILED');
  assert.notEqual(view.failure, null);
  assert.notEqual(view.failure?.kind, 'PARTIAL_ANALYSIS',
    'a run with no surviving evidence is FAILED, not PARTIAL_ANALYSIS');
  assert.equal(view.images.every((i) => i.status === 'FAILED'), true,
    'every photograph must still be reported as failed');
});

test('F: a single failed photograph reports a partial analysis, not a clean one', async () => {
  // The two-photograph shape of the same defect: one survived, one did not.
  const { session } = sessionForImages({
    images: [{ capture: ONE, label: 'north elevation' }, { capture: TWO, label: 'close-up' }],
    failFor: { [TWO.id]: 'unreachable' },
  });
  const view = await session.run();
  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(view.failure?.kind, 'PARTIAL_ANALYSIS');
  assert.match(String(view.failure?.message), /1 of 2/);
  // The surviving photograph's evidence is still real and still reported.
  assert.equal(view.images.filter((i) => i.status === 'ANALYSED').length, 1);
});

/* ------------------------------------------------------------------ *
 * G — all failure
 * ------------------------------------------------------------------ */

test('G: when every image fails, NO inspection is produced', async () => {
  const { session } = sessionForImages({
    failFor: {
      [ONE.id]: 'Nebius unreachable (1).',
      [TWO.id]: 'Nebius unreachable (2).',
      [THREE.id]: 'Nebius unreachable (3).',
    },
  });
  const view = await session.run();

  assert.equal(view.outcome, 'FAILED');
  assert.notEqual(view.outcome, 'COMPLETED');
  assert.equal(view.observations.length, 0, 'no fabricated observations');
  assert.equal(view.inspectionFindings.length, 0, 'no fabricated findings');
  assert.equal(view.comparison.length, 0, 'no fabricated comparison');
  assert.equal(view.reasoning.status, 'UNAVAILABLE', 'no reasoning about nothing');
  // Every photograph is still reported as failed.
  assert.equal(view.images.length, 3);
  assert.equal(view.images.every((i) => i.status === 'FAILED'), true);
});

/* ------------------------------------------------------------------ *
 * H — empty selection
 * ------------------------------------------------------------------ */

test('H: an empty selection starts no inspection', () => {
  assert.throws(
    () => new InspectionSession(
      new NebiusNvidiaProvider({
        config: {
          baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
          model: DEFAULT_NEBIUS_MODEL,
          timeoutMs: 1000, maxObservations: 6, maxTokens: 3000,
        },
        credentials: CREDENTIAL, env: {}, fetchImpl: async () => { throw new Error('must not be called'); },
      }),
      undefined as never,
      'p', 'z',
      undefined,
      { additionalCaptures: [] },
    ),
    /undefined|cannot read/i,
    'a session with no first capture must not construct',
  );
});

/* ------------------------------------------------------------------ *
 * I — duplicates
 * ------------------------------------------------------------------ */

test('I: byte-identical photographs are refused and reported, not silently dropped', () => {
  const result = partitionDuplicates([
    { id: 'a', label: 'first', bytes: Buffer.from('same-pixels') },
    { id: 'b', label: 'renamed copy', bytes: Buffer.from('same-pixels') },
    { id: 'c', label: 'different view', bytes: Buffer.from('other-pixels') },
  ]);

  assert.deepEqual(result.refused, ['b']);
  assert.deepEqual(result.accepted.map((c) => c.id), ['a', 'c']);
});

test('I: the accepted capture keeps EVERY field, not just id and bytes', () => {
  // This is the regression that silently blanked provenance: rebuilding a
  // `{id, bytes}` wrapper dropped label, mediaType and projectId.
  const result = partitionDuplicates([
    { id: 'a', label: 'north elevation', mediaType: 'image/jpeg', projectId: 'p1', bytes: Buffer.from('x') },
  ]);
  const kept = result.accepted[0]!;
  assert.equal(kept.label, 'north elevation');
  assert.equal(kept.mediaType, 'image/jpeg');
  assert.equal(kept.projectId, 'p1');
});

test('I: a genuine re-shoot of the same view is accepted', () => {
  const result = partitionDuplicates([
    { id: 'a', bytes: Buffer.from('frame-1') },
    { id: 'b', bytes: Buffer.from('frame-2') },
  ]);
  assert.deepEqual(result.refused, []);
  assert.equal(result.accepted.length, 2);
});

/* ------------------------------------------------------------------ *
 * The aggregation semantics: images are NEVER summed
 * ------------------------------------------------------------------ */

test('counts are not summed when photographs disagree', () => {
  const images = [
    detectionsFor('img-a', { element: 'COLUMN', count: 6, countBasis: 'VISUAL_COUNT', confidence: 0.8 }),
    detectionsFor('img-b', { element: 'COLUMN', count: 9, countBasis: 'VISUAL_COUNT', confidence: 0.7 }),
  ];
  const reading = reconcileReading('COLUMN', images);

  assert.equal(reading.disputed, true, 'two different counts are a genuine dispute');
  assert.equal(reading.count, null, 'no single count is established');

  const row = compareAcrossImages(
    {
      zone: 'North Core',
      source: 'PRESET',
      items: [{ id: 'exp_columns', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12, note: '' }],
    },
    images,
  )[0]!;

  assert.equal(row.status, 'UNDETERMINED', 'a disputed count is not resolved by guessing');
  assert.notEqual(row.observedCount, 15, '6 + 9 must never become 15');
  assert.equal(row.countDisputed, true);
  assert.match(row.difference, /photographs disagree/);
  assert.match(row.difference, /6 in img-a/);
  assert.match(row.difference, /9 in img-b/);
});

test('agreeing photographs yield the agreed count, not a sum', () => {
  const images = [
    detectionsFor('img-a', { element: 'COLUMN', count: 6, countBasis: 'VISUAL_COUNT', confidence: 0.8 }),
    detectionsFor('img-b', { element: 'COLUMN', count: 6, countBasis: 'VISUAL_COUNT', confidence: 0.7 }),
  ];
  const reading = reconcileReading('COLUMN', images);

  assert.equal(reading.disputed, false);
  assert.equal(reading.count, 6, 'two frames of six columns is six columns');

  const row = compareAcrossImages(
    {
      zone: 'North Core',
      source: 'PRESET',
      items: [{ id: 'exp_columns', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12, note: '' }],
    },
    images,
  )[0]!;
  assert.equal(row.observedCount, 6);
  assert.equal(row.status, 'ATTENTION', '6 against an expected 12 is a shortfall');
  assert.deepEqual(row.sourceCaptureIds, ['img-a', 'img-b']);
});

test('an element seen in ANY photograph satisfies PRESENT', () => {
  const images = [
    detectionsFor('img-a', { element: 'WALL', present: false, confidence: 0.6 }),
    detectionsFor('img-b', { element: 'WALL', present: true, confidence: 0.7 }),
  ];
  const reading = reconcileReading('WALL', images);
  assert.equal(reading.present, true, 'the union of what was seen is the reading of a zone');
  assert.equal(reading.sources.length, 2, 'both photographs are credited');
});

test('an element seen in ANY photograph violates ABSENT', () => {
  const row = compareAcrossImages(
    {
      zone: 'North Core', source: 'PRESET',
      items: [{ id: 'exp_exc', element: 'EXCAVATION', expectation: 'ABSENT', expectedCount: null, note: '' }],
    },
    [
      detectionsFor('img-a', { element: 'EXCAVATION', present: false, confidence: 0.6 }),
      detectionsFor('img-b', { element: 'EXCAVATION', present: true, confidence: 0.7 }),
    ],
  )[0]!;
  assert.equal(row.status, 'ATTENTION', 'seeing something that should not be there is positive evidence');
});

test('an image that refused to count does not create a dispute', () => {
  const images = [
    detectionsFor('img-a', { element: 'COLUMN', count: 6, countBasis: 'VISUAL_COUNT', confidence: 0.8 }),
    detectionsFor('img-b', { element: 'COLUMN', count: null, countBasis: 'NOT_DETERMINABLE', confidence: 0.7 }),
  ];
  assert.equal(reconcileReading('COLUMN', images).disputed, false);
});

test('an empty image set reconciles to "nothing seen" rather than throwing', () => {
  const reading = reconcileReading('COLUMN', []);
  assert.equal(reading.present, false);
  assert.equal(reading.count, null);
  assert.equal(reading.disputed, false);
  assert.equal(reading.sources.length, 0);
});

test('the disagreement sentence names the photographs, so a re-shoot is actionable', () => {
  const images = [
    detectionsFor('img-a', { element: 'COLUMN', count: 6, countBasis: 'VISUAL_COUNT', confidence: 0.8 }),
    detectionsFor('img-b', { element: 'COLUMN', count: 9, countBasis: 'VISUAL_COUNT', confidence: 0.7 }),
  ];
  const sentence = describeDisagreement(reconcileReading('COLUMN', images), images);
  assert.match(sentence, /img-a/);
  assert.match(sentence, /img-b/);
});

/* ------------------------------------------------------------------ *
 * L — no accidental extra inference
 * ------------------------------------------------------------------ */

test('L: N images mean exactly N vision calls and exactly 1 reasoning call', async () => {
  for (const n of [1, 2, 3]) {
    const images = [
      { capture: ONE, label: 'a' },
      { capture: TWO, label: 'b' },
      { capture: THREE, label: 'c' },
    ].slice(0, n);
    const { session, visionCalls, reasoningCalls } = sessionForImages({ images });
    await session.run();
    assert.equal(visionCalls.length, n, n + ' images must mean ' + n + ' vision calls');
    assert.equal(reasoningCalls.length, 1, 'exactly one reasoning pass, whatever the image count');
  }
});

test('L: the same photograph twice is analysed once', async () => {
  const { session, visionCalls } = sessionForImages({
    images: [{ capture: ONE, label: 'a' }, { capture: ONE, label: 'a again' }],
  });
  await session.run();
  assert.equal(visionCalls.length, 1, 'a repeated capture id must not be analysed twice');
});

/* ------------------------------------------------------------------ *
 * K — canonical invariance and NVIDIA eligibility
 * ------------------------------------------------------------------ */

test('K: localizing or re-viewing does not change any canonical fact', async () => {
  const { session } = sessionForImages({});
  const view = await session.run();
  const snapshot = JSON.stringify({
    observations: view.observations.map((o) => [o.id, o.captureId, o.severity, o.confidence]),
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.sourceCaptureIds]),
    rows: view.comparison.map((r) => [r.id, r.status, r.observedCount, r.sourceCaptureIds]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
  });

  // Re-render several times, as a language switch does.
  for (let i = 0; i < 4; i++) session.view();

  assert.equal(JSON.stringify({
    observations: view.observations.map((o) => [o.id, o.captureId, o.severity, o.confidence]),
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.sourceCaptureIds]),
    rows: view.comparison.map((r) => [r.id, r.status, r.observedCount, r.sourceCaptureIds]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
  }), snapshot);
});

test('K: NVIDIA eligibility is unchanged by how many images ran', async () => {
  const single = await sessionForImages({ images: [{ capture: ONE, label: 'a' }] }).session.run();
  const triple = await sessionForImages({}).session.run();

  for (const view of [single, triple]) {
    assert.equal(view.pipelineEligibility.nvidiaRequirement, 'MET');
    assert.equal(view.pipelineEligibility.qualifyingStage, 'REASONING');
    assert.equal(view.pipelineEligibility.platform, 'Nebius Token Factory');
    assert.equal(view.pipelineEligibility.stages[0]?.isNvidiaModel, false, 'MiniCPM is not NVIDIA');
    assert.equal(view.pipelineEligibility.stages[1]?.isNvidiaModel, true, 'Nemotron is NVIDIA');
  }
});

/* ------------------------------------------------------------------ *
 * Merging
 * ------------------------------------------------------------------ */

test('merging concatenates without mutating any image result', () => {
  const mk = (captureId: string, n: number): InspectionResult => ({
    captureId, provider: 'nebius-nvidia', model: 'm', inspectedAt: '2026-01-01T00:00:00.000Z',
    observations: [], rejected: [], bands: [],
    elements: [{
      element: 'REBAR', present: true, count: n, countBasis: 'VISUAL_COUNT',
      confidence: 0.8, evidence: 'e', boundingBox: null,
    }],
  });
  const a = mk('a', 3);
  const b = mk('b', 4);
  const merged = mergeImageResults([a, b]);

  assert.equal(merged.captureId, 'a', 'the first capture is the primary identity');
  assert.deepEqual(merged.captureIds, ['a', 'b'], 'the full contributing set is recorded');
  assert.equal(merged.elements?.length, 2);
  assert.equal(a.elements?.length, 1, 'the input must not be mutated');
  assert.equal(b.elements?.length, 1);
});

test('merging refuses an empty set rather than inventing one', () => {
  assert.throws(() => mergeImageResults([]), /at least one result/);
});

/* ------------------------------------------------------------------ *
 * Persistence of a consolidated inspection.
 *
 * A multi-photo inspection is WRITTEN under one group key, so it has to be READ
 * back under that same key. Getting this wrong is invisible in a single-photo
 * test - it is the defect where reopening a project shows an empty evidence
 * stage while the real findings sit on disk, so it is worth its own test.
 * ------------------------------------------------------------------ */

test('a consolidated inspection comes back after a restart, with its per-photo provenance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-multi-'));
  try {
    const env = { SITELENS_DATA_DIR: dir } as NodeJS.ProcessEnv;
    const first = newStore(env);

    // Real images, added as three separate uploads: the point is a group of
  // genuine distinct photographs, not one buffer copied three times.
  first.create({ name: 'Level 02 re-shoot', location: 'North core' });
  const ids = PHOTOS.slice(0, 3).map((photo, index) => first.addCapture({
    id: 'cap_restore_' + index,
    label: photo.label,
    bytes: photo.bytes,
    mediaType: photo.mediaType,
    dimensions: photo.dimensions,
    content: photo.content,
    source: 'UPLOAD',
  }).id);
  assert.equal(ids.length, 3);

  const selected = first.selectCaptureGroup(ids);
  assert.ok(selected.ok);
  if (!selected.ok) return;
  const session = selected.value;
  // Awaited: `run` is async, and asserting on the view before the vision calls
  // land would read a PENDING session and pass for the wrong reason.
  const runView = await session.run();
  assert.equal(runView.outcome, 'COMPLETED');
  // Persisted the way the server persists it after a successful run, so the read
  // path below is tested against the real write, not a hand-built record.
  first.persistInspection(groupKey(first.selectedCaptures()));
  const before = session.view().observations.length;
  assert.ok(before > 0, 'the fixture run must produce evidence to restore');

  // Written under the GROUP key, which is what a multi-photo run must restore
  // under. Asserting it here is what makes the read path's key a real claim.
  const key = groupKey(first.selectedCaptures());
  assert.match(key, /^grp_/);
  const written = new WorkspacePersistence({ env }).loadInspection(key);
  assert.ok(written !== null, 'the consolidated inspection must be on disk under the group key');
  assert.equal(written?.payloads?.length, 3, 'all three photographs must be persisted separately');

  // A NEW store against the same directory, as after a restart. `restore()`
  // must come first: seeding persists, and persisting an empty store would
  // overwrite the state this test is about to prove.
  const second = newStore(env);
  second.restore();
  const restored = second.selectCaptureGroup(ids);
  assert.ok(restored.ok);
  if (!restored.ok) return;
  const view = restored.value.view();

  assert.equal(view.outcome, 'COMPLETED', 'the restored inspection must not come back empty');
  // The origin is preserved from what actually ran. With the offline fixture that
  // is DEMO_FIXTURE, never FRESH: a restored result must never claim to be a new
  // model call, whatever produced the original.
  assert.notEqual(view.inferenceOrigin, 'FRESH',
    'a restored result must never be presented as a fresh inference');
  assert.equal(view.observations.length, before,
    'every observation must survive the restart');
  // Every photograph contributed, and every observation still names its own
  // source. Asserted as a set because the fixture yields three observations per
  // photograph; what matters is that none is unattributed and none is lost.
  assert.deepEqual(
    [...new Set(view.observations.map((o) => o.captureId))].sort(),
    [...ids].sort(),
    'all three photographs must be represented, each observation still attributed',
  );
  assert.equal(view.images.length, 3, 'the restored view must report all three photographs');
  assert.equal(
    view.images.filter((image) => image.status === 'FAILED').length,
    0,
    'no photograph failed in this run',
  );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
/* ------------------------------------------------------------------ *
 * Restore refuses a photograph it does not hold.
 *
 * A stored inspection may name a capture the session no longer has, whose
 * bytes are unavailable. Restoring it anyway would attach its observations to
 * an image identity nobody can open, so it is skipped. The guard had no direct
 * test: the restart suite only ever restored captures it still held.
 * ------------------------------------------------------------------ */

test('a restored payload naming an absent capture is skipped, not misattributed', async () => {
  const { session, captures } = sessionForImages({ images: [{ capture: ONE, label: 'only-frame' }] });
  const held = captures.map((c) => c.id);
  assert.ok(held.length === 1, 'the fixture holds exactly one photograph');

  const record: any = {
    provider: 'demo-fixture',
    model: 'demo-fixture-vision-v1',
    inspectedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 1,
    inferenceOrigin: 'FRESH',
    // Empty: this record carries no human decisions, and the restore path
    // expects the field rather than tolerating its absence.
    reviews: [],
    payload: {
      elements: [{ element: 'REBAR', present: true, count: null, confidence: 0.7, evidence: 'e', boundingBox: null }],
      observations: [],
      findings: [],
      rejected: [],
      rejectedInspection: [],
    },
    // One payload the session CAN resolve, and one it cannot.
    payloads: [
      {
        captureId: held[0],
        captureLabel: 'only-frame',
        payload: {
          elements: [{ element: 'REBAR', present: true, count: null, confidence: 0.7, evidence: 'e', boundingBox: null }],
          observations: [],
          findings: [],
          rejected: [],
          rejectedInspection: [],
        },
      },
      {
        captureId: 'cap_not_held_anywhere',
        captureLabel: 'vanished-frame',
        payload: {
          elements: [{ element: 'COLUMN', present: true, count: null, confidence: 0.9, evidence: 'e', boundingBox: null }],
          observations: [],
          findings: [],
          rejected: [],
          rejectedInspection: [],
        },
      },
    ],
  };

  const ok = session.restoreInspection(record);
  assert.equal(ok, true, 'the resolvable payload must still restore');
  const view = session.view();

  // The unheld capture contributes nothing: no detection, no image row, and
  // certainly no observation labelled with an image nobody can open.
  assert.equal(view.detections.some((d) => d.captureId === 'cap_not_held_anywhere'), false,
    'a detection must not be attributed to a capture the session does not hold');
  assert.equal(view.detections.some((d) => d.element === 'COLUMN'), false,
    'nothing from the unresolvable payload may appear');
  assert.equal(view.images.some((i) => i.captureId === 'cap_not_held_anywhere'), false,
    'an unheld capture must not appear as a contributing photograph');

  // And the payload that COULD be resolved is untouched by the one that could not.
  assert.equal(view.detections.some((d) => d.element === 'REBAR'), true,
    'the resolvable detection must survive the skipped one');
});