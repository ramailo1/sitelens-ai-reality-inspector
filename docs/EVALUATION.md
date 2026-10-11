# Evaluation harness — `src/evaluation-harness.ts`

A repeatable, labelled evaluation for the hybrid inspection pipeline (vision
provider → deterministic comparison → reasoning provider → human review).
The harness separates **specification conformance** from **model quality**,
and never conflates the two.

## Running it

```bash
npm run eval        # OFFLINE evaluation (default)
npm run eval:live   # LIVE evaluation (explicit opt-in, costs credits)
npm test            # includes tests/evaluation-harness.test.ts (all offline)
```

- **Offline mode** is deterministic, credential-free and network-free. It runs
  the four generated demo captures through the offline fixture provider, the
  real validators, the real deterministic comparison engine and the real
  session pipeline, plus four regression scenarios for known failure modes.
  Exit code 0 means specification conformance held.
- **Live mode** only runs when `--live` is passed. It builds the provider from
  the already configured environment (same as the app) and scores the full
  labelled manifest — including real dataset photographs — against the
  human-authored labels. It never runs implicitly, never runs in tests, and
  never runs at startup.
- Neither mode ever prints an environment variable, API key, authorization
  header or raw configuration; only provider/model identifiers, counts,
  scores and limitations appear in the report.

## The manifest (`EVALUATION_MANIFEST`)

Each case records: a stable id, the capture it names, a description, the
conditions it exercises, its **source and licence**, and human-authored
labels in five separate buckets:

1. **Observable elements** — `expectedElements[].presence` per element kind.
2. **Evidence localization/coverage** — `localized` / `fullFrame` / `none` /
   `uncertain`.
3. **Comparison outcome** — offline: `OFFLINE_COMPARISON_LABELS` per reference
   row; live: verdicts are reported per case but not scored (see below).
4. **Finding support** — live scoring classifies model detections as
   *supported* (labelled present), *unsupported* (labelled absent), or
   *unlabeled* (no label — reported, never penalised).
5. **Human review required** — `humanReviewRequired`, and the review boundary
   is always enforced regardless (AI output is never verified).

### Label sources (never invented)

- **Synthetic demo captures**: the painter's scene specification in
  `src/captures.ts` — the generator's own description of what it drew.
- **Dataset photographs**: the human-verified "What is visible" records in
  `sample/SOURCES.md`, with the file's licence and provenance.

### Uncertainty rule

If an image cannot be reliably labelled from available evidence, mark it
`uncertain` and give an `uncertainReason`. Uncertain cases are excluded from
precision/recall and reported with their reason. Two current examples:
`sample-007` (EXIF orientation 6 — pixel-space box placement is a known open
issue) and `sample-013` (upstream note: a finished interior, not active
construction).

## Rubric

| Metric | Definition | Where computed |
| --- | --- | --- |
| Trust-boundary conformance | Share of evaluated cases where every observation stays `AI_GENERATED` and `UNVERIFIED` | offline + live |
| Deterministic comparison correctness | Comparison rows whose verdict equals the authored label (offline reference over fixed fixture detections) | offline |
| Regression scenarios | Pass/fail for unsupported observations, insufficient evidence, malformed provider responses, reasoning overstatement | offline + live |
| Observation precision | supported / (supported + unsupported) over non-excluded cases | **live only** |
| Observation recall | (expected − missed) / expected over non-excluded cases | **live only** |

## Adding and labelling cases

1. Add the capture: synthetic ones live in `src/captures.ts`; dataset ones in
   `sample/` with a full `SOURCES.md` entry (licence, author, SHA-1, "What is
   visible").
2. Add a manifest entry with `mode: 'offline'` (synthetic, fixture-scoreable)
   or `mode: 'live-only'` (real photograph).
3. Author labels from the label sources above — never from model output, and
   never from a filename alone.
4. If a label cannot be defended from evidence, use `uncertain` and say why.
5. Bump `EVAL_MANIFEST_VERSION`.

## Interpreting the results

- The offline sample is tiny and synthetic: **conformance metrics are strong
  evidence about the pipeline, zero evidence about model accuracy.**
- Live metrics over a 7-case sample are descriptive, not statistically
  conclusive. A small sample cannot prove general model accuracy, and the
  report says so in every run.
- Comparison verdicts over live detections are reported per case but not
  scored: with a real model, a verdict difference mixes detection quality with
  comparison arithmetic, and only the arithmetic is this metric's job.

## Hybrid boundary (Nemotron contribution)

The vision provider supplies observations; the reasoning provider supplies
contextual explanation and recommendations. The `reasoning-overstatement-
cannot-verify` regression scenario proves that reasoning prose — even one
claiming full compliance with confidence 0.99 — never changes a comparison
verdict and never verifies anything. If the configured reasoning model is
retired, unavailable or fails, the run reports that honestly (existing suites
in `tests/hybrid-pipeline.test.ts` cover the outcomes); the harness never
substitutes another model silently.
