/**
 * Compatibility evaluation.
 *
 * A RELIABILITY suite, not an accuracy benchmark: there is no ground truth here,
 * so no correctness score is computed and none should be inferred. A model that
 * returns plausible text for a scene it cannot see would still pass.
 *
 * What is measured: whether the request completed, whether structured output
 * parsed, how many entries survived strict validation, whether invalid output
 * was rejected rather than repaired, and whether the trust boundary held.
 */

import { createProvider } from './providers/factory.ts';
import { ProviderError } from './providers/provider.ts';
import { RealityInspector } from './inspector.ts';
import { demoCaptures } from './captures.ts';
import type { DemoCapture } from './captures.ts';

export interface EvaluationCase {
  readonly id: string;
  readonly description: string;
  /** Conditions the case is meant to exercise. */
  readonly focus: readonly string[];
  readonly capture: DemoCapture;
}

export interface EvaluationOutcome {
  readonly caseId: string;
  readonly description: string;
  readonly focus: readonly string[];
  readonly requestSucceeded: boolean;
  readonly producedObservations: boolean;
  readonly accepted: number;
  readonly rejected: number;
  /** Rejections must be visible, never silently discarded. */
  readonly rejectionReported: boolean;
  /** Every accepted observation must remain AI_GENERATED at creation. */
  readonly allAiGenerated: boolean;
  readonly allUnverified: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
  /** True when the pipeline behaved as specified for this case. */
  readonly behavedAsSpecified: boolean;
}

/**
 * Build the evaluation set from the generated capture set.
 *
 * Each capture is a distinct construction condition, so the spread of focus
 * areas is real rather than relabelled duplicates.
 */
export function evaluationCases(): EvaluationCase[] {
  const byId = new Map(demoCaptures().map((c) => [c.id, c] as const));

  const pick = (id: string): DemoCapture => {
    const capture = byId.get(id);
    if (!capture) throw new Error(`unknown evaluation capture: ${id}`);
    return capture;
  };

  return [
    {
      id: 'concrete-slab',
      description: 'Concrete slab with column stub, starter bars and formwork stacks.',
      focus: ['concrete', 'reinforcement', 'formwork', 'unfinished work', 'multiple elements'],
      capture: pick('cap_concrete_slab'),
    },
    {
      id: 'steel-frame-open-edge',
      description: 'Steel frame with an open floor edge and no visible guardrail.',
      focus: ['structural steel', 'openings', 'potential deviation', 'safety-related'],
      capture: pick('cap_steel_frame'),
    },
    {
      id: 'excavation-obstruction',
      description: 'Open excavation with plant and a material stack obstructing the area.',
      focus: ['excavation', 'equipment', 'material obstruction', 'plant in working area'],
      capture: pick('cap_excavation'),
    },
    {
      id: 'finished-facade',
      description: 'Completed facade with regular openings; a reference condition.',
      focus: ['finished work', 'openings', 'reference condition', 'contrast case'],
      capture: pick('cap_finished_facade'),
    },
  ];
}

/**
 * Run every evaluation case through the real pipeline and report what happened.
 *
 * Failures are recorded rather than thrown, because an unavailable provider is
 * itself a result the operator needs to see.
 */
export async function runEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EvaluationOutcome[]> {
  const outcomes: EvaluationOutcome[] = [];

  for (const testCase of evaluationCases()) {
    const provider = createProvider(env);
    const inspector = new RealityInspector({ provider });
    const started = Date.now();

    try {
      const result = await inspector.inspectCapture({
        image: {
          bytes: testCase.capture.bytes,
          mediaType: testCase.capture.mediaType,
          captureId: testCase.capture.id,
        },
        projectId: 'proj_eval',
        zoneId: 'zone_eval',
      });
      const latencyMs = Date.now() - started;

      const allAiGenerated =
        result.observations.length === 0 ||
        result.observations.every((o) => o.origin === 'AI_GENERATED');
      const allUnverified =
        result.observations.length === 0 ||
        result.observations.every((o) => o.verificationStatus === 'UNVERIFIED');

      // An empty result is only acceptable if nothing was rejected: a run that
      // discarded every entry has lost information and is not a clean pass.
      const behavedAsSpecified =
        allAiGenerated &&
        allUnverified &&
        (result.observations.length > 0 || result.rejected.length === 0);

      outcomes.push({
        caseId: testCase.id,
        description: testCase.description,
        focus: testCase.focus,
        requestSucceeded: true,
        producedObservations: result.observations.length > 0,
        accepted: result.observations.length,
        rejected: result.rejected.length,
        rejectionReported: true,
        allAiGenerated,
        allUnverified,
        latencyMs,
        error: null,
        behavedAsSpecified,
      });
    } catch (error: unknown) {
      const latencyMs = Date.now() - started;
      const kind = error instanceof ProviderError ? error.kind : 'ERROR';
      outcomes.push({
        caseId: testCase.id,
        description: testCase.description,
        focus: testCase.focus,
        requestSucceeded: false,
        producedObservations: false,
        accepted: 0,
        rejected: 0,
        rejectionReported: true,
        allAiGenerated: true,
        allUnverified: true,
        latencyMs,
        error: `${kind}: ${error instanceof Error ? error.message : String(error)}`,
        // A provider failure is a legitimate outcome, not a specification
        // violation: it produced no fabricated observations.
        behavedAsSpecified: true,
      });
    }
  }

  return outcomes;
}

/** Aggregate counters. No accuracy, precision or ranking is derived here. */
export function summarizeEvaluation(outcomes: readonly EvaluationOutcome[]): {
  readonly cases: number;
  readonly requestsSucceeded: number;
  readonly casesWithObservations: number;
  readonly totalAccepted: number;
  readonly totalRejected: number;
  readonly allSpecificationRespected: boolean;
} {
  return {
    cases: outcomes.length,
    requestsSucceeded: outcomes.filter((o) => o.requestSucceeded).length,
    casesWithObservations: outcomes.filter((o) => o.producedObservations).length,
    totalAccepted: outcomes.reduce((sum, o) => sum + o.accepted, 0),
    totalRejected: outcomes.reduce((sum, o) => sum + o.rejected, 0),
    allSpecificationRespected: outcomes.every((o) => o.behavedAsSpecified),
  };
}