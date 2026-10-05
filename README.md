# SiteLens™ AI Reality Inspector

**One construction photograph → what the AI can see → how that compares to what you expected → where your inspector should look first → what a human must physically verify.**

> **REALITY IS THE REFERENCE™**

Built for the **Nebius × NVIDIA Global AI Hackathon**.

> ### AI doesn't replace the inspector.
> ### AI tells the inspector where to look, what changed, why it matters, and what to verify.

---

## Run it

```bash
npm install          # zero runtime dependencies
npm test             # 251 tests
npm run typecheck    # strict tsc, no emit

# Deterministic offline demo (no network, no key needed):
AI_PROVIDER=demo npm run ui     # -> http://127.0.0.1:4317

# Real inference on Nebius Token Factory:
AI_PROVIDER=nebius npm run ui
```

Node ≥ 22.6 (uses native type-stripping; there is no build step).

---

## The 60-second demo path

1. `npm run ui`, open `http://127.0.0.1:4317`.
2. **Project** — the masthead selector opens the project list. Create, rename or
   delete projects from here; the current project's captures, reference and
   findings belong to it alone.
3. **Capture** — click a capture in *Captures in this project*, or drop a site
   photograph.
4. The **Reality vs expected** table appears: the expected items compared against
   what the model saw.
5. Click **Inspect reality**.
6. The tool moves to **Evidence**: the capture fills the stage, numbered boxes
   mark where the AI flagged something, and the right rail reads
   `REALITY / INSPECTION / FINDINGS / CONFIDENCE / OVERALL`.
7. Click any finding. It expands to **WHAT · WHERE · WHY FLAGGED · EXPECTED ·
   DIFFERENCE · CONFIDENCE · RECOMMENDED ACTION · EVIDENCE · VERIFICATION**,
   and its region lights up on the image.
8. Type a name in **Reviewer** and press **CONFIRM**. The card flips from
   `AI SUSPECTED → UNVERIFIED` to `HUMAN VERIFIED → VERIFIED`, records who and
   when, and drops out of the priority list.

Nothing is verified until step 8. That is the product, not a caveat.

### Projects, captures and references

A project owns its captures, its inspection results and its comparison reference.
Switching projects replaces all three, and the server refuses to read, run or
delete a capture through an id that belongs to another project. Deleting a project
removes its captures with it; deleting the last project returns to the empty state
where a new one can be created.

The **expected-state reference** is a named preset. Two are built in and cannot
be deleted; an operator can add, rename and delete their own. A project records
which preset it uses, and operator edits are recorded against the project rather
than mutating the shared catalogue. Changing a reference discards any comparison
the old reference produced, so a row on screen always belongs to the reference
named above it.

### Where uploaded images are stored

Uploaded images are held **in the memory of the running server process**. They are
never written to disk, and there is no database or object store behind them.
`GET /api/capture-image/:id` serves those same bytes back, and only to the project
that owns the capture.

**Nothing survives a restart.** Projects, uploads, custom references, inspection
results and human verifications are all lost when the server stops; the app
reopens with its synthetic demo project. This is deliberate for a hackathon
demonstration and is stated in the UI next to the capture, not left implied.

Deleting a capture releases its bytes immediately, and deleting a project
releases every image it owned.

---

## What is actually AI, and what is not

This matters more than any feature, so it is stated bluntly.

| Stage | Who does it | What it means |
|---|---|---|
| **SEE** | the model | Reads the photograph. Emits `elements` with an optional `count`. |
| **UNDERSTAND** | the model | Names the construction elements it can see. |
| **COMPARE** | **this repository, in code** | Compares expected vs detected with plain arithmetic. |
| **INSPECT** | code | Turns a mismatch into a finding with evidence. |
| **EXPLAIN** | code + model text | WHAT / WHERE / WHY / EVIDENCE. |
| **RECOMMEND** | code + model text | A physical check a person can carry out. |
| **VERIFY** | **a named human** | The only path from candidate to settled. |

**The comparison is deliberately not in the prompt.** A model asked to
"compare expected 12 columns against this image" will agree with whatever it
imagined. Here the arithmetic is ours (`src/compare.ts`) and the evidence is the
model's, so the numbers on screen are arithmetic rather than a model's opinion.

### What the tool refuses to do

- **It never invents a number.** If the model will not commit to a count, the
  result is `NOT_DETERMINABLE`, not `0`.
- **It never turns an unknown into a defect.** A `COUNT` expectation the
  capture cannot settle is `UNDETERMINED` → severity `INFO`, kept out of the
  ranked priority list, and reported separately as *"this capture cannot
  settle"*. It is open work, but it is not somewhere to look for a defect.
- **It never manufactures engineering claims.** The prompt forbids compliance
  and safety conclusions, and every comparison finding recommends a *physical*
  verification, with counts labelled `VISUAL_COUNT — not a measured quantity`.
- **It never fakes evidence geometry.** An evidence box is drawn only when the
  model returned real pixel coordinates. When it did not, the card says so.
- **It never auto-verifies.** Confidence is explicitly not acceptance.

---

## Live model status (measured 2026-10-04)

**The hackathon's NVIDIA requirement is NOT met, and this repository does not
pretend otherwise.**

Every NVIDIA model in the Token Factory catalogue was probed with real image
input. All four are **text-only**:

| Model | Image input |
|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `HTTP 400 This model does not support image input` |
| `nvidia/nemotron-3-super-120b-a12b` | `HTTP 400 This model does not support image input` |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | `HTTP 400 This model does not support image input` |
| `nvidia/Nemotron-3_5-Lightning` | `HTTP 400 This model does not support image input` |

Since this product's entire value is looking at a photograph, the default is the
vision model that actually **inspects** best:

```
NEBIUS_MODEL=openbmb/MiniCPM-V-4_5
```

That is **real inference on real imagery**. It is simply not an NVIDIA model,
so `classifyEligibility` reports `NOT_ELIGIBLE` and the UI says so on every
run. If an NVIDIA vision model appears, changing `NEBIUS_MODEL` is the only
edit required.

### Measured vision-model bake-off

All three vision-capable catalogue models were run through the **same**
repository prompt, schema, validators and image bytes, at
`NEBIUS_MAX_TOKENS=3000`, over five real construction photographs:

| Model | Usable images | Elements | Findings | Observations | Avg latency |
|---|---|---|---|---|---|
| `openbmb/MiniCPM-V-4_5` **(default)** | **4/5** | **16** | **9** | **9** | 6,228 ms |
| `google/gemma-3-27b-it` | 2/5 | 5 | 2 | 3 | 5,897 ms |
| `Qwen/Qwen3.8-27B` | 1/5 | 5 | 1 | 3 | 12,863 ms |

MiniCPM was chosen on **inspection yield, not speed**. Gemma is marginally
quicker per call, but it returned unusable output on three of five photographs,
so it cannot be the default for a product whose job is to look at a picture.

> **Qwen3.8-27B is not broken.** It is a *reasoning* model: it spent 3,034–4,156
> completion tokens on reasoning before answering, so a small budget truncates it
> mid-JSON. It needs `NEBIUS_MAX_TOKENS >= 6000` and runs roughly twice as slow.

### `NEBIUS_MAX_TOKENS` is measured, not guessed

`1400` was the old default and it is **too small for real photographs** — MiniCPM
truncated mid-JSON on site photos and returned unparseable output. A token sweep
showed `3000` removes that truncation while staying tight enough that the model
does not pad its answer. The budget was raised on evidence.

### Validated on a wider set

The selected model was then run through the **complete server pipeline** — HTTP
API, provider, validation, comparison, synthesis, cache and verification — on 18
real construction photographs:

| Metric | Result |
|---|---|
| Inspections attempted / succeeded | 18 / **18** |
| Provider failures | **0** |
| Malformed responses | **0** |
| Fresh AI inferences | **18** |
| Cache hits on repeat run | **5/5 served** (13 ms vs ~5,100 ms) |
| Detected elements / findings | 51 / 88 |
| Comparison MATCH / ATTENTION / UNDETERMINED | 36 / 6 / 66 |
| Human verifications persisted | 18 |
| Average latency | 5,140 ms |

The high `UNDETERMINED` count is the system working correctly: a single
photograph usually cannot settle every expected-state question, and the UI says
"undetermined" instead of guessing.

**For a live demo, use the deterministic provider** (`AI_PROVIDER=demo`) — it is
instant and exercises every stage. A real live run takes about five seconds on
MiniCPM.

`AI_PROVIDER=demo` uses a deterministic offline fixture. It is labelled
**"DEMO FIXTURE — NOT AI INFERENCE"** in the masthead, and every finding it
produces carries `synthetic: true`. A fixture is never presented as a model.


---

### Where a result actually came from

A fast response is not automatically a fresh one. Every run is labelled with its
true origin in the masthead, and the label is derived from how the result was
produced, never from how fast it arrived:

| Badge | Meaning |
|---|---|
| *(none)* | `FRESH` — a real model call was made for this run. |
| `CACHED AI RESULT — inference from <timestamp>` | A **real** AI result, reused from an earlier identical inference. The original time is shown. |
| `DEMO FIXTURE — NOT AI INFERENCE` | The offline deterministic fixture. Never presented as a model. |

Reuse caching is **opt-in** via the `reuse cached AI` checkbox, so the default
is always a fresh call. The cache is:

- **content-addressed** — keyed on the image bytes, the model id, the expected
  state and a schema version, so changing any of them cannot serve a stale answer;
- **success-only** — a failed, malformed or fully-rejected response is never
  stored, so a bad result can never come back as a fast "success";
- **re-validated on read** — a cached entry is passed back through the validators
  rather than trusted;
- **never used for the demo fixture**, where a "cached" label would be
  actively misleading.

`GET /api/cache` reports the current entry count; `POST /api/cache/clear` empties
it.

Zero runtime dependencies, no build step, no framework.

```
src/
  types/inspection.ts    the domain contract + strict validation of model output
  compare.ts             REALITY vs EXPECTED — deterministic, in code
  synthesis.ts           findings, priorities, reality brief, counters
  expected-state.ts      the reference (preset) catalogue + validation
  projects.ts            project + capture ownership; one session per capture
  inspector.ts           the only place untrusted output becomes product data
  session.ts             one inspection session; derives every view
  server.ts              loopback JSON API + static assets
  ui/                    index.html / app.css / app.js as text modules
  providers/             AIProvider → Nebius (real) | demo-fixture (offline)
```

**Trust boundary.** Every model response is untrusted. Entries that fail
validation are **dropped and reported**, never repaired or coerced. A provider
failure produces **zero** findings — an outage can never look like a working
inspection. Provider failure, validation failure and a genuinely empty result
are three distinct outcomes.

---

## Tests

`npm test` — 251 tests, no network access.

| Area | What is locked in |
|---|---|
| Comparison | A count mismatch is ATTENTION; an uncountable or unreported element is UNDETERMINED, never a fabricated shortfall. Order-independent. |
| Synthesis | MATCH never becomes a finding. UNDETERMINED is never ranked as a defect to look for. A clean run reports `NO_ATTENTION` rather than inventing drama. |
| Session | A human review **survives a re-render**; an anonymous review is refused; verifying removes an item from the work list. |
| Expected state | Presets stay `PRESET`, operator edits are always `OPERATOR` — provenance is never laundered. |
| Validation | Unknown enums, pixel-space boxes, out-of-range confidence and impossible counts are all rejected. |
| Trust | Every finding starts `UNVERIFIED`. Confidence never auto-verifies. A provider failure yields nothing. |
| Projects | A capture, its findings and its reference belong to one project. Another project's capture cannot be read, run or deleted. Deleting a project removes its captures; deleting the last one returns to the empty state. |
| References | Built-in references cannot be deleted. A custom reference can be created, renamed and deleted. Changing a project's reference discards the comparison the previous one produced. |
| Storage | Uploaded bytes are held in process memory only. Deleting a capture or project releases them; nothing survives a restart, and the UI says so. |
| Provider | Bounded completion, bearer auth, image as data URL, every HTTP failure mapped explicitly. |
| UI | Assets parse; the tablist is real; an inspection only advances when it actually completed. |

**No accuracy, precision or detection-rate number is asserted anywhere**,
because none has been measured. This is a reliability and honesty suite.

---

## Scope

Deliberately **not** implemented, and not stubbed: organizations, RBAC,
tenancy, BIM management, issue tracking, enterprise administration. Those are
not what this hackathon demonstrates, and pretending otherwise would dilute the
one inspection loop that works.

See [`docs/DEVPOST-SUBMISSION.md`](./docs/DEVPOST-SUBMISSION.md) for the
submission narrative and full eligibility evidence.

## Licence

MIT — see [LICENSE](./LICENSE).

`.env` is git-ignored. `.env.example` contains placeholders only. No customer
imagery is present; the demo captures the application ships are synthetic scenes
generated in code.

A separate, **local-only** reference dataset of genuine CC-licensed construction
photographs may be present in a `sample/` directory on a working copy. It is not
tracked by git, is not loaded by the application, and nothing in this repository
depends on it. Where it exists, `sample/SOURCES.md` carries the per-file
provenance, licences and checksums.
