/**
 * AI observation / finding / reasoning localization.
 *
 * The header must be compact (no long presentation-only disclaimer as visible
 * text); the hint survives only as a tooltip. Model-authored English must be
 * understandable in the selected language through an offline, deterministic
 * translation memory, with the original always preserved and reachable via a
 * View-original control, honest fallback when the memory has no entry, and no
 * mutation of inspection truth.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSPECTION_LANGUAGES,
  UI_STRINGS,
} from '../src/localization.ts';
import {
  MODEL_TRANSLATION_VERSION,
  buildModelTranslationMap,
  clearModelTranslationCache,
  collectModelProse,
  hasModelTranslation,
  modelTranslationCacheSize,
  translateModelText,
  translateModelTexts,
} from '../src/model-translation.ts';
import { InspectionSession } from '../src/session.ts';
import { NebiusNvidiaProvider } from '../src/providers/nebius-nvidia.provider.ts';
import { NemotronReasoner } from '../src/providers/nemotron-reasoner.ts';
import {
  resolveReasoningConfig,
  DEFAULT_NEBIUS_MODEL,
  DEFAULT_REASONING_MODEL,
} from '../src/config.ts';
import { defaultExpectedState } from '../src/expected-state.ts';
import { demoCaptures } from '../src/captures.ts';
import { APP_CSS, APP_JS, INDEX_HTML } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * Fixtures: one real inspection with stubbed network, no paid calls.
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
              element: 'MEP_ROUGH_IN', present: true, count: null, confidence: 0.71,
              evidence: 'Services are partially visible behind the frame; extent is unclear.',
            },
          ],
          observations: [
            {
              category: 'PROGRESS_OBSERVATION',
              observation: 'Column casting is part way across the bay.',
              evidence: { description: 'formwork and column starters mid-frame' },
              confidence: 0.79, severity: 'INFO', suggested_action: 'HUMAN_REVIEW',
            },
            {
              category: 'OBSERVED_ELEMENT',
              observation: 'Embedded electrical conduit is visible along the wall.',
              evidence: { description: 'A continuous conduit run is visible against the wall surface.' },
              confidence: 0.81, severity: 'INFO', suggested_action: 'NO_ACTION',
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
            {
              title: 'Embedded conduit run along the wall',
              category: 'COORDINATION',
              severity: 'LOW',
              observation: 'An embedded electrical conduit run is visible along the wall.',
              reason: 'The conduit path should be confirmed against the MEP layout before covering.',
              evidence: 'A linear conduit is visible running horizontally along the wall.',
              confidence: 0.66,
              recommendation: 'Verify the conduit route against the approved MEP drawing before concealment.',
              element: 'MEP_ROUGH_IN',
              location: 'along the wall',
              bounding_box: null,
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
  const calls: unknown[] = [];
  return {
    calls,
    fetchImpl: async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body) as unknown);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
}

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
    'proj_tr',
    'zone_level_02',
    defaultExpectedState(),
    { reasoner, projectName: 'North Core Construction' },
  );
  const view = await session.run();
  return { session, view, visionCalls: vision.calls, reasonCalls: reasoning.calls };
}

/* ------------------------------------------------------------------ *
 * Header: compact, no long disclaimer as visible text.
 * ------------------------------------------------------------------ */

test('the long presentation-only disclaimer is not visible header text', () => {
  assert.doesNotMatch(INDEX_HTML, /id="lang-note"/);
  assert.doesNotMatch(INDEX_HTML, /class="lang-note"/);
  assert.doesNotMatch(APP_CSS, /\.lang-note\s*\{/);
  // Neither the old nor the current wording may appear as visible header copy.
  // The hint survives only inside a title attribute (tooltip).
  const withoutTitles = INDEX_HTML.replace(/title="[^"]*"/g, '');
  assert.doesNotMatch(withoutTitles, /Presentation only/);
  assert.doesNotMatch(withoutTitles, /unchangeable/);
  assert.doesNotMatch(withoutTitles, /provenance are unchange/);
});

test('the header keeps its identity, navigation, status and language control', () => {
  for (const id of ['meta-zone', 'meta-capture', 'meta-reviewer', 'proj-btn', 'lamp', 'state-label', 'lang-select', 'hdr-model', 'hdr-reasoner', 'hdr-provenance']) {
    assert.ok(INDEX_HTML.includes('id="' + id + '"'), 'header must keep ' + id);
  }
  for (const key of ['tab.capture', 'tab.inspect', 'tab.evidence', 'tab.findings']) {
    assert.ok(INDEX_HTML.includes('data-i18n="' + key + '"'), 'nav must keep ' + key);
  }
  // The hint is relocated to contextual help: a tooltip on the control.
  assert.match(INDEX_HTML, /data-i18n-title="lang\.hint"/);
});

test('the identity strip stays compact and responsive', () => {
  // No visible note element that could grow the strip; the control is
  // inline-flex with a small gap, and the meta strip hides on narrow widths.
  assert.match(APP_CSS, /\.lang-sel\s*\{[^}]*display:\s*inline-flex/);
  assert.match(APP_CSS, /@media \(max-width: 900px\)/);
  assert.match(APP_CSS, /\.rig-meta\s*\{\s*display:\s*none/);
});

/* ------------------------------------------------------------------ *
 * Memory: exact, honest, cached, no invention.
 * ------------------------------------------------------------------ */

test('known model sentences translate in all three languages', () => {
  clearModelTranslationCache();
  const source = 'Embedded electrical conduit is visible along the wall.';
  const fr = translateModelText(source, 'fr');
  const ar = translateModelText(source, 'ar');
  const zh = translateModelText(source, 'zh');
  assert.equal(fr.translated, true);
  assert.equal(ar.translated, true);
  assert.equal(zh.translated, true);
  assert.equal(fr.provider, MODEL_TRANSLATION_VERSION);
  assert.match(fr.text, /conduit électrique encastré/);
  assert.match(ar.text, /[\u0600-\u06FF]/);
  assert.match(zh.text, /[\u4E00-\u9FFF]/);
  // The three presentations differ; none is the English source.
  assert.notEqual(fr.text, source);
  assert.notEqual(ar.text, source);
  assert.notEqual(zh.text, source);
  assert.notEqual(fr.text, ar.text);
});

test('English resolves to the original with no translation claim', () => {
  const source = 'Embedded electrical conduit is visible along the wall.';
  const en = translateModelText(source, 'en');
  assert.equal(en.text, source);
  assert.equal(en.translated, false);
  assert.equal(en.provider, 'none');
});

test('unknown text falls back to the original and never invents', () => {
  const source = 'A completely novel site sentence no memory holds, with zephyr 42.';
  for (const lang of ['fr', 'ar', 'zh'] as const) {
    const out = translateModelText(source, lang);
    assert.equal(out.text, source);
    assert.equal(out.translated, false);
    assert.equal(out.provider, 'none');
    assert.equal(hasModelTranslation(source, lang), false);
  }
});

test('empty and non-string input never yield empty or invented text', () => {
  assert.equal(translateModelText('', 'fr').text, '');
  assert.equal(translateModelText('   ', 'fr').translated, false);
  assert.equal(translateModelText(null, 'fr').translated, false);
});

test('valid cached translations are reused', () => {
  clearModelTranslationCache();
  assert.equal(modelTranslationCacheSize(), 0);
  translateModelText('Column casting is part way across the bay.', 'fr');
  const afterFirst = modelTranslationCacheSize();
  assert.ok(afterFirst > 0);
  translateModelText('Column casting is part way across the bay.', 'fr');
  assert.equal(modelTranslationCacheSize(), afterFirst);
  translateModelTexts(['Column casting is part way across the bay.', 'Column casting is part way across the bay.'], 'ar');
});

test('a changed source never serves an outdated translation', () => {
  const a = translateModelText('Walk the trench edge and confirm the barrier is in place.', 'fr');
  assert.equal(a.translated, true);
  const b = translateModelText('Walk the trench edge and confirm the barrier is in place! ', 'fr');
  // Trailing punctuation/whitespace changes the key only by trim; an actually
  // different sentence misses the memory and falls back honestly.
  const c = translateModelText('Walk the trench edge tomorrow and confirm the barrier.', 'fr');
  assert.equal(c.translated, false);
  assert.equal(c.text, 'Walk the trench edge tomorrow and confirm the barrier.');
});

/* ------------------------------------------------------------------ *
 * Inspection integration: shipped with the view, no new inference.
 * ------------------------------------------------------------------ */

test('the inspection ships model translations without extra inference', async () => {
  clearModelTranslationCache();
  const { view, visionCalls, reasonCalls } = await runInspection();
  const visionBefore = visionCalls.length;
  const reasonBefore = reasonCalls.length;
  assert.ok(visionBefore >= 1);
  assert.equal(reasonBefore, 1);
  assert.ok(view.modelTranslations !== undefined && view.modelTranslations !== null);

  // The conduit observation, the excavation finding and the reasoning summary
  // all resolve in French.
  const conduit = 'Embedded electrical conduit is visible along the wall.';
  assert.equal(view.modelTranslations[conduit]?.fr.translated, true);
  assert.match(view.modelTranslations[conduit]?.fr.text ?? '', /conduit électrique encastré/);
  const excavation = 'An open excavation is visible beside the working area.';
  assert.equal(view.modelTranslations[excavation]?.fr.translated, true);
  const summary = 'Column casting is part way across the bay and cannot be settled from one frame.';
  assert.equal(view.modelTranslations[summary]?.zh.translated, true);

  // Building every language reuses the cache and calls no model.
  buildModelTranslationMap(collectModelProse({
    detections: [],
    observations: [],
    findings: [],
    reasoning: null,
  }));
  assert.equal(visionCalls.length, visionBefore);
  assert.equal(reasonCalls.length, reasonBefore);
});

test('switching languages never reruns vision or reasoning', async () => {
  const { view, visionCalls, reasonCalls } = await runInspection();
  const before = visionCalls.length + reasonCalls.length;
  // A language switch is a local read of the pre-shipped map.
  for (const lang of INSPECTION_LANGUAGES) {
    const map = view.modelTranslations;
    for (const source of Object.keys(map).slice(0, 5)) {
      translateModelText(source, lang);
    }
  }
  assert.equal(visionCalls.length + reasonCalls.length, before);
});

test('the original English stays intact and available', async () => {
  const { view } = await runInspection();
  const source = 'An embedded electrical conduit run is visible along the wall.';
  const entry = view.modelTranslations[source];
  assert.ok(entry !== undefined);
  assert.equal(entry.en.text, source);
  // The French display differs, but the source key IS the original.
  assert.notEqual(entry.fr.text, source);
  assert.equal(entry.fr.translated, true);
  // Unknown text keeps its original with no translation claim.
  const unknown = 'Zephyr sentence 99, never in memory.';
  assert.equal(translateModelText(unknown, 'fr').text, unknown);
});

test('cached and restored inspections carry the same translations', async () => {
  const { view } = await runInspection();
  // JSON round-trip stands in for disk persistence: the map is data, so it
  // survives, and the same source still resolves to the same translation.
  const restored = JSON.parse(JSON.stringify(view.modelTranslations)) as typeof view.modelTranslations;
  const source = 'Embedded electrical conduit is visible along the wall.';
  assert.equal(restored[source]?.fr.text, view.modelTranslations[source]?.fr.text);
  assert.equal(restored[source]?.ar.translated, true);
});

test('translation leaves evidence, statuses, confidence and provenance untouched', async () => {
  const { view } = await runInspection();
  const before = JSON.stringify({
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.verificationStatus, f.confidence, f.title, f.observation]),
    observations: view.observations.map((o) => [o.id, o.observation, o.evidenceDescription, o.confidence]),
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
    reasoning: view.reasoning,
  });
  // Resolve every translation in every language.
  for (const source of Object.keys(view.modelTranslations)) {
    for (const lang of INSPECTION_LANGUAGES) translateModelText(source, lang);
  }
  const after = JSON.stringify({
    findings: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.verificationStatus, f.confidence, f.title, f.observation]),
    observations: view.observations.map((o) => [o.id, o.observation, o.evidenceDescription, o.confidence]),
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
    reasoning: view.reasoning,
  });
  assert.equal(after, before);
});

test('all supported languages resolve consistently', async () => {
  const { view } = await runInspection();
  const sources = [
    'Embedded electrical conduit is visible along the wall.',
    'Open excavation at the frame edge',
    'Column casting is part way across the bay and cannot be settled from one frame.',
  ];
  for (const source of sources) {
    const entry = view.modelTranslations[source];
    assert.ok(entry !== undefined, 'missing map entry for ' + source);
    assert.equal(entry.fr.translated, true, 'fr ' + source);
    assert.equal(entry.ar.translated, true, 'ar ' + source);
    assert.equal(entry.zh.translated, true, 'zh ' + source);
  }
  // Every new UI catalog key exists in all four languages with no placeholders.
  for (const key of ['tr.viewOriginal', 'tr.viewTranslation', 'tr.translatedBadge', 'tr.fallbackNote'] as const) {
    for (const lang of INSPECTION_LANGUAGES) {
      const value = UI_STRINGS[lang][key];
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0);
      assert.doesNotMatch(value, /\{[a-zA-Z]+\}/, lang + '.' + key + ' must not carry a placeholder');
    }
  }
});

test('the client renders translated prose with a view-original control', () => {
  // Structural guards on the shipped client: the lookup reads the pre-shipped
  // map, the toggle exists, and the switch still issues no request.
  assert.match(APP_JS, /function modelTx\(source\)/);
  assert.match(APP_JS, /view\.modelTranslations/);
  assert.match(APP_JS, /function trToggle\(/);
  assert.match(APP_JS, /t\('tr\.viewOriginal'\)/);
  assert.match(APP_JS, /t\('tr\.translatedBadge'\)/);
  assert.match(APP_JS, /t\('tr\.fallbackNote'\)/);
  const wire = APP_JS.slice(APP_JS.indexOf('function wireLanguage()'));
  const body = wire.slice(0, wire.indexOf('\n}'));
  assert.doesNotMatch(body, /\/api\//);
  assert.doesNotMatch(body, /\bapi\(/);
  assert.doesNotMatch(body, /\bfetch\(/);
});
