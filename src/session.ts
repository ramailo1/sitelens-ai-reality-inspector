/**
 * Inspection session.
 *
 * Wraps the inspector, the finding ledger and the capture metadata into the
 * single record the UI and the CLI both render, so provenance is produced once
 * and cannot drift between them.
 *
 * The record always states which model ran, what image was inspected, how many
 * observations survived validation and what the trust state is - including when
 * the run produced nothing at all. A zero-result inspection must never be
 * mistaken for a run that never happened.
 */

import { RealityInspector } from './inspector.ts';
import type { InspectionOutcome, InspectionResult } from './inspector.ts';
import type { AIProvider } from './providers/provider.ts';
import { classifyEligibility, describeEligibility } from './eligibility.ts';
import type { HackathonEligibility } from './eligibility.ts';
import { findingFrom, FindingLedger } from './findings.ts';
import type { Finding } from './findings.ts';
import { readImageDimensions, toPixelBox } from './image-metadata.ts';
import type { AIObservation, ValidationIssue } from './types/observation.ts';
import type { DemoCapture } from './captures.ts';
import { demoCaptures } from './captures.ts';

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
}

/** Minimal structural view of a provider, so sessions are testable. */
export type AIProviderLike = AIProvider;

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
  private readonly provider: AIProviderLike;
  private readonly capture: DemoCapture;
  private readonly projectId: string | null;
  private readonly zoneId: string | null;
  private outcome: InspectionOutcome | null = null;
  private startedAt = 0;
  private latencyMs = 0;

  public constructor(
    provider: AIProviderLike,
    capture: DemoCapture,
    projectId: string | null,
    zoneId: string | null,
  ) {
    this.provider = provider;
    this.capture = capture;
    this.projectId = projectId;
    this.zoneId = zoneId;
    this.inspector = new RealityInspector({ provider });
    this.ledger = new FindingLedger();
  }

  /** Run the model. Safe to call repeatedly; the last run is what is rendered. */
  async run(): Promise<SessionView> {
    this.startedAt = Date.now();
    this.outcome = await this.inspector.inspect({
      image: {
        bytes: this.capture.bytes,
        mediaType: this.capture.mediaType,
        captureId: this.capture.id,
      },
      projectId: this.projectId,
      zoneId: this.zoneId,
    });
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

  /** Render the current state without re-running inference. */
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
      humanReviewPerformed: observations.some((o) => o.review !== null),
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
    };
  }

  setFindingState(id: string, state: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED'): SessionView {
    this.ledger.setState(id, state);
    return this.view();
  }

  getLedger(): FindingLedger {
    return this.ledger;
  }
}

export interface CaptureSummary {
  readonly id: string;
  readonly label: string;
  readonly content: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly mediaType: string;
}

/** Capture catalogue for the UI, without shipping the image bytes. */
export function listCaptures(): CaptureSummary[] {
  return demoCaptures().map((c) => ({
    id: c.id,
    label: c.label,
    content: c.content,
    width: c.dimensions.width,
    height: c.dimensions.height,
    byteLength: c.bytes.length,
    mediaType: c.mediaType,
  }));
}

export function findCapture(id: string): DemoCapture | null {
  return demoCaptures().find((c) => c.id === id) ?? null;
}