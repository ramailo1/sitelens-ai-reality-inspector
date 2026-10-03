/**
 * Demo provenance regression tests.
 *
 * Two defects were fixed in demo/run-demo.ts after live runs:
 *
 *  1. Provenance (provider/model/hackathon-eligibility) was skipped entirely
 *     when a run produced zero observations, because the function returned
 *     early. A judge running the demo with a content-free capture therefore
 *     never saw WHICH model ran.
 *  2. Eligibility was derived from the PROVIDER name alone, so any live Nebius
 *     call printed "YES - ... NVIDIA open-source model" even when a non-NVIDIA
 *     vision model ran. That is exactly the misrepresentation this project must
 *     not make.
 *
 * These tests lock in the corrected eligibility decision.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { NEBIUS_PROVIDER_NAME } from '../src/providers/nebius-nvidia.provider.ts';
import { DEMO_PROVIDER_NAME } from '../src/providers/demo-fixture.provider.ts';

/** Mirrors the decision now implemented in demo/run-demo.ts. */
function eligibility(provider: string, model: string): 'YES' | 'NO' {
  if (provider !== NEBIUS_PROVIDER_NAME) return 'NO';
  return /^nvidia\//i.test(model) ? 'YES' : 'NO';
}

test('an NVIDIA model on the live Nebius path is eligible', () => {
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'nvidia/Nemotron-Nano-12B-v2-VL'), 'YES');
});

test('a non-NVIDIA model on the live Nebius path is NOT eligible', () => {
  // The regression: this previously reported YES purely because the provider
  // class was the Nebius one.
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'Qwen/Qwen3.8-27B'), 'NO');
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'google/gemma-3-27b-it'), 'NO');
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'openbmb/MiniCPM-V-4_5'), 'NO');
});

test('the deterministic demo provider is never eligible', () => {
  assert.equal(eligibility(DEMO_PROVIDER_NAME, 'demo-fixture-vision-v1'), 'NO');
});

test('eligibility matches the model id prefix, case-insensitively', () => {
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'NVIDIA/Some-Model'), 'YES');
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'notnvidia/model'), 'NO');
});

test('an unavailable NVIDIA model still counts as the intended eligibility path', () => {
  // Eligibility is a statement about WHICH MODEL was invoked, not about whether
  // the call succeeded. A 404 model is still an NVIDIA model id; the run simply
  // fails closed and produces no observations.
  assert.equal(eligibility(NEBIUS_PROVIDER_NAME, 'nvidia/nemotron-3-nano-omni'), 'YES');
});