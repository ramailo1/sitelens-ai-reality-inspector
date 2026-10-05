/**
 * UI assets for the local inspector.
 *
 * Served as plain text modules so the application keeps zero runtime
 * dependencies and no build step.
 *
 * Design direction: an ENGINEERING INSPECTION INSTRUMENT, not a SaaS dashboard.
 * Concrete before gradients. Geometry before decoration. Measurement before
 * animation. Evidence before claims. The palette is survey paper, concrete,
 * graphite and a single instrument red reserved for attention and never for
 * decoration; verified is the only green on screen.
 *
 * The layout is one screen: the reality image dominates, the inspection rail
 * sits beside it, and every finding card is wired to the image so a click
 * always shows WHERE on the site something was flagged.
 */

export { INDEX_HTML } from './ui/index.html.ts';
export { APP_CSS } from './ui/app.css.ts';
export { APP_JS } from './ui/app.js.ts';
