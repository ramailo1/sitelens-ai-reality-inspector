// Construction reasoning.

import type {
  ComparisonRow,
  DetectedElement,
  ExpectedState,
  FindingCategory,
} from './types/inspection.ts';
import { elementLabel } from './types/inspection.ts';
import type { AIObservation, ValidationIssue } from './types/observation.ts';

// How sure the reasoning is allowed to be.
export const REASONING_CERTAINTIES = ['SUPPORTED', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE'] as const;
export type ReasoningCertainty = (typeof REASONING_CERTAINTIES)[number];

export function isReasoningCertainty(value: unknown): value is ReasoningCertainty {
  return typeof value === 'string' && (REASONING_CERTAINTIES as readonly string[]).includes(value);
}

// One validated construction-reasoning record for one inspection.
export interface ConstructionReasoning {
  // One sentence: what the evidence supports about the work.
  readonly summary: string;
  // What carries the construction significance, and why it is the deciding factor.
  readonly whatMatters: string;
  // The reasoning itself: how the evidence and the comparison combine.
  readonly rationale: string;
  // A practical next inspection action. Never an approval or a rejection.
  readonly recommendation: string;
  // What a field user must physically check to resolve the open question.
  readonly verification: string;
  // The model's own certainty, or null when it declined to give one.
  readonly confidence: number | null;
  readonly certainty: ReasoningCertainty;
}

// Provenance of a reasoning result, so the stage is never anonymous.
export interface ReasoningProvenance {
  readonly model: string;
  readonly provider: string;
  readonly reasonedAt: string;
  readonly latencyMs: number;
  // How many comparison rows and detections the model was actually given.
  readonly rowsConsidered: number;
  readonly detectionsConsidered: number;
  // True when the reasoning text restates the vision stage rather than adding to it.
  readonly degenerate: boolean;
}

// Why the reasoning stage produced nothing.
export type ReasoningFailureKind =
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'MALFORMED_RESPONSE'
  | 'REJECTED_BY_VALIDATION'
  | 'EMPTY'
  | 'ERROR';

export type ReasoningOutcome =
  | {
      readonly status: 'AVAILABLE';
      readonly reasoning: ConstructionReasoning;
      readonly provenance: ReasoningProvenance;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly kind: ReasoningFailureKind;
      readonly message: string;
      readonly detail: string | null;
      readonly validationIssues: readonly ValidationIssue[];
    };

// Display text for an unavailable stage. Never implies the inspection failed.
export function describeReasoningFailure(kind: ReasoningFailureKind, message: string): string {
  switch (kind) {
    case 'DISABLED':
      return 'Construction reasoning is switched off for this run. The comparison below is unaffected.';
    case 'NOT_CONFIGURED':
      return 'No reasoning model is configured, so no construction reasoning was produced. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'MALFORMED_RESPONSE':
      return 'The reasoning model answered in a shape this product will not accept. '
        + 'No reasoning is shown rather than a repaired approximation of one.';
    case 'REJECTED_BY_VALIDATION':
      return 'The reasoning model\'s answer failed schema validation and was discarded. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'EMPTY':
      return 'The reasoning model returned no usable reasoning for this capture. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'TIMEOUT':
      return 'The reasoning model did not answer inside its deadline. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'UNAVAILABLE':
      return 'Nebius Token Factory could not be reached for construction reasoning. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'AUTHENTICATION':
      return 'Nebius rejected the credential for reasoning. Check NEBIUS_API_KEY. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    case 'RATE_LIMITED':
      return 'Nebius rate-limited the reasoning request. Wait a moment and run again. '
        + 'The visual observation and the deterministic comparison below are unaffected.';
    default:
      // Never a bare passthrough: an operator must be told both what happened and that the stages below it are still sound.
      return `${message} The visual observation and the deterministic comparison below are unaffected.`;
  }
}

const MAX_SUMMARY = 400;
const MAX_FIELD = 900;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(
  source: Record<string, unknown>,
  field: string,
  max: number,
  issues: ValidationIssue[],
): string | null {
  const raw = source[field];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    issues.push({ field, message: `${field} must be a non-empty string` });
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    issues.push({ field, message: `${field} must not exceed ${max} characters` });
    return null;
  }
  return trimmed;
}

export type ReasoningValidation =
  | { readonly ok: true; readonly value: ConstructionReasoning }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

// Validate ONE untrusted reasoning payload.
export function validateReasoning(raw: unknown): ReasoningValidation {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ field: '(root)', message: 'reasoning must be a JSON object' }],
    };
  }

  const summary = readText(raw, 'summary', MAX_SUMMARY, issues);
  const whatMatters = readText(raw, 'whatMatters', MAX_FIELD, issues);
  const rationale = readText(raw, 'rationale', MAX_FIELD, issues);
  const recommendation = readText(raw, 'recommendation', MAX_FIELD, issues);
  const verification = readText(raw, 'verification', MAX_FIELD, issues);

  const certainty = raw['certainty'];
  if (!isReasoningCertainty(certainty)) {
    issues.push({
      field: 'certainty',
      message: `certainty must be exactly one of [${REASONING_CERTAINTIES.join(', ')}]`,
    });
  }

  let confidence: number | null = null;
  const rawConfidence = raw['confidence'];
  if (rawConfidence !== undefined && rawConfidence !== null) {
    if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
      issues.push({ field: 'confidence', message: 'confidence must be a finite number' });
    } else if (rawConfidence < 0 || rawConfidence > 1) {
      issues.push({ field: 'confidence', message: 'confidence must be within [0, 1]' });
    } else {
      confidence = rawConfidence;
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      summary: summary as string,
      whatMatters: whatMatters as string,
      rationale: rationale as string,
      recommendation: recommendation as string,
      verification: verification as string,
      confidence,
      certainty: certainty as ReasoningCertainty,
    },
  };
}

// Does this reasoning merely restate the visual observation? Nemotron is required to ADD construction reasoning.
export function isDegenerateReasoning(
  reasoning: ConstructionReasoning,
  visualText: readonly string[],
): boolean {
  const visual = new Set<string>();
  for (const line of visualText) {
    for (const word of line.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 3) visual.add(word);
    }
  }
  if (visual.size === 0) return false;

  const added = (text: string): number => {
    let novel = 0;
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 3 && !visual.has(word)) novel += 1;
    }
    return novel;
  };

  const novel = added(reasoning.rationale) + added(reasoning.recommendation);
  // Two sentences' worth of vocabulary the vision stage never used.
  return novel < 12;
}

// A headline claim that restates a planned-state note as an observed conclusion.
export interface ExpectedNoteEcho {
  // Which headline field carries the echo.
  readonly field: 'summary' | 'whatMatters';
  // The operator note that was restated.
  readonly note: string;
  // The element the note belongs to.
  readonly element: string;
  // The comparison status the echo contradicts. Never MATCH when raised.
  readonly status: string;
}

// Whether headline reasoning launders an expected-state note into apparent fact.
export function echoesExpectedNote(
  reasoning: ConstructionReasoning,
  expected: ExpectedState,
  rows: readonly ComparisonRow[],
): ExpectedNoteEcho | null {
  const statusByExpectedId = new Map<string, string>();
  for (const row of rows) statusByExpectedId.set(row.expectedId, row.status);

  const significant = (text: string): string[] => {
    const seen = new Set<string>();
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 3) seen.add(word);
    }
    return [...seen];
  };

  for (const item of expected.items) {
    const status = statusByExpectedId.get(item.id);
    if (status === undefined || status === 'MATCH') continue;
    const words = significant(item.note);
    if (words.length < 2) continue;
    const summary = reasoning.summary.toLowerCase();
    const whatMatters = reasoning.whatMatters.toLowerCase();
    if (words.every((word) => summary.includes(word))) {
      return { field: 'summary', note: item.note, element: item.element, status };
    }
    if (words.every((word) => whatMatters.includes(word))) {
      return { field: 'whatMatters', note: item.note, element: item.element, status };
    }
  }
  return null;
}

// The structured record handed to the reasoning model.
export interface ReasoningContextInput {
  readonly projectName: string | null;
  // Names every photograph in the inspection, in order.
  readonly captureLabel: string;
  // How many photographs this inspection covers.
  readonly imageCount: number;
  readonly expected: ExpectedState;
  readonly detections: readonly DetectedElement[];
  readonly observations: readonly AIObservation[];
  readonly rows: readonly ComparisonRow[];
  readonly findings: readonly {
    readonly title: string;
    readonly category: FindingCategory;
    readonly severity: string;
  }[];
}

// Hard cap so one verbose capture cannot blow the reasoning prompt.
const MAX_ELEMENTS_IN_CONTEXT = 12;
const MAX_OBSERVATIONS_IN_CONTEXT = 6;

// Render the context as the plain, labelled text the reasoning model reads.
export function buildReasoningContext(input: ReasoningContextInput): string {
  const lines: string[] = [];

  lines.push('PROJECT CONTEXT');
  lines.push(
    input.projectName === null || input.projectName.trim().length === 0
      ? 'No project is named for this capture.'
      : `Project "${input.projectName.trim()}". This name is operator-entered and is NOT evidence of anything on site.`,
  );
  lines.push(`Capture label: ${input.captureLabel}`);
  // Stated explicitly for a group, so the model reasons about the SET rather than about whichever frame it happens to read first.
  if (input.imageCount > 1) {
    lines.push(
      `This inspection covers ${input.imageCount} photographs of the same subject, analysed together. `
      + 'Evidence from all of them is combined below. Where they disagree, that disagreement is reported '
      + 'as a disagreement and never resolved by adding the photographs up.',
    );
  }
  lines.push('');

  lines.push('EXPECTED STATE (comparison reference, NOT a design document)');
  lines.push(`Zone: ${input.expected.zone}. Source: ${input.expected.source}.`);
  if (input.expected.items.length === 0) {
    lines.push('- No expected items were declared, so nothing can be compared.');
  }
  for (const item of input.expected.items) {
    const count = item.expectation === 'COUNT' ? ` = ${item.expectedCount}` : '';
    // The note is an operator declaration of what was PLANNED, quoted as such so the model cannot mistake it for something.
    lines.push(`- ${elementLabel(item.element)} ${item.expectation}${count}${item.note ? ` (operator note: "${item.note}")` : ''}`);
  }
  lines.push('');

  lines.push('VISIBLE ELEMENTS reported by the vision model');
  const elements = input.detections.slice(0, MAX_ELEMENTS_IN_CONTEXT);
  if (elements.length === 0) {
    lines.push('- The vision model reported no construction elements for this capture.');
  }
  for (const element of elements) {
    const count =
      element.count === null
        ? 'count not determinable'
        : `count ${element.count} (visual count, not measured)`;
    lines.push(
      `- ${element.element}: ${element.present ? 'present' : 'NOT detected'}; ${count}; `
      + `confidence ${element.confidence.toFixed(2)}; evidence: ${element.evidence}`,
    );
  }
  if (input.detections.length > elements.length) {
    lines.push(`- ${input.detections.length - elements.length} further element(s) omitted for length.`);
  }
  lines.push('');

  lines.push('VISUAL OBSERVATIONS reported by the vision model');
  const observations = input.observations.slice(0, MAX_OBSERVATIONS_IN_CONTEXT);
  if (observations.length === 0) {
    lines.push('- The vision model returned no usable observations.');
  }
  observations.forEach((observation, index) => {
    // Which photograph produced this observation.
    const from = input.imageCount > 1 ? ` (from ${observation.captureLabel})` : '';
    lines.push(
      `${index + 1}. [${observation.category}] ${observation.observation} `
      + `(confidence ${observation.confidence.toFixed(2)})${from}`,
    );
  });
  lines.push('');

  lines.push('DETERMINISTIC COMPARISON (computed in code by SiteLens, not by any model)');
  if (input.rows.length === 0) {
    lines.push('- No comparison rows: nothing was inspected, or no expected items exist.');
  }
  for (const row of input.rows) {
    // The photographs a row rests on.
    const sources = input.imageCount > 1 && row.sourceCaptureIds.length > 1
      ? ` Across photographs: ${row.sourceCaptureIds.join(' + ')}.`
      : '';
    lines.push(
      `- ${row.element} ${row.expectation}: ${row.status}. `
      + `Expected: ${row.expectedText}. Observed: ${row.observedText}.`
      + (row.difference ? ` Difference: ${row.difference}` : '')
      + sources,
    );
  }
  lines.push('');

  lines.push('CURRENT FINDINGS (candidates only. Every one is UNVERIFIED.)');
  if (input.findings.length === 0) {
    lines.push('- No candidate findings were raised for this capture.');
  }
  for (const finding of input.findings.slice(0, 8)) {
    lines.push(`- [${finding.category}/${finding.severity}] ${finding.title}`);
  }
  lines.push('');

  return lines.join('\n');
}

// The visual claims the reasoning must add to, used for the degeneracy check.
export function visualClaimText(input: ReasoningContextInput): readonly string[] {
  return [
    ...input.detections.map((d) => `${d.evidence} ${d.element}`),
    ...input.observations.map((o) => `${o.observation} ${o.evidence.description}`),
  ];
}
