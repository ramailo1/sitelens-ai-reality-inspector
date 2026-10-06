/**
 * Inspection session.
 *
 * Wraps the inspector, the finding ledger and the capture metadata into the
 * single record the UI and the CLI both render, so provenance is produced once
 * and cannot drift between them.
 *
 * The record always states which model ran, what image was inspected, how many
 * observations survived validation and what the trust state is - including when
 * the run produced nothing at all, so a zero-result inspection is never mistaken
 * for a run that never happened.
 */

import { RealityInspector } from './inspector.ts';
import type { InspectionOutcome, InspectionResult, InspectionStatus } from './inspector.ts';
import { classifyUsableOutput } from './inspector.ts';
import { toCacheableFinding, toCacheableObservation } from './inspector-payload.ts';
import type { AIProvider } from './providers/provider.ts';
import { ProviderError } from './providers/provider.ts';
import type { Reasoner } from './providers/nemotron-reasoner.ts';
import { UnavailableReasoner } from './providers/nemotron-reasoner.ts';
import type {
  ConstructionReasoning,
  ReasoningContextInput,
  ReasoningFailureKind,
  ReasoningOutcome,
  ReasoningProvenance,
} from './reasoning.ts';
import { buildReasoningContext, describeReasoningFailure } from './reasoning.ts';
import {
  classifyPipelineEligibility,
  classifyEligibility,
  describeEligibility,
} from './eligibility.ts';
import type { HackathonEligibility, PipelineEligibility } from './eligibility.ts';
import { findingFrom, FindingLedger } from './findings.ts';
import type { Finding } from './findings.ts';
import { readImageDimensions, readImageGeometry, toPixelBox } from './image-metadata.ts';
import { compareExpectedState } from './compare.ts';
import type { ComparisonRow } from './types/inspection.ts';
import {
  buildCounters,
  buildPriorities,
  buildRealityBrief,
  synthesizeFindings,
} from './synthesis.ts';
import type { RealityCounters } from './synthesis.ts';
import { expectedSummaryFor } from './expected-state.ts';
import { defaultExpectedState } from './expected-state.ts';
import type {
  DetectedElement,
  ExpectedState,
  InspectionFinding,
  InspectionPriority,
  RealityBrief,
} from './types/inspection.ts';
import type { AIObservation, RawModelObservation, ValidationIssue } from './types/observation.ts';
import type { InferenceOrigin } from './cache.ts';
import { inspectionCache } from './cache.ts';
import type { DemoCapture } from './captures.ts';

/**
 * One element the model reported it can see, with its evidence geometry.
 * `countBasis` is always present so the UI can label a number as a visual
 * estimate or admit that none exists.
 */
export interface DetectedElementView {
  readonly element: string;
  readonly present: boolean;
  readonly count: number | null;
  readonly countBasis: 'VISUAL_COUNT' | 'NOT_DETERMINABLE';
  readonly confidence: number;
  readonly evidence: string;
  readonly boundingBox: AIObservation['evidence']['boundingBox'];
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  readonly localized: boolean;
}

/**
 * What the inspected image actually contributes to one finding, stated so the
 * UI can draw exactly what exists and no more:
 *
 *   LOCALIZED   a genuine model box exists; the overlay may draw it.
 *   FULL_FRAME  the finding rests on a real visual reading of THIS image, but
 *               the model returned no usable region. The absence of a rectangle
 *               is reported, never filled with an invented one.
 *   NONE        no visual reading supports the finding; it comes from the
 *               expected-state comparison alone.
 */
export type EvidenceState = 'LOCALIZED' | 'FULL_FRAME' | 'NONE';

/** A finding plus everything the detail view needs to draw its evidence. */
export interface FindingView extends Omit<InspectionFinding, 'id'> {
  readonly id: string;
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  readonly localized: boolean;
  /** Which of the three evidence states this finding is in; drives the UI copy. */
  readonly evidenceState: EvidenceState;
  /** Null when the model gave no location and we refuse to invent one. */
  readonly region: string | null;
}

export interface ComparisonView extends ComparisonRow {
  readonly pixelBox: ReturnType<typeof toPixelBox>;
}

/** A recorded human decision against an inspection finding. */
export interface FindingReview {
  readonly status: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly note: string | null;
}

/**
 * The reasoning stage as the UI sees it.
 *
 * `status` is always present. An unavailable reasoning stage is reported as
 * UNAVAILABLE with a reason, never silently omitted, because "Nemotron did not
 * contribute" and "Nemotron contributed nothing worth showing" are different
 * statements and only one of them is an error.
 */
export interface ReasoningView {
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ConstructionReasoning | null;
  readonly provenance: ReasoningProvenance | null;
  readonly failureKind: ReasoningFailureKind | null;
  readonly message: string | null;
  readonly detail: string | null;
  readonly validationIssues: readonly ValidationIssue[];
}

/** Everything needed to render one observation with its evidence geometry. */
export interface ObservationView {
  readonly id: string;
  readonly category: AIObservation['category'];
  readonly observation: string;
  readonly evidenceDescription: string;
  readonly confidence: number;
  readonly confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly severity: AIObservation['severity'];
  readonly suggestedAction: AIObservation['suggestedAction'];
  readonly model: string;
  readonly provider: string;
  readonly origin: AIObservation['origin'];
  readonly verificationStatus: AIObservation['verificationStatus'];
  readonly review: AIObservation['review'];
  readonly zoneId: string | null;
  readonly boundingBox: AIObservation['evidence']['boundingBox'];
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  /** False when the model did not localise this observation. */
  readonly localized: boolean;
  readonly findingId: string | null;
}

export interface ProvenanceRecord {
  readonly provider: string;
  readonly model: string;
  readonly captureId: string;
  readonly captureLabel: string;
  readonly projectId: string | null;
  readonly zoneId: string | null;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly imageWidth: number | null;
  readonly imageHeight: number | null;
  readonly inspectedAt: string;
  readonly latencyMs: number;
  readonly inferenceExecuted: boolean;
  readonly observationsReturned: number;
  readonly observationsAccepted: number;
  readonly observationsRejected: number;
  readonly trustState: string;
  readonly humanReviewPerformed: boolean;
  readonly eligibility: HackathonEligibility;
  readonly eligibilityNote: string;
  readonly rejectionIssues: readonly ValidationIssue[];
}

export interface SessionView {
  readonly outcome: InspectionOutcome['status'];
  readonly provenance: ProvenanceRecord;
  readonly observations: readonly ObservationView[];
  readonly findings: readonly Finding[];
  readonly failure: { readonly kind: string; readonly message: string; readonly detail: string | null } | null;

  /** WHAT EXISTS ON SITE, as reported by the model. */
  readonly detections: readonly DetectedElementView[];
  /** The comparison reference in force for this run. */
  readonly expected: ExpectedState;
  /** REALITY vs EXPECTED, one row per expected item. */
  readonly comparison: readonly ComparisonView[];
  /** Candidate attention areas, all UNVERIFIED until a human acts. */
  readonly inspectionFindings: readonly FindingView[];
  /** Where an inspector should look first. */
  readonly priorities: readonly InspectionPriority[];
  /** The short factual summary. */
  readonly brief: RealityBrief;
  /** Headline counters for the inspection panel. */
  readonly counters: RealityCounters;
  /**
   * FRESH AI INFERENCE | CACHED AI RESULT | DEMO FIXTURE.
   *
   * Always reported so the UI can never imply a live model call when the
   * result came from the cache or from the offline fixture.
   */
  readonly inferenceOrigin: InferenceOrigin;
  /** Set when CACHED: when the real inference behind this result happened. */
  readonly originalInferenceAt: string | null;
  readonly originalLatencyMs: number | null;
  /** True when the result came from the deterministic offline fixture. */
  readonly isDemoFixture: boolean;
  /**
   * STAGE 2: Nemotron construction reasoning.
   *
   * Always present. `status: 'UNAVAILABLE'` with a reason is the honest report
   * when the stage could not run; the comparison above it is unaffected either
   * way, which is the point of keeping them separate.
   */
  readonly reasoning: ReasoningView;
  /** Per-stage hackathon eligibility, now that two models run. */
  readonly pipelineEligibility: PipelineEligibility;
  /** Geometry facts about the capture, including any EXIF normalization. */
  readonly geometry: {
    readonly storedWidth: number | null;
    readonly storedHeight: number | null;
    readonly displayedWidth: number | null;
    readonly displayedHeight: number | null;
    readonly exifOrientation: number;
    readonly geometryNormalized: boolean;
  };
}

/** Geometry facts the UI shows so a rotated source file is visible, not hidden. */
export interface SessionGeometryView {
  readonly storedWidth: number | null;
  readonly storedHeight: number | null;
  readonly displayedWidth: number | null;
  readonly displayedHeight: number | null;
  readonly exifOrientation: number;
  readonly geometryNormalized: boolean;
}

/** One persisted inspection, as read back from disk. */
export interface RestoredInspection {
  readonly savedAt: string;
  readonly inspectedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly payload: {
    readonly observations: readonly unknown[];
    readonly elements: readonly unknown[];
    readonly findings: readonly unknown[];
  };
  readonly reviews: readonly {
    readonly key: string;
    readonly status: string;
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly note: string | null;
  }[];
}

/**
 * Shape the stage-2 outcome for display.
 *
 * Never returns null. The three cases are genuinely different statements —
 * "has not run yet", "ran and produced reasoning", "ran and produced nothing
 * usable" — and collapsing any pair of them would let a reasoning outage read as
 * agreement.
 */
export function buildReasoningView(
  outcome: ReasoningOutcome | null,
  reasoner: Reasoner,
): ReasoningView {
  if (outcome === null) {
    return {
      status: 'UNAVAILABLE',
      provider: reasoner.name,
      model: reasoner.model,
      reasoning: null,
      provenance: null,
      failureKind: null,
      message:
        'No inspection has been run on this capture yet, so there is nothing for construction '
        + 'reasoning to work from.',
      detail: null,
      validationIssues: [],
    };
  }
  if (outcome.status === 'AVAILABLE') {
    return {
      status: 'AVAILABLE',
      provider: outcome.provenance.provider,
      model: outcome.provenance.model,
      reasoning: outcome.reasoning,
      provenance: outcome.provenance,
      failureKind: null,
      message: null,
      detail: null,
      validationIssues: [],
    };
  }
  return {
    status: 'UNAVAILABLE',
    provider: reasoner.name,
    model: reasoner.model,
    reasoning: null,
    provenance: null,
    failureKind: outcome.kind,
    message: describeReasoningFailure(outcome.kind, outcome.message),
    detail: outcome.detail,
    validationIssues: outcome.validationIssues,
  };
}

/**
 * A single inspection session over one capture.
 *
 * The run order is the product thesis, executed:
 *
 *   1. MiniCPM-V      SEE          validated elements + observations
 *   2. compare.ts     COMPARE      MATCH / ATTENTION / UNDETERMINED, in arithmetic
 *   3. Nemotron       UNDERSTAND   construction reasoning over (1) and (2)
 *   4. synthesis.ts   INSPECT      candidate findings, all UNVERIFIED
 *   5. a named human  VERIFY       the only path from candidate to settled
 *
 * Step 2 runs BEFORE step 3 on purpose. Nemotron is told what the deterministic
 * comparison concluded, and its output can never change that conclusion: a
 * reasoning model arguing for MATCH does not get to become MATCH. The comparison
 * is arithmetic, and prose is not arithmetic.
 *
 * State lives in memory for the life of the process, and additionally in
 * `data/` when a persistence layer is attached. Neither is a database.
 */
export class InspectionSession {
  private readonly inspector: RealityInspector;
  private readonly ledger: FindingLedger;
  // Explicit fields rather than constructor parameter properties: Node's
  // type-stripping loader does not support parameter properties.
  private readonly provider: AIProvider;
  private readonly reasoner: Reasoner;
  private readonly capture: DemoCapture;
  private readonly projectId: string | null;
  private readonly projectName: string | null;
  private readonly zoneId: string | null;
  /** The comparison reference. Editable, and always reported back to the UI. */
  private expected: ExpectedState;
  private outcome: InspectionOutcome | null = null;
  private startedAt = 0;
  private latencyMs = 0;
  /** Human review of an inspection finding, keyed by stable content key. */
  private readonly reviewsByKey = new Map<string, FindingReview>();
  /** Findings from the most recent view(), so a review can resolve its id. */
  private currentFindings: readonly FindingView[] = [];
  /**
   * Stage 2 outcome. Cleared whenever the reference changes, because reasoning
   * written against a reference that no longer applies is exactly the stale
   * prose this product refuses to keep on screen.
   */
  private reasoning: ReasoningOutcome | null = null;

  public constructor(
    provider: AIProvider,
    capture: DemoCapture,
    projectId: string | null,
    zoneId: string | null,
    expected?: ExpectedState,
    options?: {
      readonly reasoner?: Reasoner;
      readonly projectName?: string | null;
    },
  ) {
    this.provider = provider;
    this.reasoner = options?.reasoner ?? new UnavailableReasoner({
      kind: 'DISABLED',
      message: 'No construction-reasoning model is attached to this session.',
    });
    this.capture = capture;
    this.projectId = projectId;
    this.projectName = options?.projectName ?? null;
    this.zoneId = zoneId;
    this.expected = expected ?? defaultExpectedState();
    this.inspector = new RealityInspector({ provider });
    this.ledger = new FindingLedger();
  }

  /**
   * Adopt a new comparison reference, discarding the result it invalidates.
   *
   * The comparison rows belong to the previous reference, so they are dropped
   * rather than re-presented under a preset that never produced them. Clearing
   * the outcome also removes the findings those rows produced, and the reasoning
   * that was written about them.
   */
  adoptReference(expected: ExpectedState): void {
    this.expected = expected;
    this.outcome = null;
    this.reasoning = null;
    this.reviewsByKey.clear();
  }

  /** Run the model. Safe to call repeatedly; the last run is what is rendered. */
  async run(options: { readonly useCache?: boolean } = {}): Promise<SessionView> {
    this.startedAt = Date.now();
    // The deterministic fixture is never served from cache: it costs nothing,
    // and a "cached" label on synthetic data would be actively misleading.
    const useCache = options.useCache === true && this.provider.name !== 'demo-fixture';
    try {
      const result = await this.inspector.inspectCached({
        image: {
          bytes: this.capture.bytes,
          mediaType: this.capture.mediaType,
          captureId: this.capture.id,
        },
        projectId: this.projectId,
        zoneId: this.zoneId,
        expectedSummary: expectedSummaryFor(this.expected),
        cache: inspectionCache,
        useCache,
      });
      // "Completed" means the validators accepted something. A response carrying
      // only valid elements or only valid findings is real usable output, so
      // keying this on observations.length alone reported a successful
      // inspection as VALIDATION_EMPTY.
      const status: InspectionStatus = classifyUsableOutput(result);
      this.outcome = {
        status,
        result,
        validationFailures: result.rejected,
      };
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        this.outcome = {
          status: 'FAILED', kind: error.kind,
          message: error.message, detail: error.detail ?? null,
        };
      } else {
        throw error;
      }
    }
    this.latencyMs = Date.now() - this.startedAt;

    // Stage 2 runs only on a run that produced usable perception. Reasoning
    // about a failed or empty inspection would be inventing a reading of a
    // photograph nothing has read.
    if (this.outcome !== null && this.outcome.status !== 'FAILED') {
      this.reasoning = await this.runReasoning();
    } else {
      this.reasoning = null;
    }
    return this.view();
  }

  /**
   * STAGE 2: Nemotron construction reasoning over the validated result.
   *
   * Receives the expected state, the validated detections, the validated
   * observations and the deterministic comparison rows. Never receives the raw
   * image and never writes back into the comparison.
   */
  private async runReasoning(): Promise<ReasoningOutcome> {
    const outcome = this.outcome;
    // PENDING is unreachable in practice (run() only ever assigns a real
    // outcome), but it is a member of the union and carries no result, so it is
    // excluded rather than assumed away.
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') {
      return {
        status: 'UNAVAILABLE',
        kind: 'ERROR',
        message: 'There is no inspection result to reason about.',
        detail: null,
        validationIssues: [],
      };
    }
    const result = outcome.result;
    const context: ReasoningContextInput = {
      projectName: this.projectName,
      captureLabel: this.capture.label,
      expected: this.expected,
      detections: result.elements ?? [],
      observations: result.observations,
      // The SAME rows the comparison panel renders. Reasoning is downstream of
      // arithmetic, never a substitute for it.
      rows: compareExpectedState(this.expected, result.elements ?? []),
      findings: (result.modelFindings ?? []).map((f) => ({
        title: f.title,
        category: f.category,
        severity: f.severity,
      })),
    };
    try {
      return await this.reasoner.reason(context);
    } catch (error: unknown) {
      // A reasoner that throws is a bug, but it must not destroy the inspection.
      return {
        status: 'UNAVAILABLE',
        kind: 'ERROR',
        message:
          'The construction-reasoning stage failed unexpectedly. The visual observation and the '
          + 'deterministic comparison below are unaffected.',
        detail: error instanceof Error ? error.message : String(error),
        validationIssues: [],
      };
    }
  }

  /**
   * Reattach a reasoning outcome restored from disk.
   *
   * Used on startup so a restored inspection still carries the reasoning that
   * produced it, rather than showing a bare comparison as if reasoning had never
   * been part of the pipeline. The stored provenance is honoured verbatim, so a
   * restored result is never re-attributed to a model that did not run.
   */
  restoreReasoning(
    reasoning: ConstructionReasoning,
    provenance: ReasoningProvenance,
  ): void {
    this.reasoning = { status: 'AVAILABLE', reasoning, provenance };
  }

  restoreReasoningFailure(kind: ReasoningFailureKind, message: string): void {
    this.reasoning = {
      status: 'UNAVAILABLE',
      kind,
      message,
      detail: null,
      validationIssues: [],
    };
  }

  /** The reasoning outcome, for persistence. Null before anything has run. */
  getReasoningOutcome(): ReasoningOutcome | null {
    return this.reasoning;
  }

  /** Raw validated provider payload, for persistence. Null before anything has run. */
  getPersistedPayload(): {
    observations: readonly unknown[];
    elements: readonly unknown[];
    findings: readonly unknown[];
  } | null {
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') return null;
    const result = outcome.result;
    return {
      observations: result.observations.map(toCacheableObservation),
      elements: result.elements ?? [],
      findings: (result.modelFindings ?? []).map(toCacheableFinding),
    };
  }

  /** Review records, for persistence. */
  getReviewRecords(): readonly {
    key: string; status: string; reviewer: string; reviewedAt: string; note: string | null;
  }[] {
    return [...this.reviewsByKey.entries()].map(([key, review]) => ({
      key,
      status: review.status,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      note: review.note,
    }));
  }

  /** Reapply persisted human decisions by their stable content key. */
  restoreReviews(
    records: readonly {
      key: string; status: string; reviewer: string; reviewedAt: string; note: string | null;
    }[],
  ): void {
    for (const record of records) {
      if (record.status !== 'VERIFIED' && record.status !== 'REJECTED' && record.status !== 'NEEDS_REVIEW') {
        continue;
      }
      if (typeof record.reviewer !== 'string' || record.reviewer.trim().length === 0) continue;
      this.reviewsByKey.set(record.key, {
        status: record.status,
        reviewer: record.reviewer,
        reviewedAt: record.reviewedAt,
        note: record.note,
      });
    }
  }

  /**
   * Record a human decision.
   *
   * Only a VERIFY decision can raise a finding; rejection and deferral leave the
   * observation out of the finding ledger, which is what stops unverified output
   * from becoming an actionable item.
   */
  review(input: {
    readonly observationId: string;
    readonly decision: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
    readonly reviewer: string;
    readonly note?: string | null;
  }): SessionView {
    const updated = this.inspector.reviewObservation({
      observationId: input.observationId,
      decision: input.decision,
      reviewer: input.reviewer,
      note: input.note ?? null,
    });

    if (updated !== null && input.decision === 'VERIFIED') {
      const result = findingFrom(updated);
      if (result.ok) this.ledger.add(result.finding);
    }

    return this.view();
  }

  /**
   * Record a human decision against an inspection finding.
   *
   * This is the ONLY way a finding leaves UNVERIFIED, and the only path from
   * "AI suspected" to "human verified". An anonymous review is refused: an
   * unattributed verification would make the whole trust chain meaningless.
   */
  reviewFinding(input: {
    readonly findingId: string;
    readonly decision: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
    readonly reviewer: string;
    readonly note?: string | null | undefined;
  }): SessionView {
    if (typeof input.reviewer !== 'string' || input.reviewer.trim().length === 0) {
      return this.view();
    }
    // Find the finding by the id the UI currently holds, then remember the
    // decision under its stable key so it survives the next re-render.
    const current = this.currentFindings.find((f) => f.id === input.findingId);
    if (current === undefined) return this.view();

    this.reviewsByKey.set(
      `${current.origin}|${current.comparisonId ?? ''}|${current.title.trim().toLowerCase()}`,
      {
        status: input.decision,
        reviewer: input.reviewer.trim(),
        reviewedAt: new Date().toISOString(),
        note: input.note ?? null,
      },
    );

    // A VERIFIED inspection finding is recorded in the session's own audit
    // trail above. The legacy observation ledger is a SEPARATE product: it
    // records findings raised from a verified OBSERVATION, and is deliberately
    // untouched by the inspection-finding loop.
    return this.view();
  }
  /**
   * Reopen a previously persisted inspection, WITHOUT calling any model.
   *
   * This is what makes a verified finding survive a restart. Three properties
   * make it safe to serve:
   *
   *   1. The stored payload goes back through the SAME validators as a fresh
   *      response, so a tampered state file cannot inject an element or finding
   *      that validation would have rejected.
   *   2. The result is labelled CACHED and carries the ORIGINAL inference time,
   *      so a restored result is never presented as a fresh model call.
   *   3. Human decisions are reapplied by their stable content key, so the
   *      VERIFIED / REJECTED state the operator set is the state that returns.
   *
   * Returns false when the payload yields nothing usable, so the caller can
   * leave the capture honestly un-inspected instead of showing an empty shell.
   */
  restoreInspection(record: RestoredInspection): boolean {
    const rebuilt = this.inspector.rebuildFromPayload(
      {
        provider: record.provider,
        model: record.model,
        observations: record.payload.observations as readonly RawModelObservation[],
        elements: record.payload.elements,
        findings: record.payload.findings,
      },
      {
        image: {
          bytes: this.capture.bytes,
          mediaType: this.capture.mediaType,
          captureId: this.capture.id,
        },
        projectId: this.projectId,
        zoneId: this.zoneId,
        expectedSummary: expectedSummaryFor(this.expected),
      },
    );

    const status = classifyUsableOutput(rebuilt);
    if (status !== 'COMPLETED') return false;

    this.outcome = {
      status,
      result: {
        ...rebuilt,
        inferenceOrigin: 'CACHED',
        originalInferenceAt: record.inspectedAt,
        originalLatencyMs: null,
      },
      validationFailures: rebuilt.rejected,
    };
    this.startedAt = Date.parse(record.inspectedAt);
    if (Number.isNaN(this.startedAt)) this.startedAt = Date.parse(record.savedAt);

    this.restoreReviews(record.reviews);
    return true;
  }

  view(): SessionView {
    const outcome = this.outcome;
    const dimensions = readImageDimensions(this.capture.bytes);
    const geometry = readImageGeometry(this.capture.bytes);
    const result: InspectionResult | null =
      outcome !== null && outcome.status !== 'FAILED' && outcome.status !== 'PENDING'
        ? outcome.result
        : null;

    const findings = this.ledger.all();

    // The inspection result is a snapshot taken at inference time. Reviews write
    // replacement records into the store, so the current trust state must be
    // read from the store rather than from the stale snapshot, otherwise a
    // recorded review would not appear in the UI.
    const liveById = new Map(
      this.inspector.listObservations(this.capture.id).map((o) => [o.id, o] as const),
    );

    const observations: ObservationView[] = (result?.observations ?? []).map(
      (snapshot, index) => {
        const observation = liveById.get(snapshot.id) ?? snapshot;
        const box = observation.evidence.boundingBox;
        const pixelBox = toPixelBox(box, dimensions);
        return {
          id: observation.id,
          category: observation.category,
          observation: observation.observation,
          evidenceDescription: observation.evidence.description,
          confidence: observation.confidence,
          confidenceBand: result?.bands[index] ?? 'LOW',
          severity: observation.severity,
          suggestedAction: observation.suggestedAction,
          model: observation.model,
          provider: observation.provider,
          origin: observation.origin,
          verificationStatus: observation.verificationStatus,
          review: observation.review,
          zoneId: observation.zoneId,
          boundingBox: box,
          pixelBox,
          localized: pixelBox !== null,
          findingId:
            findings.find((f) => f.sourceObservationId === observation.id)?.id ?? null,
        };
      },
    );

    // Every rejection from BOTH validators. Reporting only observation rejections
    // hid the ones that actually matter here: an element or finding rejected as a
    // template placeholder is exactly the operator needs to see, because it is
    // the difference between "the model saw nothing" and "the model answered
    // with placeholders we discarded".
    const rejectionIssues: ValidationIssue[] = [
      ...(result?.rejected ?? []).flatMap((entry) => entry.issues),
      ...(result?.rejectedInspection ?? []).flatMap((entry) => entry.issues),
    ];

    const rawDetections: readonly DetectedElement[] = result?.elements ?? [];
    const detections: DetectedElementView[] = rawDetections.map((d) => {
      const pixelBox = toPixelBox(d.boundingBox, dimensions);
      return {
        element: d.element,
        present: d.present,
        count: d.count,
        countBasis: d.countBasis,
        confidence: d.confidence,
        evidence: d.evidence,
        boundingBox: d.boundingBox,
        pixelBox,
        localized: pixelBox !== null,
      };
    });

    // Rows exist only alongside a real inspection. With no result there is nothing
    // observed, so producing rows would render every expectation as UNDETERMINED
    // and read like a finding rather than an un-inspected capture.
    const rows = result === null ? [] : compareExpectedState(this.expected, rawDetections);

    // Whether the model reported anything at all for each row's element. This is
    // what separates a finding the inspected image supports (full-frame evidence)
    // from one that rests on the expected state alone (no visual evidence).
    const detectionReportedByRow = new Map(rows.map((r) => [r.id, r.detectionReported] as const));

    // `synthetic` is true whenever the deterministic offline provider ran, so
    // a fixture result can never be presented as model inference.
    const synthetic = this.provider.name === 'demo-fixture';
    const synthesized = synthesizeFindings({
      captureId: this.capture.id,
      expected: this.expected,
      detections: rawDetections,
      modelFindings: result?.modelFindings ?? [],
      rows,
      synthetic,
    });

    // Human decisions are the authority, so a re-render must not resurrect a
    // reviewed finding as UNVERIFIED. Findings are re-synthesised on every
    // render but keep a content-derived id, so reviews are keyed by that same
    // stable content key.
    const stableKey = (f: InspectionFinding): string =>
      `${f.origin}|${f.comparisonId ?? ''}|${f.title.trim().toLowerCase()}`;

    const inspectionFindings: FindingView[] = synthesized.map((f) => {
      const review = this.reviewsByKey.get(stableKey(f)) ?? null;
      const pixelBox = toPixelBox(f.boundingBox, dimensions);
      // Evidence state, from strongest to weakest. AI findings are validated
      // observations of THIS image, so unlocalised ones are full-frame by
      // construction; comparison findings follow what their row's model
      // actually reported.
      const detectionReported =
        f.origin === 'AI' || (f.comparisonId !== null && detectionReportedByRow.get(f.comparisonId) === true);
      const view: FindingView = {
        ...f,
        verificationStatus: review === null ? 'UNVERIFIED' : review.status,
        review,
        pixelBox,
        localized: pixelBox !== null,
        evidenceState:
          pixelBox !== null ? 'LOCALIZED' : detectionReported ? 'FULL_FRAME' : 'NONE',
        region: f.location,
      };
      return view;
    });

    const priorities = buildPriorities(inspectionFindings);
    // Remembered so reviewFinding() can resolve the id the browser is holding
    // without re-entering the synthesis path.
    this.currentFindings = inspectionFindings;
    const brief = buildRealityBrief({
      detections: rawDetections,
      rows,
      findings: inspectionFindings,
      priorities,
      synthetic,
    });
    const counters = buildCounters({
      detections: rawDetections,
      findings: inspectionFindings,
      rows,
    });

    const comparison: ComparisonView[] = rows.map((row) => ({
      ...row,
      pixelBox: toPixelBox(row.boundingBox, dimensions),
    }));

    // Stage 2, shaped for display. Always an object: an unavailable reasoning
    // stage is reported as such rather than omitted, so the UI can say whether
    // Nemotron contributed or why it did not.
    const reasoningView: ReasoningView = buildReasoningView(this.reasoning, this.reasoner);

    // Per-stage eligibility. `ProvenanceRecord.eligibility` keeps reporting the
    // VISION stage alone, unchanged, because that is the claim it has always
    // made; the pipeline view adds the reasoning stage on top of it rather than
    // overwriting a field other code already reads.
    const eligibility = classifyEligibility({
      provider: this.provider.name,
      model: this.provider.model,
    });
    const pipelineEligibility = classifyPipelineEligibility({
      visionProvider: this.provider.name,
      visionModel: this.provider.model,
      reasoningProvider: this.reasoner.name,
      reasoningModel: this.reasoner.model,
      reasoningProduced: reasoningView.status === 'AVAILABLE',
    });

    const provenance: ProvenanceRecord = {
      provider: this.provider.name,
      model: this.provider.model,
      captureId: this.capture.id,
      captureLabel: this.capture.label,
      projectId: this.projectId,
      zoneId: this.zoneId,
      mediaType: this.capture.mediaType,
      byteLength: this.capture.bytes.length,
      imageWidth: dimensions?.width ?? null,
      imageHeight: dimensions?.height ?? null,
      inspectedAt: new Date(this.startedAt === 0 ? Date.now() : this.startedAt).toISOString(),
      latencyMs: this.latencyMs,
      // True whenever the model was actually invoked, which is the case for every
      // outcome except a transport or configuration failure.
      inferenceExecuted: outcome !== null && outcome.status !== 'FAILED',
      observationsReturned: result?.observations.length ?? 0,
      observationsAccepted: result?.observations.length ?? 0,
      observationsRejected: result?.rejected.length ?? 0,
      trustState: 'AI_GENERATED / UNVERIFIED until a human reviews',
      humanReviewPerformed:
        observations.some((o) => o.review !== null) || this.reviewsByKey.size > 0,
      eligibility,
      eligibilityNote: describeEligibility(eligibility, this.provider.model),
      rejectionIssues,
    };

    return {
      outcome: outcome?.status ?? 'PENDING',
      provenance,
      observations,
      findings,
      failure:
        outcome !== null && outcome.status === 'FAILED'
          ? { kind: outcome.kind, message: outcome.message, detail: outcome.detail }
          : null,
      detections,
      expected: this.expected,
      comparison,
      inspectionFindings,
      priorities,
      brief,
      counters,
      inferenceOrigin: synthetic ? 'DEMO_FIXTURE' : (result?.inferenceOrigin ?? 'FRESH'),
      originalInferenceAt: result?.originalInferenceAt ?? null,
      originalLatencyMs: result?.originalLatencyMs ?? null,
      isDemoFixture: synthetic,
      reasoning: reasoningView,
      pipelineEligibility,
      geometry: {
        storedWidth: geometry?.stored.width ?? null,
        storedHeight: geometry?.stored.height ?? null,
        displayedWidth: geometry?.displayed.width ?? null,
        displayedHeight: geometry?.displayed.height ?? null,
        // 1 means "no rotation". Reported so a rotated source file is visible
        // rather than quietly corrected.
        exifOrientation: geometry?.orientation ?? 1,
        geometryNormalized: geometry !== null && !geometry.normalized,
      },
    };
  }

  setFindingState(id: string, state: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED'): SessionView {
    this.ledger.setState(id, state);
    return this.view();
  }

  /**
   * Whether this capture has actually been inspected.
   *
   * Distinct from "a session exists": selecting a capture creates its session but
   * runs no model, so an un-inspected capture must not be reported as inspected.
   * Used to decide where returning to a project should land.
   */
  inspected(): boolean {
    return this.outcome !== null && this.outcome.status !== 'PENDING';
  }

  getLedger(): FindingLedger {
    return this.ledger;
  }
}
