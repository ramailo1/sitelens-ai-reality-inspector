// Inspection session.

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
import { buildModelTranslationMap, collectModelProse, translateModelTextsLive } from './model-translation.ts';
import type { ModelTranslationResult, ModelTranslator } from './model-translation.ts';
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

// One element the model reported it can see, with its evidence geometry.
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
  // Which photograph produced this reading.
  readonly captureId: string;
  readonly captureLabel: string;
}

// What the inspected image actually contributes to one finding, stated so the UI can draw exactly what exists and no.
export type EvidenceState = 'LOCALIZED' | 'FULL_FRAME' | 'NONE';

// A finding plus everything the detail view needs to draw its evidence.
export interface FindingView extends Omit<InspectionFinding, 'id'> {
  readonly id: string;
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  readonly localized: boolean;
  // Which of the three evidence states this finding is in; drives the UI copy.
  readonly evidenceState: EvidenceState;
  // Null when the model gave no location and we refuse to invent one.
  readonly region: string | null;
  // Every photograph that supports this finding.
  readonly sourceCaptureIds: readonly string[];
  // Labels for `sourceCaptureIds`, same order, so the UI need not re-resolve.
  readonly sourceCaptureLabels: readonly string[];
}

export interface ComparisonView extends ComparisonRow {
  readonly pixelBox: ReturnType<typeof toPixelBox>;
  // Which photograph this row's box belongs to.
  readonly sourceCaptureId: string | null;
}

// A recorded human decision against an inspection finding.
export interface FindingReview {
  readonly status: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly note: string | null;
}

// The reasoning stage as the UI sees it.
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

// Everything needed to render one observation with its evidence geometry.
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
  // False when the model did not localise this observation.
  readonly localized: boolean;
  readonly findingId: string | null;
  // Which photograph produced this observation.
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
  // VISION-STAGE classification of the vision model alone. Never the verdict.
  readonly eligibility: HackathonEligibility;
  // Stage-scoped explanation of `eligibility`.
  readonly eligibilityNote: string;
  readonly rejectionIssues: readonly ValidationIssue[];
}

// Why an inspection could not produce a complete result.
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

  // WHAT EXISTS ON SITE, as reported by the model.
  readonly detections: readonly DetectedElementView[];
  // The comparison reference in force for this run.
  readonly expected: ExpectedState;
  // REALITY vs EXPECTED, one row per expected item.
  readonly comparison: readonly ComparisonView[];
  // Candidate attention areas, all UNVERIFIED until a human acts.
  readonly inspectionFindings: readonly FindingView[];
  // Where an inspector should look first.
  readonly priorities: readonly InspectionPriority[];
  // The short factual summary.
  readonly brief: RealityBrief;
  // Headline counters for the inspection panel.
  readonly counters: RealityCounters;
  // FRESH AI INFERENCE | CACHED AI RESULT | DEMO FIXTURE.
  readonly inferenceOrigin: InferenceOrigin;
  // Set when CACHED: when the real inference behind this result happened.
  readonly originalInferenceAt: string | null;
  readonly originalLatencyMs: number | null;
  // True when the result came from the deterministic offline fixture.
  readonly isDemoFixture: boolean;
  // EVERY photograph this inspection covers, INCLUDING the ones that failed.
  readonly images: readonly ImageProvenance[];
  // STAGE 2: Nemotron construction reasoning.
  readonly reasoning: ReasoningView;
  // The two model stages plus the submission-level NVIDIA verdict.
  readonly pipelineEligibility: PipelineEligibility;
  // The same inspection, presented in every supported language.
  readonly localized: Readonly<Record<InspectionLanguage, LocalizedInspection>>;
  // Presentation-layer translations of model-authored English prose.
  readonly modelTranslations: Readonly<
    Record<string, Readonly<Record<InspectionLanguage, ModelTranslationResult>>>
  >;
  // Geometry facts about the capture, including any EXIF normalization.
  readonly geometry: {
    readonly storedWidth: number | null;
    readonly storedHeight: number | null;
    readonly displayedWidth: number | null;
    readonly displayedHeight: number | null;
    readonly exifOrientation: number;
    readonly geometryNormalized: boolean;
  };
}

// One photograph's part in a consolidated inspection.
export interface ImageOutcome {
  readonly captureId: string;
  readonly captureLabel: string;
  // FAILED means this photograph contributed nothing.
  readonly status: 'ANALYSED' | 'FAILED';
  readonly failure: string | null;
  readonly elements: readonly DetectedElement[];
  readonly observations: readonly AIObservation[];
  readonly modelFindings: readonly InspectionFinding[];
}

// Dimensions of one capture's stored bytes.
function dimensionsByCaptureOf(target: DemoCapture): ReturnType<typeof readImageDimensions> {
  return readImageDimensions(target.bytes);
}

// The capture's provenance label, as a technical enum the UI can localize.
function sourceLabelFor(capture: DemoCapture): string {
  const source = (capture as { source?: unknown }).source;
  return typeof source === 'string' ? source : 'UPLOAD';
}

// Geometry facts the UI shows so a rotated source file is visible, not hidden.
export interface SessionGeometryView {
  readonly storedWidth: number | null;
  readonly storedHeight: number | null;
  readonly displayedWidth: number | null;
  readonly displayedHeight: number | null;
  readonly exifOrientation: number;
  readonly geometryNormalized: boolean;
}

// One persisted inspection, as read back from disk.
export interface RestoredInspection {
  readonly savedAt: string;
  readonly inspectedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly observationIds?: readonly string[] | undefined;
  readonly payload: {
    readonly observations: readonly unknown[];
    readonly elements: readonly unknown[];
    readonly findings: readonly unknown[];
  };
  // Per-image payloads for a consolidated inspection.
  readonly payloads?: readonly {
    readonly captureId: string;
    readonly captureLabel: string;
    readonly observationIds?: readonly string[] | undefined;
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
  readonly observationReviews?: readonly {
    readonly observationId: string;
    readonly key?: string;
    readonly status: string;
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly note: string | null;
  }[] | undefined;
  readonly ledgerFindings?: readonly {
    readonly id: string;
    readonly sourceObservationId: string;
    readonly captureId: string;
    readonly projectId: string | null;
    readonly zoneId: string | null;
    readonly category: string;
    readonly summary: string;
    readonly evidenceDescription: string;
    readonly suggestedAction: string;
    readonly severity: string;
    readonly raisedBy: string;
    readonly raisedAt: string;
    readonly state: string;
    readonly target: string;
  }[] | undefined;
}

// Shape the stage-2 outcome for display.
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

// A single inspection session over one capture.
export class InspectionSession {
  private readonly inspector: RealityInspector;
  private readonly ledger: FindingLedger;
  // Explicit fields rather than constructor parameter properties: Node's type-stripping loader does not support parameter properties.
  private readonly provider: AIProvider;
  private readonly reasoner: Reasoner;
  // Presentation translator for novel model prose. Null keeps memory-only.
  private readonly translator: ModelTranslator | null;
  // Every photograph in this inspection.
  private readonly captures: readonly DemoCapture[];
  // The first photograph. The single-image identity of this session.
  private readonly capture: DemoCapture;
  private readonly projectId: string | null;
  private readonly projectName: string | null;
  private readonly zoneId: string | null;
  // Per-image outcome of the most recent run.
  private imageOutcomes: readonly ImageOutcome[] = [];
  // The comparison reference. Editable, and always reported back to the UI.
  private expected: ExpectedState;
  private outcome: InspectionOutcome | null = null;
  private startedAt = 0;
  private latencyMs = 0;
  // Human review of an inspection finding, keyed by stable content key.
  private readonly reviewsByKey = new Map<string, FindingReview>();
  // Findings from the most recent view(), so a review can resolve its id.
  private currentFindings: readonly FindingView[] = [];
  // Stage 2 outcome. Cleared whenever the reference changes, because reasoning written against a reference that no longer.
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
      // Presentation-layer translator for novel model prose.
      readonly translator?: ModelTranslator | null;
      // The remaining photographs of a consolidated inspection.
      readonly additionalCaptures?: readonly DemoCapture[];
    },
  ) {
    this.provider = provider;
    this.reasoner = options?.reasoner ?? new UnavailableReasoner({
      kind: 'DISABLED',
      message: 'No construction-reasoning model is attached to this session.',
    });
    this.translator = options?.translator ?? null;
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

  // The photographs this inspection covers, in the order they were supplied.
  public get imageIds(): readonly string[] {
    return this.captures.map((c) => c.id);
  }

  // The project this inspection belongs to, or null when none was named.
  public get project(): string | null {
    return this.projectId;
  }

  // How many real vision calls this inspection makes.
  public get imageCount(): number {
    return this.captures.length;
  }

  // The label of a capture this inspection holds, or its id if unknown.
  private labelFor(captureId: string): string {
    return this.captures.find((c) => c.id === captureId)?.label ?? captureId;
  }

  // The headline failure of this run, partial analysis included.
  private topLevelFailure(
    outcome: InspectionOutcome | null,
  ): { readonly kind: InspectionFailureKind | string; readonly message: string; readonly detail: string | null } | null {
    // PENDING carries no result and therefore no failure. It is a member of the union rather than assumed away.
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

  // Per-image provenance for the view.
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

  // The label the reasoning stage is told it is reasoning over.
  private captureGroupLabel(): string {
    if (this.captures.length <= 1) return this.capture.label;
    return this.captures.map((c) => c.label).join(' + ');
  }

  // Per-image readings, in run order, for the reconciling comparison.
  private imageDetections(): ImageDetections[] {
    return this.imageOutcomes.map((outcome) => ({
      captureId: outcome.captureId,
      captureLabel: outcome.captureLabel,
      detections: outcome.elements,
    }));
  }

  // The comparison rows for this run.
  private comparisonRows(detections: readonly DetectedElement[]): ComparisonRow[] {
    if (this.captures.length <= 1 || this.imageOutcomes.length <= 1) {
      return compareExpectedState(this.expected, detections);
    }
    return compareAcrossImages(this.expected, this.imageDetections());
  }

  // Adopt a new comparison reference, discarding the result it invalidates.
  adoptReference(expected: ExpectedState): void {
    this.expected = expected;
    this.outcome = null;
    this.imageOutcomes = [];
    this.currentFindings = [];
    this.reasoning = null;
    this.reviewsByKey.clear();
    this.ledger.clear();
  }

  // Run the model. Safe to call repeatedly; the last run is what is rendered.
  async run(options: { readonly useCache?: boolean } = {}): Promise<SessionView> {
    this.startedAt = Date.now();
    this.ledger.clear();
    // The deterministic fixture is never served from cache: it costs nothing, and a "cached" label on synthetic data would.
    const useCache = options.useCache === true && this.provider.name !== 'demo-fixture';
    const expectedSummary = expectedSummaryFor(this.expected);

    // ONE real vision call per photograph, in order.
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
            // Provenance only, never sent to the model. It is what lets every observation name the photograph it came from.
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
          // Recorded, not fatal. One unreadable photograph must not discard the evidence the others produced, but it must also.
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

    // "Completed" means the validators accepted something.
    if (results.length === 0) {
      // Every photograph failed. Fail closed: no inspection is invented from images that were never read.
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

    // Stage 2 runs only on a run that produced usable perception.
    if (this.outcome !== null && this.outcome.status !== 'FAILED') {
      this.reasoning = await this.runReasoning();
    } else {
      this.reasoning = null;
    }
    // Presentation translations for whatever novel prose this run produced.
    await this.translateModelProse();
    return this.view();
  }

  // Translate novel model-authored prose for display, once per run.
  private async translateModelProse(): Promise<void> {
    const translator = this.translator;
    if (translator === null || this.provider.name === 'demo-fixture') return;
    const sources = this.collectRunModelProse();
    if (sources.length === 0) return;
    try {
      await translateModelTextsLive(sources, translator);
    } catch {
      // Honest fallback is already the per-entry outcome.
    }
  }

  // The canonical prose of the just-finished run, as exact source strings.
  private collectRunModelProse(): readonly string[] {
    const outcome = this.outcome;
    const result = outcome !== null && 'result' in outcome ? outcome.result : null;
    if (result === null) return [];
    return collectModelProse({
      detections: (result.elements ?? []).map((d) => ({ evidence: d.evidence })),
      observations: result.observations.map((o) => ({
        observation: o.observation,
        evidenceDescription: o.evidence.description,
      })),
      findings: (result.modelFindings ?? []).map((f) => ({
        origin: f.origin,
        title: f.title,
        observation: f.observation,
        reason: f.reason,
        evidence: f.evidence,
        recommendation: f.recommendation,
        location: f.location,
      })),
      reasoning: this.reasoning !== null && this.reasoning.status === 'AVAILABLE'
        ? {
          summary: this.reasoning.reasoning.summary,
          whatMatters: this.reasoning.reasoning.whatMatters,
          rationale: this.reasoning.reasoning.rationale,
          recommendation: this.reasoning.reasoning.recommendation,
          verification: this.reasoning.reasoning.verification,
        }
        : null,
    });
  }

  // STAGE 2: Nemotron construction reasoning over the validated result.
  private async runReasoning(): Promise<ReasoningOutcome> {
    const outcome = this.outcome;
    // PENDING is unreachable in practice (run() only ever assigns a real outcome), but it is a member of the union and.
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
      // The whole set, because the reasoning stage must be told what it is reasoning over.
      captureLabel: this.captureGroupLabel(),
      // How many frames this pass is reasoning over, so the prompt can say so and attribute each observation to one of them.
      imageCount: this.captures.length,
      expected: this.expected,
      detections: result.elements ?? [],
      // The COMBINED validated observations, not one image's.
      observations: result.observations,
      // The SAME rows the comparison panel renders.
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

  // Reattach a reasoning outcome restored from disk.
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

  // The reasoning outcome, for persistence. Null before anything has run.
  getReasoningOutcome(): ReasoningOutcome | null {
    return this.reasoning;
  }

  // Raw validated provider payload, for persistence.
  getPersistedPayloads(): readonly {
    readonly captureId: string;
    readonly captureLabel: string;
    readonly observationIds: readonly string[];
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
      observationIds: image.observations.map((o) => o.id),
      payload: {
        observations: image.observations.map(toCacheableObservation),
        elements: image.elements,
        findings: image.modelFindings.map(toCacheableFinding),
      },
    }));
  }

  // The FIRST image's payload, for callers that only ever persisted one image.
  getPersistedPayload(): {
    observations: readonly unknown[];
    elements: readonly unknown[];
    findings: readonly unknown[];
  } | null {
    const first = this.getPersistedPayloads()[0];
    return first === undefined ? null : first.payload;
  }

  // Observation IDs for the first image's payload, for single-image persistence.
  getPersistedObservationIds(): readonly string[] {
    const first = this.getPersistedPayloads()[0];
    return first === undefined ? [] : first.observationIds;
  }

  // Review records, for persistence.
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

  // Observation review records, for persistence.
  getObservationReviewRecords(): readonly {
    observationId: string;
    key: string;
    status: string;
    reviewer: string;
    reviewedAt: string;
    note: string | null;
  }[] {
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') return [];
    const records: {
      observationId: string;
      key: string;
      status: string;
      reviewer: string;
      reviewedAt: string;
      note: string | null;
    }[] = [];
    for (const snapshot of outcome.result.observations) {
      const live = this.inspector.getObservation(snapshot.id) ?? snapshot;
      if (live.review !== null && live.verificationStatus !== 'UNVERIFIED') {
        records.push({
          observationId: live.id,
          key: `${live.captureId}|${live.category}|${live.observation.trim().toLowerCase()}`,
          status: live.verificationStatus,
          reviewer: live.review.reviewer,
          reviewedAt: live.review.reviewedAt,
          note: live.review.note,
        });
      }
    }
    return records;
  }

  // Ledger findings raised from verified observations, for persistence.
  getLedgerFindings(): readonly Finding[] {
    return this.ledger.all();
  }

  // Snapshot all mutable review and ledger state before a review operation so the session can roll back cleanly if.
  public snapshotReviewState(): {
    readonly reviewsByKey: ReadonlyMap<string, FindingReview>;
    readonly ledgerFindings: readonly Finding[];
    readonly observationReviews: ReadonlyMap<
      string,
      {
        readonly status: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
        readonly reviewer: string;
        readonly reviewedAt: string;
        readonly note: string | null;
      } | null
    >;
  } {
    const observationReviews = new Map<
      string,
      {
        readonly status: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
        readonly reviewer: string;
        readonly reviewedAt: string;
        readonly note: string | null;
      } | null
    >();
    const outcome = this.outcome;
    if (outcome !== null && outcome.status !== 'FAILED' && outcome.status !== 'PENDING') {
      for (const obs of outcome.result.observations) {
        const live = this.inspector.getObservation(obs.id) ?? obs;
        const status = live.verificationStatus;
        observationReviews.set(
          obs.id,
          live.review === null ||
            (status !== 'VERIFIED' && status !== 'REJECTED' && status !== 'NEEDS_REVIEW')
            ? null
            : {
                status,
                reviewer: live.review.reviewer,
                reviewedAt: live.review.reviewedAt,
                note: live.review.note,
              },
        );
      }
    }
    return {
      reviewsByKey: new Map(this.reviewsByKey),
      ledgerFindings: this.ledger.all().map((f) => ({ ...f })),
      observationReviews,
    };
  }

  // Restore review and ledger state captured by `snapshotReviewState()`.
  public rollbackReviewState(snapshot: ReturnType<InspectionSession['snapshotReviewState']>): void {
    this.reviewsByKey.clear();
    for (const [key, value] of snapshot.reviewsByKey.entries()) {
      this.reviewsByKey.set(key, { ...value });
    }
    this.ledger.replaceAll(snapshot.ledgerFindings);
    for (const [obsId, review] of snapshot.observationReviews.entries()) {
      this.inspector.setObservationReviewState(obsId, review);
    }
    this.view();
  }

  // Reapply persisted human decisions by their stable content key.
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

  // Reapply persisted human decisions on observations belonging to this session.
  restoreObservationReviews(
    records: readonly {
      readonly observationId: string;
      readonly key?: string;
      readonly status: string;
      readonly reviewer: string;
      readonly reviewedAt: string;
      readonly note: string | null;
    }[],
  ): void {
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') return;
    for (const record of records) {
      if (record.status !== 'VERIFIED' && record.status !== 'REJECTED' && record.status !== 'NEEDS_REVIEW') {
        continue;
      }
      if (typeof record.reviewer !== 'string' || record.reviewer.trim().length === 0) continue;
      let targetId: string | null = this.hasObservation(record.observationId)
        ? record.observationId
        : null;
      if (targetId === null && typeof record.key === 'string' && record.key.length > 0) {
        const matched = outcome.result.observations.find(
          (o) => `${o.captureId}|${o.category}|${o.observation.trim().toLowerCase()}` === record.key,
        );
        if (matched !== undefined) targetId = matched.id;
      }
      if (targetId === null) continue;
      this.inspector.setObservationReviewState(targetId, {
        status: record.status,
        reviewer: record.reviewer.trim(),
        reviewedAt: record.reviewedAt,
        note: record.note,
      });
    }
  }

  // Reapply persisted ledger findings raised from verified observations in this session.
  restoreLedgerFindings(
    records: readonly {
      readonly id: string;
      readonly sourceObservationId: string;
      readonly captureId: string;
      readonly projectId: string | null;
      readonly zoneId: string | null;
      readonly category: string;
      readonly summary: string;
      readonly evidenceDescription: string;
      readonly suggestedAction: string;
      readonly severity: string;
      readonly raisedBy: string;
      readonly raisedAt: string;
      readonly state: string;
      readonly target: string;
    }[],
  ): void {
    this.ledger.clear();
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') return;

    const recordByObs = new Map(
      records
        .filter(
          (r) =>
            typeof r.id === 'string' &&
            r.id.length > 0 &&
            (r.state === 'OPEN' || r.state === 'ACKNOWLEDGED' || r.state === 'CLOSED'),
        )
        .map((r) => [r.sourceObservationId, r] as const),
    );

    for (const snapshot of outcome.result.observations) {
      const live = this.inspector.getObservation(snapshot.id) ?? snapshot;
      if (live.verificationStatus !== 'VERIFIED' || live.review === null) continue;
      const built = findingFrom(live);
      if (!built.ok) continue;
      const persisted = recordByObs.get(live.id);
      if (persisted !== undefined) {
        this.ledger.add({
          ...built.finding,
          id: persisted.id,
          state: persisted.state as Finding['state'],
          raisedAt: persisted.raisedAt,
        });
      } else {
        this.ledger.add(built.finding);
      }
    }
  }

  // Record a human decision.
  review(input: {
    readonly observationId: string;
    readonly decision: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
    readonly reviewer: string;
    readonly note?: string | null;
  }): SessionView {
    if (!this.hasObservation(input.observationId)) {
      return this.view();
    }
    const updated = this.inspector.reviewObservation({
      observationId: input.observationId,
      decision: input.decision,
      reviewer: input.reviewer,
      note: input.note ?? null,
    });

    if (updated !== null) {
      if (input.decision === 'VERIFIED') {
        const existing = this.ledger.findByObservation(updated.id);
        const result = findingFrom(updated);
        if (result.ok) {
          this.ledger.add(
            existing === null
              ? result.finding
              : {
                  ...result.finding,
                  id: existing.id,
                  state: existing.state,
                  raisedAt: existing.raisedAt,
                },
          );
        }
      } else {
        this.ledger.removeByObservation(updated.id);
      }
    }

    return this.view();
  }

  // Resolve the inspection finding a caller means by this id.
  private resolveInspectionFinding(findingId: string): FindingView | null {
    const rendered = this.view().inspectionFindings.find((f) => f.id === findingId);
    return rendered === undefined ? null : rendered;
  }

  // Whether this inspection currently holds a finding with this id.
  public hasInspectionFinding(findingId: string): boolean {
    return this.resolveInspectionFinding(findingId) !== null;
  }

  // Whether this inspection currently holds an observation with this id.
  public hasObservation(observationId: string): boolean {
    const outcome = this.outcome;
    if (outcome === null || outcome.status === 'FAILED' || outcome.status === 'PENDING') {
      return false;
    }
    return outcome.result.observations.some((o) => o.id === observationId);
  }

  // Record a human decision against an inspection finding.
  reviewFinding(input: {
    readonly findingId: string;
    readonly decision: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
    readonly reviewer: string;
    readonly note?: string | null | undefined;
  }): SessionView {
    if (typeof input.reviewer !== 'string' || input.reviewer.trim().length === 0) {
      return this.view();
    }
    // Find the finding by the id the UI currently holds, then remember the decision under its stable key so it survives the.
    const current = this.resolveInspectionFinding(input.findingId);
    if (current === null) return this.view();

    this.reviewsByKey.set(
      `${current.origin}|${current.comparisonId ?? ''}|${current.title.trim().toLowerCase()}`,
      {
        status: input.decision,
        reviewer: input.reviewer.trim(),
        reviewedAt: new Date().toISOString(),
        note: input.note ?? null,
      },
    );

    // A VERIFIED inspection finding is recorded in the session's own audit trail above.
    return this.view();
  }
  // Reopen a previously persisted inspection, WITHOUT calling any model.
  restoreInspection(record: RestoredInspection): boolean {
    // A stored inspection may hold ONE payload (every inspection written before multi-image) or SEVERAL, one per photograph.
    const sources: readonly {
      readonly captureId: string;
      readonly captureLabel: string;
      readonly observationIds?: readonly string[] | undefined;
      readonly payload: {
        readonly observations: readonly unknown[];
        readonly elements: readonly unknown[];
        readonly findings: readonly unknown[];
      };
    }[] = record.payloads !== undefined && record.payloads.length > 0
      ? record.payloads
      : [{
          captureId: this.capture.id,
          captureLabel: this.capture.label,
          observationIds: record.observationIds,
          payload: record.payload,
        }];

    const rebuilt: InspectionResult[] = [];
    const outcomes: ImageOutcome[] = [];

    for (const source of sources) {
      // A payload naming a capture this session does not hold is refused rather than misattributed: its bytes are.
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
          observationIds: source.observationIds,
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
    this.restoreObservationReviews(record.observationReviews ?? []);
    this.restoreLedgerFindings(record.ledgerFindings ?? []);
    return true;
  }

  view(): SessionView {
    const outcome = this.outcome;
    // Pixel boxes are only meaningful against the image they came from.
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

    // Live observations from EVERY image in this inspection, so a recorded human review on photo 2's finding is not.
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
        // Scaled by the dimensions of the photograph THIS observation came from, so a box from photo 3 is never drawn against.
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

    // Every rejection from BOTH validators.
    const rejectionIssues: ValidationIssue[] = [
      ...(result?.rejected ?? []).flatMap((entry) => entry.issues),
      ...(result?.rejectedInspection ?? []).flatMap((entry) => entry.issues),
    ];

    const rawDetections: readonly DetectedElement[] = result?.elements ?? [];
    // Which photograph produced each reading, indexed by its position in the MERGED element list.
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

    // Rows exist only alongside a real inspection.
    const rows = result === null ? [] : this.comparisonRows(rawDetections);

    // Whether the model reported anything at all for each row's element.
    const detectionReportedByRow = new Map(rows.map((r) => [r.id, r.detectionReported] as const));

    // `synthetic` is true whenever the deterministic offline provider ran, so a fixture result can never be presented as model inference.
    const synthetic = this.provider.name === 'demo-fixture';
    const synthesized = synthesizeFindings({
      captureId: this.capture.id,
      expected: this.expected,
      detections: rawDetections,
      modelFindings: result?.modelFindings ?? [],
      rows,
      synthetic,
    });

    // Human decisions are the authority, so a re-render must not resurrect a reviewed finding as UNVERIFIED.
    const stableKey = (f: InspectionFinding): string =>
      `${f.origin}|${f.comparisonId ?? ''}|${f.title.trim().toLowerCase()}`;

    const inspectionFindings: FindingView[] = synthesized.map((f) => {
      const review = this.reviewsByKey.get(stableKey(f)) ?? null;
      // Evidence state, from strongest to weakest.
      const detectionReported =
        f.origin === 'AI' || (f.comparisonId !== null && detectionReportedByRow.get(f.comparisonId) === true);

      // Source attribution. A COMPARISON finding rests on its row, so it inherits the row's sources.
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
    // Remembered so reviewFinding() can resolve the id the browser is holding without re-entering the synthesis path.
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
      const sourceCaptureId = row.sourceCaptureIds.length > 0
        ? (row.sourceCaptureIds[0] as string)
        : this.capture.id;
      return {
        ...row,
        pixelBox: toPixelBox(row.boundingBox, dimensionsFor(sourceCaptureId)),
        sourceCaptureId,
      };
    });

    // Stage 2, shaped for display.
    const reasoningView: ReasoningView = buildReasoningView(this.reasoning, this.reasoner);

    // Two separate claims, deliberately not collapsed.
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
      // True whenever the model was actually invoked, which is the case for every outcome except a transport or configuration failure.
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

    // Presentation-layer translations of model-authored English.
    const modelTranslations = buildModelTranslationMap(
      collectModelProse({
        detections: detections.map((d) => ({ evidence: d.evidence })),
        observations: observations.map((o) => ({
          observation: o.observation,
          evidenceDescription: o.evidenceDescription,
        })),
        findings: inspectionFindings.map((f) => ({
          origin: f.origin,
          title: f.title,
          observation: f.observation,
          reason: f.reason,
          evidence: f.evidence,
          recommendation: f.recommendation,
          location: f.location,
        })),
        reasoning: reasoningView.status === 'AVAILABLE' && reasoningView.reasoning !== null
          ? {
              summary: reasoningView.reasoning.summary,
              whatMatters: reasoningView.reasoning.whatMatters,
              rationale: reasoningView.reasoning.rationale,
              recommendation: reasoningView.reasoning.recommendation,
              verification: reasoningView.reasoning.verification,
            }
          : null,
      })
    );

    return {
      outcome: outcome?.status ?? 'PENDING',
      provenance,
      observations,
      findings,
      // A partial analysis is stated HERE, at the top level, and not only in `images`.
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
      // Built LAST, from the canonical structures above, and never fed back into them.
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
        // Classification facts only, never the English sentences: the projection re-renders the panel in each language from these.
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
      modelTranslations,
      geometry: {
        storedWidth: geometry?.stored.width ?? null,
        storedHeight: geometry?.stored.height ?? null,
        displayedWidth: geometry?.displayed.width ?? null,
        displayedHeight: geometry?.displayed.height ?? null,
        // 1 means "no rotation". Reported so a rotated source file is visible rather than quietly corrected.
        exifOrientation: geometry?.orientation ?? 1,
        geometryNormalized: geometry !== null && !geometry.normalized,
      },
    };
  }

  setFindingState(id: string, state: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED'): SessionView {
    this.ledger.setState(id, state);
    return this.view();
  }

  // Whether this session's finding ledger holds a finding with this id.
  public hasLedgerFinding(findingId: string): boolean {
    return this.ledger.get(findingId) !== null;
  }

  // Whether this capture has actually been inspected.
  inspected(): boolean {
    return this.outcome !== null && this.outcome.status !== 'PENDING';
  }

  getLedger(): FindingLedger {
    return this.ledger;
  }
}
