/**
 * Hackathon eligibility, as three separate questions.
 *
 * The hackathon requires inference on Nebius Token Factory using an NVIDIA
 * open-source model. This project runs a HYBRID pipeline, so "is this run
 * eligible" is not one question and must never be answered with one boolean.
 * These are the three, kept apart on purpose:
 *
 *   MODEL        is this individual model an NVIDIA model?
 *                openbmb/MiniCPM-V-4_5  -> NO, and that is correct
 *                nvidia/Nemotron-3-…   -> YES
 *
 *   STAGE        what did THIS stage contribute to the NVIDIA requirement?
 *                ELIGIBLE      an NVIDIA model confirmed callable on Nebius that
 *                              actually produced accepted output for this run.
 *                NOT_ELIGIBLE  a real call that cannot satisfy the requirement,
 *                              e.g. a non-NVIDIA model or the offline fixture.
 *                NOT_VERIFIED  an NVIDIA id not yet proven callable, or a proven id
 *                              that produced nothing this run.
 *
 *   SUBMISSION   do the models that actually ran, as a pipeline, meet the
 *                requirement? MET | PARTIAL | NOT_MET.
 *
 * A model-level "NO" for the vision stage and a submission-level "MET" are both
 * true at once, and the UI must say both. Collapsing them either brands a
 * correct non-NVIDIA vision model as disqualified, or implies MiniCPM is an
 * NVIDIA model. Neither is acceptable.
 *
 * Fail-closed: MET is reachable ONLY through a stage that is ELIGIBLE, which
 * requires a real provider, an NVIDIA id, membership of a list verified by live
 * authenticated calls, AND output that was actually produced and accepted. A
 * configured model name is never sufficient on its own.
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
 * image input. Empty by design: no eligible NVIDIA VISION model has been
 * verified. Every `nvidia/Nemotron-*` id in the catalogue rejects IMAGE input
 * with `HTTP 400 This model does not support image input`, so none of them can
 * be the visual stage. This says nothing about the text reasoning stage, which
 * is verified separately below.
 */
export const VERIFIED_ELIGIBLE_MODELS: ReadonlySet<string> = new Set<string>();

/**
 * NVIDIA model ids confirmed, by real authenticated calls, to accept TEXT input
 * and return schema-valid structured reasoning on this project's own inspection
 * context.
 *
 * This is a separate list from `VERIFIED_ELIGIBLE_MODELS` on purpose. These ids
 * are exactly what the hackathon's NVIDIA requirement asks for, and they serve
 * as the construction-reasoning stage where text input is what is wanted.
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

/** The two model stages of the hybrid pipeline. */
export type PipelineStage = 'VISION' | 'REASONING';

/** The only live inference platform this product has. */
export const INFERENCE_PLATFORM = 'Nebius Token Factory' as const;

/**
 * Which platform a provider actually calls, or null when it calls nothing.
 *
 * Derived from the provider identity rather than hard-coded per UI surface, so a
 * stage that is not the Nebius path can never be described as Nebius Token
 * Factory.
 */
export function inferencePlatformFor(provider: string): string | null {
  return provider === 'nebius-nvidia' || provider === 'nebius-nemotron-reasoner'
    ? INFERENCE_PLATFORM
    : null;
}

/** True when the id is served under the NVIDIA namespace. */
export function isNvidiaModelId(model: string): boolean {
  return /^nvidia\//i.test(model.trim());
}

/**
 * Classify the NVIDIA construction-reasoning stage.
 *
 * Mirrors `classifyEligibility` for the text stage, with the difference that the
 * offline fixture and an absent reasoner are both NOT_ELIGIBLE, and that a
 * verified id is eligible only when it actually produced usable output.
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

export interface EligibilityInput {
  /** Provider that produced the result, e.g. 'nebius-nvidia'. */
  readonly provider: string;
  /** Exact model id that produced the result. */
  readonly model: string;
}

/**
 * Classify the VISUAL stage of a completed inspection.
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
    // A genuine live call, but not an NVIDIA model, so THIS STAGE cannot satisfy
    // the requirement. This is the normal state of a hybrid pipeline, not a
    // failure, and it says nothing about the reasoning stage.
    return ELIGIBILITY_NOT_ELIGIBLE;
  }
  return VERIFIED_ELIGIBLE_MODELS.has(model.toLowerCase())
    ? ELIGIBILITY_ELIGIBLE
    : ELIGIBILITY_NOT_VERIFIED;
}

/**
 * Whether the hackathon's NVIDIA requirement is met by the pipeline as run.
 *
 * The requirement is "inference on Nebius Token Factory using an NVIDIA
 * open-source model". It says nothing about which of the two models must be
 * which, so a run whose reasoning stage is a verified NVIDIA Nemotron model
 * that produced output meets it, even though the vision stage is not an NVIDIA
 * model.
 */
export type NvidiaRequirement = 'MET' | 'PARTIAL' | 'NOT_MET';

/**
 * One stage of the hybrid pipeline, with its model-level fact, its stage-level
 * classification and its runtime evidence kept as three separate fields.
 */
export interface StageQualification {
  readonly stage: PipelineStage;
  /** What this stage is for, in product terms. */
  readonly role: string;
  readonly provider: string;
  readonly model: string;
  /** MODEL-level fact. Says nothing about eligibility. */
  readonly isNvidiaModel: boolean;
  /** STAGE-level classification of this stage's contribution. */
  readonly classification: HackathonEligibility;
  /** RUNTIME evidence: did this stage actually produce accepted output? */
  readonly produced: boolean;
  /** Platform this stage called, or null when it called nothing. */
  readonly platform: string | null;
  /** One honest sentence about this stage, shown on screen. */
  readonly note: string;
}

export interface PipelineEligibility {
  /** Stage-level classification of the visual/perception stage alone. */
  readonly vision: HackathonEligibility;
  /** Stage-level classification of the NVIDIA construction-reasoning stage alone. */
  readonly reasoning: HackathonEligibility;
  /** Both stages, fully described. The UI renders this, not string matching. */
  readonly stages: readonly StageQualification[];
  /** Whether the NVIDIA requirement is met by the models that actually ran. */
  readonly nvidiaRequirement: NvidiaRequirement;
  /** The stage that carried the qualifying NVIDIA inference, or null. */
  readonly qualifyingStage: PipelineStage | null;
  /** The platform the qualifying inference ran through, or null. */
  readonly platform: string | null;
  /** One honest sentence, shown on screen. */
  readonly note: string;
  /** The end-to-end path, stated once, for the judge reading the page. */
  readonly qualificationPath: string;
}

const VISION_ROLE = 'Visual evidence extraction from the site photograph';
const REASONING_ROLE = 'Construction reasoning over that evidence and the comparison';

export function classifyPipelineEligibility(input: {
  readonly visionProvider: string;
  readonly visionModel: string;
  readonly reasoningProvider: string;
  readonly reasoningModel: string;
  readonly reasoningProduced: boolean;
  /** Defaults to true: a stage with no recorded outcome is treated as run. */
  readonly visionExecuted?: boolean;
}): PipelineEligibility {
  const visionExecuted = input.visionExecuted ?? true;
  const vision = classifyEligibility({
    provider: input.visionProvider,
    model: input.visionModel,
  });
  const reasoning = classifyReasoningEligibility({
    provider: input.reasoningProvider,
    model: input.reasoningModel,
    produced: input.reasoningProduced,
  });

  const visionStage = buildStage({
    stage: 'VISION',
    role: VISION_ROLE,
    provider: input.visionProvider,
    model: input.visionModel,
    classification: vision,
    produced: visionExecuted,
  });
  const reasoningStage = buildStage({
    stage: 'REASONING',
    role: REASONING_ROLE,
    provider: input.reasoningProvider,
    model: input.reasoningModel,
    classification: reasoning,
    produced: input.reasoningProduced,
  });

  if (vision === ELIGIBILITY_ELIGIBLE || reasoning === ELIGIBILITY_ELIGIBLE) {
    const viaReasoning = reasoning === ELIGIBILITY_ELIGIBLE;
    const qualifyingStage: PipelineStage = viaReasoning ? 'REASONING' : 'VISION';
    const qualifyingModel = viaReasoning ? input.reasoningModel : input.visionModel;
    const platform = inferencePlatformFor(
      viaReasoning ? input.reasoningProvider : input.visionProvider,
    );
    const visionStageFinal: StageQualification = viaReasoning
      ? {
          ...visionStage,
          note:
            `${input.visionModel} is not an NVIDIA model. It performs visual evidence extraction `
            + 'inside the hybrid pipeline; the qualifying NVIDIA inference is the reasoning stage.',
        }
      : visionStage;

    return {
      vision,
      reasoning,
      stages: [visionStageFinal, reasoningStage],
      nvidiaRequirement: 'MET',
      qualifyingStage,
      platform,
      note:
        `NVIDIA open-source inference ran on ${platform ?? 'the configured platform'}: the `
        + `${viaReasoning ? 'construction-reasoning' : 'visual'} stage used ${qualifyingModel}. `
        + `The visual stage used ${input.visionModel}, which is not an NVIDIA model.`,
      qualificationPath:
        `Visual evidence is produced by ${input.visionModel} and passed into `
        + `${qualifyingModel} for ${viaReasoning ? 'construction-specific reasoning' : 'visual analysis'}. `
        + `The qualifying NVIDIA inference runs through ${platform ?? 'the configured platform'}.`,
    };
  }

  if (vision === ELIGIBILITY_NOT_VERIFIED || reasoning === ELIGIBILITY_NOT_VERIFIED) {
    return {
      vision,
      reasoning,
      stages: [visionStage, reasoningStage],
      nvidiaRequirement: 'PARTIAL',
      qualifyingStage: null,
      platform: null,
      note:
        'An NVIDIA model id was in use but no verified NVIDIA output was produced for this run. '
        + 'Eligibility is reported per stage rather than claimed.',
      qualificationPath:
        'No qualifying NVIDIA inference completed on this run, so the NVIDIA requirement is '
        + 'reported as PARTIAL rather than met.',
    };
  }

  return {
    vision,
    reasoning,
    stages: [visionStage, reasoningStage],
    nvidiaRequirement: 'NOT_MET',
    qualifyingStage: null,
    platform: null,
    note: `No NVIDIA model produced output for this run. Vision used ${input.visionModel}.`,
    qualificationPath:
      'This run contains no NVIDIA open-source inference, so it does not satisfy the NVIDIA '
      + 'requirement.',
  };
}

function buildStage(input: {
  readonly stage: PipelineStage;
  readonly role: string;
  readonly provider: string;
  readonly model: string;
  readonly classification: HackathonEligibility;
  readonly produced: boolean;
}): StageQualification {
  const isNvidiaModel = isNvidiaModelId(input.model);
  const platform = inferencePlatformFor(input.provider);

  let note: string;
  if (input.classification === ELIGIBILITY_ELIGIBLE) {
    note = `NVIDIA open-source model. ${input.role.toLowerCase()}, called on ${platform ?? 'the configured platform'}.`;
  } else if (!isNvidiaModel) {
    note = `${input.model} is not an NVIDIA model.`;
  } else if (input.classification === ELIGIBILITY_NOT_VERIFIED) {
    note = input.produced
      ? `NVIDIA model id, not in the verified callable set. This run's output is not claimed as qualifying.`
      : `NVIDIA model id, but it produced no verified output for this run.`;
  } else {
    note = `${input.model} did not run, so it contributed nothing to this run.`;
  }

  return {
    stage: input.stage,
    role: input.role,
    provider: input.provider,
    model: input.model,
    isNvidiaModel,
    classification: input.classification,
    produced: input.produced,
    platform,
    note,
  };
}

/**
 * Operator-facing explanation of a VISION-stage classification.
 *
 * Strictly stage-scoped. It states what the model is, never what the submission
 * qualifies as, because the submission verdict is `classifyPipelineEligibility`
 * and the two must not be conflated in either direction.
 */
export function describeEligibility(eligibility: HackathonEligibility, model: string): string {
  switch (eligibility) {
    case ELIGIBILITY_ELIGIBLE:
      return `Verified NVIDIA vision model "${model}", confirmed callable on Nebius Token Factory with image input.`;
    case ELIGIBILITY_NOT_VERIFIED:
      return `NVIDIA model id "${model}" has not been confirmed callable on Nebius Token Factory with image input. Eligibility is NOT_VERIFIED until that is demonstrated live.`;
    default:
      return `Model "${model}" is not an NVIDIA model. It is the visual evidence stage of the hybrid pipeline; whether the NVIDIA requirement is met is decided by the whole pipeline, not by this stage.`;
  }
}