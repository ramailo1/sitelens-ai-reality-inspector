/**
 * Runs the full flow: capture -> inspector -> provider -> validated
 * observations -> human verification.
 *
 *   AI_PROVIDER=demo   npm run demo   # deterministic, offline
 *   AI_PROVIDER=nebius npm run demo   # real Nebius + NVIDIA call
 *
 * The output states which provider ran, so a demo run is never mistaken for a
 * real one.
 */

import { readFileSync } from 'node:fs';
import { createProvider, ProviderError } from '../src/providers/factory.ts';
import { RealityInspector } from '../src/inspector.ts';
import { DEMO_MODEL_ID, DEMO_PROVIDER_NAME } from '../src/providers/demo-fixture.provider.ts';
import { classifyEligibility, describeEligibility, isNvidiaModelId } from '../src/eligibility.ts';

const CAPTURE_ID = 'cap_demo_0001';
const PROJECT_ID = 'proj_demo_site_a';
const ZONE_ID = 'zone_level_02';

/**
 * A tiny synthetic 1x1 PNG. This is the DEFAULT placeholder stand-in for a real
 * capture: the demo proves the pipeline, and it is deliberately NOT customer
 * imagery.
 *
 * A 1x1 pixel carries no scene content, so a real vision model correctly
 * reports nothing observable about it and returns an empty observations array.
 * That is a valid, honest result — it is NOT a pipeline failure.
 *
 * To exercise a real image, set DEMO_IMAGE to a local image file:
 *   DEMO_IMAGE=./path/to/site-photo.jpg AI_PROVIDER=nebius npm run demo
 *
 * Only sanitized, non-customer imagery should ever be used.
 */
const SYNTHETIC_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Media type from a file extension, for DEMO_IMAGE. */
function mediaTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * Resolve the capture to inspect: DEMO_IMAGE when set, otherwise the 1x1
 * placeholder. Read lazily so the demo never touches the filesystem unless the
 * developer opts in.
 */
function loadCapture(): { bytes: Buffer; mediaType: string; label: string } {
  const override = process.env['DEMO_IMAGE'];
  if (!override || override.trim().length === 0) {
    return { bytes: SYNTHETIC_PNG, mediaType: 'image/png', label: 'synthetic placeholder' };
  }
  const path = override.trim();
  const bytes = readFileSync(path);
  if (bytes.length === 0) {
    throw new Error(`DEMO_IMAGE is empty: ${path}`);
  }
  return {
    bytes,
    mediaType: mediaTypeFor(path),
    label: `DEMO_IMAGE (${bytes.length} bytes from ${path})`,
  };
}

function line(char = '-', width = 78): string {
  return char.repeat(width);
}

function heading(title: string): void {
  console.log(`\n${line('=')}`);
  console.log(`  ${title}`);
  console.log(line('='));
}

async function main(): Promise<number> {
  heading('SiteLens AI Reality Inspector — Demo');

  let provider;
  try {
    provider = createProvider(process.env);
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      console.error(`\n  CONFIGURATION ERROR (${error.kind}): ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const isDemo = provider.name === DEMO_PROVIDER_NAME;
  const capture = loadCapture();

  console.log(`\n  STEP 1 — Capture selected`);
  console.log(`    captureId : ${CAPTURE_ID}`);
  console.log(`    projectId : ${PROJECT_ID}`);
  console.log(`    zoneId    : ${ZONE_ID}`);
  console.log(`    image     : ${capture.bytes.length} bytes (${capture.label})`);

  const inspector = new RealityInspector({ provider });

  heading('STEP 2 — Run the AI Reality Inspector');
  console.log(`    provider : ${provider.name}`);
  console.log(`    model    : ${provider.model}`);

  if (isDemo) {
    console.log(`\n  NOTE: this is the DETERMINISTIC DEMO provider (${DEMO_MODEL_ID}).`);
    console.log('  It calls no model at all, so neither stage of this run contributes');
    console.log('  any inference. Set AI_PROVIDER=nebius and NEBIUS_API_KEY to exercise');
    console.log('  the real Nebius vision path.');
  } else {
    console.log(
      `    endpoint : ${process.env['NEBIUS_BASE_URL'] ?? '(default)'} (Nebius Token Factory)`,
    );
  }

  let result;
  try {
    result = await inspector.inspectCapture({
      image: { bytes: capture.bytes, mediaType: capture.mediaType, captureId: CAPTURE_ID },
      projectId: PROJECT_ID,
      zoneId: ZONE_ID,
    });
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      console.error(`\n  INSPECTION FAILED (${error.kind})`);
      console.error(`    ${error.message}`);
      if (error.detail) console.error(`    detail: ${error.detail}`);
      console.error('\n  No observations were produced. SiteLens does not invent an');
      console.error('  AI result when the model is unavailable.\n');
      return 1;
    }
    throw error;
  }

  heading('STEP 3 — Structured construction observations');
  console.log(`    model returned ${result.observations.length} valid observation(s)`);
  if (result.rejected.length > 0) {
    console.log(`    ${result.rejected.length} entry/entries REJECTED by validation (not shown)`);
  }

  if (result.observations.length === 0) {
    console.log('\n    (The model reported nothing for this capture. That is a valid result.)');
  }

  result.observations.forEach((observation, index) => {
    const band = result.bands[index] ?? 'LOW';
    console.log(`\n    [${index + 1}] ${observation.category}`);
    console.log(`        observation : ${observation.observation}`);
    console.log(`        evidence    : ${observation.evidence.description}`);
    console.log(`        confidence  : ${observation.confidence.toFixed(2)} (${band})`);
    console.log(`        severity    : ${observation.severity}`);
    console.log(`        suggestion  : ${observation.suggestedAction}`);
    console.log(`        origin      : ${observation.origin}`);
    console.log(`        verification: ${observation.verificationStatus}`);
  });

  heading('STEP 4 — Human verification (the human stays in control)');
  const first = result.observations[0];

  if (!first) {
    console.log('    No observation to review.');
  } else {
    const verified = inspector.reviewObservation({
      observationId: first.id,
      decision: 'VERIFIED',
      reviewer: 'demo.site.engineer',
      note: 'Confirmed on site against the reference drawing.',
    });

    console.log(`    observationId : ${first.id}`);
    console.log(`    before        : ${first.verificationStatus}`);
    console.log(`    decision      : VERIFIED by demo.site.engineer`);
    console.log(`    after         : ${verified?.verificationStatus}`);
  }

  heading('Provenance');
  console.log(`    provider         : ${result.provider}`);
  console.log(`    model            : ${result.model}`);
  // Scope matters here. This script runs the VISION stage only, so the honest
  // statement is about that stage and that model. Whether the NVIDIA requirement
  // is met for the product is decided by the reasoning stage in
  // `npm run ui`, and a model-level fact must never be printed as a verdict
  // about the submission.
  const visionStage = classifyEligibility({ provider: result.provider, model: result.model });
  console.log(`    nvidia model     : ${isNvidiaModelId(result.model) ? 'yes' : 'no'}`);
  console.log(`    vision stage     : ${visionStage} (stage-level, not a submission verdict)`);
  console.log(`    note             : ${describeEligibility(visionStage, result.model)}`);
  console.log('    reasoning stage  : not run by this script. SiteLens satisfies the NVIDIA');
  console.log('                       requirement there, through nvidia/Nemotron-3-Ultra on Nebius.');
  console.log(`    inspectedAt      : ${result.inspectedAt}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('\n  UNEXPECTED DEMO FAILURE');
    console.error(error);
    process.exitCode = 1;
  });