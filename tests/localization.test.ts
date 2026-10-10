/**
 * Multilingual inspection results.
 *
 * The feature under test is not "text in four languages". It is the claim that
 * ONE verified inspection is presentable in four languages without being
 * re-derived: same finding ids, same severities, same evidence, same counts,
 * same timestamps, same provenance, same models, same NVIDIA verdict - and zero
 * additional inference.
 *
 * So most of these tests assert what must NOT change. A localization layer that
 * quietly mutates a finding would be worse than no localization at all.
 *
 * One test is deliberately strict in the other direction: regenerating the
 * DERIVED prose in English must reproduce, character for character, the English
 * the pipeline itself produced. That is what proves the localized versions are
 * the same facts rendered differently, rather than a different set of sentences.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  INSPECTION_LANGUAGES,
  LANGUAGE_BCP47,
  LANGUAGE_DIRECTION,
  LANGUAGE_LABELS,
  UI_STRINGS,
  clientLocalizationPayload,
  fill,
  isInspectionLanguage,
  resolveInspectionLanguage,
  sentenceCase,
  translatorFor,
} from '../src/localization.ts';
import { localizeInspection, localizeInspectionAll } from '../src/localized-inspection.ts';
import type { LocalizableInspectionInput } from '../src/localized-inspection.ts';
import { InspectionSession } from '../src/session.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { NemotronReasoner, UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { resolveReasoningConfig, DEFAULT_NEBIUS_MODEL, DEFAULT_REASONING_MODEL } from '../src/config.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import { demoCaptures } from '../src/captures.ts';
import { APP_CSS, APP_JS, INDEX_HTML } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * A real session, with the network replaced.
 * ------------------------------------------------------------------ */

const VISION_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          elements: [
            {
              element: 'COLUMN', present: true, count: 9, confidence: 0.84,
              evidence: 'nine cast columns are visible across the frame',
              bounding_box: { x: 0.1, y: 0.3, width: 0.3, height: 0.5 },
            },
            {
              element: 'REBAR', present: true, count: null, confidence: 0.71,
              evidence: 'a dense bar mat fills the lower half of the frame',
            },
            {
              element: 'EXCAVATION', present: true, count: null, confidence: 0.66,
              evidence: 'an open trench is visible at the frame edge',
            },
            {
              element: 'SCAFFOLD', present: false, count: null, confidence: 0.58,
              evidence: 'no scaffold tower appears anywhere in the frame',
            },
          ],
          observations: [
            {
              category: 'PROGRESS_OBSERVATION',
              observation: 'Column casting is part way across the bay.',
              evidence: { description: 'formwork and column starters mid-frame' },
              confidence: 0.79, severity: 'INFO', suggested_action: 'HUMAN_REVIEW',
            },
          ],
          findings: [
            {
              title: 'Open excavation at the frame edge',
              category: 'SAFETY_ATTENTION',
              severity: 'MEDIUM',
              observation: 'An open excavation is visible beside the working area.',
              reason: 'The trench edge has no visible barrier.',
              evidence: 'A soil trench runs along the right edge of the frame.',
              confidence: 0.61,
              recommendation: 'Walk the trench edge and confirm the barrier is in place.',
              element: 'EXCAVATION',
              location: 'right edge of the frame',
              bounding_box: { x: 0.72, y: 0.55, width: 0.26, height: 0.4 },
            },
          ],
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
          summary: 'Column casting is part way across the bay and cannot be settled from one frame.',
          whatMatters: 'Whether the column count matches the programme is not readable here.',
          rationale: 'Nine columns are visible and the deterministic comparison returns ATTENTION, '
            + 'but spacing, cover and anchorage are not established by the image.',
          recommendation: 'Walk the bay against the approved column grid before the next pour.',
          verification: 'Physically confirm the column count and starter positions on site.',
          confidence: 0.54, certainty: 'UNCERTAIN',
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

/** One real inspection, plus the call log proving how many inferences ran. */
async function runInspection() {
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
  const reasoner = new NemotronReasoner({
    config: resolveReasoningConfig({ NEBIUS_REASONING_MODEL: DEFAULT_REASONING_MODEL }),
    credentials: { apiKey: 'test-key-not-real' },
    fetchImpl: reasoning.fetchImpl,
    env: {},
  });

  const session = new InspectionSession(
    provider,
    demoCaptures()[0]!,
    'proj_lang',
    'zone_level_02',
    defaultExpectedState(),
    { reasoner, projectName: 'North Core Construction' },
  );
  const view = await session.run();
  return { session, view, visionCalls: vision.calls, reasonCalls: reasoning.calls };
}

function inputFor(view: Awaited<ReturnType<InspectionSession['run']>>): LocalizableInspectionInput {
  return {
    detections: view.detections.map((d) => ({
      element: d.element, present: d.present, count: d.count, confidence: d.confidence,
    })),
    expected: { items: view.expected.items },
    comparison: view.comparison.map((row) => ({
      id: row.id, expectedId: row.expectedId, element: row.element,
      expectation: row.expectation, status: row.status, countBasis: row.countBasis,
      expectedCount: row.expectedCount, observedCount: row.observedCount,
      confidence: row.confidence, boundingBox: row.boundingBox,
      detectionReported: row.detectionReported,
    })),
    inspectionFindings: view.inspectionFindings.map((f) => ({
      id: f.id, title: f.title, origin: f.origin, category: f.category, severity: f.severity,
      verificationStatus: f.verificationStatus, evidenceState: f.evidenceState,
      observation: f.observation, location: f.location, element: f.element,
      expected: f.expected, difference: f.difference, reason: f.reason,
      evidence: f.evidence, recommendation: f.recommendation,
      comparisonId: f.comparisonId, confidence: f.confidence,
    })),
    priorities: view.priorities,
    counters: view.counters,
    isDemoFixture: view.isDemoFixture,
    qualification: {
      visionModel: view.provenance.model,
      reasoningModel: view.reasoning.model,
      visionIsNvidia: view.pipelineEligibility.vision !== 'NOT_ELIGIBLE'
        || view.pipelineEligibility.stages.some((s) => s.stage === 'VISION' && s.isNvidiaModel),
      reasoningIsNvidia: view.pipelineEligibility.stages.some(
        (s) => s.stage === 'REASONING' && s.isNvidiaModel,
      ),
      visionClassification: view.pipelineEligibility.vision,
      reasoningClassification: view.pipelineEligibility.reasoning,
      nvidiaRequirement: view.pipelineEligibility.nvidiaRequirement,
      qualifyingStage: view.pipelineEligibility.qualifyingStage,
      platform: view.pipelineEligibility.platform,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Language selection
 * ------------------------------------------------------------------ */

test('exactly four inspection languages are supported', () => {
  assert.deepEqual([...INSPECTION_LANGUAGES], ['en', 'fr', 'ar', 'zh']);
});

test('language selection resolves and rejects', () => {
  for (const code of INSPECTION_LANGUAGES) {
    assert.equal(isInspectionLanguage(code), true);
    assert.equal(resolveInspectionLanguage(code), code);
  }
  assert.equal(isInspectionLanguage('de'), false);
  assert.equal(isInspectionLanguage(null), false);
  assert.equal(isInspectionLanguage(7), false);
});

test('an unsupported language falls back to English without throwing', () => {
  for (const bad of ['de', 'EN', '', null, undefined, 42, {}]) {
    assert.equal(resolveInspectionLanguage(bad), 'en');
  }
});

test('only Arabic is right-to-left', () => {
  assert.equal(LANGUAGE_DIRECTION.en, 'ltr');
  assert.equal(LANGUAGE_DIRECTION.fr, 'ltr');
  assert.equal(LANGUAGE_DIRECTION.ar, 'rtl');
  assert.equal(LANGUAGE_DIRECTION.zh, 'ltr');
  for (const code of INSPECTION_LANGUAGES) {
    assert.equal(translatorFor(code).dir, LANGUAGE_DIRECTION[code]);
  }
});

test('languages are named by endonym, never by flag or English name', () => {
  assert.equal(LANGUAGE_LABELS.en, 'English');
  assert.equal(LANGUAGE_LABELS.fr, 'Fran\u00e7ais');
  assert.equal(LANGUAGE_LABELS.ar, '\u0627\u0644\u0639\u0631\u0628\u064a\u0629');
  assert.equal(LANGUAGE_LABELS.zh, '\u4e2d\u6587');
});

test('every catalog carries the same key set in all four languages', () => {
  const reference = Object.keys(UI_STRINGS.en).sort();
  for (const code of INSPECTION_LANGUAGES) {
    assert.deepEqual(Object.keys(UI_STRINGS[code]).sort(), reference, code + ' key set must match');
    for (const key of reference) {
      const value = UI_STRINGS[code][key as keyof typeof UI_STRINGS.en];
      assert.equal(typeof value, 'string', code + '.' + key + ' must be a string');
      assert.ok((value as string).trim().length > 0, code + '.' + key + ' must not be empty');
    }
  }
});

test('the browser payload carries every language and its direction', () => {
  const payload = clientLocalizationPayload();
  assert.equal(payload.languages.length, 4);
  assert.deepEqual(payload.languages.map((l) => l.code), ['en', 'fr', 'ar', 'zh']);
  for (const option of payload.languages) {
    assert.ok(option.label.length > 0);
    assert.ok(option.bcp47.length > 0);
    assert.ok(option.dir === 'ltr' || option.dir === 'rtl');
  }
  assert.equal(payload.defaultLanguage, 'en');
});

test('no translation can break the client script it is injected into', () => {
  // The catalog is serialized straight into a template literal. A stray backtick
  // or ${ in any string would corrupt the served JavaScript for every user, so
  // it is checked rather than trusted.
  for (const code of INSPECTION_LANGUAGES) {
    for (const [key, value] of Object.entries(UI_STRINGS[code])) {
      assert.doesNotMatch(value, /`/, code + '.' + key + ' must not contain a backtick');
      assert.doesNotMatch(value, /\$\{/, code + '.' + key + ' must not contain a template placeholder');
    }
  }
});

/* ------------------------------------------------------------------ *
 * Placeholder and case helpers
 * ------------------------------------------------------------------ */

test('placeholders fill, and a missing one stays visible rather than vanishing', () => {
  assert.equal(fill('a {x} b', { x: '1' }), 'a 1 b');
  assert.equal(fill('a {x} b', {}), 'a {x} b');
  assert.equal(fill('{n} {n}', { n: 3 }), '3 3');
});

test('sentence case leaves caseless scripts alone', () => {
  assert.equal(sentenceCase('column'), 'Column');
  assert.equal(sentenceCase(''), '');
  assert.equal(sentenceCase('\u67f1'), '\u67f1');
  assert.equal(sentenceCase('\u0639\u0645\u0648\u062f'), '\u0639\u0645\u0648\u062f');
});

/* ------------------------------------------------------------------ *
 * Canonical invariance
 * ------------------------------------------------------------------ */

/** Catalog read by a runtime-composed key, e.g. `severity.HIGH`. */
function labelFor(code: 'en' | 'fr' | 'ar' | 'zh', key: string): string {
  const catalog = UI_STRINGS[code] as Readonly<Record<string, string | undefined>>;
  const value = catalog[key];
  assert.ok(value !== undefined, 'catalog ' + code + '.' + key + ' must exist');
  return value;
}

/** Indexed read that asserts the element exists first. */
function at<T>(list: readonly T[], index: number, label: string): T {
  const value = list[index];
  assert.ok(value !== undefined, label + ' at index ' + index + ' must exist');
  return value;
}

test('one inspection is presented in all four languages at once', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));

  assert.deepEqual(Object.keys(all).sort(), ['ar', 'en', 'fr', 'zh']);
  for (const code of INSPECTION_LANGUAGES) {
    assert.equal(all[code].language, code);
    assert.equal(all[code].dir, LANGUAGE_DIRECTION[code]);
  }
});

test('the four languages reference the SAME canonical findings', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  const canonicalIds = view.inspectionFindings.map((f) => f.id);

  for (const code of INSPECTION_LANGUAGES) {
    assert.deepEqual(all[code].findings.map((f) => f.id), canonicalIds, code + ' finding ids');
  }
  // And each one maps back to the canonical finding it came from.
  const byId = new Map(view.inspectionFindings.map((f) => [f.id, f]));
  for (const code of INSPECTION_LANGUAGES) {
    for (const finding of all[code].findings) {
      const source = byId.get(finding.id);
      assert.ok(source !== undefined, code + ' finding ' + finding.id + ' must exist canonically');
      assert.equal(finding.severityLabel, labelFor(code, 'severity.' + source.severity));
      assert.equal(finding.statusLabel, labelFor(code, 'status.' + source.verificationStatus));
      assert.equal(
        finding.evidenceStateLabel,
        labelFor(code, 'evidenceState.' + source.evidenceState),
      );
    }
  }
});

test('comparison rows keep their canonical ids and status enums in every language', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));

  for (const code of INSPECTION_LANGUAGES) {
    assert.deepEqual(all[code].comparison.map((r) => r.id), view.comparison.map((r) => r.id), code);
    view.comparison.forEach((row, index) => {
      assert.equal(
        at(all[code].comparison, index, code + ' comparison row').statusLabel,
        labelFor(code, 'comparisonStatus.' + row.status),
      );
    });
  }
});

test('the localized brief reaches the same verdict as the canonical brief', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));

  for (const code of INSPECTION_LANGUAGES) {
    assert.equal(all[code].brief.overallLabel, labelFor(code, 'overall.' + view.brief.overall), code);
    // Same number of lines, including the empty spacer the layout relies on.
    assert.equal(all[code].brief.lines.length, view.brief.lines.length, code);
  }
});

test('switching language leaves every machine fact untouched', async () => {
  const { view } = await runInspection();
  const before = JSON.stringify({
    ids: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.verificationStatus]),
    counts: view.counters,
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
  });

  const all = localizeInspectionAll(inputFor(view));
  // Localizing is a read of the input. Running every language must leave the
  // canonical structures exactly as they were.
  const after = JSON.stringify({
    ids: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.verificationStatus]),
    counts: view.counters,
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
  });

  assert.equal(after, before);
  assert.deepEqual(Object.keys(all).sort(), ['ar', 'en', 'fr', 'zh']);
});

test('localizing twice gives byte-identical output', async () => {
  const { view } = await runInspection();
  const input = inputFor(view);
  const first = JSON.stringify(localizeInspectionAll(input));
  const second = JSON.stringify(localizeInspectionAll(input));
  assert.equal(second, first, 'the projection must be deterministic');
});

/* ------------------------------------------------------------------ *
 * Fidelity: regenerating English must reproduce the pipeline's own English.
 *
 * This is the load-bearing test. If regenerating the derived prose in English
 * produced different sentences, then the other three languages would be
 * rendering different FACTS, not the same facts in another script.
 * ------------------------------------------------------------------ */

test('English regeneration reproduces the pipeline text character for character', async () => {
  const { view } = await runInspection();
  const en = localizeInspection(inputFor(view), 'en');

  for (let i = 0; i < view.comparison.length; i++) {
    const mine = at(en.comparison, i, 'localized comparison row');
    const theirs = at(view.comparison, i, 'canonical comparison row');
    assert.equal(mine.expectedText, theirs.expectedText, 'expectedText');
    assert.equal(mine.observedText, theirs.observedText, 'observedText');
    assert.equal(
      mine.difference,
      theirs.difference === '' ? null : theirs.difference,
      'difference',
    );
  }

  const byId = new Map(view.inspectionFindings.map((f) => [f.id, f]));
  for (const finding of en.findings) {
    const source = byId.get(finding.id);
    assert.ok(source !== undefined, 'finding ' + finding.id + ' must exist canonically');
    if (source.origin !== 'COMPARISON') continue;
    assert.equal(finding.title, source.title, 'title');
    assert.equal(finding.what, source.observation, 'what');
    assert.equal(finding.expected, source.expected, 'expected');
    assert.equal(finding.difference, source.difference, 'difference');
    assert.equal(finding.reason, source.reason, 'reason');
    assert.equal(finding.evidence, source.evidence, 'evidence');
    assert.equal(finding.recommendation, source.recommendation, 'recommendation');
  }
});

test('English regeneration reproduces the canonical brief and priorities', async () => {
  const { view } = await runInspection();
  const en = localizeInspection(inputFor(view), 'en');

  assert.deepEqual([...en.brief.lines], [...view.brief.lines]);
  assert.equal(en.brief.overallLabel, view.brief.overall.replace(/_/g, ' '));
  assert.equal(en.brief.highestPriority, view.brief.highestPriority);
  for (let i = 0; i < view.priorities.length; i++) {
    assert.equal(at(en.priorities, i, 'localized priority').title, at(view.priorities, i, 'priority').title);
    assert.equal(at(en.priorities, i, 'localized priority').basis, at(view.priorities, i, 'priority').basis);
  }
});

/* ------------------------------------------------------------------ *
 * Measurements and technical values
 * ------------------------------------------------------------------ */

test('the column count survives in every language, unaltered', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  const index = view.comparison.findIndex((r) => r.element === 'COLUMN');
  assert.ok(index > -1, 'the fixture must produce a COLUMN row');

  // The row is an ATTENTION count discrepancy, so the numbers appear in both
  // the expected and the observed text in all four languages.
  for (const code of INSPECTION_LANGUAGES) {
    const row = at(all[code].comparison, index, code + ' COLUMN comparison row');
    assert.match(row.observedText, new RegExp(String(at(view.comparison, index, 'row').observedCount)));
    assert.match(row.expectedText, new RegExp(String(at(view.comparison, index, 'row').expectedCount)));
  }
  // The Arabic and Chinese renderings must still contain the exact digits.
  assert.match(at(all.ar.comparison, index, 'ar COLUMN row').observedText, /9/);
  assert.match(at(all.zh.comparison, index, 'zh COLUMN row').observedText, /9/);
});

test('no language introduces digits the canonical data does not have', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  const allowed = new Set(
    JSON.stringify(view).match(/\d+(?:\.\d+)?/g) ?? [],
  );

  for (const code of INSPECTION_LANGUAGES) {
    const rendered = JSON.stringify(all[code]);
    for (const number of rendered.match(/\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(
        allowed.has(number),
        code + ' introduced the number ' + number + ', which is not a canonical value',
      );
    }
  }
});

test('model ids and technical identifiers are never translated', async () => {
  const { view } = await runInspection();
  const before = [view.provenance.model, view.provenance.provider, view.reasoning.model];
  localizeInspectionAll(inputFor(view));
  const after = [view.provenance.model, view.provenance.provider, view.reasoning.model];

  // A model id is a machine fact. It is not projected into the localized view at
  // all, so it cannot be translated, and the canonical one is never rewritten.
  assert.deepEqual(after, before);
  assert.equal(view.provenance.model, DEFAULT_NEBIUS_MODEL);
  assert.equal(view.reasoning.model, DEFAULT_REASONING_MODEL);

  // Where a model id DOES appear in the localized copy, it appears verbatim.
  // The qualification panel names both models on purpose: the point of that
  // panel is which model contributed. The requirement is that the id is
  // identical in every language, not that it is absent.
  const all = localizeInspectionAll(inputFor(view));
  for (const code of INSPECTION_LANGUAGES) {
    const path = all[code].qualification.path;
    assert.ok(
      path.includes(DEFAULT_NEBIUS_MODEL) && path.includes(DEFAULT_REASONING_MODEL),
      code + ' must name both models verbatim in the qualification path',
    );
  }
  // No localized string may contain a MANGLED id: any MiniCPM or Nemotron token
  // in the output must be the exact canonical id, character for character.
  const localizedText = JSON.stringify(all);
  // The namespace prefix is part of the id, so it is inside the captured token.
  const tokenClass = '[A-Za-z0-9_./-]';
  for (const token of localizedText.match(new RegExp(tokenClass + '*MiniCPM' + tokenClass + '*', 'g')) ?? []) {
    assert.equal(token, DEFAULT_NEBIUS_MODEL, 'mangled model id: ' + token);
  }
  for (const token of localizedText.match(new RegExp(tokenClass + '*Nemotron' + tokenClass + '*', 'g')) ?? []) {
    assert.equal(token, DEFAULT_REASONING_MODEL, 'mangled model id: ' + token);
  }
  // "Nemotron" also appears as a bare product reference in the reasoning
  // labels, which is a name and not an id.
  const bareNemotron = (localizedText.match(/\bNemotron\b/g) ?? []).length;
  assert.ok(bareNemotron > 0, 'the reasoning stage is still named');
});

/* ------------------------------------------------------------------ *
 * Model-authored text is preserved and labelled, never invented
 * ------------------------------------------------------------------ */

test('AI-authored findings keep their model English and say so', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  const aiIndex = view.inspectionFindings.findIndex((f) => f.origin === 'AI');
  assert.ok(aiIndex > -1, 'the fixture must produce one AI finding');
  const source = view.inspectionFindings[aiIndex]!;

  for (const code of INSPECTION_LANGUAGES) {
    const finding = all[code].findings[aiIndex]!;
    assert.equal(finding.translated, false, code + ' must not claim to have translated model prose');
    assert.equal(finding.title, source.title, code + ' keeps the model title');
    assert.equal(finding.reason, source.reason, code + ' keeps the model reason');
    assert.equal(finding.recommendation, source.recommendation, code + ' keeps the model recommendation');
  }
});

test('comparison-derived findings ARE localized in every language', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  const index = view.inspectionFindings.findIndex((f) => f.origin === 'COMPARISON');
  assert.ok(index > -1, 'the fixture must produce a comparison finding');
  const source = at(view.inspectionFindings, index, 'comparison finding');

  const titles = new Set<string>();
  for (const code of INSPECTION_LANGUAGES) {
    const finding = at(all[code].findings, index, code + ' finding');
    assert.equal(finding.translated, true, code);
    titles.add(finding.title);
  }
  assert.ok(titles.size >= 3, 'the comparison title must differ between scripts');
  // ...and none of them invented a different finding.
  for (const code of INSPECTION_LANGUAGES) {
    assert.equal(
      at(all[code].findings, index, code + ' finding').severityLabel,
      labelFor(code, 'severity.' + source.severity),
    );
  }
});

test('an unlocalized model sentence is never presented as translated', async () => {
  // Every localized finding carries a flag that says which it is. This is the
  // guarantee that the UI cannot imply a translation it does not have.
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  for (const code of INSPECTION_LANGUAGES) {
    for (const finding of all[code].findings) {
      assert.equal(typeof finding.translated, 'boolean', code);
      assert.equal(
        finding.translated,
        view.inspectionFindings.some((f) => f.id === finding.id && f.origin === 'COMPARISON'),
        code + ' ' + finding.id,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * Arabic
 * ------------------------------------------------------------------ */

test('the Arabic projection is marked right-to-left and the others are not', async () => {
  const { view } = await runInspection();
  const all = localizeInspectionAll(inputFor(view));
  assert.equal(all.ar.dir, 'rtl');
  assert.equal(all.en.dir, 'ltr');
  assert.equal(all.fr.dir, 'ltr');
  assert.equal(all.zh.dir, 'ltr');
});

test('Arabic labels contain Arabic script and no untranslated English chrome', async () => {
  const { view } = await runInspection();
  const ar = localizeInspection(inputFor(view), 'ar');
  const derived = view.inspectionFindings.findIndex((f) => f.origin === 'COMPARISON');
  assert.ok(derived > -1);
  const arFinding = at(ar.findings, derived, 'arabic comparison finding');

  assert.match(at(ar.comparison, 0, 'ar comparison row').statusLabel, /[\u0600-\u06FF]/);
  assert.match(arFinding.severityLabel, /[\u0600-\u06FF]/);
  assert.match(arFinding.reason, /[\u0600-\u06FF]/);
  // The regenerated, comparison-derived prose is Arabic in every language that
  // is not the model's own.
  assert.match(arFinding.title, /[\u0600-\u06FF]/);
  assert.match(arFinding.recommendation, /[\u0600-\u06FF]/);
  assert.match(ar.brief.overallLabel, /[\u0600-\u06FF]/);
});

test('Arabic keeps model ids and numbers readable inside Arabic text', async () => {
  const { view } = await runInspection();
  const ar = localizeInspection(inputFor(view), 'ar');
  const index = view.comparison.findIndex((r) => r.element === 'COLUMN');
  const observed = at(ar.comparison, index, 'ar COLUMN row').observedText;

  // Digits sit inside Arabic words. They must not be separated by any mark, and
  // must not be written in Arabic-Indic digits, because the underlying value is
  // the Western-digit one the pipeline produced.
  assert.match(observed, /9/);
  assert.doesNotMatch(observed, /[\u0660-\u0669]/, 'the canonical digits must not be renumbered');
});

/* ------------------------------------------------------------------ *
 * Chinese
 * ------------------------------------------------------------------ */

test('the Chinese projection renders CJK and carries no Latin chrome', async () => {
  const { view } = await runInspection();
  const zh = localizeInspection(inputFor(view), 'zh');
  const derived = view.inspectionFindings.findIndex((f) => f.origin === 'COMPARISON');
  assert.ok(derived > -1);
  const zhFinding = at(zh.findings, derived, 'chinese comparison finding');

  assert.match(zhFinding.severityLabel, /[\u4E00-\u9FFF]/);
  assert.match(zhFinding.reason, /[\u4E00-\u9FFF]/);
  assert.match(zhFinding.title, /[\u4E00-\u9FFF]/);
  assert.match(zhFinding.recommendation, /[\u4E00-\u9FFF]/);
  assert.match(zh.brief.overallLabel, /[\u4E00-\u9FFF]/);
  // Chinese has no plural, so a counted noun must not gain an English "s".
  const index = view.comparison.findIndex((r) => r.element === 'COLUMN');
  assert.doesNotMatch(at(zh.comparison, index, 'zh COLUMN row').observedText, /\u67f1s/);
});

test('a long Chinese string is allowed to wrap rather than clip', () => {
  // The wrapping rule is what keeps a long CJK sentence inside its panel. Assert
  // the rule exists in the stylesheet rather than trusting a visual check alone.
  assert.match(APP_CSS, /\.i18n-surface\[dir="rtl"\]/);
  assert.match(APP_CSS, /overflow-wrap:\s*anywhere/);
});

/* ------------------------------------------------------------------ *
 * No reinspection
 * ------------------------------------------------------------------ */

test('localizing performs no inference at all', async () => {
  const { view, visionCalls, reasonCalls } = await runInspection();
  const visionAfterRun = visionCalls.length;
  const reasoningAfterRun = reasonCalls.length;
  assert.ok(visionAfterRun >= 1, 'the run really did call the vision stage');
  assert.equal(reasoningAfterRun, 1, 'the run really did call the reasoning stage');

  const after = visionCalls.length + reasonCalls.length;
  // Every language, computed from the finished result.
  localizeInspectionAll(inputFor(view));
  localizeInspection(inputFor(view), 'fr');
  localizeInspection(inputFor(view), 'ar');
  localizeInspection(inputFor(view), 'zh');

  assert.equal(visionCalls.length + reasonCalls.length, after, 'localization must not call any model');
});

test('localization leaves the NVIDIA qualification untouched', async () => {
  const { view } = await runInspection();
  const before = JSON.stringify(view.pipelineEligibility);
  localizeInspectionAll(inputFor(view));
  assert.equal(JSON.stringify(view.pipelineEligibility), before);

  assert.equal(view.pipelineEligibility.nvidiaRequirement, 'MET');
  assert.equal(view.pipelineEligibility.qualifyingStage, 'REASONING');
  assert.equal(view.pipelineEligibility.platform, 'Nebius Token Factory');
  assert.equal(view.pipelineEligibility.stages[0]?.isNvidiaModel, false);
  assert.equal(view.pipelineEligibility.stages[1]?.isNvidiaModel, true);
});

test('the session ships every language in the same payload', async () => {
  const { view } = await runInspection();
  assert.ok(view.localized !== undefined && view.localized !== null);
  for (const code of INSPECTION_LANGUAGES) {
    assert.ok(view.localized[code] !== undefined, code + ' must ship with the payload');
  }
});

/* ------------------------------------------------------------------ *
 * The client
 * ------------------------------------------------------------------ */

interface StubNode {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  lang: string;
  dir: string;
  type: string;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  children: StubNode[];
  appendChild(child: StubNode): StubNode;
  removeChild(child: StubNode): void;
  get firstChild(): StubNode | null;
  text(): string;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
  listeners: Record<string, ((event: unknown) => void)[]>;
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
    type: '',
    dataset: {},
    attrs: {},
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
    },
    get firstChild() {
      return this.children.length > 0 ? (this.children[0] as StubNode) : null;
    },
    text() {
      if (this.children.length === 0) return this.textContent;
      return this.children.map((c) => c.text()).join(' ');
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
      if (name === 'lang') this.lang = value;
      if (name === 'dir') this.dir = value;
    },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
  };
  return node;
}

/**
 * Run the REAL language code from APP_JS, with an api() that records every
 * call it is asked to make. A single call here would be a defect.
 */
function languageHarness(stored: string | null) {
  const nodes = new Map<string, StubNode>();
  const surfaces = [stubNode('section'), stubNode('section'), stubNode('section')];
  const storage = new Map<string, string>();
  if (stored !== null) storage.set('sitelens.inspectionLanguage', stored);

  const root = stubNode('html');
  const document = {
    documentElement: root,
    createElement: (tag: string) => stubNode(tag),
    createTextNode: (text: string) => {
      const n = stubNode('#text');
      n.textContent = text;
      return n;
    },
    getElementById: (id: string) => {
      const existing = nodes.get(id);
      if (existing) return existing;
      const created = stubNode('div');
      nodes.set(id, created);
      return created;
    },
    querySelectorAll: (selector: string) => (selector === '.i18n-surface' ? surfaces : []),
  };

  const apiCalls: string[] = [];
  let rendered = 0;

  const context: Record<string, unknown> = {
    document,
    window: {
      localStorage: {
        getItem: (k: string) => (storage.has(k) ? (storage.get(k) as string) : null),
        setItem: (k: string, v: string) => { storage.set(k, v); },
      },
      console: { error: () => {} },
    },
    console: { error: () => {} },
    api: (...args: unknown[]) => { apiCalls.push(String(args[0])); return Promise.resolve({}); },
    fetch: () => { apiCalls.push('fetch'); return Promise.reject(new Error('no network in this test')); },
    setTimeout,
    // Stands in for the real renderAll, and calls the REAL applyLanguage so the
    // direction attributes are exercised rather than asserted about.
    renderAll: () => { rendered++; },
  };
  vm.createContext(context);

  // The language runtime sits in one contiguous block at the top of the client,
  // between the `$` helper and the tab order constant. Take that block verbatim,
  // plus the wiring function, and run the shipped text rather than a copy.
  const start = APP_JS.indexOf('const $ = (id)');
  const end = APP_JS.indexOf('const TAB_ORDER');
  const wire = APP_JS.indexOf('function wireLanguage()');
  const wireEnd = APP_JS.indexOf('\n}', wire) + 2;
  assert.ok(start > -1 && end > start, 'the language runtime must be at the top of the client');
  assert.ok(wire > end, 'wireLanguage must come after the language runtime');

  new vm.Script(APP_JS.slice(start, end) + '\n' + APP_JS.slice(wire, wireEnd)).runInContext(context);

  const ctx = context as { wireLanguage: () => void; applyLanguage: () => void; renderAll: () => void };
  ctx.renderAll = () => { rendered++; ctx.applyLanguage(); };
  ctx.wireLanguage();

  return {
    nodes,
    surfaces,
    root,
    storage,
    apiCalls,
    renderedCount: () => rendered,
    select: () => nodes.get('lang-select') as StubNode,
    change: (value: string) => {
      const select = nodes.get('lang-select') as StubNode;
      select.value = value;
      for (const handler of select.listeners.change ?? []) handler({ target: select });
    },
  };
}

test('the language control is built from the server vocabulary with endonyms', () => {
  const h = languageHarness(null);
  const options = h.select().children;
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((o) => o.textContent), ['English', 'Fran\u00e7ais', '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', '\u4e2d\u6587']);
  assert.deepEqual(options.map((o) => o.value), ['en', 'fr', 'ar', 'zh']);
  // Each option declares its own script so an RTL list announces correctly.
  const arabic = at(options, 2, 'arabic option');
  assert.equal(arabic.dir, 'rtl');
  assert.equal(arabic.lang, 'ar');
});

test('switching language re-renders and issues NO request', () => {
  const h = languageHarness(null);
  for (const code of ['fr', 'ar', 'zh', 'en']) {
    h.change(code);
  }
  assert.deepEqual(h.apiCalls, [], 'a language switch must not touch the network');
  assert.equal(h.renderedCount(), 4);
});

test('the switch reaches the localized surfaces, not the whole document', () => {
  const h = languageHarness(null);
  h.change('ar');
  for (const surface of h.surfaces) {
    assert.equal(surface.dir, 'rtl');
    assert.equal(surface.lang, 'ar');
  }
  h.change('zh');
  for (const surface of h.surfaces) {
    assert.equal(surface.dir, 'ltr');
    assert.equal(surface.lang, 'zh-CN');
  }
});

test('the chosen language survives a reload', () => {
  const h = languageHarness(null);
  h.change('ar');
  assert.equal(h.storage.get('sitelens.inspectionLanguage'), 'ar');

  // A fresh boot reads the preference back and starts in that language.
  const reloaded = languageHarness('ar');
  assert.equal(reloaded.select().value, 'ar');
});

test('an unsupported stored language falls back to English rather than breaking', () => {
  const h = languageHarness('de');
  assert.equal(h.select().value, 'en');
  h.change('de');
  assert.equal(h.select().value, 'de', 'the select reflects the raw value; the app falls back');
  assert.deepEqual(h.apiCalls, []);
});

test('the localized surface carries lang and dir in the markup', () => {
  for (const bay of ['bay-inspect', 'bay-evidence', 'bay-findings']) {
    assert.match(INDEX_HTML, new RegExp('id="' + bay + '"'));
  }
  assert.equal((INDEX_HTML.match(/class="bay[^"]*i18n-surface/g) ?? []).length, 3);
  assert.match(INDEX_HTML, /id="lang-select"/);
  // The label names the select through the wrapping label's `for`, and carries
  // the catalog key so its text follows the chosen language.
  assert.match(INDEX_HTML,
    /<label class="lang-sel" for="lang-select"[^>]*>\s*<span class="lang-k" id="lang-label"[^>]*data-i18n="lang\.label"/);
  // The control itself stays LTR. It is in the identity strip, which is never a
  // localized surface, and it declares so explicitly rather than relying on it.
  // Extra attributes (tooltip) are allowed; the three invariants are for, dir
  // and the LTR declaration.
  assert.match(INDEX_HTML, /<label class="lang-sel" for="lang-select"[^>]*dir="ltr"[^>]*>/);
  // The presentation-only hint lives as a tooltip, not as visible header text,
  // so the identity strip stays compact.
  assert.match(INDEX_HTML, /<label class="lang-sel"[^>]*data-i18n-title="lang\.hint"/);
  assert.doesNotMatch(INDEX_HTML, /id="lang-note"/);
});

test('the client is still valid JavaScript after the catalog is injected', () => {
  assert.doesNotThrow(() => new vm.Script(APP_JS));
  assert.ok(APP_JS.includes('const I18N = {'), 'the catalog must actually be served');
});

test('the language control is not wired to any inspection action', () => {
  // Structural guard: the switch handler must not reference an endpoint.
  const wire = APP_JS.slice(APP_JS.indexOf('function wireLanguage()'));
  const body = wire.slice(0, wire.indexOf('\n}'));
  assert.doesNotMatch(body, /\/api\//);
  assert.doesNotMatch(body, /\bapi\(/);
  assert.doesNotMatch(body, /\bfetch\(/);
  assert.doesNotMatch(body, /runInspection|POST/);
});