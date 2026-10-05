/**
 * The inspector stylesheet.
 *
 * Survey paper, concrete, graphite and a single instrument red reserved for
 * attention. No gradients, no glass, no AI ornament: every rule on screen is
 * there to separate a measurement from a claim.
 */

export const APP_CSS = `/* ==========================================================================
   AI REALITY INSPECTOR
   Concrete before gradients. Geometry before decoration.
   ========================================================================== */
:root {
  --paper:        #EFEBE3;
  --paper-2:      #E7E2D7;
  --paper-3:      #DED8CB;
  --concrete:     #D8D2C6;
  --concrete-2:   #C6BFB1;

  --ink:          #1C1B19;
  --ink-2:        #45423D;
  --ink-3:        #6E6960;
  --ink-4:        #948D82;

  --rule:         #C9C2B4;
  --rule-2:       #B4AC9C;
  --rule-hair:    #D8D2C6;

  --red:          #C8102E;
  --red-deep:     #8E0B21;
  --red-wash:     rgba(200, 16, 46, .09);
  --red-line:     rgba(200, 16, 46, .38);

  --verify:       #1F6F43;
  --verify-wash:  rgba(31, 111, 67, .10);
  --review:       #9A6700;
  --review-wash:  rgba(154, 103, 0, .11);
  --reject:       #7A1F1F;
  --reject-wash:  rgba(122, 31, 31, .09);
  --neutral:      #6E6960;
  --neutral-wash: rgba(110, 105, 96, .09);

  --sans: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;

  --ease: cubic-bezier(.2, .7, .3, 1);
  --fast: 160ms;

  --shell: 1600px;
  --gap: 1px;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* Paper tooth: fixed, so it reads as the sheet rather than as content. */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: .55;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)' opacity='.05'/%3E%3C/svg%3E");
}

.skip {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 90;
  padding: 10px 18px;
  background: var(--ink);
  color: var(--paper);
  font-weight: 600;
}
.skip:focus { left: 0; }

:focus { outline: none; }
:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}

.rig {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  min-height: 54px;
  background: var(--paper-2);
  border-bottom: 1px solid var(--rule-2);
  box-shadow: 0 1px 0 rgba(28, 27, 25, .06);
  flex-wrap: wrap;
}

.rig-id { display: flex; align-items: baseline; gap: 9px; }

.rig-mark {
  width: 10px; height: 10px;
  align-self: center;
  background: var(--red);
  box-shadow: 0 0 0 3px var(--red-wash);
}

.rig-name {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.rig-org {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-4);
  letter-spacing: .12em;
  text-transform: uppercase;
}

.rig-meta { display: flex; gap: 18px; }
.rig-meta-i { display: flex; align-items: baseline; gap: 6px; font-family: var(--mono); font-size: 10.5px; }
.rig-meta-i b { color: var(--ink-4); letter-spacing: .1em; font-weight: 500; }
.rig-meta-i span { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }

.rig-nav { margin-left: auto; display: flex; }

/* Workflow steps are tabs: exactly one is selected and exactly one panel shows.
   The selected state is carried by a colour AND a rule, never colour alone. */
.step {
  display: flex;
  align-items: baseline;
  gap: 7px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 0 15px 0 0;
  margin-right: 15px;
  cursor: pointer;
  color: var(--ink-4);
  font-family: var(--sans);
  transition: color var(--fast) var(--ease), border-color var(--fast) var(--ease);
}
.step:hover { color: var(--ink-2); }
.step[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--red); }

.step-n {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.step[aria-selected="true"] .step-n { color: var(--red); }
.step-t { font-size: 12.5px; font-weight: 500; }

.rig-state { display: flex; align-items: center; gap: 8px; }

.rig-state-t {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-2);
  white-space: nowrap;
}

.lamp {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--ink-4);
  transition: background var(--fast) var(--ease), box-shadow var(--fast) var(--ease);
}
.lamp[data-lamp="ready"]   { background: var(--neutral); }
.lamp[data-lamp="working"] { background: var(--red); box-shadow: 0 0 0 4px var(--red-wash); animation: pulse 1.3s var(--ease) infinite; }
.lamp[data-lamp="done"]    { background: var(--verify); box-shadow: 0 0 0 3px var(--verify-wash); }
.lamp[data-lamp="problem"] { background: var(--reject); box-shadow: 0 0 0 3px var(--reject-wash); }
@keyframes pulse { 50% { opacity: .35; } }

.ident {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 20px;
  background: var(--paper-3);
  border-bottom: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 10.5px;
  flex-wrap: wrap;
}
.ident-k { color: var(--ink-4); letter-spacing: .1em; text-transform: uppercase; }
.ident-v { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }

.ident-synth {
  margin-left: auto;
  padding: 3px 9px;
  background: var(--review-wash);
  border: 1px solid var(--review);
  color: var(--review);
  letter-spacing: .08em;
  font-weight: 600;
}
.ident-synth[hidden] { display: none; }

/* A cached AI answer is real but not fresh, so it is badged separately from a
   live call. Never shown alongside the synthetic-fixture badge. */
.ident-cache {
  margin-left: auto;
  padding: 3px 9px;
  background: var(--neutral-wash);
  border: 1px solid var(--ink-3);
  color: var(--ink-2);
  letter-spacing: .06em;
  font-weight: 600;
}
.ident-cache[hidden] { display: none; }
.ident-synth:not([hidden]) + .ident-cache { margin-left: 10px; }

.cache-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 14px;
  color: var(--ink-3);
  cursor: pointer;
  letter-spacing: .04em;
}
.cache-toggle input { margin: 0; accent-color: var(--red); }

.notice {
  position: relative;
  z-index: 1;
  margin: 0;
  padding: 0 20px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
.notice:not(:empty) {
  padding: 9px 20px;
  background: var(--review-wash);
  border-bottom: 1px solid var(--rule);
  color: var(--review);
}
.notice[data-tone="bad"] { background: var(--reject-wash); color: var(--reject); }
.notice[data-tone="good"] { background: var(--verify-wash); color: var(--verify); }

.stage {
  position: relative;
  z-index: 1;
  max-width: var(--shell);
  margin: 0 auto;
  padding: var(--gap);
  background: var(--rule);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap);
  align-content: start;
}

.bay { background: var(--paper); padding: 20px; min-width: 0; }
.bay[hidden] { display: none; }

.bay-head { margin-bottom: 16px; }
.bay-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
}
.bay-sub { margin: 4px 0 0; color: var(--ink-3); font-size: 12.5px; max-width: 78ch; }

.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.split-l, .split-r { min-width: 0; }
.grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--gap); margin-bottom: var(--gap); }

@media (max-width: 900px) {
  .split, .grid-2 { grid-template-columns: minmax(0, 1fr); }
  .rig-meta { display: none; }
}

.drop {
  border: 1px dashed var(--rule-2);
  background: var(--paper-2);
  padding: 22px;
  cursor: pointer;
  transition: border-color var(--fast) var(--ease), background var(--fast) var(--ease);
}
.drop:hover, .drop:focus-visible { border-color: var(--ink-3); background: var(--concrete); }
.drop[data-over="true"] { border-color: var(--red); background: var(--red-wash); }
.drop-inner { text-align: center; }
.drop-mark {
  display: block;
  width: 26px; height: 26px;
  margin: 0 auto 10px;
  border: 1px solid var(--ink-4);
  background:
    linear-gradient(var(--ink-4), var(--ink-4)) center/1px 100% no-repeat,
    linear-gradient(var(--ink-4), var(--ink-4)) center/100% 1px no-repeat;
}
.drop-title { margin: 0; font-family: var(--mono); font-size: 12px; font-weight: 600; }
.drop-alt { margin: 6px 0; color: var(--ink-4); font-size: 11px; }
.drop-hint { margin: 10px 0 0; color: var(--ink-4); font-family: var(--mono); font-size: 10.5px; }

.loaded[hidden] { display: none; }
.loaded-acts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

.fixtures { margin-top: 16px; }
.fixtures-h {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.fixture-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.fixture {
  display: block; width: 100%; text-align: left;
  padding: 9px 11px;
  background: var(--paper-2);
  border: 0;
  cursor: pointer;
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink-2);
  transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
}
.fixture:hover { background: var(--concrete); color: var(--ink); }
.fixture[aria-current="true"] { background: var(--paper); color: var(--ink); box-shadow: inset 3px 0 0 var(--red); }
.fixture small { display: block; color: var(--ink-4); font-family: var(--mono); font-size: 10px; margin-top: 2px; }

.panel {
  border: 1px solid var(--rule);
  background: var(--paper-2);
  padding: 14px;
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.panel-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.panel-head .tag { margin-left: auto; }
.panel-sub { margin: 0 0 12px; color: var(--ink-3); font-size: 12px; max-width: 70ch; }
.panel-acts { margin-top: 12px; display: flex; gap: 8px; }

.tag {
  display: inline-block;
  padding: 2px 7px;
  border: 1px solid var(--rule-2);
  background: var(--paper);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .08em;
  color: var(--ink-3);
  white-space: nowrap;
}
.tag-verify { border-color: var(--verify); color: var(--verify); background: var(--verify-wash); }
.tag-attention { border-color: var(--red); color: var(--red); background: var(--red-wash); }
.tag-review { border-color: var(--review); color: var(--review); background: var(--review-wash); }
.tag-reject { border-color: var(--reject); color: var(--reject); background: var(--reject-wash); }
.tag-ai { border-color: var(--ink-3); color: var(--ink-2); background: var(--neutral-wash); }

.field { display: block; margin-bottom: 10px; }
.field-t {
  display: block;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-4);
  margin-bottom: 4px;
}
.field input[type="text"], .field select, .exp-row input, .exp-row select {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--rule-2);
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 12.5px;
}
.field input:focus-visible, .field select:focus-visible,
.exp-row input:focus-visible, .exp-row select:focus-visible { border-color: var(--red); }

.exp-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.exp-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) 96px 66px;
  gap: 6px;
  padding: 8px;
  background: var(--paper);
  align-items: center;
}
.exp-row input, .exp-row select { padding: 5px 7px; font-size: 12px; }
.exp-count[disabled] { opacity: .4; }

.note { margin: 10px 0 0; font-size: 11.5px; color: var(--ink-4); max-width: 70ch; }
.note-bad { color: var(--reject); }

.panel-cmp { margin-top: 14px; }

.cmp-list { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.cmp { background: var(--paper); padding: 9px 11px; box-shadow: inset 3px 0 0 var(--ink-4); }
.cmp[data-status="MATCH"] { box-shadow: inset 3px 0 0 var(--verify); }
.cmp[data-status="ATTENTION"] { box-shadow: inset 3px 0 0 var(--red); }
.cmp[data-status="UNDETERMINED"] { box-shadow: inset 3px 0 0 var(--review); }
.cmp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cmp-el { font-family: var(--mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.cmp-tag { margin-left: auto; }
.cmp[data-status="MATCH"] .cmp-tag { border-color: var(--verify); color: var(--verify); }
.cmp[data-status="ATTENTION"] .cmp-tag { border-color: var(--red); color: var(--red); background: var(--red-wash); }
.cmp[data-status="UNDETERMINED"] .cmp-tag { border-color: var(--review); color: var(--review); background: var(--review-wash); }

.cmp-grid { margin: 0; display: grid; gap: 3px; }
.cmp-pair { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; }
.cmp-pair dt {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .1em;
  color: var(--ink-4);
  padding-top: 2px;
}
.cmp-pair dd { margin: 0; font-size: 12px; color: var(--ink-2); }

.btn {
  padding: 7px 13px;
  border: 1px solid var(--rule-2);
  background: var(--paper);
  color: var(--ink-2);
  font-family: var(--sans);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast) var(--ease), color var(--fast) var(--ease), border-color var(--fast) var(--ease);
}
.btn:hover:not(:disabled) { background: var(--concrete); color: var(--ink); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-ghost { background: transparent; }
.btn-red { border-color: var(--red); color: var(--red); background: var(--red-wash); font-weight: 600; }
.btn-red:hover:not(:disabled) { background: var(--red); color: var(--paper); }
.btn-verify { border-color: var(--verify); color: var(--verify); background: var(--verify-wash); }
.btn-verify:hover:not(:disabled) { background: var(--verify); color: var(--paper); }
.btn-reject { border-color: var(--reject); color: var(--reject); }
.btn-reject:hover:not(:disabled) { background: var(--reject); color: var(--paper); }

.sheet {
  position: relative;
  border: 1px solid var(--rule-2);
  background: var(--concrete);
  overflow: hidden;
  line-height: 0;
}
.sheet img { width: 100%; height: auto; display: block; }
.sheet-sm img { max-height: 300px; object-fit: contain; }
/* A minimum height keeps the stage readable if an image ever fails to load,
   instead of collapsing the whole inspection surface into a one-line strip. */
.sheet-lg img { max-height: 620px; min-height: 300px; object-fit: contain; }

.sheet-overlay { position: absolute; inset: 0; pointer-events: none; }
.sheet-overlay:empty { display: none; }

/* Corner registration marks: the frame reads as a measured image. */
.sheet-cal { position: absolute; inset: 0; pointer-events: none; }
.sheet-cal i { position: absolute; width: 14px; height: 14px; border: 1px solid rgba(255,255,255,.5); }
.sheet-cal i:nth-child(1) { top: 8px; left: 8px; border-right: 0; border-bottom: 0; }
.sheet-cal i:nth-child(2) { top: 8px; right: 8px; border-left: 0; border-bottom: 0; }
.sheet-cal i:nth-child(3) { bottom: 8px; left: 8px; border-right: 0; border-top: 0; }
.sheet-cal i:nth-child(4) { bottom: 8px; right: 8px; border-left: 0; border-top: 0; }

/* Evidence boxes are drawn ONLY from real model geometry. */
.ev {
  position: absolute;
  border: 1.5px solid var(--red);
  background: var(--red-wash);
  pointer-events: auto;
  cursor: pointer;
  transition: background var(--fast) var(--ease), border-color var(--fast) var(--ease);
}
.ev[data-status="MATCH"] { border-color: var(--verify); background: var(--verify-wash); }
.ev[data-status="UNDETERMINED"] { border-color: var(--ink-3); background: transparent; border-style: dashed; }
.ev[data-origin="COMPARISON"] { border-width: 2px; }
.ev[data-origin="AI"] { border-style: dotted; border-width: 2px; }
.ev:hover, .ev[data-active="true"] { background: rgba(200,16,46,.22); border-color: var(--red); }
.ev-n {
  position: absolute;
  top: -9px; left: -9px;
  min-width: 18px; height: 18px;
  display: grid; place-items: center;
  padding: 0 4px;
  background: var(--ink);
  color: var(--paper);
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1;
}
.ev[data-active="true"] .ev-n { background: var(--red); }

.stage-cap { margin: 8px 0 0; font-family: var(--mono); font-size: 10.5px; color: var(--ink-4); }

.stage-grid { display: grid; grid-template-columns: minmax(0, 1fr) 206px; gap: 18px; align-items: start; }
.stage-l { min-width: 0; }
.stage-r { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }

@media (max-width: 820px) { .stage-grid { grid-template-columns: minmax(0, 1fr); } }

.rail { background: var(--paper-2); padding: 11px 13px; }
.rail-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .12em;
  color: var(--ink-4);
}
.rail-v {
  margin: 3px 0 0;
  font-family: var(--mono);
  font-size: 25px;
  font-weight: 700;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.rail-n { margin: 2px 0 0; font-size: 10.5px; color: var(--ink-3); }
.rail-verdict .rail-v { font-size: 13px; letter-spacing: .04em; }
.rail-verdict[data-overall="ATTENTION_REQUIRED"] .rail-v { color: var(--red); }
.rail-verdict[data-overall="REVIEW_SUGGESTED"] .rail-v { color: var(--review); }
.rail-verdict[data-overall="NO_ATTENTION"] .rail-v { color: var(--verify); }

.trust {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 14px 0 0;
  padding: 9px 12px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
  font-family: var(--mono);
  font-size: 10px;
}
.trust-tag {
  padding: 2px 8px;
  border: 1px solid var(--ink-4);
  color: var(--ink-2);
  letter-spacing: .08em;
}
.trust-tag[data-status="VERIFIED"] { border-color: var(--verify); color: var(--verify); background: var(--verify-wash); }
.trust-tag[data-status="REJECTED"] { border-color: var(--reject); color: var(--reject); background: var(--reject-wash); }
.trust-tag[data-status="NEEDS_REVIEW"] { border-color: var(--review); color: var(--review); background: var(--review-wash); }
.trust-arrow { color: var(--ink-4); }
.trust-note { margin-left: auto; color: var(--ink-4); letter-spacing: .04em; }

.review-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 220px)); gap: 10px; margin: 12px 0 0; }

.finding-card {
  border: 1px solid var(--rule);
  background: var(--paper-2);
  margin-top: var(--gap);
}
.finding-card[data-active="true"] { border-color: var(--red); box-shadow: 0 0 0 1px var(--red-line); }
.finding-card[data-status="VERIFIED"] { border-left: 3px solid var(--verify); }
.finding-card[data-status="REJECTED"] { border-left: 3px solid var(--reject); opacity: .72; }
.finding-card[data-status="NEEDS_REVIEW"] { border-left: 3px solid var(--review); }

.fc-head {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  padding: 10px 12px;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  background: var(--paper);
}
.fc-id { font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.fc-title { font-size: 13px; font-weight: 600; }
.fc-tail { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.fc-body { display: none; }
.finding-card[data-open="true"] .fc-body { display: block; }

.fc-row {
  display: grid;
  grid-template-columns: 138px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--rule-hair);
}
.fc-row dt {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-4);
  padding-top: 2px;
}
.fc-row dd { margin: 0; font-size: 12.5px; color: var(--ink-2); }
.fc-row[data-k="confidence"] dd { font-family: var(--mono); }

.conf-track {
  display: inline-block;
  width: 84px; height: 6px;
  background: var(--concrete-2);
  vertical-align: middle;
  margin-right: 8px;
}
.conf-fill { display: block; height: 100%; background: var(--red); }
.conf-fill[data-band="MEDIUM"] { background: var(--review); }
.conf-fill[data-band="LOW"] { background: var(--ink-4); }

.fc-row[data-k="evidence"] { background: var(--paper-3); }
.fc-row[data-k="evidence"] dd { color: var(--ink-3); font-size: 12px; }

.fc-noev {
  padding: 8px 12px;
  border-bottom: 1px solid var(--rule-hair);
  background: var(--paper-3);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-4);
}

.fc-acts {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 11px 12px;
  background: var(--paper-3);
}
.fc-acts-lbl {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  color: var(--ink-4);
}
.fc-settled {
  padding: 11px 12px;
  background: var(--verify-wash);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--verify);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.fc-settled[data-status="REJECTED"] { background: var(--reject-wash); color: var(--reject); }
.fc-settled[data-status="NEEDS_REVIEW"] { background: var(--review-wash); color: var(--review); }

.brief-line {
  font-family: var(--mono);
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px solid var(--rule-hair);
  color: var(--ink-2);
}
.brief-line:last-child { border-bottom: 0; }
.brief-line[data-lead="true"] { font-weight: 700; color: var(--ink); letter-spacing: .02em; }

.prio-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.prio {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 9px;
  padding: 9px 10px;
  background: var(--paper);
  align-items: start;
}
.prio-n { font-family: var(--mono); font-size: 11px; color: var(--ink-4); font-variant-numeric: tabular-nums; }
.prio-t { font-size: 12.5px; font-weight: 500; }
.prio-b { font-family: var(--mono); font-size: 10px; color: var(--ink-4); margin-top: 2px; }
.prio[data-attention="HIGH"] { box-shadow: inset 3px 0 0 var(--red); }
.prio[data-attention="MEDIUM"] { box-shadow: inset 3px 0 0 var(--review); }

.status {
  padding: 10px 12px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-2);
  margin-bottom: var(--gap);
}
.status[data-tone="working"] { border-color: var(--red); background: var(--red-wash); color: var(--red-deep); }
.status[data-tone="good"] { border-color: var(--verify); background: var(--verify-wash); color: var(--verify); }
.status[data-tone="bad"] { border-color: var(--reject); background: var(--reject-wash); color: var(--reject); }

.tape {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.tape div { background: var(--paper); padding: 7px 9px; }
.tape dt {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.tape dd {
  margin: 2px 0 0;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

.elig {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--review);
  background: var(--review-wash);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--review);
}

.fail {
  margin-top: var(--gap);
  border: 1px solid var(--reject);
  background: var(--reject-wash);
  padding: 11px;
}
.fail-h { margin: 0 0 6px; font-family: var(--mono); font-size: 11px; color: var(--reject); font-weight: 700; }
.fail ul { margin: 0; padding-left: 16px; font-family: var(--mono); font-size: 10.5px; color: var(--reject); }

.empty {
  padding: 18px;
  border: 1px dashed var(--rule-2);
  text-align: center;
  color: var(--ink-4);
  font-size: 12.5px;
}

.obs {
  border: 1px solid var(--rule);
  background: var(--paper-2);
  padding: 11px;
  margin-top: var(--gap);
}
.obs-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.obs-n { font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.obs-cat { font-family: var(--mono); font-size: 10px; letter-spacing: .06em; color: var(--ink-2); }
.obs-head .conf { margin-left: auto; display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 10px; color: var(--ink-3); }
.obs-text { margin: 7px 0 0; font-size: 12.5px; }
.obs-ev { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-3); }
.obs-ev b { font-family: var(--mono); font-size: 9.5px; letter-spacing: .1em; color: var(--ink-4); }
.obs-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; align-items: center; }
.obs-next { font-family: var(--mono); font-size: 10px; color: var(--ink-4); margin-right: auto; }

.finding {
  border: 1px solid var(--rule);
  background: var(--paper-2);
  padding: 11px;
  margin-top: var(--gap);
}
.finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.finding-cat { font-family: var(--mono); font-size: 10px; letter-spacing: .06em; }
.finding-meta { margin: 6px 0 0; font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.finding-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }

.foot {
  position: relative;
  z-index: 1;
  max-width: var(--shell);
  margin: 0 auto;
  padding: 14px 20px 26px;
  display: flex;
  gap: 16px;
  align-items: baseline;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-4);
}
.foot-thesis { color: var(--ink-2); font-weight: 600; letter-spacing: .02em; }
.foot-r { margin-left: auto; }
`;
