/**
 * Observation types. Every observation is advisory: it starts AI_GENERATED and
 * UNVERIFIED and only becomes construction truth through human verification.
 */

/** Marks how an observation came into existence. Never omitted. */
export type ObservationOrigin = 'AI_GENERATED';

/**
 * Human verification state. Every AI observation starts UNVERIFIED and can
 * only leave that state through an explicit human review action.
 *
 * NEEDS_REVIEW is the "seen but not yet decided" state: a human opened the
 * observation and asked for a site walk. It is deliberately distinct from
 * UNVERIFIED (never looked at) and from REJECTED (decided against), because
 * collapsing them loses the reason an item is still open.
 */
export type VerificationStatus =
  | 'UNVERIFIED'
  | 'NEEDS_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'OVERRIDDEN';

/** Observation categories. Deliberately descriptive of *visible reality*. */
export const OBSERVATION_CATEGORIES = [
  'OBSERVED_ELEMENT',
  'PROGRESS_OBSERVATION',
  'POTENTIAL_DEVIATION',
  'POTENTIAL_RISK',
  'SUGGESTED_FOLLOW_UP',
] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export function isObservationCategory(value: unknown): value is ObservationCategory {
  return (
    typeof value === 'string' &&
    (OBSERVATION_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Advisory severity. Never a compliance or safety determination. */
export const OBSERVATION_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type ObservationSeverity = (typeof OBSERVATION_SEVERITIES)[number];

export function isObservationSeverity(value: unknown): value is ObservationSeverity {
  return (
    typeof value === 'string' &&
    (OBSERVATION_SEVERITIES as readonly string[]).includes(value)
  );
}

/** Advisory next step for a human reviewer. NEVER auto-executed. */
export const SUGGESTED_ACTIONS = [
  'NO_ACTION',
  'HUMAN_REVIEW',
  'INSPECT_CLOSER',
  'CAPTURE_REFERENCE_PLAN',
  'SCHEDULE_FOLLOW_UP',
] as const;
export type SuggestedAction = (typeof SUGGESTED_ACTIONS)[number];

export function isSuggestedAction(value: unknown): value is SuggestedAction {
  return typeof value === 'string' && (SUGGESTED_ACTIONS as readonly string[]).includes(value);
}

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Per-observation evidence. Describes WHY the model said what it said.
 * Contains no credentials, no signed URLs and no other tenant's data.
 */
export interface ObservationEvidence {
  /** What in the image supports the observation. */
  readonly description: string;
  /** Normalized [0,1] bounding box in image space, when the model localises. */
  readonly boundingBox: BoundingBox | null;
  /** Region the observation was drawn from, when known. */
  readonly zoneId: string | null;
}

/** The structured record the product displays. */
export interface AIObservation {
  readonly id: string;
  readonly captureId: string;
  /** Optional project/zone scoping, when the caller supplies tenancy. */
  readonly projectId: string | null;
  readonly zoneId: string | null;
  readonly category: ObservationCategory;
  readonly observation: string;
  readonly evidence: ObservationEvidence;
  /** Model-reported confidence in [0,1]. NOT a measurement confidence. */
  readonly confidence: number;
  readonly severity: ObservationSeverity;
  readonly suggestedAction: SuggestedAction;
  readonly model: string;
  readonly provider: string;
  readonly generatedAt: string;
  /** Always 'AI_GENERATED' at creation. */
  readonly origin: ObservationOrigin;
  /** Always 'UNVERIFIED' at creation; only a human review changes it. */
  readonly verificationStatus: VerificationStatus;
  /** Human review trail; empty until a human acts. */
  readonly review: ObservationReview | null;
}

export interface ObservationReview {
  readonly status: Exclude<VerificationStatus, 'UNVERIFIED'>;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly note: string | null;
}

/**
 * The raw JSON shape the model is asked to produce. This is UNTRUSTED INPUT:
 * it is validated strictly before it can become an `AIObservation`, and any
 * field may be missing, wrong-typed, or hostile.
 */
export interface RawModelObservation {
  category?: unknown;
  observation?: unknown;
  evidence?: unknown;
  confidence?: unknown;
  severity?: unknown;
  suggested_action?: unknown;
  bounding_box?: unknown;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const MAX_OBSERVATION_CHARS = 1000;
const MAX_EVIDENCE_CHARS = 600;

function isPlainObject(value: unknown): value is Record<string, unknown> {
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

export function validateBoundingBox(
  value: unknown,
  issues: ValidationIssue[],
): BoundingBox | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    issues.push({ field: 'bounding_box', message: 'bounding_box must be an object when present' });
    return null;
  }
  const out: Record<string, number> = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push({ field: `bounding_box.${key}`, message: `${key} must be a finite number` });
      return null;
    }
    // Normalized coordinates only: a model that emits pixels is rejected
    // rather than silently misinterpreted.
    if (raw < 0 || raw > 1) {
      issues.push({
        field: `bounding_box.${key}`,
        message: `${key} must be normalized within [0,1]`,
      });
      return null;
    }
    out[key] = raw;
  }
  return {
    x: out['x'] as number,
    y: out['y'] as number,
    width: out['width'] as number,
    height: out['height'] as number,
  };
}

/** A single model observation that has passed strict validation. */
export interface ValidatedModelObservation {
  readonly category: ObservationCategory;
  readonly observation: string;
  readonly evidenceDescription: string;
  readonly confidence: number;
  readonly severity: ObservationSeverity;
  readonly suggestedAction: SuggestedAction;
  readonly boundingBox: BoundingBox | null;
}

/**
 * Validate ONE untrusted model observation.
 *
 * Fail-closed: anything not provably conformant is rejected, so a rejected
 * observation can never reach the product as truth.
 */
export function validateModelObservation(
  raw: unknown,
): ValidationResult<ValidatedModelObservation> {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ field: '(root)', message: 'observation must be a JSON object' }],
    };
  }

  const category = raw['category'];
  if (!isObservationCategory(category)) {
    issues.push({
      field: 'category',
      message: `category must be one of [${OBSERVATION_CATEGORIES.join(', ')}]`,
    });
  }

  const observation = validateString(
    raw['observation'],
    'observation',
    MAX_OBSERVATION_CHARS,
    issues,
  );

  let evidenceDescription: string | null = null;
  const rawEvidence = raw['evidence'];
  if (typeof rawEvidence === 'string') {
    evidenceDescription = validateString(rawEvidence, 'evidence', MAX_EVIDENCE_CHARS, issues);
  } else if (isPlainObject(rawEvidence)) {
    evidenceDescription = validateString(
      rawEvidence['description'],
      'evidence.description',
      MAX_EVIDENCE_CHARS,
      issues,
    );
  } else {
    issues.push({
      field: 'evidence',
      message: 'evidence must be a string or an object containing a description',
    });
  }

  const rawConfidence = raw['confidence'];
  let confidence: number | null = null;
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    issues.push({ field: 'confidence', message: 'confidence must be a finite number' });
  } else if (rawConfidence < 0 || rawConfidence > 1) {
    issues.push({ field: 'confidence', message: 'confidence must be within [0, 1]' });
  } else {
    confidence = rawConfidence;
  }

  const severity = raw['severity'];
  if (!isObservationSeverity(severity)) {
    issues.push({
      field: 'severity',
      message: `severity must be one of [${OBSERVATION_SEVERITIES.join(', ')}]`,
    });
  }

  const suggestedAction = raw['suggested_action'];
  if (!isSuggestedAction(suggestedAction)) {
    issues.push({
      field: 'suggested_action',
      message: `suggested_action must be one of [${SUGGESTED_ACTIONS.join(', ')}]`,
    });
  }

  const boundingBox = validateBoundingBox(raw['bounding_box'], issues);

  // A model that reports zero confidence in its own observation has asserted
  // nothing. Measured behaviour, not theory: the vision model this product runs
  // against echoes its schema back with every field zeroed, and those entries
  // used to pass validation and appear on screen as "0% confidence".
  if (confidence !== null) {
    if (confidence <= 0) {
      issues.push({
        field: 'confidence',
        message:
          'confidence is 0, so the model asserted no reading; the entry is a template placeholder '
          + 'and is discarded rather than shown',
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // A box enclosing no area is not a localisation. Reported as absent rather
  // than drawn, so the card can say "the model did not localise this".
  const usableBox =
    boundingBox !== null && boundingBox.width > 0 && boundingBox.height > 0
      ? boundingBox
      : null;

  return {
    ok: true,
    value: {
      category: category as ObservationCategory,
      observation: observation as string,
      evidenceDescription: evidenceDescription as string,
      confidence: confidence as number,
      severity: severity as ObservationSeverity,
      suggestedAction: suggestedAction as SuggestedAction,
      boundingBox: usableBox,
    },
  };
}

/** Display band. It never gates acceptance; any band still requires a human. */
export function confidenceBand(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence < 0.5) return 'LOW';
  if (confidence < 0.8) return 'MEDIUM';
  return 'HIGH';
}
