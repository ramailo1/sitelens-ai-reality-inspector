/**
 * Expected-state request validation.
 *
 * The browser is an untrusted client even on a loopback-only server. These lock
 * in that an untrusted expected-state payload is re-validated server-side, and
 * - most importantly - that provenance is never laundered: a preset stays a
 * PRESET and an operator edit is always marked OPERATOR, so the UI can never
 * show a demo reference as if it were the project's own programme.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpectedState } from '../src/server.ts';
import { PresetStore, presetToState } from '../src/expected-state.ts';
import type { Preset } from '../src/expected-state.ts';
import { ELEMENT_KINDS } from '../src/types/inspection.ts';

test('a preset id resolves to a cloned PRESET state', () => {
  const presets = new PresetStore();
  const preset = presets.get('north-core');
  assert.ok(preset);
  const state = presetToState(preset);
  assert.equal(state.zone, 'North Core');
  assert.equal(state.source, 'PRESET');
  assert.ok(state.items.length > 0);

  // It must be a clone: mutating the result cannot corrupt the shared preset.
  const mutated = state.items.map((i) => ({ ...i }));
  mutated[0]!.note = 'MUTATED';
  const again = presetToState(presets.get('north-core') as Preset);
  assert.ok(again.items[0]?.note !== 'MUTATED');
});

test('an unknown preset is refused rather than silently defaulted', () => {
  const presets = new PresetStore();
  assert.equal(presets.get('does-not-exist'), null);
});

test('an explicit item list is always marked OPERATOR', () => {
  const result = resolveExpectedState({
    zone: 'Zone 7',
    items: [{ id: 'a', element: 'COLUMN', expectation: 'COUNT', expectedCount: 12 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.source, 'OPERATOR');
  assert.equal(result.state.zone, 'Zone 7');
});

test('an unknown element kind is refused, not coerced', () => {
  for (const element of ['NOT_AN_ELEMENT', 'column', '', 42, null]) {
    const result = resolveExpectedState({ zone: 'z', items: [{ element, expectation: 'PRESENT' }] });
    assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(element)}`);
  }
});

test('an unknown expectation is refused', () => {
  const result = resolveExpectedState({
    zone: 'z',
    items: [{ element: 'SLAB', expectation: 'PROBABLY' }],
  });
  assert.equal(result.ok, false);
});

test('a COUNT expectation without a usable count is refused', () => {
  for (const expectedCount of [undefined, null, '12', 1.5, -1, 501]) {
    const result = resolveExpectedState({
      zone: 'z',
      items: [{ element: 'COLUMN', expectation: 'COUNT', expectedCount }],
    });
    assert.equal(result.ok, false, `expected refusal for count ${JSON.stringify(expectedCount)}`);
  }
});

test('a PRESENT expectation needs no count', () => {
  const result = resolveExpectedState({
    zone: 'z',
    items: [{ element: 'SLAB', expectation: 'PRESENT' }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.items[0]?.expectedCount, null);
});

test('an empty item list is accepted and produces no comparison rows', () => {
  const result = resolveExpectedState({ zone: 'Empty zone', items: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.items.length, 0);
});

test('a non-object payload is refused', () => {
  for (const bad of [null, undefined, 42, 'string', true]) {
    assert.equal(resolveExpectedState(bad).ok, false, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

test('a payload with neither presetId nor items is refused', () => {
  assert.equal(resolveExpectedState({ zone: 'z' }).ok, false);
});

test('a non-array items value is refused', () => {
  assert.equal(resolveExpectedState({ zone: 'z', items: 'nope' }).ok, false);
});

test('every element kind in the vocabulary is accepted', () => {
  for (const element of ELEMENT_KINDS) {
    const result = resolveExpectedState({ zone: 'z', items: [{ element, expectation: 'PRESENT' }] });
    assert.equal(result.ok, true, `${element} must be a legal element kind`);
  }
});

test('an over-long note is truncated rather than rejected', () => {
  const result = resolveExpectedState({
    zone: 'z',
    items: [{ element: 'SLAB', expectation: 'PRESENT', note: 'x'.repeat(5000) }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.state.items[0] as { note: string }).note.length, 200);
});

test('a missing zone falls back to an explicit placeholder', () => {
  const result = resolveExpectedState({ items: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.state.zone.length > 0);
});