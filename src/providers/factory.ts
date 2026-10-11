// Provider selection via AI_PROVIDER: `nebius` (default) or `demo`.

import type { AIProvider } from './provider.ts';
import { NebiusNvidiaProvider } from './nebius-nvidia.provider.ts';
import { DemoFixtureProvider } from './demo-fixture.provider.ts';
import { ProviderError } from './provider.ts';
import type { Reasoner } from './nemotron-reasoner.ts';
import { NemotronReasoner, UnavailableReasoner, safeResolveReasoningCredentials } from './nemotron-reasoner.ts';
import { resolveReasoningConfig } from '../config.ts';
import type { FetchLike } from './nebius-nvidia.provider.ts';

export const AI_PROVIDER_VALUES = ['nebius', 'demo'] as const;
export type AIProviderName = (typeof AI_PROVIDER_VALUES)[number];

export function isAIProviderName(value: unknown): value is AIProviderName {
  return typeof value === 'string' && (AI_PROVIDER_VALUES as readonly string[]).includes(value);
}

// Build the configured vision provider. Defaults to `nebius` so the hackathon requirement path is the default path.
export function createProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const raw = (env['AI_PROVIDER'] ?? 'nebius').trim().toLowerCase();

  if (!isAIProviderName(raw)) {
    throw new ProviderError(
      'ERROR',
      `AI_PROVIDER must be one of [${AI_PROVIDER_VALUES.join(', ')}] (received '${raw}').`,
    );
  }

  return raw === 'demo' ? new DemoFixtureProvider() : new NebiusNvidiaProvider({ env });
}

// Build the configured construction reasoner.
export function createReasoner(
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly fetchImpl?: FetchLike } = {},
): Reasoner {
  const provider = (env['AI_PROVIDER'] ?? 'nebius').trim().toLowerCase();

  if (provider === 'demo') {
    return new UnavailableReasoner({
      kind: 'DISABLED',
      message:
        'The deterministic offline fixture has no construction-reasoning model, so no reasoning '
        + 'was produced. Everything shown is synthetic fixture content, not AI inference.',
    });
  }

  const config = resolveReasoningConfig(env);
  if (!config.enabled) {
    return new UnavailableReasoner({
      kind: 'DISABLED',
      message: 'Construction reasoning is switched off (REASONING_ENABLED=false) for this run.',
      model: config.model,
    });
  }

  const credentials = safeResolveReasoningCredentials(env);
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit));

  return new NemotronReasoner({ config, credentials, fetchImpl, env });
}

export { NebiusNvidiaProvider, DemoFixtureProvider, ProviderError };
export { NemotronReasoner, UnavailableReasoner };
export type { AIProvider, Reasoner };
