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