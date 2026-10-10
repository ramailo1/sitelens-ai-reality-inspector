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
<!-- The identity fonts, actually delivered. Without this the CSS stacks were a
     promise kept only on machines that happened to have both installed; on any
     other laptop the page silently fell back to Segoe UI + Consolas. An offline
     machine fails the link harmlessly, to those same fallbacks. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<a class="skip" href="#stage" data-i18n="skip.capture">Skip to the capture stage</a>

<header class="rig">
  <div class="rig-id">
    <span class="rig-mark" aria-hidden="true"></span>
    <span class="rig-name">AI REALITY INSPECTOR</span>
    <span class="rig-org">SiteLens</span>
  </div>

  <!--
    The meta strip names what is open, never the file names themselves. A
    filename is forty characters that an operator has to scan and cannot
    compare at a glance; how MANY photographs the inspection rests on is the
    fact this strip has to carry, and it is a fixed width whatever that count
    is. The names stay in the Capture bay, one click away, where they can be
    read properly.

    The counts live in <details> so the identity strip cannot grow: an inline
    disclosure is the browser's own affordance and survives keyboard, RTL and
    high-contrast modes without any script.
  -->
  <div class="rig-meta" id="rig-meta">
    <span class="rig-meta-i"><b data-i18n="meta.zone">ZONE</b><span id="meta-zone">-</span></span>
    <span class="rig-meta-i">
      <b data-i18n="meta.capture">CAPTURE</b>
      <details class="rig-disclose" id="capture-disclosure">
        <summary class="rig-summary" id="meta-capture" tabindex="0" role="button"
                 aria-describedby="capture-disclosure-hint">-</summary>
        <span class="rig-disclose-h" id="capture-disclosure-hint" data-i18n="meta.captureHint">photographs open</span>
        <ul class="rig-disclose-list" id="meta-capture-list"></ul>
      </details>
    </span>
    <span class="rig-meta-i"><b data-i18n="meta.reviewer">REVIEWER</b><button type="button" class="hdr-rev-btn" id="hdr-reviewer-btn"><span id="meta-reviewer">Not set</span></button></span>
  </div>

  <div class="proj">
    <button type="button" class="proj-btn" id="proj-btn" aria-haspopup="dialog"
            aria-expanded="false" aria-controls="proj-menu">
      <span class="proj-k" data-i18n="proj.label">Project</span>
      <span class="proj-name" id="proj-name">No project</span>
      <span class="proj-caret" aria-hidden="true"></span>
    </button>
    <button type="button" class="btn btn-ghost btn-xs" id="proj-new" data-i18n="proj.new">New project</button>
    <div class="proj-menu" id="proj-menu" role="dialog" aria-label="Projects" data-i18n-aria="aria.projects" hidden>
      <p class="proj-menu-h">Projects</p>
      <ul class="proj-list" id="proj-list"></ul>
      <p class="proj-empty" id="proj-empty" hidden>
        No projects yet. Create one before capturing or inspecting.
      </p>
      <div class="proj-menu-acts">
        <button type="button" class="btn btn-ghost btn-xs" id="proj-rename">Rename project</button>
        <button type="button" class="btn btn-red btn-xs" id="proj-delete">Delete project</button>
      </div>
    </div>
  </div>

  <nav class="rig-nav" aria-label="Workflow" data-i18n-aria="aria.workflow" role="tablist">
    <button type="button" class="step" id="tab-capture" role="tab"
            data-step="capture" aria-controls="bay-capture" aria-selected="true">
      <span class="step-n">01</span><span class="step-t" data-i18n="tab.capture">Capture</span>
    </button>
    <button type="button" class="step" id="tab-inspect" role="tab"
            data-step="inspect" aria-controls="bay-inspect" aria-selected="false" tabindex="-1">
      <span class="step-n">02</span><span class="step-t" data-i18n="tab.inspect">Inspect</span>
    </button>
    <button type="button" class="step" id="tab-evidence" role="tab"
            data-step="evidence" aria-controls="bay-evidence" aria-selected="false" tabindex="-1">
      <span class="step-n">03</span><span class="step-t" data-i18n="tab.evidence">Evidence</span>
    </button>
    <button type="button" class="step" id="tab-findings" role="tab"
            data-step="findings" aria-controls="bay-findings" aria-selected="false" tabindex="-1">
      <span class="step-n">04</span><span class="step-t" data-i18n="tab.findings">Findings</span>
    </button>
  </nav>

  <div class="rig-state">
    <span class="lamp" data-lamp="idle" id="lamp"></span>
    <span class="rig-state-t" id="state-label" data-i18n="meta.stateReady">Capture ready</span>
  </div>
</header>

<div class="ident">
  <span class="ident-k" data-i18n="meta.vision">Vision</span><span class="ident-v" id="hdr-model" data-latin>-</span>
  <span class="ident-k" data-i18n="meta.reasoning">Reasoning</span><span class="ident-v" id="hdr-reasoner" data-latin>-</span>
  <span class="ident-k" data-i18n="meta.source">Source</span><span class="ident-v" id="hdr-provenance">-</span>
  <span class="ident-synth" id="hdr-synth" hidden>DEMO FIXTURE - NOT AI INFERENCE</span>
  <span class="ident-cache" id="hdr-cache" hidden>CACHED AI RESULT</span>
  <label class="cache-toggle" title="Reuse a previous successful AI result for this exact image instead of paying model latency again. Cached results are labelled." data-i18n-title="ident.cacheToggleTitle">
    <input type="checkbox" id="cache-toggle">
    <span>reuse cached AI</span>
  </label>

  <!--
    Inspection language.

    A presentation control, not an engine control: switching it re-renders the
    SAME canonical inspection in the selected language and never triggers a
    model call. Language names are written in their own language on purpose -
    they identify themselves without flags.

    It sits in the identity strip rather than inside one bay, because a language
    reachable only on the Inspect step cannot be used to read the evidence it
    was chosen for. The options are generated from the server vocabulary in
    wireLanguage(), so the list and the catalog cannot drift.
  -->
  <label class="lang-sel" for="lang-select" dir="ltr" data-i18n-title="lang.hint" title="Presentation only. The inspection, its evidence and its provenance are unchanged.">
    <span class="lang-k" id="lang-label" data-i18n="lang.label">Inspection language</span>
    <select id="lang-select" aria-label="Inspection language"></select>
  </label>
</div>

<!--
  The reviewer gate, shown above the pipeline so it is the first thing read on
  every step rather than a message that only appears once something is clicked.
  It states the real reason the workflow is unavailable, and it is the route to
  the one action that resolves it.
-->
<div class="gate" id="reviewer-gate" role="status" hidden>
  <span class="gate-k" data-i18n="gate.required">REVIEWER REQUIRED</span>
  <span class="gate-b" id="reviewer-gate-reason" data-i18n="gate.reason">Name the inspection reviewer to record a human verification. Until then every finding stays UNVERIFIED.</span>
  <button type="button" class="btn btn-xs" id="reviewer-gate-btn" data-i18n="gate.setup">SET UP REVIEWER</button>
</div>

<!--
  The pipeline, always visible.
  Two models do different jobs and the UI must never blur them into one
  "AI" claim. Each stage names the model that actually ran it, and the
  reasoning stage says so explicitly when it contributed nothing.
-->
<div class="pipe" id="pipe" aria-label="Model pipeline" data-i18n-aria="aria.pipeline">
  <ol class="pipe-steps">
    <li class="pipe-step" id="pipe-1">
      <span class="pipe-n">01</span>
      <span class="pipe-k">SEE</span>
      <span class="pipe-model" id="pipe-vision-model" data-latin>-</span>
      <span class="pipe-note" id="pipe-vision-note">not run yet</span>
    </li>
    <li class="pipe-step" id="pipe-2">
      <span class="pipe-n">02</span>
      <span class="pipe-k">COMPARE</span>
      <span class="pipe-model" id="pipe-compare-model">SiteLens deterministic engine</span>
      <span class="pipe-note" id="pipe-compare-note">no expected state loaded</span>
    </li>
    <li class="pipe-step" id="pipe-3">
      <span class="pipe-n">03</span>
      <span class="pipe-k">UNDERSTAND</span>
      <span class="pipe-model" id="pipe-reason-model" data-latin>-</span>
      <span class="pipe-note" id="pipe-reason-note">not run yet</span>
    </li>
    <li class="pipe-step" id="pipe-4">
      <span class="pipe-n">04</span>
      <span class="pipe-k">VERIFY</span>
      <span class="pipe-model" id="pipe-verify-model">Named human</span>
      <span class="pipe-note" id="pipe-verify-note">nothing verified</span>
    </li>
  </ol>
</div>

<div class="notice" id="notice" role="status" aria-live="polite"></div>

<dialog class="modal" id="proj-modal" aria-labelledby="proj-modal-h">
  <form method="dialog" class="modal-card" id="proj-form">
    <h2 class="modal-h" id="proj-modal-h">New project</h2>
    <label class="field">
      <span class="field-t" id="proj-label-name">Project name</span>
      <input type="text" id="proj-input-name" maxlength="80" required autocomplete="off">
    </label>
    <label class="field">
      <span class="field-t">Location <span class="field-opt">optional</span></span>
      <input type="text" id="proj-input-location" maxlength="120" autocomplete="off">
    </label>
    <p class="modal-note" id="proj-modal-note" hidden></p>
    <div class="modal-acts">
      <button type="button" class="btn btn-ghost" id="proj-cancel">Cancel</button>
      <button type="submit" class="btn" id="proj-save">Create project</button>
    </div>
  </form>
</dialog>

<dialog class="modal" id="preset-modal" aria-labelledby="preset-modal-h">
  <form method="dialog" class="modal-card" id="preset-form">
    <h2 class="modal-h" id="preset-modal-h">New reference</h2>
    <label class="field">
      <span class="field-t">Reference name</span>
      <input type="text" id="preset-input-name" maxlength="60" required autocomplete="off">
    </label>
    <label class="field">
      <span class="field-t">Zone</span>
      <input type="text" id="preset-input-zone" maxlength="60" required autocomplete="off">
    </label>
    <div class="field">
      <span class="field-t">Expected elements</span>
      <div id="preset-items" class="preset-items"></div>
      <button type="button" class="btn btn-ghost btn-xs" id="preset-add">Add element</button>
    </div>
    <p class="modal-note" id="preset-modal-note" hidden></p>
    <div class="modal-acts">
      <button type="button" class="btn btn-ghost" id="preset-cancel">Cancel</button>
      <button type="submit" class="btn" id="preset-save">Create reference</button>
    </div>
  </form>
</dialog>

<dialog class="modal" id="del-modal" aria-labelledby="del-modal-h">
  <div class="modal-card">
    <h2 class="modal-h" id="del-modal-h">Delete project</h2>
    <p class="modal-body" id="del-body">This cannot be undone.</p>
    <div class="modal-acts">
      <button type="button" class="btn btn-ghost" id="del-cancel">Cancel</button>
      <button type="button" class="btn btn-red" id="del-confirm">Delete</button>
    </div>
  </div>
</dialog>

<dialog class="modal" id="reviewer-modal" aria-labelledby="reviewer-modal-h">
  <form method="dialog" class="modal-card" id="reviewer-form">
    <h2 class="modal-h" id="reviewer-modal-h">SET UP INSPECTION REVIEWER</h2>
    <p class="modal-sub" id="reviewer-modal-sub">
      Human verification is part of the SiteLens inspection workflow. Set the reviewer identity once for this inspection workspace.
    </p>
    <label class="field">
      <span class="field-t">Reviewer name</span>
      <input type="text" id="reviewer-input-name" maxlength="80" required autocomplete="off" placeholder="e.g. Takou Rah" data-i18n-ph="reviewer.namePh">
    </label>
    <label class="field">
      <span class="field-t">Role <span class="field-opt">optional</span></span>
      <input type="text" id="reviewer-input-role" maxlength="80" autocomplete="off" placeholder="e.g. Site Engineer" data-i18n-ph="reviewer.rolePh">
    </label>
    <p class="modal-note note-bad" id="reviewer-modal-note" hidden></p>
    <div class="modal-acts">
      <button type="button" class="btn btn-ghost" id="reviewer-cancel">Cancel</button>
      <button type="submit" class="btn" id="reviewer-save">CONTINUE</button>
    </div>
  </form>
</dialog>

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
             aria-label="Drop site photos here, or press Enter to choose files"
             data-i18n-aria="aria.drop">
          <input type="file" id="file" accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg" multiple hidden>
          <div class="drop-inner">
            <span class="drop-mark" aria-hidden="true"></span>
            <p class="drop-title">Drop captures here</p>
            <p class="drop-alt">or</p>
            <button type="button" class="btn btn-ghost" id="pick">Choose photos (multi-select)</button>
            <p class="drop-hint">PNG or JPEG, up to 12 MB each — select one or multiple files</p>
          </div>
        </div>

        <!--
          The photographs of the OPEN inspection.

          This is one inspection, not several. The count is stated so the
          operator can see what they are about to inspect, and each photograph
          can be removed individually. Truth over convenience: a photograph that
          failed is shown as failed rather than dropped from the strip.
        -->
        <section class="imgs" id="imgs" aria-labelledby="imgs-h" hidden>
          <div class="imgs-head">
            <span class="imgs-h" id="imgs-h" data-i18n="imgs.head">Inspection photos</span>
            <span class="imgs-n" id="imgs-n"></span>
          </div>
          <ul class="imgs-list" id="imgs-list"></ul>
          <p class="imgs-note" id="imgs-note"></p>
        </section>

        <p class="note note-bad" id="drop-error" role="alert" hidden></p>

        <div class="loaded" id="loaded" hidden>
          <div class="sheet sheet-sm">
            <img id="capture-image" alt="Construction capture under inspection" data-i18n-alt="img.captureAlt">
            <div class="sheet-overlay" id="overlay-capture"></div>
          </div>
          <div class="loaded-acts">
            <button type="button" class="btn btn-ghost btn-xs" id="replace" data-i18n="imgs.addMore">Add photos</button>
            <button type="button" class="btn btn-ghost btn-xs" id="remove" data-i18n="imgs.remove">Remove</button>
            <button type="button" class="btn btn-primary" id="run" data-i18n="imgs.inspect">Inspect reality</button>
          </div>
          <details class="storage">
            <summary>Storage &amp; persistence</summary>
            <p class="storage-note" id="storage-note">Storage: checking…</p>
          </details>
        </div>

        <div class="fixtures">
          <div class="fixtures-head">
            <p class="fixtures-h">Captures in this project</p>
            <!-- Bulk actions over the project's captures. With one capture, or
                 none, they would be no-ops, so they only appear once there is
                 something to select. -->
            <div class="fixtures-acts" id="fixtures-acts" hidden>
              <button type="button" class="btn btn-ghost btn-xs" id="select-all-captures" data-i18n="imgs.selectAll">Select all</button>
              <button type="button" class="btn btn-ghost btn-xs" id="clear-capture-selection" data-i18n="imgs.clear">Clear</button>
            </div>
          </div>
          <ul class="fixture-list" id="fixture-list"></ul>
          <p class="fixtures-empty" id="capture-empty" hidden>
            No captures in this project yet. Drop a site photograph above, import a
            local dataset image below, or choose a demo capture.
          </p>
        </div>

        <!--
          The local validation dataset.

          This is the path that makes the demo run on REAL construction reality
          rather than a synthetic scene. The labelling is the point: these are
          genuine photographs held on this machine, and importing one makes it a
          real input to a real inspection. It does NOT make it project evidence,
          and nothing in this panel claims it was captured on this site.
        -->
        <section class="dataset" id="dataset" aria-labelledby="dataset-h">
          <div class="dataset-head">
            <h3 class="dataset-h" id="dataset-h">Local dataset</h3>
            <span class="tag" id="dataset-count">-</span>
          </div>
          <p class="dataset-note" id="dataset-note">Checking for a local dataset…</p>
          <div class="dataset-grid" id="dataset-grid"></div>
          <p class="dataset-empty" id="dataset-empty" hidden></p>
          <p class="note note-bad" id="dataset-error" role="alert" hidden></p>
        </section>
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
            <select id="expected-preset" aria-describedby="expected-active"></select>
          </label>
          <p class="ref-active" id="expected-active">No reference selected.</p>

          <ul class="exp-list" id="expected-list"></ul>

          <div class="panel-acts">
            <button type="button" class="btn btn-ghost" id="expected-apply">Apply reference</button>
            <button type="button" class="btn btn-ghost btn-xs" id="expected-new">New reference</button>
            <button type="button" class="btn btn-ghost btn-xs" id="expected-rename">Rename</button>
            <button type="button" class="btn btn-red btn-xs" id="expected-delete" disabled>Delete</button>
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


  <section class="bay bay-run i18n-surface" id="bay-inspect" role="tabpanel"
           data-bay="inspect" aria-labelledby="tab-inspect" lang="en" dir="ltr">
    <div class="bay-head">
      <h2 class="bay-h" data-i18n="panel.inspection">Inspection</h2>
      <p class="bay-sub" id="run-sub" data-i18n="intro.pending">The model has not been asked anything yet.</p>
    </div>

    <div class="status" id="status" role="status" aria-live="polite"
         data-i18n="intro.idle">Capture a site image, then run the inspection.</div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-h" data-i18n="panel.realityBrief">Reality brief</h3>
          <span class="tag" id="brief-verdict">-</span>
        </div>
        <div id="brief"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-h" data-i18n="panel.priorities">Inspection priorities</h3>
          <span class="tag" data-i18n="panel.whereToLook">WHERE TO LOOK</span>
        </div>
        <p class="panel-sub" data-i18n="panel.prioritiesHint">
          Where your inspector should look first. These are not verdicts.
        </p>
        <ol class="prio-list" id="priorities"></ol>
      </div>
    </div>

    <!--
      Which photographs this inspection rests on, and how it was qualified.

      Both belong in one panel because both are provenance: one says what was
      read, the other says which model stage satisfied the NVIDIA requirement.
      The photograph list comes first because it is the thing an auditor checks
      before looking at any number below.
    -->
    <div class="panel">
      <div class="panel-head">
        <h3 class="panel-h" data-i18n="panel.provenance">Provenance &amp; Eligibility</h3>
        <span class="tag" id="basis-n" data-i18n="imgs.count">1 photograph</span>
      </div>
      <ul class="basis" id="basis-list"></ul>
      <dl class="tape tape-wide" id="provenance"></dl>
      <p class="geom" id="geometry-note" hidden></p>
      <!--
        The NVIDIA verdict, and the two model stages behind it.

        The verdict is the headline because it answers the question a judge
        actually asks. Each row underneath names the model that actually ran
        and says plainly whether that row is the qualifying inference: the
        vision model here is genuinely not an NVIDIA model, and this panel says
        so, but that fact never gets to stand in for the run's qualification.
      -->
      <section class="qual" id="qualification" aria-labelledby="qual-h"
               data-requirement="UNKNOWN" hidden>
        <div class="qual-head">
          <span class="qual-k" id="qual-h" data-i18n="panel.nvidiaRequirement">NVIDIA requirement</span>
          <span class="qual-verdict" id="qual-verdict">-</span>
        </div>
        <p class="qual-sub" id="qual-subtitle"></p>
        <ol class="qual-stages" id="qual-stages"></ol>
        <p class="qual-path" id="qual-path"></p>
      </section>
      <div id="failures"></div>
    </div>
  </section>


  <section class="bay bay-obs i18n-surface" id="bay-evidence" role="tabpanel"
           data-bay="evidence" aria-labelledby="tab-evidence" lang="en" dir="ltr">
    <div class="bay-head">
      <h2 class="bay-h" data-i18n="panel.realityEvidence">Reality and evidence</h2>
      <p class="bay-sub" data-i18n="panel.evidenceHint">Select a finding to highlight where on the site it was flagged.</p>
    </div>

    <div class="stage-grid">
      <div class="stage-l">
        <!-- Which photograph of a multi-photo inspection is on screen. The
             inspection rests on all of them at once, so each has to reachable
             with its own evidence boxes; without this the rest of the group is
             invisible even though its evidence is in the result. -->
        <div class="photo-switcher" id="photo-switcher" hidden>
          <span class="photo-switcher-lbl" data-i18n="imgs.evidencePhotos">Inspection photos:</span>
          <div class="photo-switcher-tabs" id="photo-switcher-tabs" role="tablist"></div>
        </div>
        <div class="sheet sheet-lg" id="sheet-evidence">
          <img id="evidence-image" alt="Construction reality capture with evidence overlays" data-i18n-alt="img.evidenceAlt">
          <div class="sheet-overlay" id="overlay"></div>
          <div class="sheet-cal" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        </div>
        <p class="stage-cap" id="stage-cap" data-i18n="stage.noCapture">No capture loaded.</p>
      </div>

      <aside class="stage-r" aria-label="Inspection summary" data-i18n-aria="aria.summary">
        <div class="rail">
          <p class="rail-h" data-i18n="rail.reality">REALITY</p>
          <p class="rail-v" id="rail-elements">-</p>
          <p class="rail-n" data-i18n="rail.elementsDetected">elements detected</p>
        </div>
        <div class="rail">
          <p class="rail-h" data-i18n="rail.inspection">INSPECTION</p>
          <p class="rail-v" id="rail-attention">-</p>
          <p class="rail-n" data-i18n="rail.attentionAreas">attention areas</p>
        </div>
        <div class="rail">
          <p class="rail-h" data-i18n="rail.findings">FINDINGS</p>
          <p class="rail-v" id="rail-findings">-</p>
          <p class="rail-n" id="rail-findings-n" data-i18n="rail.awaitingReview">awaiting review</p>
        </div>
        <div class="rail">
          <p class="rail-h" data-i18n="rail.confidence">CONFIDENCE</p>
          <p class="rail-v" id="rail-confidence">-</p>
          <p class="rail-n" data-i18n="rail.highestFinding">highest finding</p>
        </div>
        <div class="rail rail-verdict" id="rail-verdict">
          <p class="rail-h" data-i18n="rail.overall">OVERALL</p>
          <p class="rail-v" id="rail-overall">-</p>
        </div>
      </aside>
    </div>

    <div class="review-bar">
      <div class="reviewer-status-box" id="reviewer-status-box">
        <div class="reviewer-status-info">
          <span class="reviewer-lbl" data-i18n="panel.reviewer">INSPECTION REVIEWER</span>
          <span class="reviewer-val" id="reviewer-current-val" data-i18n="panel.reviewerUnset">Not configured</span>
        </div>
        <button type="button" class="btn btn-ghost btn-xs" id="reviewer-change-btn"
                data-i18n="panel.setReviewer">Set reviewer</button>
      </div>
      <label class="field">
        <span class="field-t" data-i18n="panel.verificationNote">Verification note</span>
        <input type="text" id="note" placeholder="optional review note" autocomplete="off" data-i18n-ph="panel.notePh">
      </label>
    </div>

    <div class="trust" id="trust-line">
      <span class="trust-tag" data-i18n="panel.trustSuspected">AI_SUSPECTED</span>
      <span class="trust-arrow" aria-hidden="true" data-i18n="panel.trustTo">to</span>
      <span class="trust-tag" id="trust-state" data-i18n="panel.trustUnverified">UNVERIFIED</span>
      <span class="trust-note" data-i18n="panel.trustNote">Confidence never verifies itself.</span>
    </div>

    <!--
      Stage 2, and the reason this product is more than an object detector.

      WHAT IT MEANS comes from Nemotron and is shown as its own stage with its own
      provenance, never merged into the comparison. When the stage could not run,
      that is stated here in as many words: a missing reasoning stage must never
      read as an absence of problems.
    -->
    <section class="reason" id="reason" aria-labelledby="reason-h" data-status="UNAVAILABLE">
      <div class="reason-head">
        <h3 class="reason-h" id="reason-h" data-i18n="panel.stageReasoningHeading">Construction reasoning</h3>
        <span class="tag" id="reason-stage" data-i18n="panel.stageReasoningNotRun">NOT RUN</span>
        <span class="reason-model" id="reason-model" data-latin>-</span>
      </div>
      <p class="reason-lede" id="reason-lede" data-i18n="reasoning.notRun">
        Run the inspection to have Nemotron reason about what the evidence does
        and does not establish.
      </p>
      <dl class="reason-grid" id="reason-grid"></dl>
      <div class="reason-fail" id="reason-fail" hidden></div>
      <p class="reason-foot" id="reason-foot" hidden></p>
    </section>

    <div id="findings-cards"></div>
  </section>

  <section class="bay bay-find i18n-surface" id="bay-findings" role="tabpanel"
           data-bay="findings" aria-labelledby="tab-findings" lang="en" dir="ltr">
    <div class="bay-head">
      <h2 class="bay-h" data-i18n="panel.findingsAndVerification">Findings and verification</h2>
      <p class="bay-sub" data-i18n="panel.findingsHint">Every AI finding needs a named person to confirm, reject or defer it.</p>
    </div>
    <div id="findings"></div>
  </section>

</main>

<footer class="foot">
  <span class="foot-thesis" data-i18n="foot.thesis">AI does not replace the inspector. It tells the inspector where to look.</span>
  <span class="foot-r" data-i18n="foot.local">Local inspection surface. Loopback only.</span>
</footer>

<script src="/app.js"></script>
</body>
</html>`;

