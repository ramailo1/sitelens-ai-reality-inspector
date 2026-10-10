/**
 * Nemotron construction reasoning over Nebius Token Factory.
 *
 * This is the NVIDIA contribution to the product, and it is a working one: it
 * receives MiniCPM's validated visual observations plus SiteLens's deterministic
 * comparison and returns the construction reasoning that turns "4 bars seen"
 * into "reinforcement installation is in progress, and here is what the
 * photograph still cannot establish".
 *
 * It is a TEXT model and is deliberately given no image. That is the whole
 * design: the vision stage owns pixels, the reasoning stage owns meaning, and
 * the deterministic engine owns comparison. Verified live against all four
 * `nvidia/Nemotron-*` ids in the Token Factory catalogue; see the measured
 * table in README.md.
 *
 * The credential is read from the environment, sent only as a bearer header,
 * never logged, and the same host allowlist and deadline enforcement as the
 * vision provider apply (see config.ts).
 */

import type {
  ConstructionReasoning,
  ReasoningContextInput,
  ReasoningOutcome,
} from '../reasoning.ts';
import {
  buildReasoningContext,
  echoesExpectedNote,
  isDegenerateReasoning,
  validateReasoning,
  visualClaimText,
} from '../reasoning.ts';
import type { ReasoningConfig, ResolvedCredentials } from '../config.ts';
import { redactSecrets, resolveCredentials } from '../config.ts';
import { ProviderError } from './provider.ts';
import type { FetchLike } from './nebius-nvidia.provider.ts';

export const NEMOTRON_REASONER_NAME = 'nebius-nemotron-reasoner' as const;

/**
 * The reasoning instruction.
 *
 * The worked example matters: it demonstrates the required BEHAVIOUR (reason
 * about significance, name what the image cannot establish, keep UNDETERMINED
 * undetermined) far more reliably than another paragraph of rules. Each legal
 * enum value is shown as one concrete word rather than a pipe-separated list,
 * because models echo template placeholders verbatim and a copied
 * `"UNCERTAIN | INSUFFICIENT_EVIDENCE"` is then correctly rejected downstream.
 */
export function buildReasoningPrompt(): string {
  return [
    'You are the construction REASONING stage of a site inspection system. Another model has already',
    'looked at one photograph and reported what it can see. You never see the image yourself; you',
    'reason over that report and over a comparison that was computed in code.',
    '',
    'Your job is the part that cannot come from looking:',
    '- what the visible evidence means for the work in progress,',
    '- what the comparison result does and does not establish,',
    '- what a field engineer must physically check before anything is settled.',
    '',
    'Hard rules, and they are checked on your answer afterwards:',
    '- Do NOT restate or summarise the visual description. Add meaning to it.',
    '- Never assert a dimension, spacing, cover, anchorage, quantity, standard or code',
    '  clause unless the input states it. If it is not in the input, it is unknown.',
    '- Never describe an individual person. Refer to positions, tasks or plant only.',
    '- If a deterministic comparison status is UNDETERMINED, you MUST preserve that. Say what',
    '  is missing and what would resolve it. Do not upgrade an unknown into a problem.',
    '- A parenthetical "operator note" in the expected state declares what was PLANNED, never',
    '  what the photograph shows. Never present such a note as an observed conclusion: do not',
    '  write that an element "is substantially complete", "is finished" or "is in place" unless',
    '  the VISIBLE ELEMENTS, the VISUAL OBSERVATIONS or a MATCH comparison row establishes it.',
    '  Completeness claims with no visible evidence are exactly the fabrication this system refuses.',
    '- Never state or imply that work is approved, rejected, compliant, certified or safe.',
    '- Where the expected state has no item for something visible, say so plainly; that is a',
    '  limitation of the reference, not a defect on site.',
    '',
    'Return STRICT JSON only. No markdown fences, no preamble, no trailing commentary, shaped',
    'exactly as:',
    '{',
    '  "summary": "one sentence: what the evidence supports about the work",',
    '  "whatMatters": "the deciding factor for this zone and why",',
    '  "rationale": "how the visual report and the comparison combine into a reading",',
    '  "recommendation": "the next practical inspection action for a person to carry out",',
    '  "verification": "what must be physically checked on site to resolve the open question",',
    '  "confidence": 0.0,',
    '  "certainty": "SUPPORTED"',
    '}',
    '',
    '"certainty" must be exactly one of the three words SUPPORTED, UNCERTAIN or',
    'INSUFFICIENT_EVIDENCE, chosen on its own. Use INSUFFICIENT_EVIDENCE when this single',
    'photograph cannot settle the question - that is a correct answer, not a failure.',
    '',
    'Worked example of the required BEHAVIOUR. Input: a dense reinforcement grid is visible,',
    'workers are tying reinforcement, a slab area is partly visible. Expected state: slab',
    'reinforcement preparation. Deterministic comparison: UNDETERMINED. Correct reasoning: the',
    'activity is consistent with slab reinforcement preparation, but the photograph does not',
    'establish reinforcement spacing, cover, anchorage or completeness; those must not be',
    'inferred from the image, and field verification against the approved reinforcement detail is',
    'required before the item can move off UNDETERMINED.',
  ].join('\n');
}

export interface ReasonerOptions {
  readonly config: ReasoningConfig;
  readonly credentials: ResolvedCredentials | undefined;
  readonly fetchImpl: FetchLike;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * The reasoning stage, behind an interface, so a caller can be handed an
 * explicit "unavailable" reasoner instead of a network call that fails later.
 */
export interface Reasoner {
  readonly name: string;
  readonly model: string;
  /** True when a credential is present and the stage can actually be called. */
  readonly configured: boolean;
  reason(input: ReasoningContextInput): Promise<ReasoningOutcome>;
}

/**
 * Always-unavailable reasoner.
 *
 * Used when reasoning is switched off or no credential is present. It reports
 * the reason and returns nothing, which is what lets the visual observation and
 * the deterministic comparison stand on their own instead of being discarded
 * along with a missing reasoning stage.
 */
export class UnavailableReasoner implements Reasoner {
  public readonly name = 'unavailable';
  public readonly configured = false;
  public readonly model: string;

  private readonly kind: 'DISABLED' | 'NOT_CONFIGURED';
  private readonly message: string;

  public constructor(options: {
    readonly kind: 'DISABLED' | 'NOT_CONFIGURED';
    readonly message: string;
    readonly model?: string;
  }) {
    this.kind = options.kind;
    this.message = options.message;
    this.model = options.model ?? 'none';
  }

  async reason(): Promise<ReasoningOutcome> {
    return {
      status: 'UNAVAILABLE',
      kind: this.kind,
      message: this.message,
      detail: null,
      validationIssues: [],
    };
  }
}

export class NemotronReasoner implements Reasoner {
  public readonly name = NEMOTRON_REASONER_NAME;
  public readonly model: string;

  private readonly config: ReasoningConfig;
  private readonly credentials: ResolvedCredentials | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly env: NodeJS.ProcessEnv;

  public constructor(options: ReasonerOptions) {
    this.config = options.config;
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl;
    this.env = options.env;
    this.model = options.config.model;
  }

  public get configured(): boolean {
    return this.credentials !== undefined;
  }

  /**
   * Reason over one inspection.
   *
   * Never throws: every failure becomes an explicit UNAVAILABLE outcome, because
   * a reasoning outage must not destroy the visual observation or the
   * deterministic comparison that were already produced successfully.
   */
  async reason(input: ReasoningContextInput): Promise<ReasoningOutcome> {
    if (!this.credentials) {
      return {
        status: 'UNAVAILABLE',
        kind: 'NOT_CONFIGURED',
        message:
          'No Nebius credential is configured, so no construction reasoning was produced.',
        detail: null,
        validationIssues: [],
      };
    }

    const started = Date.now();
    const userText = buildReasoningContext(input);

    let content: string;
    try {
      content = await this.callModel(userText);
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        return {
          status: 'UNAVAILABLE',
          kind: error.kind as ReasoningOutcome extends { kind: infer K } ? K : never,
          message: error.message,
          detail: error.detail ?? null,
          validationIssues: [],
        };
      }
      throw error;
    }

    const latencyMs = Date.now() - started;
    const parsed = parseReasoningContent(content);
    if (!parsed.ok) {
      return {
        status: 'UNAVAILABLE',
        kind: 'MALFORMED_RESPONSE',
        message: parsed.message,
        detail: redactSecrets(truncate(content, 300), this.env),
        validationIssues: [],
      };
    }

    const validated = validateReasoning(parsed.value);
    if (!validated.ok) {
      return {
        status: 'UNAVAILABLE',
        kind: 'REJECTED_BY_VALIDATION',
        message:
          'The reasoning response failed schema validation and was discarded rather than repaired.',
        detail: redactSecrets(truncate(content, 300), this.env),
        validationIssues: validated.issues,
      };
    }

    const reasoning: ConstructionReasoning = validated.value;

    // A headline that restates a planned-state note as an observed conclusion
    // is laundered evidence, even when the JSON shape is perfect. The
    // deterministic row underneath stays exactly as computed; only the prose
    // that contradicts it is discarded, never repaired.
    const echo = echoesExpectedNote(reasoning, input.expected, input.rows);
    if (echo !== null) {
      return {
        status: 'UNAVAILABLE',
        kind: 'REJECTED_BY_VALIDATION',
        message:
          'The reasoning response failed schema validation and was discarded rather than repaired.',
        detail: redactSecrets(truncate(content, 300), this.env),
        validationIssues: [
          {
            field: echo.field,
            message:
              `restates the planned-state note "${echo.note}" for ${echo.element} as a conclusion `
              + `while the deterministic comparison row is ${echo.status}; a note declares what was `
              + 'planned, never what the photograph shows',
          },
        ],
      };
    }

    return {
      status: 'AVAILABLE',
      reasoning,
      provenance: {
        model: this.model,
        provider: this.name,
        reasonedAt: new Date().toISOString(),
        latencyMs,
        rowsConsidered: input.rows.length,
        detectionsConsidered: input.detections.length,
        degenerate: isDegenerateReasoning(reasoning, visualClaimText(input)),
      },
    };
  }

  private async callModel(userText: string): Promise<string> {
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      // Low temperature: this stage must be a faithful reading of the evidence it
      // was handed, not a creative one.
      temperature: 0.1,
      max_tokens: this.config.maxTokens,
      messages: [
        { role: 'system', content: buildReasoningPrompt() },
        { role: 'user', content: userText },
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
          Authorization: `Bearer ${(this.credentials as ResolvedCredentials).apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new ProviderError(
          'TIMEOUT',
          `Nemotron reasoning exceeded the ${this.config.timeoutMs} ms deadline.`,
        );
      }
      throw new ProviderError(
        'UNAVAILABLE',
        'Could not reach Nebius Token Factory for construction reasoning.',
        redactSecrets(errorMessage(error), this.env),
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw mapReasoningHttpFailure(response.status, await safeReadText(response), this.env);
    }

    const rawText = await safeReadText(response);
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawText);
    } catch {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nemotron reasoning response was not valid JSON.',
        redactSecrets(truncate(rawText, 300), this.env),
      );
    }
    const content = extractMessageContent(envelope as Record<string, unknown>);
    if (content === null) {
      throw new ProviderError(
        'MALFORMED_RESPONSE',
        'Nemotron reasoning response did not contain a message content field.',
      );
    }
    return content;
  }
}

/**
 * Strip the fenced/preamble shapes a reasoning model sometimes emits.
 *
 * Only ever removes wrapper characters; the inner text is passed through
 * untouched, so this cannot repair or reinterpret content. If the result is
 * still not an object the caller reports MALFORMED_RESPONSE.
 */
export function parseReasoningContent(
  content: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced !== null && fenced[1] !== undefined ? fenced[1].trim() : trimmed;

  // A model that narrates before answering is a real failure mode, so the
  // leading brace is located and the balanced object taken from there.
  const start = candidate.indexOf('{');
  if (start === -1) {
    return { ok: false, message: 'The reasoning response contained no JSON object.' };
  }
  const end = candidate.lastIndexOf('}');
  if (end <= start) {
    return { ok: false, message: 'The reasoning response contained an unterminated JSON object.' };
  }

  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: 'The reasoning response was not a JSON object.' };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: 'The reasoning response was not valid JSON.' };
  }
}

function mapReasoningHttpFailure(status: number, body: string, env: NodeJS.ProcessEnv): ProviderError {
  const detail = redactSecrets(truncate(body, 300), env);
  if (status === 401 || status === 403) {
    return new ProviderError('AUTHENTICATION', 'Nebius rejected the credential for reasoning.', detail);
  }
  if (status === 429) {
    return new ProviderError('RATE_LIMITED', 'Nebius rate limit reached during reasoning.', detail);
  }
  if (status >= 500) {
    return new ProviderError(
      'UNAVAILABLE',
      `Nebius Token Factory is unavailable for reasoning (HTTP ${status}).`,
      detail,
    );
  }
  return new ProviderError('ERROR', `Nemotron reasoning request failed (HTTP ${status}).`, detail);
}

function extractMessageContent(parsed: Record<string, unknown> | null): string | null {
  if (parsed === null) return null;
  const choices = parsed['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown>;
  const message = first['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as Record<string, unknown>)['text'] === 'string',
    );
    if (textPart) return (textPart as Record<string, unknown>)['text'] as string;
  }
  return null;
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

/** Resolve the reasoning credential without throwing at construction time. */
export function safeResolveReasoningCredentials(
  env: NodeJS.ProcessEnv,
): ResolvedCredentials | undefined {
  try {
    return resolveCredentials(env);
  } catch {
    // Reported as NOT_CONFIGURED at reason() time, never at construction time.
    return undefined;
  }
}
