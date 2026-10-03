/**
 * Actionable findings.
 *
 * A finding is NOT an AI observation. The distinction is the point of the
 * product:
 *
 *   AI observation        untrusted, AI_GENERATED, never project truth
 *   human-verified finding  created only after a human VERIFIES an observation
 *
 * A finding can therefore never be produced from an unverified, rejected or
 * overridden observation, and never directly from model output. `findingFrom`
 * refuses anything that has not passed human verification.
 *
 * This is an isolated hackathon construct. Nothing here creates or syncs a
 * production SiteLens issue; `target` records that explicitly so a reviewer is
 * never misled about where the work would land.
 */

import { randomUUID } from 'node:crypto';
import type {
  AIObservation,
  ObservationCategory,
  SuggestedAction,
  VerificationStatus,
} from './types/observation.ts';

/**
 * Where a finding would be raised if the isolated project were connected to a
 * real system. Always 'sitelens-isolated-hackathon' today.
 */
export const FINDING_TARGET = 'sitelens-isolated-hackathon' as const;

/**
 * Lifecycle of a human-verified finding. A finding starts OPEN because a human
 * confirmed it; nothing downstream can silently close it.
 */
export type FindingState = 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';

export interface Finding {
  readonly id: string;
  /** The observation this finding was derived from. Always set. */
  readonly sourceObservationId: string;
  readonly captureId: string;
  readonly projectId: string | null;
  readonly zoneId: string | null;
  readonly category: ObservationCategory;
  /** Short human-facing statement of the confirmed condition. */
  readonly summary: string;
  /** What the model reported as evidence, retained for traceability. */
  readonly evidenceDescription: string;
  /** The model's advisory next step, carried forward not re-derived. */
  readonly suggestedAction: SuggestedAction;
  readonly severity: AIObservation['severity'];
  /** The human who verified the underlying observation. */
  readonly raisedBy: string;
  readonly raisedAt: string;
  readonly state: FindingState;
  readonly target: typeof FINDING_TARGET;
}

/** Reasons a finding cannot be raised from an observation. */
export type FindingRefusal =
  | 'ALREADY_HAD_REVIEW'
  | 'NOT_VERIFIED'
  | 'NOT_A_REAL_OBSERVATION';

export type FindingResult =
  | { readonly ok: true; readonly finding: Finding }
  | { readonly ok: false; readonly reason: FindingRefusal; readonly message: string };

/**
 * Derive a finding from an observation, but only when a human has verified it.
 *
 * The verification check is enforced here rather than at the call site so no
 * future caller can bypass it.
 */
export function findingFrom(
  observation: AIObservation,
  options: { readonly now?: () => Date; readonly idFactory?: () => string } = {},
): FindingResult {
  const now = options.now ?? ((): Date => new Date());
  const idFactory = options.idFactory ?? ((): string => `find_${randomUUID()}`);

  if (observation === null || typeof observation !== 'object' || typeof observation.id !== 'string') {
    return {
      ok: false,
      reason: 'NOT_A_REAL_OBSERVATION',
      message: 'No observation was supplied.',
    };
  }

  const status: VerificationStatus = observation.verificationStatus;

  if (status === 'UNVERIFIED') {
    return {
      ok: false,
      reason: 'NOT_VERIFIED',
      message:
        'An unverified AI observation cannot become a finding. A human must verify it first.',
    };
  }
  if (status === 'REJECTED') {
    return {
      ok: false,
      reason: 'NOT_VERIFIED',
      message: 'A rejected observation does not produce a finding.',
    };
  }
  if (status === 'OVERRIDDEN') {
    return {
      ok: false,
      reason: 'NOT_VERIFIED',
      message: 'An overridden observation must be reviewed afresh before it yields a finding.',
    };
  }

  const review = observation.review;
  if (review === null || review.status !== 'VERIFIED' || review.reviewer.trim().length === 0) {
    return {
      ok: false,
      reason: 'ALREADY_HAD_REVIEW',
      message: 'A verified finding requires a recorded human reviewer.',
    };
  }

  return {
    ok: true,
    finding: {
      id: idFactory(),
      sourceObservationId: observation.id,
      captureId: observation.captureId,
      projectId: observation.projectId,
      zoneId: observation.zoneId,
      category: observation.category,
      summary: observation.observation,
      evidenceDescription: observation.evidence.description,
      suggestedAction: observation.suggestedAction,
      severity: observation.severity,
      raisedBy: review.reviewer,
      raisedAt: now().toISOString(),
      state: 'OPEN',
      target: FINDING_TARGET,
    },
  };
}

/**
 * In-memory finding ledger. Demo scope only; not a project database and not
 * connected to production SiteLens.
 */
export class FindingLedger {
  private readonly rows = new Map<string, Finding>();

  public add(finding: Finding): void {
    this.rows.set(finding.id, finding);
  }

  public get(id: string): Finding | null {
    return this.rows.get(id) ?? null;
  }

  public all(): Finding[] {
    return [...this.rows.values()];
  }

  public byCapture(captureId: string): Finding[] {
    return this.all().filter((f) => f.captureId === captureId);
  }

  /** Advance a finding's lifecycle. The only way a finding leaves OPEN. */
  public setState(id: string, state: FindingState): Finding | null {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Finding = { ...existing, state };
    this.rows.set(id, updated);
    return updated;
  }
}