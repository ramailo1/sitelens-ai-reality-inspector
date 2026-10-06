/**
 * The inspector client.
 *
 * Deliberately plain ES5-compatible DOM code: no framework, no bundler, no
 * dependencies. The rules it follows matter more than the code it is:
 *
 *   - an evidence box is only drawn from REAL model geometry (pixelBox)
 *   - a finding is never rendered as settled until a human has settled it
 *   - the synthetic/offline path is labelled on screen, never implied to be AI
 *   - nothing advances past an inspection that did not actually complete
 */

export const APP_JS = `'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  view: null,
  captures: [],
  expected: null,
  projects: [],
  project: null,
  presets: [],
  reference: null,
  storage: null,
  pipeline: null,
  dataset: null,
  datasetEntries: [],
  presetDraft: [],
  currentCaptureId: null,
  activeId: null,
  openIds: new Set(),
  running: false,
  importing: null,
  pendingDelete: null
};

const TAB_ORDER = ['capture', 'inspect', 'evidence', 'findings'];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value === null || value === undefined ? '-' : String(value);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({ error: 'malformed response' }));
  if (!res.ok) {
    const err = new Error(body.message || body.error || 'request failed');
    err.status = res.status;
    throw err;
  }
  return body;
}

function post(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function patch(path, payload) {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function del(path) {
  return api(path, { method: 'DELETE' });
}

/**
 * Apply an authoritative workspace payload.
 *
 * Every mutation answers with the project, the project's captures and the active
 * view together, so applying one replaces the whole client state rather than
 * merging into it. That is what stops a deleted project or a capture from
 * another project surviving on screen.
 */
function applyWorkspace(payload) {
  if (payload === null || payload === undefined) return;
  state.project = payload.project;
  state.projects = payload.projects || [];
  state.presets = payload.presets || [];
  state.reference = payload.reference || null;
  state.storage = payload.storage || null;
  state.pipeline = payload.pipeline || null;
  // The dataset summary arrives with every workspace payload. The full index is
  // fetched once separately because it lists 38 entries.
  if (payload.dataset !== undefined && payload.dataset !== null) {
    state.dataset = payload.dataset;
  }
  state.captures = payload.captures || [];
  state.currentCaptureId = payload.activeCaptureId || null;
  state.view = payload.view || null;
  state.activeId = null;
  state.openIds.clear();
}

/** Human label for a capture source. Three cases, never collapsed into two. */
function sourceLabel(source) {
  if (source === 'LOCAL_DATASET') return 'LOCAL DATASET';
  if (source === 'UPLOAD') return 'UPLOAD';
  return 'DEMO FIXTURE';
}

function sourceTitle(source) {
  if (source === 'LOCAL_DATASET') {
    return 'A genuine photograph from the local validation dataset, held on this machine only. '
      + 'It is not tracked by git, and it was not captured on the site of this project.';
  }
  if (source === 'UPLOAD') return 'A photograph supplied by the operator.';
  return 'A synthetic scene generated in code. Not a photograph, and not evidence of accuracy.';
}

/** Status text is mirrored outside the tab panels, so a message raised on one
 *  step is still readable from another. */
function notify(text, tone) {
  const node = $('notice');
  if (!node) return;
  node.textContent = text || '';
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function setStatus(text, tone) {
  const node = $('status');
  if (!node) return;
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function setLamp(kind, label) {
  $('lamp').dataset.lamp = kind;
  $('state-label').textContent = label;
}

function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function band(confidence) {
  if (confidence < 0.5) return 'LOW';
  if (confidence < 0.8) return 'MEDIUM';
  return 'HIGH';
}

/** Show one workflow step and hide the rest. */
function selectStep(name, options) {
  const quiet = options && options.quiet === true;

  document.querySelectorAll('.step').forEach((button) => {
    const active = button.dataset.step === name;
    button.setAttribute('aria-selected', String(active));
    // Roving tabindex: only the selected tab is in the tab order.
    button.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll('[data-bay]').forEach((panel) => {
    panel.hidden = panel.dataset.bay !== name;
  });

  // The overlay is positioned from rendered image dimensions, so it must be
  // recomputed once the panel is actually visible.
  renderOverlay();

  if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Arrow-key navigation, the expected behaviour for a tablist. */
function stepFromKey(event) {
  const current = TAB_ORDER.indexOf(event.currentTarget.dataset.step);
  if (current === -1) return;

  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % TAB_ORDER.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = TAB_ORDER.length - 1;
  else return;

  event.preventDefault();
  selectStep(TAB_ORDER[next]);
  const button = document.querySelector('.step[data-step="' + TAB_ORDER[next] + '"]');
  if (button) button.focus();
}

const ELEMENT_KINDS = [
  'COLUMN', 'SLAB', 'WALL', 'OPENING', 'MEP_ROUGH_IN', 'FORMWORK',
  'SCAFFOLD', 'EQUIPMENT', 'WORKER', 'REBAR', 'FINISH', 'EXCAVATION'
];

function pretty(kind) {
  return kind.toLowerCase().replace(/_/g, ' ');
}

/** The active reference, the catalogue and where the bytes actually live. */
function renderReference() {
  const select = $('expected-preset');
  const reference = state.reference;
  if (select) {
    clear(select);
    state.presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name + (preset.source === 'SYSTEM' ? '' : ' (custom)');
      if (reference && preset.id === reference.presetId) option.selected = true;
      select.appendChild(option);
    });
  }

  const active = $('expected-active');
  if (active) {
    if (!reference) {
      active.textContent = 'No reference selected.';
    } else {
      active.textContent =
        reference.name + ' — ' + reference.zone + ' — ' + reference.itemCount +
        ' expected element' + (reference.itemCount === 1 ? '' : 's') +
        (reference.edited ? ' (edited)' : '');
    }
  }

  $('expected-delete').disabled = reference === null || !reference.deletable;
  $('expected-rename').disabled = reference === null;
  $('expected-new').disabled = reference === null;
}

function renderStorage() {
  const node = $('storage-note');
  if (!node) return;
  if (!state.storage) {
    node.textContent = 'Storage: unknown.';
    return;
  }
  node.textContent = 'Storage: ' + state.storage.location + '. ' + state.storage.detail;
}

/**
 * The local validation dataset browser.
 *
 * Two jobs. First, let a judge put a GENUINE construction photograph into the
 * pipeline in one click instead of hunting for a file. Second, and more
 * important, keep the provenance unmistakable: the note above the grid and the
 * badge on every tile say LOCAL DATASET, because a photograph from a Wikimedia
 * archive sitting next to a synthetic fixture must never be mistakable for
 * either a project capture or a generated scene.
 *
 * Images the model endpoint demonstrably cannot accept are shown as unavailable
 * with the reason, rather than failing after the operator has chosen one.
 */
function renderDataset() {
  const grid = $('dataset-grid');
  if (!grid) return;
  clear(grid);

  const summary = state.dataset;
  const note = $('dataset-note');
  const empty = $('dataset-empty');

  if (summary === null || summary === undefined) {
    note.textContent = 'Checking for a local dataset…';
    $('dataset-count').textContent = '-';
    empty.hidden = false;
    empty.textContent = '';
    return;
  }

  $('dataset-count').textContent = summary.present
    ? summary.count + ' IMAGES'
    : 'NOT PRESENT';
  note.textContent = summary.note;

  if (!summary.present) {
    empty.hidden = false;
    empty.textContent = 'The application works without it: drop a photograph above instead.';
    return;
  }
  empty.hidden = true;
  empty.textContent = '';

  if (summary.unreadable > 0) {
    const warn = el('p', 'dataset-warn',
      summary.unreadable + ' file(s) in this folder could not be read and are skipped.');
    grid.appendChild(warn);
  }

  state.datasetEntries.forEach((entry) => {
    const tile = el('button', 'tile');
    tile.type = 'button';
    tile.dataset.id = entry.id;
    tile.dataset.hero = entry.hero ? 'true' : 'false';
    tile.disabled = !entry.inspectable || state.importing === entry.id;
    tile.title = entry.inspectable
      ? 'Import ' + entry.filename + ' as a real capture of this project'
      : entry.filename + ' is larger than the model endpoint accepts, so it cannot be inspected';

    const top = el('span', 'tile-top');
    top.appendChild(el('span', 'tile-id', entry.id));
    if (entry.hero) top.appendChild(el('span', 'tile-hero', 'HERO'));
    if (!entry.inspectable) top.appendChild(el('span', 'tile-big', 'TOO LARGE'));
    tile.appendChild(top);

    tile.appendChild(el('span', 'tile-title', entry.title));
    tile.appendChild(el('span', 'tile-meta', entry.width + '×' + entry.height + ' · ' + bytes(entry.byteLength)));
    if (entry.geometryNormalized) {
      tile.appendChild(el('span', 'tile-rot', 'EXIF ' + entry.exifOrientation + ' normalized'));
    }

    tile.addEventListener('click', () => importDatasetImage(entry.id));
    grid.appendChild(tile);
  });
}

/** Fetch the dataset index once; the workspace payload only carries a summary. */
async function loadDataset() {
  try {
    const index = await api('/api/dataset');
    state.dataset = index;
    state.datasetEntries = index.entries || [];
    renderDataset();
  } catch (error) {
    const node = $('dataset-note');
    if (node) node.textContent = 'The local dataset could not be listed: ' + error.message;
  }
}

async function importDatasetImage(id) {
  if (state.importing !== null) return;
  if (state.project === null) {
    notify('Create a project before importing a dataset image.', 'bad');
    return;
  }
  state.importing = id;
  renderDataset();
  setLamp('working', 'Importing dataset image ' + id);
  notify('Importing dataset image ' + id + '…');
  const errorNode = $('dataset-error');
  errorNode.hidden = true;

  try {
    applyWorkspace(await post('/api/dataset/import', { id: id }));
    renderWorkspace();
    setLamp('ready', 'Real capture loaded — inspect when ready');
    setStatus(
      'Dataset image ' + id + ' is now a capture of ' + (state.project ? state.project.name : 'this project')
      + '. It is a genuine photograph, labelled LOCAL DATASET. Inspect it when ready.',
      null
    );
    notify('Dataset image ' + id + ' imported. This is real construction imagery, not a fixture.', 'good');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    setLamp('problem', 'Dataset image could not be imported');
    notify(error.message, 'bad');
  } finally {
    state.importing = null;
    renderDataset();
  }
}

function renderExpected() {
  renderReference();
  const host = $('expected-list');
  clear(host);
  const expected = state.expected;
  if (expected === null) return;

  setText('expected-source', expected.source);

  expected.items.forEach((item, index) => {
    const row = el('li', 'exp-row');
    row.dataset.index = String(index);

    const kind = document.createElement('select');
    for (const value of ELEMENT_KINDS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = pretty(value);
      if (value === item.element) option.selected = true;
      kind.appendChild(option);
    }
    kind.setAttribute('aria-label', 'Element kind for expectation ' + (index + 1));
    row.appendChild(kind);

    const mode = document.createElement('select');
    for (const value of ['PRESENT', 'COUNT', 'ABSENT']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'ABSENT' ? 'should be absent' : 'should be ' + value.toLowerCase();
      if (value === item.expectation) option.selected = true;
      mode.appendChild(option);
    }
    mode.setAttribute('aria-label', 'Expectation for ' + item.element);
    row.appendChild(mode);

    const count = document.createElement('input');
    count.type = 'number';
    count.min = '0';
    count.max = '500';
    count.className = 'exp-count';
    count.value = item.expectedCount === null ? '' : String(item.expectedCount);
    // The count box is only meaningful for a COUNT expectation; disabling it
    // stops the UI implying a number where none applies.
    count.disabled = item.expectation !== 'COUNT';
    count.setAttribute('aria-label', 'Expected count for ' + item.element);
    row.appendChild(count);

    mode.addEventListener('change', () => {
      count.disabled = mode.value !== 'COUNT';
    });

    if (item.note) row.appendChild(el('span', 'exp-note', item.note));
    host.appendChild(row);
  });
}

/** Read the editor back into an expected-state payload for the server. */
function collectExpected() {
  const expected = state.expected;
  if (expected === null) return null;
  const rows = Array.prototype.slice.call($('expected-list').children);
  const items = rows.map((row, index) => {
    const selects = row.querySelectorAll('select');
    const countInput = row.querySelector('.exp-count');
    const mode = selects[1].value;
    return {
      id: expected.items[index].id,
      element: selects[0].value,
      expectation: mode,
      expectedCount: mode === 'COUNT' ? Number(countInput.value) : null,
      note: expected.items[index].note
    };
  });
  return { zone: expected.zone, items: items };
}

/**
 * Where the photograph is ACTUALLY painted inside its element.
 *
 * The stage letterboxes every capture (object-fit: contain), so the painted
 * photo is normally narrower AND shorter than the element that holds it. Scaling
 * evidence boxes by clientWidth/naturalWidth therefore used the ELEMENT width
 * rather than the painted one: on a 320x240 fixture in a 1332x620 stage the
 * horizontal scale came out 1.6x too large, and every box landed partly outside
 * the photograph it was supposed to point at. A box pointing at nothing is worse
 * than no box, so the overlay is scaled and offset against the painted rectangle.
 *
 * Returns null while the image has no intrinsic size yet, so the caller draws
 * nothing rather than guessing.
 */
function paintedArea(image) {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const elementWidth = image.clientWidth;
  const elementHeight = image.clientHeight;
  if (naturalWidth === 0 || naturalHeight === 0) return null;
  if (elementWidth === 0 || elementHeight === 0) return null;

  const fit = window.getComputedStyle(image).objectFit;
  // 'fill' stretches across the whole element, so the element IS the painted area.
  if (fit === 'fill' || fit === undefined || fit === '') {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  }

  // 'contain', 'scale-down' and 'cover' all scale by the same factor and centre
  // the result; only the visible extent differs, which the overlay's clipping
  // already handles.
  const scale = Math.min(elementWidth / naturalWidth, elementHeight / naturalHeight);
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (elementWidth - naturalWidth * scale) / 2,
    offsetY: (elementHeight - naturalHeight * scale) / 2,
  };
}

/**
 * Point-reflect a pixel box through the frame: the exact mapping a 180-degree
 * display rotation demands. Extracted so the axis mapping is executable and
 * testable rather than folklore — the same reason transformBox exists upstream.
 */
function flipBox180(box, frameWidth, frameHeight) {
  return {
    left: frameWidth - box.left - box.width,
    top: frameHeight - box.top - box.height,
    width: box.width,
    height: box.height,
  };
}

/**
 * Draw evidence boxes over the reality image.
 *
 * A box is only ever drawn when the server sent REAL pixel geometry for that
 * item. Nothing is positioned by guesswork: an un-localised item is reported as
 * un-localised in its card rather than being given an invented rectangle.
 */
function renderOverlay() {
  const overlay = $('overlay');
  if (!overlay) return;
  clear(overlay);

  const view = state.view;
  const image = $('evidence-image');
  if (view === null || image === null) return;
  const area = paintedArea(image);
  if (area === null) return;

  const findings = view.inspectionFindings || [];

  // A display flipped 180 degrees must carry its boxes with it. Boxes arrive in
  // the normalized (stored-pixel) space the model read; the flip is a display
  // rotation of that same space, so the mapping is an exact point reflection,
  // not a guess. Without this, a flipped capture would show every box mirrored.
  const flipped = image.classList.contains('img-flip180');
  const frameWidth = image.naturalWidth;
  const frameHeight = image.naturalHeight;

  findings.forEach((finding, index) => {
    if (finding.pixelBox === null || finding.pixelBox === undefined) return;

    let box = finding.pixelBox;
    if (flipped && frameWidth > 0 && frameHeight > 0) {
      box = flipBox180(box, frameWidth, frameHeight);
    }
    const node = el('div', 'ev');
    node.style.left = (area.offsetX + box.left * area.scaleX) + 'px';
    node.style.top = (area.offsetY + box.top * area.scaleY) + 'px';
    node.style.width = (box.width * area.scaleX) + 'px';
    node.style.height = (box.height * area.scaleY) + 'px';
    node.dataset.origin = finding.origin;
    node.dataset.findingId = finding.id;
    node.dataset.status = finding.verificationStatus;
    if (state.activeId === finding.id) node.dataset.active = 'true';

    node.appendChild(el('span', 'ev-n', String(index + 1)));
    node.title = finding.title;
    node.addEventListener('click', () => openFinding(finding.id));
    overlay.appendChild(node);
  });
}

/** Show one finding: open its card and light up its region on the image. */
function openFinding(id) {
  state.activeId = id;
  if (!state.openIds.has(id)) state.openIds.add(id);
  renderFindings();
  renderOverlay();
}

function renderHeader() {
  const view = state.view;
  if (view === null) return;
  const p = view.provenance;

  // The masthead names the project the operator can recognise. The session's
  // own projectId is an internal identifier and is shown in Provenance, where it
  // belongs - writing it here replaced the name with "proj_1a2b3c4d".
  setText('meta-project', state.project ? state.project.name : '-');
  setText('meta-zone', view.expected ? view.expected.zone : '-');
  setText('meta-capture', p.captureLabel);
  if (state.pipeline === null || state.pipeline === undefined) {
    setText('hdr-model', p.model);
    setText('hdr-reasoner', '-');
  }
  // The pipeline payload names the models but not the provider, so the provider
  // still comes from the session's own provenance. Set here unconditionally:
  // leaving it to a conditional left the field blank whenever a pipeline was
  // present, which read as "unknown origin" on every load.
  setText('hdr-provenance', p.provider);

  // The offline fixture is labelled loudly and permanently. A deterministic
  // fixture must never be mistaken for a model having looked at the image.
  const origin = view.inferenceOrigin;
  $('hdr-synth').hidden = origin !== 'DEMO_FIXTURE';
  // A cached answer is a real AI result but NOT a fresh one, so it carries its
  // own badge and the time of the inference behind it.
  $('hdr-cache').hidden = origin !== 'CACHED';
  if (origin === 'CACHED') {
    $('hdr-cache').textContent = 'CACHED AI RESULT - inference from '
      + (view.originalInferenceAt ?? 'an earlier run').replace('T', ' ').slice(0, 19);
  }
  if (origin === 'FRESH' && view.provenance.inferenceExecuted) {
    setText('hdr-provenance', view.provenance.provider + ' - live inference');
  }
}

function renderRail() {
  const view = state.view;
  if (view === null) return;
  const c = view.counters;

  setText('rail-elements', c.totalCounted > 0 ? c.totalCounted : c.elementsDetected);
  setText('rail-attention', c.attentionAreas + c.incompleteAreas);
  setText('rail-findings', view.inspectionFindings.length);
  setText('rail-findings-n', c.pending + ' awaiting review, ' + c.verified + ' verified');

  // Confidence is shown as a percentage only when one exists; "no confidence"
  // is a legitimate reading and is not rounded to zero.
  setText('rail-confidence', c.highestConfidence === null ? 'n/a' : Math.round(c.highestConfidence * 100) + '%');
  setText('rail-overall', view.brief.overall.replace(/_/g, ' '));
  $('rail-verdict').dataset.overall = view.brief.overall;
}

function renderBrief() {
  const view = state.view;
  const host = $('brief');
  clear(host);
  if (view === null) return;

  for (const line of view.brief.lines) {
    if (line.trim().length === 0) continue;
    const node = el('p', 'brief-line', line);
    if (line.indexOf('Overall inspection') === 0) node.dataset.lead = 'true';
    host.appendChild(node);
  }
  if (view.brief.highestPriority !== null) {
    host.appendChild(el('p', 'brief-line', 'Highest priority: ' + view.brief.highestPriority));
  }
  setText('brief-verdict', view.brief.overall.replace(/_/g, ' '));
}

function renderPriorities() {
  const view = state.view;
  const host = $('priorities');
  clear(host);
  if (view === null) return;

  if (view.priorities.length === 0) {
    host.appendChild(el('p', 'empty', 'No open attention areas. Either nothing was flagged, or everything has been settled.'));
    return;
  }

  view.priorities.forEach((priority) => {
    const item = el('li', 'prio');
    item.dataset.attention = priority.attention;
    item.appendChild(el('span', 'prio-n', String(priority.rank).padStart(2, '0')));
    const body = el('div');
    body.appendChild(el('p', 'prio-t', priority.title));
    body.appendChild(el('p', 'prio-b', priority.basis));
    item.appendChild(body);
    item.addEventListener('click', () => openFinding(priority.findingId));
    host.appendChild(item);
  });
}

/** REALITY vs EXPECTED, one row per expected item. */
function renderComparison() {
  const view = state.view;
  const host = $('comparison');
  if (!host) return;
  clear(host);
  if (view === null) return;

  if (view.comparison.length === 0) {
    host.appendChild(el('p', 'empty', 'No expected state loaded, so nothing can be compared.'));
    return;
  }

  view.comparison.forEach((row) => {
    const item = el('div', 'cmp');
    item.dataset.status = row.status;

    const head = el('div', 'cmp-head');
    head.appendChild(el('span', 'cmp-el', pretty(row.element)));
    head.appendChild(el('span', 'tag cmp-tag', row.status.replace(/_/g, ' ')));
    item.appendChild(head);

    const grid = el('dl', 'cmp-grid');
    const pair = (label, value) => {
      const row_ = el('div', 'cmp-pair');
      row_.appendChild(el('dt', null, label));
      row_.appendChild(el('dd', null, value));
      grid.appendChild(row_);
    };
    pair('EXPECTED', row.expectedText);
    pair('OBSERVED', row.observedText);
    if (row.difference) pair('DIFFERENCE', row.difference);
    if (row.countBasis === 'VISUAL_COUNT' && row.observedCount !== null) {
      pair('COUNT BASIS', 'Visual count from one photograph. Not a measured quantity.');
    }
    item.appendChild(grid);
    host.appendChild(item);
  });
}

function statusTag(status) {
  const cls =
    status === 'VERIFIED' ? 'tag tag-verify'
      : status === 'REJECTED' ? 'tag tag-reject'
        : status === 'NEEDS_REVIEW' ? 'tag tag-review'
          : 'tag';
  return el('span', cls, status.replace(/_/g, ' '));
}

/**
 * STAGE 2: Nemotron's construction reasoning.
 *
 * Rendered as its own panel with its own provenance, never folded into the
 * comparison table, because a judge must be able to see what the second model
 * actually contributed. Three states are visually distinct and none of them is
 * allowed to read as "nothing to report":
 *
 *   not run yet        neutral
 *   unavailable        amber, with the reason
 *   available          the reasoning itself, plus its certainty
 *
 * The reasoning certainty is deliberately NOT shown as a percentage bar. It is
 * a qualitative reading of evidence, and a bar would invite exactly the
 * confidence-equals-truth mistake this product exists to prevent.
 */
function renderReasoning() {
  const host = $('reason-grid');
  if (!host) return;
  clear(host);
  const view = state.view;
  const stage = $('reason');

  if (view === null) {
    stage.dataset.status = 'UNAVAILABLE';
    $('reason-stage').textContent = 'NOT RUN';
    $('reason-model').textContent = '-';
    $('reason-lede').textContent =
      'Run the inspection to have Nemotron reason about what the evidence does and does not establish.';
    $('reason-fail').hidden = true;
    $('reason-foot').hidden = true;
    return;
  }

  const r = view.reasoning;
  if (r === undefined || r === null) return;

  if (r.status === 'AVAILABLE') {
    const reasoning = r.reasoning;
    stage.dataset.status = 'AVAILABLE';
    $('reason-stage').textContent = 'STAGE 2 · NEMOTRON';
    $('reason-model').textContent = r.model;
    $('reason-lede').textContent = reasoning.summary;

    const rows = [
      ['WHAT IT MEANS', reasoning.whatMatters],
      ['WHY IT MATTERS', reasoning.rationale],
      ['RECOMMENDATION', reasoning.recommendation],
      ['VERIFICATION', reasoning.verification],
    ];
    for (const [label, value] of rows) appendDetail(host, label, label, value);

    const certainty = el('div', 'reason-certainty');
    certainty.appendChild(el('span', 'reason-certainty-k', 'CERTAINTY'));
    const chip = el('span', 'chip');
    chip.dataset.certainty = reasoning.certainty;
    chip.textContent = reasoning.certainty.replace(/_/g, ' ');
    certainty.appendChild(chip);
    if (reasoning.confidence !== null && reasoning.confidence !== undefined) {
      certainty.appendChild(el('span', 'reason-certainty-n',
        'model-stated ' + reasoning.confidence.toFixed(2) + ' — not a measurement, not a verification'));
    } else {
      certainty.appendChild(el('span', 'reason-certainty-n', 'no confidence stated'));
    }
    host.appendChild(certainty);

    $('reason-fail').hidden = true;

    // Provenance foot: what was actually read, and whether it merely paraphrased.
    const p = r.provenance;
    const foot = $('reason-foot');
    foot.hidden = false;
    foot.textContent =
      'Reasoned over ' + p.detectionsConsidered + ' detected element(s) and ' + p.rowsConsidered
      + ' comparison row(s) in ' + p.latencyMs + ' ms'
      + (p.degenerate
        ? '. WARNING: this answer closely restates the visual observation and adds little reasoning.'
        : '. The reasoning above is additional to the visual observation, not a restatement of it.');
    return;
  }

  // Unavailable. Say why, and say that the stages below are unaffected.
  stage.dataset.status = 'UNAVAILABLE';
  $('reason-stage').textContent = r.failureKind === null ? 'NOT RUN' : 'UNAVAILABLE';
  $('reason-model').textContent = r.model === 'none' ? '-' : r.model;
  $('reason-lede').textContent = r.message === null
    ? 'Construction reasoning has not been produced for this capture.'
    : r.message;

  const fail = $('reason-fail');
  fail.hidden = false;
  clear(fail);
  fail.appendChild(el('p', 'reason-fail-h', 'CONSTRUCTION REASONING UNAVAILABLE'));
  if (r.failureKind !== null) {
    fail.appendChild(el('p', 'reason-fail-kind', r.failureKind.replace(/_/g, ' ')));
  }
  if (r.validationIssues.length > 0) {
    const list = el('ul');
    for (const issue of r.validationIssues.slice(0, 6)) {
      list.appendChild(el('li', null, issue.field + ': ' + issue.message));
    }
    fail.appendChild(list);
  }
  fail.appendChild(el('p', 'reason-fail-foot',
    'Nothing has been invented in its place. The comparison above is computed in code and stands on its own.'));

  $('reason-foot').hidden = true;
}

/**
 * The pipeline strip: which model did what, on this run.
 *
 * Four steps, because the product thesis has four verbs. Each step reports its
 * OWN state, so "Nemotron did not run" can never be read as "there was nothing
 * to reason about", and "nothing is verified" is always stated outright.
 */
function renderPipeline() {
  const view = state.view;
  const set = (id, text) => setText(id, text);

  if (state.pipeline !== null && state.pipeline !== undefined) {
    set('pipe-vision-model', state.pipeline.vision ? state.pipeline.vision.model : '-');
    set('pipe-reason-model', state.pipeline.reasoning ? state.pipeline.reasoning.model : '-');
    $('hdr-model').textContent = state.pipeline.vision ? state.pipeline.vision.model : '-';
    $('hdr-reasoner').textContent = state.pipeline.reasoning ? state.pipeline.reasoning.model : '-';
  }

  const step1 = $('pipe-1');
  const step2 = $('pipe-2');
  const step3 = $('pipe-3');
  const step4 = $('pipe-4');

  if (view === null) {
    step1.dataset.state = 'idle';
    step2.dataset.state = 'idle';
    step3.dataset.state = 'idle';
    step4.dataset.state = 'idle';
    set('pipe-vision-note', 'not run yet');
    set('pipe-compare-note', 'no expected state loaded');
    set('pipe-reason-note', 'not run yet');
    set('pipe-verify-note', 'nothing verified');
    return;
  }

  const p = view.provenance;
  const r = view.reasoning;

  // 01 SEE
  step1.dataset.state = view.outcome === 'FAILED' ? 'fail' : 'done';
  set('pipe-vision-model', p.model);
  set('pipe-vision-note',
    view.outcome === 'FAILED'
      ? 'did not complete — ' + (view.failure !== null ? view.failure.kind.toLowerCase().replace(/_/g, ' ') : 'failed')
      : view.isDemoFixture
        ? 'synthetic fixture, not AI inference'
        : view.inferenceOrigin === 'CACHED'
          ? 'restored result, not a fresh call'
          : view.detections.length + ' element(s), ' + view.observations.length + ' observation(s) in ' + p.latencyMs + ' ms');

  // 02 COMPARE — ours, in code. Never attributed to a model.
  const matched = view.comparison.filter((r2) => r2.status === 'MATCH').length;
  const attention = view.comparison.filter((r2) => r2.status === 'ATTENTION').length;
  const undetermined = view.comparison.filter((r2) => r2.status === 'UNDETERMINED').length;
  step2.dataset.state = view.comparison.length > 0 ? 'done' : 'idle';
  set('pipe-compare-model', 'SiteLens deterministic engine (src/compare.ts)');
  set('pipe-compare-note', view.comparison.length === 0
    ? 'no expected state loaded'
    : matched + ' match · ' + attention + ' attention · ' + undetermined + ' undetermined');

  // 03 UNDERSTAND
  if (r === undefined || r === null) {
    step3.dataset.state = 'idle';
    set('pipe-reason-note', 'not run yet');
  } else if (r.status === 'AVAILABLE') {
    step3.dataset.state = 'done';
    set('pipe-reason-model', r.model);
    set('pipe-reason-note',
      r.reasoning.certainty.replace(/_/g, ' ').toLowerCase()
      + (r.provenance && r.provenance.degenerate ? ' — adds little to the visual reading' : ''));
  } else {
    step3.dataset.state = 'fail';
    set('pipe-reason-model', r.model === 'none' ? '-' : r.model);
    set('pipe-reason-note', r.failureKind === null ? 'not run yet' : r.failureKind.replace(/_/g, ' ').toLowerCase());
  }

  // 04 VERIFY
  const counters = view.counters;
  step4.dataset.state = counters.verified > 0 ? 'done' : (counters.pending > 0 ? 'wait' : 'idle');
  set('pipe-verify-note',
    counters.verified === 0 && counters.rejected === 0
      ? 'nothing verified — ' + counters.pending + ' awaiting a named human'
      : counters.verified + ' verified · ' + counters.rejected + ' rejected');
}

/**
 * A definition row inside the finding detail.
 *
 * Returns null when there is no honest value to show. That is deliberate: an
 * empty "WHERE" is meaningful, because it means the model did not localise the
 * item and we refuse to guess. Callers MUST therefore append through
 * appendDetail(), never appendChild directly - appendChild(null) throws and
 * silently aborts the rest of the render.
 */
function detailRow(key, label, value) {
  if (value === null || value === undefined || value === '') return null;
  const row = el('div', 'fc-row');
  row.dataset.k = key;
  row.appendChild(el('dt', null, label));
  row.appendChild(el('dd', null, value));
  return row;
}

/** Append a detail row only when there is one. Never throws. */
function appendDetail(parent, key, label, value) {
  const row = detailRow(key, label, value);
  if (row !== null) parent.appendChild(row);
  return row;
}

/**
 * Render the finding cards: WHAT / WHERE / WHY / EVIDENCE / CONFIDENCE /
 * RECOMMENDED ACTION / VERIFICATION.
 *
 * Rows with no honest value are omitted rather than filled with a placeholder,
 * because an empty "WHERE" is meaningful: it means the model did not localise
 * the item and we refuse to guess.
 */
function renderFindings() {
  const view = state.view;
  const host = $('findings-cards');
  clear(host);
  if (view === null) return;

  const list = view.inspectionFindings;
  if (list.length === 0) {
    host.appendChild(el('p', 'empty', 'No findings. Run an inspection, or nothing in this capture differs from the reference.'));
    return;
  }

  list.forEach((finding, index) => {
    const open = state.openIds.has(finding.id) || state.activeId === finding.id;
    const card = el('article', 'finding-card');
    card.dataset.findingId = finding.id;
    card.dataset.open = String(open);
    card.dataset.status = finding.verificationStatus;
    if (state.activeId === finding.id) card.dataset.active = 'true';

    const head = el('div', 'fc-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.appendChild(el('span', 'fc-id', String(index + 1).padStart(2, '0')));
    head.appendChild(el('span', 'fc-title', finding.title));

    const tail = el('div', 'fc-tail');
    tail.appendChild(el('span', 'tag tag-ai', finding.origin === 'COMPARISON' ? 'COMPARISON' : 'VISUAL'));
    if (finding.severity !== 'INFO') tail.appendChild(el('span', 'tag tag-attention', finding.severity));
    tail.appendChild(statusTag(finding.verificationStatus));
    head.appendChild(tail);

    const toggle = () => {
      if (state.openIds.has(finding.id)) state.openIds.delete(finding.id);
      else state.openIds.add(finding.id);
      state.activeId = finding.id;
      renderFindings();
      renderOverlay();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    card.appendChild(head);

    const body = el('div', 'fc-body');
    appendDetail(body, 'what', 'WHAT', finding.observation);
    appendDetail(body, 'where', 'WHERE', finding.location !== null
      ? finding.location + (finding.element !== null ? ' (' + pretty(finding.element) + ')' : '')
      : null);
    appendDetail(body, 'why', 'WHY FLAGGED', finding.reason);
    appendDetail(body, 'expected', 'EXPECTED', finding.expected);
    appendDetail(body, 'difference', 'DIFFERENCE', finding.difference);

    // Confidence is labelled as model confidence in the visual reading, never
    // as a measurement confidence.
    const confidenceRow = el('div', 'fc-row');
    confidenceRow.dataset.k = 'confidence';
    confidenceRow.appendChild(el('dt', null, 'CONFIDENCE'));
    const cd = el('dd');
    const track = el('span', 'conf-track');
    const fill = el('i', 'conf-fill');
    fill.style.width = Math.round(finding.confidence * 100) + '%';
    fill.dataset.band = band(finding.confidence);
    track.appendChild(fill);
    cd.appendChild(track);
    cd.appendChild(document.createTextNode(
      Math.round(finding.confidence * 100) + '% - model confidence in its visual reading only'
    ));
    confidenceRow.appendChild(cd);
    body.appendChild(confidenceRow);

    appendDetail(body, 'action', 'RECOMMENDED ACTION', finding.recommendation);
    appendDetail(body, 'evidence', 'EVIDENCE', finding.evidence);

    // Evidence states exactly what the image supports, and no more. A finding
    // the model saw but did not localise is FULL-FRAME evidence: real image,
    // real reading, no rectangle — and it is never given an invented one. A
    // finding with no visual reading at all says so rather than borrowing the
    // image's authority.
    if (finding.evidenceState === 'FULL_FRAME') {
      const note = el('p', 'fc-noev');
      note.dataset.state = 'FULL_FRAME';
      note.appendChild(el('b', null, 'VISUAL EVIDENCE '));
      note.appendChild(document.createTextNode(
        'Full-frame evidence — no localized region returned by the vision model. '
        + 'The finding is supported by the inspected image itself; the evidence is '
        + 'the description above, not a highlighted area.'));
      body.appendChild(note);
    } else if (finding.evidenceState === 'NONE') {
      const note = el('p', 'fc-noev');
      note.dataset.state = 'NONE';
      note.appendChild(el('b', null, 'NO VISUAL EVIDENCE '));
      note.appendChild(document.createTextNode(
        'No usable visual evidence for this finding in this capture. It rests on '
        + 'the expected-state comparison, not on a visual reading of the image.'));
      body.appendChild(note);
    }

    body.appendChild(buildVerification(finding));
    card.appendChild(body);
    host.appendChild(card);
  });
}

/**
 * The human-in-the-loop control.
 *
 * Until a named person acts, this shows CONFIRM / REJECT / NEEDS REVIEW over an
 * UNVERIFIED finding. Afterwards it shows the recorded decision and who made
 * it, which is the audit trail the product promises.
 */
function buildVerification(finding) {
  if (finding.verificationStatus !== 'UNVERIFIED') {
    const settled = el('div', 'fc-settled');
    settled.dataset.status = finding.verificationStatus;
    settled.appendChild(el('span', null,
      'HUMAN VERIFIED -> ' + finding.verificationStatus.replace(/_/g, ' ')));
    if (finding.review) {
      settled.appendChild(el('span', null,
        'by ' + finding.review.reviewer + ' at ' + finding.review.reviewedAt.replace('T', ' ').slice(0, 19)));
      if (finding.review.note) settled.appendChild(el('span', null, '"' + finding.review.note + '"'));
    }
    return settled;
  }

  const acts = el('div', 'fc-acts');
  acts.appendChild(el('span', 'fc-acts-lbl', 'AI FINDING - CONFIDENCE ' + Math.round(finding.confidence * 100) + '%'));

  const decisions = [
    ['VERIFIED', 'CONFIRM', 'btn btn-verify'],
    ['REJECTED', 'REJECT', 'btn btn-reject'],
    ['NEEDS_REVIEW', 'NEEDS REVIEW', 'btn']
  ];
  for (const decision of decisions) {
    const button = el('button', decision[2], decision[1]);
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      submitReview(finding.id, decision[0]);
    });
    acts.appendChild(button);
  }
  return acts;
}

async function submitReview(findingId, decision) {
  const reviewer = $('reviewer').value.trim();
  if (reviewer.length === 0) {
    notify('Enter a reviewer name first. An anonymous verification is refused.', 'bad');
    $('reviewer').focus();
    return;
  }
  try {
    state.view = await post('/api/review-finding', {
      findingId: findingId,
      decision: decision,
      reviewer: reviewer,
      note: $('note').value.trim() || null
    });
    const label = decision === 'VERIFIED' ? 'confirmed' : decision === 'REJECTED' ? 'rejected' : 'deferred for review';
    notify('Finding ' + label + ' by ' + reviewer + '.', decision === 'REJECTED' ? 'bad' : 'good');
    setLamp('done', 'Human review recorded');
    renderAll();
  } catch (error) {
    notify(error.message, 'bad');
  }
}

/** Provenance and eligibility: which engine actually ran, always. */
function renderProvenance() {
  const view = state.view;
  const host = $('provenance');
  const failHost = $('failures');
  clear(host);
  clear(failHost);
  if (view === null) return;

  const p = view.provenance;
  const rows = [
    ['Provider', p.provider],
    ['Model', p.model],
    ['Inference executed', p.inferenceExecuted ? 'yes' : 'no'],
    ['Elements detected', view.detections.length],
    ['Observations accepted', p.observationsAccepted],
    ['Observations rejected', p.observationsRejected],
    ['Latency', p.latencyMs + ' ms'],
    ['Captured at', p.inspectedAt.replace('T', ' ').slice(0, 19)],
    ['Human review performed', p.humanReviewPerformed ? 'yes' : 'no']
  ];
  for (const row of rows) {
    const cell = el('div');
    cell.appendChild(el('dt', null, row[0]));
    cell.appendChild(el('dd', null, row[1]));
    host.appendChild(cell);
  }

  $('eligibility').textContent = 'Vision-stage eligibility: ' + p.eligibility + '. ' + p.eligibilityNote;

  // Pipeline eligibility: per stage, because two models run and only one of them
  // is NVIDIA. Collapsing that into a single verdict would either overstate the
  // vision stage or understate the reasoning stage.
  const pipeline = $('pipeline-eligibility');
  if (pipeline !== null && view.pipelineEligibility !== undefined) {
    const e = view.pipelineEligibility;
    const requirement = e.nvidiaRequirement === 'MET'
      ? 'MET — NVIDIA open-source inference ran on Nebius Token Factory'
      : e.nvidiaRequirement === 'PARTIAL'
        ? 'PARTIAL — an NVIDIA id was in use but no verified NVIDIA output was produced'
        : 'NOT MET — no NVIDIA model produced output for this run';
    pipeline.textContent =
      'NVIDIA requirement: ' + requirement + '. '
      + 'Vision ' + view.provenance.model + ': ' + e.vision + '. '
      + 'Reasoning ' + (view.reasoning ? view.reasoning.model : '-') + ': ' + e.reasoning + '. '
      + e.note;
  }

  // Geometry facts. A re-oriented photograph is disclosed, never silently fixed.
  const geom = $('geometry-note');
  if (geom !== null && view.geometry !== undefined) {
    const g = view.geometry;
    if (g.geometryNormalized && g.exifOrientation !== 1) {
      geom.hidden = false;
      geom.textContent =
        'This source file carried EXIF orientation ' + g.exifOrientation + '. Its pixels were normalized '
        + 'to orientation 1 before inspection, so the model, the display and the evidence overlay all '
        + 'use one coordinate system. No image was re-encoded.';
    } else if (g.storedWidth !== null && g.displayedWidth !== null
      && g.storedWidth !== g.displayedWidth) {
      geom.hidden = false;
      geom.textContent = 'Stored ' + g.storedWidth + '×' + g.storedHeight
        + ', displayed ' + g.displayedWidth + '×' + g.displayedHeight + '.';
    } else {
      geom.hidden = true;
    }
  }

  if (view.failure !== null) {
    const box = el('div', 'fail');
    box.appendChild(el('p', 'fail-h', 'INSPECTION FAILED (' + view.failure.kind + ')'));
    box.appendChild(el('p', null, view.failure.message));
    failHost.appendChild(box);
  }

  if (p.rejectionIssues.length > 0) {
    const box = el('div', 'fail');
    box.appendChild(el('p', 'fail-h', p.rejectionIssues.length + ' MODEL ENTRIES REJECTED BY VALIDATION'));
    const list = el('ul');
    for (const issue of p.rejectionIssues.slice(0, 8)) {
      list.appendChild(el('li', null, issue.field + ': ' + issue.message));
    }
    box.appendChild(list);
    failHost.appendChild(box);
  }
}

/** The earlier observation-level product, still rendered and still reviewable. */
function renderObservations() {
  const host = $('findings');
  clear(host);
  const view = state.view;
  if (view === null) return;

  if (view.observations.length === 0) {
    host.appendChild(el('p', 'empty', 'No raw observations were returned for this capture.'));
  }

  view.observations.forEach((observation, index) => {
    const row = el('div', 'obs');
    row.appendChild(el('span', 'obs-n', String(index + 1).padStart(2, '0')));
    row.appendChild(el('span', 'obs-cat', observation.category));
    row.appendChild(el('span', 'tag', observation.severity));
    row.appendChild(statusTag(observation.verificationStatus));

    const conf = el('span', 'conf');
    const track = el('span', 'conf-track');
    const fill = el('i', 'conf-fill');
    fill.style.width = Math.round(observation.confidence * 100) + '%';
    fill.dataset.band = observation.confidenceBand;
    track.appendChild(fill);
    conf.appendChild(track);
    conf.appendChild(el('span', null, observation.confidence.toFixed(2) + ' ' + observation.confidenceBand));
    row.appendChild(conf);

    row.appendChild(el('p', 'obs-text', observation.observation));

    const evidence = el('p', 'obs-ev');
    evidence.appendChild(el('b', null, 'EVIDENCE '));
    evidence.appendChild(document.createTextNode(observation.evidenceDescription));
    if (!observation.localized) {
      evidence.appendChild(el('span', 'obs-ev-full',
        ' (full-frame — the model returned no localized region for this observation)'));
    }
    row.appendChild(evidence);

    const acts = el('div', 'obs-acts');
    if (observation.suggestedAction !== 'NO_ACTION') {
      acts.appendChild(el('span', 'obs-next', 'Next: ' + observation.suggestedAction));
    }
    if (observation.review && observation.review.reviewer) {
      acts.appendChild(el('span', 'obs-next', 'by ' + observation.review.reviewer));
    }
    for (const decision of ['VERIFIED', 'NEEDS_REVIEW', 'REJECTED']) {
      const label = decision === 'NEEDS_REVIEW' ? 'Needs review' : decision;
      const button = el('button', 'btn', label);
      button.type = 'button';
      button.dataset.decision = decision;
      button.addEventListener('click', async () => {
        const reviewer = $('reviewer').value.trim();
        if (reviewer.length === 0) {
          notify('Enter a reviewer name first.', 'bad');
          return;
        }
        try {
          state.view = await post('/api/review', {
            observationId: observation.id,
            decision: decision,
            reviewer: reviewer,
            note: $('note').value.trim() || null
          });
          notify('Observation ' + decision.replace(/_/g, ' ') + '.', 'good');
          renderAll();
        } catch (error) {
          notify(error.message, 'bad');
        }
      });
      acts.appendChild(button);
    }
    row.appendChild(acts);
    host.appendChild(row);
  });
}

function renderStage() {
  const view = state.view;
  if (view === null) return;
  const p = view.provenance;
  const src = '/api/capture-image/' + encodeURIComponent(p.captureId);
  const image = $('evidence-image');
  if (image.dataset.src !== src) {
    image.dataset.src = src;
    image.src = src;
  }
  // Keep the evidence stage in the same display orientation as the capture
  // stage, so the operator never compares two different rotations of a site.
  const capture = state.captures.filter((c) => c.id === p.captureId)[0];
  const flip = capture !== undefined
    ? displayNeedsFlip(capture.exifOrientation)
    : displayNeedsFlip(view.geometry !== undefined ? view.geometry.exifOrientation : 1);
  image.classList.toggle('img-flip180', flip);
  $('stage-cap').textContent =
    p.captureLabel + ' - ' + p.imageWidth + 'x' + p.imageHeight + ' - ' + bytes(p.byteLength)
    + ' - ' + p.mediaType;
}

/**
 * Run one render step, isolating its failures.
 *
 * The first version of this file called each render function directly, so a
 * single unguarded appendChild(null) threw and aborted every later step: the
 * rail painted but the evidence image never got a src and the caption kept its
 * placeholder text, with no indication of what had gone wrong. Isolating each
 * step means one malformed finding can no longer blank the instrument, and the
 * fault is reported where the operator can see it.
 */
function safeRender(name, fn) {
  try {
    fn();
  } catch (error) {
    notify('Render step "' + name + '" failed: ' + error.message, 'bad');
    if (window.console && window.console.error) {
      window.console.error('[reality-inspector] render step failed:', name, error);
    }
  }
}

function renderAll() {
  safeRender('header', renderHeader);
  safeRender('pipeline', renderPipeline);
  safeRender('rail', renderRail);
  safeRender('brief', renderBrief);
  safeRender('priorities', renderPriorities);
  safeRender('comparison', renderComparison);
  safeRender('reasoning', renderReasoning);
  safeRender('findings', renderFindings);
  safeRender('provenance', renderProvenance);
  safeRender('observations', renderObservations);
  safeRender('stage', renderStage);
  safeRender('overlay', renderOverlay);
}

function renderFixtures() {
  const host = $('fixture-list');
  clear(host);
  $('capture-empty').hidden = state.captures.length > 0 || state.project === null;

  state.captures.forEach((capture) => {
    const row = el('li', 'capture-row');
    if (state.currentCaptureId === capture.id) row.setAttribute('aria-current', 'true');

    const button = el('button', 'capture-main');
    button.type = 'button';
    button.appendChild(el('span', null, capture.label));

    const meta = el('div', 'capture-meta');
    const source = el('span', 'capture-tag', sourceLabel(capture.source));
    source.setAttribute('data-source', capture.source);
    source.title = sourceTitle(capture.source);
    meta.appendChild(source);
    meta.appendChild(el('span', null, capture.width + 'x' + capture.height));
    meta.appendChild(el('span', null, bytes(capture.byteLength)));
    meta.appendChild(el('span', null, capture.zoneId || 'no zone'));
    meta.appendChild(el('span', null, String(capture.createdAt).replace('T', ' ').slice(0, 16)));
    button.appendChild(meta);

    button.addEventListener('click', () => loadCapture(capture.id));
    row.appendChild(button);

    const del = el('button', 'capture-del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete capture ' + capture.label);
    del.addEventListener('click', () => confirmDeleteCapture(capture));
    row.appendChild(del);

    host.appendChild(row);
  });
}

function showLoaded(label) {
  if (state.currentCaptureId === null) {
    $('loaded').hidden = true;
    return;
  }
  $('loaded').hidden = false;
  const image = $('capture-image');
  image.src = '/api/capture-image/' + encodeURIComponent(state.currentCaptureId);
  image.alt = label;
  const capture = state.captures.filter((c) => c.id === state.currentCaptureId)[0];
  image.classList.toggle('img-flip180', capture !== undefined && displayNeedsFlip(capture.exifOrientation));
}

/**
 * Whether this capture must be DISPLAYED rotated 180 degrees.
 *
 * The pipeline stores orientation-normalized bytes (EXIF tag rewritten to 1,
 * pixels untouched), so the browser paints exactly the pixels the model saw and
 * every coordinate lives in one space. For most re-oriented files that is the
 * whole fix: the five dataset images tagged orientation 6 ('007', '009', '015',
 * '017', '021') carry pixels that are ALREADY upright — their tag was stale, so
 * displaying the stored pixels as-is is what makes them upright.
 *
 * Orientation 3 is the measured exception (dataset '004' and '027'): their tags
 * were accurate and the stored pixels really are 180 degrees from the scene, so
 * tag normalization alone leaves them upside down. The display — and only the
 * display — is rotated back here, and renderOverlay maps every evidence box
 * through the same 180-degree flip, so a genuine box stays attached to the
 * correct physical region. No byte is re-encoded and the model's coordinate
 * space is untouched: the model still reads the same normalized bytes it is
 * given everywhere else.
 *
 * Keyed on the ORIGINAL orientation the server records per capture. Orientation
 * 4 (upside-down mirror) is grouped with 3 because both are axis-preserving
 * 180-degree display rotations; no dataset image carries it. Axis-swapping
 * orientations (5-8) are deliberately NOT honoured at display time: this
 * dataset's tags of that class were measured stale, and honouring them would
 * rotate upright images back to sideways. Revisit per file if the dataset ever
 * gains images whose 5-8 tags are proven accurate.
 */
function displayNeedsFlip(orientation) {
  return orientation === 3 || orientation === 4;
}

/**
 * Select a capture WITHOUT running the model.
 *
 * Selecting is a view change. It used to post to /api/run, which spent a real
 * vision inference on every click, burned provider quota, and reported a fresh
 * "result" for a capture nobody asked to inspect - while the documented flow is
 * select, then inspect. The selection endpoint returns the whole workspace, so
 * a capture that was already inspected comes back with its result and its human
 * verifications intact.
 */
async function loadCapture(captureId) {
  state.activeId = null;
  state.openIds.clear();
  setLamp('working', 'Selecting capture');
  notify('');
  try {
    applyWorkspace(await post('/api/captures/select', { captureId: captureId }));
    renderWorkspace();
    const inspected = state.view !== null && state.view.outcome !== 'PENDING';
    setLamp('ready', 'Capture selected - inspect when ready');
    setStatus(
      inspected
        ? 'Restored the last inspection of this capture. Inspect again for a fresh reading.'
        : 'Capture selected. Press Inspect reality to analyse it.',
      null
    );
    notify(inspected ? 'Capture selected; showing its last inspection.' : 'Capture selected.', 'good');
  } catch (error) {
    setLamp('problem', 'Capture could not be selected');
    notify(error.message, 'bad');
  }
}

async function uploadFile(file) {
  if (!file) return;
  const error = $('drop-error');
  error.hidden = true;

  setLamp('working', 'Reading capture');
  try {
    const body = await fetch(
      '/api/upload?name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type),
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }
    );
    const payload = await body.json();
    if (!body.ok) {
      error.textContent = payload.message || payload.error || 'That file could not be read.';
      error.hidden = false;
      setLamp('problem', 'Capture rejected');
      return;
    }

    applyWorkspace(payload);
    showLoaded(payload.capture.label);
    renderFixtures();
    notify('Capture added to ' + (state.project ? state.project.name : 'this project') + '. Inspect it when ready.', 'good');
    setLamp('ready', 'Capture loaded - inspect when ready');
    renderAll();
  } catch (uploadError) {
    error.textContent = uploadError.message;
    error.hidden = false;
    setLamp('problem', 'Capture rejected');
  }
}

/**
 * Run the inspection.
 *
 * Only a genuinely COMPLETED run advances to Evidence. A failed or empty run
 * leaves the operator on the message that explains what happened, rather than
 * on an empty evidence panel that reads like a working inspection.
 */
async function runInspection() {
  if (state.running) return;
  state.running = true;
  const runButton = $('run');
  if (runButton) runButton.disabled = true;

  const cached = $('cache-toggle').checked;
  setLamp('working', 'ANALYZING REALITY');
  setStatus(
    'ANALYZING REALITY - MiniCPM is reading the capture, then the comparison is computed in code, '
    + 'then Nemotron reasons about the result. Two real model calls; this takes some seconds.',
    'working'
  );
  notify('Inspection running: real vision inference, deterministic comparison, then Nemotron reasoning.');

  // An honest elapsed clock. NOT a fake progress bar: there is no way to know
  // how far through a vision call we are, so the UI must not invent one.
  const startedAt = Date.now();
  const tick = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    setStatus(
      'RUNNING - ' + secs + 's elapsed. Vision, then comparison, then Nemotron reasoning. '
      + 'There is no per-stage progress signal to show, only elapsed time.',
      'working',
    );
  }, 1000);

  try {
    state.view = state.currentCaptureId !== null
      ? await post('/api/run', { captureId: state.currentCaptureId, cache: cached })
      : await post('/api/run', { cache: cached });

    const view = state.view;
    state.activeId = null;
    state.openIds.clear();

    if (view.outcome === 'COMPLETED') {
      const origin = view.inferenceOrigin;
      const took = Math.round((Date.now() - startedAt) / 1000);
      // State the provenance of the result explicitly. "Complete" alone would
      // be ambiguous between a live call, a cache hit and a fixture.
      const how = origin === 'CACHED'
        ? 'CACHED AI RESULT (previous inference)'
        : origin === 'DEMO_FIXTURE'
          ? 'DEMO FIXTURE'
          : 'FRESH AI INFERENCE';
      setLamp('done', 'FINDINGS READY - awaiting human review');
      setStatus(
        how + ' complete in ' + took + 's. ' + view.inspectionFindings.length
        + ' finding(s), all UNVERIFIED and awaiting a named human decision.',
        'good',
      );

      // Report BOTH stages, and say plainly if one of them produced nothing. A
      // silent reasoning failure here would leave the judge believing Nemotron
      // contributed when it did not.
      const reasoning = view.reasoning;
      if (reasoning !== undefined && reasoning !== null) {
        if (reasoning.status === 'AVAILABLE') {
          notify(
            how + ': ' + view.brief.overall.replace(/_/g, ' ') + '. '
            + 'Nemotron reasoning: ' + reasoning.reasoning.certainty.replace(/_/g, ' ').toLowerCase()
            + '. Nothing is verified yet.',
            'good'
          );
        } else {
          notify(
            how + ': ' + view.brief.overall.replace(/_/g, ' ') + '. '
            + 'CONSTRUCTION REASONING UNAVAILABLE (' + (reasoning.failureKind || 'not run') + ') - '
            + 'the comparison below is unaffected and nothing has been invented in its place.',
            'good'
          );
        }
      } else {
        notify(how + ': ' + view.brief.overall.replace(/_/g, ' ') + '. Nothing is verified yet.', 'good');
      }

      // only move on to the evidence stage once the inspection really completed
      selectStep('evidence');
      // Open the first finding so the evidence is never hidden behind a closed card.
      if (view.inspectionFindings.length > 0) {
        state.activeId = view.inspectionFindings[0].id;
        state.openIds.add(state.activeId);
      }
    } else {
      // Distinguish WHY it failed. A provider outage, a malformed model answer
      // and an empty-but-valid answer are three different operational problems.
      setLamp('problem', 'Inspection did not complete');
      const why = view.failure !== null
        ? describeFailure(view.failure.kind, view.failure.message)
        : view.outcome === 'VALIDATION_FAILED'
          ? 'AI model returned an invalid response: ' + view.provenance.rejectionIssues.length
            + ' entries failed schema validation and were rejected.'
          : 'The model answered, but reported nothing it could defend for this capture.';
      setStatus(why, 'bad');
      notify(why, 'bad');
      selectStep('inspect');
    }
    renderAll();
  } catch (error) {
    setLamp('problem', 'Inspection failed');
    const message = 'AI provider request failed: ' + error.message;
    setStatus(message, 'bad');
    notify(message, 'bad');
  } finally {
    clearInterval(tick);
    state.running = false;
    if (runButton) runButton.disabled = false;
  }
}

/**
 * Map a provider failure kind to an operator-facing sentence.
 *
 * Each kind is a different operational problem, so each gets its own message
 * rather than one generic "something went wrong".
 */
function describeFailure(kind, message) {
  switch (kind) {
    case 'TIMEOUT':
      return 'AI provider timed out. The model did not answer in time; no result was produced.';
    case 'UNAVAILABLE':
      return 'Could not reach the AI provider (network or server error). No result was produced.';
    case 'AUTHENTICATION':
      return 'AI provider rejected the credential (authentication failed). Check NEBIUS_API_KEY.';
    case 'RATE_LIMITED':
      return 'AI provider rate-limited this request. Wait a moment and run again.';
    case 'NOT_CONFIGURED':
      return 'No AI provider is configured, so no inspection was performed.';
    case 'MALFORMED_RESPONSE':
      return 'AI model returned an invalid response that could not be parsed.';
    default:
      return 'AI provider error (' + kind + '): ' + message;
  }
}

async function applyExpected(presetId) {
  const preset = presetId === undefined ? $('expected-preset').value : presetId;
  try {
    const payload = await post('/api/expected', { presetId: preset });
    applyWorkspace(payload);
    if (state.view) state.expected = state.view.expected;
    renderExpected();
    notify(
      'Reference applied. Re-run the inspection to compare against it.',
      'good'
    );
    renderAll();
  } catch (error) {
    notify(error.message, 'bad');
  }
}

async function applyExpectedEdits() {
  const payload = collectExpected();
  if (payload === null) return;
  try {
    const result = await post('/api/expected', payload);
    applyWorkspace(result);
    if (state.view) state.expected = state.view.expected;
    renderExpected();
    notify('Reference updated. Re-run the inspection to recompute the comparison.', 'good');
    renderAll();
  } catch (error) {
    notify(error.message, 'bad');
  }
}

/** Project selector: which project is active, and what can be done to it. */
function renderProjects() {
  setText('proj-name', state.project ? state.project.name : 'No project');
  setText('meta-project', state.project ? state.project.name : '-');
  $('proj-delete').disabled = state.project === null;
  $('proj-rename').disabled = state.project === null;

  const host = $('proj-list');
  clear(host);
  $('proj-empty').hidden = state.projects.length > 0;

  state.projects.forEach((project) => {
    const item = el('li');
    const button = el('button', 'proj-item');
    button.type = 'button';
    button.setAttribute('aria-label', 'Switch to project ' + project.name);
    if (state.project && project.id === state.project.id) {
      button.setAttribute('aria-current', 'true');
    }
    const left = el('span');
    const name = el('span', 'proj-item-n', project.name);
    if (project.demo) {
      const badge = el('span', 'proj-badge', 'DEMO');
      badge.title = 'Synthetic demo project, recreated on every start.';
      name.appendChild(document.createTextNode(' '));
      name.appendChild(badge);
    }
    left.appendChild(name);
    if (project.location) left.appendChild(el('span', 'proj-item-c', '  ' + project.location));
    button.appendChild(left);
    button.appendChild(el('span', 'proj-item-c', project.captureCount + ' cap'));
    button.addEventListener('click', () => switchProject(project.id));
    item.appendChild(button);
    host.appendChild(item);
  });
}

function setMenu(open) {
  $('proj-menu').hidden = !open;
  $('proj-btn').setAttribute('aria-expanded', String(open));
}

/** Re-render everything that depends on which project and capture are active. */
function renderWorkspace() {
  renderProjects();
  renderFixtures();
  renderExpected();
  renderStorage();
  renderDataset();
  renderAll();
  if (state.view && state.view.provenance) {
    showLoaded(state.view.provenance.captureLabel);
  } else {
    $('loaded').hidden = true;
  }
}

async function switchProject(projectId) {
  setMenu(false);
  try {
    applyWorkspace(await post('/api/projects/switch', { projectId: projectId }));
    notify('Switched to ' + (state.project ? state.project.name : 'project') + '.', 'good');
    renderWorkspace();
    setStatus(
      state.captures.length > 0
        ? 'Capture loaded from ' + state.project.name + '. Inspect when ready.'
        : 'No captures in this project yet. Drop a site photograph or choose a demo capture.',
      null
    );
  } catch (error) {
    notify(error.message, 'bad');
  }
}

function openProjectModal(mode) {
  const modal = $('proj-modal');
  const isRename = mode === 'rename';
  $('proj-modal-h').textContent = isRename ? 'Rename project' : 'New project';
  $('proj-save').textContent = isRename ? 'Save name' : 'Create project';
  $('proj-input-name').value = isRename && state.project ? state.project.name : '';
  $('proj-input-location').value = isRename && state.project ? state.project.location : '';
  $('proj-input-location').disabled = isRename;
  $('proj-modal-note').hidden = true;
  modal.showModal();
  $('proj-input-name').focus();
}

async function submitProjectModal(event) {
  event.preventDefault();
  const name = $('proj-input-name').value;
  const isRename = $('proj-save').textContent === 'Save name';
  try {
    if (isRename && state.project) {
      applyWorkspace(await patch('/api/projects/' + encodeURIComponent(state.project.id), { name: name }));
    } else {
      applyWorkspace(await post('/api/projects', { name: name, location: $('proj-input-location').value }));
    }
    $('proj-modal').close();
    notify('Project ' + (isRename ? 'renamed' : 'created') + ': ' + (state.project ? state.project.name : '') + '.', 'good');
    renderWorkspace();
    if (state.captures.length === 0) {
      setStatus('No captures in this project yet. Drop a site photograph or choose a demo capture.', null);
    }
  } catch (error) {
    const note = $('proj-modal-note');
    note.textContent = error.message;
    note.hidden = false;
  }
}

/**
 * Deletion is confirmed before anything is removed.
 *
 * The dialog names exactly what goes, because "delete project" is destructive and
 * an operator should never have to guess whether their captures survive.
 */
function openDeleteModal(kind, subject) {
  state.pendingDelete = { kind: kind, subject: subject };
  const titles = { project: 'Delete project', capture: 'Delete capture', preset: 'Delete reference' };
  $('del-modal-h').textContent = titles[kind];
  const bodies = {
    project:
      'Delete "' + subject.name + '"? Its ' + subject.captureCount +
      ' capture(s), their inspection results, findings and human verifications are removed. This cannot be undone.',
    capture:
      'Delete the capture "' + subject.label +
      '"? Its inspection results, findings and human verifications are removed. This cannot be undone.',
    preset:
      'Delete the reference "' + subject.label + '"? The project falls back to the default reference and any comparison against it is discarded.',
  };
  $('del-body').textContent = bodies[kind];
  $('del-modal').showModal();
}

function confirmDeleteCapture(capture) {
  openDeleteModal('capture', capture);
}

async function commitDelete() {
  const pending = state.pendingDelete;
  $('del-modal').close();
  if (!pending) return;
  state.pendingDelete = null;
  try {
    if (pending.kind === 'project') {
      applyWorkspace(await del('/api/projects/' + encodeURIComponent(pending.subject.id)));
      notify('Project deleted.', 'good');
    } else if (pending.kind === 'preset') {
      applyWorkspace(await del('/api/presets/' + encodeURIComponent(pending.subject.id)));
      notify('Reference deleted. The project now uses the default reference.', 'good');
    } else {
      applyWorkspace(await del('/api/captures/' + encodeURIComponent(pending.subject.id)));
      notify('Capture deleted.', 'good');
    }
    renderWorkspace();
    if (state.projects.length === 0) {
      setStatus('No projects yet. Create a project to capture and inspect a site.', null);
      setLamp('idle', 'No project');
    } else if (state.captures.length === 0) {
      setStatus('No captures in this project yet. Drop a site photograph or choose a demo capture.', null);
      setLamp('idle', 'Capture ready');
    }
  } catch (error) {
    notify(error.message, 'bad');
  }
}

/** One editable expected-element row inside the reference dialog. */
function presetRow(item) {
  const row = el('div', 'preset-item');

  const kind = document.createElement('select');
  ELEMENT_KINDS.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = pretty(value);
    if (value === (item && item.element)) option.selected = true;
    kind.appendChild(option);
  });
  kind.setAttribute('aria-label', 'Element kind');
  row.appendChild(kind);

  const mode = document.createElement('select');
  ['PRESENT', 'COUNT', 'ABSENT'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    if (value === (item && item.expectation)) option.selected = true;
    mode.appendChild(option);
  });
  mode.setAttribute('aria-label', 'Expectation');
  row.appendChild(mode);

  const count = document.createElement('input');
  count.type = 'text';
  count.inputMode = 'numeric';
  count.value = item && item.expectedCount !== null && item.expectedCount !== undefined
    ? String(item.expectedCount)
    : '';
  count.placeholder = 'count';
  count.setAttribute('aria-label', 'Expected count');
  row.appendChild(count);

  const drop = el('button', 'btn btn-ghost', 'x');
  drop.type = 'button';
  drop.setAttribute('aria-label', 'Remove expected element');
  drop.addEventListener('click', () => {
    state.presetDraft = state.presetDraft.filter((entry) => entry !== item);
    renderPresetDraft();
  });
  row.appendChild(drop);

  return row;
}

function renderPresetDraft() {
  const host = $('preset-items');
  clear(host);
  if (state.presetDraft.length === 0) {
    state.presetDraft.push({ element: 'COLUMN', expectation: 'PRESENT', expectedCount: null });
  }
  state.presetDraft.forEach((item) => host.appendChild(presetRow(item)));
}

function openPresetModal(mode) {
  const isRename = mode === 'rename';
  $('preset-modal-h').textContent = isRename ? 'Rename reference' : 'New reference';
  $('preset-save').textContent = isRename ? 'Save name' : 'Create reference';
  $('preset-input-name').value = isRename && state.reference ? state.reference.name : '';
  $('preset-input-zone').disabled = isRename;
  $('preset-input-zone').value = isRename && state.reference ? state.reference.zone : '';
  $('preset-add').hidden = isRename;
  $('preset-modal-note').hidden = true;
  if (isRename) {
    state.presetDraft = [];
    clear($('preset-items'));
  } else {
    state.presetDraft = [];
    renderPresetDraft();
  }
  $('preset-modal').showModal();
  $('preset-input-name').focus();
}

function collectPresetDraft() {
  return [...$('preset-items').children].map((row) => {
    const [kind, mode, count] = [row.children[0], row.children[1], row.children[2]];
    const expectation = mode.value;
    const raw = count.value.trim();
    return {
      element: kind.value,
      expectation: expectation,
      expectedCount: expectation === 'COUNT' && raw.length > 0 ? Number(raw) : null,
    };
  });
}

async function submitPresetModal(event) {
  event.preventDefault();
  const name = $('preset-input-name').value;
  const isRename = $('preset-save').textContent === 'Save name';
  try {
    if (isRename && state.reference) {
      applyWorkspace(await patch('/api/presets/' + encodeURIComponent(state.reference.presetId), { name: name }));
    } else {
      applyWorkspace(await post('/api/presets', {
        name: name,
        zone: $('preset-input-zone').value,
        items: collectPresetDraft(),
      }));
    }
    $('preset-modal').close();
    notify('Reference ' + (isRename ? 'renamed' : 'created') + '.', 'good');
    renderWorkspace();
  } catch (error) {
    const note = $('preset-modal-note');
    note.textContent = error.message;
    note.hidden = false;
  }
}

/**
 * Report a boot failure honestly and VISIBLY.
 *
 * #status lives inside the Inspect bay, so writing an error there is invisible
 * to anyone sitting on Capture or Evidence. #notice sits above the stage and is
 * always on screen, so a real failure can never be hidden behind a tab.
 */
function reportBootFailure(error) {
  const isNetwork = error instanceof TypeError || /fetch|network|Failed to fetch/i.test(error.message);
  const what = isNetwork
    ? 'Could not reach the inspector server. Is it still running on port 4317?'
    : 'The inspector failed to render: ' + error.message;
  setLamp('problem', isNetwork ? 'Inspector unreachable' : 'Render failed');
  setStatus(what, 'bad');
  notify(what, 'bad');
}

function wire() {
  $('proj-btn').addEventListener('click', () => setMenu($('proj-menu').hidden));
  $('proj-new').addEventListener('click', () => { setMenu(false); openProjectModal('create'); });
  $('proj-rename').addEventListener('click', () => { setMenu(false); openProjectModal('rename'); });
  $('proj-delete').addEventListener('click', () => {
    setMenu(false);
    if (state.project) openDeleteModal('project', state.project);
  });
  $('preset-form').addEventListener('submit', submitPresetModal);
  $('preset-cancel').addEventListener('click', () => $('preset-modal').close());
  $('preset-add').addEventListener('click', () => {
    state.presetDraft.push({ element: 'COLUMN', expectation: 'PRESENT', expectedCount: null });
    renderPresetDraft();
  });
  $('expected-new').addEventListener('click', () => openPresetModal('create'));
  $('expected-rename').addEventListener('click', () => openPresetModal('rename'));
  $('expected-delete').addEventListener('click', () => {
    if (!state.reference) return;
    openDeleteModal('preset', {
      id: state.reference.presetId,
      label: state.reference.name,
      captureCount: state.reference.itemCount,
    });
  });

  $('proj-form').addEventListener('submit', submitProjectModal);
  $('proj-cancel').addEventListener('click', () => $('proj-modal').close());
  $('del-cancel').addEventListener('click', () => { state.pendingDelete = null; $('del-modal').close(); });
  $('del-confirm').addEventListener('click', commitDelete);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  document.querySelectorAll('.step').forEach((button) => {
    button.addEventListener('click', () => selectStep(button.dataset.step));
    button.addEventListener('keydown', stepFromKey);
  });

  $('run').addEventListener('click', runInspection);
  $('pick').addEventListener('click', (event) => {
    event.stopPropagation();
    $('file').click();
  });
  $('file').addEventListener('change', (event) => uploadFile(event.target.files[0]));
  $('replace').addEventListener('click', () => $('file').click());
  $('remove').addEventListener('click', () => {
    const capture = state.captures.filter((c) => c.id === state.currentCaptureId)[0];
    if (capture) confirmDeleteCapture(capture);
  });

  const drop = $('drop');
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('file').click();
    }
  });
  ['dragenter', 'dragover'].forEach((name) => {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.dataset.over = 'true';
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.dataset.over = 'false';
    });
  });
  drop.addEventListener('drop', (event) => uploadFile(event.dataTransfer.files[0]));

  $('expected-apply').addEventListener('click', () => {
    // Apply whatever is currently in the editor: an edited count, or the
    // selected preset when nothing has been touched.
    const edited = collectExpected();
    const preset = $('expected-preset').value;
    const dirty = edited !== null && state.expected !== null
      && JSON.stringify(edited.items) !== JSON.stringify(state.expected.items);
    if (dirty) applyExpectedEdits();
    else applyExpected(preset);
  });
  $('expected-preset').addEventListener('change', () => applyExpected($('expected-preset').value));

  // Evidence geometry is positioned from the rendered image size, so the
  // overlay has to be recomputed whenever the image loads or the window resizes.
  $('evidence-image').addEventListener('load', renderOverlay);
  // A failed image must SAY SO. A silent broken-image icon is indistinguishable
  // from an empty capture, which is how this fault hid in the first place.
  $('evidence-image').addEventListener('error', () => {
    setStatus('The capture image could not be loaded from the server.', 'bad');
    notify('Capture image failed to load. The capture record is intact; re-select the capture.', 'bad');
  });
  window.addEventListener('resize', renderOverlay);
}

async function boot() {
  wire();
  selectStep('capture', { quiet: true });

  try {
    applyWorkspace(await api('/api/workspace'));

    const expected = await api('/api/expected');
    state.expected = expected.current;
    renderExpected();

    renderWorkspace();
    // The dataset index is separate from the workspace payload because it lists
    // every file. Fetched after the workspace so the first paint is never blocked
    // on a directory scan.
    await loadDataset();

    setLamp('ready', 'Capture ready');
    const hasDataset = state.dataset !== null && state.dataset.present;
    setStatus(
      state.captures.length > 0
        ? (hasDataset
            ? 'Choose a capture, import a real dataset photograph below, or drop your own — then inspect.'
            : 'Choose a capture or drop a site photograph, then inspect.')
        : 'No captures in this project yet. Import a local dataset image or drop a photograph.',
      null
    );
  } catch (error) {
    // A render fault and a transport fault must not both claim the server is
    // unreachable. The earlier version said "Could not reach the inspector" for
    // ANY throw, including a bug in rendering, which sent me looking at the
    // network when the real fault was in this file.
    reportBootFailure(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
`;
