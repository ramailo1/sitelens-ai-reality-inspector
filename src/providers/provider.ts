// Provider abstraction for the AI Reality Inspector.

import type { RawModelObservation } from '../types/observation.ts';

// A construction image to analyse.
export interface InspectionImage {
  // Raw encoded image bytes (JPEG/PNG).
  readonly bytes: Buffer;
  // IANA media type, e.g. 'image/jpeg'.
  readonly mediaType: string;
  // Stable identifier of the capture this image came from.
  readonly captureId: string;
  // Human-readable label of the capture, carried so every observation can name the photograph it came from.
  readonly captureLabel?: string | undefined;
}

export interface InspectRequest {
  readonly image: InspectionImage;
  // Optional project scope, for provenance. Never sent to the model.
  readonly projectId?: string | null | undefined;
  readonly zoneId?: string | null | undefined;
  // The operator's expected state, rendered as a short plain-text list.
  readonly expectedSummary?: string | null | undefined;
}

// Metadata describing WHICH model/provider produced a result.
export interface ProviderMetadata {
  readonly provider: string;
  readonly model: string;
}

// Raw provider result: a list of UNVALIDATED observations plus provenance.
export interface RawProviderResult extends ProviderMetadata {
  readonly observations: readonly RawModelObservation[];
  // What the model says it can SEE. Unvalidated until the inspector checks it.
  readonly elements: readonly unknown[];
  // Candidate attention areas. Unvalidated until the inspector checks it.
  readonly findings: readonly unknown[];
}

// Why a provider call failed.
export type ProviderFailureKind =
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'MALFORMED_RESPONSE'
  | 'ERROR';

export class ProviderError extends Error {
  public readonly kind: ProviderFailureKind;
  // Safe for logs: never contains the credential or a raw Authorization header.
  public readonly detail: string | undefined;

  constructor(kind: ProviderFailureKind, message: string, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.detail = detail;
  }
}

// The provider contract.
export interface AIProvider {
  // Stable provider identifier, e.g. 'nebius-nvidia'.
  readonly name: string;
  // Exact model identifier this provider will call.
  readonly model: string;
  // Analyse one construction image. @throws {ProviderError} on any failure. Never returns a fabricated result.
  inspect(request: InspectRequest): Promise<RawProviderResult>;
}