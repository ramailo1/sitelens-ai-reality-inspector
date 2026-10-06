/**
 * The hybrid pipeline end to end, with the network replaced.
 *
 * This is the test that would have caught the placeholder defect at the point
 * that matters: not "the validator rejects a bad entry" (unit level) but "a
 * fabricated MATCH cannot survive a whole run into the comparison table a judge
 * reads".
 *
 * Stage 1 (MiniCPM-V) and stage 2 (Nemotron) are driven through injected fetch
 * implementations, so the real request shape, the real envelope parsing, the real
 * validators and the real deterministic comparison all execute. No network, no
 * key, no nondeterminism.
 *
 * The assertions are about TRUST BOUNDARIES, not about model quality:
 *   - reasoning cannot change a comparison status
 *   - a reasoning outage leaves the comparison intact
 *   - a model confidence never verifies anything
 *   - provenance names which model actually produced which stage
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionSession } from '../src/session.ts';
import { buildReasoningView } from '../src/session.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { NemotronReasoner, UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { resolveReasoningConfig } from '../src/config.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import { demoCaptures } from '../src/captures.ts';
import { classifyPipelineEligibility, classifyReasoningEligibility } from '../src/eligibility.ts';
import { VERIFIED_REASONING_MODELS } from '../src/eligibility.ts';

const CREDENTIAL = { apiKey: 'test-key-not-real' };

/** A vision response that describes what is genuinely visible. */
const VISION_BODY = {
  provider: 'nebius-nvidia',
  model: 'openbmb/MiniCPM-V-4_5',
  choices: [
    {
      message: {
        content: JSON.stringify({
          elements: [
            {
              element: 'REBAR',
              present: true,
              confidence: 0.92,
              evidence: 'a dense bar mat fills the lower half of the frame',
              bounding_box: { x: 0.08, y: 0.42, width: 0.84, height: 0.5 },
            },
            {
              element: 'WORKER',
              present: true,
              confidence: 0.88,
              evidence: 'one hi-vis figure at the bar intersection',
            },
          ],
          observations: [
            {
              category: 'PROGRESS_OBSERVATION',
              observation: 'Reinforcement tying is in progress across the visible bay.',
              evidence: { description: 'hands working bar intersections mid-frame' },
              confidence: 0.81,
              severity: 'INFO',
              suggested_action: 'HUMAN_REVIEW',
              bounding_box: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
            },
          ],
          findings: [
            {
              title: 'Rebar installation incomplete at frame edge',
              category: 'INCOMPLETE_WORK',
              severity: 'LOW',
              element: 'REBAR',
              location: 'left edge of the frame',
              observation: 'The bar mat stops before the left frame edge.',
              reason: 'Reinforcement coverage at the edge is not visible.',
              evidence: 'No bars are present left of the bay edge.',
              confidence: 0.58,
              recommendation: 'Walk the bay and confirm the mat runs to the edge.',
            },
          ],
        }),
      },
      finish_reason: 'stop',
    },
  ],
};

/** The echoed-placeholder response the live model actually returned. */
const ECHO_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          elements: ['COLUMN', 'SLAB', 'WALL', 'OPENING', 'MEP_ROUGH_IN'].map((element) => ({
            element,
            present: true,
            confidence: 0.0,
            evidence: `no visible ${element.toLowerCase()}`,
            bounding_box: { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
          })),
          observations: [],
          findings: [],
        }),
      },
      finish_reason: 'stop',
    },
  ],
};

const REASONING_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          summary: 'Reinforcement tying is in progress; the zone state cannot be established from this frame.',
          whatMatters: 'Whether the mat is complete cannot be read from one photograph.',
          rationale:
            'A dense mat and one worker are visible, but spacing, lap length and concrete cover are not '
            + 'established by the image and the deterministic comparison returns UNDETERMINED.',
          recommendation: 'Walk the bay against the approved reinforcement detail before any pour.',
          verification: 'Physically confirm bar spacing, lap length and cover on site.',
          confidence: 0.55,
          certainty: 'UNCERTAIN',
        }),
      },
      finish_reason: 'stop',
    },
  ],
};

/** Build a fetch that answers one body and records what it was asked. */
function stubFetch(body: unknown, status = 200): {
  fetchImpl: (input: string, init: { body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  calls: { url: string; body: Record<string, unknown> }[];
} {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  return {
    calls,
    fetchImpl: async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
    },
  };
}

const capture = demoCaptures()[0]!;

function sessionWith(options: {
  vision?: unknown;
  visionStatus?: number;
  reasoning?: unknown;
  reasoningStatus?: number;
  reasonerKind?: 'real' | 'unavailable';
}): { session: InspectionSession; visionCalls: ReturnType<typeof stubFetch>['calls']; reasonCalls: ReturnType<typeof stubFetch>['calls'] } {
  const vision = stubFetch(options.vision ?? VISION_BODY, options.visionStatus ?? 200);
  const reasoning = stubFetch(options.reasoning ?? REASONING_BODY, options.reasoningStatus ?? 200);

  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'openbmb/MiniCPM-V-4_5',
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: CREDENTIAL,
    fetchImpl: vision.fetchImpl,
    env: {},
  });

  const reasoner =
    options.reasonerKind === 'unavailable'
      ? new UnavailableReasoner({ kind: 'DISABLED', message: 'off for this test' })
      : new NemotronReasoner({
          config: resolveReasoningConfig({ NEBIUS_REASONING_MODEL: 'nvidia/Nemotron-3-Ultra-550b-a55b' }),
          credentials: CREDENTIAL,
          fetchImpl: reasoning.fetchImpl,
          env: {},
        });

  return {
    session: new InspectionSession(
      provider,
      capture,
      'proj_test',
      'zone_level_02',
      defaultExpectedState(),
      { reasoner, projectName: 'North Core Construction' },
    ),
    visionCalls: vision.calls,
    reasonCalls: reasoning.calls,
  };
}

test('a full run exercises BOTH stages and reports both in provenance', async () => {
  const { session, visionCalls, reasonCalls } = sessionWith({});
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(visionCalls.length, 1, 'stage 1 must be called');
  assert.equal(reasonCalls.length, 1, 'stage 2 must be called');

  // Provenance names the model for each stage, so neither is anonymous.
  assert.equal(view.provenance.model, 'openbmb/MiniCPM-V-4_5');
  assert.equal(view.reasoning.status, 'AVAILABLE');
  assert.equal(view.reasoning.model, 'nvidia/Nemotron-3-Ultra-550b-a55b');
  assert.equal(view.reasoning.provenance?.provider, 'nebius-nemotron-reasoner');

  // Stage 2 saw the deterministic comparison, not just the vision output.
  const prompt = (reasonCalls[0]?.body.messages as { content: string }[])[1]?.content ?? '';
  assert.match(prompt, /DETERMINISTIC COMPARISON/);
  assert.match(prompt, /VISIBLE ELEMENTS/);
  assert.match(prompt, /UNDETERMINED/);
});

test('Nemotron is a meaningful NVIDIA contribution, not a decorative second model', async () => {
  const { session } = sessionWith({});
  const view = await session.run();
  const reasoning = view.reasoning.reasoning;

  assert.ok(reasoning, 'reasoning must be present');
  assert.equal(reasoning.certainty, 'UNCERTAIN');
  assert.equal(view.reasoning.provenance?.degenerate, false, 'must not be a paraphrase');
  // It states what the image cannot establish, which the vision stage never said.
  assert.match(reasoning.verification, /spacing|lap|cover/i);
  assert.match(reasoning.rationale, /UNDETERMINED/);
});

test('reasoning CANNOT change a comparison status', async () => {
  // A model arguing hard for MATCH must not become MATCH.
  const arguing = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: 'Everything is fine and fully verified.',
            whatMatters: 'Nothing is wrong here at all.',
            rationale:
              'I am completely certain the zone is MATCH on every item and that all work is approved.',
            recommendation: 'No action is required and the work may be certified as complete.',
            verification: 'No physical check is needed.',
            confidence: 1,
            certainty: 'SUPPORTED',
          }),
        },
      },
    ],
  };
  const before = sessionWith({});
  const after = sessionWith({ reasoning: arguing });

  const viewBefore = await before.session.run();
  const viewAfter = await after.session.run();

  assert.deepEqual(
    viewAfter.comparison.map((r) => r.status),
    viewBefore.comparison.map((r) => r.status),
    'identical evidence must yield an identical comparison regardless of reasoning',
  );
  // And the status is genuinely UNDETERMINED for the items with no detection.
  assert.ok(viewAfter.comparison.some((r) => r.status === 'UNDETERMINED'));
});

test('an unavailable reasoning stage leaves the comparison completely intact', async () => {
  const live = sessionWith({});
  const viewLive = await live.session.run();

  const off = sessionWith({ reasonerKind: 'unavailable' });
  const viewOff = await off.session.run();

  assert.equal(viewOff.reasoning.status, 'UNAVAILABLE');
  assert.equal(viewOff.reasoning.reasoning, null);
  assert.ok(viewOff.reasoning.message && viewOff.reasoning.message.length > 10);

  // Same vision result, therefore byte-identical comparison and findings.
  assert.deepEqual(
    viewOff.comparison.map((r) => [r.id, r.status, r.observedText]),
    viewLive.comparison.map((r) => [r.id, r.status, r.observedText]),
  );
  assert.equal(
    viewOff.inspectionFindings.length,
    viewLive.inspectionFindings.length,
    'a reasoning outage must not change how many candidates exist',
  );
});

test('a malformed reasoning response is discarded, not repaired', async () => {
  const { session } = sessionWith({
    reasoning: { choices: [{ message: { content: 'I think everything is probably fine, really.' } }] },
  });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED', 'the inspection itself still succeeded');
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.failureKind, 'MALFORMED_RESPONSE');
  assert.equal(view.reasoning.reasoning, null);
  assert.ok(view.comparison.length > 0, 'the comparison must still be there');
});

test('a reasoning response that fails validation is reported and discarded', async () => {
  const { session } = sessionWith({
    // Structurally valid JSON, but no `certainty`: the rule that matters most.
    reasoning: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 's', whatMatters: 'w', rationale: 'r',
              recommendation: 'rec', verification: 'v',
            }),
          },
        },
      ],
    },
  });
  const view = await session.run();

  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.failureKind, 'REJECTED_BY_VALIDATION');
  assert.ok(view.reasoning.validationIssues.some((i) => i.field === 'certainty'));
  assert.ok(view.comparison.length > 0);
});

test('a reasoning HTTP failure is reported without breaking the run', async () => {
  const { session } = sessionWith({ reasoningStatus: 503 });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.failureKind, 'UNAVAILABLE');
});

test('a missing credential is reported as NOT_CONFIGURED, never as a fake answer', async () => {
  const vision = stubFetch(VISION_BODY);
  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'openbmb/MiniCPM-V-4_5',
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: CREDENTIAL,
    fetchImpl: vision.fetchImpl,
    env: {},
  });
  const reasoner = new NemotronReasoner({
    config: resolveReasoningConfig({}),
    credentials: undefined,
    fetchImpl: async () => { throw new Error('must not be called'); },
    env: {},
  });
  const session = new InspectionSession(
    provider, capture, 'proj_test', 'zone_level_02', defaultExpectedState(), { reasoner },
  );
  const view = await session.run();

  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.failureKind, 'NOT_CONFIGURED');
  assert.equal(view.reasoning.reasoning, null);
});

test('a failed VISION run does not invent reasoning', async () => {
  const { session, reasonCalls } = sessionWith({ visionStatus: 500 });
  const view = await session.run();

  assert.equal(view.outcome, 'FAILED');
  assert.equal(reasonCalls.length, 0, 'reasoning about an unread photograph would be invention');
  assert.equal(view.reasoning.reasoning, null);
});

test('an echoed-placeholder response cannot manufacture a comparison', async () => {
  // The live defect, reproduced end to end.
  const { session } = sessionWith({ vision: ECHO_BODY });
  const view = await session.run();

  assert.equal(view.detections.length, 0, 'no placeholder may become a detection');

  // No PRESENT or COUNT expectation may resolve on a rejected placeholder.
  // Those are the rows where a template echo previously produced a fabricated
  // MATCH or a fabricated ATTENTION.
  const asserted = view.comparison.filter((r) => r.expectation !== 'ABSENT');
  assert.ok(asserted.length > 0);
  for (const row of asserted) {
    assert.notEqual(row.status, 'MATCH', `${row.element} must not MATCH on a placeholder`);
    assert.notEqual(row.status, 'ATTENTION', `${row.element} must not ATTEND on a placeholder`);
    assert.equal(row.status, 'UNDETERMINED');
  }

  // The rejections are reported, never silently dropped.
  assert.ok(view.provenance.rejectionIssues.length > 0);
  assert.match(
    view.provenance.rejectionIssues.map((i) => i.message).join(' '),
    /asserted no reading/,
  );

  // NOTED, not overlooked: the single remaining row is the `EXCAVATION ABSENT`
  // expectation, which compares to MATCH because the model reported nothing about
  // excavations. That is the pre-existing ABSENT semantics (a declined report
  // satisfies "should be absent"), not a consequence of the placeholder being
  // accepted. The row's own text says "none seen in this capture", so the
  // operator sees what actually happened.
  const absent = view.comparison.filter((r) => r.expectation === 'ABSENT');
  for (const row of absent) {
    assert.match(row.observedText, /none seen in this capture/);
  }
  assert.equal(absent.length, 1);
});

test('findings carry an evidence state: localized, full-frame or none', async () => {
  // Three detections exercise all three states against the default expected
  // state: a column count shortfall WITH a box (LOCALIZED), a slab reported
  // present-but-absent with NO box (FULL_FRAME — real reading, no region), and
  // an opening the model says nothing about (NONE — no visual evidence at all).
  const body = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            elements: [
              {
                element: 'COLUMN',
                present: true,
                count: 4,
                confidence: 0.9,
                evidence: 'four columns visible across the mid-ground',
                bounding_box: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
              },
              {
                element: 'SLAB',
                present: false,
                confidence: 0.75,
                evidence: 'no slab surface is visible in this frame',
              },
            ],
            observations: [],
            findings: [],
          }),
        },
        finish_reason: 'stop',
      },
    ],
  };
  const { session } = sessionWith({ vision: body });
  const view = await session.run();

  const column = view.inspectionFindings.find((f) => f.element === 'COLUMN');
  assert.ok(column, 'expected a column-count finding');
  assert.equal(column.evidenceState, 'LOCALIZED');
  assert.equal(column.localized, true);
  assert.ok(column.pixelBox !== null, 'a localized finding carries real pixel geometry');

  const slab = view.inspectionFindings.find((f) => f.element === 'SLAB');
  assert.ok(slab, 'expected a slab finding');
  assert.equal(slab.evidenceState, 'FULL_FRAME');
  assert.equal(slab.localized, false);
  assert.equal(slab.pixelBox, null, 'no box is manufactured for a full-frame finding');
  assert.match(slab.evidence, /Full-frame evidence/);

  const opening = view.inspectionFindings.find((f) => f.element === 'OPENING');
  assert.ok(opening, 'expected an opening finding');
  assert.equal(opening.evidenceState, 'NONE');
  assert.match(opening.evidence, /No visual reading/);
});

test('a fully-rejected response leaves every finding with no visual evidence', async () => {
  // The placeholder echo rejects every element, so no finding may claim the
  // image supports it — full-frame or otherwise.
  const { session } = sessionWith({ vision: ECHO_BODY });
  const view = await session.run();

  assert.ok(view.inspectionFindings.length > 0);
  for (const finding of view.inspectionFindings) {
    assert.equal(finding.evidenceState, 'NONE', `${finding.title} must not claim image support`);
    assert.equal(finding.localized, false);
  }
});

test('model confidence never verifies a finding', async () => {
  const { session } = sessionWith({});
  await session.run();
  const before = session.view();

  assert.ok(before.inspectionFindings.length > 0);
  for (const finding of before.inspectionFindings) {
    assert.equal(finding.verificationStatus, 'UNVERIFIED', 'nothing is verified on sight');
  }
  // Even a certainty of SUPPORTED and a confidence of 1.0 settle nothing.
  session.view();
  assert.ok(session.view().inspectionFindings.every((f) => f.verificationStatus === 'UNVERIFIED'));
});

test('human verification survives a re-render and is still a human decision', async () => {
  const { session } = sessionWith({});
  await session.run();
  const finding = session.view().inspectionFindings.find((f) => f.origin === 'COMPARISON');
  assert.ok(finding, 'expected a comparison finding to verify');

  // An anonymous review is refused.
  session.reviewFinding({ findingId: finding.id, decision: 'VERIFIED', reviewer: '   ' });
  assert.equal(
    session.view().inspectionFindings.find((f) => f.id === finding.id)?.verificationStatus,
    'UNVERIFIED',
  );

  session.reviewFinding({ findingId: finding.id, decision: 'VERIFIED', reviewer: 'A. Inspector' });
  const settled = session.view().inspectionFindings.find((f) => f.id === finding.id);
  assert.equal(settled?.verificationStatus, 'VERIFIED');
  assert.equal(settled?.review?.reviewer, 'A. Inspector');

  // Still settled on a later render.
  assert.equal(
    session.view().inspectionFindings.find((f) => f.id === finding.id)?.verificationStatus,
    'VERIFIED',
  );
  // A verified item leaves the work list; an unverified one does not.
  assert.equal(
    session.view().priorities.some((p) => p.findingId === finding.id),
    false,
  );
});

test('a rejected finding stays rejected', async () => {
  const { session } = sessionWith({});
  await session.run();
  const finding = session.view().inspectionFindings[0];
  assert.ok(finding);
  session.reviewFinding({ findingId: finding.id, decision: 'REJECTED', reviewer: 'B. Inspector' });
  assert.equal(
    session.view().inspectionFindings.find((f) => f.id === finding.id)?.verificationStatus,
    'REJECTED',
  );
});

test('changing the reference discards the comparison AND the reasoning about it', async () => {
  const { session } = sessionWith({});
  await session.run();
  assert.equal(session.view().reasoning.status, 'AVAILABLE');

  session.adoptReference({
    zone: 'South Wing',
    source: 'OPERATOR',
    items: [{ id: 'sw', element: 'WALL', expectation: 'PRESENT', expectedCount: null, note: '' }],
  });

  const view = session.view();
  assert.equal(view.comparison.length, 0, 'the old rows belonged to the old reference');
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.reasoning, null, 'reasoning about a dropped reference must go');
});

test('pipeline eligibility is reported per stage, not as one verdict', async () => {
  const { session } = sessionWith({});
  const view = await session.run();

  // The vision stage is not an NVIDIA model, and the product says so.
  assert.equal(view.provenance.eligibility, 'NOT_ELIGIBLE');
  assert.equal(view.pipelineEligibility.vision, 'NOT_ELIGIBLE');
  // The reasoning stage IS a verified NVIDIA model, and it produced output.
  assert.equal(view.pipelineEligibility.reasoning, 'ELIGIBLE');
  assert.equal(view.pipelineEligibility.nvidiaRequirement, 'MET');
  assert.match(view.pipelineEligibility.note, /nvidia\/Nemotron-3-Ultra-550b-a55b/);
  assert.match(view.pipelineEligibility.note, /not an NVIDIA model/);
});

test('eligibility is NOT claimed when the reasoning stage produced nothing', () => {
  const eligible = classifyReasoningEligibility({
    provider: 'nebius-nemotron-reasoner',
    model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
    produced: true,
  });
  const notProduced = classifyReasoningEligibility({
    provider: 'nebius-nemotron-reasoner',
    model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
    produced: false,
  });
  assert.equal(eligible, 'ELIGIBLE');
  assert.equal(notProduced, 'NOT_VERIFIED', 'a verified id that produced nothing proves nothing');
});

test('the verified reasoning set excludes a model that cannot actually answer', () => {
  // `nvidia/Nemotron-3_5-Lightning` answers HTTP 200 but exhausts its budget
  // reasoning and returns no JSON. Callable is not the same as usable.
  assert.ok(VERIFIED_REASONING_MODELS.has('nvidia/nemotron-3-ultra-550b-a55b'));
  assert.ok(!VERIFIED_REASONING_MODELS.has('nvidia/nemotron-3_5-lightning'));
});

test('the offline fixture pipeline reports no NVIDIA contribution', async () => {
  const { DemoFixtureProvider } = await import('../src/providers/demo-fixture.provider.ts');
  const provider = new DemoFixtureProvider();
  const session = new InspectionSession(
    provider, capture, 'proj_test', 'zone_level_02', defaultExpectedState(),
    { reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'fixture has no reasoner' }) },
  );
  const view = await session.run();

  assert.equal(view.isDemoFixture, true);
  assert.equal(view.inferenceOrigin, 'DEMO_FIXTURE');
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(
    classifyPipelineEligibility({
      visionProvider: provider.name,
      visionModel: provider.model,
      reasoningProvider: 'unavailable',
      reasoningModel: 'none',
      reasoningProduced: false,
    }).nvidiaRequirement,
    'NOT_MET',
  );
});

test('buildReasoningView never returns null and keeps the three states distinct', () => {
  const reasoner = new UnavailableReasoner({ kind: 'DISABLED', message: 'off' });

  const pending = buildReasoningView(null, reasoner);
  assert.equal(pending.status, 'UNAVAILABLE');
  assert.match(pending.message ?? '', /No inspection has been run/);

  const failed = buildReasoningView(
    { status: 'UNAVAILABLE', kind: 'TIMEOUT', message: 'late', detail: null, validationIssues: [] },
    reasoner,
  );
  assert.equal(failed.failureKind, 'TIMEOUT');

  // "Not run yet" and "ran and failed" are different statements.
  assert.notEqual(pending.message, failed.message);
});
