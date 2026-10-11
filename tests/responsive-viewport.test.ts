// Responsive viewport and source-hygiene guards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP_CSS } from '../src/ui-assets.ts';

test('no viewport width is rescued by masking overflow horizontally', () => {
  // Hiding scrollbars would hide the defect, not fix it.
  assert.doesNotMatch(APP_CSS, /overflow-x:\s*hidden/);
  assert.doesNotMatch(APP_CSS, /overflow:\s*hidden[^;]*;\s*}\s*html/);
});

test('the header shrinks rather than overflows at every tested width', () => {
  // Header children must be allowed to shrink and ellipsize long names.
  assert.match(APP_CSS, /\.rig-id \{[^}]*min-width: 0/);
  assert.match(APP_CSS, /\.proj \{[^}]*min-width: 0/);
  assert.match(APP_CSS, /\.proj-btn \{[^}]*min-width: 0[^}]*flex: 0 1 auto/s);
  assert.match(APP_CSS, /\.proj-name \{[^}]*text-overflow: ellipsis[^}]*min-width: 0/s);
  assert.match(APP_CSS, /\.rig-state-t \{[^}]*text-overflow: ellipsis/s);
  assert.match(APP_CSS, /\.ident-v \{[^}]*overflow-wrap: anywhere/s);
});

test('at <=400px (covers 320/360/390px) the project controls stack and stay reachable', () => {
  const narrow = APP_CSS.indexOf('@media (max-width: 400px)');
  assert.ok(narrow > -1, 'the narrow-viewport block must exist');
  const block = APP_CSS.slice(narrow, APP_CSS.indexOf('\n}', narrow) + 2);
  assert.match(block, /\.proj \{[^}]*flex-wrap: wrap/, 'the project group wraps');
  assert.match(block, /\.proj-btn \{[^}]*flex: 1 1 100%/, 'the selector takes a full row');
  assert.match(block, /#proj-new \{[^}]*flex: 1 1 auto/, 'New Project wraps to its own row');
  // Padding at 320px leaves >=300px of usable row: 320 - 2*10.
  assert.match(block, /\.rig \{[^}]*padding: 0 10px/);
});

test('grid children collapse to one column in the phone block that owns 320-430px', () => {
  const phone = APP_CSS.indexOf('@media (max-width: 820px)');
  assert.ok(phone > -1, 'the phone block must exist');
  const block = APP_CSS.slice(phone, APP_CSS.indexOf('@media (max-width: 400px)'));
  // Every multi-column row becomes minmax(0, 1fr) so no child can exceed 100% of its row at 320px.
  assert.match(block, /\.fc-row \{[^}]*minmax\(0, 1fr\)/);
  assert.match(block, /\.cmp-pair \{[^}]*minmax\(0, 1fr\)/);
  assert.match(block, /\.exp-row \{[^}]*minmax\(0, 1fr\)/);
  assert.match(block, /\.proj \{[^}]*min-width: 0/);
  assert.match(block, /\.review-bar \{[^}]*minmax\(0, 1fr\)/);
});

test('narrow media queries appear after the base rules they override in cascade order', () => {
  const media820 = APP_CSS.indexOf('@media (max-width: 820px)');
  const media400 = APP_CSS.indexOf('@media (max-width: 400px)');
  assert.ok(media820 > -1 && media400 > media820);
  for (const baseSelector of ['.review-bar {', '.fc-row {', '.cmp-pair {', '.exp-row {', '.proj-btn {', '.proj-menu {', '.reason-grid .fc-row {']) {
    const basePos = APP_CSS.indexOf(baseSelector);
    assert.ok(basePos > -1 && basePos < media820, `${baseSelector} must appear before @media (max-width: 820px) so the media query wins cascade order`);
  }
});

test('tabs and panels remain operable at narrow widths', () => {
  assert.match(APP_CSS, /\.rig-nav \{[^}]*flex-wrap: wrap/);
  const narrow = APP_CSS.indexOf('@media (max-width: 400px)');
  assert.ok(narrow > -1);
  const broad = APP_CSS.indexOf('@media (max-width: 900px)');
  assert.ok(broad > -1 && broad < narrow, 'narrow rules build on the phone block');
});

test('source, demo, and test files enforce the strict single-line comment policy', () => {
  const root = resolve(import.meta.dirname, '..');
  const collect = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collect(full));
      else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  const files = [...collect(join(root, 'src')), ...collect(join(root, 'demo')), ...collect(join(root, 'tests'))];
  assert.ok(files.length >= 70, 'expected all source, demo, and test files in scope');
  const openToken = '/' + '*';
  const closeToken = '*' + '/';
  const htmlOpen = '<' + '!--';
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(content.includes(openToken), false, `${file} must not contain block comment opener`);
    assert.equal(content.includes(closeToken), false, `${file} must not contain block comment closer`);
    assert.equal(content.includes(htmlOpen), false, `${file} must not contain HTML comments`);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      const consecutive = /^\s*\/\//.test(lines[i]!) && /^\s*\/\//.test(lines[i + 1]!);
      assert.equal(consecutive, false, `${file}:${i + 1} must not have consecutive single-line comments`);
    }
  }
});
