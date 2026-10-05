/**
 * The inspector markup.
 *
 * One screen, four workflow bays. The masthead carries the session identity
 * (project / zone / capture) so a screenshot always says what was inspected,
 * and the engine strip permanently states which model produced the result.
 */

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="SiteLens AI Reality Inspector - construction reality capture, visual inspection, expected-state comparison and human verification.">
<meta name="color-scheme" content="light">
<title>AI Reality Inspector - SiteLens</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<a class="skip" href="#stage">Skip to the capture stage</a>

<header class="rig">
  <div class="rig-id">
    <span class="rig-mark" aria-hidden="true"></span>
    <span class="rig-name">AI REALITY INSPECTOR</span>
    <span class="rig-org">SiteLens</span>
  </div>

  <div class="rig-meta" id="rig-meta">
    <span class="rig-meta-i"><b>PROJECT</b><span id="meta-project">-</span></span>
    <span class="rig-meta-i"><b>ZONE</b><span id="meta-zone">-</span></span>
    <span class="rig-meta-i"><b>CAPTURE</b><span id="meta-capture">-</span></span>
  </div>

  <nav class="rig-nav" aria-label="Workflow" role="tablist">
    <button type="button" class="step" id="tab-capture" role="tab"
            data-step="capture" aria-controls="bay-capture" aria-selected="true">
      <span class="step-n">01</span><span class="step-t">Capture</span>
    </button>
    <button type="button" class="step" id="tab-inspect" role="tab"
            data-step="inspect" aria-controls="bay-inspect" aria-selected="false" tabindex="-1">
      <span class="step-n">02</span><span class="step-t">Inspect</span>
    </button>
    <button type="button" class="step" id="tab-evidence" role="tab"
            data-step="evidence" aria-controls="bay-evidence" aria-selected="false" tabindex="-1">
      <span class="step-n">03</span><span class="step-t">Evidence</span>
    </button>
    <button type="button" class="step" id="tab-findings" role="tab"
            data-step="findings" aria-controls="bay-findings" aria-selected="false" tabindex="-1">
      <span class="step-n">04</span><span class="step-t">Findings</span>
    </button>
  </nav>

  <div class="rig-state">
    <span class="lamp" data-lamp="idle" id="lamp"></span>
    <span class="rig-state-t" id="state-label">Capture ready</span>
  </div>
</header>

<div class="ident">
  <span class="ident-k">Engine</span><span class="ident-v" id="hdr-model">-</span>
  <span class="ident-k">Source</span><span class="ident-v" id="hdr-provenance">-</span>
  <span class="ident-synth" id="hdr-synth" hidden>DEMO FIXTURE - NOT AI INFERENCE</span>
  <span class="ident-cache" id="hdr-cache" hidden>CACHED AI RESULT</span>
  <label class="cache-toggle" title="Reuse a previous successful AI result for this exact image instead of paying model latency again. Cached results are labelled.">
    <input type="checkbox" id="cache-toggle">
    <span>reuse cached AI</span>
  </label>
</div>

<div class="notice" id="notice" role="status" aria-live="polite"></div>

<main id="stage" class="stage">

  <section class="bay bay-capture" id="bay-capture" role="tabpanel"
           data-bay="capture" aria-labelledby="tab-capture">
    <div class="bay-head">
      <h2 class="bay-h">Capture reality</h2>
      <p class="bay-sub">This is what exists on site. Everything downstream is measured against it.</p>
    </div>

    <div class="split">
      <div class="split-l">
        <div class="drop" id="drop" tabindex="0" role="button"
             aria-label="Drop a PNG or JPEG capture here, or press Enter to choose a file">
          <input type="file" id="file" accept="image/png,image/jpeg" hidden>
          <div class="drop-inner">
            <span class="drop-mark" aria-hidden="true"></span>
            <p class="drop-title">Drop capture here</p>
            <p class="drop-alt">or</p>
            <button type="button" class="btn btn-ghost" id="pick">Choose file</button>
            <p class="drop-hint">PNG or JPEG, up to 12 MB</p>
          </div>
        </div>

        <p class="note note-bad" id="drop-error" role="alert" hidden></p>

        <div class="loaded" id="loaded" hidden>
          <div class="sheet sheet-sm">
            <img id="capture-image" alt="Construction capture under inspection">
            <div class="sheet-overlay" id="overlay-capture"></div>
          </div>
          <div class="loaded-acts">
            <button type="button" class="btn btn-ghost" id="replace">Replace</button>
            <button type="button" class="btn btn-ghost" id="remove">Remove</button>
            <button type="button" class="btn btn-red" id="run">Inspect reality</button>
          </div>
        </div>

        <div class="fixtures">
          <p class="fixtures-h">Demo captures</p>
          <ul class="fixture-list" id="fixture-list"></ul>
        </div>
      </div>

      <div class="split-r">
        <div class="panel">
          <div class="panel-head">
            <h3 class="panel-h">Expected state</h3>
            <span class="tag" id="expected-source">PRESET</span>
          </div>
          <p class="panel-sub">
            A lightweight comparison reference, not a BIM model. A deviation is
            only ever arithmetic against this list.
          </p>

          <label class="field">
            <span class="field-t">Reference</span>
            <select id="expected-preset">
              <option value="north-core">North Core (demo preset)</option>
              <option value="south-wing">South Wing (demo preset)</option>
            </select>
          </label>

          <ul class="exp-list" id="expected-list"></ul>

          <div class="panel-acts">
            <button type="button" class="btn btn-ghost" id="expected-apply">Apply reference</button>
          </div>
          <p class="note" id="expected-note">
            Edit a count, then apply and re-inspect. A preset is a demonstration
            reference, not your project programme.
          </p>
        </div>

        <div class="panel panel-cmp">
          <div class="panel-head">
            <h3 class="panel-h">Reality vs expected</h3>
            <span class="tag">COMPARISON</span>
          </div>
          <p class="panel-sub">
            Computed in code from the reference above and what the model detected.
            The model never grades its own homework.
          </p>
          <div class="cmp-list" id="comparison"></div>
        </div>
      </div>
    </div>
  </section>


  <section class="bay bay-run" id="bay-inspect" role="tabpanel"
           data-bay="inspect" aria-labelledby="tab-inspect">
    <div class="bay-head">
      <h2 class="bay-h">Inspection</h2>
      <p class="bay-sub" id="run-sub">The model has not been asked anything yet.</p>
    </div>

    <div class="status" id="status" role="status" aria-live="polite">Capture a site image, then run the inspection.</div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-h">Reality brief</h3>
          <span class="tag" id="brief-verdict">-</span>
        </div>
        <div id="brief"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-h">Inspection priorities</h3>
          <span class="tag">WHERE TO LOOK</span>
        </div>
        <p class="panel-sub">
          Where your inspector should look first. These are not verdicts.
        </p>
        <ol class="prio-list" id="priorities"></ol>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3 class="panel-h">Provenance</h3></div>
      <dl class="tape tape-wide" id="provenance"></dl>
      <p class="elig" id="eligibility"></p>
      <div id="failures"></div>
    </div>
  </section>


  <section class="bay bay-obs" id="bay-evidence" role="tabpanel"
           data-bay="evidence" aria-labelledby="tab-evidence">
    <div class="bay-head">
      <h2 class="bay-h">Reality and evidence</h2>
      <p class="bay-sub">Select a finding to highlight where on the site it was flagged.</p>
    </div>

    <div class="stage-grid">
      <div class="stage-l">
        <div class="sheet sheet-lg" id="sheet-evidence">
          <img id="evidence-image" alt="Construction reality capture with evidence overlays">
          <div class="sheet-overlay" id="overlay"></div>
          <div class="sheet-cal" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        </div>
        <p class="stage-cap" id="stage-cap">No capture loaded.</p>
      </div>

      <aside class="stage-r" aria-label="Inspection summary">
        <div class="rail">
          <p class="rail-h">REALITY</p>
          <p class="rail-v" id="rail-elements">-</p>
          <p class="rail-n">elements detected</p>
        </div>
        <div class="rail">
          <p class="rail-h">INSPECTION</p>
          <p class="rail-v" id="rail-attention">-</p>
          <p class="rail-n">attention areas</p>
        </div>
        <div class="rail">
          <p class="rail-h">FINDINGS</p>
          <p class="rail-v" id="rail-findings">-</p>
          <p class="rail-n" id="rail-findings-n">awaiting review</p>
        </div>
        <div class="rail">
          <p class="rail-h">CONFIDENCE</p>
          <p class="rail-v" id="rail-confidence">-</p>
          <p class="rail-n">highest finding</p>
        </div>
        <div class="rail rail-verdict" id="rail-verdict">
          <p class="rail-h">OVERALL</p>
          <p class="rail-v" id="rail-overall">-</p>
        </div>
      </aside>
    </div>

    <div class="review-bar">
      <label class="field">
        <span class="field-t">Reviewer</span>
        <input type="text" id="reviewer" placeholder="name or badge" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-t">Note</span>
        <input type="text" id="note" placeholder="optional" autocomplete="off">
      </label>
    </div>

    <div class="trust" id="trust-line">
      <span class="trust-tag">AI_SUSPECTED</span>
      <span class="trust-arrow" aria-hidden="true">to</span>
      <span class="trust-tag" id="trust-state">UNVERIFIED</span>
      <span class="trust-note">Confidence never verifies itself.</span>
    </div>

    <div id="findings-cards"></div>
  </section>

  <section class="bay bay-find" id="bay-findings" role="tabpanel"
           data-bay="findings" aria-labelledby="tab-findings">
    <div class="bay-head">
      <h2 class="bay-h">Findings and verification</h2>
      <p class="bay-sub">Every AI finding needs a named person to confirm, reject or defer it.</p>
    </div>
    <div id="findings"></div>
  </section>

</main>

<footer class="foot">
  <span class="foot-thesis">AI does not replace the inspector. It tells the inspector where to look.</span>
  <span class="foot-r">Local inspection surface. Loopback only.</span>
</footer>

<script src="/app.js"></script>
</body>
</html>`;

