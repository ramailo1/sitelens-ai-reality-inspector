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
  options: CompareOptions = {},
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
    difference,
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