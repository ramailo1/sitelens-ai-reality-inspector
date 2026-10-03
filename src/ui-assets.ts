/**
 * UI assets for the local inspector.
 *
 * Served as plain text modules so the application keeps zero runtime
 * dependencies and no build step. The presentation is deliberately an
 * inspection instrument: monospace data, ruled panels, explicit state badges
 * and a bounded evidence frame. There are no decorative animations, no
 * fabricated KPIs and no AI-themed ornament.
 */

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteLens AI Reality Inspector</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="mark"></span>
    <span>SiteLens</span>
    <span class="sub">AI Reality Inspector</span>
  </div>
  <div class="truth" id="truth-banner">Reality is the reference.</div>
  <div class="runtime">
    <span class="kv"><i>provider</i><b id="hdr-provider">-</b></span>
    <span class="kv"><i>model</i><b id="hdr-model">-</b></span>
  </div>
</header>

<main>
  <section class="panel capture">
    <h2>1 &middot; Capture</h2>
    <label class="field">
      <span>Scene</span>
      <select id="capture-select"></select>
    </label>
    <p class="hint" id="capture-content"></p>
    <div class="frame" id="frame">
      <img id="capture-image" alt="Construction capture under inspection">
      <div class="overlay" id="overlay"></div>
      <div class="reticle" aria-hidden="true"></div>
    </div>
    <dl class="meta" id="capture-meta"></dl>
    <button id="run" class="primary">Run AI Inspection</button>
    <div class="status" id="status" role="status" aria-live="polite">Idle. No inspection has run yet.</div>
  </section>

  <section class="panel observations">
    <h2>2 &middot; AI Observations</h2>
    <p class="legend">
      Every row below is <b>model output</b>, not project truth. Each one must be
      reviewed by a person before it can become a finding.
    </p>
    <div id="observations"></div>
  </section>

  <section class="panel review">
    <h2>3 &middot; Human Review</h2>
    <label class="field">
      <span>Reviewer</span>
      <input id="reviewer" type="text" placeholder="name or badge" autocomplete="off">
    </label>
    <label class="field">
      <span>Note</span>
      <input id="note" type="text" placeholder="optional" autocomplete="off">
    </label>
    <p class="legend">
      Selecting an observation focuses it in the capture frame. Only
      <b>Verify</b> can create a finding.
    </p>
    <div class="trust-line">
      <span class="badge ai">AI_GENERATED</span>
      <span class="badge warn" id="trust-state">UNVERIFIED</span>
      <span class="muted">confidence never auto-verifies</span>
    </div>
  </section>

  <section class="panel findings">
    <h2>4 &middot; Verified Findings</h2>
    <p class="legend">
      Raised only after a human verifies an observation. Isolated hackathon
      scope - not a production SiteLens issue.
    </p>
    <div id="findings"></div>
  </section>

  <section class="panel provenance">
    <h2>Provenance</h2>
    <dl class="meta wide" id="provenance"></dl>
    <div id="eligibility" class="eligibility"></div>
    <div id="failures"></div>
  </section>
</main>

<script src="/app.js"></script>
</body>
</html>
`;

export const APP_CSS = `:root {
  --bg: #0d0f11; --panel: #14171a; --rule: #262b30; --rule-strong: #384049;
  --ink: #d8dee3; --ink-dim: #8b949e; --ink-faint: #6b737c; --accent: #4a9eda;
  --verified: #3fb950; --rejected: #f85149; --deferred: #d29922; --unverified: #8b949e;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 13px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}
.bar {
  display: flex; align-items: center; gap: 20px; padding: 10px 18px;
  border-bottom: 1px solid var(--rule); background: #101315;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: .04em; }
.brand .mark { width: 10px; height: 10px; background: var(--accent); display: inline-block; }
.brand .sub { color: var(--ink-dim); font-weight: 400; letter-spacing: 0; }
.truth { margin-left: auto; color: var(--ink-faint); border-left: 1px solid var(--rule); padding-left: 20px; }
.runtime { display: flex; gap: 16px; }
.runtime .kv { display: flex; gap: 6px; align-items: baseline; }
.runtime i { color: var(--ink-faint); font-style: normal; }
.runtime b { color: var(--accent); font-weight: 500; }
main {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(380px, 1.35fr);
  grid-template-areas: "capture observations" "capture review" "provenance findings";
  gap: 1px; background: var(--rule); border-top: 1px solid var(--rule);
}
@media (max-width: 1000px) {
  main { grid-template-columns: 1fr; grid-template-areas: "capture" "observations" "review" "findings" "provenance"; }
}
.panel { background: var(--panel); padding: 16px; min-width: 0; }
.panel h2 { margin: 0 0 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink-dim); font-weight: 600; }
.capture { grid-area: capture; } .observations { grid-area: observations; }
.review { grid-area: review; } .findings { grid-area: findings; } .provenance { grid-area: provenance; }
.field { display: block; margin-bottom: 10px; }
.field > span { display: block; color: var(--ink-faint); margin-bottom: 4px; font-size: 11px; }
select, input {
  width: 100%; background: #0b0d0f; color: var(--ink);
  border: 1px solid var(--rule-strong); padding: 7px 9px; font: inherit;
}
select:focus, input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
button {
  font: inherit; cursor: pointer; padding: 8px 14px;
  border: 1px solid var(--rule-strong); background: #1b1f23; color: var(--ink);
}
button:hover:not(:disabled) { border-color: var(--accent); }
button.primary { width: 100%; background: #17222b; border-color: var(--accent); color: #cfe6f7; }
button:disabled { opacity: .4; cursor: not-allowed; }
button[data-decision="VERIFIED"]:hover { border-color: var(--verified); }
button[data-decision="REJECTED"]:hover { border-color: var(--rejected); }
button[data-decision="NEEDS_REVIEW"]:hover { border-color: var(--deferred); }
.hint, .legend { color: var(--ink-faint); font-size: 11px; line-height: 1.6; margin: 0 0 10px; }
.legend b { color: var(--ink-dim); font-weight: 600; }
.muted { color: var(--ink-faint); font-size: 11px; }
.status {
  margin-top: 10px; padding: 8px 10px; font-size: 11px;
  border: 1px solid var(--rule); background: #0b0d0f; color: var(--ink-dim);
}
.status[data-tone="busy"] { border-color: var(--accent); color: #9ecbeb; }
.status[data-tone="ok"] { border-color: var(--verified); color: #7ee787; }
.status[data-tone="warn"] { border-color: var(--deferred); color: #e3b341; }
.status[data-tone="fail"] { border-color: var(--rejected); color: #ff7b72; }
.frame {
  position: relative; margin: 10px 0;
  border: 1px solid var(--rule-strong); background: #000; line-height: 0;
}
.frame img { width: 100%; height: auto; display: block; image-rendering: pixelated; }
.overlay { position: absolute; inset: 0; pointer-events: none; }
.reticle { position: absolute; inset: 6px; pointer-events: none; border: 1px solid rgba(74, 158, 218, .18); }
.box { position: absolute; border: 1px solid var(--accent); background: rgba(74, 158, 218, .10); }
.box[data-status="VERIFIED"] { border-color: var(--verified); background: rgba(63, 185, 80, .12); }
.box[data-status="REJECTED"] { border-color: var(--rejected); background: rgba(248, 81, 73, .10); }
.box[data-status="NEEDS_REVIEW"] { border-color: var(--deferred); background: rgba(210, 153, 34, .12); }
.box .tag {
  position: absolute; top: -16px; left: -1px; font-size: 9px; line-height: 1.4;
  padding: 0 4px; background: #0b0d0f; border: 1px solid var(--accent);
  color: var(--accent); white-space: nowrap;
}
.box[data-status="VERIFIED"] .tag { border-color: var(--verified); color: #7ee787; }
.box[data-status="REJECTED"] .tag { border-color: var(--rejected); color: #ff7b72; }
.meta { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 11px; }
.meta.wide { grid-template-columns: max-content 1fr max-content 1fr; }
.meta dt { color: var(--ink-faint); }
.meta dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.meta dd.num { color: var(--accent); }
.obs {
  border: 1px solid var(--rule); border-left: 2px solid var(--rule-strong);
  padding: 10px; margin-bottom: 8px; cursor: pointer; background: #101315;
}
.obs:hover { border-color: var(--rule-strong); border-left-color: var(--accent); }
.obs[data-selected="true"] { border-color: var(--accent); border-left-color: var(--accent); background: #121a20; }
.obs .row-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.obs .idx { color: var(--ink-faint); }
.obs .cat { color: var(--accent); letter-spacing: .06em; }
.obs .text { margin: 0 0 6px; }
.obs .ev { color: var(--ink-faint); font-size: 11px; margin: 0 0 8px; }
.obs .ev b { color: var(--ink-dim); font-weight: 500; }
.obs .acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.obs .acts button { padding: 4px 9px; font-size: 11px; }
.badge {
  font-size: 10px; padding: 1px 6px; border: 1px solid var(--rule-strong);
  color: var(--ink-dim); letter-spacing: .04em;
}
.badge.ai { color: #c9a4f0; border-color: #5b3d7a; }
.badge.verified { color: #7ee787; border-color: #2ea043; }
.badge.rejected { color: #ff7b72; border-color: #da3633; }
.badge.deferred { color: #e3b341; border-color: #9e6a03; }
.badge.unverified { color: var(--unverified); border-color: var(--rule-strong); }
.badge.mono { color: var(--ink-faint); }
.conf { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: var(--ink-faint); }
.conf .bar { display: inline-block; width: 34px; height: 4px; background: #1f2429; }
.conf .bar i { display: block; height: 100%; background: var(--ink-dim); }
.trust-line { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.eligibility {
  margin-top: 12px; padding: 9px 10px; font-size: 11px; line-height: 1.6;
  border: 1px solid var(--rule); background: #0b0d0f;
}
.eligibility[data-eligibility="ELIGIBLE"] { border-color: var(--verified); color: #7ee787; }
.eligibility[data-eligibility="NOT_ELIGIBLE"] { border-color: var(--deferred); color: #e3b341; }
.eligibility[data-eligibility="NOT_VERIFIED"] { border-color: var(--rejected); color: #ff7b72; }
.finding {
  border: 1px solid var(--rule); border-left: 2px solid var(--verified);
  padding: 10px; margin-bottom: 8px; background: #101315;
}
.finding[data-state="ACKNOWLEDGED"] { border-left-color: var(--deferred); }
.finding[data-state="CLOSED"] { border-left-color: var(--rule-strong); opacity: .6; }
.finding .row-top { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.finding p { margin: 0 0 6px; }
.finding .act-line { color: var(--accent); font-size: 11px; }
.finding .acts { display: flex; gap: 6px; margin-top: 8px; }
.empty { color: var(--ink-faint); font-size: 11px; padding: 10px 0; }
.failure { border: 1px solid var(--rejected); padding: 9px 10px; margin-top: 10px; font-size: 11px; }
.failure b { color: #ff7b72; }
`;

export const APP_JS = `'use strict';

/**
 * Inspector client.
 *
 * All model-derived strings are inserted as text nodes, never as HTML. Model
 * output is untrusted input, so it is never interpreted as markup.
 */

const $ = (id) => document.getElementById(id);

const state = { view: null, selectedId: null, captures: [], running: false };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setStatus(text, tone) {
  const node = $('status');
  node.textContent = text;
  if (tone) node.setAttribute('data-tone', tone);
  else node.removeAttribute('data-tone');
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}

function statusClass(status) {
  if (status === 'VERIFIED') return 'verified';
  if (status === 'REJECTED') return 'rejected';
  if (status === 'NEEDS_REVIEW') return 'deferred';
  return 'unverified';
}

// ---- capture -------------------------------------------------------------

function renderCaptureList() {
  const select = $('capture-select');
  select.textContent = '';
  for (const capture of state.captures) {
    const option = document.createElement('option');
    option.value = capture.id;
    option.textContent = capture.label;
    select.appendChild(option);
  }
  const current = state.view && state.view.provenance.captureId;
  if (current) select.value = current;
  updateCaptureMeta();
}

function updateCaptureMeta() {
  const meta = $('capture-meta');
  meta.textContent = '';
  const p = state.view ? state.view.provenance : null;
  const capture = state.captures.find((c) => c.id === $('capture-select').value));

  const rows = [
    ['capture', p ? p.captureId : (capture ? capture.id : '-')],
    ['scene', capture ? capture.label : '-'],
    ['project', p && p.projectId ? p.projectId : 'demo project'],
    ['zone', p && p.zoneId ? p.zoneId : 'demo zone'],
  ];
  if (capture) {
    rows.push(['source', 'generated fixture (not a photograph)']);
    rows.push(['dimensions', capture.width + ' x ' + capture.height + ' px']);
    rows.push(['bytes', String(capture.byteLength)]);
  }
  for (const [key, value] of rows) {
    meta.appendChild(el('dt', null, key));
    meta.appendChild(el('dd', null, value));
  }
  $('capture-content').textContent = capture ? capture.content : '';
}

// ---- provenance ----------------------------------------------------------

function renderProvenance() {
  const box = $('provenance');
  box.textContent = '';
  const p = state.view ? state.view.provenance : null;

  const rows = [
    ['provider', p ? p.provider : '-'],
    ['model', p ? p.model : '-'],
    ['inference', p && p.inferenceExecuted ? 'executed' : 'not executed'],
    ['latency', p && p.latencyMs ? p.latencyMs + ' ms' : '-'],
    ['inspected at', p ? p.inspectedAt : '-'],
    ['image', p ? p.imageWidth + ' x ' + p.imageHeight : '-'],
    ['media type', p ? p.mediaType : '-'],
    ['accepted', p ? String(p.observationsAccepted) : '0'],
    ['rejected', p ? String(p.observationsRejected) : '0'],
    ['trust state', p ? p.trustState : '-'],
  ];
  for (const [key, value] of rows) {
    box.appendChild(el('dt', null, key));
    box.appendChild(el('dd', null, value));
  }

  const elig = $('eligibility');
  elig.textContent = '';
  if (p) {
    elig.setAttribute('data-eligibility', p.eligibility);
    elig.textContent = p.eligibilityNote;
  }

  const failures = $('failures');
  failures.textContent = '';
  const f = state.view ? state.view.failure : null;
  if (f) {
    const failureBox = el('div', 'failure');
    failureBox.appendChild(el('b', null, f.kind));
    failureBox.appendChild(document.createTextNode(' - ' + f.message));
    failures.appendChild(failureBox);
  }
}

// ---- observations --------------------------------------------------------

function renderObservations() {
  const box = $('observations');
  box.textContent = '';
  const list = state.view ? state.view.observations : [];

  if (!state.view || state.view.outcome === 'PENDING') {
    box.appendChild(el('p', 'empty', 'No inspection has run. Select a scene and run the AI inspection.'));
    renderOverlay();
    return;
  }
  if (state.view.outcome === 'FAILED') {
    box.appendChild(el('p', 'empty', 'Inference failed. No observation was produced and no project truth changed.'));
    renderOverlay();
    return;
  }
  if (state.view.outcome === 'VALIDATION_FAILED') {
    box.appendChild(el('p', 'empty', 'The model answered, but every entry failed strict validation. Nothing was accepted.'));
    renderOverlay();
    return;
  }
  if (list.length === 0) {
    box.appendChild(el('p', 'empty', 'Inspection completed. No observations were returned.'));
    renderOverlay();
    return;
  }

  list.forEach((o, index) => {
    const row = el('div', 'obs');
    row.setAttribute('data-selected', String(state.selectedId === o.id));
    row.setAttribute('data-id', o.id);
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      state.selectedId = o.id;
      renderObservations();
    });

    const top = el('div', 'row-top');
    top.appendChild(el('span', 'idx', '#' + (index + 1)));
    top.appendChild(el('span', 'cat', o.category));
    top.appendChild(el('span', 'badge mono', o.severity));
    top.appendChild(el('span', 'badge ai', o.origin));
    top.appendChild(el('span', 'badge ' + statusClass(o.verificationStatus), o.verificationStatus));
    top.appendChild(el('span', 'badge mono', o.localized ? 'localised' : 'not localised'));

    const conf = el('span', 'conf');
    const meter = el('span', 'bar');
    const fill = el('i');
    fill.style.width = Math.round(o.confidence * 100) + '%';
    meter.appendChild(fill);
    conf.appendChild(el('span', null, o.confidence.toFixed(2)));
    conf.appendChild(meter);
    conf.appendChild(el('span', null, o.confidenceBand));
    top.appendChild(conf);

    row.appendChild(top);
    row.appendChild(el('p', 'text', o.observation));

    const ev = el('p', 'ev');
    ev.appendChild(el('b', null, 'evidence: '));
    ev.appendChild(document.createTextNode(o.evidenceDescription));
    row.appendChild(ev);

    const acts = el('div', 'acts');
    acts.appendChild(el('span', 'muted', 'next: ' + o.suggestedAction));
    const reviewer = $('reviewer').value.trim();
    if (reviewer.length === 0) {
      acts.appendChild(el('span', 'muted', 'enter a reviewer name to enable decisions'));
    } else {
      for (const decision of ['VERIFIED', 'REJECTED', 'NEEDS_REVIEW']) {
        const button = el('button', null, decision.replace('_', ' ').toLowerCase());
        button.setAttribute('data-decision', decision);
        button.addEventListener('click', () => submitReview(o.id, decision));
        acts.appendChild(button);
      }
    }
    row.appendChild(acts);
    box.appendChild(row);
  });

  renderOverlay();
}

/**
 * Draw evidence boxes over the capture.
 *
 * The server projects normalized boxes onto real pixel coordinates, so no
 * scaling guesswork happens in the browser. Observations the model did not
 * localise are reported as such rather than drawn at a made-up position.
 */
function renderOverlay() {
  const overlay = $('overlay');
  overlay.textContent = '';
  const list = state.view ? state.view.observations : [];
  const p = state.view ? state.view.provenance : null;
  if (!p || !p.imageWidth || !p.imageHeight) return;

  const frame = $('capture-image');
  const natural = frame.naturalWidth || p.imageWidth;
  const naturalH = frame.naturalHeight || p.imageHeight;
  const shownW = frame.clientWidth;
  const shownH = frame.clientHeight || (shownW * naturalH) / natural;
  if (shownW === 0) return;

  list.forEach((o, index) => {
    if (!o.pixelBox) return;
    const box = el('div', 'box');
    box.setAttribute('data-status', o.verificationStatus);
    box.style.left = o.pixelBox.left * (shownW / natural) + 'px';
    box.style.top = o.pixelBox.top * (shownH / naturalH) + 'px';
    box.style.width = o.pixelBox.width * (shownW / natural) + 'px';
    box.style.height = o.pixelBox.height * (shownH / naturalH) + 'px';
    box.appendChild(el('span', 'tag', '#' + (index + 1) + ' ' + o.category));
    overlay.appendChild(box);
  });

  const unlocalized = list.filter((o) => !o.localized).length;
  if (unlocalized > 0) {
    const note = el('div', 'empty', unlocalized + ' not localised: no box drawn');
    note.style.cssText =
      'position:absolute;left:8px;bottom:8px;background:#0b0d0f;padding:2px 6px;border:1px solid #262b30';
    overlay.appendChild(note);
  }
}

// ---- findings ------------------------------------------------------------

function renderFindings() {
  const box = $('findings');
  box.textContent = '';
  const findings = state.view ? state.view.findings : [];

  if (findings.length === 0) {
    box.appendChild(el('p', 'empty', 'No findings. Verify an observation to raise one.'));
    return;
  }

  for (const finding of findings) {
    const card = el('div', 'finding');
    card.setAttribute('data-state', finding.state);

    const top = el('div', 'row-top');
    top.appendChild(el('span', 'cat', finding.category));
    top.appendChild(el('span', 'badge verified', 'VERIFIED'));
    top.appendChild(el('span', 'badge mono', finding.state));
    card.appendChild(top);

    card.appendChild(el('p', 'text', finding.summary));
    card.appendChild(el('p', 'act-line', 'action: ' + finding.suggestedAction));
    card.appendChild(el('p', 'ev',
      'raised by ' + finding.raisedBy + ' at ' + finding.raisedAt + ' - target ' + finding.target));

    const acts = el('div', 'acts');
    for (const stateName of ['OPEN', 'ACKNOWLEDGED', 'CLOSED']) {
      const button = el('button', null, stateName.toLowerCase());
      button.addEventListener('click', () => setFindingState(finding.id, stateName));
      acts.appendChild(button);
    }
    card.appendChild(acts);
    box.appendChild(card);
  }
}

function renderAll() {
  const p = state.view ? state.view.provenance : null;
  $('hdr-provider').textContent = p ? p.provider : '-';
  $('hdr-model').textContent = p ? p.model : '-';
  updateCaptureMeta();
  renderProvenance();
  renderObservations();
  renderFindings();
}

async function runInspection() {
  if (state.running) return;
  state.running = true;
  state.selectedId = null;
  $('run').disabled = true;
  setStatus('Running inspection...', 'busy');
  try {
    state.view = await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureId: $('capture-select').value }),
    });
    const p = state.view.provenance;
    if (state.view.outcome === 'COMPLETED') {
      setStatus('Completed: ' + p.observationsAccepted + ' accepted, ' + p.observationsRejected
        + ' rejected, ' + p.latencyMs + ' ms. All remain UNVERIFIED.', 'ok');
    } else if (state.view.outcome === 'VALIDATION_FAILED') {
      setStatus('The model answered but nothing passed validation. No observation was accepted.', 'warn');
    } else if (state.view.outcome === 'VALIDATION_EMPTY') {
      setStatus('Inspection completed. No observations were returned.', 'warn');
    } else {
      setStatus('Inspection failed. No project truth changed.', 'fail');
    }
  } catch (error) {
    setStatus('Inspection failed: ' + error.message, 'fail');
  } finally {
    state.running = false;
    $('run').disabled = false;
    renderAll();
  }
}

async function submitReview(observationId, decision) {
  try {
    state.view = await api('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observationId: observationId,
        decision: decision,
        reviewer: $('reviewer').value.trim(),
        note: $('note').value.trim(),
      }),
    });
    setStatus('Review recorded: ' + decision + '.', 'ok');
  } catch (error) {
    setStatus('Review refused: ' + error.message, 'fail');
  }
  renderAll();
}

async function setFindingState(findingId, stateName) {
  try {
    state.view = await api('/api/finding-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findingId: findingId, state: stateName }),
    });
    setStatus('Finding moved to ' + stateName + '.', 'ok');
  } catch (error) {
    setStatus('Could not update finding: ' + error.message, 'fail');
  }
  renderAll();
}

async function init() {
  $('run').addEventListener('click', runInspection);
  $('capture-select').addEventListener('change', () => {
    state.selectedId = null;
    updateCaptureMeta();
  });
  $('reviewer').addEventListener('input', () => {
    if (state.view) renderObservations();
  });
  window.addEventListener('resize', () => renderOverlay());

  try {
    const data = await api('/api/captures');
    state.captures = data.captures;
    renderCaptureList();
    const current = state.captures[0];
    if (current) $('capture-image').src = '/api/capture-image/' + encodeURIComponent(current.id);
    state.view = await api('/api/session');
  } catch (error) {
    setStatus('Could not load the inspector: ' + error.message, 'fail');
  }
  renderAll();
}

void init();
`;