// Keyboard & assistive-technology regression tests for the critical workflow:

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { INDEX_HTML, APP_JS, APP_CSS } from '../src/ui-assets.ts';

// 1. Workflow tablist: roving tabindex + arrow-key navigation

test('workflow tabs: arrow keys move selection AND focus, with roving tabindex', () => {
  assert.match(APP_JS, /event\.key === 'ArrowRight'/);
  assert.match(APP_JS, /event\.key === 'ArrowLeft'/);
  assert.match(APP_JS, /event\.key === 'Home'/);
  assert.match(APP_JS, /event\.key === 'End'/);
  // Focus follows selection after every arrow move.
  const start = APP_JS.indexOf('function stepFromKey(');
  assert.ok(start > -1, 'stepFromKey must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /button\.focus\(\)/, 'the newly selected tab must receive focus');
  assert.match(body, /event\.preventDefault\(\)/, 'arrow keys must not scroll the page');
  // Roving tabindex is maintained on every selectStep() call.
  const sel = APP_JS.indexOf('function selectStep(');
  const selBody = APP_JS.slice(sel, APP_JS.indexOf('\n}', sel));
  assert.match(selBody, /tabIndex = active \? 0 : -1/);
});

test('stepFromKey executes correctly in isolation (simulated key events)', () => {
  // Run the shipped function against a minimal fake DOM, exactly as ui-regression.test.ts does for other pure helpers.
  const start = APP_JS.indexOf('function stepFromKey(');
  const end = APP_JS.indexOf('\n}', start) + 2;
  const calls: string[] = [];
  const buttons = new Map<string, { focus: () => void }>([
    ['capture', { focus: () => calls.push('capture') }],
    ['inspect', { focus: () => calls.push('inspect') }],
    ['evidence', { focus: () => calls.push('evidence') }],
    ['findings', { focus: () => calls.push('findings') }],
  ]);
  const context: Record<string, unknown> = {
    TAB_ORDER: ['capture', 'inspect', 'evidence', 'findings'],
    selectStep: (name: string) => calls.push('select:' + name),
    document: {
      querySelector: (sel: string) => {
        const m = /data-step="(\w+)"/.exec(sel);
        const key = m === null ? undefined : m[1];
        return (key === undefined ? undefined : buttons.get(key)) ?? null;
      },
    },
    calls,
  };
  const run = (from: string, key: string): { prevented: boolean } => {
    calls.length = 0;
    const state = { prevented: false };
    const fn = new vm.Script(
      APP_JS.slice(start, end) + `\nstepFromKey({ key: ${JSON.stringify(key)}, currentTarget: { dataset: { step: ${JSON.stringify(from)} } }, preventDefault() { state.prevented = true; } });`,
    );
    fn.runInNewContext({ ...context, state });
    return state;
  };

  // ArrowRight from capture selects and focuses inspect.
  const r = run('capture', 'ArrowRight');
  assert.ok(r.prevented, 'handled keys must prevent default');
  assert.deepEqual(calls, ['select:inspect', 'inspect'], 'selection changes and focus follows');
  // ArrowLeft from capture wraps to findings.
  run('capture', 'ArrowLeft');
  assert.deepEqual(calls, ['select:findings', 'findings'], 'ArrowLeft wraps backwards');
  // Home/End jump to the ends.
  run('evidence', 'Home');
  assert.deepEqual(calls, ['select:capture', 'capture']);
  run('capture', 'End');
  assert.deepEqual(calls, ['select:findings', 'findings']);
  // An unrelated key does nothing (Tab still works normally).
  const before = run('capture', 'Tab');
  assert.equal(before.prevented, false, 'Tab must not be swallowed');
  assert.equal(calls.length, 0, 'unrelated keys must not move selection');
});

// 2. Dialogs: accessible names, focus, Escape

test('every dialog is a native <dialog> with an accessible name', () => {
  // Native showModal() gives modal focus containment, Escape-to-close and focus restoration to the invoker without custom code.
  const dialogs = [...INDEX_HTML.matchAll(/<dialog[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(dialogs.length >= 4, 'expected project/reference/delete/reviewer dialogs');
  for (const id of ['proj-modal', 'preset-modal', 'del-modal', 'reviewer-modal']) {
    assert.ok(dialogs.includes(id), id + ' must be a native dialog');
    const tag = new RegExp(`<dialog[^>]*id="${id}"[^>]*aria-labelledby="[^"]+"`).exec(INDEX_HTML);
    assert.ok(tag, id + ' must be labelled by its heading');
  }
  assert.match(APP_JS, /modal\.showModal\(\)/, 'dialogs open via showModal (focus containment)');
  // The first field receives focus on open so typing starts immediately.
  assert.match(APP_JS, /\$\('proj-input-name'\)\.focus\(\)/);
  assert.match(APP_JS, /\$\('reviewer-input-name'\)\.focus\(\)/);
  assert.match(APP_JS, /\$\('preset-input-name'\)\.focus\(\)/);
  // Required fields are marked required and their inputs sit inside labels.
  assert.match(INDEX_HTML, /<input type="text" id="proj-input-name"[^>]*\brequired\b/);
  assert.match(INDEX_HTML, /<label class="field">[\s\S]{0,200}?id="proj-input-name"/);
});

test('Escape closes the project menu and returns focus to the project button', () => {
  assert.match(APP_JS, /if \(event\.key === 'Escape'\) setMenu\(false\)/,
    'Escape must close the open project menu');
  // The fix: closing must not strand focus inside the hidden menu.
  const start = APP_JS.indexOf('function setMenu(');
  assert.ok(start > -1);
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /menu\.contains\(document\.activeElement\)/,
    'focus inside the closing menu must be detected');
  assert.match(body, /\$\('proj-btn'\)\.focus\(\)/,
    'focus must return to the menu owner when the menu closes');
  // aria-expanded stays truthful.
  assert.match(body, /aria-expanded.*String\(open\)/);
});

test('the project selector and New Project are real, labelled controls', () => {
  assert.match(INDEX_HTML, /<button type="button" class="proj-btn" id="proj-btn"[^>]*aria-haspopup="dialog"/);
  assert.match(INDEX_HTML, /id="proj-btn"[\s\S]{0,200}?aria-expanded="false"/);
  assert.match(INDEX_HTML, /id="proj-btn"[\s\S]{0,200}?aria-controls="proj-menu"/);
  assert.match(INDEX_HTML, /id="proj-new"/, 'New Project must exist');
  // Menu items carry accessible names.
  assert.match(APP_JS, /setAttribute\('aria-label', 'Switch to project /);
});

// 3. Capture drop target and finding-card toggles

test('the capture drop target is focusable and operable with Enter and Space', () => {
  assert.match(INDEX_HTML, /<div class="drop" id="drop" tabindex="0" role="button"/);
  assert.match(INDEX_HTML, /id="drop"[^>]*aria-label="[^"]+"/);
  const start = APP_JS.indexOf("drop.addEventListener('keydown'");
  assert.ok(start > -1, 'the drop target must have a keydown handler');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(body, /\$\('file'\)\.click\(\)/, 'keyboard activation opens the file picker');
});

// 4. Announcements: persistence feedback reaches assistive technology

test('persistence success and failure are announced in a polite live region', () => {
  // #notice sits outside every tab panel, so a message raised on one step is heard from any step, and it is a polite status region.
  assert.match(INDEX_HTML, /id="notice"[^>]*role="status"[^>]*aria-live="polite"/);
  const start = APP_JS.indexOf('function notify(');
  assert.ok(start > -1);
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /\$\('notice'\)/, 'notify writes to the live region');
  // Every finding-state outcome (success, in-flight, failure) goes through notify, so a failed write is never silent to a.
  const update = APP_JS.indexOf('async function updateFindingState(');
  const updateBody = APP_JS.slice(update, APP_JS.indexOf('function renderStage()', update));
  const notifyCount = (updateBody.match(/notify\(/g) || []).length;
  assert.ok(notifyCount >= 3, 'success, scope-refusal and failure must all announce, got ' + notifyCount);
  assert.match(updateBody, /notify\(confirmMsg, 'good'\)/, 'a confirmed write announces success');
  assert.match(updateBody, /notify\(errMsg, 'bad'\)/, 'a failed write announces the error');
  // Errors are routed through the live region AND the in-card feedback, so the card never claims the rejected transition happened.
  assert.match(updateBody, /existing\.state = lastConfirmedState/, 'the optimistic state rolls back');
});

test('inspection completion and provider failures are announced too', () => {
  // runInspection ends in notify() for done / partial / provider-failure paths.
  const start = APP_JS.indexOf('async function runInspection(');
  assert.ok(start > -1);
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.ok((body.match(/notify\(/g) || []).length >= 3,
    'completion, partial failure and hard failure must each announce');
  // Async status also mirrors into #status, itself a live region.
  assert.match(INDEX_HTML, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
});

// 5. State is never carried by colour alone

test('verification, finding and comparison states always carry text, not just colour', () => {
  // statusTag renders the localized status string, not an empty coloured chip.
  const tagStart = APP_JS.indexOf('function statusTag(');
  const tagBody = APP_JS.slice(tagStart, APP_JS.indexOf('\n}', tagStart));
  assert.match(tagBody, /t\('status\.' \+ status\)/, 'the tag contains the status word');
  // Finding lifecycle cards print their state as text, not only as colour.
  assert.match(APP_JS, /card\.dataset\.findingState = ledgerItem\.state/);
  assert.match(APP_JS, /t\('ledger\.state\.' \+ ledgerItem\.state\)/,
    'the state word is rendered as localized text');
  // Evidence states render a text chip as well as a data attribute for colour.
  assert.match(APP_JS, /t\('evidenceState\.' \+ finding\.evidenceState\)/);
  // Comparison rows carry a visible text status tag (localized or raw status).
  assert.match(APP_JS, /localizedRow\.statusLabel/);
  assert.match(APP_JS, /row\.status\.replace\(\/_\/g, ' '\)/);
});

test('a visible keyboard focus indicator exists globally and for key controls', () => {
  assert.match(APP_CSS, /:focus-visible \{ outline: 2px solid var\(--red\)/,
    'a global focus ring must exist');
  assert.match(APP_CSS, /\.drop:hover, \.drop:focus-visible/);
  assert.match(APP_CSS, /\.field input:focus-visible/);
  assert.match(APP_CSS, /\.lang-sel select:focus-visible/);
});

// 6. RTL and localized controls

test('the app keeps dir in step with the selected language (AR is RTL)', () => {
  // Full RTL behavior lives in rtl-direction.test.ts.
  assert.match(APP_JS, /setAttribute\('dir', dir\)/);
  assert.match(APP_JS, /option === undefined \? 'ltr' : option\.dir/,
    'direction comes from the language option, defaulting to ltr');
  assert.match(APP_JS, /node\.setAttribute\('dir', option\.dir\)/,
    'each language option announces its own direction');
});

test('review-transition controls are native buttons reachable by Tab', () => {
  // Native <button> elements are focusable and activate on Enter/Space with no custom code; a div-with-onclick would not be.
  const start = APP_JS.indexOf('const transitions = ledgerItem.state');
  assert.ok(start > -1, 'the transition list must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /el\('button', btnClass, btnLabel\)/, 'transitions are real buttons');
  assert.match(body, /btn\.type = 'button'/);
  assert.match(body, /btn\.disabled = inFlight/, 'in-flight state disables duplicate activation');
  // The label is localized text, so the control is named for AT.
  assert.match(body, /btnLabel = transition\[1\]/);
});

test('finding-card headers are keyboard-operable disclosure buttons', () => {
  assert.match(APP_JS, /head\.setAttribute\('role', 'button'\)/);
  assert.match(APP_JS, /head\.setAttribute\('tabindex', '0'\)/);
  assert.match(APP_JS, /head\.setAttribute\('aria-expanded', String\(open\)\)/);
  const toggleStart = APP_JS.indexOf('const toggle = () => {');
  assert.ok(toggleStart > -1, 'toggle handler must exist');
  const toggleBody = APP_JS.slice(toggleStart, APP_JS.indexOf('head.addEventListener(\'click\', toggle)', toggleStart));
  assert.match(toggleBody, /if \(state\.activeId === finding\.id\) state\.activeId = null/, 'collapsing an active card clears activeId so it closes');
  assert.match(toggleBody, /nextHead\.focus\(\)/, 'toggling restores focus to the re-rendered card header');
  const start = APP_JS.indexOf("head.addEventListener('keydown'");
  assert.ok(start > -1, 'the card header must respond to keys');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(body, /event\.preventDefault\(\)/, 'Space must not scroll the page');
  assert.match(body, /toggle\(\)/, 'the same toggle runs for keys and clicks');
});
