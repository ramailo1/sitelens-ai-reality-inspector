/**
 * Provider selection via AI_PROVIDER: `nebius` (default) or `demo`.
 *
 * There is no silent fallback. If nebius is selected without a credential the
 * caller gets NOT_CONFIGURED rather than a demo result that would misrepresent
 * which model ran.
 *
 * The factory also builds the SECOND stage: the Nemotron construction reasoner.
 * The two are separate objects with separate configuration because they do
 * genuinely different jobs, and because a missing reasoner must be expressible
 * as an explicit unavailable state rather than a crash.
 */

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

/**
 * Build the configured vision provider.
 * Defaults to `nebius` so the hackathon requirement path is the default path.
 */
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

/**
 * Build the configured construction reasoner.
 *
 * Three outcomes, all explicit and all visible to the user:
 *
 *   DEMO_FIXTURE_REASONING  the offline path has no second model, and inventing
 *                           one would be fabricating a pipeline stage.
 *   DISABLED                REASONING_ENABLED is off: the comparison still works.
 *   NemotronReasoner        the real NVIDIA reasoning stage.
 *
 * A missing credential is NOT resolved here: the reasoner is constructed anyway
 * and reports NOT_CONFIGURED per inspection, so the UI can say why reasoning is
 * absent instead of the product silently running with one fewer stage.
 */
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
