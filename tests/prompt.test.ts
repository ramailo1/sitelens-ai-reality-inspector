/**
 * Prompt-contract regression tests.
 *
 * These lock in a defect found during a LIVE Nebius run: the inspection prompt
 * presented enum choices as a pipe-separated list inside the JSON template
 * (e.g. "category": "OBSERVED_ELEMENT | PROGRESS_OBSERVATION"). Models copy
 * such placeholders verbatim, so every observation came back with a combined
 * category and strict validation correctly rejected all of them.
 *
 * The fix is in the PROMPT (a single legal value per field, with the legal set
 * stated in prose). Validation is deliberately unchanged and still strict.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInspectionPrompt } from '../src/providers/nebius-nvidia.provider.ts';
import {
  validateModelObservation,
  OBSERVATION_CATEGORIES,
  OBSERVATION_SEVERITIES,
  SUGGESTED_ACTIONS,
} from '../src/types/observation.ts';

test('prompt never puts a pipe-separated choice list in a JSON value', () => {
  const prompt = buildInspectionPrompt();

  // Any quoted JSON value must not itself be a choice list.
  for (const match of prompt.matchAll(/"[a-z_]+":\s*"([^"]*)"/g)) {
    const value = match[1] ?? '';
    assert.ok(
      !value.includes('|'),
      `"${match[0]}" exposes a pipe-separated choice list the model can echo verbatim`,
    );
  }
});

test('prompt template fields each carry exactly one legal enum value', () => {
  const prompt = buildInspectionPrompt();

  const categoryMatch = prompt.match(/"category":\s*"([^"]+)"/);
  assert.ok(categoryMatch, 'prompt must show a category example');
  assert.ok(
    (OBSERVATION_CATEGORIES as readonly string[]).includes(categoryMatch[1] as string),
    'the category example must itself be a legal category',
  );

  const severityMatch = prompt.match(/"severity":\s*"([^"]+)"/);
  assert.ok(severityMatch);
  assert.ok((OBSERVATION_SEVERITIES as readonly string[]).includes(severityMatch[1] as string));

  const actionMatch = prompt.match(/"suggested_action":\s*"([^"]+)"/);
  assert.ok(actionMatch);
  assert.ok((SUGGESTED_ACTIONS as readonly string[]).includes(actionMatch[1] as string));
});

test('prompt still states the full legal set for every enum field', () => {
  const prompt = buildInspectionPrompt();
  for (const category of OBSERVATION_CATEGORIES) {
    assert.ok(prompt.includes(category), `prompt must name the legal category ${category}`);
  }
  for (const action of SUGGESTED_ACTIONS) {
    assert.ok(prompt.includes(action), `prompt must name the legal action ${action}`);
  }
  for (const severity of OBSERVATION_SEVERITIES) {
    assert.ok(prompt.includes(severity), `prompt must name the legal severity ${severity}`);
  }
});

test('prompt requires exactly one category and forbids combined values', () => {
  const prompt = buildInspectionPrompt();
  assert.match(prompt, /EXACTLY ONE category/i);
});

test('the live defect shape is still rejected by strict validation', () => {
  // Guards the boundary this fix relies on: a verbatim echo of the OLD
  // prompt must STILL be rejected. The prompt was fixed, not the validator.
  const echoed = validateModelObservation({
    category: 'OBSERVED_ELEMENT | PROGRESS_OBSERVATION',
    observation: 'A yellow machine is visible in the foreground.',
    evidence: { description: 'The image contains a large yellow shape.' },
    confidence: 0.95,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
  });
  assert.equal(echoed.ok, false, 'combined categories must never be accepted');

  // And the corrected single-value shape must validate.
  const fixed = validateModelObservation({
    category: 'OBSERVED_ELEMENT',
    observation: 'A yellow machine is visible in the foreground.',
    evidence: { description: 'The image contains a large yellow shape.' },
    confidence: 0.95,
    severity: 'INFO',
    suggested_action: 'NO_ACTION',
  });
  assert.equal(fixed.ok, true);
});

test('prompt still forbids autonomous compliance and safety conclusions', () => {
  const prompt = buildInspectionPrompt();
  assert.match(prompt, /Do NOT declare compliance, structural safety/i);
  assert.match(prompt, /Do NOT assert measurements/i);
  assert.match(prompt, /Do NOT identify or describe individual people/i);
});

test('prompt still requires strict JSON and permits an empty result', () => {
  const prompt = buildInspectionPrompt();
  assert.match(prompt, /STRICT JSON only/);
  assert.match(prompt, /empty observations array/);
});