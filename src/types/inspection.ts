/**
 * The inspection contract: what the model is asked to see, what the expected
 * state declares, and how the two are compared.
 *
 * Three trust levels live here and must not be blurred:
 *
 *   DetectedElement   what the model says it can SEE. A visual reading.
 *   ComparisonRow     reality vs expectation, computed in code from an expected
 *                     item and a detected element.
 *   InspectionFinding a candidate attention area, UNVERIFIED until a named
 *                     human acts on it.
 *
 * The comparison is separate from the model because "expected 12, observed 4" is
 * arithmetic, not opinion.
 */

import type {
  BoundingBox,
  ObservationReview,
  ObservationSeverity,
  VerificationStatus,
} from './observation.ts';
import { validateBoundingBox } from './observation.ts';

export type { BoundingBox, ObservationSeverity, VerificationStatus, ObservationReview };

/** Construction elements this inspector can reason about. */
export const ELEMENT_KINDS = [
  'COLUMN',
  'SLAB',
  'WALL',
  'OPENING',
  'MEP_ROUGH_IN',
  'FORMWORK',
  'SCAFFOLD',
  'EQUIPMENT',
  'WORKER',
  'REBAR',
  'FINISH',
  'EXCAVATION',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === 'string' && (ELEMENT_KINDS as readonly string[]).includes(value);
}

/** Human-readable element name, used in the UI and in generated prose. */
export const ELEMENT_LABELS: Readonly<Record<ElementKind, string>> = {
  COLUMN: 'column',
  SLAB: 'slab',
  WALL: 'wall',
  OPENING: 'opening',
  MEP_ROUGH_IN: 'MEP rough-in',
  FORMWORK: 'formwork',
  SCAFFOLD: 'scaffold',
  EQUIPMENT: 'equipment',
  WORKER: 'worker',
  REBAR: 'rebar',
  FINISH: 'finish',
  EXCAVATION: 'excavation',
};

export function elementLabel(kind: ElementKind): string {
  return ELEMENT_LABELS[kind];
}

/**
 * What an expected item requires.
 *
 *   PRESENT  it should be visible in this capture
 *   COUNT    a specific number should be visible
 *   ABSENT   it should NOT be visible (e.g. plant in a working zone)
 */
export const EXPECTATIONS = ['PRESENT', 'COUNT', 'ABSENT'] as const;
export type Expectation = (typeof EXPECTATIONS)[number];

export function isExpectation(value: unknown): value is Expectation {
  return typeof value === 'string' && (EXPECTATIONS as readonly string[]).includes(value);
}

/** One line of the lightweight inspection reference. */
export interface ExpectedItem {
  readonly id: string;
  readonly element: ElementKind;
  readonly expectation: Expectation;
  /** Required and validated only when expectation is COUNT. */
  readonly expectedCount: number | null;
  /** Free-text operator note, e.g. "substantially complete". */
  readonly note: string;
}

/**
 * The expected state of one zone. Intentionally lightweight: this is a
 * comparison reference, NOT a BIM model and NOT a schedule of works.
 */
export interface ExpectedState {
  readonly zone: string;
  readonly items: readonly ExpectedItem[];
  /** Where the reference came from. Always displayed, so a preset is never
   *  mistaken for the project's own programme. */
  readonly source: 'PRESET' | 'OPERATOR';
}

/** Where a number in this product came from. Never blurred. */
export type CountBasis =
  /** The model visually counted elements in the capture. An estimate, not a
   *  measurement; requires physical verification. */
  | 'VISUAL_COUNT'
  /** No defensible number exists for this capture. The correct answer is
   *  "unknown", and the product says so rather than guessing. */
  | 'NOT_DETERMINABLE';

export interface DetectedElement {
  readonly element: ElementKind;
  readonly present: boolean;
  /** Null whenever the model could not defensibly count. */
  readonly count: number | null;
  readonly countBasis: CountBasis;
  readonly confidence: number;
  readonly evidence: string;
  readonly boundingBox: BoundingBox | null;
}

/**
 * The result of comparing ONE expected item against what was detected.
 *
 * `UNDETERMINED` is a first-class outcome, not a failure. A single photograph
 * frequently cannot settle whether MEP rough-in exists behind a wall, and
 * claiming otherwise would be exactly the fabricated precision this product
 * refuses to offer.
 */
export type ComparisonStatus = 'MATCH' | 'ATTENTION' | 'UNDETERMINED';

export interface ComparisonRow {
  readonly id: string;
  readonly expectedId: string;
  readonly element: ElementKind;
  readonly expectation: Expectation;
  /** The expectation in words, e.g. "12 columns visible". */
  readonly expectedText: string;
  /** What was actually seen, in words, or an honest "not determinable". */
  readonly observedText: string;
  readonly status: ComparisonStatus;
  readonly countBasis: CountBasis;
  readonly expectedCount: number | null;
  readonly observedCount: number | null;
  /** Model confidence, or null when nothing was detected. */
  readonly confidence: number | null;
  readonly boundingBox: BoundingBox | null;
  /**
   * True when the model reported ANYTHING for this element kind — a sighting,
   * a count it refused to give, or an explicit absence. False when it reported
   * nothing at all. This is the line between a finding supported by the
   * inspected image (full-frame evidence) and one that rests on the expected
   * state alone (no visual evidence), and the UI must not blur it.
   */
  readonly detectionReported: boolean;
  /** The DIFFERENCE sentence. Empty when there is no difference. */
  readonly difference: string;
}

/**
 * Why a finding was raised. 'AI' means the model flagged it from the imagery;
 * 'COMPARISON' means OUR deterministic comparison of expected vs observed
 * produced it. The distinction is displayed so a judge can see which is which.
 */
export type FindingOrigin = 'AI' | 'COMPARISON';

export const FINDING_CATEGORIES = [
  'DEVIATION',
  'MISSING_ELEMENT',
  'INCOMPLETE_WORK',
  'UNEXPECTED_CONDITION',
  'QUALITY',
  'COORDINATION',
  'SAFETY_ATTENTION',
  'UNDETERMINED',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export function isFindingCategory(value: unknown): value is FindingCategory {
  return typeof value === 'string' && (FINDING_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The finding model. Every field the inspector needs to answer
 * WHAT / WHERE / WHY / EVIDENCE / HOW CONFIDENT / WHAT NEXT.
 *
 * A finding is a CANDIDATE. It is born UNVERIFIED and only a human moves it.
 */
export interface InspectionFinding {
  readonly id: string;
  readonly captureId: string;
  readonly title: string;
  readonly category: FindingCategory;
  readonly severity: ObservationSeverity;
  /** WHAT was detected. */
  readonly observation: string;
  /** WHERE. Null only when the model genuinely could not localise it. */
  readonly element: ElementKind | null;
  readonly location: string | null;
  /** EXPECTED, when a comparison reference exists. Null otherwise. */
  readonly expected: string | null;
  /** DIFFERENCE between expected and observed. Null when not applicable. */
  readonly difference: string | null;
  /** WHY it was flagged. */
  readonly reason: string;
  /** EVIDENCE in words. */
  readonly evidence: string;
  /** Model-reported confidence in the VISUAL reading only. */
  readonly confidence: number;
  /** RECOMMENDED next action for a human. Never auto-executed. */
  readonly recommendation: string;
  /** Normalized evidence box; null when the model did not localise it. */
  readonly boundingBox: BoundingBox | null;
  readonly origin: FindingOrigin;
  /** Always 'UNVERIFIED' at creation. */
  readonly verificationStatus: VerificationStatus;
  readonly review: ObservationReview | null;
  /** Links a COMPARISON finding back to the row that produced it. */
  readonly comparisonId: string | null;
  /** True when the run came from the deterministic offline provider. */
  readonly synthetic: boolean;
}

/** Overall inspection verdict. Derived in code, never asserted by the model. */
export type OverallAssessment = 'ATTENTION_REQUIRED' | 'REVIEW_SUGGESTED' | 'NO_ATTENTION';

export interface RealityBrief {
  readonly lines: readonly string[];
  readonly overall: OverallAssessment;
  readonly highestPriority: string | null;
  readonly synthetic: boolean;
}

/**
 * Where a human should spend attention first. This is the product's core
 * promise: the AI is not claiming the site is wrong, it is telling the
 * inspector where to LOOK first.
 */
export interface InspectionPriority {
  readonly rank: number;
  readonly title: string;
  readonly attention: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Why this ranks here, in one honest sentence. */
  readonly basis: string;
  readonly findingId: string;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const MAX_TITLE = 120;
const MAX_TEXT = 600;
const MAX_EVIDENCE = 400;
const MAX_RECOMMENDATION = 300;

/** Upper bound on a visually counted quantity. Beyond this a "count" is not a
 *  count, it is a hallucination, so it is rejected rather than displayed. */
export const MAX_PLAUSIBLE_COUNT = 500;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateString(
  value: unknown,
  field: string,
  maxChars: number,
  issues: ValidationIssue[],
): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, message: `${field} must be a non-empty string` });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    issues.push({ field, message: `${field} must not exceed ${maxChars} characters` });
    return null;
  }
  return trimmed;
}

function validateConfidence(
  value: unknown,
  issues: ValidationIssue[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ field: 'confidence', message: 'confidence must be a finite number' });
    return null;
  }
  if (value < 0 || value > 1) {
    issues.push({ field: 'confidence', message: 'confidence must be within [0, 1]' });
    return null;
  }
  return value;
}

const SEVERITIES: readonly string[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH'];

/**
 * The lowest confidence that counts as an actual assertion.
 *
 * Measured, not theoretical. The vision model this product runs against echoes
 * the expected-state list back as a template and fills every field with
 * placeholders: `present: true, confidence: 0.0, evidence: "no visible slab",
 * bounding_box: {0,0,0,0}`. Every one of those entries is structurally valid,
 * so before this check they sailed through validation and the deterministic
 * comparison then reported five fabricated MATCHes and one fabricated ATTENTION
 * on a photograph of a worker tying rebar.
 *
 * A model that reports zero confidence in its own reading has not asserted
 * anything. Accepting it would let a template echo decide a comparison, which is
 * precisely the fabricated precision this product refuses to produce.
 */
export const MIN_ASSERTED_CONFIDENCE = 0;

/**
 * Evidence that begins by denying what the entry claims to have found.
 *
 * Anchored at the start of the string on purpose. "no visible slab" contradicts
 * `present: true`; "rebar is visible, but no workers are visible" does not, and
 * must not be thrown away because a negation appears later in the sentence.
 */
const LEADING_NEGATION =
  /^\s*(no|not|none|absent|zero|nothing)\b/i;

function contradictsPresence(evidence: string): boolean {
  return LEADING_NEGATION.test(evidence);
}

/**
 * Reject an entry that asserts nothing.
 *
 * Applied to every model-authored entry — detected elements, observations and
 * findings — because the failure mode is not specific to one of them. The
 * message is written for the operator reading the rejection list, because
 * knowing WHAT was thrown away and WHY is the difference between a trustworthy
 * pipeline and a silent one.
 */
function assertIsAnAssertion(
  rawConfidence: unknown,
  confidence: number,
  evidence: string,
  present: boolean,
  issues: ValidationIssue[],
): boolean {
  if (confidence <= MIN_ASSERTED_CONFIDENCE) {
    issues.push({
      field: 'confidence',
      message:
        `confidence is ${confidence}, so the model asserted no reading; the entry is a template `
        + 'placeholder and is discarded rather than compared',
    });
    return false;
  }
  if (present && contradictsPresence(evidence)) {
    issues.push({
      field: 'evidence',
      message:
        `the entry claims presence while its own evidence begins by denying it ("${evidence.slice(0, 80)}"); `
        + 'a self-contradictory entry cannot be compared',
    });
    return false;
  }
  return true;
}

/**
 * Validate ONE untrusted detected element.
 *
 * `count` is the honesty-critical field: it is accepted only as a real
 * non-negative integer, and its absence is recorded as NOT_DETERMINABLE rather
 * than being defaulted to 0 or 1.
 */
export function validateDetectedElement(raw: unknown): ValidationResult<DetectedElement> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ field: '(root)', message: 'element must be a JSON object' }] };
  }

  const element = raw['element'];
  if (!isElementKind(element)) {
    issues.push({ field: 'element', message: `element must be one of [${ELEMENT_KINDS.join(', ')}]` });
  }

  const present = raw['present'];
  if (typeof present !== 'boolean') {
    issues.push({ field: 'present', message: 'present must be a boolean' });
  }

  const rawCount = raw['count'];
  let count: number | null = null;
  if (rawCount !== undefined && rawCount !== null) {
    if (
      typeof rawCount !== 'number' ||
      !Number.isInteger(rawCount) ||
      rawCount < 0 ||
      rawCount > MAX_PLAUSIBLE_COUNT
    ) {
      issues.push({
        field: 'count',
        message: `count must be an integer between 0 and ${MAX_PLAUSIBLE_COUNT} when present`,
      });
    } else {
      count = rawCount;
    }
  }

  const confidence = validateConfidence(raw['confidence'], issues);
  const evidence = validateString(raw['evidence'], 'evidence', MAX_EVIDENCE, issues);
  const boundingBox = validateBoundingBox(raw['bounding_box'], issues);

  // The element may still be real; a box that encloses no area is simply not a
  // localisation, which is an honest outcome rather than an error.
  const usableBox = boundingBox !== null && boundingBox.width > 0 && boundingBox.height > 0
    ? boundingBox
    : null;

  if (confidence !== null && evidence !== null) {
    assertIsAnAssertion(raw['confidence'], confidence, evidence, present === true, issues);
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      element: element as ElementKind,
      present: present as boolean,
      count,
      // A count is only ever reported when the model actually supplied one.
      countBasis: count === null ? 'NOT_DETERMINABLE' : 'VISUAL_COUNT',
      confidence: confidence as number,
      evidence: evidence as string,
      boundingBox: usableBox,
    },
  };
}

/** Validate ONE untrusted model finding. */
export function validateModelFinding(raw: unknown): ValidationResult<InspectionFinding> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ field: '(root)', message: 'finding must be a JSON object' }] };
  }

  const title = validateString(raw['title'], 'title', MAX_TITLE, issues);
  const observation = validateString(raw['observation'], 'observation', MAX_TEXT, issues);
  const reason = validateString(raw['reason'], 'reason', MAX_TEXT, issues);
  const evidence = validateString(raw['evidence'], 'evidence', MAX_EVIDENCE, issues);
  const recommendation = validateString(
    raw['recommendation'],
    'recommendation',
    MAX_RECOMMENDATION,
    issues,
  );

  const category = raw['category'];
  if (!isFindingCategory(category)) {
    issues.push({
      field: 'category',
      message: `category must be one of [${FINDING_CATEGORIES.join(', ')}]`,
    });
  }

  const severity = raw['severity'];
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) {
    issues.push({ field: 'severity', message: 'severity must be one of [INFO, LOW, MEDIUM, HIGH]' });
  }

  const confidence = validateConfidence(raw['confidence'], issues);

  // element / location / expected / difference are genuinely optional: a model
  // that cannot name the element must not be forced to invent one.
  const elementRaw = raw['element'];
  let element: ElementKind | null = null;
  if (elementRaw !== undefined && elementRaw !== null) {
    if (!isElementKind(elementRaw)) {
      issues.push({
        field: 'element',
        message: `element must be one of [${ELEMENT_KINDS.join(', ')}] when present`,
      });
    } else {
      element = elementRaw;
    }
  }

  const optionalText = (key: string, max: number): string | null =>
    raw[key] === undefined || raw[key] === null
      ? null
      : validateString(raw[key], key, max, issues);

  const location = optionalText('location', MAX_TITLE);
  const expected = optionalText('expected', MAX_TEXT);
  const difference = optionalText('difference', MAX_TEXT);
  const boundingBox = validateBoundingBox(raw['bounding_box'], issues);

  // A finding is a candidate attention area. One that asserts no confidence, or
  // whose own evidence denies what the title claims, is not a candidate.
  if (confidence !== null && evidence !== null) {
    assertIsAnAssertion(raw['confidence'], confidence, evidence, true, issues);
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      id: '',
      captureId: '',
      title: title as string,
      category: category as FindingCategory,
      severity: severity as ObservationSeverity,
      observation: observation as string,
      element,
      location,
      expected,
      difference,
      reason: reason as string,
      evidence: evidence as string,
      confidence: confidence as number,
      recommendation: recommendation as string,
      // A box enclosing no area points at nothing, so it is recorded as "not
      // localised" rather than drawn.
      boundingBox:
        boundingBox !== null && boundingBox.width > 0 && boundingBox.height > 0
          ? boundingBox
          : null,
      origin: 'AI',
      verificationStatus: 'UNVERIFIED',
      review: null,
      comparisonId: null,
      synthetic: false,
    },
  };
}