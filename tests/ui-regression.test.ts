/**
 * Regression guards for a bug found by looking at the rendered page.
 *
 * The UI showed a broken evidence image and an untouched caption while the rail
 * painted real numbers, then blamed "Could not reach the inspector". The cause
 * was `detailRow()` returning null for an honest empty value and the caller
 * passing that null to `appendChild`, which throws. The throw aborted every
 * LATER render step, so `renderStage()` never ran and the image never got a src
 * while earlier steps stayed painted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { INDEX_HTML, APP_JS, APP_CSS } from '../src/ui-assets.ts';

/* ------------------------------------------------------------------ *
 * Multi-image UI.
 *
 * The original defect was a multi-file picker that silently read files[0], so
 * an operator who chose three photographs got one inspection and no indication
 * that two had been dropped. These assert the picker is multi, the whole list is
 * uploaded, and the result states how many photographs it rests on.
 * ------------------------------------------------------------------ */

test('the picker accepts several photographs at once', () => {
  assert.match(INDEX_HTML, /<input type="file" id="file"[^>]*\bmultiple\b/,
    'the file input must be multiple, or extra photographs cannot be chosen at all');
});

test('a multi-file pick uploads the WHOLE list, not just the first entry', () => {
  // The exact defect: reading files[0] and calling it a multi-file upload.
  assert.doesNotMatch(APP_JS, /uploadFile\(event\.target\.files\[0\]\)/,
    'the change handler must not pass only files[0]');
  assert.match(APP_JS, /uploadFiles\(picked\)/,
    'the change handler must forward the whole FileList');
  assert.match(APP_JS, /uploadFiles\(event\.dataTransfer\.files\)/,
    'drag and drop must forward the whole drop, not just the first file');
});

test('the inspection runs over the open GROUP, not a single capture', () => {
  assert.match(APP_JS, /post\('\/api\/run', \{ captureIds: photos/,
    'a run must target every open photograph, otherwise only the first is analysed');
  // A run with nothing open must refuse rather than inspecting a stale capture.
  assert.match(APP_JS, /Open at least one photo/,
    'the UI must refuse to run with no photographs open');
});

test('the page states how many photographs an inspection rests on', () => {
  assert.match(INDEX_HTML, /id="imgs-list"/, 'the photograph strip must exist');
  assert.match(INDEX_HTML, /id="basis-list"/, 'the evidence basis list must exist');
  assert.match(APP_JS, /function renderBasis\(/, 'the basis list must be rendered');
  assert.match(APP_JS, /function renderImages\(/, 'the photograph strip must be rendered');
});

test('a failed photograph stays visible as failed, never dropped from the strip', () => {
  assert.match(APP_JS, /status === 'FAILED' \? 'imgs\.status\.failed'/,
    'a failed photograph must be labelled FAILED rather than omitted');
  assert.match(APP_CSS, /\.img-item-failed\s*\{[^}]*border-color/,
    'a failed photograph must be visually distinct');
});

test('a partial run is announced as partial, before any pleasant summary', () => {
  // The notification order matters: a partial inspection must not read as a pass.
  const start = APP_JS.indexOf('const failedImages =');
  assert.ok(start > -1, 'the partial-failure branch must exist');
  // Slice to the end of the completion branch, so the ordering assertion can see
  // both the partial notice and the summary it must precede.
  const end = APP_JS.indexOf('selectStep(', start);
  const branch = APP_JS.slice(start, end);
  assert.match(branch, /run\.partialLamp/, 'a partial run must light the partial lamp');
  assert.ok(
    branch.indexOf('t(\'run.partial\')') < branch.indexOf('t(\'run.withReasoning\')'),
    'partial failure must be reported BEFORE the pleasant reasoning summary, or a 2-of-3 run reads as a pass',
  );
  assert.match(branch, /failedImages\.length > 0 \? 'bad' : 'good'/,
    'a partial run must be toned bad even when reasoning succeeded');
});

test('every observation names the photograph it came from', () => {
  assert.match(APP_JS, /t\('obs\.from'\)/, 'each observation must render its source photograph');
  assert.match(APP_CSS, /\.obs-photo\s*\{/, 'the source photograph must be styled, not unstyled');
});

test('detail rows are never appended unguarded', () => {
  // appendChild(null) throws a TypeError, which previously aborted the render
  // chain before the image was ever given a src.
  assert.doesNotMatch(APP_JS, /appendChild\(detailRow\(/);
  assert.match(APP_JS, /function appendDetail\(/);
});

test('every render step is isolated so one fault cannot blank the page', () => {
  assert.match(APP_JS, /function safeRender\(/);
  // renderAll must route every step through the guard, including renderStage,
  // which is the one that sets the evidence image src.
  const start = APP_JS.indexOf('function renderAll()');
  assert.ok(start > -1, 'renderAll must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));
  assert.match(body, /safeRender\('stage', renderStage\)/);
  assert.match(body, /safeRender\('overlay', renderOverlay\)/);
  assert.doesNotMatch(body, /^\s*renderStage\(\);/m, 'renderStage must not be called bare');
});

test('a boot failure is not reported as a network failure', () => {
  // Both used to be lumped together, which pointed debugging at the network when
  // the fault was actually in the render code.
  assert.match(APP_JS, /function reportBootFailure\(/);
  assert.doesNotMatch(APP_JS, /setLamp\('problem', 'Could not reach the inspector'\)/);
});

test('a boot failure is surfaced above the stage, not only inside a hidden bay', () => {
  // #status lives in the Inspect bay and is invisible from Capture or Evidence.
  assert.match(APP_JS, /notify\(what, 'bad'\)/);
  assert.match(INDEX_HTML, /id="notice"[^>]*role="status"/);
});

test('the notice strip is outside every tab panel so it is always visible', () => {
  const noticeAt = INDEX_HTML.indexOf('id="notice"');
  const firstBay = INDEX_HTML.indexOf('data-bay=');
  assert.ok(noticeAt > -1 && firstBay > -1);
  assert.ok(noticeAt < firstBay, '#notice must precede the tab panels');
});

test('the evidence caption has a real initial state rather than a stale one', () => {
  // "No capture loaded." was left visible forever because renderStage never ran.
  assert.match(INDEX_HTML, /id="stage-cap"/);
  assert.ok(APP_JS.includes("$('stage-cap').textContent"));
});

test('the client still parses after the fix', () => {
  assert.doesNotThrow(() => new vm.Script(APP_JS));
});

test('the evidence image is driven by a real capture id, never a placeholder', () => {
  // A multi-photo inspection rests on several captures at once, so the frame on
  // screen is whichever of the open group is selected. The guard is that the id
  // is always a REAL member of that group, and never a literal standing in for
  // one.
  assert.match(APP_JS, /\/api\/capture-image\/' \+ encodeURIComponent\(shown\)/);
  assert.match(APP_JS, /state\.captureIds\.includes\(state\.evidenceCaptureId\)/);
  assert.match(APP_JS, /evidenceCaptureId !== null/);
  assert.doesNotMatch(APP_JS, /evidence-image'\)\.src = ['"]#/);
});

test('a broken evidence image is reported instead of silently ignored', () => {
  assert.match(APP_JS, /evidence-image'\)\.addEventListener\('load'/);
  assert.match(APP_JS, /evidence-image'\)\.addEventListener\('error'/);
});

test('the stage keeps a minimum height so a failed image cannot collapse the layout', () => {
  assert.match(APP_CSS, /\.sheet-lg img\s*\{[^}]*min-height/);
});

test('evidence boxes are scaled against the PAINTED photograph, not the element box', () => {
  // The stage letterboxes the capture with object-fit: contain, so
  // clientWidth/naturalWidth is the width of the ELEMENT, not of the photo. On a
  // 320x240 fixture in a 1332x620 stage that made the horizontal scale 1.6x too
  // large and every box landed partly outside the image it pointed at.
  assert.match(APP_CSS, /\.sheet-lg img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(APP_JS, /function paintedArea\(/);
  assert.match(APP_JS, /Math\.min\(elementWidth \/ naturalWidth, elementHeight \/ naturalHeight\)/);
  assert.match(APP_JS, /area\.offsetX \+ box\.left \* area\.scaleX/);
  assert.doesNotMatch(
    APP_JS,
    /image\.clientWidth \/ image\.naturalWidth/,
    'the overlay must not scale against the element width',
  );
});
test('orientation-3/4 captures are display-flipped and their boxes flip with them', () => {
  // The stored bytes are orientation-normalized (tag rewritten to 1, pixels
  // untouched). Measured against the real dataset: the orientation-6 images
  // carry pixels that are ALREADY upright, so no display rotation applies to
  // them, while 004 and 027 (orientation 3) really are stored upside down and
  // need a display-only 180-degree correction.
  const context: {
    result_displayNeedsFlip: boolean[] | null;
    result_flipBox180: { left: number; top: number; width: number; height: number } | null;
  } = { result_displayNeedsFlip: null, result_flipBox180: null };
  const start = APP_JS.indexOf('function displayNeedsFlip(');
  const end = APP_JS.indexOf('/**', start);
  assert.ok(start > -1, 'displayNeedsFlip must exist');
  const flipStart = APP_JS.indexOf('function flipBox180(');
  const flipEnd = APP_JS.indexOf('\n}', flipStart) + 2;
  assert.ok(flipStart > -1, 'flipBox180 must exist');
  new vm.Script(
    APP_JS.slice(start, end) + '\n' + APP_JS.slice(flipStart, flipEnd)
    + '\nresult_displayNeedsFlip = [displayNeedsFlip(1), displayNeedsFlip(3), displayNeedsFlip(4), displayNeedsFlip(6), displayNeedsFlip(8)];'
    + '\nresult_flipBox180 = flipBox180({ left: 100, top: 50, width: 200, height: 50 }, 800, 600);',
  ).runInNewContext(context);
  assert.ok(Array.isArray(context.result_displayNeedsFlip), 'displayNeedsFlip results must return');
  assert.ok(context.result_flipBox180 !== null, 'flipBox180 must return a box');
  assert.deepEqual([...context.result_displayNeedsFlip], [false, true, true, false, false]);
  // Point reflection: a box at top-left of an 800x600 frame lands at the
  // mirrored position with unchanged size, so it stays glued to the same
  // physical region of the scene the viewer now sees.
  assert.deepEqual({ ...context.result_flipBox180 }, { left: 500, top: 500, width: 200, height: 50 });

  // The display path must actually wire the flip in: the stage image gets the
  // class, and the overlay maps boxes through the same flip when it is set.
  assert.match(APP_JS, /classList\.toggle\('img-flip180', /);
  assert.match(APP_JS, /flipBox180\(box, frameWidth, frameHeight\)/);
  assert.match(APP_CSS, /\.img-flip180\s*\{[^}]*rotate\(180deg\)/);
});

/* ------------------------------------------------------------------ *
 * The evidence stage of a multi-photo inspection.
 *
 * An inspection can rest on several photographs at once, but one frame is on
 * screen. These assert the frame is selectable and that boxes belong to the
 * frame they are drawn on: a box read from another photograph would be a
 * rectangle invented out of nothing where it lands.
 * ------------------------------------------------------------------ */

test('every photograph of a multi-photo inspection is reachable on the evidence stage', () => {
  assert.match(INDEX_HTML, /id="photo-switcher"/, 'the photo switcher must exist');
  assert.match(INDEX_HTML, /id="photo-switcher-tabs"/, 'the tab host must exist');
  assert.match(APP_JS, /function renderPhotoSwitcher\(/, 'the switcher must be rendered');
  assert.match(APP_JS, /function renderPhotoSwitcher[\s\S]*?switcher\.hidden = false/,
    'the switcher must be shown when several photographs are open');
  assert.match(APP_JS, /state\.captureIds\.length <= 1/,
    'a single-photo inspection needs no switcher');
});

test('switching photograph re-renders the stage and the overlay together', () => {
  // The image without the boxes would be a silent change of evidence.
  assert.match(APP_JS, /safeRender\('stage', renderStage\);\s*\n\s*safeRender\('overlay', renderOverlay\);/,
    'a photo tab click must re-render both the stage and the overlay');
});

test('evidence boxes are filtered to the photograph on screen', () => {
  assert.match(APP_JS, /state\.captureIds\.length <= 1\s*\n\s*\|\| finding\.captureId === undefined\s*\n\s*\|\| finding\.captureId === state\.evidenceCaptureId/,
    'boxes of another photograph must never be drawn onto this one');
});

test('the reviewer gate states the real reason and routes to the setup dialog', () => {
  assert.match(INDEX_HTML, /id="reviewer-gate"/, 'the gate banner must exist');
  assert.match(INDEX_HTML, /id="reviewer-gate-reason"/, 'the gate must carry a reason');
  assert.match(APP_JS, /function renderReviewerGate\(/, 'the gate must be rendered');
  assert.match(APP_JS, /\$\('reviewer-gate-btn'\)/, 'the gate button must be resolved');
  assert.match(APP_JS, /gateBtn\.addEventListener\('click', \(\) => openReviewerModal\(\)\)/,
    'the gate must be the route to the one action that resolves it');
  // The banner reads the gate the SERVER enforces, out of the workspace payload.
  // It used to decide for itself from the project, which meant it could assert a
  // closed gate while the API happily accepted the work.
  assert.match(APP_JS, /state\.reviewerGate/, 'the banner must read the server verdict');
  assert.match(APP_JS, /payload\.reviewerGate/, 'the server verdict must reach the client');
  assert.match(APP_JS, /server\.required === true/);
  // A blank name must not open the gate. The client's own fallback is
  // fail-closed: it closes on anything that is not a non-empty string.
  assert.match(APP_JS, /typeof reviewer\.name !== 'string'/);
  assert.match(APP_JS, /reviewer\.name\.trim\(\)\.length === 0/,
    'a blank name must not open the gate');
});

test('a refused run opens the reviewer setup instead of blaming the provider', () => {
  // The server's refusal is a setup gate, not a provider failure. Reading it as
  // "AI provider request failed" would send the operator to a credential problem
  // they do not have.
  assert.match(APP_JS, /err\.code = typeof body\.error === 'string' \? body\.error : ''/,
    'the machine-readable error code must survive to the caller');
  assert.match(APP_JS, /error\.code === 'REVIEWER_REQUIRED'/,
    'the run path must recognise the gate refusal');
  assert.match(APP_JS, /payload\.error === 'REVIEWER_REQUIRED'/,
    'the upload path must recognise the gate refusal');
});

test('the primary action is ink, so red stays reserved for destruction', () => {
  // Inspect reality is the one primary action of the instrument; rendering it in
  // the same red outline as Delete project made it read as a warning.
  assert.match(INDEX_HTML, /<button[^>]*class="btn btn-primary"[^>]*id="run"/);
  assert.match(APP_CSS, /\.btn-primary\s*\{[^}]*background:\s*var\(--ink\)/);
});

test('hidden bands cannot survive a class rule that sets display', () => {
  // Several bands are flex or grid by class and toggled with the hidden
  // attribute, which a later class rule of equal specificity would override.
  assert.match(APP_CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("the project's captures can be selected as a group", () => {
  assert.match(INDEX_HTML, /id="select-all-captures"/, 'select-all must exist');
  assert.match(INDEX_HTML, /id="clear-capture-selection"/, 'clear must exist');
  assert.match(APP_JS, /async function selectAllCaptures\(/);
  assert.match(APP_JS, /async function clearCaptureSelection\(/);
  // Both go through the same server contract the per-photo controls use.
  assert.match(APP_JS, /post\('\/api\/captures\/select', \{ captureIds: ids \}\)/);
  assert.match(APP_JS, /post\('\/api\/captures\/select', \{ captureIds: \[first\.id\] \}\)/);
});

test('the identity fonts are actually delivered rather than assumed installed', () => {
  assert.match(INDEX_HTML, /fonts\.googleapis\.com[\s\S]*?IBM\+Plex\+Sans/,
    'the named sans font must be delivered, not only declared in the CSS stack');
  // The fallback stays declared in the stylesheet, so an offline machine still
  // resolves to a real family.
  assert.match(APP_CSS, /--sans:\s*"IBM Plex Sans", "Segoe UI"/);
});

/* ------------------------------------------------------------------ *
 * The masthead.
 *
 * The identity strip has to stay the same width whether one photograph is open
 * or twelve. Listing the filenames put forty characters per photograph into a
 * band that cannot grow, which pushed the reviewer and the project selector off
 * the strip; the count is the fact that band has to carry.
 * ------------------------------------------------------------------ */

test('the masthead carries a count, never the file names', () => {
  assert.match(APP_JS, /function renderCaptureSummary\(/, 'the capture summary must be rendered');
  assert.doesNotMatch(
    APP_JS,
    /setText\('meta-capture', p\.captureLabel\)/,
    'the header must not inline a capture label, which names one file at full length',
  );
  // The group label still exists for the reasoning prompt, where naming every
  // photograph is a correctness invariant. That separation must survive.
  assert.match(APP_JS, /qualificationPath/);
});

test('the capture ceiling comes from the server, not a number baked into the client', () => {
  assert.match(APP_JS, /payload\.maxInspectionImages/,
    'the client must read the ceiling from the server that enforces it');
  assert.doesNotMatch(
    APP_JS,
    /maxInspectionImages\s*[:=]\s*12\b/,
    'the ceiling must not be a literal in the client, or the two can disagree',
  );
  assert.match(APP_JS, /imgs\.countAtCap/, 'reaching the ceiling must be stated, not implied');
});

test('the masthead labels follow the language', () => {
  for (const [attr, key] of [
    ['meta.zone', 'data-i18n="meta.zone"'],
    ['meta.capture', 'data-i18n="meta.capture"'],
    ['meta.reviewer', 'data-i18n="meta.reviewer"'],
    ['tab.capture', 'data-i18n="tab.capture"'],
    ['tab.inspect', 'data-i18n="tab.inspect"'],
    ['tab.evidence', 'data-i18n="tab.evidence"'],
    ['tab.findings', 'data-i18n="tab.findings"'],
    ['proj.label', 'data-i18n="proj.label"'],
  ] as const) {
    assert.ok(INDEX_HTML.includes(key), 'the masthead key ' + attr + ' must be in the markup');
  }
});

test('the photo names are available without widening the masthead', () => {
  assert.match(INDEX_HTML, /id="capture-disclosure"/, 'the count must open onto the names');
  assert.match(INDEX_HTML, /id="meta-capture-list"/, 'the names must have somewhere to render');
  // Absolutely positioned, so the strip above cannot be pushed wider.
  assert.match(APP_CSS, /\.rig-disclose-list\s*\{[^}]*position:\s*absolute/);
  assert.match(APP_CSS, /\.rig-disclose-list\s*\{[^}]*overflow-y:\s*auto/);
});

test('the NVIDIA requirement card states the verdict, the stages and the path', () => {
  assert.match(INDEX_HTML, /id="qual-subtitle"/, 'the pipeline shape must be stated');
  // The verdict is the badge alone; the platform and the qualifying stage are
  // rows. A verdict that carried them in one sentence could not be scanned.
  assert.match(APP_JS, /qual\.met/);
  assert.match(APP_JS, /qual\.hybrid/);
  assert.match(APP_JS, /qual\.row\.vision/);
  assert.match(APP_JS, /qual\.row\.reasoning/);
  assert.match(APP_JS, /qual\.row\.platform/);
  // Only an explicit ELIGIBLE may read as the qualifying tone.
  assert.match(APP_JS, /row\.cls === 'ELIGIBLE' \? 'ok'/);
  assert.match(APP_CSS, /\.qual-tag-ok\b/);
  assert.match(APP_CSS, /\.qual-tag-no\b/);
  assert.match(APP_CSS, /\.qual-tag-unknown\b/);
});
