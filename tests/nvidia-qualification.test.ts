/**
 * The NVIDIA qualification contract, at all three levels.
 *
 * The defect these tests exist for: a run whose VISION model is not an NVIDIA
 * model was rendered with a prominent "NOT_ELIGIBLE" line and a sentence saying
 * the run does not satisfy the NVIDIA requirement, while the run DID satisfy it
 * through the NVIDIA construction-reasoning stage. Both facts were true. The
 * product showed the subordinate one at the top and buried the real verdict.
 *
 * Three questions are therefore locked apart here:
 *
 *   MODEL       is this model an NVIDIA model?
 *   STAGE       what did this stage contribute?
 *   SUBMISSION  does the run as a whole meet the requirement?
 *
 * And one rule that must survive all of it: MET is never reachable from a model
 * NAME alone. If no verified NVIDIA output was produced, the verdict is not MET.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  classifyEligibility,
  classifyPipelineEligibility,
  classifyReasoningEligibility,
  describeEligibility,
  inferencePlatformFor,
  isNvidiaModelId,
} from '../src/eligibility.ts';
import { DEFAULT_NEBIUS_MODEL } from '../src/config.ts';
import { DEFAULT_REASONING_MODEL } from '../src/config.ts';
import { InspectionSession } from '../src/session.ts';
import { UI_STRINGS } from '../src/localization.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { NemotronReasoner, UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { resolveReasoningConfig } from '../src/config.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import { demoCaptures } from '../src/captures.ts';
import { APP_JS, INDEX_HTML } from '../src/ui-assets.ts';

const VISION_PROVIDER = 'nebius-nvidia';
const REASONING_PROVIDER = 'nebius-nemotron-reasoner';

/* ------------------------------------------------------------------ CASE D --
   Model metadata. A model-level fact, with no reference to any run. */

test('CASE D: the vision model is not an NVIDIA model', () => {
  assert.equal(DEFAULT_NEBIUS_MODEL, 'openbmb/MiniCPM-V-4_5');
  assert.equal(isNvidiaModelId(DEFAULT_NEBIUS_MODEL), false);
});

test('CASE D: the reasoning model is an NVIDIA open-source model', () => {
  assert.equal(DEFAULT_REASONING_MODEL, 'nvidia/Nemotron-3-Ultra-550b-a55b');
  assert.equal(isNvidiaModelId(DEFAULT_REASONING_MODEL), true);
});

test('CASE D: the stage classification reports each model honestly', () => {
  assert.equal(
    classifyEligibility({ provider: VISION_PROVIDER, model: DEFAULT_NEBIUS_MODEL }),
    'NOT_ELIGIBLE',
  );
  assert.equal(
    classifyReasoningEligibility({
      provider: REASONING_PROVIDER,
      model: DEFAULT_REASONING_MODEL,
      produced: true,
    }),
    'ELIGIBLE',
  );
});

/* ------------------------------------------------------------------ CASE A --
   The current hybrid architecture, end to end through a real session. */

const VISION_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          elements: [
            {
              element: 'REBAR',
              present: true,
              confidence: 0.9,
              evidence: 'a dense bar mat fills the lower half of the frame',
              bounding_box: { x: 0.1, y: 0.45, width: 0.8, height: 0.45 },
            },
          ],
          observations: [
            {
              category: 'PROGRESS_OBSERVATION',
              observation: 'Reinforcement tying is in progress across the visible bay.',
              evidence: { description: 'hands working bar intersections mid-frame' },
              confidence: 0.8,
              severity: 'INFO',
              suggested_action: 'HUMAN_REVIEW',
            },
          ],
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
          summary: 'Reinforcement tying is in progress; the zone state cannot be settled from this frame.',
          whatMatters: 'Whether the mat is complete cannot be read from one photograph.',
          rationale: 'A dense mat is visible, but spacing, lap length and cover are not established '
            + 'by the image and the deterministic comparison returns UNDETERMINED.',
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

function stubFetch(body: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  return {
    calls,
    fetchImpl: async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
}

function hybridSession(options: { reasoning?: boolean } = {}): {
  session: InspectionSession;
  visionCalls: ReturnType<typeof stubFetch>['calls'];
  reasonCalls: ReturnType<typeof stubFetch>['calls'];
} {
  const vision = stubFetch(VISION_BODY);
  const reasoning = stubFetch(REASONING_BODY);

  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: DEFAULT_NEBIUS_MODEL,
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: vision.fetchImpl,
    env: {},
  });

  const reasoner =
    options.reasoning === false
      ? new UnavailableReasoner({ kind: 'DISABLED', message: 'off for this test' })
      : new NemotronReasoner({
          config: resolveReasoningConfig({ NEBIUS_REASONING_MODEL: DEFAULT_REASONING_MODEL }),
          credentials: { apiKey: 'test-key-not-real' },
          fetchImpl: reasoning.fetchImpl,
          env: {},
        });

  return {
    session: new InspectionSession(
      provider,
      demoCaptures()[0]!,
      'proj_test',
      'zone_level_02',
      defaultExpectedState(),
      { reasoner, projectName: 'North Core Construction' },
    ),
    visionCalls: vision.calls,
    reasonCalls: reasoning.calls,
  };
}

test('CASE A: the hybrid run meets the NVIDIA requirement', async () => {
  const { session, reasonCalls } = hybridSession();
  const view = await session.run();

  // The qualifying stage really ran: the request reached the reasoning endpoint
  // and its output was accepted, so MET rests on evidence, not on a config value.
  assert.equal(reasonCalls.length, 1);
  assert.equal(view.reasoning.status, 'AVAILABLE');
  assert.equal(view.reasoning.model, DEFAULT_REASONING_MODEL);

  const e = view.pipelineEligibility;
  assert.equal(e.nvidiaRequirement, 'MET');
  assert.equal(e.qualifyingStage, 'REASONING');
  assert.equal(e.platform, 'Nebius Token Factory');
});

test('CASE A: the vision stage is still reported as a non-NVIDIA model', async () => {
  const { session } = hybridSession();
  const view = await session.run();

  const vision = view.pipelineEligibility.stages.find((s) => s.stage === 'VISION');
  assert.ok(vision, 'the vision stage must always be described');
  assert.equal(vision.model, 'openbmb/MiniCPM-V-4_5');
  assert.equal(vision.isNvidiaModel, false);
  assert.equal(vision.classification, 'NOT_ELIGIBLE');

  // Subordinate in wording as well as in classification: the vision row states
  // what the model is, and does not assert anything about the run's verdict.
  assert.doesNotMatch(vision.note, /does not satisfy/i);
});

/* ------------------------------------------------------------------ CASE B --
   MiniCPM with no qualifying NVIDIA inference anywhere in the run. */

test('CASE B: MiniCPM on its own does NOT meet the NVIDIA requirement', async () => {
  const { session, reasonCalls } = hybridSession({ reasoning: false });
  const view = await session.run();

  assert.equal(reasonCalls.length, 0, 'no reasoning stage may be invented');
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.pipelineEligibility.nvidiaRequirement, 'NOT_MET');
  assert.equal(view.pipelineEligibility.qualifyingStage, null);
  assert.equal(view.pipelineEligibility.platform, null);
});

test('CASE B: the vision stage keeps working when reasoning is absent', async () => {
  const { session } = hybridSession({ reasoning: false });
  const view = await session.run();

  assert.equal(view.outcome, 'COMPLETED');
  assert.ok(view.detections.length > 0);
  assert.ok(view.pipelineEligibility.stages.some((s) => s.stage === 'REASONING' && s.produced === false));
});

/* ------------------------------------------------------------------ CASE C --
   Nemotron through Nebius is the qualifying stage. */

test('CASE C: Nemotron through Nebius Token Factory meets the requirement', () => {
  const e = classifyPipelineEligibility({
    visionProvider: VISION_PROVIDER,
    visionModel: 'openbmb/MiniCPM-V-4_5',
    reasoningProvider: REASONING_PROVIDER,
    reasoningModel: DEFAULT_REASONING_MODEL,
    reasoningProduced: true,
  });

  assert.equal(e.nvidiaRequirement, 'MET');
  assert.equal(e.qualifyingStage, 'REASONING');
  assert.equal(e.platform, 'Nebius Token Factory');
  assert.match(e.qualificationPath, /openbmb\/MiniCPM-V-4_5/);
  assert.match(e.qualificationPath, /nvidia\/Nemotron-3-Ultra-550b-a55b/);
  assert.match(e.qualificationPath, /Nebius Token Factory/);
});

/* -------------------------------------------------------- FAIL-CLOSED ------
   The rule that stops this feature becoming a rubber stamp. */

test('a configured NVIDIA name that produced nothing is NOT enough', () => {
  const e = classifyPipelineEligibility({
    visionProvider: VISION_PROVIDER,
    visionModel: 'openbmb/MiniCPM-V-4_5',
    reasoningProvider: REASONING_PROVIDER,
    reasoningModel: DEFAULT_REASONING_MODEL,
    reasoningProduced: false,
  });

  assert.notEqual(e.nvidiaRequirement, 'MET', 'a name alone must never qualify a run');
  assert.equal(e.nvidiaRequirement, 'PARTIAL', 'the NVIDIA id was in use but produced nothing');
  assert.equal(e.qualifyingStage, null);
});

test('an unverified NVIDIA id is never claimed, however it is configured', () => {
  const e = classifyPipelineEligibility({
    visionProvider: VISION_PROVIDER,
    visionModel: 'openbmb/MiniCPM-V-4_5',
    reasoningProvider: REASONING_PROVIDER,
    // Not in VERIFIED_REASONING_MODELS, so it is not claimed even when output
    // comes back. Callable-in-principle is not proven-usable.
    reasoningModel: 'nvidia/nemotron-3-nano-omni',
    reasoningProduced: true,
  });

  assert.equal(e.nvidiaRequirement, 'PARTIAL');
  assert.equal(e.qualifyingStage, null);
  assert.doesNotMatch(e.qualificationPath, /requirement is met/i);
});

test('the offline fixture never qualifies, at any stage', () => {
  const e = classifyPipelineEligibility({
    visionProvider: 'demo-fixture',
    visionModel: 'demo-fixture-vision-v1',
    reasoningProvider: 'unavailable',
    reasoningModel: 'none',
    reasoningProduced: false,
  });

  assert.equal(e.nvidiaRequirement, 'NOT_MET');
  assert.equal(e.platform, null);
});

test('only the Nebius providers are described as Nebius Token Factory', () => {
  assert.equal(inferencePlatformFor('nebius-nvidia'), 'Nebius Token Factory');
  assert.equal(inferencePlatformFor('nebius-nemotron-reasoner'), 'Nebius Token Factory');
  assert.equal(inferencePlatformFor('demo-fixture'), null);
  assert.equal(inferencePlatformFor('unavailable'), null);
});

/* ---------------------------------------------------------- STAGE-SCOPED --
   The model-level note must never read as a submission verdict. */

test('the vision-stage note never claims the run fails the requirement', () => {
  const note = describeEligibility('NOT_ELIGIBLE', 'openbmb/MiniCPM-V-4_5');
  assert.doesNotMatch(note, /does not satisfy/i);
  assert.doesNotMatch(note, /NOT_ELIGIBLE/);
  assert.match(note, /not an NVIDIA model/i);
  // And it points at the real question instead of answering it falsely.
  assert.match(note, /whole pipeline|reasoning stage/i);
});

test('the misleading sentence exists only where it is true', () => {
  // "does not satisfy the NVIDIA requirement" is a correct statement about a run
  // that contained no NVIDIA inference, and a false one about a hybrid run that
  // did. It is therefore permitted in exactly ONE place: the NOT_MET copy. It
  // must not appear anywhere the verdict could be MET.
  const phrase = /does not satisfy the NVIDIA requirement/i;

  const offenders = Object.entries(UI_STRINGS)
    .flatMap(([code, catalog]) => Object.keys(catalog)
      .filter((key) => phrase.test(catalog[key as keyof typeof catalog]))
      .map((key) => code + '.' + key));
  assert.deepEqual(offenders, ['en.qual.pathNotMet']);

  // And it must not be reachable from the MET or PARTIAL copy at all.
  const met = UI_STRINGS.en['qual.pathMet'];
  const partial = UI_STRINGS.en['qual.pathPartial'];
  assert.doesNotMatch(met, phrase);
  assert.doesNotMatch(partial, phrase);
  assert.match(met, /runs through/);

  // The vision-stage label never makes a submission-level claim, on either
  // surface. APP_JS embeds the catalog, so the phrase check above is the
  // authority on the wording; here only the removed LABEL is checked.
  assert.doesNotMatch(APP_JS, /Vision-stage eligibility/i);
  assert.doesNotMatch(INDEX_HTML, /Vision-stage eligibility/i);
  assert.doesNotMatch(INDEX_HTML, phrase);
});

/* ------------------------------------------------------------------ CASE E --
   The rendered Inspect page, executed rather than grepped. */

interface StubNode {
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  children: StubNode[];
  appendChild(child: StubNode): StubNode;
  removeChild(child: StubNode): void;
  get firstChild(): StubNode | null;
  text(): string;
}

function stubDocument(): { document: unknown; nodes: Map<string, StubNode> } {
  const nodes = new Map<string, StubNode>();

  function makeNode(tag: string): StubNode {
    const node: StubNode = {
      tagName: tag,
      className: '',
      textContent: '',
      hidden: false,
      dataset: {},
      children: [],
      appendChild(child: StubNode) {
        this.children.push(child);
        return child;
      },
      removeChild(child: StubNode) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
      },
      get firstChild() {
        return this.children.length > 0 ? (this.children[0] as StubNode) : null;
      },
      text(): string {
        if (this.children.length === 0) return this.textContent;
        return this.children.map((c) => c.text()).join(' ');
      },
    };
    return node;
  }

  const document = {
    createElement: (tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const node = makeNode('#text');
      node.textContent = text;
      return node;
    },
    getElementById: (id: string) => {
      const existing = nodes.get(id);
      if (existing) return existing;
      const created = makeNode('div');
      nodes.set(id, created);
      return created;
    },
  };

  for (const id of ['qualification', 'qual-verdict', 'qual-path', 'qual-stages']) {
    nodes.set(id, makeNode('div'));
  }

  return { document, nodes };
}

/** Run the real renderQualification() against a real view object. */
function renderQualification(view: unknown): { verdict: string; path: string; body: string } {
  const start = APP_JS.indexOf('function renderQualification(');
  assert.ok(start > -1, 'renderQualification must exist');
  const end = APP_JS.indexOf('\n}', start);
  const source = APP_JS.slice(start, end + 2);

  const { document, nodes } = stubDocument();
  const context: Record<string, unknown> = {
    document,
    state: { view },
    // renderQualification reads the localized projection for the panel copy and
    // falls back to the canonical strings when it is absent, which is exactly
    // the path a pre-localization view takes.
    localized: () => (view === null || typeof view !== 'object' || !('localized' in view)
      ? null
      : (view as { localized: Record<string, unknown> }).localized['en'] ?? null),
    // The real English catalog, so the panel copy is the real production copy.
    t: (key: string) => {
      const value = (UI_STRINGS.en as Record<string, string | undefined>)[key];
      return typeof value === 'string' ? value : key;
    },
    fillText: (template: string, params: Record<string, string | number>) =>
      String(template).replace(/\{(\w+)\}/g, (whole, token: string) => {
        const v = params[token];
        return v === undefined || v === null ? whole : String(v);
      }),
    el: (tag: string, cls: string | null, text?: string) => {
      const node = (document as { createElement: (t: string) => StubNode }).createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    },
    clear: (node: StubNode | null) => {
      if (node === null) return;
      while (node.firstChild) node.removeChild(node.firstChild);
    },
    $: (id: string) => nodes.get(id) ?? null,
  };
  vm.createContext(context);
  new vm.Script(source + '\nrenderQualification();').runInContext(context);

  return {
    verdict: (nodes.get('qual-verdict') as StubNode).text(),
    path: (nodes.get('qual-path') as StubNode).text(),
    body: [
      (nodes.get('qual-verdict') as StubNode).text(),
      (nodes.get('qual-path') as StubNode).text(),
      (nodes.get('qual-stages') as StubNode).text(),
    ].join('\n'),
  };
}

test('CASE E: the Inspect page leads with NVIDIA requirement: MET', async () => {
  const { session } = hybridSession();
  const view = await session.run();
  const rendered = renderQualification(view);

  // The verdict badge is the headline and reads MET on its own; the platform and
  // the qualifying stage each get their own row so the reader never has to parse
  // them out of a sentence.
  assert.equal(rendered.verdict.trim(), 'MET');
  assert.match(rendered.body, /Nebius Token Factory/);
  assert.match(rendered.body, /construction reasoning/i);
});

test('CASE E: the non-NVIDIA vision model stays visible and subordinate', async () => {
  const { session } = hybridSession();
  const view = await session.run();
  const rendered = renderQualification(view);

  assert.match(rendered.body, /openbmb\/MiniCPM-V-4_5/);
  assert.match(rendered.body, /NOT AN NVIDIA MODEL/);
  assert.match(rendered.body, /nvidia\/Nemotron-3-Ultra-550b-a55b/);
  assert.match(rendered.body, /NVIDIA MODEL/);
  // The verdict is stated once, as the headline, and the vision stage never
  // contradicts it.
  assert.doesNotMatch(rendered.body, /does not satisfy/i);
});

test('CASE E: the qualification path names the whole hybrid chain', async () => {
  const { session } = hybridSession();
  const view = await session.run();
  const rendered = renderQualification(view);

  assert.match(rendered.path, /Visual evidence is produced by openbmb\/MiniCPM-V-4_5/);
  assert.match(rendered.path, /nvidia\/Nemotron-3-Ultra-550b-a55b/);
  assert.match(rendered.path, /Nebius Token Factory/);
});

test('CASE E: with no reasoning stage the page says NOT MET, not MET', async () => {
  const { session } = hybridSession({ reasoning: false });
  const view = await session.run();
  const rendered = renderQualification(view);

  assert.match(rendered.verdict, /^NOT MET/);
});

test('CASE E: the verdict element exists in the markup and is not pre-baked', () => {
  assert.match(INDEX_HTML, /id="qualification"/);
  assert.match(INDEX_HTML, /id="qual-verdict"/);
  assert.match(INDEX_HTML, /id="qual-stages"/);
  // No hard-coded verdict in the static markup: it can only come from a run.
  assert.doesNotMatch(INDEX_HTML, /NVIDIA requirement: MET/);
});