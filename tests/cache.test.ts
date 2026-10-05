/**
 * The result cache.
 *
 * The cache exists so UI and comparison work is not blocked behind model
 * latency. The risk it creates is dishonesty: a cached answer presented as a
 * fresh one, or a failure stored and later served as a fast success. These
 * tests lock both hazards shut.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionCache, computeCacheKey, CACHE_SCHEMA_VERSION } from '../src/cache.ts';
import { RealityInspector } from '../src/inspector.ts';
import type { AIProvider, InspectRequest, RawProviderResult } from '../src/providers/provider.ts';
import type { RawModelObservation } from '../src/types/observation.ts';

const IMAGE = { bytes: Buffer.from('image-bytes'), mediaType: 'image/jpeg', captureId: 'cap_1' };

function providerReturning(observations: RawModelObservation[]): AIProvider & { calls: number } {
  const p = {
    name: 'test-provider',
    model: 'test-model-v1',
    calls: 0,
    async inspect(_r: InspectRequest): Promise<RawProviderResult> {
      p.calls += 1;
      return { provider: p.name, model: p.model, observations, elements: [], findings: [] };
    },
  };
  return p;
}

const VALID: RawModelObservation = {
  category: 'OBSERVED_ELEMENT',
  observation: 'A column is visible.',
  evidence: { description: 'Vertical member.' },
  confidence: 0.8,
  severity: 'INFO',
  suggested_action: 'NO_ACTION',
};

test('the cache key changes with image, model and expected state', () => {
  const base = { imageBytes: Buffer.from('a'), model: 'm1', expectedSummary: 's1' };
  const key = computeCacheKey(base);
  assert.equal(computeCacheKey({ ...base }), key, 'identical inputs must produce one key');
  assert.notEqual(computeCacheKey({ ...base, imageBytes: Buffer.from('b') }), key);
  assert.notEqual(computeCacheKey({ ...base, model: 'm2' }), key);
  assert.notEqual(computeCacheKey({ ...base, expectedSummary: 's2' }), key);
  assert.ok(key.startsWith(CACHE_SCHEMA_VERSION), 'the schema version is part of the key');
});

test('a miss returns null and is counted', () => {
  const cache = new InspectionCache();
  assert.equal(cache.lookup('nope'), null);
  assert.equal(cache.getStats().misses, 1);
});

test('a successful result is stored and served as CACHED', () => {
  const cache = new InspectionCache();
  cache.store('k', { observations: [VALID], elements: [], findings: [] },
    { model: 'm', latencyMs: 1234, acceptedEntries: 1 });
  const hit = cache.lookup('k');
  assert.ok(hit);
  assert.equal(hit.origin, 'CACHED');
  assert.equal(hit.originalLatencyMs, 1234);
  assert.ok(hit.originalInferenceAt, 'a cached result must carry when it was inferred');
});

test('a result with nothing accepted is NOT cached', () => {
  // This is the rule that stops a failure being served back forever as a fast
  // success. An empty or wholly-rejected answer has acceptedEntries === 0.
  const cache = new InspectionCache();
  const stored = cache.store('k', { observations: [], elements: [], findings: [] },
    { model: 'm', latencyMs: 5, acceptedEntries: 0 });
  assert.equal(stored, false);
  assert.equal(cache.lookup('k'), null);
  assert.equal(cache.getStats().failuresSkipped, 1);
});

test('the cache is bounded and evicts the oldest entry', () => {
  const cache = new InspectionCache(2);
  const meta = { model: 'm', latencyMs: 1, acceptedEntries: 1 };
  cache.store('a', { observations: [VALID], elements: [], findings: [] }, meta);
  cache.store('b', { observations: [VALID], elements: [], findings: [] }, meta);
test('the second identical inspection is served from cache without calling the model', async () => {
  const cache = new InspectionCache();
  const provider = providerReturning([VALID]);
  const inspector = new RealityInspector({ provider });
  const opts = {
    image: IMAGE, projectId: null, zoneId: null,
    expectedSummary: 'x', cache, useCache: true,
  };

  const first = await inspector.inspectCached(opts);
  assert.equal(first.inferenceOrigin, 'FRESH');
  assert.equal(provider.calls, 1);

  const second = await inspector.inspectCached(opts);
  assert.equal(second.inferenceOrigin, 'CACHED', 'the second run must be labelled CACHED');
  assert.equal(provider.calls, 1, 'the provider must NOT be called again');
  assert.equal(second.observations.length, first.observations.length);
  assert.ok(second.originalInferenceAt);
});

test('with useCache off, every run is a fresh inference', async () => {
  const provider = providerReturning([VALID]);
  const inspector = new RealityInspector({ provider });
  const opts = { image: IMAGE, expectedSummary: 'x', cache: new InspectionCache(), useCache: false };
  await inspector.inspectCached(opts);
  await inspector.inspectCached(opts);
  assert.equal(provider.calls, 2, 'caching must be a deliberate opt-in');
});

test('a failed inspection is not cached', async () => {
  const cache = new InspectionCache();
  const failing = {
    name: 'failing', model: 'm',
    async inspect(): Promise<RawProviderResult> {
      throw Object.assign(new Error('boom'), { name: 'ProviderError', kind: 'UNAVAILABLE' });
    },
  } as unknown as AIProvider;
  const inspector = new RealityInspector({ provider: failing });
  await assert.rejects(() =>
    inspector.inspectCached({ image: IMAGE, expectedSummary: 'x', cache, useCache: true }));
  assert.equal(cache.size, 0, 'a provider failure must leave no cache entry');
});

test('a cached observation is re-validated, not trusted blindly', async () => {
  // A cache entry holds raw provider output. It must go through the validator
  // on the way back out, exactly like a fresh answer.
  const cache = new InspectionCache();
  const provider = providerReturning([VALID]);
  const inspector = new RealityInspector({ provider });
  const opts = { image: IMAGE, expectedSummary: 'x', cache, useCache: true };
  await inspector.inspectCached(opts);

  // Poison the entry with an invalid observation. The cache is cleared first
  // because store() is first-write-wins for an existing key.
  const key = computeCacheKey({
    imageBytes: IMAGE.bytes, model: provider.model, expectedSummary: 'x',
  });
  cache.clear();
  cache.store(key, {
    observations: [{ category: 'NOT_A_CATEGORY', observation: '', evidence: {}, confidence: 5 }],
    elements: [], findings: [],
  }, { model: provider.model, latencyMs: 1, acceptedEntries: 1 });

  const poisoned = await inspector.inspectCached(opts);
  assert.equal(poisoned.inferenceOrigin, 'CACHED');
  assert.equal(poisoned.observations.length, 0, 'the invalid cached entry must be rejected');
  assert.equal(poisoned.rejected.length, 1, 'and reported as rejected');
});
  cache.store('c', { observations: [VALID], elements: [], findings: [] }, meta);
  assert.equal(cache.size, 2);
  assert.equal(cache.lookup('a'), null, 'the oldest entry must be evicted');
  assert.ok(cache.lookup('c'));
});