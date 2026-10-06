/**
 * Hackathon eligibility.
 *
 * The hackathon requires inference on Nebius Token Factory using an NVIDIA
 * open-source model, so eligibility is a property of the model id that actually
 * ran, never of the provider class or a logo.
 *
 *   ELIGIBLE      an NVIDIA model confirmed callable on Nebius.
 *   NOT_ELIGIBLE  a real call that cannot satisfy the requirement, e.g. a
 *                 non-NVIDIA model or the offline fixture.
 *   NOT_VERIFIED  an NVIDIA id not yet proven callable. Claiming eligibility
 *                 here would be the false claim this project must avoid.
 *
 * VERIFIED_ELIGIBLE_MODELS is empty until a candidate has been probed live:
 * authenticated, listed by the provider, confirmed to accept image input, and
 * run end to end.
 */

export const ELIGIBILITY_ELIGIBLE = 'ELIGIBLE' as const;
export const ELIGIBILITY_NOT_ELIGIBLE = 'NOT_ELIGIBLE' as const;
export const ELIGIBILITY_NOT_VERIFIED = 'NOT_VERIFIED' as const;

export type HackathonEligibility =
  | typeof ELIGIBILITY_ELIGIBLE
  | typeof ELIGIBILITY_NOT_ELIGIBLE
  | typeof ELIGIBILITY_NOT_VERIFIED;

/**
 * NVIDIA model ids confirmed callable on Nebius Token Factory with working
 * image input. Empty by design: no eligible NVIDIA model has been verified.
 */
export const VERIFIED_ELIGIBLE_MODELS: ReadonlySet<string> = new Set<string>();

/**
 * NVIDIA model ids confirmed, by real authenticated calls, to accept TEXT input
 * and return schema-valid structured reasoning on this project's own inspection
 * context.
 *
 * This is a separate list from `VERIFIED_ELIGIBLE_MODELS` on purpose. Every
 * `nvidia/Nemotron-*` id in the catalogue rejects IMAGE input, so none of them
 * can be the visual stage; but they are exactly what the hackathon's NVIDIA
 * requirement asks for, and they serve as the construction-reasoning stage where
 * text input is what is wanted.
 *
 * Each id below was called live against Nebius Token Factory with the real
 * reasoning prompt and the real context block from a real inspection, and
 * returned parseable JSON containing every required field.
 *
 * `nvidia/Nemotron-3_5-Lightning` is deliberately ABSENT: it exhausts a 2000
 * token budget reasoning before answering and returned no JSON at all. Callable
 * is not the same as usable, and this list records usability.
 */
export const VERIFIED_REASONING_MODELS: ReadonlySet<string> = new Set<string>([
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nvidia-nemotron-3-nano-30b-a3b',
]);

/**
 * Classify the NVIDIA reasoning stage.
 *
 * Mirrors `classifyEligibility` for the text stage, with the difference that the
 * offline fixture and an absent reasoner are both NOT_ELIGIBLE, and that a
 * verified id is eligible.
 */
export function classifyReasoningEligibility(input: {
  readonly provider: string;
  readonly model: string;
  /** True when a reasoning result was actually produced and accepted. */
  readonly produced: boolean;
}): HackathonEligibility {
  const model = input.model.trim();

  if (input.provider !== 'nebius-nemotron-reasoner') {
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  if (!isNvidiaModelId(model)) {
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  if (!VERIFIED_REASONING_MODELS.has(model.toLowerCase())) {
    return ELIGIBILITY_NOT_VERIFIED;
  }
  // A verified id that did not actually produce usable output is reported as
  // not eligible for THIS run: the claim is about what happened, not about what
  // the id could do in principle.
  return input.produced ? ELIGIBILITY_ELIGIBLE : ELIGIBILITY_NOT_VERIFIED;
}

/**
 * Whether the hackathon's NVIDIA requirement is met by the pipeline as run.
 *
 * The requirement is "inference on Nebius Token Factory using an NVIDIA
 * open-source model". It says nothing about which of the two models must be
 * which, so a run whose reasoning stage is a verified NVIDIA Nemotron model
 * meets it, even though the vision stage is not an NVIDIA model.
 */
export type NvidiaRequirement = 'MET' | 'PARTIAL' | 'NOT_MET';

export interface PipelineEligibility {
  /** Classification of the visual/perception stage alone. */
  readonly vision: HackathonEligibility;
  /** Classification of the NVIDIA construction-reasoning stage alone. */
  readonly reasoning: HackathonEligibility;
  /** Whether the NVIDIA requirement is met by the models that actually ran. */
  readonly nvidiaRequirement: NvidiaRequirement;
  /** One honest sentence, shown on screen. */
  readonly note: string;
}

export function classifyPipelineEligibility(input: {
  readonly visionProvider: string;
  readonly visionModel: string;
  readonly reasoningProvider: string;
  readonly reasoningModel: string;
  readonly reasoningProduced: boolean;
}): PipelineEligibility {
  const vision = classifyEligibility({
    provider: input.visionProvider,
    model: input.visionModel,
  });
  const reasoning = classifyReasoningEligibility({
    provider: input.reasoningProvider,
    model: input.reasoningModel,
    produced: input.reasoningProduced,
  });

  if (vision === ELIGIBILITY_ELIGIBLE || reasoning === ELIGIBILITY_ELIGIBLE) {
    return {
      vision,
      reasoning,
      nvidiaRequirement: 'MET',
      note:
        `NVIDIA open-source inference ran on Nebius Token Factory: the construction-reasoning `
        + `stage used ${input.reasoningModel}. The visual stage used ${input.visionModel}, `
        + `which is not an NVIDIA model.`,
    };
  }
  if (vision === ELIGIBILITY_NOT_VERIFIED || reasoning === ELIGIBILITY_NOT_VERIFIED) {
    return {
      vision,
      reasoning,
      nvidiaRequirement: 'PARTIAL',
      note:
        'An NVIDIA model id was in use but no verified NVIDIA output was produced for this run. '
        + 'Eligibility is reported per stage rather than claimed.',
    };
  }
  return {
    vision,
    reasoning,
    nvidiaRequirement: 'NOT_MET',
    note: `No NVIDIA model produced output for this run. Vision used ${input.visionModel}.`,
  };
}

/** True when the id is served under the NVIDIA namespace. */
export function isNvidiaModelId(model: string): boolean {
  return /^nvidia\//i.test(model.trim());
}

export interface EligibilityInput {
  /** Provider that produced the result, e.g. 'nebius-nvidia'. */
  readonly provider: string;
  /** Exact model id that produced the result. */
  readonly model: string;
}

/**
 * Classify a completed inspection for hackathon eligibility.
 *
 * The offline fixture is excluded before any model check, because it never
 * performed inference at all.
 */
export function classifyEligibility(input: EligibilityInput): HackathonEligibility {
  const model = input.model.trim();

  if (input.provider === 'demo-fixture') {
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  if (input.provider !== 'nebius-nvidia') {
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  if (!isNvidiaModelId(model)) {
    // A genuine live call, but not an NVIDIA model, so it cannot satisfy the
    // requirement. This is the normal development state, not a failure.
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  return VERIFIED_ELIGIBLE_MODELS.has(model.toLowerCase())
    ? ELIGIBILITY_ELIGIBLE
    : ELIGIBILITY_NOT_VERIFIED;
}

/** Operator-facing explanation of an eligibility classification. */
export function describeEligibility(eligibility: HackathonEligibility, model: string): string {
  switch (eligibility) {
    case ELIGIBILITY_ELIGIBLE:
      return 'Verified NVIDIA model confirmed callable on Nebius Token Factory.';
    case ELIGIBILITY_NOT_VERIFIED:
      return `NVIDIA model id "${model}" has not been confirmed callable on Nebius Token Factory with image input. Eligibility is NOT_VERIFIED until that is demonstrated live.`;
    default:
      return `Model "${model}" is not an NVIDIA model, so this run does not satisfy the NVIDIA requirement.`;
  }
}