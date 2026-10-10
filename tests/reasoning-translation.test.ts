/**
 * Live reasoning translation: novel Nemotron prose in Arabic, French and Chinese.
 *
 * The 47-entry offline memory cannot translate what it has never seen, and live
 * Nemotron reasoning is novel on every run - so without a live tier the Arabic
 * interface showed English reasoning with an honest "translation unavailable"
 * fallback. This file proves the live tier added for it:
 *
 *   - novel reasoning translates to ar/fr/zh through the already-configured
 *     Nebius chat path (stubbed fetch: no paid calls, deterministic);
 *   - the whole reasoning section is localized, with the original reachable;
 *   - misses fall back honestly; failures corrupt nothing and fail no run;
 *   - language switches and re-renders cost no vision, reasoning or
 *     translation call; restores reuse the cache; changed sources invalidate;
 *   - technical tokens (ATTENTION, grid refs, counts) survive translation;
 *   - a reasoning headline that launders a planned-state note ("substantially
 *     complete") into apparent fact is rejected at the source while the
 *     deterministic comparison stays exactly as computed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  INSPECTION_LANGUAGES,
  UI_STRINGS,
} from '../src/localization.ts';
import {
  LIVE_TRANSLATION_VERSION,
  NebiusChatTranslator,
  buildTranslationPrompt,
  clearLiveTranslationCache,
  createTranslatorFromEnv,
  liveTranslationCacheSize,
  normalizeTranslatedConstructionTerms,
  parseTranslationResponse,
  resolveDisplayTranslation,
  translateModelText,
  translateModelTextsLive,
} from '../src/model-translation.ts';
import type {
  ModelTranslationTarget,
  ModelTranslator,
} from '../src/model-translation.ts';
import {
  buildReasoningContext,
  echoesExpectedNote,
} from '../src/reasoning.ts';
import type {
  ConstructionReasoning,
  ReasoningOutcome,
} from '../src/reasoning.ts';
import { NemotronReasoner, buildReasoningPrompt } from '../src/providers/nemotron-reasoner.ts';
import type { Reasoner } from '../src/providers/nemotron-reasoner.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { InspectionSession } from '../src/session.ts';
import { compareExpectedState } from '../src/compare.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import type { ExpectedState } from '../src/types/inspection.ts';
import { demoCaptures } from '../src/captures.ts';
import { APP_JS } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * Novel fixtures. Every sentence below is absent from the offline memory
 * on purpose: these tests prove the LIVE tier, so a memory hit would be a
 * false pass. Distinct wording per area keeps the shared live cache from
 * leaking between tests.
 * ------------------------------------------------------------------ */

const NOVEL_OBSERVATION = 'A tower crane jib extends over the northern edge of the deck.';
const NOVEL_EVIDENCE = 'The horizontal jib is visible against the sky above the deck edge.';
const NOVEL_FINDING_TITLE = 'Tower crane oversail past the northern edge';
const NOVEL_FINDING_OBSERVATION = 'The crane jib passes beyond the site boundary to the north.';
const NOVEL_FINDING_REASON = 'Oversail requires a confirmed agreement with the neighbouring plot.';
const NOVEL_FINDING_EVIDENCE = 'The jib tip is visible past the hoarding line in the upper frame.';
const NOVEL_FINDING_RECOMMENDATION = 'Confirm oversail rights with the site office before lifting over the boundary.';
const NOVEL_FINDING_LOCATION = 'bay 3 near grid C1-C12';
const NOVEL_SUMMARY = 'The deck edge work is active and the northern boundary cannot be settled from one frame.';
const NOVEL_WHAT_MATTERS = 'Whether the crane may oversail the neighbouring plot is not readable here.';
const NOVEL_RATIONALE = 'The jib is visible past the boundary and the comparison returns ATTENTION, '
  + 'but permits and agreements are not established by the image.';
const NOVEL_RECOMMENDATION = 'Hold lifts over the boundary until the oversail agreement is confirmed.';
const NOVEL_VERIFICATION = 'Confirm the oversail position and agreement papers with the site office.';
const NOVEL_DETECTION_EVIDENCE = 'A tower crane jib is visible in the upper frame.';

const AR_SUMMARY = 'أعمال حافة السطح نشطة ولا يمكن حسم الحد الشمالي من صورة واحدة.';
const AR_WHAT_MATTERS = 'ما إذا كان مسموحًا للرافعة بتجاوز حدود القطعة المجاورة غير قابل للقراءة هنا.';
const AR_RATIONALE = 'الذراع ظاهر خلف الحد وتعيد المقارنة ATTENTION، لكن التصاريح والاتفاقيات لا تثبتها الصورة.';
const AR_RECOMMENDATION = 'أوقف الرفع فوق الحد حتى يتم تأكيد اتفاقية التجاوز.';
const AR_VERIFICATION = 'تأكد من موضع التجاوز وأوراق الاتفاقية مع مكتب الموقع.';
const AR_OBSERVATION = 'يمتد ذراع رافعة برجية فوق الحافة الشمالية للسطح.';
const AR_LOCATION = 'الباكية 3 قرب الشبكة C1-C12';
const FR_SUMMARY = "Les travaux de rive sont actifs et la limite nord ne peut être tranchée sur une seule image.";
const ZH_SUMMARY = '楼板边缘作业正在进行，单张影像无法判定北侧边界。';

function novelVisionBody() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            elements: [
              {
                element: 'EQUIPMENT', present: true, count: null, confidence: 0.7,
                evidence: NOVEL_DETECTION_EVIDENCE,
              },
            ],
            observations: [
              {
                category: 'OBSERVED_ELEMENT',
                observation: NOVEL_OBSERVATION,
                evidence: { description: NOVEL_EVIDENCE },
                confidence: 0.81, severity: 'INFO', suggested_action: 'NO_ACTION',
              },
            ],
            findings: [
              {
                title: NOVEL_FINDING_TITLE,
                category: 'COORDINATION',
                severity: 'LOW',
                observation: NOVEL_FINDING_OBSERVATION,
                reason: NOVEL_FINDING_REASON,
                evidence: NOVEL_FINDING_EVIDENCE,
                confidence: 0.66,
                recommendation: NOVEL_FINDING_RECOMMENDATION,
                element: 'EQUIPMENT',
                location: NOVEL_FINDING_LOCATION,
              },
            ],
          }),
        },
        finish_reason: 'stop',
      },
    ],
  };
}

function novelReasoning(): ConstructionReasoning {
  return {
    summary: NOVEL_SUMMARY,
    whatMatters: NOVEL_WHAT_MATTERS,
    rationale: NOVEL_RATIONALE,
    recommendation: NOVEL_RECOMMENDATION,
    verification: NOVEL_VERIFICATION,
    confidence: 0.54,
    certainty: 'UNCERTAIN',
  };
}

class StubReasoner implements Reasoner {
  public readonly name = 'stub-reasoner';
  public readonly model = 'stub-reasoner-v1';
  public readonly configured = true;
  private readonly outcome: ReasoningOutcome;
  public constructor(outcome: ReasoningOutcome) {
    this.outcome = outcome;
  }
  public async reason(): Promise<ReasoningOutcome> {
    return this.outcome;
  }
}

/** Deterministic stand-in for the live translator: canned hits, honest misses. */
class StubTranslator implements ModelTranslator {
  public readonly name = 'stub-translator';
  public readonly calls: { texts: readonly string[]; target: ModelTranslationTarget }[] = [];
  private readonly dictionary: Readonly<Record<string, Partial<Record<ModelTranslationTarget, string>>>>;
  public constructor(
    dictionary: Readonly<Record<string, Partial<Record<ModelTranslationTarget, string>>>>,
  ) {
    this.dictionary = dictionary;
  }
  public async translate(
    texts: readonly string[],
    target: ModelTranslationTarget,
  ): Promise<ReadonlyMap<string, string>> {
    this.calls.push({ texts, target });
    const out = new Map<string, string>();
    for (const text of texts) {
      const hit = this.dictionary[text]?.[target];
      if (typeof hit === 'string' && hit.trim().length > 0) out.set(text, hit);
    }
    return out;
  }
}

function arabicDictionary(): Record<string, Partial<Record<ModelTranslationTarget, string>>> {
  return {
    [NOVEL_SUMMARY]: { ar: AR_SUMMARY, fr: FR_SUMMARY, zh: ZH_SUMMARY },
    [NOVEL_WHAT_MATTERS]: { ar: AR_WHAT_MATTERS },
    [NOVEL_RATIONALE]: { ar: AR_RATIONALE },
    [NOVEL_RECOMMENDATION]: { ar: AR_RECOMMENDATION },
    [NOVEL_VERIFICATION]: { ar: AR_VERIFICATION },
    [NOVEL_OBSERVATION]: { ar: AR_OBSERVATION },
    [NOVEL_FINDING_LOCATION]: { ar: AR_LOCATION },
  };
}

function stubVisionFetch(calls: unknown[]) {
  return async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body) as unknown);
    return { ok: true, status: 200, text: async () => JSON.stringify(novelVisionBody()) };
  };
}

async function runNovelInspection(translator: ModelTranslator | null) {
  const visionCalls: unknown[] = [];
  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'test-vision-model',
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: stubVisionFetch(visionCalls),
  });
  const reasoner = new StubReasoner({
    status: 'AVAILABLE',
    reasoning: novelReasoning(),
    provenance: {
      model: 'stub-reasoner-v1',
      provider: 'stub-reasoner',
      reasonedAt: new Date().toISOString(),
      latencyMs: 5,
      rowsConsidered: 1,
      detectionsConsidered: 1,
      degenerate: false,
    },
  });
  const session = new InspectionSession(
    provider,
    demoCaptures()[0]!,
    'proj_novel',
    'zone_level_02',
    defaultExpectedState(),
    { reasoner, projectName: 'North Core Construction', translator },
  );
  const view = await session.run();
  return { session, view, visionCalls };
}

/* ------------------------------------------------------------------ *
 * The live translator itself: one validated call, honest failures.
 * ------------------------------------------------------------------ */

test('a novel batch translates in one call with a validated structure', async () => {
  const requests: { url: string; body: string }[] = [];
  const translator = new NebiusChatTranslator({
    baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
    model: 'test-reasoning-model',
    timeoutMs: 5000,
    maxTokens: 2000,
    apiKey: 'test-key-not-real',
    fetchImpl: (async (url: string, init: { body: string }) => {
      requests.push({ url, body: JSON.parse(init.body) as unknown as string });
      const payload = JSON.parse(init.body) as { messages: { content: string }[] };
      const asked = (JSON.parse(payload.messages[1]!.content) as { texts: string[] }).texts;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ translations: asked.map((t) => `AR:${t}`) }) } }],
        }),
      };
    }) as never,
  });
  const out = await translator.translate(['alpha crane reading', 'beta edge note'], 'ar');
  assert.equal(requests.length, 1, 'one batched call, not one per string');
  assert.equal(out.get('alpha crane reading'), 'AR:alpha crane reading');
  assert.equal(out.get('beta edge note'), 'AR:beta edge note');
  // Same endpoint family and credential style as the other stages, no new host.
  assert.match(requests[0]!.url, /nebius\.com\/v1\/chat\/completions/);
});

test('transport, status and shape failures all resolve to an empty map, never a throw', async () => {
  const failing = async () => { throw new Error('network down'); };
  const denied = async () => ({ ok: false, status: 401, text: async () => 'no' });
  const malformed = async () => ({ ok: true, status: 200, text: async () => 'not json' });
  const short = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: '{"translations":["only one"]}' } }] }),
  });
  for (const fetchImpl of [failing, denied, malformed, short]) {
    const translator = new NebiusChatTranslator({
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'm',
      timeoutMs: 1000,
      maxTokens: 500,
      apiKey: 'k',
      fetchImpl: fetchImpl as never,
    });
    const out = await translator.translate(['a first sentence', 'a second sentence'], 'fr');
    assert.equal(out.size, 0, 'failure must yield no translations, not invented ones');
  }
});

test('the translation response validator accepts only aligned non-empty strings', () => {
  assert.deepEqual(parseTranslationResponse('{"translations":["a","b"]}', 2), ['a', 'b']);
  assert.deepEqual(parseTranslationResponse('{"translations":["a"]}', 2), [null, null]);
  assert.deepEqual(parseTranslationResponse('{"translations":["a",""]}', 2), ['a', null]);
  assert.deepEqual(parseTranslationResponse('not json', 1), [null]);
  assert.deepEqual(parseTranslationResponse('{"translations":"a"}', 1), [null]);
});

test('the prompt demands preservation of technical content', () => {
  const prompt = buildTranslationPrompt('ar', 3);
  for (const token of ['C1-C12', 'ATTENTION', 'MATCH', 'UNDETERMINED', '{"translations":', 'exactly 3']) {
    assert.ok(prompt.includes(token), 'prompt must carry ' + token);
  }
});

test('the configuration boundary is explicit: no credential or disabled reasoning means no live translator', () => {
  assert.equal(createTranslatorFromEnv({}, undefined), null);
  assert.equal(
    createTranslatorFromEnv({ NEBIUS_API_KEY: 'k', REASONING_ENABLED: 'false' }, undefined),
    null,
  );
  const live = createTranslatorFromEnv({ NEBIUS_API_KEY: 'k' }, (async () => {
    throw new Error('must not be called');
  }) as never);
  assert.ok(live !== null, 'the configured reasoning credential authorizes translation');
  assert.equal(live.name, LIVE_TRANSLATION_VERSION);
});

/* ------------------------------------------------------------------ *
 * Session integration: novel reasoning reaches Arabic, French, Chinese.
 * ------------------------------------------------------------------ */

test('novel Nemotron reasoning translates to Arabic, French and Chinese', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { view } = await runNovelInspection(translator);

  const summary = view.modelTranslations[NOVEL_SUMMARY];
  assert.ok(summary !== undefined);
  assert.equal(summary.ar.translated, true);
  assert.equal(summary.ar.text, AR_SUMMARY);
  assert.equal(summary.ar.provider, LIVE_TRANSLATION_VERSION);
  assert.equal(summary.fr.translated, true);
  assert.equal(summary.fr.text, FR_SUMMARY);
  assert.equal(summary.zh.translated, true);

  // The whole section, not the heading: every reasoning field in Arabic.
  for (const [source, expected] of [
    [NOVEL_WHAT_MATTERS, AR_WHAT_MATTERS],
    [NOVEL_RATIONALE, AR_RATIONALE],
    [NOVEL_RECOMMENDATION, AR_RECOMMENDATION],
    [NOVEL_VERIFICATION, AR_VERIFICATION],
  ] as const) {
    const entry = view.modelTranslations[source];
    assert.ok(entry !== undefined, 'missing map entry for reasoning field');
    assert.equal(entry.ar.translated, true);
    assert.equal(entry.ar.text, expected);
  }

  assert.ok(liveTranslationCacheSize() > 0, 'live hits must be cached for reuse');

  // The originals are unchanged and still the authoritative values.
  const reasoning = view.reasoning;
  assert.equal(reasoning.status, 'AVAILABLE');
  assert.ok(reasoning.reasoning !== null, 'reasoning must be available');
  assert.equal(reasoning.reasoning.summary, NOVEL_SUMMARY);
  assert.equal(reasoning.reasoning.rationale, NOVEL_RATIONALE);
});

test('the offline memory is preferred: known sentences cost no live call', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  // 'Column casting is part way across the bay.' lives in the memory; the
  // novel set does not. One call per language covers exactly the misses.
  await translateModelTextsLive(
    ['Column casting is part way across the bay.', NOVEL_SUMMARY],
    translator,
  );
  assert.equal(translator.calls.length, 3, 'one batched call per target language');
  for (const call of translator.calls) {
    assert.ok(!call.texts.includes('Column casting is part way across the bay.'),
      'a memory hit must never be re-requested');
    assert.ok(call.texts.includes(NOVEL_SUMMARY));
  }
});

test('entries without a translation fall back honestly beside translated ones', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { view } = await runNovelInspection(translator);
  // The finding reason has no canned Arabic: fallback with no claim.
  const reason = view.modelTranslations[NOVEL_FINDING_REASON];
  assert.ok(reason !== undefined);
  assert.equal(reason.ar.translated, false);
  assert.equal(reason.ar.text, NOVEL_FINDING_REASON);
  assert.equal(reason.ar.provider, 'none');
  // While its sibling fields translated fine.
  assert.equal(view.modelTranslations[NOVEL_FINDING_LOCATION]?.ar.translated, true);
});

test('a missing translator and a failing translator both keep a complete inspection', async () => {
  for (const translator of [
    null,
    new StubTranslator({}),
    {
      name: 'throwing',
      translate: async (): Promise<ReadonlyMap<string, string>> => {
        throw new Error('translation outage');
      },
    } satisfies ModelTranslator,
  ]) {
    clearLiveTranslationCache();
    const { view } = await runNovelInspection(translator);
    assert.equal(view.outcome, 'COMPLETED');
    assert.equal(view.modelTranslations[NOVEL_SUMMARY]?.ar.translated, false);
    assert.equal(view.modelTranslations[NOVEL_SUMMARY]?.ar.text, NOVEL_SUMMARY);
  }
});

test('technical tokens survive live translation', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { view } = await runNovelInspection(translator);
  const rationale = view.modelTranslations[NOVEL_RATIONALE]?.ar.text ?? '';
  assert.match(rationale, /ATTENTION/, 'the deterministic vocabulary must arrive verbatim');
  const location = view.modelTranslations[NOVEL_FINDING_LOCATION]?.ar.text ?? '';
  assert.match(location, /C1-C12/, 'grid references must arrive verbatim');
  assert.match(location, /3/, 'counts must arrive verbatim');
});

test('repeat runs and re-renders cost no new translation calls', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { session, view } = await runNovelInspection(translator);
  const afterRun = translator.calls.length;
  assert.ok(afterRun > 0, 'the run must have translated the novel misses');

  // A re-render is a pure read of the shipped map.
  session.view();
  for (const source of Object.keys(view.modelTranslations)) {
    for (const lang of INSPECTION_LANGUAGES) resolveDisplayTranslation(source, lang);
  }
  assert.equal(translator.calls.length, afterRun, 'renders and switches must not call');

  // A second identical run reuses the cache instead of paying again.
  await session.run();
  assert.equal(translator.calls.length, afterRun, 'cached sources must not be re-requested');
});

test('translation failures cannot corrupt canonical inspection data', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { view, visionCalls } = await runNovelInspection(translator);
  const before = JSON.stringify({
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.verificationStatus, f.title]),
    observations: view.observations.map((o) => [o.id, o.observation]),
    comparison: view.comparison.map((r) => [r.id, r.status]),
    provenance: view.provenance,
    reasoning: view.reasoning,
  });
  for (const source of Object.keys(view.modelTranslations)) {
    for (const lang of INSPECTION_LANGUAGES) resolveDisplayTranslation(source, lang);
  }
  const after = JSON.stringify({
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.verificationStatus, f.title]),
    observations: view.observations.map((o) => [o.id, o.observation]),
    comparison: view.comparison.map((r) => [r.id, r.status]),
    provenance: view.provenance,
    reasoning: view.reasoning,
  });
  assert.equal(after, before);
  assert.equal(visionCalls.length, 1, 'one vision call for the single capture');
});

test('a restored inspection reuses cached live translations with no translator', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const first = await runNovelInspection(translator);
  const callsAfterRun = translator.calls.length;
  assert.ok(callsAfterRun > 0);

  const payload = first.session.getPersistedPayload();
  assert.ok(payload !== null, 'the run must leave a persistable payload');

  // A fresh session with NO translator configured, restoring from disk the
  // way hydrateFromPersistence does after a restart. The provider is never
  // called on this path; only the offline memory and the shared live cache
  // may serve.
  const second = new InspectionSession(
    new DemoFixtureProvider(),
    demoCaptures()[0]!,
    'proj_novel',
    'zone_level_02',
    defaultExpectedState(),
    { projectName: 'North Core Construction', translator: null },
  );
  const rebuilt = second.restoreInspection({
    savedAt: new Date().toISOString(),
    inspectedAt: new Date().toISOString(),
    provider: 'test-vision-model',
    model: 'test-vision-model',
    payload,
    reviews: [],
  });
  assert.equal(rebuilt, true, 'the payload must restore');
  second.restoreReasoning(novelReasoning(), {
    model: 'stub-reasoner-v1',
    provider: 'stub-reasoner',
    reasonedAt: new Date().toISOString(),
    latencyMs: 1,
    rowsConsidered: 1,
    detectionsConsidered: 1,
    degenerate: false,
  });
  const view2 = second.view();
  assert.equal(view2.modelTranslations[NOVEL_SUMMARY]?.ar.text, AR_SUMMARY);
  assert.equal(view2.modelTranslations[NOVEL_SUMMARY]?.ar.translated, true);
  assert.equal(
    translator.calls.length,
    callsAfterRun,
    'restore must reuse the cache, never re-request',
  );
});

test('a changed source invalidates its cached translation', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator({
    [NOVEL_SUMMARY]: { ar: AR_SUMMARY },
  });
  await translateModelTextsLive([NOVEL_SUMMARY], translator);
  assert.equal(resolveDisplayTranslation(NOVEL_SUMMARY, 'ar').translated, true);
  const edited = NOVEL_SUMMARY + ' (updated)';
  assert.equal(resolveDisplayTranslation(edited, 'ar').translated, false);
  assert.equal(resolveDisplayTranslation(edited, 'ar').text, edited);
});

/* ------------------------------------------------------------------ *
 * Content truth: planned-state notes must not become observed facts.
 * ------------------------------------------------------------------ */

test('the reasoning context marks expected notes as operator declarations', () => {
  const expected: ExpectedState = {
    zone: 'North Core',
    source: 'PRESET',
    items: [
      { id: 'e1', element: 'SLAB', expectation: 'PRESENT', expectedCount: null, note: 'substantially complete' },
    ],
  };
  const rows = compareExpectedState(expected, []);
  const context = buildReasoningContext({
    projectName: 'North Core Construction',
    captureLabel: 'cap',
    imageCount: 1,
    expected,
    detections: [],
    observations: [],
    rows,
    findings: [],
  });
  assert.match(context, /operator note: "substantially complete"/);
  assert.match(context, /SLAB PRESENT: UNDETERMINED/);
});

test('the reasoning prompt forbids presenting planned notes as observations', () => {
  const prompt = buildReasoningPrompt();
  assert.match(prompt, /operator note/);
  assert.match(prompt, /substantially complete/);
  assert.match(prompt, /unless[\s\S]*VISIBLE ELEMENTS[\s\S]*MATCH/);
});

test('a headline echo of a planned note for a non-match row is flagged', () => {
  const expected: ExpectedState = {
    zone: 'North Core',
    source: 'PRESET',
    items: [
      { id: 'e1', element: 'SLAB', expectation: 'PRESENT', expectedCount: null, note: 'substantially complete' },
    ],
  };
  const rows = compareExpectedState(expected, []);
  assert.equal(rows[0]!.status, 'UNDETERMINED');
  const base = {
    whatMatters: 'Whether the slab matches the plan is not readable here.',
    rationale: 'The frame shows an edge but no measurable surface.',
    recommendation: 'Walk the slab and record its state.',
    verification: 'Confirm the slab condition on site.',
    confidence: null,
    certainty: 'UNCERTAIN',
  } as const;
  const echo = echoesExpectedNote(
    { summary: 'The slab is substantially complete across the zone.', ...base },
    expected,
    rows,
  );
  assert.ok(echo !== null);
  assert.equal(echo.field, 'summary');
  assert.equal(echo.element, 'SLAB');

  // A careful headline passes; plan discussion belongs in the rationale.
  const careful = echoesExpectedNote(
    {
      summary: 'The slab edge is partly visible and settles nothing on its own.',
      ...base,
    },
    expected,
    rows,
  );
  assert.equal(careful, null);

  // A MATCH row may legitimately conclude what was planned and observed.
  const matchedRows = [{ ...rows[0]!, status: 'MATCH' as const }];
  const matched = echoesExpectedNote(
    { summary: 'The slab is substantially complete across the zone.', ...base },
    expected,
    matchedRows,
  );
  assert.equal(matched, null);
});

test('an echoing Nemotron response is discarded while the comparison stands', async () => {
  const visionCalls: unknown[] = [];
  const provider = new NebiusNvidiaProvider({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'test-vision-model',
      timeoutMs: 5000,
      maxObservations: 6,
      maxTokens: 3000,
    },
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: stubVisionFetch(visionCalls),
  });
  // Novel vision prose, but a real Nemotron reasoner fed a response that
  // launders the slab plan note ("substantially complete") into a conclusion.
  // The guard under test lives in the reasoner itself, so the response must
  // travel the real validation path rather than a stubbed outcome.
  const echoBody = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: 'The slab is substantially complete across the zone.',
            whatMatters: 'Slab completion governs the next pour.',
            rationale: 'The visible edge and the expected note combine into readiness.',
            recommendation: 'Proceed toward the next pour.',
            verification: 'Confirm on site.',
            confidence: 0.9,
            certainty: 'SUPPORTED',
          }),
        },
        finish_reason: 'stop',
      },
    ],
  };
  const echoReasoner = new NemotronReasoner({
    config: {
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      model: 'test-reasoning-model',
      timeoutMs: 5000,
      maxTokens: 2000,
      enabled: true,
    },
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(echoBody),
    })) as never,
    env: {},
  });
  const session = new InspectionSession(
    provider,
    demoCaptures()[0]!,
    'proj_echo',
    'zone_level_02',
    defaultExpectedState(),
    { reasoner: echoReasoner, projectName: null, translator: null },
  );
  const view = await session.run();
  // The prose is gone; the facts are exactly as computed.
  assert.equal(view.reasoning.status, 'UNAVAILABLE');
  assert.equal(view.reasoning.failureKind, 'REJECTED_BY_VALIDATION');
  // Discarded prose is never translated either: it cannot reach the map, so
  // no language can present it and translation cannot launder it back.
  assert.equal(
    view.modelTranslations['The slab is substantially complete across the zone.'],
    undefined,
  );
  const slab = view.comparison.find((r) => r.element === 'SLAB');
  assert.ok(slab !== undefined);
  assert.equal(slab.status, 'UNDETERMINED', 'the comparison must not be upgraded to match the prose');
  for (const finding of view.inspectionFindings) {
    assert.equal(finding.verificationStatus, 'UNVERIFIED', 'no candidate may read as a verified defect');
  }
});

/* ------------------------------------------------------------------ *
 * The Arabic surface: the whole reasoning section, original in reach.
 * ------------------------------------------------------------------ */

interface StubNode {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  lang: string;
  dir: string;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  children: StubNode[];
  style: Record<string, string>;
  listeners: Record<string, ((event: unknown) => void)[]>;
  appendChild(c: StubNode): StubNode;
  removeChild(c: StubNode): void;
  get firstChild(): StubNode | null;
  setAttribute(n: string, v: string): void;
  getAttribute(n: string): string | null;
  addEventListener(t: string, h: (event: unknown) => void): void;
  visible(): string[];
}

function stubNode(tag: string): StubNode {
  const node: StubNode = {
    tagName: tag,
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    lang: '',
    dir: '',
    dataset: {},
    attrs: {},
    children: [],
    style: {},
    listeners: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    },
    get firstChild() {
      return this.children.length > 0 ? (this.children[0] as StubNode) : null;
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, h) { (this.listeners[t] = this.listeners[t] || []).push(h); },
    visible() {
      const out: string[] = [];
      const own = this.textContent.trim();
      if (own.length > 0) out.push(own);
      for (const c of this.children) out.push(...c.visible());
      return out;
    },
  };
  return node;
}

test('the Arabic reasoning section reads in Arabic with the original one toggle away', async () => {
  clearLiveTranslationCache();
  const translator = new StubTranslator(arabicDictionary());
  const { view } = await runNovelInspection(translator);
  assert.equal(view.modelTranslations[NOVEL_SUMMARY]?.ar.translated, true);

  const ids = new Map<string, StubNode>();
  const id = (name: string): StubNode => {
    const existing = ids.get(name);
    if (existing) return existing;
    const made = stubNode('div');
    ids.set(name, made);
    return made;
  };
  const surfaces = [stubNode('section'), stubNode('section'), stubNode('section')];
  const apiCalls: string[] = [];
  const document = {
    documentElement: stubNode('html'),
    createElement: (tag: string) => stubNode(tag),
    createTextNode: (text: string) => {
      const n = stubNode('#text');
      n.textContent = text;
      return n;
    },
    getElementById: (name: string) => id(name),
    querySelectorAll: (selector: string) => (selector === '.i18n-surface' ? surfaces : []),
    readyState: 'loading',
    addEventListener: () => {},
  };
  const context: Record<string, unknown> = {
    document,
    window: { localStorage: { getItem: () => null, setItem: () => {} }, console: { error: () => {} } },
    console: { error: () => {} },
    api: (...a: unknown[]) => { apiCalls.push('api:' + String(a[0])); return Promise.reject(new Error('no net')); },
    fetch: () => { apiCalls.push('fetch'); return Promise.reject(new Error('no net')); },
    setTimeout,
    setInterval: () => 0,
  };
  vm.createContext(context);
  const probe = [
    'globalThis.__probe = {',
    '  show: (v, lang) => { state.view = v; state.lang = lang; },',
    '  render: () => {',
    '    applyLanguage(); renderReasoning(); renderObservations(); renderFindings();',
    '  }',
    '};',
  ].join('\n');
  new vm.Script(APP_JS + '\n' + probe).runInContext(context);
  const ctx = context as unknown as {
    __probe: { show(v: unknown, lang: string): void; render(): void };
  };
  ctx.__probe.show(view, 'ar');
  ctx.__probe.render();

  const leaves: string[] = [];
  for (const n of ids.values()) leaves.push(...n.visible());
  const joined = leaves.join(' | ');
  // The entire reasoning section in Arabic: lede plus all four rows.
  for (const sentence of [AR_SUMMARY, AR_WHAT_MATTERS, AR_RATIONALE, AR_RECOMMENDATION, AR_VERIFICATION]) {
    assert.ok(joined.includes(sentence), 'Arabic surface must contain: ' + sentence.slice(0, 30));
  }
  // Honest labelling and the way back to the authoritative original.
  assert.match(joined, /مترجم من الإنجليزية/, 'translated badge in Arabic');
  assert.match(joined, /عرض الأصل/, 'View original control in Arabic');
  // The English originals are not on the Arabic surface...
  assert.doesNotMatch(joined, /cannot be settled from one frame/);
  // ...but stay intact canonically.
  assert.equal(view.reasoning.status, 'AVAILABLE');
  // Rendering in Arabic costs no request: translations shipped with the view.
  assert.deepEqual(apiCalls, []);
});

test('every new catalog key stays out of the translation memory path', () => {
  // The tr.* labels are interface chrome in all four languages, present and
  // placeholder-free, so the toggle and badges read correctly everywhere.
  for (const key of ['tr.viewOriginal', 'tr.viewTranslation', 'tr.translatedBadge', 'tr.fallbackNote'] as const) {
    for (const lang of INSPECTION_LANGUAGES) {
      const value = UI_STRINGS[lang][key];
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0);
    }
  }
  // Memory lookups never claim English as translated, and a sentence no tier
  // has ever seen falls back honestly in every language.
  const unseen = 'A sentence no tier has ever translated, mentioning nothing.';
  assert.equal(translateModelText(unseen, 'en').translated, false);
  for (const lang of ['fr', 'ar', 'zh'] as const) {
    const resolved = resolveDisplayTranslation(unseen, lang);
    assert.equal(resolved.translated, false);
    assert.equal(resolved.text, unseen);
  }
});

test('construction terminology guidance and oversail normalization handle domain terms in fr, ar, and zh', () => {
  for (const target of ['fr', 'ar', 'zh'] as const) {
    const prompt = buildTranslationPrompt(target, 2);
    assert.match(prompt, /oversail/i, `${target} prompt must guide oversail translation`);
    assert.match(prompt, /slab/i, `${target} prompt must guide slab translation`);
    assert.match(prompt, /rebar/i, `${target} prompt must guide rebar translation`);
    assert.match(prompt, /MEP rough-in/i, `${target} prompt must guide MEP rough-in translation`);
  }

  // Offline memory entries for crane oversail resolve in all 3 target languages.
  const oversailSource = 'Crane jib oversail beyond the site boundary';
  assert.equal(translateModelText(oversailSource, 'fr').text, 'Survol de flèche de grue au-delà de la limite de chantier');
  assert.equal(translateModelText(oversailSource, 'ar').text, 'تجاوز ذراع الرافعة خارج حدود الموقع');
  assert.equal(translateModelText(oversailSource, 'zh').text, '塔吊起重臂越界悬挑超出场地边界');

  // Post-normalization replaces leaked English "oversail" inside translated target strings.
  assert.equal(
    normalizeTranslatedConstructionTerms('يتطلب oversail اتفاقية مع القطعة المجاورة.', 'ar'),
    'يتطلب تجاوز حدود الموقع اتفاقية مع القطعة المجاورة.',
  );
  assert.equal(
    normalizeTranslatedConstructionTerms('塔吊 oversail 需先确认邻近地块协议。', 'zh'),
    '塔吊 越界悬挑 需先确认邻近地块协议。',
  );
  assert.equal(
    normalizeTranslatedConstructionTerms('Un oversail de la grue dépasse la limite nord.', 'fr'),
    'Un survol de la grue dépasse la limite nord.',
  );

  // Uniform per language: no caller-shaped exemptions, and a leading capital
  // is preserved deterministically. Unrelated text passes through untouched.
  assert.equal(
    normalizeTranslatedConstructionTerms('FR: Un oversail de la grue dépasse.', 'fr'),
    'FR: Un survol de la grue dépasse.',
  );
  assert.equal(
    normalizeTranslatedConstructionTerms('Oversail requires neighbouring clearance.', 'fr'),
    'Survol requires neighbouring clearance.',
  );
  assert.equal(
    normalizeTranslatedConstructionTerms('The columns are evenly spaced.', 'fr'),
    'The columns are evenly spaced.',
  );
  assert.equal(
    normalizeTranslatedConstructionTerms('An oversail passes overhead.', 'ar'),
    'An oversail passes overhead.',
  );
});
