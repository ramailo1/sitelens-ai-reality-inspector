// Inspection synthesis: findings, priorities and the reality brief.

import type { ComparisonSummary } from './compare.ts';
import { NOT_DETERMINABLE_TEXT, summarizeComparison } from './compare.ts';
import type {
  ComparisonRow,
  DetectedElement,
  ExpectedState,
  FindingCategory,
  FindingOrigin,
  InspectionFinding,
  InspectionPriority,
  ObservationSeverity,
  OverallAssessment,
  RealityBrief,
} from './types/inspection.ts';
import { elementLabel } from './types/inspection.ts';

const SEVERITY_RANK: Readonly<Record<ObservationSeverity, number>> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

// An UNDETERMINED item is not an inspection priority.
function isPriority(finding: InspectionFinding): boolean {
  return (
    (finding.verificationStatus === 'UNVERIFIED' ||
      finding.verificationStatus === 'NEEDS_REVIEW') &&
    finding.category !== 'UNDETERMINED' &&
    finding.severity !== 'INFO'
  );
}

export interface SynthesizeOptions {
  readonly captureId: string;
  readonly expected: ExpectedState;
  readonly detections: readonly DetectedElement[];
  // Findings the model proposed, already validated.
  readonly modelFindings: readonly InspectionFinding[];
  readonly rows: readonly ComparisonRow[];
  // True when this came from the deterministic offline provider.
  readonly synthetic: boolean;
  // Overridable for tests; derives a stable id from the finding's content.
  readonly idFactory?: (key: string) => string;
}

// Turn one ATTENTION/UNDETERMINED comparison row into a finding.
function findingFromRow(
  row: ComparisonRow,
  captureId: string,
  synthetic: boolean,
): InspectionFinding | null {
  if (row.status === 'MATCH') return null;

  const label = elementLabel(row.element);
  const undetermined = row.status === 'UNDETERMINED';
  // Sentence case: a finding title is the first thing read on the card.
  const Label = label.charAt(0).toUpperCase() + label.slice(1);

  const title = undetermined
    ? `${Label} not confirmable from this capture`
    : row.expectation === 'COUNT'
      ? `${Label} count differs from expected`
      : `${Label} ${
          row.expectation === 'ABSENT' ? 'present but not expected' : 'expected but not detected'
        }`;

  const category: FindingCategory = undetermined
    ? 'UNDETERMINED'
    : row.expectation === 'ABSENT'
      ? 'UNEXPECTED_CONDITION'
      : row.expectation === 'COUNT'
        ? 'DEVIATION'
        : 'MISSING_ELEMENT';

  // An UNDETERMINED row must NOT carry an attention severity.
  const severity: ObservationSeverity = undetermined ? 'INFO' : 'MEDIUM';

  const observation = row.observedText;
  const reason = undetermined
    ? `${row.expectedText}, but the capture does not show enough to confirm or refute it. ` +
      'A single photograph cannot settle this; it stays open pending a walk or a second view.'
    : `Expected ${row.expectedText}. Observed ${row.observedText}.`;

  // EVIDENCE states exactly what the image supports, and no more.
  const evidence: string = row.boundingBox !== null
    ? 'The model localised this element in the capture; see the highlighted region.'
    : row.detectionReported
      ? 'Full-frame evidence: the finding is supported by the inspected image, but the ' +
        'model did not return a localised region for it.'
      : 'No visual reading of this element in this capture; the finding rests on the ' +
        'expected-state comparison rather than image evidence.';

  const recommendation = undetermined
    ? `Confirm by physical inspection: walk the zone and record whether ${label} is present. ` +
      'Do not treat this as a shortfall until it is verified.'
    : row.expectation === 'COUNT'
      ? `Verify the ${label} count on site before any corrective work is planned. ` +
        'The figure above is a VISUAL COUNT from one photograph, not a measured quantity.'
      : row.expectation === 'ABSENT'
        ? `Confirm whether ${label} should be in this zone, then decide whether it obstructs the work area.`
        : `Inspect the ${label} location directly and record whether work is genuinely incomplete.`;

  return {
    // Reassigned by synthesizeFindings with the content-derived id.
    id: '',
    captureId,
    title,
    category,
    severity,
    observation,
    element: row.element,
    location: null,
    expected: row.expectedText,
    difference: undetermined
      ? `Expected ${row.expectedText}; ${NOT_DETERMINABLE_TEXT}.`
      : row.difference,
    reason,
    evidence,
    // A comparison finding carries NO model confidence of its own: it is arithmetic.
    confidence: row.confidence ?? 0.5,
    recommendation,
    boundingBox: row.boundingBox,
    origin: 'COMPARISON',
    verificationStatus: 'UNVERIFIED',
    review: null,
    comparisonId: row.id,
    synthetic,
  };
}

// Build the full finding set: model-proposed candidates plus comparison-derived ones, deduplicated by title so a single.
export function synthesizeFindings(
  options: SynthesizeOptions,
): InspectionFinding[] {
  const idFactory =
    options.idFactory ??
    // Deterministic by default: ids are derived from the finding's content, so the same inspection always produces the same ids.
    ((key: string): string => `fnd_${shortHash(key)}`);
  const keyFor = (f: {
    origin: FindingOrigin;
    comparisonId: string | null;
    title: string;
  }): string => `${f.origin}|${f.comparisonId ?? ''}|${f.title.trim().toLowerCase()}`;

  const fromModel: InspectionFinding[] = options.modelFindings.map((f) => ({
    ...f,
    id: idFactory(keyFor(f)),
    captureId: options.captureId,
    synthetic: options.synthetic,
  }));

  const fromComparison = options.rows
    .map((row) => {
      const finding = findingFromRow(row, options.captureId, options.synthetic);
      return finding === null ? null : { ...finding, id: idFactory(keyFor(finding)) };
    })
    .filter((f): f is InspectionFinding => f !== null);

  const seen = new Set<string>();
  const merged: InspectionFinding[] = [];
  for (const finding of [...fromModel, ...fromComparison]) {
    const key = finding.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}

// A short, stable, non-cryptographic hash.
function shortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 10);
}

// Rank where an inspector should look first.
export function buildPriorities(
  findings: readonly InspectionFinding[],
): InspectionPriority[] {
  const open = findings.filter(isPriority);

  const ranked = [...open].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    // A comparison finding outranks an equally severe AI opinion, because its basis is a deterministic comparison rather.
    if (a.origin !== b.origin) return a.origin === 'COMPARISON' ? -1 : 1;
    return b.confidence - a.confidence;
  });

  return ranked.map((finding, index) => ({
    rank: index + 1,
    title: finding.title,
    attention: severityToAttention(finding.severity),
    basis:
      `${finding.origin === 'COMPARISON' ? 'Expected-state comparison' : 'Visual reading'} - ` +
      `${Math.round(finding.confidence * 100)}% confidence`,
    findingId: finding.id,
  }));
}

// The reality brief: a short, factual summary a site professional can act on.
export function buildRealityBrief(input: {
  readonly detections: readonly DetectedElement[];
  readonly rows: readonly ComparisonRow[];
  readonly findings: readonly InspectionFinding[];
  readonly priorities: readonly InspectionPriority[];
  readonly synthetic: boolean;
}): RealityBrief {
  const { detections, findings, priorities } = input;
  const comparison = summarizeComparison(input.rows);
  const lines: string[] = [];

  const counted = detections.filter((d) => d.count !== null && d.present);
  const summedCount = counted.reduce((sum, d) => sum + (d.count ?? 0), 0);

  if (detections.length === 0) {
    lines.push('No construction elements were reported in this capture.');
  } else if (counted.length > 0) {
    lines.push(
      `${summedCount} site elements counted across ${detections.length} detected types`,
    );
  } else {
    lines.push(`${detections.length} construction element types detected (not counted)`);
  }

  const attentionFindings = findings.filter(
    (f) => f.category !== 'UNDETERMINED' && f.verificationStatus === 'UNVERIFIED',
  );
  const undeterminedFindings = findings.filter((f) => f.category === 'UNDETERMINED');

  if (attentionFindings.length > 0) {
    lines.push(
      `${attentionFindings.length} potential deviation${attentionFindings.length === 1 ? '' : 's'} against the expected state`,
    );
  }
  if (undeterminedFindings.length > 0) {
    lines.push(
      `${undeterminedFindings.length} item${undeterminedFindings.length === 1 ? '' : 's'} this capture cannot settle`,
    );
  }
  if (comparison.attention > 0) {
    lines.push(
      `${comparison.attention} expected-state comparison${
        comparison.attention === 1 ? '' : 's'
      } need${comparison.attention === 1 ? 's' : ''} attention`,
    );
  }
  if (comparison.matched > 0) {
    lines.push(
      `${comparison.matched} expected-state check${comparison.matched === 1 ? '' : 's'} matched`,
    );
  }

  const overall = deriveOverall(attentionFindings, comparison);
  lines.push('');
  lines.push(`Overall inspection: ${overall.replace(/_/g, ' ')}`);

  return {
    lines,
    overall,
    highestPriority:
      priorities.length > 0 ? (priorities[0] as InspectionPriority).title : null,
    synthetic: input.synthetic,
  };
}

// The verdict. Any MEDIUM/HIGH candidate, or any ATTENTION comparison row, means a human should look.
function deriveOverall(
  attentionFindings: readonly InspectionFinding[],
  comparison: ComparisonSummary,
): OverallAssessment {
  if (attentionFindings.some((f) => f.severity === 'HIGH' || f.severity === 'MEDIUM')) {
    return 'ATTENTION_REQUIRED';
  }
  if (comparison.attention > 0 || attentionFindings.length > 0) {
    return 'REVIEW_SUGGESTED';
  }
  return 'NO_ATTENTION';
}

// Counters for the right-hand INSPECTION panel.
export interface RealityCounters {
  readonly elementsDetected: number;
  readonly elementsCounted: number;
  readonly totalCounted: number;
  readonly attentionAreas: number;
  readonly deviations: number;
  readonly incompleteAreas: number;
  readonly undetermined: number;
  readonly highestConfidence: number | null;
  readonly verified: number;
  readonly rejected: number;
  readonly pending: number;
}

export function buildCounters(input: {
  readonly detections: readonly DetectedElement[];
  readonly findings: readonly InspectionFinding[];
  readonly rows: readonly ComparisonRow[];
}): RealityCounters {
  const { detections, findings, rows } = input;
  const comparison = summarizeComparison(rows);
  const counted = detections.filter((d) => d.count !== null && d.present);
  const confidences = findings.map((f) => f.confidence);

  return {
    elementsDetected: detections.filter((d) => d.present).length,
    elementsCounted: counted.length,
    totalCounted: counted.reduce((sum, d) => sum + (d.count ?? 0), 0),
    attentionAreas: comparison.attention,
    deviations: findings.filter((f) => f.category === 'DEVIATION').length,
    incompleteAreas: findings.filter(
      (f) => f.category === 'MISSING_ELEMENT' || f.category === 'INCOMPLETE_WORK',
    ).length,
    undetermined: comparison.undetermined,
    highestConfidence: confidences.length > 0 ? Math.max(...confidences) : null,
    verified: findings.filter((f) => f.verificationStatus === 'VERIFIED').length,
    rejected: findings.filter((f) => f.verificationStatus === 'REJECTED').length,
    pending: findings.filter(
      (f) => f.verificationStatus === 'UNVERIFIED' || f.verificationStatus === 'NEEDS_REVIEW',
    ).length,
  };
}

function severityToAttention(severity: ObservationSeverity): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (severity === 'HIGH') return 'HIGH';
  if (severity === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}