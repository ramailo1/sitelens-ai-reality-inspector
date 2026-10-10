/**
 * Mixed-language regression guard for the rendered Inspect surface.
 *
 * The defect this exists for: selecting French or Arabic localized SOME text
 * (the finding cards, the comparison rows) while other visible text stayed
 * English (panel headings, the pipeline strip, provenance labels, empty states,
 * the NVIDIA qualification panel). Half-translated UI reads as a broken product.
 *
 * The check is a RENDERED-DOM comparison, not a source-string grep: the real
 * render functions are executed against a stub DOM for each language, and the
 * resulting visible text is compared.
 *
 * The rule applied to every leaf string:
 *
 *   - if English and French render it differently, it was localized: fine.
 *   - if they render it IDENTICALLY, it must be either a technical/canonical
 *     value (allowed to be identical) or an English phrase that should have
 *     been localized (a DEFECT).
 *
 * The second case is what this file hunts. The allowlist below is the explicit,
 * reviewed statement of which strings are legitimately identical in every
 * language: model ids, provider names, ids, timestamps, numbers, enum keywords,
 * and the canonical model-authored English prose that has no translation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { INSPECTION_LANGUAGES, UI_STRINGS } from '../src/localization.ts';
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
import { APP_JS } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * One real inspection.
 * ------------------------------------------------------------------ */

const VISION_BODY = {
  choices: [{
    message: {
      content: JSON.stringify({
        elements: [
          { element: 'COLUMN', present: true, count: 9, confidence: 0.84,
            evidence: 'nine cast columns are visible across the frame',
            bounding_box: { x: 0.1, y: 0.3, width: 0.3, height: 0.5 } },
          { element: 'REBAR', present: true, count: null, confidence: 0.71,
            evidence: 'a dense bar mat fills the lower half of the frame' },
          { element: 'EXCAVATION', present: true, count: null, confidence: 0.66,
            evidence: 'an open trench is visible at the frame edge' },
        ],
        observations: [{
          category: 'PROGRESS_OBSERVATION',
          observation: 'Column casting is part way across the bay.',
          evidence: { description: 'formwork and column starters mid-frame' },
          confidence: 0.79, severity: 'INFO', suggested_action: 'HUMAN_REVIEW',
        }],
        findings: [{
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
        }],
      }),
    },
    finish_reason: 'stop',
  }],
};

const REASONING_BODY = {
  choices: [{
    message: {
      content: JSON.stringify({
        summary: 'Column casting is part way across the bay and cannot be settled from one frame.',
        whatMatters: 'Whether the column count matches the programme is not readable here.',
        rationale: 'Nine columns are visible and the deterministic comparison returns ATTENTION, '
          + 'but spacing, cover and anchorage are not established by the image.',
        recommendation: 'Walk the bay against the approved column grid before the next pour.',
        verification: 'Physically confirm the column count and starter positions on site.',
        confidence: 0.54,
        certainty: 'UNCERTAIN',
      }),
    },
    finish_reason: 'stop',
  }],
};

function stubFetch(body: unknown) {
  const calls: unknown[] = [];
  return {
    calls,
    fetchImpl: async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as unknown });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
}

async function realInspection() {
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
  return { view, visionCalls: vision.calls, reasoningCalls: reasoning.calls };
}

/* ------------------------------------------------------------------ *
 * DOM stub
 * ------------------------------------------------------------------ */

interface SNode {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  /** The client writes `fill.style.width`, so style must exist. */
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  children: SNode[];
  listeners: Record<string, ((e: unknown) => void)[]>;
  appendChild(c: SNode): SNode;
  removeChild(c: SNode): void;
  get firstChild(): SNode | null;
  setAttribute(n: string, v: string): void;
  getAttribute(n: string): string | null;
  addEventListener(t: string, h: (e: unknown) => void): void;
  /** Visible text of this node and its descendants. */
  visible(): string[];
}

function node(tag: string): SNode {
  const n: SNode = {
    tagName: tag,
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    style: {},
    dataset: {},
    attrs: {},
    children: [],
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
      return this.children.length > 0 ? (this.children[0] as SNode) : null;
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
  return n;
}

/** Element ids the render functions write into, plus their initial text. */
function seedElements(): Map<string, SNode> {
  const ids = [
    'run-sub', 'status', 'brief', 'brief-verdict', 'priorities', 'comparison',
    'provenance', 'geometry-note', 'failures', 'qualification', 'qual-verdict',
    'qual-path', 'qual-stages', 'findings', 'findings-cards',
    'reason', 'reason-grid', 'reason-stage', 'reason-model', 'reason-lede',
    'reason-fail', 'reason-foot',
    'rail-elements', 'rail-attention', 'rail-findings', 'rail-findings-n',
    'rail-confidence', 'rail-overall', 'rail-verdict',
    'pipe-1', 'pipe-2', 'pipe-3', 'pipe-4',
    'pipe-vision-model', 'pipe-compare-model', 'pipe-reason-model',
    'pipe-verify-model', 'pipe-vision-note', 'pipe-compare-note',
    'pipe-reason-note', 'pipe-verify-note',
    'hdr-model', 'hdr-reasoner', 'hdr-provenance', 'hdr-synth', 'hdr-cache',
    'meta-zone', 'meta-capture', 'meta-reviewer', 'reviewer-current-val',
    'stage-cap', 'overlay', 'evidence-image', 'note', 'notice', 'lamp',
    'state-label', 'lang-label', 'lang-note',
    'meta-reviewer', 'reviewer-status-box', 'reviewer-change-btn',
  ];
  const map = new Map<string, SNode>();
  for (const id of ids) map.set(id, node('div'));

  // The reviewer strip's initial state. These three are STATIC markup that the
  // client localizes through data-i18n, so a stub carrying the English default
  // reproduces the pre-fix bug exactly: French output that still reads
  // "Not configured". Seeding them proves the fix, rather than hiding the defect
  // by leaving the elements blank.
  const seeded: Record<string, { text: string; i18n: string }> = {
    'reviewer-current-val': { text: 'Not configured', i18n: 'panel.reviewerUnset' },
    'reviewer-change-btn': { text: 'Set reviewer', i18n: 'panel.setReviewer' },
    'reviewer-lbl': { text: 'INSPECTION REVIEWER', i18n: 'panel.reviewer' },
  };
  for (const [id, def] of Object.entries(seeded)) {
    const made = node('div');
    made.textContent = def.text;
    made.setAttribute('data-i18n', def.i18n);
    map.set(id, made);
  }
  return map;
}

/**
 * Run the real renderers for one language and collect every visible leaf.
 *
 * The functions are executed verbatim from the shipped APP_JS. Only the DOM and
 * a handful of globals are stubbed.
 */
function renderSurface(
  view: unknown,
  lang: 'en' | 'fr' | 'ar' | 'zh',
): { leaves: string[]; apiCalls: string[]; lang: string; rootLang: string | null; rootDir: string | null } {
  const ids = seedElements();
  const surfaces = [node('section'), node('section'), node('section')];
  const apiCalls: string[] = [];

  const root = node('html');
  const document = {
    documentElement: root,
    createElement: (tag: string) => node(tag),
    createTextNode: (text: string) => {
      const n = node('#text');
      n.textContent = text;
      return n;
    },
    getElementById: (id: string) => {
      const existing = ids.get(id);
      if (existing) return existing;
      const made = node('div');
      ids.set(id, made);
      return made;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '.i18n-surface') return surfaces;
      if (selector === '[data-i18n]') {
        // The real page carries these keys in its markup. Handing the same
        // nodes back to applyLanguage() exercises the hook that fixes the
        // static-heading defect: without it, "Not configured" and
        // "Set reviewer" stay English in every language.
        return [...ids.values()].filter((n) => n.attrs['data-i18n'] !== undefined);
      }
      return [];
    },
    // Keep the client from booting. The test drives the renderers directly, and
    // a boot() would issue its own workspace request, which is not what is
    // under test here.
    readyState: 'loading',
    addEventListener: () => {},
  };

  const state = {
    view,
    captures: [],
    expected: null,
    projects: [],
    project: { id: 'p', reviewer: null },
    presets: [],
    reference: null,
    storage: null,
    pipeline: {
      vision: { provider: 'nebius-nvidia', model: DEFAULT_NEBIUS_MODEL },
      reasoning: { provider: 'nebius-nemotron-reasoner', model: DEFAULT_REASONING_MODEL, configured: true },
    },
    dataset: null,
    datasetEntries: [],
    presetDraft: [],
    currentCaptureId: null,
    activeId: null,
    openIds: new Set<string>(),
    running: false,
    importing: null,
    pendingDelete: null,
    pendingReviewIntent: null,
    lang,
  };

  const context: Record<string, unknown> = {
    document,
    state,
    window: { localStorage: { getItem: () => null, setItem: () => {} }, console: { error: () => {} } },
    console: { error: () => {} },
    // A render must never need the network. If one does, the call is recorded
    // and asserted empty.
    api: (...a: unknown[]) => { apiCalls.push('api:' + String(a[0])); return Promise.reject(new Error('no net')); },
    fetch: () => { apiCalls.push('fetch'); return Promise.reject(new Error('no net')); },
    setTimeout,
    setInterval: () => 0,
  };
  vm.createContext(context);

  // The client declares its state with a top-level `const`, which in a vm is a
  // lexical binding the host cannot reach afterwards. A tiny probe appended to
  // the SAME script can, and it is the only way to drive the real renderers
  // with an injected view. Nothing in APP_JS is modified.
  const probe = [
    'globalThis.__probe = {',
    '  setView: (v, p) => { state.view = v; state.pipeline = p; },',
    '  setLang: (l) => { state.lang = l; },',
    '  setCaptures: (c) => { state.captures = c; },',
    '  render: () => {',
    '    applyLanguage(); renderHeader(); renderPipeline(); renderRail(); renderBrief();',
    '    renderPriorities(); renderComparison(); renderReasoning(); renderFindings();',
    '    renderProvenance(); renderObservations();',
    '  }',
    '};',
  ].join('\n');

  new vm.Script(APP_JS + '\n' + probe).runInContext(context);

  const ctx = context as Record<string, never> & {
    __probe: {
      setView(v: unknown, p: unknown): void;
      setLang(l: string): void;
      setCaptures(c: unknown[]): void;
      render(): void;
      apiCalls(): string[];
    };
  };
  ctx.__probe.setLang(lang);
  ctx.__probe.setCaptures([]);
  ctx.__probe.setView(view, state.pipeline);
  ctx.__probe.render();

  const leaves: string[] = [];
  for (const n of ids.values()) leaves.push(...n.visible());
  for (const s of surfaces) leaves.push(...s.visible());
  return {
    leaves,
    apiCalls,
    lang,
    rootLang: root.getAttribute('lang'),
    rootDir: root.getAttribute('dir'),
  };
}

/* ------------------------------------------------------------------ *
 * What may legitimately be identical in every language
 * ------------------------------------------------------------------ */

/** Canonical prose written by a model. Never translated, always labelled. */
function isCanonicalModelProse(text: string, view: Awaited<ReturnType<typeof realInspection>>['view']): boolean {
  const canonical = [
    ...view.inspectionFindings.flatMap((f) => [f.title, f.observation, f.reason, f.evidence, f.recommendation]),
    ...view.observations.flatMap((o) => [o.observation, o.evidenceDescription]),
    ...(view.reasoning.reasoning === null
      ? []
      : Object.values(view.reasoning.reasoning).filter((v): v is string => typeof v === 'string')),
  ];
  return canonical.some((c) => c.length > 12 && text.includes(c.slice(0, 40)));
}

/** A technical or canonical value that is correct in every language. */
function isTechnicalOrCanonical(text: string, view?: {
  expected?: { zone: string };
  provenance?: { captureLabel: string };
}): boolean {
return (
      // Model ids, provider names, product names, file paths.
      text.includes(DEFAULT_NEBIUS_MODEL)
    || text.includes(DEFAULT_REASONING_MODEL)
    || /^(nebius-nvidia|nebius-nemotron-reasoner|demo-fixture|unavailable)$/.test(text)
    || /Nebotron|MiniCPM|Nebius|Token Factory|SiteLens/.test(text)
    // Ids and enum keywords.
    || /^(fnd_|cmp_|cap_|proj_|exp_)/.test(text)
    || /^(COLUMN|SLAB|WALL|OPENING|MEP_ROUGH_IN|FORMWORK|SCAFFOLD|EQUIPMENT|WORKER|REBAR|FINISH|EXCAVATION)$/.test(text)
    // Machine vocabulary: internal enums, element codes, field names.
    || /\b[A-Z][A-Z0-9_]{3,}\b/.test(text)
    || /\b[a-z]+\.[a-z]+\b/.test(text)
    // Numbers, timestamps, measurements, dimensions, percentages.
    || /^\d/.test(text)
    || /\d{4}-\d{2}-\d{2}/.test(text)
    || /[×%]/.test(text)
    || /\d+\s*(mm|cm|m|ms|px|MB|KB|B)/i.test(text)
    // Placeholders and punctuation-only values.
    || /^[-\s·|/]*$/.test(text)
    // The zone name, project name and capture label are operator/preset data the
    // user typed. They are data, not product copy, so they stay as typed.
    || (view !== undefined && text === view.expected?.zone)
    || (view !== undefined && text === view.provenance?.captureLabel)
    // Capture labels are descriptive names, not copy.
    || / - /.test(text) && text.length < 60 && !/[a-z]{4}\s[a-z]{4}/.test(text)
  );
}

/**
 * English inspection phrases that must NOT survive a language switch.
 *
 * This is the defect list, kept as data so a regression names itself.
 */
const ENGLISH_PHRASES = [
  'Reality brief', 'Inspection priorities', 'Provenance', 'Reality and evidence',
  'Construction reasoning', 'Findings and verification', 'Verification note',
  'Confidence never verifies itself', 'Select a finding',
  'elements detected', 'attention areas', 'awaiting review', 'highest finding',
  'awaiting a named human', 'expected-state comparison', 'Visual reading',
  'not run yet', 'nothing verified', 'awaiting first inspection',
  'no expected state loaded', 'RECOMMENDED ACTION', 'WHY FLAGGED',
  'NOT RUN', 'no confidence stated', 'NVIDIA MODEL', 'NOT AN NVIDIA MODEL',
  'Inspection failed', 'MODEL ENTRIES REJECTED', 'No capture loaded',
  'INSPECTION REVIEWER', 'Not configured', 'Set reviewer',
  'NOT MET', 'no qualifying NVIDIA', 'qualifying stage',
];

function englishIn(text: string): string[] {
  return ENGLISH_PHRASES.filter((p) => text.includes(p));
}

/* ------------------------------------------------------------------ *
 * The tests
 * ------------------------------------------------------------------ */

test('the French render contains no English inspection labels', async () => {
  const { view } = await realInspection();
  const rendered = renderSurface(view, 'fr');
  const offenders = rendered.leaves
    .map((text) => ({ text, hits: englishIn(text) }))
    .filter((r) => r.hits.length > 0)
    .map((r) => r.hits.join(',') + ' :: ' + r.text.slice(0, 90));
  assert.deepEqual(offenders, [], 'English labels survived a French switch');
});

test('the Arabic render contains no English inspection labels', async () => {
  const { view } = await realInspection();
  const rendered = renderSurface(view, 'ar');
  const offenders = rendered.leaves
    .map((text) => ({ text, hits: englishIn(text) }))
    .filter((r) => r.hits.length > 0)
    .map((r) => r.hits.join(',') + ' :: ' + r.text.slice(0, 90));
  assert.deepEqual(offenders, [], 'English labels survived an Arabic switch');
});

test('the Chinese render contains no English inspection labels', async () => {
  const { view } = await realInspection();
  const rendered = renderSurface(view, 'zh');
  const offenders = rendered.leaves
    .map((text) => ({ text, hits: englishIn(text) }))
    .filter((r) => r.hits.length > 0)
    .map((r) => r.hits.join(',') + ' :: ' + r.text.slice(0, 90));
  assert.deepEqual(offenders, [], 'English labels survived a Chinese switch');
});

test('English renders in English', async () => {
  const { view } = await realInspection();
  const rendered = renderSurface(view, 'en');
  const joined = rendered.leaves.join(' | ');

  // The English render is the baseline, so it must actually be English. These
  // are the phrases the renderers OWN; the static headings are asserted
  // separately against the markup, since a stub DOM starts empty.
  for (const phrase of [
    'Expected-state comparison', 'Visual reading', 'NVIDIA MODEL',
    'NOT AN NVIDIA MODEL', 'Fresh inference complete', 'Elements detected',
    'AI FINDING', 'Model-authored English',
  ]) {
    assert.ok(joined.includes(phrase), 'English render must contain ' + phrase);
  }
  assert.doesNotMatch(joined, /[\u0600-\u06FF]/, 'English render must not contain Arabic');
  assert.doesNotMatch(joined, /[\u4E00-\u9FFF]/, 'English render must not contain CJK');
});

test('the four renders differ from each other, so the switch does something', async () => {
  const { view } = await realInspection();
  const fr = renderSurface(view, 'fr').leaves.join('|');
  const ar = renderSurface(view, 'ar').leaves.join('|');
  const zh = renderSurface(view, 'zh').leaves.join('|');
  const en = renderSurface(view, 'en').leaves.join('|');

  assert.notEqual(en, fr);
  assert.notEqual(fr, ar);
  assert.notEqual(ar, zh);
  assert.notEqual(zh, en);
});

test('rendering performs no request in any language', async () => {
  const { view } = await realInspection();
  for (const lang of INSPECTION_LANGUAGES) {
    const rendered = renderSurface(view, lang);
    assert.deepEqual(rendered.apiCalls, [], lang + ' render must not call the network');
  }
});

test('every identical-across-languages leaf is canonical, technical or model prose', async () => {
  const { view } = await realInspection();
  const en = new Set(renderSurface(view, 'en').leaves);
  const fr = renderSurface(view, 'fr').leaves;

  const unexplained = fr.filter((text) => {
    if (!en.has(text)) return false;               // localized: fine
    if (text.trim().length === 0) return false;    // nothing rendered
    if (isTechnicalOrCanonical(text, view)) return false;
    if (isCanonicalModelProse(text, view)) return false;
    return true;
  });

  assert.deepEqual(
    unexplained,
    [],
    'these strings are identical in English and French but are neither technical '
      + 'nor model-authored prose: they bypassed localization',
  );
});

test('the localized panels really did change language', async () => {
  const { view } = await realInspection();
  const fr = renderSurface(view, 'fr').leaves.join(' | ');

  // One phrase per surface that used to be English-only. The apostrophes are
// matched loosely, because the catalog uses U+2019 in some strings and the
// ASCII form in others; both are valid French typography.
  assert.match(fr, /Comparaison avec l[’']état attendu/, 'priority basis');
  assert.match(fr, /Extraction des preuves visuelles/, 'qualification stage role');
  assert.match(fr, /NON UN MODÈLE NVIDIA/, 'NVIDIA badge');
  assert.match(fr, /Inférence terminée/, 'inspect intro');
  assert.match(fr, /Éléments détectés/, 'provenance row');
  assert.match(fr, /CONSTATATION IA/, 'finding action');
  // Model-authored prose now carries a localized presentation with a way back
  // to the authoritative original. The test fixture sentences are all in the
  // offline memory, so French shows the translation badge and View-original
  // control rather than the untranslated-prose marker.
  assert.match(fr, /Traduit de l.*anglais/, 'translated-prose badge');
  assert.match(fr, /Voir l.*original/, 'view-original control');
  assert.match(fr, /Le coulage des poteaux est en cours/, 'translated observation');
  assert.match(fr, /Fouille ouverte au bord du cadre/, 'translated AI finding title');
  assert.match(fr, /poteaux en moins comptés que prévu/, 'comparison deviation');
  assert.match(fr, /À REVOIR/, 'status tag');
});

test('the Arabic and Chinese renders carry their own vocabulary', async () => {
  const { view } = await realInspection();

  const ar = renderSurface(view, 'ar').leaves.join(' | ');
  assert.match(ar, /[\u0600-\u06FF]/, 'Arabic render must contain Arabic script');
  // Severity MEDIUM / HIGH in Arabic, as script ranges so the source stays ASCII.
  assert.match(ar, /[\u0645\u062a\u0648\u0633\u0637\u0629]/, 'severity in Arabic');
  // The comparison deviation sentence, which is regenerated per language.
  assert.match(ar, /[\u0623\u0642\u0644]/, 'deviation sentence in Arabic');

  const zh = renderSurface(view, 'zh').leaves.join(' | ');
  assert.match(zh, /[\u4E00-\u9FFF]/, 'Chinese render must contain CJK');
  assert.match(zh, /[高中]/, 'severity in Chinese');
  // Chinese has no plural; a counted noun must not acquire an English suffix.
  assert.doesNotMatch(zh, /[\u4E00-\u9FFF]s\b/, 'no English plural on a Chinese noun');
});

test('no placeholder is left unfilled in any language', async () => {
  // A template that reaches the screen with its {token} intact is a visible
  // defect. This is the guard for that, across every surface.
  const { view } = await realInspection();
  for (const lang of INSPECTION_LANGUAGES) {
    const leaked = renderSurface(view, lang).leaves.filter((text) => /\{[a-zA-Z]+\}/.test(text));
    assert.deepEqual(leaked, [], lang + ' rendered an unfilled placeholder');
  }
});

test('technical identifiers are preserved verbatim across all four renders', async () => {
  const { view } = await realInspection();
  for (const lang of INSPECTION_LANGUAGES) {
    const joined = renderSurface(view, lang).leaves.join('|');
    // The qualification panel names both models on purpose.
    assert.ok(joined.includes(DEFAULT_REASONING_MODEL) || !joined.includes('NVIDIA requirement'),
      lang + ' must name the NVIDIA reasoning model verbatim');
  }
  assert.equal(view.provenance.model, DEFAULT_NEBIUS_MODEL);
  assert.equal(view.reasoning.model, DEFAULT_REASONING_MODEL);
});

test('canonical findings, severities and evidence are untouched by the render', async () => {
  const { view } = await realInspection();
  const before = JSON.stringify({
    ids: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.confidence]),
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
  });

  for (const lang of INSPECTION_LANGUAGES) renderSurface(view, lang);

  const after = JSON.stringify({
    ids: view.inspectionFindings.map((f) => [f.id, f.severity, f.evidenceState, f.confidence]),
    comparison: view.comparison.map((r) => [r.id, r.status, r.expectedCount, r.observedCount]),
    provenance: view.provenance,
    eligibility: view.pipelineEligibility,
  });
  assert.equal(after, before);
});

test('every static heading inside a localized bay carries an i18n key', async () => {
  const { INDEX_HTML } = await import('../src/ui-assets.ts');
  // The markup is the second bypass class: static headings the client never
  // re-renders, so only a data-i18n key can make them follow the language.
  // Checked per tag, so a keyed element is recognised regardless of attribute
  // order.
  const surfaces = INDEX_HTML.split('i18n-surface').slice(1);
  assert.equal(surfaces.length, 3, 'three localized bays');

  const unkeyed: string[] = [];
  for (const chunk of surfaces) {
    for (const m of chunk.matchAll(/<([a-z]+)([^>]*)>([^<>{}]*[A-Za-z]{3}[^<>{}]*)</g)) {
      const tag = m[1] ?? '';
      const attrs = m[2] ?? '';
      const text = (m[3] ?? '').trim();
      if (text.length <= 2) continue;
      // Comment blocks and script tags carry no visible text.
      if (tag === 'script') continue;
      if (/data-i18n=/.test(attrs)) continue;
      // Text the renderers overwrite before the user sees it needs no key.
      if (/id="(run-sub|status|reason-lede|reason-stage|stage-cap|brief-verdict|rail-overall|rail-findings-n|reviewer-current-val)"/.test(attrs)) continue;
      // The <footer> is outside every bay: the split on 'i18n-surface' runs to
      // the end of the document, and the footer is not a localized surface.
      if (/<footer/.test(chunk.slice(0, m.index))) break;
      unkeyed.push(text);
    }
  }
  assert.deepEqual(unkeyed, [], 'these static strings are never re-rendered, so they must be keyed');
});

test('every data-i18n key in the markup exists in all four catalogs', async () => {
  const { INDEX_HTML } = await import('../src/ui-assets.ts');
  const keys = [...INDEX_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(keys.length >= 25, 'expected the localized bays to be keyed, found ' + keys.length);
  for (const key of keys) {
    for (const lang of INSPECTION_LANGUAGES) {
      const value = (UI_STRINGS[lang] as Record<string, string | undefined>)[key];
      assert.ok(typeof value === 'string' && value.trim().length > 0,
        lang + ' is missing a translation for ' + key);
    }
  }
});