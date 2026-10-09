/**
 * Combining several photographs into ONE inspection.
 *
 * A construction zone is not one photograph. A single frame routinely cannot
 * settle whether a column exists behind formwork, or whether MEP rough-in is in
 * place behind a wall, and the pipeline has always said so with UNDETERMINED
 * rather than guessing. Several frames narrow that gap, but only if they are
 * combined honestly.
 *
 * The rule this module exists to enforce: **images are not summed.**
 *
 * Six columns visible in photo 1 and the same six columns visible in photo 2 is
 * SIX columns, not twelve. Adding them would manufacture a deviation out of
 * camera placement and hand the operator a number no photograph ever showed.
 * So the reconciliation rules are:
 *
 *   PRESENT   satisfied when ANY image saw it. The union of what was visible is
 *             the honest reading of a zone, and every contributing image is
 *             listed as a source.
 *   ABSENT    violated when ANY image saw it. Seeing something that should not
 *             be there is positive evidence; it never averages away.
 *   COUNT     the one case where images can disagree honestly. When every image
 *             that gave a defensible count agrees, that count is used. When they
 *             disagree the photographs do not establish a single number, and the
 *             row is UNDETERMINED with the disagreement stated — never resolved
 *             by summing, averaging, or silently taking the highest.
 *
 * Every reconciliation keeps its sources, so the answer to "which photograph
 * supports this finding?" is always recoverable.
 */

import { createHash } from 'node:crypto';
import type { DetectedElement } from './types/inspection.ts';

/** One image's contribution to a comparison row. */
export interface ComparisonSource {
  readonly captureId: string;
  readonly captureLabel: string;
  /** True when this image reported the element present. */
  readonly detected: boolean;
  /** This image's count, when it gave a defensible one. */
  readonly count: number | null;
  readonly confidence: number | null;
}

/** Which photographs contributed to one consolidated inspection. */
export interface ImageProvenance {
  readonly captureId: string;
  readonly captureLabel: string;
  readonly source: string;
  readonly mediaType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly byteLength: number;
  /** FAILED when this image produced nothing usable; the others still count. */
  readonly status: 'ANALYSED' | 'FAILED';
  /** Why this image failed. Null unless status is FAILED. */
  readonly failure: string | null;
  /** Validated observations this image contributed to the combined set. */
  readonly observationCount: number;
}

/** Per-image visual readings, keyed by capture id. Order is preserved. */
export interface ImageDetections {
  readonly captureId: string;
  readonly captureLabel: string;
  readonly detections: readonly DetectedElement[];
}

/** What the reconciliation concluded about one element kind. */
export interface ReconciledReading {
  /** Any image saw it. */
  readonly present: boolean;
  /** The agreed count, or null when images disagreed or none was defensible. */
  readonly count: number | null;
  /** True when images that gave counts did not agree. */
  readonly disputed: boolean;
  /** Every image that reported anything for this kind, in input order. */
  readonly sources: readonly ComparisonSource[];
  /** The highest confidence among the contributing readings. */
  readonly confidence: number | null;
}

/**
 * Reconcile one element kind across every image.
 *
 * Pure and total: an empty image set yields "nothing seen", never a throw, so a
 * partially failed run still reconciles honestly from what did arrive.
 */
export function reconcileReading(
  element: string,
  images: readonly ImageDetections[],
): ReconciledReading {
  const sources: ComparisonSource[] = [];
  let present = false;
  const counts: number[] = [];
  let confidence: number | null = null;

  for (const image of images) {
    for (const detection of image.detections) {
      if (detection.element !== element) continue;
      if (detection.present) {
        present = true;
        if (detection.count !== null && detection.count !== undefined) {
          counts.push(detection.count);
        }
      }
      sources.push({
        captureId: image.captureId,
        captureLabel: image.captureLabel,
        detected: detection.present,
        count: detection.present ? (detection.count ?? null) : null,
        confidence: detection.confidence,
      });
      if (confidence === null || detection.confidence > confidence) {
        confidence = detection.confidence;
      }
    }
  }

  // Only defensible counts vote. An image that saw the element but refused to
  // count it neither agrees nor disagrees, so it is not evidence of a dispute.
  const disputed = counts.length > 1 && !counts.every((n) => n === (counts[0] as number));
  const agreed: number | null = counts.length > 0 && !disputed ? (counts[0] as number) : null;

  return { present, count: agreed, disputed, sources, confidence };
}

/**
 * The disagreement sentence for a disputed COUNT.
 *
 * States the readings and the photographs that produced them, because "the
 * photographs disagree" without the numbers is not actionable and the operator
 * has to know which frame to re-shoot.
 */
export function describeDisagreement(
  reading: ReconciledReading,
  images: readonly ImageDetections[],
): string {
  const parts: string[] = [];
  for (const image of images) {
    for (const detection of image.detections) {
      if (!detection.present || detection.count === null) continue;
      const match = reading.sources.find((s) => s.captureId === image.captureId);
      if (match === undefined || match.captureId === undefined) continue;
      parts.push(`${detection.count} in ${image.captureLabel}`);
    }
  }
  if (parts.length === 0) return 'the photographs do not establish a single count';
  return `photographs disagree on the count (${parts.join('; ')}); not summed`;
}

/**
 * Duplicate images.
 *
 * Byte-identical images are the same photograph twice, whatever they are named,
 * so the SECOND occurrence is refused: inspecting the same frame twice would
 * report two pieces of evidence where there is one. A genuine re-shoot of the
 * same view is different bytes and is accepted.
 *
 * Returns which ids were refused alongside the accepted set, so the caller can
 * tell the operator WHICH photograph was dropped. Silently inspecting fewer
 * images than were chosen is exactly the failure this product exists to prevent.
 */
export function partitionDuplicates<T extends { readonly id: string; readonly bytes: Buffer }>(
  captures: readonly T[],
): { readonly accepted: readonly T[]; readonly refused: readonly string[] } {
  const accepted: T[] = [];
  const refused: string[] = [];
  const seen = new Map<string, string>();
  for (const capture of captures) {
    // The bytes themselves, not a filename: the same photograph renamed is still
    // the same photograph.
    const hash = hashBytes(capture.bytes);
    const first = seen.get(hash);
    if (first === undefined) {
      seen.set(hash, capture.id);
      // The ORIGINAL object, never a `{id, bytes}` wrapper. Rebuilding one here
      // silently dropped `label`, `mediaType` and `projectId` downstream, which
      // is invisible until provenance renders blank.
      accepted.push(capture);
    } else {
      refused.push(capture.id);
    }
  }
  return { accepted, refused };
}

/** SHA-256 of the image bytes, truncated. Used only for identity. */
function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}