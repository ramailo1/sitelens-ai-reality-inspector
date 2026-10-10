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

  /* Stage roles on the qualification card. A qualifying inference, a stage that
     ran on a model the hackathon does not require, and the platform the call
     went through are three different claims and are never given one colour. */
  --info:         #2C6E9B;
  --info-wash:    rgba(44, 110, 155, .11);
  --stage:        #5B4A9E;
  --stage-wash:   rgba(91, 74, 158, .11);

  --sans: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;

  --ease: cubic-bezier(.2, .7, .3, 1);
  --fast: 160ms;

  --shell: 1600px;
  --gap: 1px;
}

* { box-sizing: border-box; }
/* One rule, once. Elements toggled with the hidden attribute are laid out by
   their own class rules (flex, grid), which would otherwise beat the attribute
   and leave "hidden" bands on screen. Specificity cannot fix this reliably, so
   the attribute wins outright. */
[hidden] { display: none !important; }
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

/* Prose blocks and titles break lines gracefully instead of leaving orphans. */
.bay-sub, .panel-sub, .reason-lede, .modal-body, .dataset-note,
.fc-title, .prio-t, .cmp-pair dd, .obs-text {
  text-wrap: pretty;
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
  /* Above every band below it. The project menu (.proj-menu) is absolutely
     positioned INSIDE this element, so it can never paint above a sibling that
     shares or beats this element's own stacking level: .rig is a stacking
     context because it is positioned with a z-index, and the menu's own z-index
     is confined inside it. .pipe used to be z-index 2 as well and comes later in
     the document, so it painted over the open menu however high the menu's
     z-index was. Raising the header fixes the cause rather than fighting it. */
  z-index: 5;
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

/* The open-photograph count and the names behind it.
   The summary is the whole closed state, so it must not widen with the list:
   a masthead that grows with the selection pushes the reviewer and the project
   selector off the strip. The list is absolutely positioned for the same
   reason, and the header sits above the bands below it so it can paint over
   them instead of being clipped by them. */
.rig-disclose { position: relative; }
.rig-summary {
  list-style: none;
  cursor: pointer;
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  border-bottom: 1px dotted var(--ink-3);
}
.rig-summary::-webkit-details-marker { display: none; }
.rig-summary::marker { content: ""; }
.rig-summary:hover { border-bottom-color: var(--ink); }
.rig-summary:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
.rig-disclose-h { color: var(--ink-4); font-size: 9.5px; }
.rig-disclose-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 260px;
  max-width: 460px;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: 6px 0;
  list-style: none;
  background: var(--paper);
  border: 1px solid var(--rule-2);
  box-shadow: 0 6px 18px rgba(28, 27, 25, .18);
}
.rig-disclose-list li {
  padding: 4px 10px;
  font-size: 10.5px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

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
.ident-k { color: var(--ink-3); letter-spacing: .1em; text-transform: uppercase; }
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
/* --ink-3, not --ink-4: this hint states the real accepted formats and size
   limit, so it is information rather than decoration and has to clear AA. */
.drop-hint { margin: 10px 0 0; color: var(--ink-3); font-family: var(--mono); font-size: 10.5px; }

/* Native dropdown chrome draws its own box and arrow, which fights the crafted
   surface. The arrow is drawn here instead so the control keeps its affordance. */
.field select, .exp-row select, .preset-item select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='6'%3E%3Cpath d='M1 1l3.5 3.5L8 1' fill='none' stroke='%2345423D' stroke-width='1.4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  padding-right: 26px;
}

.loaded[hidden] { display: none; }
.loaded-acts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

.fixtures { margin-top: 16px; }
.fixtures-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.fixtures-head .fixtures-h { margin-bottom: 0; }
.fixtures-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.fixtures-h {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.fixture-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }

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
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-ghost { background: transparent; }
/* The one PRIMARY action of a context. Solid ink, no outline: red is reserved
   for attention and destruction, so the main action can no longer be mistaken
   for a warning alongside the buttons that delete things. */
.btn-primary { background: var(--ink); border-color: var(--ink); color: var(--paper); font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--ink-2); border-color: var(--ink-2); color: var(--paper); }
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
.sheet-sm img { max-height: 360px; object-fit: contain; }
/* A minimum height keeps the stage readable if an image ever fails to load,
   instead of collapsing the whole inspection surface into a one-line strip. */
.sheet-lg img { max-height: 620px; min-height: 300px; object-fit: contain; }

/* Display-only 180-degree correction for captures whose source EXIF tag was
   accurate (orientation 3/4): the stored pixels are upside down, the bytes stay
   untouched, and renderOverlay flips evidence boxes to match. */
.img-flip180 { transform: rotate(180deg); }

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

/* The photographs of one inspection. An inspection can rest on several
   photographs, and the evidence stage has to be able to show each one with its
   own boxes: without this the operator can only ever see one frame of a group
   and the rest of the evidence is unreachable. */
.photo-switcher {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 8px;
}
.photo-switcher-lbl {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.photo-switcher-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.photo-tab {
  font-family: var(--mono);
  font-size: 10.5px;
  padding: 4px 9px;
  border: 1px solid var(--rule-2);
  background: var(--paper-2);
  color: var(--ink-2);
  cursor: pointer;
  transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
}
.photo-tab:hover { background: var(--concrete); color: var(--ink); }
.photo-tab.active { background: var(--ink); border-color: var(--ink); color: var(--paper); }
/* The sheet holds image coordinate space, not text: it must never mirror with
   the paragraph, whatever direction the surrounding surface reads in. */
.sheet { direction: ltr; }

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

.hdr-rev-btn {
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.hdr-rev-btn:hover { color: var(--ink); }

.review-bar { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 12px; margin: 12px 0 0; align-items: end; }

.reviewer-status-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
}
.reviewer-status-info { display: flex; flex-direction: column; gap: 2px; }
.reviewer-lbl { font-family: var(--mono); font-size: 9px; letter-spacing: .08em; color: var(--ink-4); }
.reviewer-val { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.reviewer-status-box[data-configured="false"] .reviewer-val { color: var(--red); font-style: italic; font-weight: 500; }

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
.fc-noev b { letter-spacing: .08em; color: var(--ink-3); }
/* Full-frame evidence still IS evidence, so it reads one shade stronger than
   the no-evidence state, which must read as an admitted gap, not a warning. */
.fc-noev[data-state="FULL_FRAME"] { color: var(--ink-3); }

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
  cursor: pointer;
  transition: background var(--fast) var(--ease);
}
.prio:hover { background: var(--paper-3); }
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
  padding: 16px 18px;
  border: 1px dashed var(--rule-2);
  text-align: center;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
  max-width: 62ch;
}

/* An empty message inside a hairline list must not inherit the list's rule
   background, or the message renders as a heavy gray slab. */
.prio-list:has(> .empty),
.cmp-list:has(> .empty) { background: none; border: 0; }
.prio-list:has(> .empty) .empty,
.cmp-list:has(> .empty) .empty { margin: 0 auto; }

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
.obs-ev-full { font-family: var(--mono); font-size: 9.5px; color: var(--ink-4); }
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

.proj { position: relative; display: flex; align-items: center; gap: 6px; }
.proj-btn {
  display: flex; align-items: baseline; gap: 7px;
  padding: 5px 10px; background: var(--paper);
  border: 1px solid var(--rule-2); border-radius: 2px;
  font-family: var(--mono); font-size: 11px; cursor: pointer;
  max-width: 260px;
}
.proj-btn:hover { background: var(--concrete); }
.proj-k { color: var(--ink-4); letter-spacing: .1em; text-transform: uppercase; font-size: 10px; }
.proj-name {
  color: var(--ink); font-weight: 600; font-size: 11.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.proj-caret { color: var(--ink-3); border-left: 1px solid var(--rule); padding-left: 6px; }
.proj-menu {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
  min-width: 260px; max-width: 320px; padding: 10px;
  background: var(--paper); border: 1px solid var(--rule-2);
  box-shadow: 0 8px 24px rgba(28, 27, 25, .16);
}
.proj-menu-h {
  margin: 0 0 8px; font-family: var(--mono); font-size: 10px;
  letter-spacing: .1em; text-transform: uppercase; color: var(--ink-4);
}
.proj-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.proj-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 8px 10px; background: var(--paper);
  border: 0; text-align: left; cursor: pointer;
}
.proj-item:hover { background: var(--concrete); }
.proj-item[aria-current="true"] { background: var(--paper); box-shadow: inset 3px 0 0 var(--red); }
.proj-item-n { font-family: var(--mono); font-size: 11.5px; color: var(--ink); font-weight: 600; }
.proj-item-c { font-family: var(--mono); font-size: 10px; color: var(--ink-4); white-space: nowrap; }
.proj-empty { margin: 0; padding: 10px; font-size: 11px; color: var(--ink-3); line-height: 1.5; }
.proj-menu-acts { display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--rule-hair); }
.btn-xs { padding: 4px 8px; font-size: 10.5px; font-family: var(--mono); }

.modal { border: 0; padding: 0; background: transparent; }
.modal::backdrop { background: rgba(28, 27, 25, .45); }
.modal-card {
  width: min(420px, 92vw); padding: 20px;
  background: var(--paper); border: 1px solid var(--rule-2);
  box-shadow: 0 18px 48px rgba(28, 27, 25, .28);
}
.modal-h { margin: 0 0 14px; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
/* The modal's explanatory line, styled here instead of inline in the markup. */
.modal-sub { margin: 0 0 12px; color: var(--ink-3); font-size: 11.5px; }
.modal-body { margin: 0 0 16px; font-size: 12.5px; line-height: 1.6; color: var(--ink-2); }
.modal-note { margin: 0 0 12px; font-family: var(--mono); font-size: 11px; color: var(--red); }
.modal-acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.field-opt { color: var(--ink-4); font-weight: 400; text-transform: none; letter-spacing: 0; }

.fixtures-empty {
  margin: 0; padding: 12px; border: 1px dashed var(--rule-2);
  font-size: 11.5px; line-height: 1.6; color: var(--ink-3);
}
.capture-row { display: flex; align-items: stretch; background: var(--paper); }
.capture-main {
  flex: 1; min-width: 0; display: block; width: 100%; text-align: left;
  padding: 9px 11px; background: transparent; border: 0; cursor: pointer;
}
.capture-main:hover { background: var(--concrete); }
.capture-row[aria-current="true"] .capture-main { background: var(--paper); box-shadow: inset 3px 0 0 var(--red); }
.capture-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.capture-tag {
  padding: 1px 5px; border: 1px solid var(--rule-2); color: var(--ink-3);
  text-transform: uppercase; letter-spacing: .06em;
}
.capture-tag[data-source="DEMO_FIXTURE"] { border-color: var(--ink-4); color: var(--ink-3); }
.capture-del {
  flex: none; padding: 0 10px; background: transparent;
  border: 0; border-left: 1px solid var(--rule-hair);
  color: var(--ink-4); font-family: var(--mono); font-size: 15px; cursor: pointer;
}
.capture-del:hover { background: var(--red-wash); color: var(--red); }

@media (max-width: 900px) {
  .proj-btn { max-width: 180px; }
}
@media (max-width: 820px) {
  .proj { flex: 1 1 100%; }
  .proj-btn { flex: 1; max-width: none; }
  .proj-menu { min-width: 0; width: 100%; }
}

.proj-badge {
  margin-left: 6px; padding: 1px 5px;
  border: 1px solid var(--ink-4); color: var(--ink-3);
  font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
  vertical-align: 1px;
}
.ref-active {
  margin: 0 0 10px; padding: 7px 9px;
  border: 1px solid var(--rule); background: var(--paper);
  font-family: var(--mono); font-size: 10.5px; color: var(--ink-2); line-height: 1.6;
}
.storage-note {
  margin: 8px 0 0; padding: 7px 9px;
  border: 1px dashed var(--rule-2); background: var(--paper);
  font-family: var(--mono); font-size: 10px; color: var(--ink-3); line-height: 1.6;
}
/* Persistence provenance is true and occasionally needed, but it is not part
   of the capture workflow — so it waits behind a disclosure. */
.storage { margin: 10px 0 0; }
.storage summary {
  display: inline-block;
  padding: 4px 8px;
  border: 1px dashed var(--rule-2);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .06em;
  color: var(--ink-3);
  cursor: pointer;
  user-select: none;
}
.storage summary:hover { color: var(--ink-2); border-color: var(--ink-3); }
.storage[open] summary { border-color: var(--rule); }
.preset-items { display: grid; gap: 6px; margin-bottom: 8px; }
.preset-item {
  display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 6px; align-items: center;
  padding: 6px; border: 1px solid var(--rule-hair); background: var(--paper-2);
}
.preset-item select, .preset-item input {
  width: 100%; padding: 4px 6px; font-family: var(--mono); font-size: 11px;
  border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
}
.preset-item .btn { padding: 3px 8px; }

/* ==========================================================================
   THE NVIDIA QUALIFICATION CARD
   The verdict is the headline because it answers the question a judge actually
   asks. The rows underneath are the evidence for it: each names the model that
   really ran and says whether that row is the qualifying inference.
   ========================================================================== */
.qual {
  margin-top: 12px;
  border: 1px solid var(--rule-2);
  border-radius: 4px;
  background: var(--paper);
  overflow: hidden;
}
.qual-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--rule);
  background: var(--neutral-wash);
}
.qual-k {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.qual-verdict {
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--rule-2);
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  color: var(--ink-3);
}
.qual[data-requirement="MET"] .qual-verdict {
  background: var(--verify-wash);
  border-color: rgba(31, 111, 67, .38);
  color: var(--verify);
}
.qual[data-requirement="PARTIAL"] .qual-verdict {
  background: var(--review-wash);
  border-color: rgba(154, 103, 0, .38);
  color: var(--review);
}
.qual[data-requirement="NOT_MET"] .qual-verdict {
  background: var(--reject-wash);
  border-color: rgba(122, 31, 31, .38);
  color: var(--reject);
}
.qual-sub {
  margin: 12px 14px 10px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.qual-stages { margin: 0 14px; padding: 0; list-style: none; display: grid; gap: 7px; }
.qual-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 11.5px;
}
.qual-row-k { min-width: 132px; font-weight: 600; color: var(--ink); }
.qual-row-model {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink);
  background: var(--neutral-wash);
  padding: 2px 6px;
  border-radius: 3px;
  overflow-wrap: anywhere;
}
.qual-tag {
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.5;
}
.qual-tag-ok      { background: var(--verify-wash); border-color: rgba(31, 111, 67, .34); color: var(--verify); }
.qual-tag-no      { background: var(--info-wash);   border-color: rgba(44, 110, 155, .34); color: var(--info); }
.qual-tag-unknown { background: var(--neutral-wash); border-color: var(--rule-2); color: var(--neutral); }
.qual-path {
  margin: 12px 14px 14px;
  padding-top: 11px;
  border-top: 1px dashed var(--rule);
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink-2);
}

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

/* ==========================================================================
   THE REVIEWER GATE
   Sits above the pipeline on purpose, so it is the first thing read when the
   workflow is unavailable rather than a message that only appears once
   something is clicked. It states the real reason and it is the route to the
   action that resolves it. The amber of setup, never the red of a failure: a
   missing reviewer is an incomplete setup step, not a defect in the inspection.
   ========================================================================== */
.gate {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: var(--shell);
  margin: 0 auto;
  padding: 9px 20px;
  border-bottom: 1px solid var(--rule-2);
  background: var(--review-wash);
}
.gate-k {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--review);
}
.gate-b { flex: 1 1 240px; font-size: 11.5px; line-height: 1.5; color: var(--ink-2); }

/* ==========================================================================
   THE PIPELINE STRIP
   Four verbs, four steps, each reporting its OWN state. This is the thesis made
   permanent on screen: SEE by a model, COMPARE by our code, UNDERSTAND by a
   second model, VERIFY by a person. A step that did not run says so, so a
   silent stage can never be read as agreement.
   ========================================================================== */
.pipe {
  position: relative;
  z-index: 2;
  border-bottom: 1px solid var(--rule-2);
  background: var(--paper-3);
}
.pipe-steps {
  max-width: var(--shell);
  margin: 0 auto;
  padding: 0 20px;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.pipe-step {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "n k" "n model" "n note";
  column-gap: 10px;
  padding: 9px 14px 9px 0;
  border-right: 1px solid var(--rule-hair);
  border-left: 1px solid transparent;
  padding-left: 14px;
  margin-left: -14px;
  transition: background var(--fast) var(--ease);
}
.pipe-step:last-child { border-right: 0; }
.pipe-n {
  grid-area: n;
  align-self: start;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  color: var(--ink-4);
  padding-top: 2px;
}
.pipe-k {
  grid-area: k;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .14em;
  color: var(--ink-3);
}
.pipe-model {
  grid-area: model;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink);
  overflow-wrap: anywhere;
  line-height: 1.35;
}
.pipe-note {
  grid-area: note;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  line-height: 1.4;
  margin-top: 1px;
}
.pipe-step[data-state="done"] { background: rgba(31, 111, 67, .055); }
.pipe-step[data-state="done"] .pipe-n { color: var(--verify); }
.pipe-step[data-state="fail"] { background: var(--review-wash); }
.pipe-step[data-state="fail"] .pipe-n { color: var(--review); }
.pipe-step[data-state="wait"] { background: rgba(28, 27, 25, .04); }
.pipe-step[data-state="wait"] .pipe-n { color: var(--ink-2); }
/* A step that has not run is dimmed, but never to the point of illegibility:
   "not run yet" is information, not decoration. */
.pipe-step[data-state="idle"] { opacity: .8; }
.pipe-step[data-state="idle"] .pipe-note { color: var(--ink-3); }

@media (max-width: 900px) {
  .pipe-steps { grid-template-columns: repeat(2, 1fr); }
}

/* ==========================================================================
   LOCAL DATASET BROWSER
   The demo path onto REAL construction imagery. The labelling carries the
   weight: every tile says LOCAL DATASET's truth, so a genuine archive
   photograph can never be mistaken for a project capture or a synthetic scene.
   ========================================================================== */
.dataset {
  margin-top: 14px;
  border: 1px solid var(--rule-2);
  background: var(--paper-2);
}
.dataset-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--rule-hair);
  background: var(--paper-3);
}
.dataset-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink);
}
.dataset-head .tag { margin-left: auto; }
.dataset-note {
  margin: 0;
  padding: 8px 12px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
  border-bottom: 1px solid var(--rule-hair);
}
.dataset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
  gap: 1px;
  background: var(--rule-hair);
}
.dataset-empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 12px;
  color: var(--ink-3);
}
.dataset-warn {
  grid-column: 1 / -1;
  margin: 0;
  padding: 8px 12px;
  background: var(--review-wash);
  color: var(--review);
  font-family: var(--mono);
  font-size: 10px;
}
.dataset .note-bad { margin: 0; }

/* A tile is an instrument label, not a thumbnail: no image is decoded, so the
   browser is not asked to hold 38 large files in memory to draw a grid. */
.tile {
  display: grid;
  gap: 3px;
  padding: 8px 9px 9px;
  text-align: left;
  background: var(--paper);
  border: 0;
  border-top: 2px solid transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: background var(--fast) var(--ease), border-color var(--fast) var(--ease);
}
.tile:hover:not(:disabled) { background: var(--paper-3); border-top-color: var(--ink-3); }
.tile:disabled { cursor: not-allowed; opacity: .45; }
.tile[data-hero="true"] { border-top-color: var(--red); }
.tile-top { display: flex; align-items: center; gap: 6px; }
.tile-id {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: .04em;
}
.tile-hero, .tile-big {
  font-family: var(--mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .1em;
  padding: 1px 4px;
}
.tile-hero { background: var(--red); color: var(--paper); }
.tile-big { background: var(--ink-4); color: var(--paper); margin-left: auto; }
.tile-title {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--ink-2);
}
.tile-meta, .tile-rot {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--ink-4);
}
.tile-rot { color: var(--review); }

/* ==========================================================================
   CONSTRUCTION REASONING  (stage 2)
   The panel that makes the second model visible. Amber when it could not run,
   so a missing stage is impossible to mistake for a clean bill of health.
   ========================================================================== */
.reason {
  margin-top: 16px;
  border: 1px solid var(--rule-2);
  background: var(--paper-2);
  border-left: 3px solid var(--ink-4);
}
.reason[data-status="AVAILABLE"] { border-left-color: var(--verify); }
.reason[data-status="UNAVAILABLE"] { border-left-color: var(--review); }
.reason-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 12px;
  background: var(--paper-3);
  border-bottom: 1px solid var(--rule-hair);
}
.reason-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.reason[data-status="AVAILABLE"] .reason-h { color: var(--verify); }
.reason[data-status="UNAVAILABLE"] .reason-h { color: var(--review); }
.reason-model {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
}
.reason-lede {
  margin: 0;
  padding: 12px 14px 10px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  max-width: 78ch;
}
.reason[data-status="UNAVAILABLE"] .reason-lede {
  font-size: 12.5px;
  color: var(--ink-2);
}
.reason-grid { margin: 0; padding: 0 14px 12px; }
.reason-grid .fc-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  padding: 7px 0;
  border-top: 1px solid var(--rule-hair);
}
.reason-grid .fc-row dt {
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--ink-4);
  padding-top: 2px;
}
.reason-grid .fc-row dd { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink-2); }

/* Certainty is a qualitative reading of evidence, so it is a chip, not a bar.
   A bar would invite reading it as a measurement. */
.reason-certainty {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 9px 0 2px;
  border-top: 1px solid var(--rule-hair);
}
.reason-certainty-k {
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--ink-4);
}
.chip {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  padding: 2px 7px;
  border: 1px solid currentColor;
}
.chip[data-certainty="SUPPORTED"] { color: var(--verify); background: var(--verify-wash); }
.chip[data-certainty="UNCERTAIN"] { color: var(--review); background: var(--review-wash); }
.chip[data-certainty="INSUFFICIENT_EVIDENCE"] { color: var(--reject); background: var(--reject-wash); }
.reason-certainty-n {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--ink-4);
}

.reason-fail {
  margin: 0 14px 12px;
  padding: 10px 12px;
  background: var(--review-wash);
  border-left: 2px solid var(--review);
}
.reason-fail-h {
  margin: 0;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--review);
}
.reason-fail-kind {
  margin: 3px 0 0;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--ink-3);
}
.reason-fail ul { margin: 6px 0 0; padding-left: 16px; font-size: 11px; color: var(--ink-3); }
.reason-fail-foot { margin: 7px 0 0; font-size: 11.5px; color: var(--ink-2); }
.reason-foot {
  margin: 0;
  padding: 8px 14px 10px;
  border-top: 1px solid var(--rule-hair);
  font-family: var(--mono);
  font-size: 9.5px;
  line-height: 1.5;
  color: var(--ink-4);
}

/* Geometry disclosure: a re-oriented photograph is stated, never silently fixed. */
.geom {
  margin: 8px 0 0;
  padding: 7px 9px;
  background: var(--review-wash);
  border-left: 2px solid var(--review);
  font-family: var(--mono);
  font-size: 9.5px;
  line-height: 1.5;
  color: var(--ink-2);
}

/* ==========================================================================
   LANGUAGE AND THE PHOTOGRAPHS OF ONE INSPECTION

   Two concerns share this block because both are about not misleading a
   reader. The language rules keep Latin runs (model ids, counts, timestamps)
   readable inside Arabic text instead of letting the bidi algorithm reorder
   them. The photo rules make the count of photographs legible without counting
   thumbnails, and keep a FAILED photograph visible as failed: hiding it would
   let a partial inspection read as a complete one.
   ========================================================================== */

/* The language control sits in the identity strip and stays LTR in every
   language: a selector listing en / fr / ar / zh is read in code order, not in
   prose order, and it is never inside a localized surface to begin with. */
.lang-sel {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  color: var(--ink-3);
  font-size: 10px;
}
.lang-k {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  /* --ink-3, not --ink-4: the label names a control the operator has to find,
     so it is information rather than decoration and has to clear AA. */
  color: var(--ink-3);
}
.lang-sel select {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--rule-2);
  border-radius: 0;
  padding: 3px 6px;
}
.lang-sel select:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }
.lang-note { font-family: var(--mono); font-size: 10px; color: var(--ink-3); }
.i18n-surface[lang="zh-CN"] { line-height: 1.75; }
.i18n-surface[lang="zh-CN"] .bay-h,
.i18n-surface[lang="zh-CN"] .panel-h { letter-spacing: .04em; }

/* Numbers, ids and model names are Latin-runs inside Arabic text. Isolating each
   one keeps "openbmb/MiniCPM-V-4_5" and a count from being reordered by the
   bidirectional algorithm, which is what makes mixed content unreadable. */
.i18n-surface[dir="rtl"] { text-align: right; }
.i18n-surface[dir="rtl"] .mono,
.i18n-surface[dir="rtl"] .obs-n,
.i18n-surface[dir="rtl"] .obs-cat,
.i18n-surface[dir="rtl"] .rig-name,
.i18n-surface[dir="rtl"] .ident-v,
.i18n-surface[dir="rtl"] .conf,
.i18n-surface[dir="rtl"] .fc-title,
.i18n-surface[dir="rtl"] [data-latin] { unicode-bidi: isolate; direction: ltr; text-align: left; }
/* Long unbroken strings must wrap rather than push a card off the page. */
.i18n-surface[dir="rtl"] .obs-text,
.i18n-surface[dir="rtl"] .fc-title,
.i18n-surface[dir="rtl"] .reason-lede { overflow-wrap: anywhere; }

/* ---- the photographs of one inspection --------------------------------- */
.imgs { border: 1px solid var(--rule); background: var(--paper-2); padding: 12px; margin-top: var(--gap); }
.imgs-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.imgs-h { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
.imgs-n { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--ink); }
.imgs-list { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 7px; }
.img-item { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 8px; padding: 6px; border: 1px solid var(--rule); background: var(--paper); }
.img-item-failed { border-color: var(--red); }
.img-thumb { width: 40px; height: 40px; object-fit: cover; background: var(--paper-3); }
.img-meta { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: 'ord label' 'status status'; gap: 1px 6px; min-width: 0; }
.img-ord { grid-area: ord; font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.img-label { grid-area: label; font-size: 11px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.img-status { grid-area: status; font-family: var(--mono); font-size: 9px; letter-spacing: .08em; color: var(--ink-3); }
.img-status-failed { color: var(--red); }
.img-drop { position: absolute; top: 1px; right: 3px; border: 0; background: transparent; color: var(--ink-4); font-size: 15px; line-height: 1; cursor: pointer; padding: 2px 5px; }
.img-drop:hover { color: var(--red); }
.imgs-note { margin: 9px 0 0; font-size: 11px; line-height: 1.5; color: var(--ink-3); }
.btn-xs { padding: 5px 10px; font-size: 11px; }

/* ---- how many photographs this inspection actually rests on ------------- */
.basis { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 3px; }
.basis-item { display: grid; grid-template-columns: 66px minmax(0, 1fr) auto; align-items: baseline; gap: 8px; font-size: 11px; }
.basis-dot { font-family: var(--mono); font-size: 9px; letter-spacing: .06em; color: var(--verify); }
.basis-item-failed .basis-dot { color: var(--red); }
.basis-name { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.basis-n { font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.basis-fail { grid-column: 2 / -1; font-size: 10px; color: var(--red); }
.basis-warn { margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--red); }
.basis-empty { font-size: 11px; color: var(--ink-4); }

/* Which photograph an observation came from. Evidence without its source
   photograph is not auditable once more than one image is in play. */
.obs-photo { font-family: var(--mono); font-size: 10px; color: var(--ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px; }
`;
