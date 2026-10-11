// The inspector client.

import { clientLocalizationPayload } from '../localization.ts';

export const APP_JS = `'use strict';

const $ = (id) => document.getElementById(id);

// The inspection vocabulary, shipped from the server module that owns it.
const I18N = ${JSON.stringify(clientLocalizationPayload())};

const LANG_STORAGE_KEY = 'sitelens.inspectionLanguage';

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
  pendingDelete: null,
  pendingReviewIntent: null,
  lang: 'en',
  // The ordered photographs of the OPEN inspection.
  captureIds: [],
  // Photographs the server refused as byte-identical duplicates of something already open.
  duplicateCaptureIds: [],
  // Which photograph of the open group the evidence stage is showing.
  evidenceCaptureId: null,
  // The ceiling on one inspection, read from the server that enforces it, so the masthead can never claim a different.
  maxInspectionImages: null,
  // The gate the server actually enforces, read from the workspace payload.
  reviewerGate: null,
  // Which model-prose cards are showing the authoritative original English instead of the localized presentation.
  trOriginal: new Set(),
  lastRunSecs: null,
  findingInFlight: new Set(),
  obsReviewInFlight: new Set(),
  findingFeedback: {},
  referenceInvalidated: null
};

// Label lookup for the selected language.
function t(key) {
  const catalog = I18N.strings[state.lang] || I18N.strings[I18N.defaultLanguage];
  const value = catalog ? catalog[key] : undefined;
  if (typeof value === 'string') return value;
  const fallback = I18N.strings[I18N.defaultLanguage];
  const english = fallback ? fallback[key] : undefined;
  return typeof english === 'string' ? english : key;
}

// Read the persisted preference, rejecting anything unsupported.
function readStoredLanguage() {
  try {
    const raw = window.localStorage ? window.localStorage.getItem(LANG_STORAGE_KEY) : null;
    if (raw === null || raw === undefined) return I18N.defaultLanguage;
    const match = I18N.languages.filter((l) => l.code === raw)[0];
    return match === undefined ? I18N.defaultLanguage : match.code;
  } catch (error) {
    return I18N.defaultLanguage;
  }
}

function storeLanguage(code) {
  try {
    if (window.localStorage) window.localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch (error) {
    // A blocked or full storage must not break the switch.
  }
}

// Apply the language to the document and the DOCUMENTED localized surface.
function applyLanguage() {
  const option = I18N.languages.filter((l) => l.code === state.lang)[0];
  const dir = option === undefined ? 'ltr' : option.dir;
  const bcp47 = option === undefined ? I18N.defaultLanguage : option.bcp47;
  if (document.documentElement) {
    document.documentElement.setAttribute('lang', bcp47);
    document.documentElement.setAttribute('dir', dir);
  }
  const surfaces = document.querySelectorAll('.i18n-surface');
  for (let i = 0; i < surfaces.length; i++) {
    surfaces[i].setAttribute('lang', bcp47);
    surfaces[i].setAttribute('dir', dir);
  }

  // Static markup. A key with no catalog entry falls back to English inside t(), and the coverage test asserts that never happens.
  const translated = document.querySelectorAll('[data-i18n]');
  for (let i = 0; i < translated.length; i++) {
    const node = translated[i];
    const key = node.getAttribute('data-i18n');
    if (key === null || key === undefined || key === '') continue;
    node.textContent = t(key);
  }

  // The other four homes for a translated string.
  const ATTR_HOOKS = [
    ['data-i18n-ph', 'placeholder'],
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-alt', 'alt'],
    ['data-i18n-title', 'title'],
  ];
  for (const [attr, target] of ATTR_HOOKS) {
    const nodes = document.querySelectorAll('[' + attr + ']');
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const key = node.getAttribute(attr);
      if (key === null || key === undefined || key === '') continue;
      node.setAttribute(target, t(key));
    }
  }

  const label = $('lang-label');
  if (label) label.textContent = t('lang.label');
  // The presentation-only hint lives as a title tooltip on the language control (data-i18n-title="lang.hint" in the.
}

// The localized projection of the current inspection, or null.
function localized() {
  const view = state.view;
  if (view === null || view === undefined) return null;
  const all = view.localized;
  if (all === null || all === undefined) return null;
  return all[state.lang] || all[I18N.defaultLanguage] || null;
}

// Presentation-layer lookup for model-authored English prose.
function modelTx(source) {
  const fallback = { text: source, translated: false };
  if (state.lang === 'en') return fallback;
  const view = state.view;
  if (view === null || view === undefined) return fallback;
  const map = view.modelTranslations;
  if (map === null || map === undefined) return fallback;
  const entry = map[source];
  if (entry === null || entry === undefined) return fallback;
  const perLang = entry[state.lang] || entry[I18N.defaultLanguage];
  if (perLang === null || perLang === undefined) return fallback;
  if (typeof perLang.text !== 'string' || perLang.text.trim().length === 0) return fallback;
  return { text: perLang.translated ? perLang.text : source, translated: !!perLang.translated };
}

// Whether this card/field is currently showing the authoritative original.
function showingOriginal(key) {
  return state.trOriginal.has(key);
}

function setShowingOriginal(key, show) {
  if (show) state.trOriginal.add(key);
  else state.trOriginal.delete(key);
}

// A small toggle button between a localized presentation and its authoritative original.
function trToggle(key, isShowingOriginal) {
  const btn = el('button', 'tr-toggle', isShowingOriginal ? t('tr.viewTranslation') : t('tr.viewOriginal'));
  btn.type = 'button';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setShowingOriginal(key, !isShowingOriginal);
    renderAll();
  });
  return btn;
}

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
    // The machine-readable code, kept so a caller can react to a SPECIFIC refusal rather than matching on English prose.
    err.code = typeof body.error === 'string' ? body.error : '';
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

// Apply an authoritative workspace payload.
function applyWorkspace(payload) {
  if (payload === null || payload === undefined) return;
  state.project = payload.project;
  state.projects = payload.projects || [];
  state.presets = payload.presets || [];
  state.reference = payload.reference || null;
  state.storage = payload.storage || null;
  state.pipeline = payload.pipeline || null;
  // The dataset summary arrives with every workspace payload.
  if (payload.dataset !== undefined && payload.dataset !== null) {
    state.dataset = payload.dataset;
  }
  state.captures = payload.captures || [];
  state.maxInspectionImages = typeof payload.maxInspectionImages === 'number'
    ? payload.maxInspectionImages
    : state.maxInspectionImages;
  if (payload.reviewerGate !== undefined && payload.reviewerGate !== null) {
    state.reviewerGate = payload.reviewerGate;
  }
  // The server is authoritative about which photographs are open, including the grouped order.
  state.captureIds = Array.isArray(payload.activeCaptureIds) && payload.activeCaptureIds.length > 0
    ? payload.activeCaptureIds.slice()
    : (payload.activeCaptureId ? [payload.activeCaptureId] : []);
  state.currentCaptureId = payload.activeCaptureId || null;
  state.duplicateCaptureIds = Array.isArray(payload.duplicateCaptureIds) ? payload.duplicateCaptureIds.slice() : [];
  state.view = payload.view || null;
  state.lastRunSecs = null;
  state.activeId = null;
  state.openIds.clear();
  if (state.findingInFlight) state.findingInFlight.clear();
  if (state.obsReviewInFlight) state.obsReviewInFlight.clear();
  state.findingFeedback = {};
  if (state.referenceInvalidated && (
    !state.project
    || state.referenceInvalidated.projectId !== state.project.id
    || (state.view && state.view.outcome !== 'PENDING')
  )) {
    state.referenceInvalidated = null;
  }
  // The open group changed, so the frame the evidence stage was showing may no longer belong to it.
  if (state.evidenceCaptureId !== null && !state.captureIds.includes(state.evidenceCaptureId)) {
    state.evidenceCaptureId = null;
  }
}

// Human label for a capture source. Three cases, never collapsed into two.
function sourceLabel(source) {
  if (source === 'LOCAL_DATASET') return t('capture.sourceDataset');
  if (source === 'UPLOAD') return t('capture.sourceUpload');
  return t('capture.sourceFixture');
}

function sourceTitle(source) {
  if (source === 'LOCAL_DATASET') return t('capture.titleDataset');
  if (source === 'UPLOAD') return t('capture.titleUpload');
  return t('capture.titleFixture');
}

// Status text is mirrored outside the tab panels, so a message raised on one step is still readable from another.
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

// Show one workflow step and hide the rest.
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

  // The overlay is positioned from rendered image dimensions, so it must be recomputed once the panel is actually visible.
  renderOverlay();

  if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Arrow-key navigation, the expected behaviour for a tablist.
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

// The active reference, the catalogue and where the bytes actually live.
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
    node.dataset.durable = 'unknown';
    node.textContent = 'Storage: unknown — durability not confirmed (treat as process memory only).';
    return;
  }
  const view = state.view;
  if (view && view.persistence && view.persistence.written === false) {
    node.dataset.durable = 'failed';
    node.textContent = 'Storage write failed (' + state.storage.location + '): ' + view.persistence.message;
    return;
  }
  if (state.storage.durable === true) {
    node.dataset.durable = 'true';
    const confirmed = view && view.outcome === 'COMPLETED' ? ' Confirmed written to disk.' : '';
    node.textContent = 'Storage (durable): ' + state.storage.location + '. ' + state.storage.detail + confirmed;
    return;
  }
  node.dataset.durable = 'false';
  node.textContent = 'Storage (process memory only — not durable): ' + state.storage.location + '. ' + state.storage.detail;
}

// The local validation dataset browser.
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
  // The workspace summary carries a precomputed count.
  const imageCount = summary.count !== undefined && summary.count !== null
    ? summary.count
    : (summary.entries ? summary.entries.length : 0);
  $('dataset-count').textContent = summary.present
    ? imageCount + ' IMAGES'
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

// Fetch the dataset index once; the workspace payload only carries a summary.
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
    // The count box is only meaningful for a COUNT expectation.
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

// Read the editor back into an expected-state payload for the server.
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

// Where the photograph is ACTUALLY painted inside its element.
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
  // 'contain', 'scale-down' and 'cover' all scale by the same factor and centre the result.
  const scale = Math.min(elementWidth / naturalWidth, elementHeight / naturalHeight);
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (elementWidth - naturalWidth * scale) / 2,
    offsetY: (elementHeight - naturalHeight * scale) / 2,
  };
}

// Point-reflect a pixel box through the frame: the exact mapping a 180-degree display rotation demands.
function flipBox180(box, frameWidth, frameHeight) {
  return {
    left: frameWidth - box.left - box.width,
    top: frameHeight - box.top - box.height,
    width: box.width,
    height: box.height,
  };
}

// Draw evidence boxes over the reality image.
function renderOverlay() {
  const overlay = $('overlay');
  if (!overlay) return;
  clear(overlay);

  const view = state.view;
  const image = $('evidence-image');
  if (view === null || image === null) return;
  const area = paintedArea(image);
  if (area === null) return;

  const findings = (view.inspectionFindings || []).filter((finding) => {
    // A photograph that is not the one on screen must not draw its boxes onto it: a box read from another frame would be a.
    return state.captureIds.length <= 1
      || finding.captureId === undefined
      || finding.captureId === state.evidenceCaptureId;
  });

  // A display flipped 180 degrees must carry its boxes with it.
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

// Show one finding: open its card and light up its region on the image.
function openFinding(id) {
  state.activeId = id;
  if (!state.openIds.has(id)) state.openIds.add(id);
  renderFindings();
  renderOverlay();
}

function formatReviewerObj(rev) {
  if (!rev || !rev.name || !rev.name.trim()) return null;
  const name = rev.name.trim();
  const role = rev.role && rev.role.trim() ? rev.role.trim() : null;
  return role ? name + ' · ' + role : name;
}

function renderReviewer() {
  const rev = state.project ? state.project.reviewer : null;
  const formatted = formatReviewerObj(rev);
  // The reviewer's own name and role are the reviewer's words, never translated.
  const displayVal = formatted ? formatted : t('panel.reviewerUnset');

  const metaNode = $('meta-reviewer');
  if (metaNode) metaNode.textContent = displayVal;

  const currentValNode = $('reviewer-current-val');
  if (currentValNode) currentValNode.textContent = displayVal;

  const boxNode = $('reviewer-status-box');
  if (boxNode) boxNode.dataset.configured = formatted ? 'true' : 'false';

  const changeBtn = $('reviewer-change-btn');
  if (changeBtn) changeBtn.textContent = formatted ? t('panel.changeReviewer') : t('panel.setReviewer');
}

function openReviewerModal(pendingReviewIntent) {
  state.pendingReviewIntent = pendingReviewIntent || null;
  const modal = $('reviewer-modal');
  const rev = state.project ? state.project.reviewer : null;
  $('reviewer-input-name').value = rev && rev.name ? rev.name : '';
  $('reviewer-input-role').value = rev && rev.role ? rev.role : '';
  $('reviewer-modal-note').hidden = true;
  modal.showModal();
  $('reviewer-input-name').focus();
}

async function submitReviewerModal(event) {
  event.preventDefault();
  const name = $('reviewer-input-name').value.trim();
  const role = $('reviewer-input-role').value.trim() || null;
  if (!name) {
    const note = $('reviewer-modal-note');
    note.textContent = 'Reviewer name is required.';
    note.hidden = false;
    return;
  }
  try {
    const payload = await post('/api/reviewer', { name: name, role: role });
    applyWorkspace(payload);
    $('reviewer-modal').close();
    notify('Reviewer identity configured: ' + (formatReviewerObj(state.project ? state.project.reviewer : null) || name) + '.', 'good');
    renderWorkspace();

    if (state.pendingReviewIntent) {
      const intent = state.pendingReviewIntent;
      state.pendingReviewIntent = null;
      if (intent.findingId) {
        await submitReview(intent.findingId, intent.decision);
      } else if (intent.observationId) {
        await submitObservationReview(intent.observationId, intent.decision);
      } else if (intent.ledgerFindingId) {
        await updateFindingState(intent.ledgerFindingId, intent.nextState);
      }
    }
  } catch (error) {
    const note = $('reviewer-modal-note');
    note.textContent = error.message;
    note.hidden = false;
  }
}

// What the open inspection consists of, in the masthead.
function renderCaptureSummary() {
  const open = state.captureIds;
  const node = $('meta-capture');
  if (!node) return;

  if (open.length === 0) {
    node.textContent = state.view === null ? '-' : t('imgs.countZero');
    clear($('meta-capture-list'));
    return;
  }

  const cap = state.maxInspectionImages;
  const atCap = typeof cap === 'number' && open.length >= cap;
  node.textContent = fillText(t(atCap ? 'imgs.countAtCap' : 'imgs.count'), {
    count: open.length,
    max: typeof cap === 'number' ? cap : '',
  });

  const list = $('meta-capture-list');
  clear(list);
  open.forEach((id) => {
    const capture = state.captures.filter((c) => c.id === id)[0];
    const item = el('li', null, capture === undefined ? id : capture.label);
    list.appendChild(item);
  });
}

function renderHeader() {
  renderReviewer();
  const view = state.view;
  if (view === null) return;
  const p = view.provenance;
  // The masthead names the project once, in the project selector.
  setText('meta-zone', view.expected ? view.expected.zone : '-');
  renderCaptureSummary();
  if (state.pipeline === null || state.pipeline === undefined) {
    setText('hdr-model', p.model);
    setText('hdr-reasoner', '-');
  }
  // The pipeline payload names the models but not the provider, so the provider still comes from the session's own provenance.
  setText('hdr-provenance', p.provider);

  // The offline fixture is labelled loudly and permanently.
  const origin = view.inferenceOrigin;
  $('hdr-synth').hidden = origin !== 'DEMO_FIXTURE';
  // A cached answer is a real AI result but NOT a fresh one, so it carries its own badge and the time of the inference behind it.
  $('hdr-cache').hidden = origin !== 'CACHED';
  if (origin === 'CACHED') {
    const when = view.originalInferenceAt;
    $('hdr-cache').textContent = fillText(t('header.cached'), {
      at: when === null || when === undefined
        ? t('header.cachedEarlier')
        : when.replace('T', ' ').slice(0, 19),
    });
  }
  if (origin === 'FRESH' && view.provenance.inferenceExecuted) {
    setText('hdr-provenance', view.provenance.provider + ' — ' + t('header.liveInference'));
  }
}

// The Inspect bay's intro line must describe the CURRENT run state, not the never-inspected default.
function updateInspectIntro() {
  const sub = $('run-sub');
  if (!sub) return;
  const view = state.view;
  if (view === null || view.outcome === 'PENDING') {
    sub.textContent = t('intro.pending');
  } else if (view.outcome === 'FAILED') {
    sub.textContent = t('intro.failed');
  } else if (view.inferenceOrigin === 'CACHED') {
    sub.textContent = t('intro.cached');
  } else {
    sub.textContent = t('intro.fresh');
  }
}

function renderRail() {
  const view = state.view;
  if (view === null) return;
  const c = view.counters;
  const l10n = localized();

  setText('rail-elements', c.totalCounted > 0 ? c.totalCounted : c.elementsDetected);
  setText('rail-attention', c.attentionAreas + c.incompleteAreas);
  setText('rail-findings', view.inspectionFindings.length);
  setText('rail-findings-n', fillText(t('rail.pending'), {
    pending: c.pending,
    verified: c.verified
  }));
  // Confidence is shown as a percentage only when one exists.
  setText('rail-confidence', c.highestConfidence === null ? 'n/a' : Math.round(c.highestConfidence * 100) + '%');
  setText('rail-overall', l10n === null ? view.brief.overall.replace(/_/g, ' ') : l10n.brief.overallLabel);
  $('rail-verdict').dataset.overall = view.brief.overall;
}

function renderBrief() {
  const view = state.view;
  const host = $('brief');
  clear(host);
  if (view === null) return;
  const l10n = localized();
  // The canonical brief lines are English sentences.
  const lines = l10n === null ? view.brief.lines : l10n.brief.lines;
  const leadPrefix = t('brief.overallPrefix').split('{')[0];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const node = el('p', 'brief-line', line);
    if (line.indexOf(leadPrefix) === 0) node.dataset.lead = 'true';
    host.appendChild(node);
  }
  const highestRaw = l10n === null ? view.brief.highestPriority : l10n.brief.highestPriority;
  if (highestRaw !== null) {
    const txHighest = state.lang !== 'en' ? modelTx(highestRaw) : { text: highestRaw, translated: false };
    const highest = txHighest.translated ? txHighest.text : highestRaw;
    host.appendChild(el('p', 'brief-line', fillText(t('brief.highestPriority'), { title: highest })));
  }
  setText('brief-verdict', l10n === null ? view.brief.overall.replace(/_/g, ' ') : l10n.brief.overallLabel);
}

// Placeholder fill, matching the server-side projection exactly.
function fillText(template, params) {
  // Written without regex escapes on purpose.
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (whole, token) => {
    const value = params[token];
    return value === undefined || value === null ? whole : String(value);
  });
}

function renderPriorities() {
  const view = state.view;
  const host = $('priorities');
  clear(host);
  if (view === null) return;
  const l10n = localized();
  const list = l10n === null ? null : l10n.priorities;

  if (view.priorities.length === 0) {
    host.appendChild(el('p', 'empty', t('priority.empty')));
    return;
  }

  view.priorities.forEach((priority, index) => {
    const localizedPriority = list === null ? null : (list[index] || null);
    const rawTitle = localizedPriority === null ? priority.title : localizedPriority.title;
    const txTitle = state.lang !== 'en' ? modelTx(rawTitle) : { text: rawTitle, translated: false };
    const item = el('li', 'prio');
    item.dataset.attention = priority.attention;
    item.appendChild(el('span', 'prio-n', String(priority.rank).padStart(2, '0')));
    const body = el('div');
    body.appendChild(el('p', 'prio-t', txTitle.translated ? txTitle.text : rawTitle));
    body.appendChild(el('p', 'prio-b', localizedPriority === null ? priority.basis : localizedPriority.basis));
    item.appendChild(body);
    item.addEventListener('click', () => openFinding(priority.findingId));
    host.appendChild(item);
  });
}

// REALITY vs EXPECTED, one row per expected item.
function renderComparison() {
  const view = state.view;
  const host = $('comparison');
  if (!host) return;
  clear(host);
  if (view === null) return;
  const l10n = localized();

  if (view.comparison.length === 0) {
    host.appendChild(el('p', 'empty', t('comparison.empty')));
    return;
  }

  view.comparison.forEach((row, index) => {
    const localizedRow = l10n === null ? null : (l10n.comparison[index] || null);
    const item = el('div', 'cmp');
    item.dataset.status = row.status;

    const head = el('div', 'cmp-head');
    head.appendChild(el('span', 'cmp-el', localizedRow === null ? pretty(row.element) : localizedRow.elementLabel));
    head.appendChild(el('span', 'tag cmp-tag', localizedRow === null
      ? row.status.replace(/_/g, ' ')
      : localizedRow.statusLabel));
    item.appendChild(head);

    const grid = el('dl', 'cmp-grid');
    const pair = (label, value) => {
      const row_ = el('div', 'cmp-pair');
      row_.appendChild(el('dt', null, label));
      row_.appendChild(el('dd', null, value));
      grid.appendChild(row_);
    };
    pair(t('comparison.expected'), localizedRow === null ? row.expectedText : localizedRow.expectedText);
    pair(t('comparison.observed'), localizedRow === null ? row.observedText : localizedRow.observedText);
    const difference = localizedRow === null ? row.difference : localizedRow.difference;
    if (difference) pair(t('comparison.difference'), difference);
    const basisNote = localizedRow === null ? null : localizedRow.countBasisNote;
    if (basisNote !== null) pair(t('comparison.countBasis'), basisNote);
    const statusHelp = localizedRow === null
      ? (row.status === 'UNDETERMINED' ? t('comparisonStatus.help.UNDETERMINED') : null)
      : localizedRow.statusHelp;
    if (statusHelp) {
      const help = el('p', 'cmp-help', statusHelp);
      help.dataset.status = 'UNDETERMINED';
      item.appendChild(help);
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
  return el('span', cls, t('status.' + status));
}

// STAGE 2: Nemotron's construction reasoning.
function renderReasoning() {
  const host = $('reason-grid');
  if (!host) return;
  clear(host);
  const view = state.view;
  const stage = $('reason');

  if (view === null) {
    stage.dataset.status = 'UNAVAILABLE';
    $('reason-stage').textContent = t('panel.stageReasoningNotRun');
    $('reason-model').textContent = '-';
    $('reason-lede').textContent = t('reasoning.notRun');
    $('reason-fail').hidden = true;
    $('reason-foot').hidden = true;
    return;
  }

  const r = view.reasoning;
  if (r === undefined || r === null) return;

  if (r.status === 'AVAILABLE') {
    const reasoning = r.reasoning;
    stage.dataset.status = 'AVAILABLE';
    $('reason-stage').textContent = t('reason.stageLabel');
    $('reason-model').textContent = r.model;
    // Presentation-layer translation of Nemotron's English.
    const txSummary = modelTx(reasoning.summary);
    const txWhat = modelTx(reasoning.whatMatters);
    const txRat = modelTx(reasoning.rationale);
    const txRec = modelTx(reasoning.recommendation);
    const txVer = modelTx(reasoning.verification);
    const anyTranslated = txSummary.translated || txWhat.translated
      || txRat.translated || txRec.translated || txVer.translated;
    const showOrigReason = showingOriginal('reason');
    const pick = (orig, tx) => (state.lang !== 'en' && tx.translated && !showOrigReason ? tx.text : orig);
    $('reason-lede').textContent = pick(reasoning.summary, txSummary);

    const rows = [
      [t('reasoning.summary'), pick(reasoning.whatMatters, txWhat)],
      [t('reasoning.rationale'), pick(reasoning.rationale, txRat)],
      [t('reasoning.recommendation'), pick(reasoning.recommendation, txRec)],
      [t('reasoning.verification'), pick(reasoning.verification, txVer)],
    ];
    for (const [label, value] of rows) appendDetail(host, label, label, value);

    // Translation honesty bar: what is shown, and a way back to the original.
    if (state.lang !== 'en') {
      const bar = el('div', 'tr-bar');
      if (anyTranslated && !showOrigReason) {
        bar.appendChild(el('span', 'tr-badge', t('tr.translatedBadge')));
        bar.appendChild(trToggle('reason', false));
      } else if (anyTranslated && showOrigReason) {
        bar.appendChild(el('span', 'tr-badge', t('lang.sourceEnglish')));
        bar.appendChild(trToggle('reason', true));
      } else {
        bar.appendChild(el('span', 'tr-fallback', t('tr.fallbackNote')));
      }
      host.appendChild(bar);
    }

    const certainty = el('div', 'reason-certainty');
    certainty.appendChild(el('span', 'reason-certainty-k', t('reasoning.certainty')));
    const chip = el('span', 'chip');
    chip.dataset.certainty = reasoning.certainty;
    chip.textContent = t('certainty.' + reasoning.certainty);
    certainty.appendChild(chip);
    if (reasoning.confidence !== null && reasoning.confidence !== undefined) {
      certainty.appendChild(el('span', 'reason-certainty-n',
        fillText(t('reasoning.modelStated'), { value: reasoning.confidence.toFixed(2) })));
    } else {
      certainty.appendChild(el('span', 'reason-certainty-n', t('reason.noConfidence')));
    }
    host.appendChild(certainty);

    $('reason-fail').hidden = true;

    // Provenance foot: what was actually read, and whether it merely paraphrased.
    const p = r.provenance;
    const foot = $('reason-foot');
    foot.hidden = false;
    const cached = state.view !== null && state.view.inferenceOrigin === 'CACHED';
    foot.textContent = fillText(t('reason.footPrefix'), {
      detections: p.detectionsConsidered,
      rows: p.rowsConsidered,
    }) + (cached ? t('reason.footCached') : fillText(t('reason.footLive'), { ms: p.latencyMs }))
      + '. ' + (p.degenerate ? t('reasoning.degenerate') : t('reasoning.additional'));
    return;
  }

  // Unavailable. Say why, and say that the stages below are unaffected.
  stage.dataset.status = 'UNAVAILABLE';
  $('reason-stage').textContent = r.failureKind === null
    ? t('panel.stageReasoningNotRun')
    : t('reason.unavailableHead');
  $('reason-model').textContent = r.model === 'none' ? '-' : r.model;
  $('reason-lede').textContent = r.message === null
    ? t('reason.noneProduced')
    : r.message;

  const fail = $('reason-fail');
  fail.hidden = false;
  clear(fail);
  fail.appendChild(el('p', 'reason-fail-h', t('reason.unavailableHead')));
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
  fail.appendChild(el('p', 'reason-fail-foot', t('reasoning.foot')));

  $('reason-foot').hidden = true;
}

// The pipeline strip: which model did what, on this run.
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
    set('pipe-vision-note', t('pipe.notRun'));
    // A reference can be loaded without a run having happened.
    set('pipe-compare-note', t('pipe.awaitingInspection'));
    set('pipe-reason-note', t('pipe.notRun'));
    set('pipe-verify-note', t('pipe.nothingVerified'));
    updateInspectIntro();
    return;
  }

  const p = view.provenance;
  const r = view.reasoning;

  // 01 SEE Partial is checked BEFORE the outcome, deliberately.
  const partial = view.failure !== null && view.failure.kind === 'PARTIAL_ANALYSIS';
  const failed = view.outcome === 'FAILED' && !partial;
  step1.dataset.state = partial ? 'partial' : failed ? 'fail' : 'done';
  set('pipe-vision-model', p.model);
  set('pipe-vision-note',
    failed
      ? fillText(t('pipe.didNotComplete'), {
          kind: view.failure !== null ? view.failure.kind.toLowerCase().replace(/_/g, ' ') : t('fail.error')
        })
      : partial
        ? fillText(t('pipe.partial'), (function () {
            // Counted from the images themselves rather than derived from the open group: subtracting failures from a.
            const images = Array.isArray(view.images) ? view.images : [];
            return {
              analysed: images.filter((i) => i.status !== 'FAILED').length,
              total: images.length,
            };
          })())
      : view.isDemoFixture
        ? t('pipe.syntheticFixture')
        : view.inferenceOrigin === 'CACHED'
          ? t('pipe.restoredResult')
          : fillText(t('pipe.visionCounts'), {
              elements: view.detections.length,
              observations: view.observations.length,
              ms: p.latencyMs,
            }));

  // 02 COMPARE — ours, in code. Never attributed to a model.
  const matched = view.comparison.filter((r2) => r2.status === 'MATCH').length;
  const attention = view.comparison.filter((r2) => r2.status === 'ATTENTION').length;
  const undetermined = view.comparison.filter((r2) => r2.status === 'UNDETERMINED').length;
  step2.dataset.state = view.comparison.length > 0 ? 'done' : 'idle';
  set('pipe-compare-model', t('pipe.compareEngine'));
  set('pipe-compare-note', view.comparison.length === 0
    ? t('pipe.noExpectedState')
    : fillText(t('pipe.compareCounts'), { matched, attention, undetermined }));

  // 03 UNDERSTAND
  if (r === undefined || r === null) {
    step3.dataset.state = 'idle';
    set('pipe-reason-note', t('pipe.notRun'));
  } else if (r.status === 'AVAILABLE') {
    step3.dataset.state = 'done';
    set('pipe-reason-model', r.model);
    set('pipe-reason-note',
      t('certainty.' + r.reasoning.certainty)
      + (r.provenance && r.provenance.degenerate ? ' — ' + t('pipe.degenerate') : ''));
  } else {
    step3.dataset.state = 'fail';
    set('pipe-reason-model', r.model === 'none' ? '-' : r.model);
    set('pipe-reason-note', r.failureKind === null || r.failureKind === 'DISABLED'
      ? t('pipe.notRun')
      : describeFailure(r.failureKind, r.failureKind));
  }

  // 04 VERIFY
  const counters = view.counters;
  const obsVerified = Array.isArray(view.observations)
    ? view.observations.filter((o) => o.verificationStatus === 'VERIFIED').length
    : 0;
  const obsRejected = Array.isArray(view.observations)
    ? view.observations.filter((o) => o.verificationStatus === 'REJECTED').length
    : 0;
  const totalVerified = counters.verified + obsVerified;
  const totalRejected = counters.rejected + obsRejected;
  step4.dataset.state = totalVerified > 0 ? 'done' : (counters.pending > 0 ? 'wait' : 'idle');
  set('pipe-verify-note',
    totalVerified === 0 && totalRejected === 0
      ? fillText(t('pipe.verifyPending'), { n: counters.pending })
      : fillText(t('pipe.verifyCounts'), {
          verified: totalVerified,
          rejected: totalRejected,
        }));

  updateInspectIntro();
}

// A definition row inside the finding detail.
function detailRow(key, label, value) {
  if (value === null || value === undefined || value === '') return null;
  const row = el('div', 'fc-row');
  row.dataset.k = key;
  row.appendChild(el('dt', null, label));
  row.appendChild(el('dd', null, value));
  return row;
}

// Append a detail row only when there is one. Never throws.
function appendDetail(parent, key, label, value) {
  const row = detailRow(key, label, value);
  if (row !== null) parent.appendChild(row);
  return row;
}

// Render the finding cards: WHAT / WHERE / WHY / EVIDENCE / CONFIDENCE / RECOMMENDED ACTION / VERIFICATION.
function renderFindings() {
  const view = state.view;
  const host = $('findings-cards');
  clear(host);
  if (view === null) return;
  const l10n = localized();

  if (state.referenceInvalidated && view.outcome === 'PENDING') {
    const invProject = state.referenceInvalidated.project || (state.project ? state.project.name : '');
    const invCount = typeof state.referenceInvalidated.count === 'number' ? state.referenceInvalidated.count : 0;
    const banner = el('div', 'ref-invalidated-banner', fillText(t('ref.invalidatedNotice'), {
      project: invProject,
      count: invCount,
    }));
    banner.dataset.invalidated = 'true';
    host.appendChild(banner);
  }

  const list = view.inspectionFindings;
  if (list.length === 0) {
    host.appendChild(el('p', 'empty', t('finding.empty')));
    return;
  }

  list.forEach((finding, index) => {
    // The canonical finding drives behaviour.
    const f = l10n === null ? null : (l10n.findings[index] || null);
    const open = state.openIds.has(finding.id) || state.activeId === finding.id;
    const card = el('article', 'finding-card');
    card.dataset.findingId = finding.id;
    card.dataset.open = String(open);
    card.dataset.status = finding.verificationStatus;
    if (state.activeId === finding.id) card.dataset.active = 'true';

    const head = el('div', 'fc-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(open));
    head.appendChild(el('span', 'fc-id', String(index + 1).padStart(2, '0')));
    // AI-origin titles are model English.
    const fndKey = 'fnd:' + finding.id;
    const fndShowOrig = showingOriginal(fndKey);
    const isAiFinding = finding.origin !== 'COMPARISON';
    const txTitle = isAiFinding ? modelTx(finding.title) : { text: '', translated: false };
    head.appendChild(el('span', 'fc-title',
      f === null ? finding.title
        : isAiFinding && state.lang !== 'en' && txTitle.translated && !fndShowOrig ? txTitle.text
        : isAiFinding && state.lang !== 'en' && fndShowOrig ? finding.title
        : f.title));

    const tail = el('div', 'fc-tail');
    tail.appendChild(el('span', 'tag tag-ai', f === null
      ? (finding.origin === 'COMPARISON' ? t('finding.origin.comparison') : t('finding.origin.visual'))
      : f.originLabel));
    if (finding.severity !== 'INFO') {
      tail.appendChild(el('span', 'tag tag-attention', f === null ? finding.severity : f.severityLabel));
    }
    tail.appendChild(statusTag(finding.verificationStatus));
    if (finding.evidenceState) {
      const evTag = el('span', 'tag tag-evstate', t('evidenceState.' + finding.evidenceState));
      evTag.dataset.evidenceState = finding.evidenceState;
      tail.appendChild(evTag);
    }
    head.appendChild(tail);

    const toggle = () => {
      const wasOpen = state.openIds.has(finding.id) || state.activeId === finding.id;
      if (wasOpen) {
        state.openIds.delete(finding.id);
        if (state.activeId === finding.id) state.activeId = null;
      } else {
        state.openIds.add(finding.id);
        state.activeId = finding.id;
      }
      renderFindings();
      renderOverlay();
      if (typeof host.querySelector === 'function') {
        const nextHead = host.querySelector('.finding-card[data-finding-id="' + finding.id + '"] .fc-head');
        if (nextHead && typeof nextHead.focus === 'function') nextHead.focus();
      }
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
    // For AI-origin findings the WHAT/WHERE/WHY/EVIDENCE/ACTION are model English.
    const pickFnd = (orig) => {
      if (!isAiFinding || state.lang === 'en') return orig;
      const tx = modelTx(orig);
      if (!tx.translated) return orig;
      return fndShowOrig ? orig : tx.text;
    };
    const aiWhat = isAiFinding ? pickFnd(finding.observation) : (f === null ? finding.observation : f.what);
    const aiWhy = isAiFinding ? pickFnd(finding.reason) : (f === null ? finding.reason : f.reason);
    const aiEvidence = isAiFinding ? pickFnd(finding.evidence) : (f === null ? finding.evidence : f.evidence);
    const aiAction = isAiFinding ? pickFnd(finding.recommendation) : (f === null ? finding.recommendation : f.recommendation);
    const aiLocationRaw = f === null ? finding.location : (isAiFinding ? finding.location : f.where);
    const aiLocation = isAiFinding && aiLocationRaw !== null ? pickFnd(aiLocationRaw) : (f === null ? finding.location : f.where);
    appendDetail(body, 'what', t('finding.what'), aiWhat);
    appendDetail(body, 'where', t('finding.where'), aiLocation !== null
      ? aiLocation + (finding.element !== null ? ' (' + t('element.' + finding.element) + ')' : '')
      : null);
    appendDetail(body, 'why', t('finding.why'), aiWhy);
    appendDetail(body, 'expected', t('finding.expected'), f === null ? finding.expected : f.expected);
    appendDetail(body, 'difference', t('finding.difference'), f === null ? finding.difference : f.difference);

    // Confidence is labelled as model confidence in the visual reading, never as a measurement confidence.
    const confidenceRow = el('div', 'fc-row');
    confidenceRow.dataset.k = 'confidence';
    confidenceRow.appendChild(el('dt', null, t('finding.confidence')));
    const cd = el('dd');
    const track = el('span', 'conf-track');
    const fill = el('i', 'conf-fill');
    fill.style.width = Math.round(finding.confidence * 100) + '%';
    fill.dataset.band = band(finding.confidence);
    track.appendChild(fill);
    cd.appendChild(track);
    cd.appendChild(document.createTextNode(
      Math.round(finding.confidence * 100) + '% - ' + t('finding.confidenceNote')
    ));
    confidenceRow.appendChild(cd);
    body.appendChild(confidenceRow);

    appendDetail(body, 'action', t('finding.action'), aiAction);
    appendDetail(body, 'evidence', t('finding.evidence'), aiEvidence);

    // Evidence states exactly what the image supports, and no more.
    const evidenceNote = f === null
      ? (finding.evidenceState === 'FULL_FRAME'
        ? t('finding.evidence.fullFrame')
        : finding.evidenceState === 'NONE'
          ? t('finding.evidence.none')
          : null)
      : f.evidenceNote;
    const evidenceNoteHead = f === null
      ? (finding.evidenceState === 'FULL_FRAME'
        ? t('finding.evidence.headFullFrame')
        : finding.evidenceState === 'NONE'
          ? t('finding.evidence.headNone')
          : '')
      : (f.evidenceNoteHead || '');
    const evidenceHelp = f === null
      ? (finding.evidenceState === 'LOCALIZED'
        ? t('evidenceState.help.LOCALIZED')
        : finding.evidenceState === 'FULL_FRAME'
          ? t('evidenceState.help.FULL_FRAME')
          : t('evidenceState.help.NONE'))
      : f.evidenceStateHelp;
    const evidenceWhy = f === null
      ? (finding.evidenceState === 'LOCALIZED'
        ? t('evidenceState.why.LOCALIZED')
        : finding.evidenceState === 'FULL_FRAME'
          ? t('evidenceState.why.FULL_FRAME')
          : t('evidenceState.why.NONE'))
      : f.evidenceStateWhy;
    if (evidenceNote !== null) {
      const note = el('p', 'fc-noev');
      note.dataset.state = finding.evidenceState;
      note.appendChild(el('b', null, evidenceNoteHead + ' '));
      note.appendChild(document.createTextNode(evidenceNote));
      body.appendChild(note);
    }
    if (evidenceHelp) {
      const help = el('p', 'fc-evhelp');
      help.appendChild(el('b', null, evidenceWhy + ' '));
      help.appendChild(document.createTextNode(evidenceHelp));
      body.appendChild(help);
      help.setAttribute('role', 'note');
    }

    // Translation honesty for model-authored findings.
    if (f !== null && !f.translated && isAiFinding && state.lang !== 'en') {
      const txs = [modelTx(finding.title), modelTx(finding.observation),
        modelTx(finding.reason), modelTx(finding.evidence), modelTx(finding.recommendation)];
      const anyTx = txs.some((x) => x.translated);
      const bar = el('p', 'fc-source');
      if (anyTx && !fndShowOrig) {
        bar.appendChild(el('span', null, t('tr.translatedBadge') + ' '));
        bar.appendChild(trToggle(fndKey, false));
      } else if (anyTx && fndShowOrig) {
        bar.appendChild(el('span', null, t('lang.sourceEnglish') + ' '));
        bar.appendChild(trToggle(fndKey, true));
      } else {
        bar.appendChild(el('span', null, t('tr.fallbackNote')));
      }
      body.appendChild(bar);
    } else if (f !== null && !f.translated) {
      const note = el('p', 'fc-source');
      note.appendChild(el('span', null, t('lang.sourceEnglish')));
      body.appendChild(note);
    }

    body.appendChild(buildVerification(finding));
    card.appendChild(body);
    host.appendChild(card);
  });
}

// The human-in-the-loop control.
function buildVerification(finding) {
  const pct = Math.round(finding.confidence * 100);
  if (finding.verificationStatus !== 'UNVERIFIED') {
    const settled = el('div', 'fc-settled');
    settled.dataset.status = finding.verificationStatus;
    settled.appendChild(el('span', null,
      fillText(t('finding.settledPrefix'), { status: t('status.' + finding.verificationStatus) })));
    if (finding.review) {
      settled.appendChild(el('span', null,
        fillText(t('finding.settledBy'), {
          reviewer: finding.review.reviewer,
          at: finding.review.reviewedAt.replace('T', ' ').slice(0, 19)
        })));
      // A reviewer's own note is their words, in the language they wrote them. It is never translated.
      if (finding.review.note) settled.appendChild(el('span', null, '"' + finding.review.note + '"'));
    }
    return settled;
  }

  const acts = el('div', 'fc-acts');
  acts.appendChild(el('span', 'fc-acts-lbl', fillText(t('finding.aiPrefix'), { pct })));

  const decisions = [
    ['VERIFIED', t('finding.confirm'), 'btn btn-verify'],
    ['REJECTED', t('finding.reject'), 'btn btn-reject'],
    ['NEEDS_REVIEW', t('finding.needsReview'), 'btn']
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

// Map a review decision enum to its localized past-tense label.
function decisionWord(decision) {
  return decision === 'VERIFIED' ? 'confirmed' : decision === 'REJECTED' ? 'rejected' : 'deferred';
}

async function submitReview(findingId, decision) {
  const currentReviewer = formatReviewerObj(state.project ? state.project.reviewer : null);
  if (!currentReviewer) {
    notify(t('review.reviewerMissingFinding'), 'bad');
    openReviewerModal({ findingId: findingId, decision: decision });
    return;
  }
  try {
    state.view = await post('/api/review-finding', {
      findingId: findingId,
      decision: decision,
      reviewer: currentReviewer,
      note: $('note').value.trim() || null
    });
    renderAll();
    notify(fillText(t('review.recorded'), {
      status: t('review.' + decisionWord(decision)),
      reviewer: currentReviewer,
    }), decision === 'REJECTED' ? 'bad' : 'good');
    setLamp('done', t('review.lampRecorded'));
  } catch (error) {
    notify(error.message, 'bad');
  }
}

// The NVIDIA verdict, and the two model stages behind it.
function renderQualification() {
  const host = $('qualification');
  if (host === null) return;
  const view = state.view;
  const e = view !== null && view !== undefined ? view.pipelineEligibility : null;
  const l10n = localized();
  const list = $('qual-stages');
  if (list !== null) clear(list);

  if (e === null || e === undefined) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.dataset.requirement = e.nvidiaRequirement;

  // The verdict is the headline because it answers the question a judge actually asks.
  const verdict = $('qual-verdict');
  if (verdict !== null) {
    verdict.textContent = e.nvidiaRequirement === 'MET'
      ? t('qual.met')
      : e.nvidiaRequirement === 'PARTIAL' ? t('qual.partial') : t('qual.notMet');
  }

  // Which shape the pipeline took.
  const subtitle = $('qual-subtitle');
  if (subtitle !== null) {
    subtitle.textContent = e.vision !== 'ELIGIBLE' && e.reasoning === 'ELIGIBLE'
      ? t('qual.hybrid')
      : t('qual.pipeline');
  }

  if (list === null) return;

  // The localized projection carries the same roles and notes in the selected language.
  const stageRole = (index, fallback) => {
    if (l10n !== null && l10n.qualification !== null) {
      const row = l10n.qualification.stages[index];
      if (row !== undefined && row !== null) return row.role;
    }
    return fallback;
  };

  const rows = [
    {
      key: 'vision',
      model: view.provenance.model,
      cls: e.vision,
      role: stageRole(0, e.stages.length > 0 ? e.stages[0].role : null),
    },
    {
      key: 'reasoning',
      model: view.reasoning !== null && view.reasoning !== undefined
        ? view.reasoning.model
        : null,
      cls: e.reasoning,
      role: stageRole(1, e.stages.length > 1 ? e.stages[1].role : null),
    },
    {
      key: 'platform',
      model: e.platform,
      cls: e.platform === null || e.platform === undefined ? null : 'ELIGIBLE',
      role: null,
    },
  ];

  for (const row of rows) {
    const item = el('li', 'qual-row');
    item.appendChild(el('span', 'qual-row-k', t('qual.row.' + row.key)));
    // A model id or platform name is a technical Latin run: isolated so the bidirectional algorithm cannot reorder it inside Arabic text.
    const modelNode = el('code', 'qual-row-model',
      row.model === null || row.model === undefined || row.model === ''
        ? t('qual.unavailable')
        : String(row.model));
    if (row.model !== null && row.model !== undefined && row.model !== '') {
      modelNode.setAttribute('data-latin', '');
    }
    item.appendChild(modelNode);

    // Fail-closed: only an explicit ELIGIBLE carries the positive tone, and an UNKNOWN never borrows the tone of a stage.
    const tone = row.cls === 'ELIGIBLE' ? 'ok' : row.cls === 'NOT_ELIGIBLE' ? 'no' : 'unknown';
    let tagText = t('qual.tag.' + row.key);
    if (row.key === 'platform') {
      tagText = row.cls === 'ELIGIBLE' ? t('qual.tag.platform') : t('qual.tag.platform.not');
    } else if (row.role !== null && row.role !== undefined && row.role !== '') {
      tagText = fillText(t('qual.tag.' + row.key + (row.cls === 'ELIGIBLE' ? '' : '.not')), {
        role: row.role,
      });
    }
    item.appendChild(el('span', 'qual-tag qual-tag-' + tone, tagText));
    list.appendChild(item);
  }

  // The end-to-end path, stated once, for whoever is reading the page as proof.
  const path = $('qual-path');
  if (path !== null) path.textContent = e.qualificationPath;
}

// The colour class for a stage's classification.
function tagTone(cls) {
  if (cls === 'ELIGIBLE') return 'ok';
  if (cls === 'NOT_ELIGIBLE') return 'no';
  return 'unknown';
}

// Provenance and eligibility: which engine actually ran, always.
function renderBasis() {
  const host = $('basis-list');
  const badge = $('basis-n');
  if (!host) return;
  clear(host);

  const view = state.view;
  const images = view !== null && Array.isArray(view.images) ? view.images : [];
  const open = state.captureIds.length;
  const analysed = images.filter((image) => image.status !== 'FAILED');
  const failed = images.filter((image) => image.status === 'FAILED');

  if (badge) {
    badge.textContent = open > 0
      ? fillText(t('imgs.count'), { count: open })
      : t('imgs.countZero');
  }
  if (images.length === 0) {
    host.appendChild(el('li', 'basis-empty', t('imgs.basisPending')));
    return;
  }

  for (const image of images) {
    const ok = image.status !== 'FAILED';
    const item = el('li', 'basis-item' + (ok ? '' : ' basis-item-failed'));
    item.appendChild(el('span', 'basis-dot', ok ? t('imgs.status.done') : t('imgs.status.failed')));
    item.appendChild(el('span', 'basis-name', image.captureLabel || image.captureId));
    // The observations array is absent on a restored or older payload, so the count is shown only when the server actually sent one.
    const observed = Array.isArray(image.observations) ? image.observations.length : null;
    if (observed !== null && observed > 0) {
      item.appendChild(el('span', 'basis-n', fillText(t('imgs.obsCount'), { count: observed })));
    }
    if (!ok && image.failure) {
      item.appendChild(el('span', 'basis-fail', image.failure));
    }
    host.appendChild(item);
  }
  if (failed.length > 0) {
    host.appendChild(el('li', 'basis-warn',
      fillText(t('imgs.basisPartial'), { analysed: analysed.length, failed: failed.length })));
  }
}

function renderProvenance() {
  const view = state.view;
  const host = $('provenance');
  const failHost = $('failures');
  clear(host);
  clear(failHost);
  renderBasis();
  // Rendered before the early return so a cleared view cannot leave a stale verdict on screen.
  renderQualification();
  if (view === null) return;

  const p = view.provenance;
  // A restored result is real but was NOT re-run, so "inference executed: yes" plus "0 ms" would read as a broken live call.
  const restored = view.inferenceOrigin === 'CACHED';
  const persistFailed = view.persistence !== undefined && view.persistence !== null
    && view.persistence.written === false;
  const persistValue = persistFailed
    ? t('prov.persistFailed') + (view.persistence.message ? ' (' + view.persistence.message + ')' : '')
    : state.storage && state.storage.durable === true
      ? t('prov.persistDurable')
      : state.storage && state.storage.durable === false
        ? t('prov.persistMemory')
        : t('storage.unknown');
  // Every VALUE here is canonical: the provider name, the model id, the counts, the latency and the timestamp are the.
  const rows = [
    [t('prov.provider'), p.provider],
    [t('prov.model'), p.model],
    [t('prov.inferenceExecuted'), restored
      ? t('prov.restored')
      : (p.inferenceExecuted ? t('prov.yes') : t('prov.no'))],
    [t('prov.elementsDetected'), view.detections.length],
    [t('prov.observationsAccepted'), p.observationsAccepted],
    [t('prov.observationsRejected'), p.observationsRejected],
    [t('prov.latency'), restored ? t('prov.notRerun') : p.latencyMs + ' ms'],
    [t('prov.capturedAt'), p.inspectedAt.replace('T', ' ').slice(0, 19)],
    [t('prov.humanReview'), p.humanReviewPerformed ? t('prov.yes') : t('prov.no')],
    [t('prov.persistence'), persistValue]
  ];
  for (const row of rows) {
    const cell = el('div');
    cell.appendChild(el('dt', null, row[0]));
    cell.appendChild(el('dd', null, row[1]));
    host.appendChild(cell);
  }

  // Geometry facts. A re-oriented photograph is disclosed, never silently fixed.
  const geom = $('geometry-note');
  if (geom !== null && view.geometry !== undefined) {
    const g = view.geometry;
    if (g.geometryNormalized && g.exifOrientation !== 1) {
      geom.hidden = false;
      geom.textContent = fillText(t('prov.geometry'), { n: g.exifOrientation });
    } else if (g.storedWidth !== null && g.displayedWidth !== null
      && g.storedWidth !== g.displayedWidth) {
      geom.hidden = false;
      geom.textContent = fillText(t('prov.geometryStored'), {
        sw: g.storedWidth, sh: g.storedHeight,
        dw: g.displayedWidth, dh: g.displayedHeight,
      });
    } else {
      geom.hidden = true;
    }
  }

  if (persistFailed) {
    const pBox = el('div', 'fail');
    pBox.dataset.status = 'PERSISTENCE_FAILED';
    pBox.appendChild(el('p', 'fail-h', t('prov.persistFailedHead')));
    pBox.appendChild(el('p', null, t('prov.persistFailed')
      + (view.persistence.message ? ' — ' + view.persistence.message : '')));
    failHost.appendChild(pBox);
  }

  if (view.failure !== null) {
    const box = el('div', 'fail');
    if (view.failure.kind === 'PARTIAL_ANALYSIS') {
      // A partial run is not a failed run.
      box.dataset.status = 'PARTIAL';
      box.appendChild(el('p', 'fail-h', t('prov.partialHead')));
      box.appendChild(el('p', null, view.failure.message));
    } else {
      box.appendChild(el('p', 'fail-h', fillText(t('prov.failedHead'), { kind: view.failure.kind })));
      box.appendChild(el('p', null, describeFailure(view.failure.kind, view.failure.message)));
    }
    failHost.appendChild(box);
  }

  if (p.rejectionIssues.length > 0) {
    const box = el('div', 'fail');
    box.appendChild(el('p', 'fail-h', fillText(t('prov.rejectedHead'), { n: p.rejectionIssues.length })));
    const list = el('ul');
    for (const issue of p.rejectionIssues.slice(0, 8)) {
      // The FIELD NAME is a machine identifier and stays verbatim; the message is a validator sentence and follows the language.
      list.appendChild(el('li', null, issue.field + ': ' + issue.message));
    }
    box.appendChild(list);
    failHost.appendChild(box);
  }
}

// Render the Verified-Finding Ledger (view.findings) and the raw visual observations (view.observations) that feed it.
function renderObservations() {
  const host = $('findings');
  clear(host);
  const view = state.view;
  if (view === null) return;

  if (state.referenceInvalidated && view.outcome === 'PENDING') {
    const invProject = state.referenceInvalidated.project || (state.project ? state.project.name : '');
    const invCount = typeof state.referenceInvalidated.count === 'number' ? state.referenceInvalidated.count : 0;
    const banner = el('div', 'ref-invalidated-banner', fillText(t('ref.invalidatedNotice'), {
      project: invProject,
      count: invCount,
    }));
    banner.dataset.invalidated = 'true';
    host.appendChild(banner);
  }

  const activeProjectId = state.project ? state.project.id : null;
  const openCaptures = Array.isArray(state.captureIds) && state.captureIds.length > 0
    ? state.captureIds
    : (state.currentCaptureId
      ? [state.currentCaptureId]
      : (view.provenance && view.provenance.captureId ? [view.provenance.captureId] : []));

  const rawLedger = Array.isArray(view.findings) ? view.findings : [];
  // Scope guard: only display ledger findings owned by the active project and within the open capture selection.
  const ledgerFindings = rawLedger.filter((item) => {
    if (!item || typeof item.id !== 'string') return false;
    if (activeProjectId !== null && item.projectId && item.projectId !== activeProjectId) return false;
    if (openCaptures.length > 0 && item.captureId && !openCaptures.includes(item.captureId)) return false;
    return true;
  });

  const ledgerByObsId = {};
  for (const item of ledgerFindings) {
    if (item.sourceObservationId) {
      ledgerByObsId[item.sourceObservationId] = item;
    }
  }

  const ledgerSection = el('section', 'ledger-section');
  ledgerSection.id = 'ledger-section';
  const ledgerBar = el('div', 'ledger-bar');
  ledgerBar.appendChild(el('p', 'ledger-title', t('ledger.heading')));

  const openCount = ledgerFindings.filter((f) => f.state === 'OPEN').length;
  const ackCount = ledgerFindings.filter((f) => f.state === 'ACKNOWLEDGED').length;
  const closedCount = ledgerFindings.filter((f) => f.state === 'CLOSED').length;
  const countsBadge = el('span', 'ledger-counts', fillText(t('ledger.counts'), {
    total: ledgerFindings.length,
    open: openCount,
    acknowledged: ackCount,
    closed: closedCount,
  }));
  countsBadge.id = 'ledger-counts';
  ledgerBar.appendChild(countsBadge);
  ledgerSection.appendChild(ledgerBar);
  ledgerSection.appendChild(el('p', 'ledger-sub', t('ledger.subtitle')));

  if (ledgerFindings.length === 0) {
    const emptyLedger = el('p', 'empty', t('ledger.empty'));
    emptyLedger.id = 'ledger-empty';
    ledgerSection.appendChild(emptyLedger);
  } else {
    const ledgerList = el('div', 'ledger-list');
    ledgerList.id = 'ledger-list';

    ledgerFindings.forEach((ledgerItem) => {
      const card = el('article', 'finding ledger-card');
      card.dataset.ledgerFindingId = ledgerItem.id;
      card.dataset.findingState = ledgerItem.state;
      card.dataset.projectId = ledgerItem.projectId || '';
      card.dataset.captureId = ledgerItem.captureId || '';
      card.dataset.observationId = ledgerItem.sourceObservationId || '';

      const head = el('div', 'finding-head');
      const idBadge = el('span', 'finding-id', fillText(t('ledger.idBadge'), { id: ledgerItem.id }));
      idBadge.setAttribute('data-latin', '');
      head.appendChild(idBadge);
      head.appendChild(el('span', 'obs-cat', ledgerItem.category));
      head.appendChild(el('span', 'tag', t('severity.' + ledgerItem.severity)));

      const stateTag = el(
        'span',
        'tag ledger-state-tag ledger-state-' + String(ledgerItem.state).toLowerCase(),
        t('ledger.state.' + ledgerItem.state),
      );
      stateTag.dataset.state = ledgerItem.state;
      head.appendChild(stateTag);
      card.appendChild(head);

      const ledKey = 'led:' + ledgerItem.id;
      const ledShowOrig = showingOriginal(ledKey);
      const txSum = modelTx(ledgerItem.summary);
      const summaryText = state.lang !== 'en' && txSum.translated && !ledShowOrig
        ? txSum.text
        : ledgerItem.summary;
      card.appendChild(el('p', 'finding-summary', summaryText));

      const matchedObs = view.observations.filter((o) => o.id === ledgerItem.sourceObservationId)[0] || null;
      const captureObj = state.captures.filter((c) => c.id === ledgerItem.captureId)[0] || null;
      const captureLabel = captureObj
        ? captureObj.label
        : (matchedObs && matchedObs.captureLabel
          ? matchedObs.captureLabel
          : (view.provenance && view.provenance.captureId === ledgerItem.captureId
            ? view.provenance.captureLabel
            : ledgerItem.captureId));
      const projectLabel = state.project && state.project.id === ledgerItem.projectId
        ? state.project.name
        : ledgerItem.projectId;
      const zoneLabel = ledgerItem.zoneId || (view.expected ? view.expected.zone : '-');

      const meta = el('div', 'ledger-meta-grid');
      meta.appendChild(el('p', 'ledger-meta-line', fillText(t('ledger.scope'), {
        project: projectLabel,
        capture: captureLabel,
        zone: zoneLabel,
      })));

      let sourceDesc = fillText(t('ledger.sourceObs'), { id: ledgerItem.sourceObservationId });
      const rawEvDesc = ledgerItem.evidenceDescription || (matchedObs && matchedObs.evidenceDescription) || '';
      if (rawEvDesc) {
        const txMatchedEv = modelTx(rawEvDesc);
        const matchedEvText = state.lang !== 'en' && txMatchedEv.translated && !ledShowOrig
          ? txMatchedEv.text
          : rawEvDesc;
        sourceDesc += ' — ' + matchedEvText;
      }
      meta.appendChild(el('p', 'ledger-meta-line', sourceDesc));
      meta.appendChild(el('p', 'ledger-meta-line', fillText(t('ledger.target'), { target: ledgerItem.target })));
      meta.appendChild(el('p', 'ledger-meta-line', fillText(t('ledger.raisedBy'), {
        reviewer: ledgerItem.raisedBy,
        at: String(ledgerItem.raisedAt || '').replace('T', ' ').slice(0, 19),
      })));
      const reviewNote = ledgerItem.note || (matchedObs && matchedObs.review && matchedObs.review.note) || null;
      if (reviewNote) {
        meta.appendChild(el('p', 'ledger-meta-line', fillText(t('ledger.reviewNote'), { note: reviewNote })));
      }
      card.appendChild(meta);

      const nextAction = el('p', 'ledger-next', t('ledger.next.' + ledgerItem.state));
      nextAction.dataset.state = ledgerItem.state;
      card.appendChild(nextAction);

      const inFlight = state.findingInFlight.has(ledgerItem.id);
      const feedback = state.findingFeedback[ledgerItem.id] || null;
      if (inFlight || feedback !== null) {
        const fbNode = el('p', 'ledger-feedback', inFlight ? t('ledger.saving') : feedback.message);
        fbNode.dataset.tone = inFlight ? 'working' : feedback.tone;
        card.appendChild(fbNode);
      }

      const actions = el('div', 'finding-actions');
      const transitions = ledgerItem.state === 'OPEN'
        ? [
            ['ACKNOWLEDGED', t('ledger.act.acknowledge'), 'btn btn-verify'],
            ['CLOSED', t('ledger.act.close'), 'btn btn-reject'],
          ]
        : ledgerItem.state === 'ACKNOWLEDGED'
          ? [
              ['CLOSED', t('ledger.act.close'), 'btn btn-reject'],
              ['OPEN', t('ledger.act.reopen'), 'btn'],
            ]
          : [
              ['ACKNOWLEDGED', t('ledger.act.acknowledge'), 'btn'],
              ['OPEN', t('ledger.act.reopen'), 'btn'],
            ];

      for (const transition of transitions) {
        const nextState = transition[0];
        const btnLabel = transition[1];
        const btnClass = transition[2];
        const btn = el('button', btnClass, btnLabel);
        btn.type = 'button';
        btn.dataset.nextState = nextState;
        btn.dataset.ledgerFindingId = ledgerItem.id;
        btn.disabled = inFlight;
        btn.addEventListener('click', () => {
          return updateFindingState(ledgerItem.id, nextState);
        });
        actions.appendChild(btn);
      }
      card.appendChild(actions);
      ledgerList.appendChild(card);
    });

    ledgerSection.appendChild(ledgerList);
  }

  host.appendChild(ledgerSection);

  const obsHead = el('p', 'obs-section-title', t('obs.sectionHead'));
  host.appendChild(obsHead);

  if (view.observations.length === 0) {
    host.appendChild(el('p', 'empty', t('obs.empty')));
  }

  view.observations.forEach((observation, index) => {
    const row = el('div', 'obs');
    row.dataset.observationId = observation.id;
    row.dataset.status = observation.verificationStatus;
    row.appendChild(el('span', 'obs-n', String(index + 1).padStart(2, '0')));
    row.appendChild(el('span', 'obs-cat', observation.category));
    row.appendChild(el('span', 'tag', t('severity.' + observation.severity)));
    row.appendChild(statusTag(observation.verificationStatus));

    const linkedFinding = ledgerByObsId[observation.id] || null;
    if (linkedFinding !== null) {
      const raisedTag = el('span', 'tag tag-verify obs-raised', fillText(t('obs.ledgerRaised'), {
        id: linkedFinding.id,
        state: t('ledger.state.' + linkedFinding.state),
      }));
      raisedTag.dataset.ledgerId = linkedFinding.id;
      row.appendChild(raisedTag);
    }

    // Which photograph this observation came from.
    const photo = el('span', 'obs-photo', fillText(t('obs.from'), {
      label: observation.captureLabel || observation.captureId,
    }));
    row.appendChild(photo);

    const conf = el('span', 'conf');
    const track = el('span', 'conf-track');
    const fill = el('i', 'conf-fill');
    fill.style.width = Math.round(observation.confidence * 100) + '%';
    fill.dataset.band = observation.confidenceBand;
    track.appendChild(fill);
    conf.appendChild(track);
    // The band is a qualitative reading of model confidence, not a severity.
    conf.appendChild(el('span', null,
      fillText(t('obs.band'), {
        value: observation.confidence.toFixed(2),
        band: t('severity.' + observation.confidenceBand),
      })));
    row.appendChild(conf);

    // MiniCPM's English with a localized presentation when the memory holds it.
    const obsKey = 'obs:' + observation.id;
    const obsShowOrig = showingOriginal(obsKey);
    const txObs = modelTx(observation.observation);
    const txEv = modelTx(observation.evidenceDescription);
    const obsAnyTx = txObs.translated || txEv.translated;
    const obsText = state.lang !== 'en' && obsAnyTx && !obsShowOrig
      ? (txObs.translated ? txObs.text : observation.observation)
      : observation.observation;
    const evText = state.lang !== 'en' && obsAnyTx && !obsShowOrig
      ? (txEv.translated ? txEv.text : observation.evidenceDescription)
      : observation.evidenceDescription;
    row.appendChild(el('p', 'obs-text', obsText));
    if (state.lang !== 'en' && obsAnyTx && !obsShowOrig) {
      const src = el('p', 'fc-source');
      src.appendChild(el('span', null, t('tr.translatedBadge') + ' '));
      src.appendChild(trToggle(obsKey, false));
      row.appendChild(src);
    } else if (state.lang !== 'en' && obsAnyTx && obsShowOrig) {
      const src = el('p', 'fc-source');
      src.appendChild(el('span', null, t('lang.sourceEnglish') + ' '));
      src.appendChild(trToggle(obsKey, true));
      row.appendChild(src);
    } else if (state.lang !== 'en') {
      row.appendChild(el('p', 'fc-source', t('tr.fallbackNote')));
    } else {
      row.appendChild(el('p', 'fc-source', t('lang.sourceEnglish')));
    }

    const evidence = el('p', 'obs-ev');
    evidence.appendChild(el('b', null, t('finding.evidence') + ' '));
    evidence.appendChild(document.createTextNode(evText));
    if (!observation.localized) {
      evidence.appendChild(el('span', 'obs-ev-full', ' ' + t('obs.fullFrame')));
    }
    row.appendChild(evidence);

    const acts = el('div', 'obs-acts');
    if (observation.suggestedAction !== 'NO_ACTION') {
      acts.appendChild(el('span', 'obs-next',
        fillText(t('obs.next'), { action: t('action.' + observation.suggestedAction) })));
    }
    if (observation.review && observation.review.reviewer) {
      // The reviewer's own words are never translated; only the frame around them.
      acts.appendChild(el('span', 'obs-next', fillText(t('finding.settledBy'), {
        reviewer: observation.review.reviewer,
        at: observation.review.reviewedAt.replace('T', ' ').slice(0, 19),
      })));
    }
    const obsInFlight = state.obsReviewInFlight.has(observation.id);
    for (const decision of ['VERIFIED', 'NEEDS_REVIEW', 'REJECTED']) {
      const label = decision === 'NEEDS_REVIEW'
        ? t('finding.needsReview')
        : decision === 'VERIFIED' ? t('finding.confirm') : t('finding.reject');
      const button = el('button', 'btn', label);
      button.type = 'button';
      button.dataset.decision = decision;
      button.disabled = obsInFlight;
      button.addEventListener('click', () => {
        return submitObservationReview(observation.id, decision);
      });
      acts.appendChild(button);
    }
    row.appendChild(acts);
    host.appendChild(row);
  });
}

async function submitObservationReview(observationId, decision) {
  if (state.obsReviewInFlight.has(observationId)) return;
  const currentReviewer = formatReviewerObj(state.project ? state.project.reviewer : null);
  if (!currentReviewer) {
    notify(t('review.reviewerMissingObservation'), 'bad');
    openReviewerModal({ observationId: observationId, decision: decision });
    return;
  }
  state.obsReviewInFlight.add(observationId);
  renderObservations();
  try {
    state.view = await post('/api/review', {
      observationId: observationId,
      decision: decision,
      reviewer: currentReviewer,
      note: $('note') ? ($('note').value.trim() || null) : null
    });
    state.obsReviewInFlight.delete(observationId);
    renderAll();
    notify(fillText(t('review.recordedObservation'), {
      status: t('review.' + decisionWord(decision)),
      reviewer: currentReviewer,
    }), decision === 'REJECTED' ? 'bad' : 'good');
    setLamp('done', t('review.lampRecorded'));
  } catch (error) {
    state.obsReviewInFlight.delete(observationId);
    renderObservations();
    notify(error.message, 'bad');
  }
}

async function updateFindingState(findingId, nextState) {
  if (state.findingInFlight.has(findingId)) return;
  const view = state.view;
  if (view === null) return;
  const currentReviewer = formatReviewerObj(state.project ? state.project.reviewer : null);
  if (!currentReviewer) {
    notify(t('review.reviewerMissingFinding'), 'bad');
    openReviewerModal({ ledgerFindingId: findingId, nextState: nextState });
    return;
  }

  // Scope guard: refuse to mutate a finding that does not belong to the active project and open capture selection.
  const activeProjectId = state.project ? state.project.id : null;
  const openCaptures = Array.isArray(state.captureIds) && state.captureIds.length > 0
    ? state.captureIds
    : (state.currentCaptureId ? [state.currentCaptureId] : []);
  const existing = (Array.isArray(view.findings) ? view.findings : []).filter((f) => f.id === findingId)[0] || null;
  if (existing === null
    || (activeProjectId !== null && existing.projectId && existing.projectId !== activeProjectId)
    || (openCaptures.length > 0 && existing.captureId && !openCaptures.includes(existing.captureId))) {
    const scopeMsg = t('fail.error') + ': Finding is outside the active project or capture scope.';
    state.findingFeedback[findingId] = { tone: 'bad', message: scopeMsg };
    notify(scopeMsg, 'bad');
    renderObservations();
    return;
  }

  const lastConfirmedState = existing.state;
  state.findingInFlight.add(findingId);
  delete state.findingFeedback[findingId];
  renderObservations();

  try {
    const updatedView = await post('/api/finding-state', {
      findingId: findingId,
      state: nextState,
    });
    state.findingInFlight.delete(findingId);
    state.view = updatedView;

    const confirmed = (Array.isArray(updatedView.findings) ? updatedView.findings : []).filter((f) => f.id === findingId)[0] || null;
    const confirmedState = confirmed ? confirmed.state : nextState;
    const stateLabel = t('ledger.state.' + confirmedState);
    const durable = state.storage && state.storage.durable === true
      && !(updatedView.persistence && updatedView.persistence.written === false);
    const confirmMsg = fillText(t(durable ? 'ledger.savedDurable' : 'ledger.savedMemory'), {
      state: stateLabel,
    });
    state.findingFeedback[findingId] = {
      tone: durable ? 'good' : 'warn',
      message: confirmMsg,
    };
    renderAll();
    notify(confirmMsg, 'good');
    setLamp('done', t('review.lampRecorded'));
  } catch (error) {
    state.findingInFlight.delete(findingId);
    // Preserve last confirmed state and never report the rejected transition as saved.
    if (existing) existing.state = lastConfirmedState;
    const errMsg = t('fail.error') + ': ' + error.message;
    state.findingFeedback[findingId] = {
      tone: 'bad',
      message: errMsg,
    };
    notify(errMsg, 'bad');
    renderObservations();
  }
}

function renderStage() {
  const view = state.view;
  if (view === null) return;
  const p = view.provenance;
  // The photograph on screen is the selected one when the open inspection has several, and the provenance photograph otherwise.
  const shown = state.captureIds.length > 1 && state.evidenceCaptureId !== null
    && state.captureIds.includes(state.evidenceCaptureId)
    ? state.evidenceCaptureId
    : p.captureId;
  if (state.captureIds.length > 1) state.evidenceCaptureId = shown;
  const src = '/api/capture-image/' + encodeURIComponent(shown);
  const image = $('evidence-image');
  if (image.dataset.src !== src) {
    image.dataset.src = src;
    image.src = src;
  }
  // Keep the evidence stage in the same display orientation as the capture stage, so the operator never compares two.
  const capture = state.captures.filter((c) => c.id === shown)[0];
  const flip = capture !== undefined
    ? displayNeedsFlip(capture.exifOrientation)
    : displayNeedsFlip(view.geometry !== undefined ? view.geometry.exifOrientation : 1);
  image.classList.toggle('img-flip180', flip);
  const label = capture === undefined ? p.captureLabel : capture.label;
  const basis = state.captureIds.length > 1
    ? ' (' + fillText(t('imgs.evidenceBasedOn'), { count: state.captureIds.length }) + ')'
    : '';
  $('stage-cap').textContent =
    label + ' - ' + p.imageWidth + 'x' + p.imageHeight + ' - ' + bytes(p.byteLength)
    + ' - ' + p.mediaType + basis;
}

// Run one render step, isolating its failures.
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
  applyLanguage();
  safeRender('storage', renderStorage);
  safeRender('imgs', renderImages);
  safeRender('gate', renderReviewerGate);
  safeRender('captureSummary', renderCaptureSummary);
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
  safeRender('switcher', renderPhotoSwitcher);
  safeRender('overlay', renderOverlay);
  safeRender('outcome', renderRunOutcome);
}

// Re-localize the lamp, status bar, and notice banner after a completed run so applyLanguage() in renderAll() does not.
function renderRunOutcome() {
  const view = state.view;
  if (view === null || view.outcome !== 'COMPLETED' || state.lastRunSecs === null) return;
  const origin = view.inferenceOrigin;
  const how = origin === 'CACHED'
    ? t('origin.cached')
    : origin === 'DEMO_FIXTURE'
      ? t('origin.fixture')
      : t('origin.fresh');
  const secs = state.lastRunSecs;
  const failedImages = Array.isArray(view.images)
    ? view.images.filter((image) => image.status === 'FAILED')
    : [];
  const analysedImages = Array.isArray(view.images)
    ? view.images.filter((image) => image.status !== 'FAILED')
    : [];
  setLamp(
    failedImages.length > 0 ? 'problem' : 'done',
    failedImages.length > 0 ? t('run.partialLamp') : t('run.readyLamp'),
  );
  setStatus(
    fillText(t('run.done'), { how, secs, findings: view.inspectionFindings.length }),
    'good',
  );
  if (failedImages.length > 0) {
    notify(fillText(t('run.partial'), {
      analysed: analysedImages.length,
      failed: failedImages.length,
      names: failedImages.map((image) => image.captureLabel).join(', '),
    }), 'bad');
  }
  const reasoning = view.reasoning;
  const overallText = state.lang === 'en'
    ? view.brief.overall.replace(/_/g, ' ')
    : t('overall.' + view.brief.overall);
  if (reasoning !== undefined && reasoning !== null) {
    if (reasoning.status === 'AVAILABLE') {
      const certaintyText = state.lang === 'en'
        ? reasoning.reasoning.certainty.replace(/_/g, ' ').toLowerCase()
        : t('certainty.' + reasoning.reasoning.certainty);
      notify(
        fillText(t('run.withReasoning'), {
          how,
          overall: overallText,
          certainty: certaintyText,
        }),
        failedImages.length > 0 ? 'bad' : 'good',
      );
    } else {
      notify(
        fillText(t('run.noReasoning'), {
          how,
          overall: overallText,
          kind: reasoning.failureKind || 'not run',
        }),
        failedImages.length > 0 ? 'bad' : 'good',
      );
    }
  } else {
    notify(
      fillText(t('run.plainDone'), { how, overall: overallText }),
      failedImages.length > 0 ? 'bad' : 'good',
    );
  }
  if (view.persistence !== undefined && view.persistence !== null && view.persistence.written === false) {
    setLamp('problem', t('run.persistFailedLamp'));
    const persistWarn = t('prov.persistFailed')
      + (view.persistence.message ? ' — ' + view.persistence.message : '');
    setStatus(persistWarn, 'bad');
    notify(persistWarn, 'bad');
  }
}

// The reviewer gate.
function renderReviewerGate() {
  const banner = $('reviewer-gate');
  if (!banner) return;
  const server = state.reviewerGate;
  // The server's own verdict, not a recomputation here.
  const closed = server !== null && server !== undefined
    ? server.required === true
    : reviewerMissingLocally();
  banner.hidden = !closed;
  const reason = $('reviewer-gate-reason');
  if (reason !== null) {
    // A server-authored reason is canonical system text and is shown verbatim, even when it is not the default sentence the.
    reason.textContent = server !== null && server !== undefined
      && typeof server.reason === 'string' && server.reason.length > 0
      ? server.reason
      : t('gate.reason');
  }
}

// Whether this client copy believes the gate is closed, before any payload.
function reviewerMissingLocally() {
  const project = state.project;
  if (project === null || project === undefined) return false;
  const reviewer = project.reviewer;
  return reviewer === null || reviewer === undefined
    || typeof reviewer.name !== 'string'
    || reviewer.name.trim().length === 0;
}

// Which photograph of the open inspection the evidence stage shows.
function renderPhotoSwitcher() {
  const switcher = $('photo-switcher');
  if (!switcher) return;
  const view = state.view;
  const open = state.captureIds;
  if (view === null || open.length <= 1) {
    switcher.hidden = true;
    return;
  }
  if (state.evidenceCaptureId === null || !open.includes(state.evidenceCaptureId)) {
    state.evidenceCaptureId = view.provenance.captureId;
  }
  const host = $('photo-switcher-tabs');
  host.textContent = '';
  open.forEach((id) => {
    const capture = state.captures.filter((c) => c.id === id)[0];
    const label = capture === undefined ? id : capture.label;
    const tab = el('button', 'photo-tab' + (id === state.evidenceCaptureId ? ' active' : ''), label);
    tab.type = 'button';
    tab.setAttribute('aria-pressed', id === state.evidenceCaptureId ? 'true' : 'false');
    tab.addEventListener('click', () => {
      state.evidenceCaptureId = id;
      safeRender('stage', renderStage);
      safeRender('overlay', renderOverlay);
    });
    host.appendChild(tab);
  });
  switcher.hidden = false;
}

function renderFixtures() {
  const host = $('fixture-list');
  clear(host);
  $('capture-empty').hidden = state.captures.length > 0 || state.project === null;
  // Bulk actions over a single row would be no-ops, so they wait until there is a group to act on.
  $('fixtures-acts').hidden = state.captures.length <= 1;

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

// Render the strip of photographs belonging to the open inspection.
function renderImages() {
  const section = $('imgs');
  if (!section) return;
  const ids = state.captureIds;
  section.hidden = ids.length === 0;
  if (ids.length === 0) return;

  $('imgs-n').textContent = fillText(t('imgs.count'), { count: ids.length });
  const host = $('imgs-list');
  host.textContent = '';

  const outcomes = {};
  if (state.view !== null && Array.isArray(state.view.images)) {
    for (const image of state.view.images) outcomes[image.captureId] = image;
  }

  ids.forEach(function (id, index) {
    const capture = state.captures.filter((c) => c.id === id)[0];
    const outcome = outcomes[id];
    const item = el('li', 'img-item' + (outcome !== undefined && outcome.status === 'FAILED' ? ' img-item-failed' : ''));

    const thumb = el('img', 'img-thumb');
    thumb.src = '/api/capture-image/' + encodeURIComponent(id);
    thumb.alt = capture !== undefined ? capture.label : id;
    thumb.loading = 'lazy';
    item.appendChild(thumb);

    const meta = el('div', 'img-meta');
    meta.appendChild(el('span', 'img-ord', fillText(t('imgs.ordinal'), { index: index + 1 })));
    meta.appendChild(el('span', 'img-label', capture !== undefined ? capture.label : id));
    const statusKey = outcome === undefined
      ? 'imgs.status.ready'
      : (outcome.status === 'FAILED' ? 'imgs.status.failed' : 'imgs.status.done');
    meta.appendChild(el('span', 'img-status img-status-' + statusKey.replace('imgs.status.', ''), t(statusKey)));
    item.appendChild(meta);

    const drop = el('button', 'img-drop', '×');
    drop.type = 'button';
    drop.setAttribute('aria-label', fillText(t('imgs.dropOne'), { label: capture !== undefined ? capture.label : id }));
    drop.addEventListener('click', () => removeCaptureFromGroup(id));
    item.appendChild(drop);

    host.appendChild(item);
  });

  $('imgs-note').textContent = fillText(t('imgs.note'), { count: ids.length });
}

async function removeCaptureFromGroup(captureId) {
  const remaining = state.captureIds.filter((id) => id !== captureId);
  if (remaining.length === 0) return;
  try {
    applyWorkspace(await post('/api/captures/select', { captureIds: remaining }));
    renderAll();
    setLamp('ready', t('imgs.ready'));
  } catch (error) {
    notify(error.message, 'bad');
  }
}

// Open every capture of the project as ONE inspection.
async function selectAllCaptures() {
  if (state.captures.length === 0) return;
  const ids = state.captures.map((capture) => capture.id);
  if (ids.length === state.captureIds.length && ids.every((id) => state.captureIds.includes(id))) {
    notify(t('imgs.allOpen'), 'good');
    return;
  }
  try {
    applyWorkspace(await post('/api/captures/select', { captureIds: ids }));
    state.evidenceCaptureId = null;
    renderAll();
    setLamp('ready', t('imgs.ready'));
  } catch (error) {
    notify(error.message, 'bad');
  }
}

// Fall back to a single photograph.
async function clearCaptureSelection() {
  const first = state.captures[0];
  if (first === undefined) return;
  if (state.captureIds.length === 1 && state.captureIds[0] === first.id) return;
  try {
    applyWorkspace(await post('/api/captures/select', { captureIds: [first.id] }));
    state.evidenceCaptureId = null;
    renderAll();
    setLamp('ready', t('imgs.ready'));
  } catch (error) {
    notify(error.message, 'bad');
  }
}

function showLoaded(label) {
  if (state.currentCaptureId === null) {
    $('loaded').hidden = true;
    $('drop').hidden = false;
    return;
  }
  $('loaded').hidden = false;
  // A loaded capture makes the large drop target redundant vertical space.
  $('drop').hidden = true;
  const image = $('capture-image');
  image.src = '/api/capture-image/' + encodeURIComponent(state.currentCaptureId);
  image.alt = label;
  const capture = state.captures.filter((c) => c.id === state.currentCaptureId)[0];
  image.classList.toggle('img-flip180', capture !== undefined && displayNeedsFlip(capture.exifOrientation));
}

// Whether this capture must be DISPLAYED rotated 180 degrees.
function displayNeedsFlip(orientation) {
  return orientation === 3 || orientation === 4;
}

// Select a capture WITHOUT running the model.
async function loadCapture(captureId) {
  state.activeId = null;
  state.openIds.clear();
    setLamp('working', t('imgs.ready'));
  notify('');
  try {
    // Selecting one row opens exactly that photograph as its own inspection.
    applyWorkspace(await post('/api/captures/select', { captureId: captureId }));
    renderWorkspace();
    const inspected = state.view !== null && state.view.outcome !== 'PENDING';
    setLamp('ready', t('imgs.ready'));
    setStatus(
      inspected ? t('imgs.restored') : t('imgs.selected'),
      null
    );
    notify(inspected ? t('imgs.restoredShort') : t('imgs.selectedShort'), 'good');
  } catch (error) {
    setLamp('problem', t('imgs.selectFailed'));
    notify(error.message, 'bad');
  }
}

// Upload one or more photographs into the OPEN inspection.
async function uploadFiles(files) {
  if (!files || files.length === 0) return;
  const list = Array.prototype.slice.call(files);
  const error = $('drop-error');
  error.hidden = true;

  let accepted = 0;
  let refused = 0;
  let lastPayload = null;

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    setLamp('working', fillText(t('imgs.reading'), { index: i + 1, total: list.length }));
    setStatus(fillText(t('imgs.reading'), { index: i + 1, total: list.length }), null);
    try {
      const body = await fetch(
        '/api/upload?name=' + encodeURIComponent(file.name) + '&type=' + encodeURIComponent(file.type),
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }
      );
      const payload = await body.json();
      if (!body.ok) {
        // A closed gate is one refusal for the whole batch, not one per file.
        if (payload.error === 'REVIEWER_REQUIRED') {
          error.textContent = payload.message || t('gate.reason');
          error.hidden = false;
          setLamp('problem', t('gate.required'));
          notify(t('gate.reason'), 'bad');
          openReviewerModal();
          return;
        }
        refused += 1;
        error.textContent = payload.message || payload.error || t('imgs.readFailed');
        error.hidden = false;
        setLamp('problem', t('imgs.rejected'));
        continue;
      }
      applyWorkspace(payload);
      lastPayload = payload;
      accepted += 1;
      renderFixtures();
      renderAll();
    } catch (uploadError) {
      refused += 1;
      error.textContent = uploadError.message;
      error.hidden = false;
      setLamp('problem', t('imgs.rejected'));
    }
  }

  if (accepted === 0) return;
  renderAll();
  setLamp('ready', fillText(t('imgs.loaded'), { count: state.captureIds.length }));
  if (lastPayload !== null) {
    showLoaded(lastPayload.capture ? lastPayload.capture.label : '');
  }
  // Duplicates are reported by the server, so the operator learns that two of their three photographs were the same frame.
  const duplicates = state.duplicateCaptureIds || [];
  if (duplicates.length > 0) {
    notify(fillText(t('imgs.duplicates'), { count: duplicates.length, total: accepted + duplicates.length }), 'bad');
  } else if (refused > 0) {
    notify(fillText(t('imgs.partial'), { accepted, refused }), 'bad');
  } else {
    notify(fillText(t('imgs.added'), {
      count: state.captureIds.length,
      project: state.project ? state.project.name : '',
    }), 'good');
  }
}

async function uploadFile(file) {
  return uploadFiles(file === undefined ? [] : [file]);
}

// Run the inspection. Only a genuinely COMPLETED run advances to Evidence.
async function runInspection() {
  if (state.running) return;
  state.running = true;
  const runButton = $('run');
  if (runButton) runButton.disabled = true;

  const cached = $('cache-toggle').checked;
  // The whole open group is the run target. One inspection over N photographs.
  const photos = state.captureIds.length > 0 ? state.captureIds.slice() : [];
  if (photos.length === 0) {
    state.running = false;
    if (runButton) runButton.disabled = false;
    setLamp('problem', t('imgs.noneOpen'));
    notify(t('imgs.noneOpen'), 'bad');
    return;
  }

  setLamp('working', t('run.working'));
  setStatus(fillText(t('run.brief'), { count: photos.length }), 'working');
  notify(fillText(t('run.notify'), { count: photos.length }));

  // An honest elapsed clock.
  const startedAt = Date.now();
  const tick = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    setStatus(fillText(t('run.elapsed'), { secs, count: photos.length }), 'working');
  }, 1000);

  try {
    state.view = await post('/api/run', { captureIds: photos, cache: cached });

    const view = state.view;
    state.activeId = null;
    state.openIds.clear();
    state.referenceInvalidated = null;
    state.findingFeedback = {};
    state.findingInFlight.clear();
    state.obsReviewInFlight.clear();

    if (view.outcome === 'COMPLETED') {
      const origin = view.inferenceOrigin;
      const took = Math.round((Date.now() - startedAt) / 1000);
      state.lastRunSecs = took;
      // State the provenance of the result explicitly.
      const how = origin === 'CACHED'
        ? t('origin.cached')
        : origin === 'DEMO_FIXTURE'
          ? t('origin.fixture')
          : t('origin.fresh');
      setLamp('done', t('run.readyLamp'));
      setStatus(
        fillText(t('run.done'), { how, secs: took, findings: view.inspectionFindings.length }),
        'good',
      );

      // Report BOTH stages, and say plainly if one of them produced nothing.
      const failedImages = Array.isArray(view.images)
        ? view.images.filter((image) => image.status === 'FAILED')
        : [];
      const analysedImages = Array.isArray(view.images)
        ? view.images.filter((image) => image.status !== 'FAILED')
        : [];
      if (failedImages.length > 0) {
        setLamp('problem', t('run.partialLamp'));
        notify(fillText(t('run.partial'), {
          analysed: analysedImages.length,
          failed: failedImages.length,
          names: failedImages.map((image) => image.captureLabel).join(', '),
        }), 'bad');
      }

      const reasoning = view.reasoning;
      if (reasoning !== undefined && reasoning !== null) {
        if (reasoning.status === 'AVAILABLE') {
          notify(
            fillText(t('run.withReasoning'), {
              how,
              overall: view.brief.overall.replace(/_/g, ' '),
              certainty: reasoning.reasoning.certainty.replace(/_/g, ' ').toLowerCase(),
            }),
            failedImages.length > 0 ? 'bad' : 'good'
          );
        } else {
          notify(
            fillText(t('run.noReasoning'), {
              how,
              overall: view.brief.overall.replace(/_/g, ' '),
              kind: reasoning.failureKind || 'not run',
            }),
            failedImages.length > 0 ? 'bad' : 'good'
          );
        }
      } else {
        notify(fillText(t('run.plainDone'), { how, overall: view.brief.overall.replace(/_/g, ' ') }), failedImages.length > 0 ? 'bad' : 'good');
      }

      if (view.persistence !== undefined && view.persistence !== null && view.persistence.written === false) {
        setLamp('problem', t('run.persistFailedLamp'));
        const persistWarn = t('prov.persistFailed')
          + (view.persistence.message ? ' — ' + view.persistence.message : '');
        setStatus(persistWarn, 'bad');
        notify(persistWarn, 'bad');
      }

      // only move on to the evidence stage once the inspection really completed
      selectStep('evidence');
      // Open the first finding so the evidence is never hidden behind a closed card.
      if (view.inspectionFindings.length > 0) {
        state.activeId = view.inspectionFindings[0].id;
        state.openIds.add(state.activeId);
      }
    } else {
      state.lastRunSecs = null;
      // Distinguish WHY it failed.
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
    // A closed reviewer gate is not a provider failure and must not read as one: the run never reached a model, and no.
    if (error.code === 'REVIEWER_REQUIRED') {
      setLamp('problem', 'REVIEWER REQUIRED');
      setStatus(t('gate.reason'), 'bad');
      notify(t('gate.reason'), 'bad');
      openReviewerModal();
      return;
    }
    // A stale or foreign capture selection is application state, not a model failure: the run never reached a provider, so.
    if (error.code === 'UNKNOWN_CAPTURE' || error.code === 'NOT_OWNED'
      || error.code === 'UNKNOWN_PROJECT' || error.code === 'NO_ACTIVE_PROJECT'
      || error.code === 'TOO_MANY_IMAGES' || error.code === 'no capture selected'
      || error.code === 'captureId is required') {
      setLamp('problem', 'Capture unavailable');
      setStatus(error.message, 'bad');
      notify(error.message, 'bad');
      try {
        applyWorkspace(await api('/api/workspace'));
        renderAll();
      } catch (refreshError) {
        notify(refreshError.message, 'bad');
      }
      return;
    }
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

// Map a provider failure kind to an operator-facing sentence.
function describeFailure(kind, message) {
  // Routed through the catalog by failure kind, so a failure notice speaks the operator's language.
  switch (kind) {
    case 'TIMEOUT':
      return t('fail.timeout');
    case 'UNAVAILABLE':
      return t('fail.unavailable');
    case 'AUTHENTICATION':
      return t('fail.authentication');
    case 'RATE_LIMITED':
      return t('fail.rateLimited');
    case 'NOT_CONFIGURED':
      return t('fail.notConfigured');
    case 'MALFORMED_RESPONSE':
      return t('fail.malformed');
    default:
      return t('fail.error') + ' (' + kind + '): ' + message;
  }
}

function countActiveHumanReviews() {
  const view = state.view;
  if (view === null || view.outcome === 'PENDING') return 0;
  const fCount = Array.isArray(view.inspectionFindings)
    ? view.inspectionFindings.filter((f) => f.verificationStatus !== 'UNVERIFIED').length
    : 0;
  const oCount = Array.isArray(view.observations)
    ? view.observations.filter((o) => o.verificationStatus !== 'UNVERIFIED').length
    : 0;
  return fCount + oCount;
}

function confirmReferenceInvalidation() {
  const reviewCount = countActiveHumanReviews();
  if (reviewCount === 0) return true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const projectName = state.project ? state.project.name : 'this project';
    const ledgerCount = state.view && Array.isArray(state.view.findings) ? state.view.findings.length : 0;
    return window.confirm(fillText(t('ref.warnInvalidate'), {
      project: projectName,
      verified: reviewCount,
      ledger: ledgerCount,
    }));
  }
  return true;
}

async function applyExpected(presetId) {
  const preset = presetId === undefined ? $('expected-preset').value : presetId;
  if (!confirmReferenceInvalidation()) {
    if ($('expected-preset') && state.project && state.project.expectedPresetId) {
      $('expected-preset').value = state.project.expectedPresetId;
    }
    return;
  }
  const hadInspection = state.view !== null && state.view.outcome !== 'PENDING';
  const prevReviews = countActiveHumanReviews();
  try {
    const payload = await post('/api/expected', { presetId: preset });
    applyWorkspace(payload);
    if (state.view) state.expected = state.view.expected;
    if (hadInspection) {
      const projName = state.project ? state.project.name : 'this project';
      state.referenceInvalidated = { projectId: state.project ? state.project.id : null, project: projName, count: prevReviews };
      const invMsg = fillText(t('ref.invalidatedNotice'), {
        project: projName,
        count: prevReviews,
      });
      renderExpected();
      renderAll();
      setLamp('ready', t('ref.invalidatedLamp'));
      setStatus(invMsg, null);
      notify(invMsg, 'good');
    } else {
      renderExpected();
      renderAll();
      notify(
        'Reference applied. Re-run the inspection to compare against it.',
        'good'
      );
    }
  } catch (error) {
    notify(error.message, 'bad');
  }
}

async function applyExpectedEdits() {
  const payload = collectExpected();
  if (payload === null) return;
  if (!confirmReferenceInvalidation()) return;
  const hadInspection = state.view !== null && state.view.outcome !== 'PENDING';
  const prevReviews = countActiveHumanReviews();
  try {
    const result = await post('/api/expected', payload);
    applyWorkspace(result);
    if (state.view) state.expected = state.view.expected;
    if (hadInspection) {
      const projName = state.project ? state.project.name : 'this project';
      state.referenceInvalidated = { projectId: state.project ? state.project.id : null, project: projName, count: prevReviews };
      const invMsg = fillText(t('ref.invalidatedNotice'), {
        project: projName,
        count: prevReviews,
      });
      renderExpected();
      renderAll();
      setLamp('ready', t('ref.invalidatedLamp'));
      setStatus(invMsg, null);
      notify(invMsg, 'good');
    } else {
      renderExpected();
      renderAll();
      notify('Reference updated. Re-run the inspection to recompute the comparison.', 'good');
    }
  } catch (error) {
    notify(error.message, 'bad');
  }
}

// Project selector: which project is active, and what can be done to it.
function renderProjects() {
  setText('proj-name', state.project ? state.project.name : 'No project');
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
  const menu = $('proj-menu');
  const wasOpen = !menu.hidden;
  menu.hidden = !open;
  $('proj-btn').setAttribute('aria-expanded', String(open));
  // Closing the menu (Escape, a switch, a cancel) must never strand keyboard focus inside an element that is now hidden.
  if (wasOpen && !open && document.activeElement && menu.contains(document.activeElement)) {
    $('proj-btn').focus();
  }
}

// Re-render everything that depends on which project and capture are active.
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
    $('drop').hidden = false;
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

// Deletion is confirmed before anything is removed.
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
      'Delete the reference "' + subject.label + '"? The project falls back to the default reference and any comparison, human-review decisions, and verified ledger findings on its sessions are invalidated.',
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
  const hadInspection = state.view !== null && state.view.outcome !== 'PENDING';
  const prevReviews = countActiveHumanReviews();
  try {
    if (pending.kind === 'project') {
      applyWorkspace(await del('/api/projects/' + encodeURIComponent(pending.subject.id)));
      notify('Project deleted.', 'good');
    } else if (pending.kind === 'preset') {
      applyWorkspace(await del('/api/presets/' + encodeURIComponent(pending.subject.id)));
      if (hadInspection) {
        const projName = state.project ? state.project.name : 'this project';
        state.referenceInvalidated = { projectId: state.project ? state.project.id : null, project: projName, count: prevReviews };
        const invMsg = fillText(t('ref.invalidatedNotice'), {
          project: projName,
          count: prevReviews,
        });
        setLamp('ready', t('ref.invalidatedLamp'));
        setStatus(invMsg, null);
        notify(invMsg, 'good');
      } else {
        notify('Reference deleted. The project now uses the default reference.', 'good');
      }
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

// One editable expected-element row inside the reference dialog.
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

// Report a boot failure honestly and VISIBLY.
function reportBootFailure(error) {
  const isNetwork = error instanceof TypeError || /fetch|network|Failed to fetch/i.test(error.message);
  const what = isNetwork
    ? 'Could not reach the inspector server. Is it still running on port 4317?'
    : 'The inspector failed to render: ' + error.message;
  setLamp('problem', isNetwork ? 'Inspector unreachable' : 'Render failed');
  setStatus(what, 'bad');
  notify(what, 'bad');
}

// The inspection-language control.
function wireLanguage() {
  const select = $('lang-select');
  if (select === null) return;

  state.lang = readStoredLanguage();

  while (select.firstChild) select.removeChild(select.firstChild);
  for (const option of I18N.languages) {
    // Each option carries its own lang/dir so a screen reader and the native picker both announce the language correctly.
    const node = document.createElement('option');
    node.value = option.code;
    node.textContent = option.label;
    node.setAttribute('lang', option.bcp47);
    node.setAttribute('dir', option.dir);
    select.appendChild(node);
  }
  select.value = state.lang;

  select.addEventListener('change', (event) => {
    const chosen = event.target.value;
    const match = I18N.languages.filter((l) => l.code === chosen)[0];
    // An unsupported value falls back to English rather than rendering a half-translated surface.
    state.lang = match === undefined ? I18N.defaultLanguage : match.code;
    storeLanguage(state.lang);
    // A new language shows its translation again, not a stale per-card "show original" choice from the previous one.
    state.trOriginal.clear();
    // Presentation only: no request, deliberately.
    renderAll();
  });
}

function wire() {
  wireLanguage();
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
  $('reviewer-form').addEventListener('submit', submitReviewerModal);
  $('reviewer-cancel').addEventListener('click', () => $('reviewer-modal').close());
  $('reviewer-change-btn').addEventListener('click', () => openReviewerModal());
  const hdrRevBtn = $('hdr-reviewer-btn');
  if (hdrRevBtn) hdrRevBtn.addEventListener('click', () => openReviewerModal());
  const gateBtn = $('reviewer-gate-btn');
  if (gateBtn) gateBtn.addEventListener('click', () => openReviewerModal());
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
  const selectAllBtn = $('select-all-captures');
  if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllCaptures);
  const clearSelBtn = $('clear-capture-selection');
  if (clearSelBtn) clearSelBtn.addEventListener('click', clearCaptureSelection);
  $('pick').addEventListener('click', (event) => {
    event.stopPropagation();
    $('file').click();
  });
  // The WHOLE picked list is uploaded, not just the first entry.
  $('file').addEventListener('change', (event) => {
    const picked = event.target.files;
    uploadFiles(picked);
    // Reset so re-picking the same file fires 'change' again.
    event.target.value = '';
  });
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
  drop.addEventListener('drop', (event) => {
    if (event.dataTransfer) {
      event.preventDefault();
      uploadFiles(event.dataTransfer.files);
    }
  });

  $('expected-apply').addEventListener('click', () => {
    // Apply whatever is currently in the editor: an edited count, or the selected preset when nothing has been touched.
    const edited = collectExpected();
    const preset = $('expected-preset').value;
    const dirty = edited !== null && state.expected !== null
      && JSON.stringify(edited.items) !== JSON.stringify(state.expected.items);
    if (dirty) applyExpectedEdits();
    else applyExpected(preset);
  });
  $('expected-preset').addEventListener('change', () => applyExpected($('expected-preset').value));

  // Evidence geometry is positioned from the rendered image size, so the overlay has to be recomputed whenever the image.
  $('evidence-image').addEventListener('load', renderOverlay);
  // A failed image must SAY SO.
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
    // The dataset index is separate from the workspace payload because it lists every file.
    await loadDataset();

    // The lamp must describe the restored state, not a generic idle: a capture with open findings is not "capture ready".
    const view = state.view;
    const pending = view !== null && view.counters ? view.counters.pending : 0;
    if (view !== null && view.outcome !== 'PENDING' && view.outcome !== 'FAILED') {
      setLamp(pending > 0 ? 'done' : 'ready',
        pending > 0
          ? 'FINDINGS READY - ' + pending + ' awaiting human review'
          : 'Inspection settled - all findings reviewed');
    } else {
      setLamp('ready', 'Capture ready');
    }
    const hasDataset = state.dataset !== null && state.dataset.present;
    // The status line must describe what is actually on screen: a restored inspection is not an empty "choose a capture" state.
    const restored = state.view !== null && state.view.outcome !== 'PENDING'
      && state.view.outcome !== 'FAILED';
    setStatus(
      restored
        ? 'Restored the last inspection of this capture. Inspect again for a fresh reading.'
        : state.captures.length > 0
          ? (hasDataset
              ? 'Choose a capture, import a real dataset photograph below, or drop your own — then inspect.'
              : 'Choose a capture or drop a site photograph, then inspect.')
          : 'No captures in this project yet. Import a local dataset image or drop a photograph.',
      null
    );
  } catch (error) {
    // A render fault and a transport fault must not both claim the server is unreachable.
    reportBootFailure(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
`;
