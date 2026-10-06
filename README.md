# SiteLens™ AI Reality Inspector

**One real construction photograph → what the vision model can see → what the
deterministic engine makes of that against the expected state → what Nemotron
concludes it does and does not establish → what a named human must physically
verify.**

> **REALITY IS THE REFERENCE™**

Built for the **Nebius × NVIDIA Global AI Hackathon**.

> ### AI does not replace the inspector.
> ### AI tells the inspector where to look, what it means, and what to verify.

---

## Run it

```bash
npm install          # zero runtime dependencies
npm test             # 324 tests
npm run typecheck    # strict tsc, no emit

# Real inference on Nebius Token Factory (MiniCPM-V + Nemotron):
AI_PROVIDER=nebius npm run ui     # -> http://127.0.0.1:4317

# Deterministic offline demo (no network, no key needed):
AI_PROVIDER=demo npm run ui
```

Node ≥ 22.6 (uses native type-stripping; there is no build step).

Set `SITELENS_PERSIST=off` to run entirely in memory. Without it, state is
written to `data/` and survives a restart — see [Storage](#storage-and-restart).

---

## The hybrid AI architecture

This product runs **two different models doing genuinely different jobs**, plus
arithmetic in code, plus a person:

```text
REALITY IMAGE  (local dataset photograph, or an upload)
      ↓
[1] MiniCPM-V-4_5     SEE         what is visibly present
      ↓                 elements, counts it can defend, observations
[2] compare.ts        COMPARE     MATCH / ATTENTION / UNDETERMINED — in code
      ↓                 arithmetic over the expected-state reference
[3] Nemotron          UNDERSTAND  what this means for the work, and what it
      ↓                 does NOT establish. Sees NO image; reads [1] and [2].
[4] a named human     VERIFY      the only path from candidate to settled
```

### Why two models, and why the split is real

| Stage | Who | What it contributes | What it is forbidden from doing |
|---|---|---|---|
| **SEE** | `openbmb/MiniCPM-V-4_5` | Visual reading of the photograph | Declaring compliance, safety or dimensions |
| **COMPARE** | `src/compare.ts` (this repo) | MATCH / ATTENTION / UNDETERMINED by arithmetic | Accepting anything from a model's opinion |
| **UNDERSTAND** | `nvidia/Nemotron-3-Ultra-550b-a55b` | Construction significance, recommendation, what to verify | Changing a comparison status, or upgrading an unknown |
| **VERIFY** | a named human | The verdict | — |

**Nemotron is given no image.** It receives MiniCPM's validated observations and
this repository's computed comparison rows, and reasons about them in text. That
is the division of labour: the vision stage owns pixels, the reasoning stage owns
meaning, and the deterministic engine owns comparison. A reasoning model
arguing for `MATCH` does not become `MATCH`.

This is verified by test, not asserted: `tests/hybrid-pipeline.test.ts` runs a
full pipeline with a reasoning stage that insists everything is approved and
certified, and asserts the comparison is byte-identical to the same evidence
without it.

### Nemotron is the NVIDIA contribution, and it is a working one

Every `nvidia/Nemotron-*` model in the Token Factory catalogue rejects **image**
input, which is why none of them can be the vision stage. That is irrelevant
here, because stage 3 wants text. All four were called live against this
project's real reasoning prompt with a real inspection context:

| Model | HTTP | Latency | Reasoning tokens | Schema-valid | Verdict |
|---|---|---|---|---|---|
| `nvidia/Nemotron-3-Ultra-550b-a55b` **(default)** | 200 | 3,868 ms | 713 | **yes** | best rationale depth |
| `nvidia/nemotron-3-super-120b-a12b` | 200 | 5,613 ms | 571 | yes | sound, slower |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 200 | 2,859 ms | 0 | yes | fastest, shallowest |
| `nvidia/Nemotron-3_5-Lightning` | 200 | 11,366 ms | 2000 | **no** | `finish_reason=length`, no JSON |

`Nemotron-3_5-Lightning` answers HTTP 200 and produces nothing usable: it spends
the entire token budget reasoning. **Callable is not the same as usable**, and
`VERIFIED_REASONING_MODELS` in `src/eligibility.ts` records only the three that
actually answer, with a test that keeps Lightning out.

Default reasoning model: `NEBIUS_REASONING_MODEL`, default
`nvidia/Nemotron-3-Ultra-550b-a55b`.

### When Nemotron does not run

The reasoning stage is optional infrastructure, and its absence is always
reported rather than papered over. Each of these is a distinct visible state:

| State | Cause |
|---|---|
| `NOT CONFIGURED` | no `NEBIUS_API_KEY` |
| `DISABLED` | `REASONING_ENABLED=false`, or the offline fixture |
| `TIMEOUT` / `UNAVAILABLE` / `AUTHENTICATION` / `RATE_LIMITED` | transport failure |
| `MALFORMED_RESPONSE` | unparseable answer — discarded, never repaired |
| `REJECTED_BY_VALIDATION` | answer failed schema — discarded, never repaired |

In every one of those cases the MiniCPM observation and the deterministic
comparison **stand unchanged**, and the UI says so in those words. A reasoning
outage is never allowed to read as "no problems found".

---

## The 90-second demo path

1. `npm run ui`, open `http://127.0.0.1:4317`.
2. The **pipeline strip** under the masthead always shows which model did what:
   `01 SEE` · `02 COMPARE` · `03 UNDERSTAND` · `04 VERIFY`.
3. **Import a real photograph.** The *Local dataset* panel lists the local
   validation dataset. Every tile is badged `HERO` where applicable. Click one —
   it becomes a real capture of the active project.
4. Click **Inspect reality**. ~10–20 s: MiniCPM reads the image, the comparison
   is computed in code, Nemotron reasons about the result.
5. **Evidence**: the photograph fills the stage, the right rail reads
   REALITY / INSPECTION / FINDINGS / CONFIDENCE / OVERALL.
6. **Construction reasoning**: Nemotron's summary, what it means, why it matters,
   its recommendation, and what must be physically verified — with its certainty
   as a qualitative chip, never a percentage bar.
7. **Reality vs expected**: one row per expected item, with `MATCH`,
   `ATTENTION` or `UNDETERMINED`.
8. Type a name in **Reviewer**, press **CONFIRM**. The card flips to
   `VERIFIED`, records who and when, and leaves the priority list.

Nothing is verified until step 8. That is the product, not a caveat.

---

## The local dataset

A **local-only** directory of 38 genuine, licence-clean photographs of real
construction work: `001`–`038`.

> It is **not tracked by git** (~107.5 MB), it has **never existed in any
> commit**, and nothing in this repository depends on it. The application runs
> perfectly well without it and says so when it is absent.

Importing one makes a **real** photograph a **real** input to a **real**
inspection. It does not make it project evidence, and nothing in the UI claims it
was captured on your site. `source` is a third value — `LOCAL_DATASET` — beside
`UPLOAD` and `DEMO_FIXTURE`, so a Wikimedia archive photograph can never be
confused with a synthetic fixture or an upload:

```text
SOURCE
LOCAL DATASET

IMAGE
030 — hero rebar and concrete forms piers
4928×3264 · 7.74 MB · 030-hero-rebar-and-concrete-forms-piers.jpg

AI STATUS
MINICPM-V-4_5 SEE · SITELENS COMPARE · NEMOTRON UNDERSTAND
AI GENERATED / UNVERIFIED — until a named human verifies
```

Set `SITELENS_DATASET_DIR` to point somewhere else. Provenance, licences and
per-file checksums for every image are in `sample/SOURCES.md` (local-only).

---

## EXIF orientation

Five images (`007`, `009`, `015`, `017`, `021`) store **landscape** pixels tagged
EXIF orientation `6`, meaning they are meant to be read as portrait. Three
coordinate systems then disagreed — the model's normalized box, the pixels the
browser paints, and the evidence overlay drawn on top — so evidence pointed at
the wrong part of the photograph.

**The fix is normalization, not CSS.** `normalizeOrientation()` rewrites the
orientation tag to `1` before the bytes leave the process. A file that says "no
rotation" cannot be rotated by anyone, so stored pixels, model pixels and
displayed pixels are the same array *by construction*. Only the two-byte tag
value changes: no pixel is re-encoded and no other EXIF tag is touched, which
`tests/exif-geometry.test.ts` asserts byte-for-byte.

Measured across the whole dataset, seven files carry a non-trivial orientation:

| File | EXIF | Handling |
|---|---|---|
| `007`, `009`, `015`, `017`, `021` | 6 | normalized; stored 2016×1512 etc. |
| `004`, `027` | 3 | normalized — **previously undocumented** |

`004` and `027` (180° rotation) were found by this work and are **not** in the
dataset documentation, which lists only the five orientation-6 files.

The original orientation is recorded and shown in the UI and in the capture's
`content`, so a re-oriented photograph is disclosed rather than silently fixed.

**One honest consequence:** for those seven files the pixels are displayed
unrotated, so e.g. `021` reads sideways. Correctness of the coordinate system was
chosen over orientation, because transposing JPEG pixels would require shipping a
codec, and a sideways photograph is a cosmetic cost next to evidence pointing at
the wrong object.

---

## Storage and restart

State is written to `data/`:

```text
data/
  workspace.json                 projects, references, capture metadata, selection
  uploads/<captureId>.(jpg|png)  uploaded bytes, referenced by path
  inspections/<captureId>.json   raw provider payload + human decisions + reasoning
```

Writes are atomic (temp file + rename), so a process killed mid-write leaves the
previous good state rather than a truncated file. Paths are sanitised: a
tampered state file cannot read outside the dataset directory or delete outside
`data/uploads/`.

After a restart, verified end to end:

```text
PROJECT STILL EXISTS
CAPTURE STILL EXISTS          (including dataset captures, resolved by relative path)
INSPECTION RESULT STILL EXISTS
VERIFICATION STATE STILL EXISTS   (VERIFIED and REJECTED, with the reviewer's name)
REASONING STILL EXISTS           attributed to the model that produced it
```

Deliberately **not** persisted: the generated demo fixtures (rebuilt
deterministically every start) and the in-process AI result cache — so a restored
result can never claim to be a fresh inference. Restored results are labelled
`CACHED` and carry the original inference timestamp.

The API reports the truth of *this* instance: `storage.location` and
`storage.durable` come from the live store, so the in-memory mode still honestly
reports `process memory` / `durable: false`.

---

## What the tool refuses to do

These are code paths, not prompt requests, and each has tests.

- **It never accepts a model placeholder.** *Measured defect:* MiniCPM echoed the
  prompt's own `0.0` confidence and all-zero bounding box for every item on the
  expected-state list, each with evidence reading `"no visible X"` while
  claiming `present: true`. Every field was structurally valid, so the
  deterministic comparison reported **five fabricated `MATCH`es and one
  fabricated `ATTENTION`** on a photograph of a worker tying rebar. Entries that
  assert nothing (confidence 0) or contradict their own evidence are now
  **discarded and reported**, never compared.
- **It never lets a template become evidence.** The inspection prompt shows no
  concrete numbers at all, because any number in a worked example is something
  the model copies verbatim. This was measured twice: with `0.0` placeholders the
  model echoed zeros; with realistic placeholders it echoed *those* instead.
- **It never fakes evidence geometry.** A zero-area bounding box is reported as
  *"the model did not localise this"*, not drawn.
- **It never invents a number.** If the model will not commit to a count the
  result is `NOT_DETERMINABLE`, not `0`.
- **It never turns an unknown into a defect.** An expectation the capture cannot
  settle is `UNDETERMINED` → severity `INFO`, kept out of the ranked priority
  list and reported separately as *"this capture cannot settle"*.
- **It never manufactures engineering claims.** Every comparison finding
  recommends a *physical* verification, and counts are labelled
  `VISUAL_COUNT — not a measured quantity`.
- **It never lets reasoning settle anything.** `certainty` and reasoning
  confidence are advisory; a finding leaves `UNVERIFIED` only through a named
  human.
- **It never auto-verifies.** Confidence is explicitly not acceptance, and an
  anonymous review is refused with HTTP 400.

---

## Measured behaviour and honest limits

Everything below was measured on the live endpoint, not estimated.

### The pipeline performs

| Metric | Measured |
|---|---|
| Vision stage (MiniCPM-V-4_5) | 6.7 – 17.8 s on real photographs |
| Reasoning stage (Nemotron-3-Ultra) | 2.5 – 4.8 s |
| Full inspection, both stages | ~10 – 22 s |
| Reasoning responses that merely restated the vision stage | 0 |

### Real images the pipeline was run against

| Image | Outcome | What it produced |
|---|---|---|
| `030` | COMPLETED | 6 elements, 1 `MATCH`, 2 `ATTENTION`, 4 `UNDETERMINED`, Nemotron `INSUFFICIENT_EVIDENCE` |
| `022` | COMPLETED | `REBAR` + `WORKER` correctly detected on a rebar-tying detail; everything outside frame `UNDETERMINED` |
| `031` | COMPLETED | `REBAR`, `WORKER`, `EQUIPMENT` correctly detected on a pre-pour mat |
| `023` | refused | 15.2 MB exceeds the measured endpoint ceiling |

### Known limits, stated plainly

- **MiniCPM-V-4_5 returned no usable bounding boxes** on these photographs once
  the prompt stopped offering copyable ones. Every finding therefore reports
  *"no image region: the model did not localise it"*. That is the honest state
  and matches the product's stated principle — but it means the evidence overlay
  does not appear on the hero path. The boxes it produced earlier were verbatim
  template copies, so removing them was the correct trade.
- **The endpoint rejects images over ~10 MB.** Measured: 5.0 / 7.9 / 9.2 MB
  accepted, 15.9 MB rejected with HTTP 400. Enforced as `MAX_PROVIDER_IMAGE_BYTES`
  and refused at import with the real limit named, rather than failing opaquely.
- **One `MATCH` survives a fully rejected response**, on the `EXCAVATION ABSENT`
  row: a declined report satisfies "should be absent". The row's own text reads
  *"none seen in this capture"*, and this is pre-existing `ABSENT` semantics
  rather than a consequence of the placeholder fix. Locked by a test and called
  out rather than left as an oversight.
- **No cross-capture time series.** The dataset is not a chronological record of
  one zone, so no progress-over-time view is offered. Inventing one would be
  fabricating a construction sequence.
- **The dataset is not statistically representative** — 15 of 29 curated images
  come from one programme. See `sample/README.md`.

---

## Tests

`npm test` — **324 tests**, no network access. Baseline was 251; 73 were added.

| Area | What is locked in |
|---|---|
| EXIF geometry | Orientation parsing walks past a JFIF `APP0` (the `021` case that hid orientation 6). Normalization changes at most 2 bytes and never mutates its input. After normalization, stored and displayed geometry are identical. `transformBox` keeps every corner in frame for all 8 orientations. A zero-area box is not a localisation. |
| Placeholders | A zero-confidence element, an observation or a finding is discarded. `present: true` with evidence beginning "no visible" is rejected; a negation later in a sentence is not. A rejected placeholder cannot produce `MATCH` or `ATTENTION`. The prompt offers no copyable number. |
| Reasoning | A payload without a stated certainty is rejected. An invented certainty word is rejected. Missing recommendation or verification is rejected. Reasoning that only restates the vision stage is detected. Every unavailable state has its own message and none can read as "no issues". |
| Hybrid pipeline | Both stages are called and both appear in provenance. Reasoning **cannot** change a comparison status. A reasoning outage leaves the comparison identical. A failed vision run never invokes reasoning. |
| Responsible AI | Model confidence never verifies. Anonymous review is refused. A rejected finding stays rejected. Changing the reference discards the comparison **and** the reasoning about it. |
| Dataset | Id parsing, unreadable files skipped, unknown ids refused without touching disk, `LOCAL_DATASET` is a distinct source, over-ceiling files refused with the real limit, orientation normalized and the original recorded. |
| Persistence | Project and edited reference survive restart; upload bytes survive identically; `VERIFIED` and `REJECTED` survive; a demo-owned capture is skipped rather than faked; corrupt and future-schema state files are ignored; path traversal is refused. |
| Trust | A provider failure yields nothing. Every entry starts `UNVERIFIED`. A cached or restored result is re-validated, not trusted. |
| Storage | The API states where imagery actually is, for the instance actually running. |
| UI | Detail rows are never appended unguarded; every render step is isolated; the overlay scales against the *painted* photograph, not the element box; a broken image is reported. |

**No accuracy, precision or detection-rate number is asserted anywhere**,
because none has been measured. This is a reliability and honesty suite.

---

## Storage of the code

```
src/
  types/inspection.ts    domain contract + strict validation of model output
  compare.ts             REALITY vs EXPECTED — deterministic, in code
  reasoning.ts           stage-2 contract: types, validation, degeneracy check, context
  synthesis.ts           findings, priorities, reality brief, counters
  expected-state.ts      the reference (preset) catalogue + validation
  projects.ts            project + capture ownership; one session per capture; durability
  persistence.ts         atomic JSON persistence under data/
  dataset.ts             local dataset discovery + truthful import
  inspector.ts           the only place untrusted vision output becomes product data
  session.ts             one inspection session; runs SEE → COMPARE → UNDERSTAND
  server.ts              loopback JSON API + static assets
  image-metadata.ts      PNG/JPEG geometry, EXIF orientation, normalization
  providers/             vision: nebius-nvidia | demo-fixture
                         reasoning: nemotron-reasoner | unavailable
  ui/                    index.html / app.css / app.js as text modules
```

**Trust boundary.** Every model response is untrusted. Entries that fail
validation are **dropped and reported**, never repaired or coerced. A provider
failure produces **zero** findings. Provider failure, validation failure and a
genuinely empty result are three distinct outcomes.

---

## Scope

Deliberately **not** implemented, and not stubbed: organizations, RBAC, tenancy,
BIM management, issue tracking, enterprise administration.

## Licence

MIT — see [LICENSE](./LICENSE).

`.env` is git-ignored. `.env.example` contains placeholders only. No customer
imagery is present; the demo captures the application ships with are synthetic
scenes generated in code. The `sample/` dataset is licence-clean CC/PD imagery
that is local-only and untracked — see `sample/SOURCES.md` for per-file
attribution.
