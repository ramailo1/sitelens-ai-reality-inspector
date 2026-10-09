/**
 * Reality vs expectation.
 *
 * Given what was detected and what was expected, computes MATCH / ATTENTION /
 * UNDETERMINED with plain, auditable rules.
 *
 * The comparison is not in the prompt because a model asked to "compare expected
 * 12 columns against the image" will agree with whatever it imagined. Here the
 * arithmetic is ours, the evidence is the model's, and the verdict is still the
 * human's.
 *
 *   COUNT     equal is MATCH, different is ATTENTION, and no defensible count is
 *             UNDETERMINED rather than a fabricated shortfall.
 *   PRESENT   detected present is MATCH, explicitly absent is ATTENTION, nothing
 *             detected at all is UNDETERMINED.
 *   ABSENT    detected is ATTENTION, nothing detected is MATCH.
 */

import type {
  ComparisonRow,
  ComparisonStatus,
  DetectedElement,
  ExpectedItem,
  ExpectedState,
} from './types/inspection.ts';
import { elementLabel } from './types/inspection.ts';
import type { ComparisonSource } from './multi-image.ts';
import { describeDisagreement, reconcileReading } from './multi-image.ts';
import type { ImageDetections } from './multi-image.ts';

export interface CompareOptions {
  /** Overridable for tests; defaults to a deterministic id per expected item. */
  readonly idFactory?: (item: ExpectedItem) => string;
}

/** Render an expected item as the sentence a site professional would use. */
export function expectedTextFor(item: ExpectedItem): string {
  const label = elementLabel(item.element);
  const note = item.note.trim();
  switch (item.expectation) {
    case 'COUNT':
      return `${item.expectedCount} ${label}${item.expectedCount === 1 ? '' : 's'} expected` +
        (note.length > 0 ? ` (${note})` : '');
    case 'ABSENT':
      return `no ${label} expected` + (note.length > 0 ? ` (${note})` : '');
    default:
      return `${label} expected` + (note.length > 0 ? ` (${note})` : '');
  }
}

/** Human phrase for a count we cannot defend from this capture. */
export const NOT_DETERMINABLE_TEXT = 'not determinable from this capture';

function observedTextFor(item: ExpectedItem, detection: DetectedElement | null): string {
  if (detection === null) {
    // For an ABSENT expectation the honest reading is "none was seen", which is
    // the answer that satisfies it. Saying "not determinable" next to a MATCH
    // would be self-contradictory.
    return item.expectation === 'ABSENT' ? 'none seen in this capture' : NOT_DETERMINABLE_TEXT;
  }
  const label = elementLabel(item.element);
  if (!detection.present) return `no ${label} detected`;
  if (detection.count !== null) {
    return `${detection.count} ${label}${detection.count === 1 ? '' : 's'} counted`;
  }
  return `${label} detected`;
}

/**
 * The multi-image extension of CompareOptions.
 *
 * `sources` carries the per-image readings already reconciled into this row. When
 * present, `multi-image.ts` has decided `detection`, `detectionReported` and
 * the status inputs, and this module's job is only to record who contributed.
 * When absent, the single-image path runs completely unchanged.
 */
export interface MultiImageCompareOptions extends CompareOptions {
  readonly sources?: readonly ComparisonSource[];
  readonly countDisputed?: boolean;
}

/**
 * Compare ONE expected item against ONE detected element.
 *
 * `detection` is the element the model reported for the same kind, or null when
 * the model reported nothing for it at all. Null and "reported absent" are
 * deliberately different: one means "I cannot tell", the other means "I looked
 * and it is not there".
 */
export function compareItem(
  item: ExpectedItem,
  detection: DetectedElement | null,
  options: MultiImageCompareOptions = {},
): ComparisonRow {
  // Deterministic id derived from the expected item, NOT a random uuid. A row
  // that changed identity on every re-render would orphan any human review
  // recorded against it, and finding ids are derived from this one.
  const idFactory = options.idFactory ?? ((row: ExpectedItem): string => `cmp_${row.id}`);
  const expectedText = expectedTextFor(item);
  const observedText = observedTextFor(item, detection);
  const observedCount = detection !== null && detection.present ? detection.count : null;
  const confidence = detection !== null ? detection.confidence : null;
  const boundingBox = detection !== null ? detection.boundingBox : null;
  // Reported = the model said anything about this kind, including "it is not
  // there". Null means the model said nothing, which is an evidence statement
  // of its own: there is no visual reading to point at, full-frame or otherwise.
  const detectionReported = detection !== null;

  let status: ComparisonStatus;
  let difference = '';

  switch (item.expectation) {
    case 'COUNT': {
      const expectedCount = item.expectedCount ?? 0;
      if (detection === null || !detection.present) {
        // The model either saw nothing, or reported the element absent. We
        // cannot turn that into "you are N columns short" - the columns may
        // simply be outside the frame.
        status = 'UNDETERMINED';
      } else if (detection.count === null) {
        // The element is visible but the model refused to count it. Reporting a
        // shortfall here would invent exactly the number we just refused.
        status = 'UNDETERMINED';
      } else if (detection.count === expectedCount) {
        status = 'MATCH';
      } else {
        status = 'ATTENTION';
        const delta = detection.count - expectedCount;
        const label = elementLabel(item.element);
        const plural = (n: number): string => (n === 1 ? label : `${label}s`);
        difference =
          delta < 0
            ? `${Math.abs(delta)} fewer ${plural(Math.abs(delta))} counted than expected ` +
              `(visual count ${detection.count}, expected ${expectedCount})`
            : `${delta} more ${plural(delta)} counted than expected ` +
              `(visual count ${detection.count}, expected ${expectedCount})`;
      }
      break;
    }
    case 'ABSENT': {
      if (detection !== null && detection.present) {
        status = 'ATTENTION';
        difference = `${elementLabel(item.element)} is visible but was not expected in this zone`;
      } else {
        status = 'MATCH';
      }
      break;
    }
    default: {
      if (detection !== null && detection.present) {
        status = 'MATCH';
      } else if (detection !== null) {
        status = 'ATTENTION';
        difference = `${elementLabel(item.element)} expected but not detected in this capture`;
      } else {
        status = 'UNDETERMINED';
      }
      break;
    }
  }

  return {
    id: idFactory(item),
    expectedId: item.id,
    element: item.element,
    expectation: item.expectation,
    expectedText,
    observedText,
    status,
    // A count only exists if the model actually produced one.
    countBasis: observedCount === null ? 'NOT_DETERMINABLE' : detection!.countBasis,
    expectedCount: item.expectedCount,
    observedCount,
    confidence,
    boundingBox,
    detectionReported,
    difference,
    // Empty on the single-image path: one image attributes itself through
    // `captureId` and needs no list.
    sourceCaptureIds: options.sources === undefined
      ? []
      : options.sources.map((s) => s.captureId),
    countDisputed: options.countDisputed === true,
  };
}

/**
 * Compare a whole expected state against a whole detection set.
 *
 * Detections are indexed by element kind; when a model reports the same kind
 * twice the most confident reading wins, so the comparison stays deterministic
 * rather than order-dependent.
 */
export function compareExpectedState(
  expected: ExpectedState,
  detections: readonly DetectedElement[],
  options: CompareOptions = {},
): ComparisonRow[] {
  const best = new Map<string, DetectedElement>();
  for (const detection of detections) {
    const current = best.get(detection.element);
    if (current === undefined || detection.confidence > current.confidence) {
      best.set(detection.element, detection);
    }
  }

  return expected.items.map((item) => compareItem(item, best.get(item.element) ?? null, options));
}

/**
 * Compare an expected state against SEVERAL photographs at once.
 *
 * This is the consolidated path. It reconciles each element kind across all
 * images first (see multi-image.ts for why images are never summed), then runs
 * the SAME comparison rules per row. So a consolidated inspection and a
 * single-image inspection reach their verdicts by identical arithmetic.
 *
 * `images` must carry the per-image readings produced by the real vision calls.
 * With one image this produces the same rows as `compareExpectedState`.
 */
export function compareAcrossImages(
  expected: ExpectedState,
  images: readonly ImageDetections[],
  options: CompareOptions = {},
): ComparisonRow[] {
  const reconciled = new Map<string, ReturnType<typeof reconcileReading>>();
  for (const item of expected.items) {
    reconciled.set(item.element, reconcileReading(item.element, images));
  }

  return expected.items.map((item) => {
    const reading = reconciled.get(item.element)!;

    if (item.expectation === 'COUNT' && reading.disputed) {
      // Photographs genuinely disagree, so neither does the group.
      // compareItem(null) already yields UNDETERMINED with an honest
      // "not determinable" observation; the difference is then replaced with the
      // actual readings, so the operator sees WHICH photographs disagree rather
      // than a bare unknown.
      const row = compareItem(item, null, {
        ...options,
        sources: reading.sources,
        countDisputed: true,
      });
      return {
        ...row,
        difference: describeDisagreement(reading, images),
        // The highest-confidence sighting is still real evidence for presence,
        // so its box is kept for the overlay even though the count is disputed.
        confidence: reading.confidence,
      };
    }

    // Not disputed: reconcile to the single best reading so the existing rules
    // apply unchanged. A disputed reading above bypasses those rules on purpose,
    // because applying a COUNT rule to a number nobody photographed is the exact
    // fabrication this product refuses.
    const best = pickRepresentative(item.element, images, reading);
    const row = compareItem(item, best, {
      ...options,
      sources: reading.sources,
      countDisputed: false,
    });
    return row;
  });
}

/**
 * The detection the single-image rules should evaluate.
 *
 * When every image that counted agreed, that agreed count is represented by the
 * highest-confidence image that reported it, so `compareItem`'s COUNT arithmetic
 * produces the right verdict. When nothing was counted, the highest-confidence
 * sighting stands and the count stays null, which the COUNT rules already treat
 * as UNDETERMINED.
 */
function pickRepresentative(
  element: string,
  images: readonly ImageDetections[],
  reading: ReturnType<typeof reconcileReading>,
): DetectedElement | null {
  let best: DetectedElement | null = null;
  for (const image of images) {
    for (const detection of image.detections) {
      if (detection.element !== element) continue;
      if (reading.count !== null && detection.count !== reading.count) continue;
      if (best === null || detection.confidence > best.confidence) best = detection;
    }
  }
  if (best !== null) return best;
  // No detection at all, but images reported an explicit absence.
  for (const image of images) {
    for (const detection of image.detections) {
      if (detection.element !== element) continue;
      if (best === null || detection.confidence > best.confidence) best = detection;
    }
  }
  return best;
}

/** Roll comparison rows up into the counters the right-hand panel shows. */
export interface ComparisonSummary {
  readonly total: number;
  readonly matched: number;
  readonly attention: number;
  readonly undetermined: number;
}

export function summarizeComparison(rows: readonly ComparisonRow[]): ComparisonSummary {
  return {
    total: rows.length,
    matched: rows.filter((r) => r.status === 'MATCH').length,
    attention: rows.filter((r) => r.status === 'ATTENTION').length,
    undetermined: rows.filter((r) => r.status === 'UNDETERMINED').length,
  };
}