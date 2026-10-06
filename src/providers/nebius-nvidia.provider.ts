/**
 * Calls a vision model through Nebius Token Factory's OpenAI-compatible API,
 * sending the image as a base64 data URL.
 *
 * The credential is read from the environment and sent only as a bearer header;
 * it is never logged or persisted. Imagery is transmitted only to a validated
 * Nebius host (see isAllowedNebiusHost in config.ts), and a deadline is always
 * enforced so a hung provider cannot stall a caller.
 */

import type {
  AIProvider,
  InspectRequest,
  RawProviderResult,
} from './provider.ts';
import { ProviderError } from './provider.ts';
import type { ProviderConfig, ResolvedCredentials } from '../config.ts';
import { redactSecrets, resolveCredentials, resolveProviderConfig } from '../config.ts';
import type { RawModelObservation } from '../types/observation.ts';

/** Stable provider name, surfaced in every observation's provenance. */
export const NEBIUS_PROVIDER_NAME = 'nebius-nvidia' as const;

/**
 * Largest encoded image the endpoint will accept, measured not guessed.
 *
 * The image travels as a base64 data URL inside the request body, so the wire
 * size is roughly 4/3 of the file. Probed against the live endpoint with real
 * construction photographs:
 *
 *   5.0 MB  (022)  HTTP 200
 *   7.9 MB  (030)  HTTP 200
 *   9.2 MB  (031)  HTTP 200
 *  15.9 MB  (023)  HTTP 400, schema rejection of the truncated body
 *
 * The boundary sits between the last two. A conservative 10 MB is enforced so
 * the failure is a clear product message naming the file rather than an opaque
 * provider schema error at inference time.
 */
export const MAX_PROVIDER_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Instruction sent to the model. It constrains the model to OBSERVABLE site
 * reality and explicitly forbids autonomous engineering/compliance conclusions
 * — the same trust boundary SiteLens enforces on every AI path.
 */
export function buildInspectionPrompt(options: { expectedSummary?: string | null } = {}): string {
  const summary = options.expectedSummary ?? '';
  const expectedBlock =
    summary.trim().length > 0
      ? [
          '',
          'The inspector has declared this EXPECTED STATE for the zone:',
          summary.trim(),
          '',
          'Use it ONLY as context for what to look for. Do NOT report a deviation',
          'yourself - a separate deterministic step compares your detected elements',
          'against this list. Never restate the expected counts as observed values.',
        ]
      : [
          '',
          'No expected state was supplied. Report only what is visible; do not',
          'assume any programme, sequence or intended design.',
        ];

  return [
    'You are a construction reality inspector analysing ONE site photograph.',
    '',
    'Write every string value in ENGLISH, whatever language the image text uses.',
    '',
    'Describe ONLY what is visibly present. You are an assistant, not an engineer of record:',
    '- Do NOT declare compliance, structural safety, or code violations.',
    '- Do NOT assert measurements, quantities, or dimensions that cannot be read from the image.',
    '- Do NOT identify or describe individual people.',
    '- Distinguish what you OBSERVE from what you INFER, and never present an',
    '  inference as a verified fact.',
    '- If the evidence is insufficient, say so. An honest "not determinable" is',
    '  far more useful to a site engineer than a confident guess.',
...expectedBlock,
    '',
    'Return STRICT JSON only, no markdown fences, no commentary. Exactly three keys at the top',
    'level, each an array:',
    '{ "elements": [], "observations": [], "findings": [] }',
    '',
    'The examples below show ONLY the closed-vocabulary string fields, because a model copies',
    'whatever a template contains verbatim. Every number is deliberately absent so there is no',
    'number here for you to echo by mistake:',
    '{',
    '  "observations": [',
    '    {',
    '      "category": "OBSERVED_ELEMENT",',
    '      "severity": "INFO",',
    '      "suggested_action": "NO_ACTION"',
    '    }',
    '  ]',
    '}',
    '',
    '=== ELEMENTS — what you can SEE ===',
    'Each element object carries these keys:',
    '  "element"       string. Exactly one of: COLUMN, SLAB, WALL, OPENING, MEP_ROUGH_IN,',
    '                   FORMWORK, SCAFFOLD, EQUIPMENT, WORKER, REBAR, FINISH, EXCAVATION.',
    '  "present"       boolean. True only if the element is actually in the photograph.',
    '  "count"         OPTIONAL integer. Include ONLY when you can genuinely count the items in',
    '                   the image. OMIT the key entirely otherwise. Never estimate one.',
    '  "confidence"    number strictly between 0 and 1, and NEVER zero. This is your certainty',
    '                   in your own visual reading and nothing more.',
    '  "evidence"      string. What in the image supports this. Describe what is there.',
    '  "bounding_box"  OPTIONAL object with keys "x", "y", "width", "height", each a number',
    '                   between 0 and 1. "width" and "height" must both be greater than zero.',
    '                   OMIT the key unless you can point at the element.',
    '                   IMPORTANT: an inspector cannot see WHERE you looked without it. For every',
    '                   element you are sure of, give the real region of the frame it occupies.',
    '',
    '=== OBSERVATIONS — one factual statement about visible reality ===',
    'Each observation object carries these keys:',
    '  "category"          string. Exactly one of: OBSERVED_ELEMENT, PROGRESS_OBSERVATION,',
    '                      POTENTIAL_DEVIATION, POTENTIAL_RISK, SUGGESTED_FOLLOW_UP.',
    '  "observation"       string. One factual sentence about what is visible.',
    '  "evidence"          object with a "description" string: what in the image supports this.',
    '  "confidence"        number strictly between 0 and 1, and never zero.',
    '  "severity"          string. Exactly one of: INFO, LOW, MEDIUM, HIGH.',
    '  "suggested_action"  string. Exactly one of: NO_ACTION, HUMAN_REVIEW, INSPECT_CLOSER,',
    '                      CAPTURE_REFERENCE_PLAN, SCHEDULE_FOLLOW_UP.',
    '  "bounding_box"      OPTIONAL, same rules as above.',
    '',
    '=== FINDINGS — candidate attention areas, NOT verdicts ===',
    'Each finding object carries these keys:',
    '  "title"          string. Short label for the card.',
    '  "category"       string. Exactly one of: DEVIATION, MISSING_ELEMENT, INCOMPLETE_WORK,',
    '                    UNEXPECTED_CONDITION, QUALITY, COORDINATION, SAFETY_ATTENTION,',
    '                    UNDETERMINED.',
    '  "severity"       string. Exactly one of: INFO, LOW, MEDIUM, HIGH.',
    '  "element"        OPTIONAL string, same vocabulary as elements.',
    '  "location"       OPTIONAL string. Where in the frame.',
    '  "observation"    string. WHAT is visible.',
    '  "reason"         string. WHY it is flagged.',
    '  "evidence"       string. The image detail that supports it.',
    '  "confidence"     number strictly between 0 and 1, and never zero.',
    '  "recommendation" string. The physical check a human should make.',
    '  "bounding_box"   OPTIONAL, same rules as above.',
    '',
    '=== THE RULE THAT MATTERS MOST ===',
    'Report an element ONLY if you can actually see it in this photograph.',
    '- If something from the expected state is NOT visible, LEAVE IT OUT. Do not include it',
    '  with zero confidence. Do not write "no visible X" as the evidence for a present element.',
    '- NEVER echo the expected-state list back as your "elements". That list is a comparison',
    '  reference, not a description of this photograph. If you return an element from that list,',
    '  it must be because YOU can see it.',
    '- Never emit confidence 0, and never emit a bounding_box whose width or height is 0. Those',
    '  values mean "I did not look", and this product discards them rather than guessing.',
    '- An empty "elements" array with one honest observation is a BETTER answer than a full list',
    '  of placeholders. Returning nothing you cannot see is correct, not a failure.',
    '',
    'Rules:',
    '- "element" must be EXACTLY one of: COLUMN, SLAB, WALL, OPENING, MEP_ROUGH_IN,',
    '  FORMWORK, SCAFFOLD, EQUIPMENT, WORKER, REBAR, FINISH, EXCAVATION.',
    '- Pick EXACTLY ONE category per observation entry. Never a combination, never a choice',
    // eslint-disable-next-line no-template-curly-in-string
    '  list, never the words "or"/"/"/"|" inside the value.',
    '- "recommendation" must be a PHYSICAL check a person can carry out. Never state',
    '  or imply that the work is approved, rejected or certified.',
    '- Prefer fewer, well-evidenced entries over many speculative ones.',
    '- If nothing meaningful is visible, return an empty observations array and',
    '  empty elements and findings arrays rather than inventing content.',
  ].join('\n');
}

/** Injectable fetch, so tests never perform real network I/O. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface NebiusNvidiaProviderOptions {
  readonly config?: ProviderConfig | undefined;
  readonly credentials?: ResolvedCredentials | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export class NebiusNvidiaProvider implements AIProvider {
  public readonly name = NEBIUS_PROVIDER_NAME;
  public readonly model: string;

  private readonly config: ProviderConfig;
  private readonly fetchImpl: FetchLike;
  private readonly env: NodeJS.ProcessEnv;
  private readonly credentials: ResolvedCredentials | undefined;

  constructor(options: NebiusNvidiaProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.config = options.config ?? resolveProviderConfig(this.env);
    // Resolved eagerly but lazily consumed: a missing key must fail at inspect
    // time with NOT_CONFIGURED, not at module import time.
    this.credentials = options.credentials ?? safeResolveCredentials(this.env);
    this.model = this.config.model;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit));
  }

  async inspect(request: InspectRequest): Promise<RawProviderResult> {
    const { image } = request;

    if (!image || !Buffer.isBuffer(image.bytes) || image.bytes.length === 0) {
      throw new ProviderError('ERROR', 'Inspection image is empty or missing.');
    }
    if (!image.mediaType.startsWith('image/')) {
      throw new ProviderError('ERROR', `Unsupported media type: ${image.mediaType}`);
    }
    if (image.bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
      const mb = (MAX_PROVIDER_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
      // Refused here, with the real limit named, instead of producing an opaque
      // schema rejection from the endpoint part-way through a large upload.
      throw new ProviderError(
        'ERROR',
        `This capture is ${(image.bytes.length / (1024 * 1024)).toFixed(1)} MB and the model `
        + `endpoint accepts up to ${mb} MB. Reduce or recompress it before inspecting.`,
      );
    }

    if (!this.credentials) {
      throw new ProviderError(
        'NOT_CONFIGURED',
        'NEBIUS_API_KEY is not set. Set it in your environment to enable the AI Reality Inspector.',
      );
    }

    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const dataUrl = `data:${image.mediaType};base64,${image.bytes.toString('base64')}`;

    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0.1,
      // Bounded on purpose. Some catalogue models are reasoning models that will
      // otherwise spend the whole deadline emitting tokens and never return the
      // JSON. A capped response that fails validation is far better than a hang.
      max_tokens: this.config.maxTokens,
      messages: [
        {
          role: 'system',
          content: buildInspectionPrompt({
            expectedSummary: request.expectedSummary ?? null,
          }),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyse this construction site capture.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The credential goes here and nowhere else.
          Authorization: `Bearer ${this.credentials.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new ProviderError(
          'TIMEOUT',
          `Nebius request exceeded the ${this.config.timeoutMs} ms deadline.`,
        );
      }
      throw new ProviderError(
        'UNAVAILABLE',
        'Could not reach Nebius Token Factory.',
        redactSecrets(errorMessage(error), this.env),
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.mapHttpFailure(response.status, await safeReadText(response));
    }

    const rawText = await safeReadText(response);
    const inner = this.parseInnerPayload(rawText);
    const record = inner as Record<string, unknown>;

    return {
      provider: this.name,
      model: this.config.model,
      observations: this.sliceArray(record['observations'], this.config.maxObservations).map(
        (entry) => (isObject(entry) ? entry : {}) as RawModelObservation,
      ),
      // elements/findings are optional: a model that only answers the original
      // contract still produces a usable, honest inspection rather than a
      // hard failure. An absent array means "said nothing", never "nothing there".
      elements: this.sliceArray(record['elements'], this.config.maxObservations),
      findings: this.sliceArray(record['findings'], this.config.maxObservations),
    };
  }

  /** Cap an array field so one verbose response cannot flood the UI. */
  private sliceArray(value: unknown, limit: number): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit);
  }

  /** Map a non-2xx status onto an explicit, loggable failure kind. */
  private mapHttpFailure(status: number, body: string): ProviderError {
    const detail = redactSecrets(truncate(body, 300), this.env);
    if (status === 401 || status === 403) {
      return new ProviderError(
        'AUTHENTICATION',
        'Nebius rejected the credential. Check NEBIUS_API_KEY.',
        detail,
      );
    }
    if (status === 429) {
      return new ProviderError('RATE_LIMITED', 'Nebius rate limit reached.', detail);
    }
    if (status >= 500) {
      return new ProviderError(
        'UNAVAILABLE',
        `Nebius Token Factory is unavailable (HTTP ${status}).`,
        detail,
      );
    }
    return new ProviderError('ERROR', `Nebius request failed (HTTP ${status}).`, detail);
  }

/**
   * Unwrap the OpenAI-compatible envelope and parse the model's JSON payload.
   *
   * A reply that is not an object with an "observations" array is a
   * MALFORMED_RESPONSE rather than an empty result, so a broken provider cannot
   * masquerade as "nothing to see". `elements` and `findings` are optional.
   */
  private parseInnerPayload(rawText: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nebius returned a response that was not valid JSON.',
        redactSecrets(truncate(rawText, 300), this.env),
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Nebius response was not a JSON object.');
    }

    // OpenAI-compatible envelope: choices[0].message.content
    const content = extractMessageContent(parsed as Record<string, unknown>);
    if (content === null) {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nebius response did not contain a message content field.',
      );
    }

    let inner: unknown;
    try {
      inner = JSON.parse(content);
    } catch {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nebius message content was not valid JSON.',
        redactSecrets(truncate(content, 300), this.env),
      );
    }

    if (
      typeof inner !== 'object' ||
      inner === null ||
      Array.isArray(inner) ||
      !Array.isArray((inner as Record<string, unknown>)['observations'])
    ) {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nebius message content did not contain an "observations" array.',
      );
    }

    // The inner payload itself is the parsed JSON object; the caller reads the
    // individual arrays off it.
    return inner;
  }
}

/** True for a plain object, which is the only shape we pass through as data. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeResolveCredentials(env: NodeJS.ProcessEnv): ResolvedCredentials | undefined {
  try {
    return resolveCredentials(env);
  } catch {
    // Absent credential is reported at inspect() time as NOT_CONFIGURED.
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'AbortError') ||
    (error instanceof Error && /abort/i.test(error.message))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function safeReadText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Tolerate both the OpenAI-compatible envelope and a bare content string, but
 * return null (→ MALFORMED_RESPONSE) when neither is present.
 */
function extractMessageContent(parsed: Record<string, unknown>): string | null {
  const choices = parsed['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message = (first as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content;
  // Some gateways return content as an array of parts.
  if (Array.isArray(content)) {
    const textPart = content.find(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as Record<string, unknown>)['text'] === 'string',
    );
    if (textPart) {
      return (textPart as Record<string, unknown>)['text'] as string;
    }
  }
  return null;
}
