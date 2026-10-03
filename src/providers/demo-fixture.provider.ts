/**
 * Deterministic offline provider so the full flow can be run without a Nebius
 * account or network access.
 *
 * It returns fixed synthetic observations that pass through the same
 * validation as a real model response and still start UNVERIFIED. It does not
 * call Nebius, so a demo run does not satisfy the hackathon's requirement to
 * run on Nebius with an NVIDIA model.
 */

import type { AIProvider, InspectRequest, RawProviderResult } from './provider.ts';
import type { RawModelObservation } from '../types/observation.ts';

export const DEMO_PROVIDER_NAME = 'demo-fixture' as const;
export const DEMO_MODEL_ID = 'demo-fixture-vision-v1' as const;

/** Fixed synthetic content. Deterministic: the same input always yields this. */
const DEMO_OBSERVATIONS: readonly RawModelObservation[] = Object.freeze([
  {
    category: 'OBSERVED_ELEMENT',
    observation: 'A steel frame structure with vertical columns is visible across the site.',
    evidence: {
      description: 'Vertical steel members are clearly distinguishable in the mid-ground.',
    },
    confidence: 0.82,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
    bounding_box: { x: 0.2, y: 0.15, width: 0.6, height: 0.5 },
  },
  {
    category: 'PROGRESS_OBSERVATION',
    observation: 'Scaffolding is erected along the left elevation, indicating work in progress there.',
    evidence: {
      description: 'A regular tubular scaffold pattern is visible on the left side of the frame.',
    },
    confidence: 0.74,
    severity: 'INFO',
    suggested_action: 'HUMAN_REVIEW',
    bounding_box: { x: 0.0, y: 0.1, width: 0.28, height: 0.7 },
  },
  {
    category: 'POTENTIAL_DEVIATION',
    observation:
      'An open edge is visible at the upper level without a visible guardrail in this view.',
    evidence: {
      description: 'The floor edge at upper-left shows no continuous barrier in the image.',
    },
    confidence: 0.58,
    severity: 'MEDIUM',
    suggested_action: 'INSPECT_CLOSER',
    bounding_box: { x: 0.05, y: 0.05, width: 0.35, height: 0.2 },
  },
  {
    category: 'POTENTIAL_RISK',
    observation: 'Material stacks are positioned within the apparent work area.',
    evidence: {
      description: 'Stacked materials are visible on the ground near the structure base.',
    },
    confidence: 0.44,
    severity: 'LOW',
    suggested_action: 'HUMAN_REVIEW',
    bounding_box: null,
  },
  {
    category: 'SUGGESTED_FOLLOW_UP',
    observation: 'A reference-plan overlay would help confirm whether the visible frame matches design.',
    evidence: {
      description: 'No reference drawing is available in this image to compare against.',
    },
    confidence: 0.4,
    severity: 'INFO',
    suggested_action: 'CAPTURE_REFERENCE_PLAN',
    bounding_box: null,
  },
]);

/** Deterministic, offline, credential-free provider used for demos/tests. */
export class DemoFixtureProvider implements AIProvider {
  public readonly name = DEMO_PROVIDER_NAME;
  public readonly model = DEMO_MODEL_ID;

  async inspect(_request: InspectRequest): Promise<RawProviderResult> {
    // Deep-clone so a caller cannot mutate the shared frozen fixture.
    return {
      provider: this.name,
      model: this.model,
      observations: DEMO_OBSERVATIONS.map((entry) => structuredClone(entry)),
    };
  }
}