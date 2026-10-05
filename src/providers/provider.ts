/**
 * Provider abstraction for the AI Reality Inspector.
 *
 * The inspector depends on this interface only, so endpoints and credentials
 * stay out of the rest of the codebase. Providers return raw, unvalidated
 * output; validation belongs to the inspector so every provider is held to the
 * same trust boundary.
 */

import type { RawModelObservation } from '../types/observation.ts';

/** A construction image to analyse. */
export interface InspectionImage {
  /** Raw encoded image bytes (JPEG/PNG). */
  readonly bytes: Buffer;
  /** IANA media type, e.g. 'image/jpeg'. */
  readonly mediaType: string;
  /** Stable identifier of the capture this image came from. */
  readonly captureId: string;
}

export interface InspectRequest {
  readonly image: InspectionImage;
  /** Optional project scope, for provenance. Never sent to the model. */
  readonly projectId?: string | null | undefined;
  readonly zoneId?: string | null | undefined;
  /**
   * The operator's expected state, rendered as a short plain-text list.
   * Sent as LOOK-FOR context only: the provider never compares, and the
   * deterministic comparison happens back in the inspector.
   */
  readonly expectedSummary?: string | null | undefined;
}

/** Metadata describing WHICH model/provider produced a result. */
export interface ProviderMetadata {
  readonly provider: string;
  readonly model: string;
}

/**
 * Raw provider result: a list of UNVALIDATED observations plus provenance.
 * The inspector validates every element strictly before anything is shown.
 */
export interface RawProviderResult extends ProviderMetadata {
  readonly observations: readonly RawModelObservation[];
  /** What the model says it can SEE. Unvalidated until the inspector checks it. */
  readonly elements: readonly unknown[];
  /** Candidate attention areas. Unvalidated until the inspector checks it. */
  readonly findings: readonly unknown[];
}

/**
 * Why a provider call failed. Every failure is explicit — the inspector must
 * never fabricate a result when a provider fails.
 */
export type ProviderFailureKind =
  | 'NOT_CONFIGURED' // no API key / not enabled
  | 'TIMEOUT'        // deadline exceeded
  | 'UNAVAILABLE'    // network / 5xx
  | 'AUTHENTICATION' // 401/403 — bad or missing credential
  | 'RATE_LIMITED'   // 429
  | 'MALFORMED_RESPONSE' // provider answered, but not in the agreed shape
  | 'ERROR';         // anything else

export class ProviderError extends Error {
  public readonly kind: ProviderFailureKind;
  /** Safe for logs: never contains the credential or a raw Authorization header. */
  public readonly detail: string | undefined;

  constructor(kind: ProviderFailureKind, message: string, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * The provider contract. Implementations MUST throw `ProviderError` on every
 * failure path and MUST NOT return partial or invented results.
 */
export interface AIProvider {
  /** Stable provider identifier, e.g. 'nebius-nvidia'. */
  readonly name: string;
  /** Exact model identifier this provider will call. */
  readonly model: string;
  /**
   * Analyse one construction image.
   * @throws {ProviderError} on any failure. Never returns a fabricated result.
   */
  inspect(request: InspectRequest): Promise<RawProviderResult>;
}