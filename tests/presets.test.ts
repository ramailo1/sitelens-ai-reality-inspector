/**
 * Reference (preset) management.
 *
 * The point of these tests is that a comparison can always be traced back to a
 * named reference, and that changing that reference never leaves old rows on
 * screen pretending the new one produced them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PresetStore, cleanItems, presetToState } from '../src/expected-state.ts';
import type { Preset } from '../src/expected-state.ts';

const VALID = [
  { element: 'COLUMN', expectation: 'COUNT', expectedCount: 12 },
  { element: 'SLAB', expectation: 'PRESENT', expectedCount: null },
];

test('the catalogue starts with the two built-in references', () => {
  const presets = new PresetStore();
  const ids = presets.list().map((p) => p.id);
  assert.deepEqual(ids, ['north-core', 'south-wing']);
  assert.equal(presets.list().every((p) => p.source === 'SYSTEM'), true);
  assert.equal(presets.defaultId(), 'north-core');
});

test('a built-in reference cannot be deleted', () => {
  const presets = new PresetStore();
  const removed = presets.delete('north-core');
  assert.equal(removed.ok, false);
  assert.equal(removed.ok === false ? removed.reason : '', 'SYSTEM_PRESET');
  assert.ok(presets.get('north-core'), 'the reference must survive the refusal');
});

test('a custom reference can be created, listed and selected', () => {
  const presets = new PresetStore();
  const created = presets.create({ name: 'Podium Deck', zone: 'Level 01', items: VALID });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.equal(created.value.source, 'OPERATOR');
  assert.equal(created.value.items.length, 2);
  assert.ok(presets.list().some((p) => p.id === created.value.id));
  assert.equal(presetToState(created.value).source, 'OPERATOR');
});

test('a custom reference can be deleted', () => {
  const presets = new PresetStore();
  const created = presets.create({ name: 'Temp', zone: 'Z', items: VALID });
  assert.ok(created.ok);
  assert.equal(presets.delete(created.value.id).ok, true);
  assert.equal(presets.get(created.value.id), null);
});

test('renaming a reference keeps its items and source', () => {
  const presets = new PresetStore();
  const renamed = presets.rename('south-wing', 'South Wing — Cladding');
  assert.equal(renamed.ok, true);
  assert.equal(presets.get('south-wing')?.name, 'South Wing — Cladding');
  assert.equal(presets.get('south-wing')?.items.length, 3);
  assert.equal(presets.get('south-wing')?.source, 'SYSTEM');
});

test('a reference can be renamed by an operator but not emptied of meaning', () => {
  const presets = new PresetStore();
  assert.equal(presets.rename('north-core', '   ').ok, false);
  assert.equal(presets.rename('does-not-exist', 'X').ok, false);
  assert.ok(presets.get('north-core'));
});

test('editing a reference replaces its expected elements', () => {
  const presets = new PresetStore();
  const edited = presets.replaceItems('south-wing', [{ element: 'WALL', expectation: 'ABSENT', expectedCount: null }]);
  assert.equal(edited.ok, true);
  assert.equal(presets.get('south-wing')?.items.length, 1);
  assert.equal(presets.get('south-wing')?.items[0]?.expectation, 'ABSENT');
});

test('expected elements are validated against the domain vocabulary', () => {
  assert.equal(cleanItems([]).ok, false);
  assert.equal(cleanItems('nope').ok, false);
  assert.equal(cleanItems([{ element: 'NOT_A_THING', expectation: 'PRESENT' }]).ok, false);
  assert.equal(cleanItems([{ element: 'WALL', expectation: 'MAYBE' }]).ok, false);
  assert.equal(cleanItems([{ element: 'WALL', expectation: 'COUNT', expectedCount: 'many' }]).ok, false);
  assert.equal(cleanItems([{ element: 'WALL', expectation: 'COUNT', expectedCount: -1 }]).ok, false);
  assert.equal(cleanItems(VALID).ok, true);
});

test('a COUNT element requires a count and others ignore one', () => {
  const counted = cleanItems([{ element: 'WALL', expectation: 'COUNT', expectedCount: null }]);
  assert.equal(counted.ok, false);

  const ignored = cleanItems([{ element: 'WALL', expectation: 'PRESENT', expectedCount: 99 }]);
  assert.ok(ignored.ok);
  assert.equal(ignored.ok ? ignored.value[0]?.expectedCount : null, null);
});

test('a reference cannot exceed the item ceiling', () => {
  const many = Array.from({ length: 21 }, () => ({ element: 'WALL', expectation: 'PRESENT' }));
  const result = cleanItems(many);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : '', 'TOO_MANY_ITEMS');
});

test('creating a reference requires a name, a zone and elements', () => {
  const presets = new PresetStore();
  assert.equal(presets.create({ name: '', zone: 'Z', items: VALID }).ok, false);
  assert.equal(presets.create({ name: 'N', zone: '  ', items: VALID }).ok, false);
  assert.equal(presets.create({ name: 'N', zone: 'Z', items: [] }).ok, false);
});

test('a stored reference is cloned so callers cannot mutate the catalogue', () => {
  const presets = new PresetStore();
  const first = presets.get('north-core') as Preset;
  (first.items[0] as { note: string }).note = 'MUTATED';
  const second = presets.get('north-core') as Preset;
  assert.notEqual(second.items[0]?.note, 'MUTATED');
});

test('projectToState maps a system reference to PRESET provenance', () => {
  const presets = new PresetStore();
  const preset = presets.get('north-core') as Preset;
  assert.equal(presetToState(preset).source, 'PRESET');
});