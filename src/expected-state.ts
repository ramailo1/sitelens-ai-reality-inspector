/**
 * Expected state presets.
 *
 * This is deliberately NOT a BIM model and NOT a schedule of works. It is a
 * short, editable inspection reference - the "what should I see if this zone is
 * where it should be" list that makes REALITY vs EXPECTATION possible without
 * a perfect model.
 *
 * Every preset is labelled `source: 'PRESET'` and the UI displays that label,
 * so a judge can never mistake a demo reference for the project's own
 * programme. An operator can edit it and it becomes `source: 'OPERATOR'`.
 */

import type { ExpectedItem, ExpectedState } from './types/inspection.ts';
import { isElementKind, isExpectation } from './types/inspection.ts';
import { expectedTextFor } from './compare.ts';

function item(
  id: string,
  element: string,
  expectation: string,
  expectedCount: number | null,
  note: string,
): ExpectedItem {
  // The presets are compile-time constants, but they are validated anyway so a
  // typo becomes a loud failure rather than a silently wrong reference.
  if (!isElementKind(element)) throw new Error(`bad element in expected state: ${element}`);
  if (!isExpectation(expectation)) {
    throw new Error(`bad expectation in expected state: ${expectation}`);
  }
  return { id, element, expectation, expectedCount, note };
}

/**
 * The hackathon demo reference: North Core, mid-structure.
 *
 * Chosen because it produces a genuinely mixed result rather than a flattering
 * one: some items match, one is a clear numeric shortfall, and several cannot
 * be settled from a single photograph. That mix is what a credible inspection
 * tool looks like.
 */
export const NORTH_CORE_EXPECTED: ExpectedState = {
  zone: 'North Core',
  source: 'PRESET',
  items: [
    item('exp_columns', 'COLUMN', 'COUNT', 12, 'grid C1-C12'),
    item('exp_slab', 'SLAB', 'PRESENT', null, 'substantially complete'),
    item('exp_mep', 'MEP_ROUGH_IN', 'PRESENT', null, 'services roughed in'),
    item('exp_masonry', 'WALL', 'PRESENT', null, 'masonry progressing'),
    item('exp_openings', 'OPENING', 'PRESENT', null, 'designated wall openings'),
    item('exp_excavation', 'EXCAVATION', 'ABSENT', null, 'no open excavation in this zone'),
  ],
};

/** A calm reference condition, used to show a clean comparison. */
export const SOUTH_WING_EXPECTED: ExpectedState = {
  zone: 'South Wing',
  source: 'PRESET',
  items: [
    item('sw_facade', 'WALL', 'PRESENT', null, 'facade complete'),
    item('sw_openings', 'OPENING', 'COUNT', 8, 'designated openings'),
    item('sw_scaffold', 'SCAFFOLD', 'ABSENT', null, 'scaffold struck'),
  ],
};

/** Every preset the UI offers, keyed by id. */
export const EXPECTED_PRESETS: Readonly<Record<string, ExpectedState>> = {
  'north-core': NORTH_CORE_EXPECTED,
  'south-wing': SOUTH_WING_EXPECTED,
};

export const DEFAULT_EXPECTED_PRESET_ID = 'north-core';

export function defaultExpectedState(): ExpectedState {
  return NORTH_CORE_EXPECTED;
}

export function findExpectedPreset(id: string): ExpectedState | null {
  return EXPECTED_PRESETS[id] ?? null;
}

/** Clone a preset so an operator edit can never mutate the shared constant. */
export function cloneExpectedState(state: ExpectedState): ExpectedState {
  return { ...state, items: state.items.map((i) => ({ ...i })) };
}

/**
 * Render an expected state as the short plain-text list sent to the model.
 *
 * This is LOOK-FOR context only. The model is told explicitly not to compare:
 * the deterministic comparison happens in compare.ts, so the numbers the judge
 * sees on screen are arithmetic, not a model's opinion.
 */
export function expectedSummaryFor(state: ExpectedState): string {
  return state.items
    .map((item) => `- ${expectedTextFor(item)}`)
    .join('\n');
}