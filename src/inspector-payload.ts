/**
 * Re-serialising validated product data back to the raw provider shape.
 *
 * The cache and the persistence layer both store what the PROVIDER returned, not
 * the product's view of it. That is what makes re-validating on read meaningful:
 * a stored entry is untrusted input, exactly like a fresh model response, and a
 * cache hit or a restored inspection passes back through the same validators
 * rather than being trusted.
 *
 * Kept in its own module because both the inspector's cache path and the session's
 * persistence path need the identical mapping; two copies would eventually
 * disagree about what a stored entry means.
 */

import type { AIObservation } from './types/observation.ts';
import type { InspectionFinding } from './types/inspection.ts';

/** A validated observation, flattened back to the raw provider field names. */
export function toCacheableObservation(o: AIObservation): Record<string, unknown> {
  return {
    category: o.category,
    observation: o.observation,
    evidence: { description: o.evidence.description },
    confidence: o.confidence,
    severity: o.severity,
    suggested_action: o.suggestedAction,
    ...(o.evidence.boundingBox === null ? {} : { bounding_box: o.evidence.boundingBox }),
  };
}

/** A validated finding, flattened back to the raw provider field names. */
export function toCacheableFinding(f: InspectionFinding): Record<string, unknown> {
  return {
    title: f.title,
    category: f.category,
    severity: f.severity,
    observation: f.observation,
    reason: f.reason,
    evidence: f.evidence,
    confidence: f.confidence,
    recommendation: f.recommendation,
    ...(f.element === null ? {} : { element: f.element }),
    ...(f.location === null ? {} : { location: f.location }),
    ...(f.expected === null ? {} : { expected: f.expected }),
    ...(f.difference === null ? {} : { difference: f.difference }),
    ...(f.boundingBox === null ? {} : { bounding_box: f.boundingBox }),
  };
}
