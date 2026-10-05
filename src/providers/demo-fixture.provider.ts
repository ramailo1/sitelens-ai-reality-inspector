/**
 * Deterministic offline provider so the full flow can be run without a Nebius
 * account or network access.
 *
 * Returns fixed synthetic content that passes through the same validation as a
 * real model response and still starts UNVERIFIED.
 *
 * The fixture is not AI inference. Every result derived from it is marked
 * `synthetic: true` all the way to the UI, which labels it on screen.
 */

import type { AIProvider, InspectRequest, RawProviderResult } from './provider.ts';
import type { RawModelObservation } from '../types/observation.ts';

export const DEMO_PROVIDER_NAME = 'demo-fixture' as const;
export const DEMO_MODEL_ID = 'demo-fixture-vision-v1' as const;

/**
 * Fixed synthetic content. Deterministic: the same input always yields this.
 *
 * These numbers are chosen to demonstrate all three comparison outcomes at once
 * - a match, a clear numeric shortfall, and an item the capture cannot settle -
 * so the demo shows a credible mixed result rather than a flattering one.
 */
const DEMO_ELEMENTS: readonly unknown[] = Object.freeze([
  {
    element: 'COLUMN',
    present: true,
    count: 4,
    confidence: 0.86,
    evidence: 'Four vertical structural members are distinguishable across the frame.',
    bounding_box: { x: 0.12, y: 0.28, width: 0.76, height: 0.42 },
  },
  {
    element: 'SLAB',
    present: true,
    count: null,
    confidence: 0.78,
    evidence: 'A large horizontal deck surface spans the lower half of the frame.',
    bounding_box: { x: 0.0, y: 0.62, width: 1.0, height: 0.38 },
  },
  {
    element: 'WALL',
    present: true,
    count: null,
    confidence: 0.62,
    evidence: 'Masonry is visible at the left edge of the frame.',
    bounding_box: { x: 0.0, y: 0.3, width: 0.2, height: 0.5 },
  },
  {
    element: 'MEP_ROUGH_IN',
    // Deliberately omitted count: this is the honest "I can see services but I
    // will not put a number on them" case the product is built to handle.
    confidence: 0.41,
    evidence: 'Services are partially visible behind the frame; extent is unclear.',
    present: true,
    bounding_box: null,
  },
]);

const DEMO_FINDINGS: readonly unknown[] = Object.freeze([
  {
    title: 'Column spacing looks irregular',
    category: 'DEVIATION',
    severity: 'MEDIUM',
    element: 'COLUMN',
    location: 'across the mid-ground',
    observation: 'The visible columns are not evenly spaced across the frame.',
    reason:
      'Column spacing appears to vary, which is commonly caused by a setting-out ' +
      'error rather than a design change.',
    evidence: 'The gaps between adjacent vertical members differ visibly.',
    confidence: 0.72,
    recommendation:
      'Verify column positions against the setting-out drawing using a physical ' +
      'survey measurement before any corrective work is planned.',
    bounding_box: { x: 0.12, y: 0.28, width: 0.76, height: 0.42 },
  },
  {
    title: 'Open slab edge with no visible edge protection',
    category: 'SAFETY_ATTENTION',
    severity: 'HIGH',
    element: 'SLAB',
    location: 'upper left of the deck',
    observation: 'A deck edge is exposed with no continuous barrier visible.',
    reason:
      'Edge protection is normally present at an open deck. Its absence in this ' +
      'view is either a genuine gap or simply outside the frame.',
    evidence: 'The deck perimeter shows no continuous rail or barrier.',
    confidence: 0.58,
    recommendation:
      'Confirm edge protection physically before the next activity starts on this level.',
    bounding_box: { x: 0.02, y: 0.58, width: 0.3, height: 0.14 },
  },
]);

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
    bounding_box: { x: 0.12, y: 0.28, width: 0.76, height: 0.42 },
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
    bounding_box: { x: 0.02, y: 0.58, width: 0.3, height: 0.14 },
  },
]);

/** Deterministic, offline, credential-free provider used for demos and tests. */
export class DemoFixtureProvider implements AIProvider {
  public readonly name = DEMO_PROVIDER_NAME;
  public readonly model = DEMO_MODEL_ID;

  async inspect(_request: InspectRequest): Promise<RawProviderResult> {
    // Deep-clone so a caller cannot mutate the shared frozen fixture.
    return {
      provider: this.name,
      model: this.model,
      elements: structuredClone(DEMO_ELEMENTS) as unknown[],
      findings: structuredClone(DEMO_FINDINGS) as unknown[],
      observations: DEMO_OBSERVATIONS.map((entry) => structuredClone(entry)),
    };
  }
}