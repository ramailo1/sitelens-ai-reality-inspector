/**
 * Construction reasoning.
 *
 * This is the SECOND model in the hybrid architecture, and it does a job the
 * first one cannot:
 *
 *   MiniCPM-V-4_5   SEE       what is visibly present in the photograph
 *   Nemotron         UNDERSTAND why that matters for the work, and what it does
 *                          NOT establish
 *   SiteLens code    COMPARE   expected vs observed, in arithmetic
 *   Human            VERIFY    the only path from candidate to settled
 *
 * Nemotron receives NO image. It reasons over the structured record the vision
 * stage produced plus the deterministic comparison, which is what makes the
 * split a genuine division of labour rather than the same model asked twice.
 *
 * Two rules are enforced here in code, not just requested in the prompt:
 *
 *   1. UNCERTAINTY IS NOT OPTIONAL. `certainty` is a closed vocabulary and the
 *      whole object is rejected if it is missing or unrecognised, so a response
 *      that never states how sure it is cannot reach the product.
 *   2. A REASONING CONFIDENCE IS NOT A VERIFICATION. It is carried as
 *      `confidence` and labelled `reasoningConfidence` in the UI, and it can
 *      never move a finding out of UNVERIFIED.
 *
 * Malformed output is rejected, never repaired. A rejected response is reported
 * as an unavailable reasoning stage and the comparison still stands on its own.
 */

import type {
  ComparisonRow,
  DetectedElement,
  ExpectedState,
  FindingCategory,
} from './types/inspection.ts';
import { elementLabel } from './types/inspection.ts';
import type { AIObservation, ValidationIssue } from './types/observation.ts';

/**
 * How sure the reasoning is allowed to be.
 *
 * INSUFFICIENT_EVIDENCE is the important one: it is the honest reading when the
 * photograph simply cannot settle the question, and it is the outcome the
 * product most wants a model to reach rather than talk itself out of.
 */
export const REASONING_CERTAINTIES = ['SUPPORTED', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE'] as const;
export type ReasoningCertainty = (typeof REASONING_CERTAINTIES)[number];

export function isReasoningCertainty(value: unknown): value is ReasoningCertainty {
  return typeof value === 'string' && (REASONING_CERTAINTIES as readonly string[]).includes(value);
}

/** One validated construction-reasoning record for one inspection. */
export interface ConstructionReasoning {
  /** One sentence: what the evidence supports about the work. */
  readonly summary: string;
  /** What carries the construction significance, and why it is the deciding factor. */
  readonly whatMatters: string;
  /** The reasoning itself: how the evidence and the comparison combine. */
  readonly rationale: string;
  /** A practical next inspection action. Never an approval or a rejection. */
  readonly recommendation: string;
  /** What a field user must physically check to resolve the open question. */
  readonly verification: string;
  /**
   * The model's own certainty, or null when it declined to give one.
   * NOT a measurement and NOT a verification; it can never settle a finding.
   */
  readonly confidence: number | null;
  readonly certainty: ReasoningCertainty;
}

/** Provenance of a reasoning result, so the stage is never anonymous. */
export interface ReasoningProvenance {
  readonly model: string;
  readonly provider: string;
  readonly reasonedAt: string;
  readonly latencyMs: number;
  /** How many comparison rows and detections the model was actually given. */
  readonly rowsConsidered: number;
  readonly detectionsConsidered: number;
  /**
   * True when the reasoning text restates the vision stage rather than adding
   * to it. Detected in code, reported honestly, never silently accepted.
   */
  readonly degenerate: boolean;
}

/**
 * Why the reasoning stage produced nothing.
 *
 * Every value is a distinct operational state. Collapsing them would let an
 * outage read as "no issues found".
 */
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

/** Display text for an unavailable stage. Never implies the inspection failed. */
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
      // Never a bare passthrough: an operator must be told both what happened and
      // that the stages below it are still sound, or a reasoning fault reads as
      // an absence of problems.
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

/**
 * Validate ONE untrusted reasoning payload. Fail-closed.
 *
 * `confidence` is optional and must be a finite number in [0,1] when present;
 * a missing one becomes null, which the UI renders as "not stated" rather than
 * as zero. Every other field is required: a reasoning record missing its
 * recommendation or its verification instruction is not a reasoning record.
 */
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

/**
 * Does this reasoning merely restate the visual observation?
 *
 * Nemotron is required to ADD construction reasoning. A response whose rationale
 * and recommendation are both near-copies of what the vision stage already said
 * has contributed nothing, and presenting it as a second model working would be
 * exactly the decorative integration this product refuses.
 *
 * Compared case- and whitespace-insensitively over word sets, because the two
 * stages legitimately share the same nouns (a photograph of rebar says "rebar"
 * in both); what must differ is the reasoning, not the subject.
 */
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
  // Two sentences' worth of vocabulary the vision stage never used. Below this
  // the reasoning is a paraphrase, not an addition.
  return novel < 12;
}

/** The structured record handed to the reasoning model. */
export interface ReasoningContextInput {
  readonly projectName: string | null;
  /**
   * Names every photograph in the inspection, in order.
   *
   * For a single photograph this is that photograph's own label verbatim. For a
   * group it names all of them, so the reasoning model is told up front that it
   * is reasoning over SEVERAL frames and must not describe any one of them as
   * "the capture".
   */
  readonly captureLabel: string;
  /** How many photographs this inspection covers. */
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

/** Hard cap so one verbose capture cannot blow the reasoning prompt. */
const MAX_ELEMENTS_IN_CONTEXT = 12;
const MAX_OBSERVATIONS_IN_CONTEXT = 6;

/**
 * Render the context as the plain, labelled text the reasoning model reads.
 *
 * Deliberately not JSON: a labelled block keeps the model's attention on the
 * ENGINEERING and away from re-parsing a nested structure, and it makes the
 * exact input auditable on screen. Every value here comes from validated
 * product data or from a deterministic comparison, so the block cannot smuggle
 * in an unverified claim.
 */
export function buildReasoningContext(input: ReasoningContextInput): string {
  const lines: string[] = [];

  lines.push('PROJECT CONTEXT');
  lines.push(
    input.projectName === null || input.projectName.trim().length === 0
      ? 'No project is named for this capture.'
      : `Project "${input.projectName.trim()}". This name is operator-entered and is NOT evidence of anything on site.`,
  );
  lines.push(`Capture label: ${input.captureLabel}`);
  // Stated explicitly for a group, so the model reasons about the SET rather than
  // about whichever frame it happens to read first. For one photograph this adds
  // nothing and is left out.
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
    lines.push(`- ${elementLabel(item.element)} ${item.expectation}${count}${item.note ? ` (${item.note})` : ''}`);
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
    // Which photograph produced this observation. Over a group, an unattributed
    // observation is unattributable evidence, so the source is carried into the
    // prompt rather than left in the session.
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
    // The photographs a row rests on. A disputed count is exactly the case where
    // the model must see that two frames disagreed, or it will narrate one of
    // them as if it settled the question.
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

/** The visual claims the reasoning must add to, used for the degeneracy check. */
export function visualClaimText(input: ReasoningContextInput): readonly string[] {
  return [
    ...input.detections.map((d) => `${d.evidence} ${d.element}`),
    ...input.observations.map((o) => `${o.observation} ${o.evidence.description}`),
  ];
}
