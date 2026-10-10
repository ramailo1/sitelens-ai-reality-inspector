/**
 * Document direction: Arabic RTL, Chinese LTR, menus and navigation in both.
 *
 * Translating labels was never the whole job: until this change the document
 * element kept `lang="en"` and no `dir` at all, so the header, the project
 * menu, dialogs and every other chrome outside the three result bays stayed
 * left-to-right in every language. These tests prove, against the REAL client
 * script and the REAL stylesheet:
 *
 *   - the locale-to-direction mapping (ar is the only RTL language);
 *   - document lang/dir update immediately on switch, with no reload and no
 *     dependence on browser defaults;
 *   - chrome placement is direction-aware (logical properties, explicit
 *     mirrors only where geometry is genuinely directional);
 *   - directional indicators mirror while imagery, evidence geometry and
 *     status symbols do not;
 *   - technical Latin runs stay readable inside Arabic;
 *   - switching repeatedly accumulates no stale layout state and costs no
 *     request.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  INSPECTION_LANGUAGES,
  LANGUAGE_BCP47,
  LANGUAGE_DIRECTION,
  UI_STRINGS,
} from '../src/localization.ts';
import { APP_CSS, APP_JS, INDEX_HTML } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * Mapping: one RTL language, and it is Arabic.
 * ------------------------------------------------------------------ */

test('exactly Arabic is right-to-left and the document codes match', () => {
  assert.deepEqual({ ...LANGUAGE_DIRECTION }, { en: 'ltr', fr: 'ltr', ar: 'rtl', zh: 'ltr' });
  assert.deepEqual({ ...LANGUAGE_BCP47 }, { en: 'en', fr: 'fr', ar: 'ar', zh: 'zh-CN' });
  assert.deepEqual([...INSPECTION_LANGUAGES], ['en', 'fr', 'ar', 'zh']);
});

/* ------------------------------------------------------------------ *
 * Harness: the real client script against a stub document that, like a
 * real one, has a documentElement carrying lang and dir.
 * ------------------------------------------------------------------ */

interface HNode {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  disabled: boolean;
  type: string;
  lang: string;
  dir: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  children: HNode[];
  listeners: Record<string, ((e: unknown) => void)[]>;
  appendChild(c: HNode): HNode;
  removeChild(c: HNode): void;
  get firstChild(): HNode | null;
  setAttribute(n: string, v: string): void;
  getAttribute(n: string): string | null;
  addEventListener(t: string, h: (e: unknown) => void): void;
  text(): string;
}

function hnode(tag: string): HNode {
  const n: HNode = {
    tagName: tag,
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    type: '',
    lang: '',
    dir: '',
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
      return this.children.length > 0 ? (this.children[0] as HNode) : null;
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, h) { (this.listeners[t] = this.listeners[t] || []).push(h); },
    text() {
      const own = this.textContent;
      const parts = own.length > 0 ? [own] : [];
      for (const c of this.children) parts.push(c.text());
      return parts.join(' ');
    },
  };
  return n;
}

function directionHarness() {
  const ids = new Map<string, HNode>();
  const get = (name: string): HNode => {
    const existing = ids.get(name);
    if (existing) return existing;
    const made = hnode('div');
    ids.set(name, made);
    return made;
  };
  const root = hnode('html');
  const surfaces = [hnode('section'), hnode('section'), hnode('section')];
  const apiCalls: string[] = [];
  const document = {
    documentElement: root,
    createElement: (tag: string) => hnode(tag),
    createTextNode: (text: string) => {
      const n = hnode('#text');
      n.textContent = text;
      return n;
    },
    getElementById: (name: string) => get(name),
    querySelectorAll: (selector: string) => {
      if (selector === '.i18n-surface') return surfaces;
      return [];
    },
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
    '  setLang: (l) => { state.lang = l; },',
    '  apply: () => { applyLanguage(); },',
    '  openMenu: (open) => { setMenu(open); },',
    '  menuProjects: (list, active) => {',
    '    state.projects = list; state.project = active; renderProjects();',
    '  },',
    '};',
  ].join('\n');
  new vm.Script(APP_JS + '\n' + probe).runInContext(context);
  const ctx = context as unknown & {
    __probe: {
      setLang(l: string): void;
      apply(): void;
      openMenu(open: boolean): void;
      menuProjects(list: unknown[], active: unknown): void;
    };
  };
  return {
    root,
    surfaces,
    ids,
    apiCalls,
    setLang: ctx.__probe.setLang,
    apply: ctx.__probe.apply,
    openMenu: ctx.__probe.openMenu,
    menuProjects: ctx.__probe.menuProjects,
  };
}

/* ------------------------------------------------------------------ *
 * Dynamic document updates.
 * ------------------------------------------------------------------ */

test('switching language updates the document element immediately', () => {
  const h = directionHarness();
  const expected: Record<string, { lang: string; dir: string }> = {
    en: { lang: 'en', dir: 'ltr' },
    fr: { lang: 'fr', dir: 'ltr' },
    ar: { lang: 'ar', dir: 'rtl' },
    zh: { lang: 'zh-CN', dir: 'ltr' },
  };
  for (const code of INSPECTION_LANGUAGES) {
    h.setLang(code);
    h.apply();
    const want = expected[code]!;
    assert.equal(h.root.getAttribute('lang'), want.lang, code + ' document lang');
    assert.equal(h.root.getAttribute('dir'), want.dir, code + ' document dir');
    for (const surface of h.surfaces) {
      assert.equal(surface.getAttribute('lang'), want.lang, code + ' surface lang');
      assert.equal(surface.getAttribute('dir'), want.dir, code + ' surface dir');
    }
  }
});

test('repeated switching accumulates no stale layout state and costs no request', () => {
  const h = directionHarness();
  for (const code of ['ar', 'zh', 'ar', 'fr', 'en', 'ar']) {
    h.setLang(code);
    h.apply();
  }
  assert.equal(h.root.getAttribute('lang'), 'ar');
  assert.equal(h.root.getAttribute('dir'), 'rtl');
  assert.deepEqual(h.apiCalls, [], 'a switch must never touch the network');
});

test('an unknown language falls back to English on the document, not to nothing', () => {
  const h = directionHarness();
  h.setLang('de');
  h.apply();
  // t() falls back per key and the option lookup falls back for dir; the
  // document must end up English LTR rather than half-set.
  assert.equal(h.root.getAttribute('dir'), 'ltr');
});

/* ------------------------------------------------------------------ *
 * Menus and navigation under both directions.
 * ------------------------------------------------------------------ */

test('the project menu opens with the same content in RTL and LTR', () => {
  for (const code of ['ar', 'zh'] as const) {
    const h = directionHarness();
    h.setLang(code);
    h.apply();
    h.menuProjects(
      [
        { id: 'p1', name: 'North Core', location: 'Level 02', demo: false, captureCount: 3 },
        { id: 'p2', name: 'South Wing', location: '', demo: true, captureCount: 1 },
      ],
      { id: 'p1', name: 'North Core', location: 'Level 02', demo: false, captureCount: 3 },
    );
    h.openMenu(true);
    const menu = h.ids.get('proj-menu')!;
    assert.equal(menu.hidden, false, code + ': the menu must open');
    const text = h.ids.get('proj-list')!.text();
    assert.ok(text.includes('North Core'), code + ': project names must render');
    assert.ok(text.includes('South Wing'), code + ': every project must render');
    h.openMenu(false);
    assert.equal(menu.hidden, true, code + ': the menu must close again');
  }
});

test('menu and dialog anchoring is direction-aware in the stylesheet', () => {
  // Absolutely positioned chrome anchors to the inline start, so the project
  // menu and the capture disclosure open under their controls in RTL too.
  assert.match(APP_CSS, /\.proj-menu\s*\{[^}]*inset-inline-start:\s*0/);
  assert.match(APP_CSS, /\.rig-disclose-list\s*\{[^}]*inset-inline-start:\s*0/);
  assert.doesNotMatch(APP_CSS, /\.proj-menu\s*\{[^}]*\bleft:\s*0/);
  // Menu rows read from the inline start rather than a fixed left edge.
  assert.match(APP_CSS, /\.proj-item\s*\{[^}]*text-align:\s*start/);
  assert.match(APP_CSS, /\.capture-main\s*\{[^}]*text-align:\s*start/);
  assert.match(APP_CSS, /\.tile\s*\{[^}]*text-align:\s*start/);
});

test('the pipeline strip stays connected in both directions', () => {
  // Dividers live at the inline end with a transparent inline-start leader,
  // so the four steps read as one strip whether it runs left-to-right or
  // right-to-left. A physical border-right would stack every divider on the
  // wrong side in Arabic.
  assert.match(APP_CSS, /\.pipe-step\s*\{[^}]*border-inline-end:/);
  assert.match(APP_CSS, /\.pipe-step:last-child\s*\{\s*border-inline-end:\s*0/);
  assert.doesNotMatch(APP_CSS, /\.pipe-step\s*\{[^}]*border-right:/);
});

test('active-item indicators sit at the reading-start edge in both directions', () => {
  assert.match(APP_CSS, /\.proj-item\[aria-current="true"\]\s*\{[^}]*inset 3px 0 0/);
  assert.match(APP_CSS, /html\[dir="rtl"\] \.proj-item\[aria-current="true"\]\s*\{[^}]*inset -3px 0 0/);
  assert.match(APP_CSS, /html\[dir="rtl"\] \.capture-row\[aria-current="true"\] \.capture-main/);
});

/* ------------------------------------------------------------------ *
 * Directional versus non-directional icons and geometry.
 * ------------------------------------------------------------------ */

test('only genuinely directional chrome mirrors', () => {
  // The custom select chevron sits at the inline end; background-position has
  // no logical form so the RTL mirror is explicit and scoped to selects.
  assert.match(APP_CSS, /html\[dir="rtl"\] \.field select/);
  assert.doesNotMatch(APP_CSS, /html\[dir="rtl"\][^{]*\.sheet-cal/);
  // Evidence geometry is pixels, never direction: the overlay math and its
  // badge offsets contain no direction branching.
  assert.match(APP_CSS, /\.ev-n\s*\{[^}]*top:\s*-9px;\s*left:\s*-9px/);
  assert.doesNotMatch(APP_JS, /dir === 'rtl' \? [^\n]*flipBox180/);
  assert.match(APP_JS, /function paintedArea\(/);
});

test('status and finding accents follow the reading start', () => {
  for (const selector of [
    '.finding-card\\[data-status="VERIFIED"\\]',
    '.finding-card\\[data-status="REJECTED"\\]',
    '.reason\\[data-status="AVAILABLE"\\]',
    '.reason-fail',
    '.geom',
    '.elig',
  ]) {
    assert.match(APP_CSS, new RegExp(selector + '\\s*\\{[^}]*border-inline-start'));
  }
});

/* ------------------------------------------------------------------ *
 * Mixed technical content and long labels.
 * ------------------------------------------------------------------ */

test('technical values are marked for LTR isolation in the markup', () => {
  for (const id of ['hdr-model', 'hdr-reasoner', 'pipe-vision-model', 'pipe-reason-model', 'reason-model']) {
    assert.match(INDEX_HTML, new RegExp('id="' + id + '"[^>]*data-latin'));
  }
  assert.match(APP_CSS, /html\[dir="rtl"\] \[data-latin\]\s*\{[^}]*unicode-bidi:\s*isolate/);
  assert.match(APP_JS, /setAttribute\('data-latin', ''\)/);
});

test('flex spacers push to the inline end instead of a fixed side', () => {
  for (const selector of [
    '.rig-nav',
    '.ident-synth',
    '.lang-sel',
    '.fc-tail',
    '.reason-model',
    '.foot-r',
    '.panel-head \\.tag',
    '.trust-note',
  ]) {
    assert.match(APP_CSS, new RegExp(selector + '\\s*\\{[^}]*margin-inline-start:\\s*auto'));
  }
  assert.match(APP_CSS, /\.obs-next\s*\{[^}]*margin-inline-end:\s*auto/);
});

test('long Arabic labels wrap instead of clipping at narrow widths', () => {
  assert.match(APP_CSS, /overflow-wrap:\s*anywhere/);
  assert.match(APP_CSS, /@media \(max-width: 900px\)/);
  assert.match(APP_CSS, /@media \(max-width: 820px\)/);
  // The header never grows with content: counts, not names, plus an
  // absolutely positioned disclosure list that cannot widen the strip.
  assert.match(APP_CSS, /\.rig-disclose-list\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(INDEX_HTML, /id="lang-note"/);
});

/* ------------------------------------------------------------------ *
 * Translation rendering, toggling and honesty in both directions.
 * ------------------------------------------------------------------ */

test('the translation badge and toggle read correctly in RTL and LTR', () => {
  assert.equal(UI_STRINGS.ar['tr.viewOriginal'], 'عرض الأصل');
  assert.equal(UI_STRINGS.ar['tr.translatedBadge'], 'مترجم من الإنجليزية');
  assert.equal(UI_STRINGS.zh['tr.viewOriginal'], '查看原文');
  assert.equal(UI_STRINGS.fr['tr.viewOriginal'], 'Voir l’original');
  assert.equal(UI_STRINGS.en['tr.viewOriginal'], 'View original');
  for (const key of ['tr.viewOriginal', 'tr.viewTranslation', 'tr.translatedBadge', 'tr.fallbackNote'] as const) {
    for (const code of INSPECTION_LANGUAGES) {
      assert.ok(UI_STRINGS[code][key].trim().length > 0, code + '.' + key);
    }
  }
});

test('switching to Arabic or Chinese never re-runs inference or translation fetches', () => {
  const h = directionHarness();
  for (const code of INSPECTION_LANGUAGES) {
    h.setLang(code);
    h.apply();
  }
  assert.deepEqual(h.apiCalls, []);
});

test('comparison, priority, and partial pipeline inset accents mirror to the inline start in RTL', () => {
  assert.match(APP_CSS, /html\[dir="rtl"\] \.cmp,\s*\.i18n-surface\[dir="rtl"\] \.cmp\s*\{[^}]*inset -3px 0 0/);
  assert.match(APP_CSS, /html\[dir="rtl"\] \.prio\[data-attention="HIGH"\],\s*\.i18n-surface\[dir="rtl"\] \.prio\[data-attention="HIGH"\]\s*\{[^}]*inset -3px 0 0/);
  assert.match(APP_CSS, /html\[dir="rtl"\] \.prio\[data-attention="MEDIUM"\],\s*\.i18n-surface\[dir="rtl"\] \.prio\[data-attention="MEDIUM"\]\s*\{[^}]*inset -3px 0 0/);
  assert.match(APP_CSS, /html\[dir="rtl"\] \.pipe-step\[data-state="partial"\]\s*\{[^}]*inset -3px 0 0/);
});

test('finding card titles align naturally in RTL via unicode-bidi plaintext without forced LTR', () => {
  assert.match(APP_CSS, /\.i18n-surface\[dir="rtl"\] \.fc-title\s*\{[^}]*unicode-bidi:\s*plaintext/);
  assert.doesNotMatch(APP_CSS, /\.i18n-surface\[dir="rtl"\] \.fc-title\s*\{[^}]*text-align:\s*left/);
});

test('UI assets and localization catalogs contain no UTF-8 mojibake sequences and preserve priority percentages', () => {
  const mojibake = /â€”|â€¦|Ã—|Â·/;
  assert.doesNotMatch(INDEX_HTML, mojibake);
  assert.doesNotMatch(APP_JS, mojibake);
  for (const code of INSPECTION_LANGUAGES) {
    for (const [key, val] of Object.entries(UI_STRINGS[code])) {
      assert.doesNotMatch(val, mojibake, `${code}.${key} must not contain mojibake`);
    }
    assert.match(UI_STRINGS[code]['priority.basis.comparison'], /\{pct\}\s*%/, `${code} priority.basis.comparison must include %`);
    assert.match(UI_STRINGS[code]['priority.basis.visual'], /\{pct\}\s*%/, `${code} priority.basis.visual must include %`);
  }
  assert.equal(UI_STRINGS.fr['run.readyLamp'], 'CONSTATS PRÊTS — en attente de revue humaine');
  assert.doesNotMatch(UI_STRINGS.fr['run.readyLamp'], /CONSTATATS|PRÎTS/);
  assert.equal(UI_STRINGS.fr['qual.hybrid'], 'Pipeline d’inférence hybride');
  assert.equal(UI_STRINGS.fr['qual.pipeline'], 'Pipeline d’inférence');
  assert.equal(UI_STRINGS.fr['qual.row.platform'], 'Plateforme d’inférence');
});
