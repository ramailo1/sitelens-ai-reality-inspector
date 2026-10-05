/**
 * In-process cache of successful AI results, so iterating on the UI does not pay
 * full model latency every run.
 *
 * Three properties matter more than the speedup:
 *
 * 1. A cached result is never presented as a fresh inference. It carries
 *    `CACHED` plus the original inference time, and the UI renders a distinct
 *    badge.
 * 2. Only validated, non-empty results are stored, so a cache hit can never be
 *    a dressed-up error.
 * 3. The key is content-addressed over the image bytes, model, expected-state
 *    summary and schema version, so changing any of them is a different entry.
 *
 * Deliberately disposable: this is not a database and holds nothing of value.
 */

import { createHash } from 'node:crypto';

/** Bumped whenever the prompt or the accepted schema changes, so an old entry
 *  can never be served against a newer contract. */
export const CACHE_SCHEMA_VERSION = 'v1-inspection';

/** Where a set of detections came from. Always surfaced to the user. */
export type InferenceOrigin = 'FRESH' | 'CACHED' | 'DEMO_FIXTURE';

export interface CachedInspection {
  /** Exactly what the provider returned, unvalidated. */
  readonly observations: readonly unknown[];
  readonly elements: readonly unknown[];
  readonly findings: readonly unknown[];
}

export interface CacheHit {
  readonly origin: 'CACHED';
  readonly payload: CachedInspection;
  readonly cachedAt: string;
  readonly originalModel: string;
  readonly originalInferenceAt: string;
  readonly originalLatencyMs: number;
}

interface CacheEntry {
  readonly key: string;
  readonly model: string;
  readonly inferenceAt: string;
  readonly latencyMs: number;
  readonly payload: CachedInspection;
  /** Only entries with at least one accepted entry are ever written. */
  readonly acceptedEntries: number;
}

export function computeCacheKey(input: {
  readonly imageBytes: Buffer;
  readonly model: string;
  readonly expectedSummary: string;
}): string {
  const imageHash = createHash('sha256').update(input.imageBytes).digest('hex').slice(0, 32);
  const contextHash = createHash('sha256')
    .update([CACHE_SCHEMA_VERSION, input.model, input.expectedSummary].join('\n'))
    .digest('hex')
    .slice(0, 16);
  return `${CACHE_SCHEMA_VERSION}:${input.model}:${imageHash}:${contextHash}`;
}

/**
 * Process-local cache.
 *
 * Bounded so a long session cannot grow without limit; the oldest successful
 * entry is evicted first. Failure records are counted but never stored as data.
 */
export class InspectionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly order: string[] = [];
  private hits = 0;
  private misses = 0;
  private failuresSkipped = 0;

  private readonly limit: number;

  // Not a parameter property: Node's strip-only type stripping rejects that
  // syntax, so the field is assigned explicitly.
  public constructor(limit = 200) {
    this.limit = limit;
  }

  public get size(): number { return this.entries.size; }
  public getStats(): { size: number; hits: number; misses: number; failuresSkipped: number } {
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      failuresSkipped: this.failuresSkipped,
    };
  }

  public lookup(key: string): CacheHit | null {
    const entry = this.entries.get(key);
    if (entry === undefined) { this.misses += 1; return null; }
    this.hits += 1;
    return {
      origin: 'CACHED',
      payload: entry.payload,
      cachedAt: new Date().toISOString(),
      originalModel: entry.model,
      originalInferenceAt: entry.inferenceAt,
      originalLatencyMs: entry.latencyMs,
    };
  }

  /**
   * Store a SUCCESSFUL result.
   *
   * Refuses anything that is not a real, non-empty, validated observation. The
   * caller passes the accepted-entry count because "the provider answered" and
   * "the answer survived validation" are different statements.
   */
  public store(key: string, payload: CachedInspection, meta: {
    readonly model: string; readonly latencyMs: number; readonly acceptedEntries: number;
  }): boolean {
    if (meta.acceptedEntries <= 0) {
      // An empty or wholly-rejected response is not a usable result. Caching it
      // would let a failure look like a fast success forever after.
      this.failuresSkipped += 1;
      return false;
    }
    if (this.entries.has(key)) return true;
    if (this.order.length >= this.limit) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const entry: CacheEntry = {
      key, model: meta.model, payload,
      inferenceAt: new Date().toISOString(), latencyMs: meta.latencyMs,
      acceptedEntries: meta.acceptedEntries,
    };
    this.entries.set(key, entry);
    this.order.push(key);
    return true;
  }

  public clear(): void { this.entries.clear(); this.order.length = 0; }
}

/** Shared instance for the local server. */
export const inspectionCache = new InspectionCache();