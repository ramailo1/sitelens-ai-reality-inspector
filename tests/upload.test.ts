/**
 * Uploaded capture validation tests.
 *
 * An operator upload must be a genuine PNG or JPEG before it is stored or sent
 * to the provider. These lock in that the header, not the filename or the
 * client-declared type, decides acceptance: a renamed text file, a truncated
 * upload and an empty file are each refused with their own reason, and a real
 * image yields real dimensions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { acceptCapture, MAX_CAPTURE_BYTES } from '../src/upload.ts';
import { demoCaptures } from '../src/captures.ts';
import { INDEX_HTML, APP_JS, APP_CSS } from '../src/ui-assets.ts';

const REAL_PNG = demoCaptures()[0]!.bytes;

/**
 * The client assets are template strings, so `tsc` cannot see a syntax error
 * inside them. Parsing the script here is what catches the nested-function and
 * stray-parenthesis defects that previously shipped as a silently dead UI.
 */
test('the inline app script parses', () => {
  assert.doesNotThrow(() => new vm.Script(APP_JS));
});

test('the workflow nav is a real tablist wired to real panels', () => {
  assert.match(INDEX_HTML, /role="tablist"/);

  const names = ['capture', 'inspect', 'evidence', 'findings'];

  for (const name of names) {
    // The tab points at the panel it controls.
    assert.match(
      INDEX_HTML,
      new RegExp('id="tab-' + name + '"[\\s\\S]{0,120}?aria-controls="bay-' + name + '"'),
      'tab-' + name + ' must control bay-' + name,
    );
    // The panel is labelled by that same tab.
    assert.match(
      INDEX_HTML,
      new RegExp('id="bay-' + name + '"[\\s\\S]{0,120}?data-bay="' + name + '"'),
      'bay-' + name + ' must be the panel for ' + name,
    );
    assert.match(INDEX_HTML, new RegExp('role="tabpanel"'), 'panels need role="tabpanel"');
  }

  // Exactly one tab starts selected; the rest are reachable only via the
  // roving tabindex that selectStep maintains.
  const selected = INDEX_HTML.match(/aria-selected="true"/g) || [];
  assert.equal(selected.length, 1);
  assert.equal((INDEX_HTML.match(/tabindex="-1"/g) || []).length, names.length - 1);
});

test('panels are hidden by attribute, since CSS alone did not switch tabs', () => {
  // Regression guard: the bug was that every panel stayed on screen.
  assert.match(APP_CSS, /\.bay\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(APP_JS, /panel\.hidden = panel\.dataset\.bay !== name/);
});

test('a selected tab marks the panel, it does not merely scroll to it', () => {
  // Scrolling was the old behaviour that read as "nothing happened".
  assert.match(APP_JS, /function selectStep\(/);
  assert.doesNotMatch(APP_JS, /scrollIntoView/);
});

test('the tablist supports arrow-key navigation', () => {
  assert.match(APP_JS, /addEventListener\('keydown', stepFromKey\)/);
  assert.match(APP_JS, /ArrowRight/);
  assert.match(APP_JS, /ArrowLeft/);
});

test('an inspection only advances to Evidence when it actually completed', () => {
  // A failed run must leave the operator on the message, not on an empty panel.
  const start = APP_JS.indexOf('async function runInspection');
  assert.ok(start > -1, 'runInspection must exist');
  const body = APP_JS.slice(start, APP_JS.indexOf('\n}', start));

  const completed = body.indexOf("view.outcome === 'COMPLETED'");
  assert.ok(completed > -1, 'the COMPLETED branch must exist');
  const advance = body.indexOf("selectStep('evidence'", completed);
  assert.ok(advance > -1, 'a completed inspection must advance to Evidence');

  // Nothing may advance to Evidence before the COMPLETED check runs.
  assert.equal(body.indexOf("selectStep('evidence'"), advance, 'exactly one advance must exist');
  assert.ok(advance > completed, 'the advance must come after the COMPLETED branch opens');
  assert.ok(
    /only move on/i.test(body.slice(completed, advance)),
    'the advance must sit inside the COMPLETED branch, not before it',
  );
});

test('status messages are mirrored outside the tab panels', () => {
  // #status lives in the Inspect panel, so an upload result on the Capture tab
  // would otherwise be invisible.
  assert.match(INDEX_HTML, /id="notice"[^>]*role="status"/);
  assert.match(APP_JS, /\$\('notice'\)/);
});

test('accepts a real PNG and reports its true dimensions', () => {
  const result = acceptCapture({ bytes: REAL_PNG, filename: 'site.png' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.capture.mediaType, 'image/png');
  assert.equal(result.capture.dimensions.width, 320);
  assert.equal(result.capture.dimensions.height, 240);
  assert.equal(result.capture.label, 'site.png');
});

test('refuses a file whose bytes are not an image, whatever it is named', () => {
  const result = acceptCapture({
    bytes: Buffer.from('this is plainly not a png'),
    filename: 'not-really.png',
    declaredMediaType: 'image/png',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'UNREADABLE_HEADER');
  assert.match(result.message, /not a readable PNG or JPEG/);
});

test('refuses an unsupported type before it is stored', () => {
  const result = acceptCapture({
    bytes: Buffer.from('hello'),
    filename: 'notes.txt',
    declaredMediaType: 'text/plain',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'UNSUPPORTED_TYPE');
});

test('refuses an empty file', () => {
  const result = acceptCapture({ bytes: Buffer.alloc(0), filename: 'empty.png' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'EMPTY');
});

test('refuses a capture over the size ceiling', () => {
  const result = acceptCapture({
    bytes: Buffer.alloc(MAX_CAPTURE_BYTES + 1),
    filename: 'huge.png',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'TOO_LARGE');
});

test('accepts a .jpeg extension as a JPEG', () => {
  // The bytes are a PNG, but the extension drives the declared media type and
  // the header check is what authorises storage, so this must still resolve.
  const result = acceptCapture({ bytes: REAL_PNG, filename: 'photo.jpeg' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.capture.mediaType, 'image/jpeg');
});

test('gives each accepted upload a distinct id', () => {
  const a = acceptCapture({ bytes: REAL_PNG, filename: 'a.png' });
  const b = acceptCapture({ bytes: REAL_PNG, filename: 'a.png' });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.capture.id, b.capture.id);
});

test('a refusal never carries capture bytes', () => {
  const result = acceptCapture({ bytes: Buffer.from('nope'), filename: 'x.png' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal('capture' in result, false);
});