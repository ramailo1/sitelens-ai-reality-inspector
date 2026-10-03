/**
 * Turns raw provider output into structured observations. This is the only
 * place untrusted model output becomes product data.
 *
 * Observations are always created AI_GENERATED + UNVERIFIED, invalid entries
 * are dropped rather than coerced, and a provider failure propagates as a
 * failure so an outage never yields a fabricated result.
 */

import { randomUUID } from 'node:crypto';
import type { AIProvider, InspectRequest, ProviderFailureKind } from './providers/provider.ts';
import { ProviderError } from './providers/provider.ts';
import { confidenceBand, validateModelObservation } from './types/observation.ts';
import type {
  AIObservation,
  ObservationReview,
  ValidationIssue,
  VerificationStatus,
} from './types/observation.ts';

/** Result of one inspection run. */
export interface InspectionResult {
  readonly captureId: string;
  readonly provider: string;
  readonly model: string;
  /** Only schema-valid observations. May be empty. */
  readonly observations: readonly AIObservation[];
  /** Model entries rejected by validation. Never silently discarded. */
  readonly rejected: readonly { readonly issues: readonly ValidationIssue[] }[];
  /** Display-only band per observation index, aligned to `observations`. */
  readonly bands: readonly ('LOW' | 'MEDIUM' | 'HIGH')[];
  readonly inspectedAt: string;
}

export type InspectionOutcome =
  | {
      /** Nothing has been run yet in this session. */
      readonly status: 'PENDING';
    }
  | {
      readonly status: 'COMPLETED';
      readonly result: InspectionResult;
      /** Present only when at least one entry was rejected by validation. */
      readonly validationFailures: readonly { readonly issues: readonly ValidationIssue[] }[];
    }
  | {
      readonly status: 'VALIDATION_EMPTY';
      /** Inference succeeded; the model returned no usable observations. */
      readonly result: InspectionResult;
      readonly validationFailures: readonly { readonly issues: readonly ValidationIssue[] }[];
    }
  | {
      readonly status: 'VALIDATION_FAILED';
      /**
       * Inference succeeded and the response parsed, but nothing survived
       * validation. This is deliberately distinct from a provider failure:
       * the model DID run and DID answer.
       */
      readonly result: InspectionResult;
      readonly validationFailures: readonly { readonly issues: readonly ValidationIssue[] }[];
    }
  | {
      readonly status: 'FAILED';
      readonly kind: ProviderFailureKind;
      readonly message: string;
      readonly detail: string | null;
    };

export interface InspectOptions {
  readonly image: InspectRequest['image'];
  readonly projectId?: string | null | undefined;
  readonly zoneId?: string | null | undefined;
}

/** In-memory observation store. Demo scope only — not a product database. */
export class ObservationStore {
  private readonly rows = new Map<string, AIObservation>();

  public insert(observation: AIObservation): void {
    this.rows.set(observation.id, observation);
  }

  public get(id: string): AIObservation | null {
    return this.rows.get(id) ?? null;
  }

  public listByCapture(captureId: string): AIObservation[] {
    return [...this.rows.values()].filter((row) => row.captureId === captureId);
  }

  public all(): AIObservation[] {
    return [...this.rows.values()];
  }

  /** Apply a human decision. The ONLY way a verification status can change. */
  public review(id: string, review: ObservationReview): AIObservation | null {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: AIObservation = { ...existing, verificationStatus: review.status, review };
    this.rows.set(id, updated);
    return updated;
  }
}

export class RealityInspector {
  private readonly provider: AIProvider;
  private readonly store: ObservationStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: {
    provider: AIProvider;
    store?: ObservationStore;
    now?: () => Date;
    idFactory?: () => string;
  }) {
    this.provider = options.provider;
    this.store = options.store ?? new ObservationStore();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `obs_${randomUUID()}`);
  }

  /**
   * Inspect one capture.
   *
   * @throws {ProviderError} when the provider fails. The caller MUST surface
   * this as a failure; the inspector never converts an outage into a result.
   */
  async inspectCapture(options: InspectOptions): Promise<InspectionResult> {
    const raw = await this.provider.inspect({
      image: options.image,
      projectId: options.projectId ?? null,
      zoneId: options.zoneId ?? null,
    });

    const observations: AIObservation[] = [];
    const rejected: { issues: readonly ValidationIssue[] }[] = [];
    const bands: ('LOW' | 'MEDIUM' | 'HIGH')[] = [];

    for (const entry of raw.observations) {
      const validated = validateModelObservation(entry);

      // FAIL-CLOSED: an invalid entry is dropped, never repaired.
      if (!validated.ok) {
        rejected.push({ issues: validated.issues });
        continue;
      }

      const value = validated.value;
      const observation: AIObservation = {
        id: this.idFactory(),
        captureId: options.image.captureId,
        projectId: options.projectId ?? null,
        zoneId: options.zoneId ?? null,
        category: value.category,
        observation: value.observation,
        evidence: {
          description: value.evidenceDescription,
          boundingBox: value.boundingBox,
          zoneId: options.zoneId ?? null,
        },
        confidence: value.confidence,
        severity: value.severity,
        suggestedAction: value.suggestedAction,
        model: raw.model,
        provider: raw.provider,
        generatedAt: this.now().toISOString(),
        // Trust markers are set ONCE, here, and never derived from content.
        origin: 'AI_GENERATED',
        verificationStatus: 'UNVERIFIED',
        review: null,
      };

      this.store.insert(observation);
      observations.push(observation);
      bands.push(confidenceBand(value.confidence));
    }

    return {
      captureId: options.image.captureId,
      provider: raw.provider,
      model: raw.model,
      observations,
      rejected,
      bands,
      inspectedAt: this.now().toISOString(),
    };
  }

  /**
   * Inspect one capture and classify the outcome.
   *
   * The distinction between "the model failed", "the model answered but the
   * answer was unusable" and "the model had nothing to report" is what lets the
   * UI stay honest. Collapsing them would let a validation failure look like a
   * working inspection.
   */
  async inspect(options: InspectOptions): Promise<InspectionOutcome> {
    let result: InspectionResult;
    try {
      result = await this.inspectCapture(options);
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        return {
          status: 'FAILED',
          kind: error.kind,
          message: error.message,
          detail: error.detail ?? null,
        };
      }
      throw error;
    }

    const status =
      result.observations.length > 0
        ? 'COMPLETED'
        : result.rejected.length > 0
          ? 'VALIDATION_FAILED'
          : 'VALIDATION_EMPTY';

    return { status, result, validationFailures: result.rejected } as InspectionOutcome;
  }

  /** Human review: the ONLY transition out of UNVERIFIED. */
  reviewObservation(input: {
    observationId: string;
    decision: Exclude<VerificationStatus, 'UNVERIFIED'>;
    reviewer: string;
    note?: string | null | undefined;
  }): AIObservation | null {
    const target = this.store.get(input.observationId);
    // Refuse to review something that does not exist rather than silently
    // performing a no-op that would read as a successful review.
    if (!target) return null;
    if (!input.reviewer || input.reviewer.trim().length === 0) return null;

    return this.store.review(input.observationId, {
      status: input.decision,
      reviewer: input.reviewer.trim(),
      reviewedAt: this.now().toISOString(),
      note: input.note ?? null,
    });
  }

  public getObservation(id: string): AIObservation | null {
    return this.store.get(id);
  }

  public listObservations(captureId: string): AIObservation[] {
    return this.store.listByCapture(captureId);
  }

  public getStore(): ObservationStore {
    return this.store;
  }
}