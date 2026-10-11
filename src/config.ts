// Environment configuration, read from process.env only.

import { ProviderError } from './providers/provider.ts';

// Public configuration. Contains no secrets by construction.
export interface ProviderConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxObservations: number;
  // Upper bound on the completion length.
  readonly maxTokens: number;
}

// Secret material, kept separate so it is never logged or serialised.
export interface ResolvedCredentials {
  readonly apiKey: string;
}

// The documented default endpoint (OpenAI-compatible Token Factory).
export const DEFAULT_NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';

// Default vision model.
export const DEFAULT_NEBIUS_MODEL = 'openbmb/MiniCPM-V-4_5';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OBSERVATIONS = 6;

// Completion budget. 1400 was the old default and it truncated MiniCPM mid-JSON on real site photographs.
const DEFAULT_MAX_TOKENS = 3000;

// Config used when a provider is explicitly selected but unset.
export function defaultProviderConfig(): ProviderConfig {
  return {
    baseUrl: DEFAULT_NEBIUS_BASE_URL,
    model: DEFAULT_NEBIUS_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxObservations: DEFAULT_MAX_OBSERVATIONS,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

// Reasoning-stage configuration: the SECOND model in the hybrid architecture.
export interface ReasoningConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  // False when reasoning is switched off entirely for this run.
  readonly enabled: boolean;
}

// Default reasoning model.
export const DEFAULT_REASONING_MODEL = 'nvidia/Nemotron-3-Ultra-550b-a55b';

// Completion budget for the reasoning stage.
const DEFAULT_REASONING_MAX_TOKENS = 2000;

// Reasoner deadline. Slightly longer than vision, because it must think first.
const DEFAULT_REASONING_TIMEOUT_MS = 90_000;

// Config used when reasoning is enabled but nothing is set explicitly.
export function defaultReasoningConfig(): ReasoningConfig {
  return {
    baseUrl: DEFAULT_NEBIUS_BASE_URL,
    model: DEFAULT_REASONING_MODEL,
    timeoutMs: DEFAULT_REASONING_TIMEOUT_MS,
    maxTokens: DEFAULT_REASONING_MAX_TOKENS,
    enabled: true,
  };
}

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  const lower = raw.toLowerCase();
  if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
  if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off') return false;
  return fallback;
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

// Resolve non-secret provider configuration from the environment.
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

// Only Nebius Token Factory endpoints are accepted.
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

// Resolve non-secret reasoning configuration from the environment.
export function resolveReasoningConfig(env: NodeJS.ProcessEnv = process.env): ReasoningConfig {
  const defaults = defaultReasoningConfig();

  const rawBaseUrl = readString(env, 'NEBIUS_REASONING_BASE_URL') ?? readString(env, 'NEBIUS_BASE_URL') ?? defaults.baseUrl;
  const baseUrl = isAllowedNebiusHost(rawBaseUrl) ? rawBaseUrl : defaults.baseUrl;

  return {
    baseUrl,
    model: readString(env, 'NEBIUS_REASONING_MODEL') ?? defaults.model,
    timeoutMs: readPositiveInt(env, 'NEBIUS_REASONING_TIMEOUT_MS', defaults.timeoutMs, {
      min: 1_000,
      max: 300_000,
    }),
    maxTokens: readPositiveInt(env, 'NEBIUS_REASONING_MAX_TOKENS', defaults.maxTokens, {
      min: 256,
      max: 16_000,
    }),
    enabled: readBoolean(env, 'REASONING_ENABLED', defaults.enabled),
  };
}

// Resolve the API key. THROWS ProviderError(NOT_CONFIGURED) when absent — the caller must fail closed rather than.
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

// Redact secrets from any text before it is logged or returned.
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