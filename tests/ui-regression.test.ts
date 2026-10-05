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
  assert.match(APP_JS, /\/api\/capture-image\/' \+ encodeURIComponent\(p\.captureId\)/);
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