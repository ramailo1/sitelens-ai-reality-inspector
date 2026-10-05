/**
 * Environment configuration, read from process.env only. Secrets are never
 * written to disk or logged.
 *
 * Missing credentials fail closed: the provider reports NOT_CONFIGURED rather
 * than falling back to an anonymous or demo mode.
 */

import { ProviderError } from './providers/provider.ts';

/** Public configuration. Contains no secrets by construction. */
export interface ProviderConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxObservations: number;
  /**
   * Upper bound on the completion length. Essential rather than cosmetic: some
   * catalogue models are reasoning models that will otherwise consume the entire
   * request deadline emitting tokens and never return the JSON object.
   */
  readonly maxTokens: number;
}

/** Secret material, kept separate so it is never logged or serialised. */
export interface ResolvedCredentials {
  readonly apiKey: string;
}

/** The documented default endpoint (OpenAI-compatible Token Factory). */
export const DEFAULT_NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';

/**
 * Default vision model.
 *
 * Chosen by measurement, not preference: a bake-off of the three
 * vision-capable models in the catalogue over five real construction
 * photographs, at NEBIUS_MAX_TOKENS=3000, judged by this repository's own
 * validators. MiniCPM returned usable output on 4/5 images against 2/5 for
 * gemma-3-27b-it and 1/5 for Qwen3.8-27B, and produced the elements and findings
 * the rest of the pipeline reasons about. See README for the full table.
 *
 * Not an NVIDIA model. Every nvidia/* id in the catalogue was probed with real
 * image input and all returned `HTTP 400 This model does not support image
 * input`, so eligibility is reported as NOT_ELIGIBLE rather than claimed.
 */
export const DEFAULT_NEBIUS_MODEL = 'openbmb/MiniCPM-V-4_5';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OBSERVATIONS = 6;

/**
 * Completion budget.
 *
 * 1400 was the old default and it truncated MiniCPM mid-JSON on real site
 * photographs. A sweep across the test images showed 3000 removes the
 * truncation while staying tight enough that the model does not pad its answer.
 * Reasoning models such as Qwen3.8-27B need >=6000; they spend thousands of
 * tokens reasoning before they answer, which is why they are not the default.
 */
const DEFAULT_MAX_TOKENS = 3000;

/** Config used when a provider is explicitly selected but unset. */
export function defaultProviderConfig(): ProviderConfig {
  return {
    baseUrl: DEFAULT_NEBIUS_BASE_URL,
    model: DEFAULT_NEBIUS_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxObservations: DEFAULT_MAX_OBSERVATIONS,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  if (parsed < bounds.min || parsed > bounds.max) return fallback;
  return parsed;
}

/**
 * Resolve non-secret provider configuration from the environment.
 * A malformed base URL falls back to the documented default rather than
 * producing a request to an unintended host.
 */
export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const defaults = defaultProviderConfig();

  const rawBaseUrl = readString(env, 'NEBIUS_BASE_URL') ?? defaults.baseUrl;
  const baseUrl = isAllowedNebiusHost(rawBaseUrl) ? rawBaseUrl : defaults.baseUrl;

  return {
    baseUrl,
    model: readString(env, 'NEBIUS_MODEL') ?? defaults.model,
    timeoutMs: readPositiveInt(env, 'NEBIUS_TIMEOUT_MS', defaults.timeoutMs, {
      min: 1_000,
      max: 300_000,
    }),
    maxObservations: readPositiveInt(env, 'AI_MAX_OBSERVATIONS', defaults.maxObservations, {
      min: 1,
      max: 20,
    }),
    maxTokens: readPositiveInt(env, 'NEBIUS_MAX_TOKENS', defaults.maxTokens, {
      min: 256,
      max: 16_000,
    }),
  };
}

/**
 * Only Nebius Token Factory endpoints are accepted. This prevents a
 * misconfigured base URL from shipping construction imagery to an unintended
 * host, and blocks obvious credential-exfiltration targets.
 */
function isAllowedNebiusHost(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'tokenfactory.nebius.com' || host.endsWith('.nebius.com');
}

/**
 * Resolve the API key. THROWS ProviderError(NOT_CONFIGURED) when absent — the
 * caller must fail closed rather than continue without a credential.
 *
 * The key is returned alone and is never logged.
 */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): ResolvedCredentials {
  const apiKey = readString(env, 'NEBIUS_API_KEY');
  if (apiKey === null) {
    throw new ProviderError(
      'NOT_CONFIGURED',
      'NEBIUS_API_KEY is not set. The AI Reality Inspector cannot run without a Nebius Token Factory credential.',
    );
  }
  return { apiKey };
}

/**
 * Redact secrets from any text before it is logged or returned.
 * Defence in depth: a masked credential never reaches a log line.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const apiKey = readString(env, 'NEBIUS_API_KEY');
  if (apiKey !== null && apiKey.length >= 8) {
    out = out.split(apiKey).join('[REDACTED]');
  }
  // Defence in depth: strip anything that looks like a bearer token.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]');
  return out;
}