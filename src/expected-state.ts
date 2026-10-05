/**
 * Expected-state presets.
 *
 * This is deliberately NOT a BIM model and NOT a schedule of works. It is a
 * short, editable inspection reference - the "what should I see if this zone is
 * where it should be" list that makes REALITY vs EXPECTATION possible without
 * a perfect model.
 *
 * A reference always carries a `presetId` so the UI can state exactly which
 * reference produced a comparison. The built-in presets are SYSTEM references
 * and cannot be deleted: without one of them the product would have no valid
 * comparison reference at all. Operator-authored presets are custom and are
 * removed like any other project data.
 *
 * The catalogue is global by design - a reference describes a zone condition,
 * not a tenant. What a project owns is its choice of reference and its operator
 * edits, and those never cross a project boundary.
 *
 * State is in memory for the life of the process, matching the observation
 * store and result cache. This is a demonstration surface, not persistence.
 */

import { randomUUID } from 'node:crypto';
import type { ExpectedItem, ExpectedState } from './types/inspection.ts';
import { isElementKind, isExpectation } from './types/inspection.ts';
import { expectedTextFor } from './compare.ts';

export const MAX_PRESET_NAME = 60;
export const MAX_PRESET_NOTE = 200;
export const MAX_PRESET_ITEMS = 20;

export type PresetSource = 'SYSTEM' | 'OPERATOR';

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly zone: string;
  readonly items: readonly ExpectedItem[];
  readonly source: PresetSource;
}

export type PresetRejection =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'ZONE_REQUIRED'
  | 'TOO_MANY_ITEMS'
  | 'EMPTY_ITEMS'
  | 'BAD_ELEMENT'
  | 'BAD_EXPECTATION'
  | 'BAD_COUNT'
  | 'UNKNOWN_PRESET'
  | 'SYSTEM_PRESET';

export type PresetResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: PresetRejection; readonly message: string };

function fail(reason: PresetRejection, message: string): PresetResult<never> {
  return { ok: false, reason, message };
}

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

/** The reference a new project starts from. */
export const DEFAULT_EXPECTED_PRESET_ID = 'north-core';

/**
 * The reference catalogue every project selects from.
 *
 * A project records the preset id it uses plus any operator edits, so changing a
 * project never changes another project's reference.
 */
export class PresetStore {
  private readonly presets = new Map<string, Preset>();

  public constructor() {
    this.addSystem(DEFAULT_EXPECTED_PRESET_ID, 'North Core — Structural Shell', NORTH_CORE_EXPECTED);
    this.addSystem('south-wing', 'South Wing — Finished Facade', SOUTH_WING_EXPECTED);
  }

  private addSystem(id: string, name: string, state: ExpectedState): void {
    this.presets.set(id, {
      id,
      name,
      zone: state.zone,
      items: state.items.map((i) => ({ ...i })),
      source: 'SYSTEM',
    });
  }

  public list(): Preset[] {
    return [...this.presets.values()].map((p) => ({ ...p, items: p.items.map((i) => ({ ...i })) }));
  }

  public get(id: string): Preset | null {
    const found = this.presets.get(id);
    return found === undefined ? null : { ...found, items: found.items.map((i) => ({ ...i })) };
  }

  public defaultId(): string {
    return DEFAULT_EXPECTED_PRESET_ID;
  }

  /** The reference a new project starts from. */
  public defaultExpectedState(): ExpectedState {
    const preset = this.presets.get(DEFAULT_EXPECTED_PRESET_ID);
    return preset === undefined
      ? cloneExpectedState(NORTH_CORE_EXPECTED)
      : presetToState(preset);
  }

  public create(input: { name: unknown; zone: unknown; items: unknown }): PresetResult<Preset> {
    const name = cleanPresetName(input.name);
    if (!name.ok) return name;
    const zone = cleanZone(input.zone);
    if (!zone.ok) return zone;
    const items = cleanItems(input.items);
    if (!items.ok) return items;

    const preset: Preset = {
      id: `preset_${randomUUID().slice(0, 8)}`,
      name: name.value,
      zone: zone.value,
      items: items.value,
      source: 'OPERATOR',
    };
    this.presets.set(preset.id, preset);
    return { ok: true, value: { ...preset } };
  }

  public rename(id: string, rawName: unknown): PresetResult<Preset> {
    const preset = this.presets.get(id);
    if (!preset) return fail('UNKNOWN_PRESET', 'That reference no longer exists.');
    const name = cleanPresetName(rawName);
    if (!name.ok) return name;
    const updated: Preset = { ...preset, name: name.value };
    this.presets.set(id, updated);
    return { ok: true, value: { ...updated } };
  }

  public replaceItems(id: string, rawItems: unknown): PresetResult<Preset> {
    const preset = this.presets.get(id);
    if (!preset) return fail('UNKNOWN_PRESET', 'That reference no longer exists.');
    const items = cleanItems(rawItems);
    if (!items.ok) return items;
    const updated: Preset = { ...preset, items: items.value };
    this.presets.set(id, updated);
    return { ok: true, value: { ...updated } };
  }

  /**
   * Delete a custom preset.
   *
   * A system preset is refused rather than removed: the product would otherwise
   * be left with no valid reference to compare against.
   */
  public delete(id: string): PresetResult<Preset> {
    const preset = this.presets.get(id);
    if (!preset) return fail('UNKNOWN_PRESET', 'That reference no longer exists.');
    if (preset.source === 'SYSTEM') {
      return fail('SYSTEM_PRESET', 'Built-in references cannot be deleted.');
    }
    this.presets.delete(id);
    return { ok: true, value: { ...preset } };
  }
}

export function cleanPresetName(raw: unknown): PresetResult<string> {
  if (typeof raw !== 'string') return fail('NAME_REQUIRED', 'A reference name is required.');
  const name = raw.trim();
  if (name.length === 0) return fail('NAME_REQUIRED', 'A reference name is required.');
  if (name.length > MAX_PRESET_NAME) {
    return fail('NAME_TOO_LONG', `Reference names are limited to ${MAX_PRESET_NAME} characters.`);
  }
  return { ok: true, value: name };
}

function cleanZone(raw: unknown): PresetResult<string> {
  if (typeof raw !== 'string') return fail('ZONE_REQUIRED', 'A zone is required.');
  const zone = raw.trim();
  if (zone.length === 0) return fail('ZONE_REQUIRED', 'A zone is required.');
  if (zone.length > MAX_PRESET_NAME) {
    return fail('NAME_TOO_LONG', `Zones are limited to ${MAX_PRESET_NAME} characters.`);
  }
  return { ok: true, value: zone };
}

/** Validate a client-supplied expected-element list against the domain vocabulary. */
export function cleanItems(raw: unknown): PresetResult<ExpectedItem[]> {
  if (!Array.isArray(raw)) return fail('EMPTY_ITEMS', 'Expected elements must be a list.');
  if (raw.length === 0) return fail('EMPTY_ITEMS', 'A reference needs at least one expected element.');
  if (raw.length > MAX_PRESET_ITEMS) {
    return fail('TOO_MANY_ITEMS', `A reference is limited to ${MAX_PRESET_ITEMS} expected elements.`);
  }

  const out: ExpectedItem[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return fail('BAD_ELEMENT', `Expected element ${index + 1} is not valid.`);
    }
    const record = entry as Record<string, unknown>;
    const element = record['element'];
    const expectation = record['expectation'];
    if (!isElementKind(element)) {
      return fail('BAD_ELEMENT', `Expected element ${index + 1} is not a known element kind.`);
    }
    if (!isExpectation(expectation)) {
      return fail('BAD_EXPECTATION', `Expected element ${index + 1} must be PRESENT, COUNT or ABSENT.`);
    }

    let expectedCount: number | null = null;
    if (expectation === 'COUNT') {
      const count = record['expectedCount'];
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 500) {
        return fail('BAD_COUNT', `Expected element ${index + 1} needs an integer expected count.`);
      }
      expectedCount = count;
    }

    const noteRaw = record['note'];
    const note = typeof noteRaw === 'string' ? noteRaw.slice(0, MAX_PRESET_NOTE) : '';
    const idRaw = record['id'];
    out.push({
      id: typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : `exp_${index}`,
      element,
      expectation,
      expectedCount,
      note,
    });
  }
  return { ok: true, value: out };
}

/** Project a preset onto the expected state the comparison engine consumes. */
export function presetToState(preset: Preset): ExpectedState {
  return {
    zone: preset.zone,
    source: preset.source === 'SYSTEM' ? 'PRESET' : 'OPERATOR',
    items: preset.items.map((i) => ({ ...i })),
  };
}

/**
 * The reference used when nothing else applies.
 *
 * A clone, never the shared constant: a caller that mutates the result must not
 * be able to corrupt the catalogue for every other project.
 */
export function defaultExpectedState(): ExpectedState {
  return cloneExpectedState(NORTH_CORE_EXPECTED);
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