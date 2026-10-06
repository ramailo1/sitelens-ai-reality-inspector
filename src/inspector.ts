/**
 * Turns raw provider output into structured observations. This is the only
 * place untrusted model output becomes product data.
 *
 * Observations always start AI_GENERATED + UNVERIFIED, invalid entries are
 * dropped rather than coerced, and a provider failure propagates as a failure so
 * an outage never yields a fabricated result.
 */

import { randomUUID } from 'node:crypto';
import type { AIProvider, InspectRequest, ProviderFailureKind } from './providers/provider.ts';
import { ProviderError } from './providers/provider.ts';
import {
  confidenceBand,
  validateModelObservation,
} from './types/observation.ts';
import { validateDetectedElement, validateModelFinding } from './types/inspection.ts';
import type { DetectedElement, InspectionFinding } from './types/inspection.ts';
import type {
  AIObservation,
  ObservationReview,
  RawModelObservation,
  ValidationIssue,
  VerificationStatus,
} from './types/observation.ts';
import type { InferenceOrigin, InspectionCache } from './cache.ts';
import { computeCacheKey } from './cache.ts';
import type { RawProviderResult } from './providers/provider.ts';
import { toCacheableFinding, toCacheableObservation } from './inspector-payload.ts';

export type { InferenceOrigin };

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
  /**
   * What the model reported it can SEE, strictly validated. Kept separate from
   * `rejected` so a bad element entry cannot change the observation counts.
   */
  readonly elements?: readonly DetectedElement[];
  /** Model-proposed attention areas, strictly validated. */
  readonly modelFindings?: readonly InspectionFinding[];
  /** Rejected element/finding entries, reported but never silently dropped. */
  readonly rejectedInspection?: readonly { readonly issues: readonly ValidationIssue[] }[];
  /**
   * Where this run's AI output came from. Always present so the UI can show
   * FRESH AI INFERENCE, CACHED AI RESULT or DEMO FIXTURE honestly.
   */
  readonly inferenceOrigin?: InferenceOrigin;
  /** When a CACHED result was served, when the original inference happened. */
  readonly originalInferenceAt?: string | null;
  readonly originalLatencyMs?: number | null;
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

export type InspectionStatus = 'COMPLETED' | 'VALIDATION_FAILED' | 'VALIDATION_EMPTY';

/**
 * Whether a validated result counts as a completed run. Anything the model
 * said that survived validation counts: observations, elements and findings
 * alike.
 */
export function classifyUsableOutput(result: InspectionResult): InspectionStatus {
  const usable =
    result.observations.length > 0 ||
    (result.elements?.length ?? 0) > 0 ||
    (result.modelFindings?.length ?? 0) > 0;
  if (usable) return 'COMPLETED';
  return result.rejected.length > 0 ? 'VALIDATION_FAILED' : 'VALIDATION_EMPTY';
}

export interface InspectOptions {
  readonly image: InspectRequest['image'];
  readonly projectId?: string | null | undefined;
  readonly zoneId?: string | null | undefined;
  /**
   * The expected state rendered as short plain text. Sent to the model only as
   * look-for context; the actual comparison happens in compare.ts, in code.
   */
  readonly expectedSummary?: string | null | undefined;
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
  /** Wall time of the most recent real provider call, for the cache record. */
  private lastLatencyMs = 0;

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
    const started = Date.now();
    const raw = await this.provider.inspect({
      image: options.image,
      projectId: options.projectId ?? null,
      zoneId: options.zoneId ?? null,
      expectedSummary: options.expectedSummary ?? null,
    });
    this.lastLatencyMs = Date.now() - started;

    return { ...this.buildFromPayload(raw, options), inferenceOrigin: 'FRESH' };
  }

  /**
   * Turn a provider payload into a validated result.
   *
   * Shared by the live path and the cache path so a cached result is validated
   * by exactly the same rules as a fresh one. A cache entry is raw provider
   * output, never pre-validated product data.
   */
  private buildFromPayload(
    raw: RawProviderResult,
    options: InspectOptions,
  ): InspectionResult {
    const observations: AIObservation[] = [];
    const rejected: { issues: readonly ValidationIssue[] }[] = [];
    const bands: ('LOW' | 'MEDIUM' | 'HIGH')[] = [];

    // The SEE layer. Kept in its own arrays so a malformed element entry can
    // never disturb the observation bookkeeping below.
    const elements: DetectedElement[] = [];
    const modelFindings: InspectionFinding[] = [];
    const rejectedInspection: { issues: readonly ValidationIssue[] }[] = [];

    for (const entry of raw.elements ?? []) {
      const validated = validateDetectedElement(entry);
      if (!validated.ok) {
        rejectedInspection.push({ issues: validated.issues });
        continue;
      }
      elements.push(validated.value);
    }

    for (const entry of raw.findings ?? []) {
      const validated = validateModelFinding(entry);
      if (!validated.ok) {
        rejectedInspection.push({ issues: validated.issues });
        continue;
      }
      modelFindings.push(validated.value);
    }

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
      elements,
      modelFindings,
      rejectedInspection,
      originalInferenceAt: null,
      originalLatencyMs: null,
    };
  }

  /**
   * Inspect, preferring a cached successful result.
   *
   * On a hit the provider is NOT called. The result is rebuilt through the same
   * validator as a fresh inference and is labelled `CACHED`, carrying the time of
   * the original inference. Failures are never cached, so a hit always means
   * "this exact image was successfully inspected before".
   */
  async inspectCached(
    options: InspectOptions & { readonly cache: InspectionCache; readonly useCache: boolean },
  ): Promise<InspectionResult> {
    const key = computeCacheKey({
      imageBytes: options.image.bytes,
      model: this.provider.model,
      expectedSummary: options.expectedSummary ?? '',
    });

    if (options.useCache) {
      const hit = options.cache.lookup(key);
      if (hit !== null) {
        const rebuilt = this.buildFromPayload(
          {
            provider: this.provider.name,
            model: hit.originalModel,
            observations: hit.payload.observations as readonly RawModelObservation[],
            elements: hit.payload.elements,
            findings: hit.payload.findings,
          },
          options,
        );
        return {
          ...rebuilt,
          inferenceOrigin: 'CACHED',
          originalInferenceAt: hit.originalInferenceAt,
          originalLatencyMs: hit.originalLatencyMs,
        };
      }
    }

    const fresh = await this.inspectCapture(options);
    if (fresh.inferenceOrigin === 'FRESH') {
      // Only a genuinely accepted result is storable. An empty or fully rejected
      // response would otherwise be served back forever as a fast "success".
      options.cache.store(
        key,
        {
          observations: fresh.observations.map(toCacheableObservation),
          elements: fresh.elements ?? [],
          findings: (fresh.modelFindings ?? []).map(toCacheableFinding),
        },
        {
          model: this.provider.model,
          latencyMs: this.lastLatencyMs,
          acceptedEntries: fresh.observations.length
            + (fresh.elements?.length ?? 0)
            + (fresh.modelFindings?.length ?? 0),
        },
      );
    }
    return fresh;
  }

  /**
   * Rebuild a validated result from a raw provider payload WITHOUT calling the
   * provider.
   *
   * The same `buildFromPayload` path a cache hit uses, exposed for restoring a
   * persisted inspection after a restart. Re-validating here rather than
   * trusting the file is deliberate: a state file on disk is exactly as
   * untrusted as a model response, and a run restored from one must be held to
   * identical rules or a restart would quietly relax the trust boundary.
   */
  rebuildFromPayload(
    raw: RawProviderResult,
    options: InspectOptions,
  ): InspectionResult {
    return { ...this.buildFromPayload(raw, options), inferenceOrigin: 'CACHED' };
  }

  /**
   * Inspect one capture and classify the outcome.
   *
   * "the model failed", "the model answered but the answer was unusable" and
   * "the model had nothing to report" stay distinct, so the UI can remain
   * honest: collapsing them would let a validation failure look like a working
   * inspection.
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

    const status = classifyUsableOutput(result);

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
}