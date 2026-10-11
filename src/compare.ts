// Reality vs expectation.

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
  // Overridable for tests; defaults to a deterministic id per expected item.
  readonly idFactory?: (item: ExpectedItem) => string;
}

// Render an expected item as the sentence a site professional would use.
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

// Human phrase for a count we cannot defend from this capture.
export const NOT_DETERMINABLE_TEXT = 'not determinable from this capture';

function observedTextFor(item: ExpectedItem, detection: DetectedElement | null): string {
  if (detection === null) {
    // For an ABSENT expectation the honest reading is "none was seen", which is the answer that satisfies it.
    return item.expectation === 'ABSENT' ? 'none seen in this capture' : NOT_DETERMINABLE_TEXT;
  }
  const label = elementLabel(item.element);
  if (!detection.present) return `no ${label} detected`;
  if (detection.count !== null) {
    return `${detection.count} ${label}${detection.count === 1 ? '' : 's'} counted`;
  }
  return `${label} detected`;
}

// The multi-image extension of CompareOptions.
export interface MultiImageCompareOptions extends CompareOptions {
  readonly sources?: readonly ComparisonSource[];
  readonly countDisputed?: boolean;
}

// Compare ONE expected item against ONE detected element.
export function compareItem(
  item: ExpectedItem,
  detection: DetectedElement | null,
  options: MultiImageCompareOptions = {},
): ComparisonRow {
  // Deterministic id derived from the expected item, NOT a random uuid.
  const idFactory = options.idFactory ?? ((row: ExpectedItem): string => `cmp_${row.id}`);
  const expectedText = expectedTextFor(item);
  const observedText = observedTextFor(item, detection);
  const observedCount = detection !== null && detection.present ? detection.count : null;
  const confidence = detection !== null ? detection.confidence : null;
  const boundingBox = detection !== null ? detection.boundingBox : null;
  // Reported = the model said anything about this kind, including "it is not there".
  const detectionReported = detection !== null;

  let status: ComparisonStatus;
  let difference = '';

  switch (item.expectation) {
    case 'COUNT': {
      const expectedCount = item.expectedCount ?? 0;
      if (detection === null || !detection.present) {
        // The model either saw nothing, or reported the element absent.
        status = 'UNDETERMINED';
      } else if (detection.count === null) {
        // The element is visible but the model refused to count it.
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
    // Empty on the single-image path: one image attributes itself through `captureId` and needs no list.
    sourceCaptureIds: options.sources === undefined
      ? []
      : options.sources.map((s) => s.captureId),
    countDisputed: options.countDisputed === true,
  };
}

// Compare a whole expected state against a whole detection set.
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

// Compare an expected state against SEVERAL photographs at once.
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
      const row = compareItem(item, null, {
        ...options,
        sources: reading.sources,
        countDisputed: true,
      });
      return {
        ...row,
        difference: describeDisagreement(reading, images),
        // The highest-confidence sighting is still real evidence for presence, so its box is kept for the overlay even though.
        confidence: reading.confidence,
      };
    }

    // Not disputed: reconcile to the single best reading so the existing rules apply unchanged.
    const best = pickRepresentative(item.element, images, reading);
    const row = compareItem(item, best, {
      ...options,
      sources: reading.sources,
      countDisputed: false,
    });
    return row;
  });
}

// The detection the single-image rules should evaluate.
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

// Roll comparison rows up into the counters the right-hand panel shows.
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