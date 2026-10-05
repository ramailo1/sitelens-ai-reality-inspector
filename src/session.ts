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
import type { AIProvider } from './providers/provider.ts';
import { ProviderError } from './providers/provider.ts';
import { classifyEligibility, describeEligibility } from './eligibility.ts';
import type { HackathonEligibility } from './eligibility.ts';
import { findingFrom, FindingLedger } from './findings.ts';
import type { Finding } from './findings.ts';
import { readImageDimensions, toPixelBox } from './image-metadata.ts';
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
import type { AIObservation, ValidationIssue } from './types/observation.ts';
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

/** A finding plus everything the detail view needs to draw its evidence. */
export interface FindingView extends Omit<InspectionFinding, 'id'> {
  readonly id: string;
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  readonly localized: boolean;
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
}

/**
 * A single inspection session over one capture.
 *
 * State lives in memory for the life of the process; this is a demonstration
 * surface, not a persistence layer.
 */
export class InspectionSession {
  private readonly inspector: RealityInspector;
  private readonly ledger: FindingLedger;
  // Explicit fields rather than constructor parameter properties: Node's
  // type-stripping loader does not support parameter properties.
  private readonly provider: AIProvider;
  private readonly capture: DemoCapture;
  private readonly projectId: string | null;
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

  public constructor(
    provider: AIProvider,
    capture: DemoCapture,
    projectId: string | null,
    zoneId: string | null,
    expected?: ExpectedState,
  ) {
    this.provider = provider;
    this.capture = capture;
    this.projectId = projectId;
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
   * the outcome also removes the findings those rows produced.
   */
  adoptReference(expected: ExpectedState): void {
    this.expected = expected;
    this.outcome = null;
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
    return this.view();
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
  view(): SessionView {
    const outcome = this.outcome;
    const dimensions = readImageDimensions(this.capture.bytes);
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

    const rejectionIssues: ValidationIssue[] =
      result?.rejected.flatMap((entry) => entry.issues) ?? [];

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
      const view: FindingView = {
        ...f,
        verificationStatus: review === null ? 'UNVERIFIED' : review.status,
        review,
        pixelBox,
        localized: pixelBox !== null,
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

    const eligibility = classifyEligibility({
      provider: this.provider.name,
      model: this.provider.model,
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
