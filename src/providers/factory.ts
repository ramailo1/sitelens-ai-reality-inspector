/**
 * Provider selection via AI_PROVIDER: `nebius` (default) or `demo`.
 *
 * There is no silent fallback. If nebius is selected without a credential the
 * caller gets NOT_CONFIGURED rather than a demo result that would misrepresent
 * which model ran.
 */

import type { AIProvider } from './provider.ts';
import { NebiusNvidiaProvider } from './nebius-nvidia.provider.ts';
import { DemoFixtureProvider } from './demo-fixture.provider.ts';
import { ProviderError } from './provider.ts';

export const AI_PROVIDER_VALUES = ['nebius', 'demo'] as const;
export type AIProviderName = (typeof AI_PROVIDER_VALUES)[number];

export function isAIProviderName(value: unknown): value is AIProviderName {
  return typeof value === 'string' && (AI_PROVIDER_VALUES as readonly string[]).includes(value);
}

/**
 * Build the configured provider.
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

export { NebiusNvidiaProvider, DemoFixtureProvider, ProviderError };
export type { AIProvider };