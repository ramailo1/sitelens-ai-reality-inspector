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
import { classifyUsableOutput, mergeImageResults } from './inspector.ts';
import { compareAcrossImages } from './compare.ts';
import type { ImageDetections, ImageProvenance } from './multi-image.ts';
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
import { localizeInspectionAll } from './localized-inspection.ts';
import type { LocalizedInspection } from './localized-inspection.ts';
import type { InspectionLanguage } from './localization.ts';
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
  /**
   * Which photograph produced this reading.
   *
   * Present on every detection, including in a single-image inspection. A
   * consolidated inspection is precisely the case where losing this would turn
   * evidence from three frames into an anonymous blob.
   */
  readonly captureId: string;
  readonly captureLabel: string;
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
  /**
   * Every photograph that supports this finding.
   *
   * One entry in a single-image inspection, several in a consolidated one. This
   * is the answer to "which photograph supports this finding?", and it is never
   * collapsed to a single representative image.
   */
  readonly sourceCaptureIds: readonly string[];
  /** Labels for `sourceCaptureIds`, same order, so the UI need not re-resolve. */
  readonly sourceCaptureLabels: readonly string[];
}

export interface ComparisonView extends ComparisonRow {
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  /**
   * Which photograph this row's box belongs to.
   *
   * Null when the row drew no box, or when several images contributed and no
   * single one is authoritative — the pixel box is then the highest-confidence
   * contributor's and this names it, so the overlay can never be read against
   * the wrong photograph.
   */
  readonly sourceCaptureId: string | null;
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
  /**
   * Which photograph produced this observation.
   *
   * Carried from the observation itself, never inferred from the group. In a
   * consolidated inspection this is the only thing that keeps evidence from three
   * frames from becoming an anonymous blob.
   */
  readonly captureId: string;
  readonly captureLabel: string;
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
  /** VISION-STAGE classification of the vision model alone. Never the verdict. */
  readonly eligibility: HackathonEligibility;
  /** Stage-scoped explanation of `eligibility`. */
  readonly eligibilityNote: string;
  readonly rejectionIssues: readonly ValidationIssue[];
}

/**
 * Why an inspection could not produce a complete result.
 *
 * `PARTIAL_ANALYSIS` is its own kind rather than a variant of FAILED. A run in
 * which two of three photographs were read is not a failed run and not a clean
 * one: the evidence it does hold is real, and the photograph it could not read
 * is absent. Reporting that as either "no failure" or "inspection failed" loses
 * the only fact that matters, so a consumer reading `failure` alone cannot tell
 * a complete inspection from a partial one.
 */
export type InspectionFailureKind =
  | 'PARTIAL_ANALYSIS'
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'MALFORMED_RESPONSE'
  | 'ERROR';

export interface SessionView {
  readonly outcome: InspectionOutcome['status'];
  readonly provenance: ProvenanceRecord;
  readonly observations: readonly ObservationView[];
  readonly findings: readonly Finding[];
  readonly failure: { readonly kind: InspectionFailureKind | string; readonly message: string; readonly detail: string | null } | null;

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
   * EVERY photograph this inspection covers, INCLUDING the ones that failed.
   *
   * This is what makes a consolidated inspection legible: the result states how
   * many photographs were offered, how many were read, and which frame each piece
   * of evidence came from. A run that reported only its successes would let a
   * partial inspection read as a complete one.
   */
  readonly images: readonly ImageProvenance[];
  /**
   * STAGE 2: Nemotron construction reasoning.
   *
   * Always present. `status: 'UNAVAILABLE'` with a reason is the honest report
   * when the stage could not run; the comparison above it is unaffected either
   * way, which is the point of keeping them separate.
   */
  readonly reasoning: ReasoningView;
  /**
   * The two model stages plus the submission-level NVIDIA verdict.
   *
   * Three distinct statements live here and are kept apart: whether each model
   * is an NVIDIA model, whether each stage met the requirement, and whether the
   * run as a whole did.
   */
  readonly pipelineEligibility: PipelineEligibility;
  /**
   * The same inspection, presented in every supported language.
   *
   * A pure projection of the fields above, computed once and shipped in the
   * same payload, so the browser can switch language without a request and
   * without touching the canonical facts. Selecting a language here is a
   * presentation choice and can never alter what the inspection found, when it
   * ran, which models ran it, or whether it qualifies.
   */
  readonly localized: Readonly<Record<InspectionLanguage, LocalizedInspection>>;
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

/**
 * One photograph's part in a consolidated inspection.
 *
 * Always present for every offered photograph, INCLUDING the ones that failed.
 * A run that reports only its successes would let a partial inspection read as a
 * complete one, which is the specific failure this product exists to prevent.
 */
export interface ImageOutcome {
  readonly captureId: string;
  readonly captureLabel: string;
  /** FAILED means this photograph contributed nothing. */
  readonly status: 'ANALYSED' | 'FAILED';
  readonly failure: string | null;
  readonly elements: readonly DetectedElement[];
  readonly observations: readonly AIObservation[];
  readonly modelFindings: readonly InspectionFinding[];
}

/**
 * Dimensions of one capture's stored bytes.
 *
 * Re-reads the header rather than trusting a value from the workspace file: a
 * truncated upload must not reappear with a claimed size.
 */
function dimensionsByCaptureOf(target: DemoCapture): ReturnType<typeof readImageDimensions> {
  return readImageDimensions(target.bytes);
}

/** The capture's provenance label, as a technical enum the UI can localize. */
function sourceLabelFor(capture: DemoCapture): string {
  const source = (capture as { source?: unknown }).source;
  return typeof source === 'string' ? source : 'UPLOAD';
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
  /**
   * Per-image payloads for a consolidated inspection.
   *
   * Absent on every inspection written before multi-image existed; the reader
   * then falls back to the single merged `payload` above. Present entries are
   * re-validated individually, so a multi-image inspection restores through the
   * same validators a fresh one does.
   */
  readonly payloads?: readonly {
    readonly captureId: string;
    readonly captureLabel: string;
    readonly payload: {
      readonly observations: readonly unknown[];
      readonly elements: readonly unknown[];
      readonly findings: readonly unknown[];
    };
  }[] | undefined;
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
  /**
   * Every photograph in this inspection.
   *
   * Length 1 is the historical case and behaves identically. Length >1 is a
   * consolidated inspection: each image gets its own real vision call, the
   * validated outputs are combined, and one comparison and one reasoning pass
   * follow. `capture` below is always the FIRST image, so every existing
   * single-image reader of this class is unchanged.
   */
  private readonly captures: readonly DemoCapture[];
  /** The first photograph. The single-image identity of this session. */
  private readonly capture: DemoCapture;
  private readonly projectId: string | null;
  private readonly projectName: string | null;
  private readonly zoneId: string | null;
  /**
   * Per-image outcome of the most recent run.
   *
   * A FAILED entry is retained rather than dropped: the consolidated result must
   * be able to say that three photographs were offered and two were read, so a
   * partial run can never be presented as a complete one.
   */
  private imageOutcomes: readonly ImageOutcome[] = [];
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
      /**
       * The remaining photographs of a consolidated inspection.
       *
       * Accepted as an array rather than a second positional parameter so every
       * existing construction site keeps compiling unchanged. The first entry of
       * `captures` stays the session's primary image.
       */
      readonly additionalCaptures?: readonly DemoCapture[];
    },
  ) {
    this.provider = provider;
    this.reasoner = options?.reasoner ?? new UnavailableReasoner({
      kind: 'DISABLED',
      message: 'No construction-reasoning model is attached to this session.',
    });
    // De-duplicated by identity so a repeated capture cannot be analysed twice.
    const seen = new Set<string>();
    const all: DemoCapture[] = [];
    for (const item of [capture, ...(options?.additionalCaptures ?? [])]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
    this.captures = all;
    this.capture = all[0] as DemoCapture;
    this.projectId = projectId;
    this.projectName = options?.projectName ?? null;
    this.zoneId = zoneId;
    this.expected = expected ?? defaultExpectedState();
    this.inspector = new RealityInspector({ provider });
    this.ledger = new FindingLedger();
  }

  /** The photographs this inspection covers, in the order they were supplied. */
  public get imageIds(): readonly string[] {
    return this.captures.map((c) => c.id);
  }

  /** How many real vision calls this inspection makes. */
  public get imageCount(): number {
    return this.captures.length;
  }

  /** The label of a capture this inspection holds, or its id if unknown. */
  private labelFor(captureId: string): string {
    return this.captures.find((c) => c.id === captureId)?.label ?? captureId;
  }

  /**
   * The headline failure of this run, partial analysis included.
   *
   * All-or-nothing stays FAILED. A run that read SOME photographs is COMPLETED
   * with a PARTIAL_ANALYSIS failure rather than a clean COMPLETED: the result is
   * usable and the omission is real, and both facts have to reach the same
   * reader.
   */
  private topLevelFailure(
    outcome: InspectionOutcome | null,
  ): { readonly kind: InspectionFailureKind | string; readonly message: string; readonly detail: string | null } | null {
    // PENDING carries no result and therefore no failure. It is a member of the
    // union rather than assumed away.
    if (outcome === null || outcome.status === 'PENDING') return null;
    if (outcome.status === 'FAILED') {
      return { kind: outcome.kind, message: outcome.message, detail: outcome.detail };
    }
    const failed = this.imageOutcomes.filter((o) => o.status === 'FAILED');
    if (failed.length === 0) return null;
    const analysed = this.captures.length - failed.length;
    return {
      kind: 'PARTIAL_ANALYSIS',
      message:
        `Partial inspection: ${analysed} of ${this.captures.length} photograph(s) were analysed and `
        + `${failed.length} failed (${failed.map((f) => f.captureLabel).join(', ')}). `
        + 'The failed photographs contributed no evidence.',
      detail: failed.map((f) => f.failure).filter((m): m is string => typeof m === 'string').join(' | '),
    };
  }

  /**
   * Per-image provenance for the view.
   *
   * Includes the images that FAILED, because a consolidated inspection that
   * reported only its successes would let a partial run read as complete.
   */
  private imageProvenance(): ImageProvenance[] {
    return this.captures.map((capture) => {
      const outcome = this.imageOutcomes.find((o) => o.captureId === capture.id);
      const dims = dimensionsByCaptureOf(capture);
      return {
        captureId: capture.id,
        captureLabel: capture.label,
        source: sourceLabelFor(capture),
        mediaType: capture.mediaType,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        byteLength: capture.bytes.length,
        status: outcome === undefined || outcome.status === 'FAILED' ? 'FAILED' : 'ANALYSED',
        failure: outcome?.failure ?? null,
        observationCount: outcome?.observations.length ?? 0,
      };
    });
  }

  /**
   * The label the reasoning stage is told it is reasoning over.
   *
   * One image keeps its own label verbatim, so the existing single-image prompt
   * is byte-identical. Several images name all of them, because a prompt that
   * said "this capture" while handing over three photographs would misreport
   * what the model was shown.
   */
  private captureGroupLabel(): string {
    if (this.captures.length <= 1) return this.capture.label;
    return this.captures.map((c) => c.label).join(' + ');
  }

  /** Per-image readings, in run order, for the reconciling comparison. */
  private imageDetections(): ImageDetections[] {
    return this.imageOutcomes.map((outcome) => ({
      captureId: outcome.captureId,
      captureLabel: outcome.captureLabel,
      detections: outcome.elements,
    }));
  }

  /**
   * The comparison rows for this run.
   *
   * A single image takes the untouched single-image path. Several images go
   * through the reconciling comparison, so counts are never summed and every
   * row records which photographs contributed to it.
   */
  private comparisonRows(detections: readonly DetectedElement[]): ComparisonRow[] {
    if (this.captures.length <= 1 || this.imageOutcomes.length <= 1) {
      return compareExpectedState(this.expected, detections);
    }
    return compareAcrossImages(this.expected, this.imageDetections());
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
    const expectedSummary = expectedSummaryFor(this.expected);

    // ONE real vision call per photograph, in order. Sequential on purpose: the
    // progress the operator sees is then literally true, and a rate-limited
    // provider is not hit with N concurrent requests.
    const results: InspectionResult[] = [];
    const outcomes: ImageOutcome[] = [];
    let firstProviderError: ProviderError | null = null;

    for (const capture of this.captures) {
      try {
        const result = await this.inspector.inspectCached({
          image: {
            bytes: capture.bytes,
            mediaType: capture.mediaType,
            captureId: capture.id,
            // Provenance only, never sent to the model. It is what lets every
            // observation name the photograph it came from.
            captureLabel: capture.label,
          },
          projectId: this.projectId,
          zoneId: this.zoneId,
          expectedSummary,
          cache: inspectionCache,
          useCache,
        });
        results.push(result);
        outcomes.push({
          captureId: capture.id,
          captureLabel: capture.label,
          status: 'ANALYSED',
          failure: null,
          elements: result.elements ?? [],
          observations: result.observations,
          modelFindings: result.modelFindings ?? [],
        });
      } catch (error: unknown) {
        if (error instanceof ProviderError) {
          // Recorded, not fatal. One unreadable photograph must not discard the
          // evidence the others produced, but it must also never be counted as
          // a success.
          if (firstProviderError === null) firstProviderError = error;
          outcomes.push({
            captureId: capture.id,
            captureLabel: capture.label,
            status: 'FAILED',
            failure: error.message,
            elements: [],
            observations: [],
            modelFindings: [],
          });
        } else {
          throw error;
        }
      }
    }

    this.imageOutcomes = outcomes;

    // "Completed" means the validators accepted something. A response carrying
    // only valid elements or only valid findings is real usable output, so
    // keying this on observations.length alone reported a successful
    // inspection as VALIDATION_EMPTY.
    if (results.length === 0) {
      // Every photograph failed. Fail closed: no inspection is invented from
      // images that were never read.
      const error = firstProviderError;
      this.outcome = error === null
        ? { status: 'FAILED', kind: 'ERROR', message: 'No image in this inspection could be read.', detail: null }
        : { status: 'FAILED', kind: error.kind, message: error.message, detail: error.detail ?? null };
    } else {
      const merged = mergeImageResults(results);
      const status: InspectionStatus = classifyUsableOutput(merged);
      this.outcome = {
        status,
        result: merged,
        validationFailures: merged.rejected,
      };
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
      // The whole set, because the reasoning stage must be told what it is
      // reasoning over. A single image still produces the singular label.
      captureLabel: this.captureGroupLabel(),
      // How many frames this pass is reasoning over, so the prompt can say so
      // and attribute each observation to one of them.
      imageCount: this.captures.length,
      expected: this.expected,
      detections: result.elements ?? [],
      // The COMBINED validated observations, not one image's. Every observation
      // keeps its own captureId, so the prompt attributes each to its
      // photograph and Nemotron can say which frame supports a claim.
      observations: result.observations,
      // The SAME rows the comparison panel renders. Reasoning is downstream of
      // arithmetic, never a substitute for it.
      // The SAME rows the comparison panel renders, and for a multi-image
      // inspection the reconciling rows, so Nemotron reasons over exactly the
      // comparison a judge can read.
      rows: this.comparisonRows(result.elements ?? []),
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

  /**
   * Raw validated provider payload, for persistence.
   *
   * Keyed PER IMAGE, not merged. A stored inspection must be able to say which
   * photograph produced which observation; merging them at write time would
   * destroy exactly the provenance this feature exists to preserve.
   *
   * Null before anything has run. A single image still yields one entry, so the
   * stored shape is uniform and an old single-payload file can be read back.
   */
  getPersistedPayloads(): readonly {
    readonly captureId: string;
    readonly captureLabel: string;
    readonly payload: {
      observations: readonly unknown[];
      elements: readonly unknown[];
      findings: readonly unknown[];
    };
  }[] {
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') return [];
    return this.imageOutcomes.map((image) => ({
      captureId: image.captureId,
      captureLabel: image.captureLabel,
      payload: {
        observations: image.observations.map(toCacheableObservation),
        elements: image.elements,
        findings: image.modelFindings.map(toCacheableFinding),
      },
    }));
  }

  /**
   * The FIRST image's payload, for callers that only ever persisted one image.
   *
   * Kept so the single-image path is untouched. A multi-image inspection is
   * persisted through `getPersistedPayloads()` instead, and never through this,
   * because dropping the other images here would silently lose their evidence.
   */
  getPersistedPayload(): {
    observations: readonly unknown[];
    elements: readonly unknown[];
    findings: readonly unknown[];
  } | null {
    const first = this.getPersistedPayloads()[0];
    return first === undefined ? null : first.payload;
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
    // A stored inspection may hold ONE payload (every inspection written before
    // multi-image) or SEVERAL, one per photograph. Both are read; the per-image
    // payloads are rebuilt separately so each observation keeps the capture it
    // came from, then merged into one consolidated result.
    const sources = record.payloads !== undefined && record.payloads.length > 0
      ? record.payloads
      : [{ captureId: this.capture.id, captureLabel: this.capture.label, payload: record.payload }];

    const rebuilt: InspectionResult[] = [];
    const outcomes: ImageOutcome[] = [];

    for (const source of sources) {
      // A payload naming a capture this session does not hold is refused rather
      // than misattributed: its bytes are unavailable, so its observations would
      // carry an image identity nobody can inspect.
      const capture = this.captures.find((c) => c.id === source.captureId);
      if (capture === undefined) continue;

      const rebuiltOne = this.inspector.rebuildFromPayload(
        {
          provider: record.provider,
          model: record.model,
          observations: source.payload.observations as readonly RawModelObservation[],
          elements: source.payload.elements,
          findings: source.payload.findings,
        },
        {
          image: {
            bytes: capture.bytes,
            mediaType: capture.mediaType,
            captureId: capture.id,
          },
          projectId: this.projectId,
          zoneId: this.zoneId,
          expectedSummary: expectedSummaryFor(this.expected),
        },
      );
      rebuilt.push(rebuiltOne);
      outcomes.push({
        captureId: capture.id,
        captureLabel: capture.label,
        status: 'ANALYSED',
        failure: null,
        elements: rebuiltOne.elements ?? [],
        observations: rebuiltOne.observations,
        modelFindings: rebuiltOne.modelFindings ?? [],
      });
    }

    if (rebuilt.length === 0) return false;

    const merged = mergeImageResults(rebuilt);
    const status = classifyUsableOutput(merged);
    if (status !== 'COMPLETED') return false;

    this.imageOutcomes = outcomes;
    this.outcome = {
      status,
      result: {
        ...merged,
        inferenceOrigin: 'CACHED',
        originalInferenceAt: record.inspectedAt,
        originalLatencyMs: null,
      },
      validationFailures: merged.rejected,
    };
    this.startedAt = Date.parse(record.inspectedAt);
    if (Number.isNaN(this.startedAt)) this.startedAt = Date.parse(record.savedAt);

    this.restoreReviews(record.reviews);
    return true;
  }

  view(): SessionView {
    const outcome = this.outcome;
    // Pixel boxes are only meaningful against the image they came from. With one
    // image this is the historical behaviour; with several, each image's own
    // dimensions are used, so a box drawn over photo 3 is never scaled by photo
    // 1's width.
    const dimensionsByCapture = new Map<string, ReturnType<typeof readImageDimensions>>();
    for (const capture of this.captures) {
      dimensionsByCapture.set(capture.id, readImageDimensions(capture.bytes));
    }
    const dimensions = dimensionsByCapture.get(this.capture.id) ?? null;
    const geometry = readImageGeometry(this.capture.bytes);
    const result: InspectionResult | null =
      outcome !== null && outcome.status !== 'FAILED' && outcome.status !== 'PENDING'
        ? outcome.result
        : null;

    const findings = this.ledger.all();

    // Live observations from EVERY image in this inspection, so a recorded human
    // review on photo 2's finding is not resurrected as UNVERIFIED because only
    // photo 1's store slice was consulted.
    const liveById = new Map<string, AIObservation>();
    for (const capture of this.captures) {
      for (const observation of this.inspector.listObservations(capture.id)) {
        liveById.set(observation.id, observation);
      }
    }
    const dimensionsFor = (captureId: string) => dimensionsByCapture.get(captureId) ?? dimensions;

    const observations: ObservationView[] = (result?.observations ?? []).map(
      (snapshot, index) => {
        const observation = liveById.get(snapshot.id) ?? snapshot;
        const box = observation.evidence.boundingBox;
        // Scaled by the dimensions of the photograph THIS observation came from,
        // so a box from photo 3 is never drawn against photo 1's width.
        const pixelBox = toPixelBox(box, dimensionsFor(observation.captureId));
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
          captureId: observation.captureId,
          captureLabel: this.labelFor(observation.captureId),
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
    // Which photograph produced each reading, indexed by its position in the
    // MERGED element list. Recorded here rather than on DetectedElement because
    // that type is validated model output and must stay exactly what the model
    // returned.
    //
    // The offset RUNS ACROSS photographs. It used to restart at zero inside each
    // one, so a map keyed by that position had two frames that each reported two
    // elements overwrite each other's keys: every detection was then attributed
    // to the last frame that contributed an entry, and the rest silently fell
    // back to the primary capture. A detection read in one photograph was drawn
    // on another, and its evidence box was positioned against the wrong frame's
    // dimensions.
    const detectionCaptureByIndex: string[] = [];
    for (const image of this.imageOutcomes) {
      for (const _ of image.elements) detectionCaptureByIndex.push(image.captureId);
    }
    let detectionCursor = 0;
    const detections: DetectedElementView[] = rawDetections.map((d) => {
      const captureId = detectionCaptureByIndex[detectionCursor] ?? this.capture.id;
      detectionCursor += 1;
      const own = dimensionsFor(captureId);
      const pixelBox = toPixelBox(d.boundingBox, own);
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
        captureId,
        captureLabel: this.labelFor(captureId),
      };
    });

    // Rows exist only alongside a real inspection. With no result there is nothing
    // observed, so producing rows would render every expectation as UNDETERMINED
    // and read like a finding rather than an un-inspected capture.
    //
    // With several photographs this is the RECONCILING comparison, which records
    // which images contributed to each row and refuses to sum counts.
    const rows = result === null ? [] : this.comparisonRows(rawDetections);

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
      // Evidence state, from strongest to weakest. AI findings are validated
      // observations of THIS image, so unlocalised ones are full-frame by
      // construction; comparison findings follow what their row's model
      // actually reported.
      const detectionReported =
        f.origin === 'AI' || (f.comparisonId !== null && detectionReportedByRow.get(f.comparisonId) === true);

      // Source attribution. A COMPARISON finding rests on its row, so it inherits
      // the row's sources. An AI finding came from one image, so it inherits the
      // observation it was derived from — never the group, which would claim
      // photographs did not see it.
      const rowSources = f.comparisonId !== null
        ? (rows.find((r) => r.id === f.comparisonId)?.sourceCaptureIds ?? [])
        : [];
      const sourceCaptureIds = rowSources.length > 0 ? rowSources : [f.captureId];
      const primarySource = sourceCaptureIds[0] as string;

      // Pixel boxes must be scaled by the dimensions of the image they came from.
      const pixelBox = toPixelBox(f.boundingBox, dimensionsFor(primarySource));
      const view: FindingView = {
        ...f,
        verificationStatus: review === null ? 'UNVERIFIED' : review.status,
        review,
        pixelBox,
        localized: pixelBox !== null,
        evidenceState:
          pixelBox !== null ? 'LOCALIZED' : detectionReported ? 'FULL_FRAME' : 'NONE',
        region: f.location,
        sourceCaptureIds,
        sourceCaptureLabels: sourceCaptureIds.map((id) => this.labelFor(id)),
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

    const comparison: ComparisonView[] = rows.map((row) => {
      // The row's box came from whichever image contributed the winning reading.
      // Named explicitly, so a highlight is never drawn against the wrong frame.
      const sourceCaptureId = row.sourceCaptureIds.length > 0
        ? (row.sourceCaptureIds[0] as string)
        : this.capture.id;
      return {
        ...row,
        pixelBox: toPixelBox(row.boundingBox, dimensionsFor(sourceCaptureId)),
        sourceCaptureId,
      };
    });

    // Stage 2, shaped for display. Always an object: an unavailable reasoning
    // stage is reported as such rather than omitted, so the UI can say whether
    // Nemotron contributed or why it did not.
    const reasoningView: ReasoningView = buildReasoningView(this.reasoning, this.reasoner);

    // Two separate claims, deliberately not collapsed. `provenance.eligibility`
    // is the MODEL/STAGE-level fact about the vision model alone; the pipeline
    // view adds the reasoning stage and states the submission-level result.
    const eligibility = classifyEligibility({
      provider: this.provider.name,
      model: this.provider.model,
    });
    const pipelineEligibility = classifyPipelineEligibility({
      visionProvider: this.provider.name,
      visionModel: this.provider.model,
      visionExecuted: outcome !== null && outcome.status !== 'FAILED',
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
      // A partial analysis is stated HERE, at the top level, and not only in
      // `images`. Every per-image status is already reported, but a consumer
      // that reads the headline would otherwise read a 2-of-3 inspection as a
      // clean one and quote complete evidence from a photograph nothing read.
      failure: this.topLevelFailure(outcome),
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
      // Provenance for every offered photograph, failures included.
      images: this.imageProvenance(),
      reasoning: reasoningView,
      pipelineEligibility,
      // Built LAST, from the canonical structures above, and never fed back into
      // them. Presentation only: four languages of the same inspection, shipped
      // together so the browser never has to ask for a second one.
      localized: localizeInspectionAll({
        detections: detections.map((d) => ({
          element: d.element,
          present: d.present,
          count: d.count,
          confidence: d.confidence,
        })),
        expected: { items: this.expected.items },
        comparison,
        inspectionFindings,
        priorities,
        counters,
        isDemoFixture: synthetic,
        // Classification facts only, never the English sentences: the projection
        // re-renders the panel in each language from these.
        qualification: {
          visionModel: this.provider.model,
          reasoningModel: this.reasoner.model,
          visionIsNvidia: pipelineEligibility.stages.some((s) => s.stage === 'VISION' && s.isNvidiaModel),
          reasoningIsNvidia: pipelineEligibility.stages.some((s) => s.stage === 'REASONING' && s.isNvidiaModel),
          visionClassification: pipelineEligibility.vision,
          reasoningClassification: pipelineEligibility.reasoning,
          nvidiaRequirement: pipelineEligibility.nvidiaRequirement,
          qualifyingStage: pipelineEligibility.qualifyingStage,
          platform: pipelineEligibility.platform,
        },
      }),
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
