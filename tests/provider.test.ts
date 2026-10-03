/**
 * Provider and inspector tests: missing API key, Nebius HTTP failures,
 * malformed model output, timeout, request validation, and human verification.
 * fetchImpl is always injected, so no test performs real network I/O.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NebiusNvidiaProvider,
  DemoFixtureProvider,
  ProviderError,
  createProvider,
} from '../src/providers/factory.ts';
import { RealityInspector } from '../src/inspector.ts';
import { redactSecrets, resolveCredentials, resolveProviderConfig } from '../src/config.ts';

const IMAGE = {
  bytes: Buffer.from('fake-jpeg-bytes'),
  mediaType: 'image/jpeg',
  captureId: 'cap_test_001',
};

/** Build a provider with a stubbed fetch that returns one HTTP response. */
function makeProvider(options: {
  status?: number;
  body?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return {
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      text: async () => options.body ?? '',
    };
  };
  const provider = new NebiusNvidiaProvider({
    env: options.env ?? { NEBIUS_API_KEY: 'test-key-1234567890' },
    fetchImpl,
  });
  return { provider, calls };
}

/** A valid OpenAI-compatible envelope wrapping the given content string. */
function envelope(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

const VALID_CONTENT = JSON.stringify({
  observations: [
    {
      category: 'OBSERVED_ELEMENT',
      observation: 'A steel frame is visible.',
      evidence: { description: 'Vertical steel members.' },
      confidence: 0.8,
      severity: 'INFO',
      suggested_action: 'NO_ACTION',
    },
  ],
});

// Missing credential

test('missing API key fails closed with NOT_CONFIGURED and calls nothing', async () => {
  let called = false;
  const provider = new NebiusNvidiaProvider({
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => envelope(VALID_CONTENT) };
    },
  });

  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'NOT_CONFIGURED');
      return true;
    },
  );
  assert.equal(called, false, 'no network call may be made without a credential');
});

test('resolveCredentials throws NOT_CONFIGURED when the key is absent', () => {
  assert.throws(() => resolveCredentials({}), ProviderError);
});

test('an empty or whitespace key is treated as absent', () => {
  assert.throws(() => resolveCredentials({ NEBIUS_API_KEY: '   ' }), ProviderError);
});

// Request validation

test('rejects an empty image', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  await assert.rejects(
    () => provider.inspect({ image: { ...IMAGE, bytes: Buffer.alloc(0) } }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'ERROR');
      return true;
    },
  );
});

test('rejects a non-image media type', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  await assert.rejects(
    () => provider.inspect({ image: { ...IMAGE, mediaType: 'application/pdf' } }),
    ProviderError,
  );
});

// Nebius HTTP failure mapping

test('HTTP 401 maps to AUTHENTICATION and does not leak the key', async () => {
  const { provider } = makeProvider({
    status: 401,
    body: 'invalid token test-key-1234567890',
    env: { NEBIUS_API_KEY: 'test-key-1234567890' },
  });

  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'AUTHENTICATION');
      assert.ok(!(error.message ?? '').includes('test-key-1234567890'));
      assert.ok(!(error.detail ?? '').includes('test-key-1234567890'), 'detail must be redacted');
      return true;
    },
  );
});

test('HTTP 429 maps to RATE_LIMITED', async () => {
  const { provider } = makeProvider({ status: 429, body: 'slow down' });
  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'RATE_LIMITED');
      return true;
    },
  );
});

test('HTTP 503 maps to UNAVAILABLE', async () => {
  const { provider } = makeProvider({ status: 503, body: 'down' });
  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'UNAVAILABLE');
      return true;
    },
  );
});

test('a network error maps to UNAVAILABLE', async () => {
  const provider = new NebiusNvidiaProvider({
    env: { NEBIUS_API_KEY: 'test-key-1234567890' },
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'UNAVAILABLE');
      return true;
    },
  );
});

test('a slow provider is aborted at the deadline and reports TIMEOUT', async () => {
  const provider = new NebiusNvidiaProvider({
    env: { NEBIUS_API_KEY: 'test-key-1234567890', NEBIUS_TIMEOUT_MS: '1000' },
    fetchImpl: async (_url, init) => {
      // Never settles on its own; the provider's deadline must abort it.
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    },
  });

  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'TIMEOUT');
      return true;
    },
  );
});

// Malformed model output

test('non-JSON response is MALFORMED_RESPONSE, not an empty result', async () => {
  const { provider } = makeProvider({ body: 'not json at all' });
  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'MALFORMED_RESPONSE');
      return true;
    },
  );
});

test('valid JSON without an observations array is MALFORMED_RESPONSE', async () => {
  const { provider } = makeProvider({ body: envelope(JSON.stringify({ notes: 'hello' })) });
  await assert.rejects(
    () => provider.inspect({ image: IMAGE }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, 'MALFORMED_RESPONSE');
      return true;
    },
  );
});

test('a response missing choices is MALFORMED_RESPONSE', async () => {
  const { provider } = makeProvider({ body: JSON.stringify({ id: 'x' }) });
  await assert.rejects(() => provider.inspect({ image: IMAGE }), ProviderError);
});

test('an empty observations array is VALID and yields zero observations', async () => {
  const { provider } = makeProvider({ body: envelope(JSON.stringify({ observations: [] })) });
  const result = await provider.inspect({ image: IMAGE });
  assert.deepEqual(result.observations, []);
});

// Request shape and credential handling

test('sends the credential as a bearer header and the image as a data URL', async () => {
  const { provider, calls } = makeProvider({ body: envelope(VALID_CONTENT) });
  await provider.inspect({ image: IMAGE });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers['Authorization'], 'Bearer test-key-1234567890');
  const sent = JSON.parse(calls[0]?.body ?? '{}');
  assert.equal(sent.model, 'nvidia/nemotron-3-nano-omni');
  const userMessage = sent.messages[1];
  assert.equal(userMessage.content[1].type, 'image_url');
  assert.ok(String(userMessage.content[1].image_url.url).startsWith('data:image/jpeg;base64,'));
});

test('never falls back to the demo provider when Nebius is selected', () => {
  const provider = createProvider({ AI_PROVIDER: 'nebius' });
  assert.ok(provider instanceof NebiusNvidiaProvider);
  assert.equal(provider.name, 'nebius-nvidia');
});

test('createProvider rejects an unknown provider name', () => {
  assert.throws(() => createProvider({ AI_PROVIDER: 'openai' }), ProviderError);
});

test('config rejects a non-Nebius base URL and falls back to the default', () => {
  const cfg = resolveProviderConfig({ NEBIUS_BASE_URL: 'https://evil.example.com/v1/' });
  assert.equal(cfg.baseUrl, 'https://api.tokenfactory.nebius.com/v1/');
});

test('config rejects a non-HTTPS Nebius URL', () => {
  const cfg = resolveProviderConfig({ NEBIUS_BASE_URL: 'http://api.tokenfactory.nebius.com/v1/' });
  assert.ok(cfg.baseUrl.startsWith('https://'));
});

test('redactSecrets masks the API key and bearer tokens', () => {
  const env = { NEBIUS_API_KEY: 'super-secret-key-value' };
  const out = redactSecrets(
    'key=super-secret-key-value Authorization: Bearer abcdef1234567890',
    env,
  );
  assert.ok(!out.includes('super-secret-key-value'));
  assert.ok(!out.includes('abcdef1234567890'));
});

// Inspector: trust boundary + human verification

test('every observation is created AI_GENERATED and UNVERIFIED', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });

  assert.equal(result.observations.length, 1);
  for (const observation of result.observations) {
    assert.equal(observation.origin, 'AI_GENERATED');
    assert.equal(observation.verificationStatus, 'UNVERIFIED');
    assert.equal(observation.review, null);
    assert.equal(observation.model, 'nvidia/nemotron-3-nano-omni');
    assert.equal(observation.provider, 'nebius-nvidia');
  }
});

test('invalid model entries are dropped and reported, never coerced', async () => {
  const content = JSON.stringify({
    observations: [
      {
        category: 'OBSERVED_ELEMENT',
        observation: 'Valid one.',
        evidence: 'ok',
        confidence: 0.7,
        severity: 'INFO',
        suggested_action: 'NO_ACTION',
      },
      { category: 'NOT_A_CATEGORY', observation: 'Bad.', confidence: 5 },
    ],
  });
  const { provider } = makeProvider({ body: envelope(content) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });

  assert.equal(result.observations.length, 1, 'only the valid entry survives');
  assert.equal(result.rejected.length, 1, 'the invalid entry is reported');
  assert.ok(result.rejected[0]?.issues.length);
});

test('a provider failure yields no observations and propagates the error', async () => {
  const { provider } = makeProvider({ status: 503, body: 'down' });
  const inspector = new RealityInspector({ provider });

  await assert.rejects(() => inspector.inspectCapture({ image: IMAGE }), ProviderError);
  assert.equal(inspector.listObservations(IMAGE.captureId).length, 0);
});

test('a human can VERIFY an observation, and the status changes', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });
  const id = result.observations[0]?.id as string;

  const reviewed = inspector.reviewObservation({
    observationId: id,
    decision: 'VERIFIED',
    reviewer: 'site.engineer@example.com',
    note: 'Confirmed against the reference drawing.',
  });

  assert.ok(reviewed);
  assert.equal(reviewed.verificationStatus, 'VERIFIED');
  assert.equal(reviewed.review?.reviewer, 'site.engineer@example.com');
  assert.ok(reviewed.review?.reviewedAt);
});

test('a human can REJECT an observation', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });
  const id = result.observations[0]?.id as string;

  const reviewed = inspector.reviewObservation({
    observationId: id,
    decision: 'REJECTED',
    reviewer: 'qa@example.com',
  });
  assert.equal(reviewed?.verificationStatus, 'REJECTED');
});

test('reviewing an unknown observation returns null instead of a fake success', () => {
  const inspector = new RealityInspector({ provider: new DemoFixtureProvider() });
  const outcome = inspector.reviewObservation({
    observationId: 'obs_does_not_exist',
    decision: 'VERIFIED',
    reviewer: 'someone@example.com',
  });
  assert.equal(outcome, null);
});

test('reviewing without a reviewer identity is refused', async () => {
  const { provider } = makeProvider({ body: envelope(VALID_CONTENT) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });
  const id = result.observations[0]?.id as string;

  const outcome = inspector.reviewObservation({
    observationId: id,
    decision: 'VERIFIED',
    reviewer: '   ',
  });
  assert.equal(outcome, null);
  assert.equal(
    inspector.getObservation(id)?.verificationStatus,
    'UNVERIFIED',
    'an anonymous review must not change status',
  );
});

test('high confidence does NOT auto-verify an observation', async () => {
  const content = JSON.stringify({
    observations: [
      {
        category: 'OBSERVED_ELEMENT',
        observation: 'Very confident read.',
        evidence: 'clear',
        confidence: 0.99,
        severity: 'HIGH',
        suggested_action: 'NO_ACTION',
      },
    ],
  });
  const { provider } = makeProvider({ body: envelope(content) });
  const inspector = new RealityInspector({ provider });
  const result = await inspector.inspectCapture({ image: IMAGE });
  assert.equal(result.observations[0]?.verificationStatus, 'UNVERIFIED');
  assert.equal(result.bands[0], 'HIGH', 'the band is display-only');
});

test('demo provider runs the full flow offline and stays UNVERIFIED', async () => {
  const inspector = new RealityInspector({ provider: new DemoFixtureProvider() });
  const result = await inspector.inspectCapture({ image: IMAGE });

  assert.ok(result.observations.length > 0, 'demo must produce observations');
  assert.equal(result.rejected.length, 0);
  for (const observation of result.observations) {
    assert.equal(observation.verificationStatus, 'UNVERIFIED');
    assert.equal(observation.origin, 'AI_GENERATED');
  }
});

test('observations are scoped to their capture', async () => {
  const inspector = new RealityInspector({ provider: new DemoFixtureProvider() });
  await inspector.inspectCapture({ image: IMAGE });
  assert.equal(inspector.listObservations('cap_other').length, 0);
  assert.ok(inspector.listObservations(IMAGE.captureId).length > 0);
});
