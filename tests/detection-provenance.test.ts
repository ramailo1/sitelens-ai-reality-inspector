/**
 * Frame-level provenance of detected elements.
 *
 * A consolidated inspection reads several photographs and presents ONE list of
 * detections. Every entry therefore has to name the photograph that produced
 * it, because the evidence overlay positions that entry's box against a frame's
 * dimensions and shows its label beside it. An entry attributed to the wrong
 * frame is a claim the model never made: a box read from one photograph drawn on
 * another.
 *
 * The defect these guard against: the session walked the merged element list
 * with a POSITION->frame map that was filled using a per-photograph index, so
 * two photographs that each reported two elements overwrote each other's keys.
 * Everything was then attributed to the last photograph that contributed an
 * entry and the remainder fell back to the primary capture. One element per
 * photograph cannot trigger it, which is why the existing suite never saw it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionSession } from '../src/session.ts';
import type { DemoCapture } from '../src/captures.ts';
import type { AIProvider } from '../src/providers/provider.ts';
import { ProviderError } from '../src/providers/provider.ts';
import { defaultExpectedState } from '../src/expected-state.ts';

function frame(id: string, label: string, marker: number): DemoCapture {
  return {
    id,
    label,
    // One distinct byte per frame, so a stub can tell which photograph a
    // request carried without closing over the capture it was built from.
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, marker]),
    mediaType: 'image/png',
    dimensions: { width: 8, height: 8 },
    content: label,
  };
}

const A = frame('cap_aaaaaaaa', 'frame-a', 65);
const B = frame('cap_bbbbbbbb', 'frame-b', 66);
const C = frame('cap_cccccccc', 'frame-c', 67);

interface ElementSpec {
  readonly element: 'REBAR' | 'COLUMN';
  readonly present: boolean;
  readonly confidence: number;
}

interface RunOptions {
  readonly frames: readonly DemoCapture[];
  /** What each frame reports, keyed by the frame's marker byte. */
  readonly perFrame: Readonly<Record<number, readonly ElementSpec[]>>;
  /** Frames the provider fails on, keyed by marker byte. */
  readonly failFor?: readonly number[];
}

/** Runs one consolidated inspection and returns the view plus provider calls. */
async function runInspection(options: RunOptions) {
  const calls: string[] = [];
  const failing = options.failFor ?? [];

  const provider: AIProvider = {
    name: 'provenance',
    model: 'provenance-v1',
    async inspect(request: { image: { bytes: Buffer } }) {
      const marker = request.image.bytes[4]!;
      const who = options.frames.find((f) => f.bytes[4] === marker)?.label ?? 'unknown';
      calls.push(who);
      if (failing.includes(marker)) {
        // A ProviderError specifically: the session absorbs those per frame so
        // one unreadable photograph cannot discard the others. A plain Error is
        // rethrown and would fail the whole run.
        throw new ProviderError('UNAVAILABLE', `provider unreachable for ${who}`);
      }
      const specs = options.perFrame[marker] ?? [];
      return {
        provider: 'provenance',
        model: 'provenance-v1',
        inspectedAt: '2026-01-01T00:00:00.000Z',
        latencyMs: 1,
        elements: specs.map((s) => ({
          element: s.element,
          present: s.present,
          count: null,
          confidence: s.confidence,
          // The frame name is in the evidence, giving the test ground truth for
          // what the model actually read.
          evidence: `seen in ${who}`,
          boundingBox: null,
        })),
        observations: [],
        findings: [],
        rejected: [],
        rejectedInspection: [],
        inferenceOrigin: 'FRESH',
      } as unknown as Awaited<ReturnType<AIProvider['inspect']>>;
    },
  };

  const session = new InspectionSession(
    provider,
    options.frames[0]!,
    'proj_prov',
    'zone_level_02',
    defaultExpectedState(),
    { projectName: 'Provenance', additionalCaptures: options.frames.slice(1) },
  );
  const view = await session.run();
  return { view, calls };
}

/** The frame a detection's evidence says the model read. */
function frameThatProduced(evidence: string): string {
  const match = /seen in (\S+)/.exec(evidence);
  return match === null ? 'unknown' : match[1]!;
}

test('two elements from each of two frames stay attributed to their own frame', async () => {
  const { view } = await runInspection({
    frames: [A, B],
    perFrame: {
      [A.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.6 },
        { element: 'COLUMN', present: true, confidence: 0.6 },
      ],
      [B.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.6 },
        { element: 'COLUMN', present: true, confidence: 0.6 },
      ],
    },
  });

  assert.equal(view.detections.length, 4, 'both elements from both frames are reported');
  for (const d of view.detections) {
    assert.equal(d.captureLabel, frameThatProduced(d.evidence),
      `a detection read in frame ${frameThatProduced(d.evidence)} is labelled ${d.captureLabel}`);
  }
});

test('differing counts per frame do not confuse attribution', async () => {
  const { view } = await runInspection({
    frames: [A, B, C],
    perFrame: {
      [A.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.9 },
        { element: 'COLUMN', present: true, confidence: 0.4 },
      ],
      [B.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.5 },
      ],
      [C.bytes[4]!]: [
        { element: 'REBAR', present: false, confidence: 0.8 },
        { element: 'COLUMN', present: true, confidence: 0.7 },
      ],
    },
  });

  assert.equal(view.detections.length, 5);
  for (const d of view.detections) {
    assert.equal(d.captureLabel, frameThatProduced(d.evidence),
      `element ${d.element} read in ${frameThatProduced(d.evidence)} is labelled ${d.captureLabel}`);
  }
});

test('conflicting presence across frames keeps each frame its own reading', async () => {
  // Frame A says present, frame C says absent. Both readings are real and each
  // belongs to its own frame; neither may be rewritten onto the other.
  const { view } = await runInspection({
    frames: [A, C],
    perFrame: {
      [A.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.9 }],
      [C.bytes[4]!]: [{ element: 'REBAR', present: false, confidence: 0.9 }],
    },
  });

  const readings = view.detections.map((d) => ({ label: d.captureLabel, present: d.present }));
  assert.deepEqual(readings, [
    { label: 'frame-a', present: true },
    { label: 'frame-c', present: false },
  ], 'each frame keeps exactly the reading the model returned for it');
});

test('a frame that fails contributes no detection and steals no attribution', async () => {
  const { view } = await runInspection({
    frames: [A, B, C],
    failFor: [B.bytes[4]!],
    perFrame: {
      [A.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.6 },
        { element: 'COLUMN', present: true, confidence: 0.6 },
      ],
      [C.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.6 },
        { element: 'COLUMN', present: true, confidence: 0.6 },
      ],
    },
  });

  // A failed frame reads nothing, so it may not appear as the source of a
  // reading, and the surviving frames must stay correctly attributed.
  assert.equal(view.detections.length, 4);
  for (const d of view.detections) {
    assert.notEqual(d.captureLabel, 'frame-b', 'a failed frame cannot have produced a reading');
    assert.equal(d.captureLabel, frameThatProduced(d.evidence));
  }
  const failed = view.images.find((i) => i.captureLabel === 'frame-b');
  assert.equal(failed?.status, 'FAILED', 'the unread frame is still reported as failed');
});

test('provenance survives a partial analysis without inventing a frame', async () => {
  const { view } = await runInspection({
    frames: [A, B],
    failFor: [B.bytes[4]!],
    perFrame: {
      [A.bytes[4]!]: [
        { element: 'REBAR', present: true, confidence: 0.6 },
        { element: 'COLUMN', present: true, confidence: 0.6 },
      ],
      [B.bytes[4]!]: [],
    },
  });

  assert.equal(view.failure?.kind, 'PARTIAL_ANALYSIS', 'the run is honestly partial');
  assert.equal(view.detections.length, 2, 'only the readable frame contributes detections');
  for (const d of view.detections) {
    assert.equal(d.captureId, A.id, 'every surviving detection names the frame that produced it');
    assert.equal(d.captureLabel, 'frame-a');
  }
});

test('the deterministic comparison result is unchanged by provenance', async () => {
  // Attribution must not alter what the comparison concluded. Both frames
  // report the same element, so the reconciled verdict must be identical to the
  // single-frame verdict for that element.
  const multi = await runInspection({
    frames: [A, B],
    perFrame: {
      [A.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }],
      [B.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }],
    },
  });
  const single = await runInspection({
    frames: [A],
    perFrame: { [A.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }] },
  });

  const rows = (v: typeof multi.view) =>
    v.comparison.map((r) => ({ element: r.element, status: r.status, observed: r.observedCount }));
  assert.deepEqual(rows(multi.view), rows(single.view),
    'reading one photograph twice must not change the comparison verdict');
});

test('every detection names one of the frames actually offered', async () => {
  const { view } = await runInspection({
    frames: [A, B, C],
    perFrame: {
      [A.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }],
      [B.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }],
      [C.bytes[4]!]: [{ element: 'REBAR', present: true, confidence: 0.6 }],
    },
  });
  const offered = new Set([A.id, B.id, C.id]);
  for (const d of view.detections) {
    assert.ok(offered.has(d.captureId),
      `detection names ${d.captureId}, which is not one of the frames offered`);
  }
});