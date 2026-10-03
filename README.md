# SiteLens™ AI Reality Inspector

**Construction imagery → structured, verifiable observations — analysed by an NVIDIA open-source model running on Nebius Token Factory.**

> **Reality Is the Reference™**

Built for the **Nebius × NVIDIA Global AI Hackathon**.

> ### Live verification status (2026-10-03 UTC)
>
> **The pipeline works end-to-end on a real image** through Nebius Token
> Factory: real inference, structured output, strict validation, and
> observations correctly held at `AI_GENERATED` / `UNVERIFIED`.
>
> **7 non-NVIDIA Vision models were discovered and all 7 passed the full
> pipeline** with zero rejected entries. The fastest measured was
> `Qwen/Qwen3.8-27B` (3 069 ms), now configured as the **temporary development
> model**.
>
> **The hackathon's NVIDIA requirement is still NOT met.** Both NVIDIA Vision
> candidates on the platform console — **Cosmos3-Super-Reasoner** and
> **Nemotron-Nano-V2-12b** — are **absent from Token Factory**: 36 id variants
> were probed and all returned `HTTP 404 model does not exist`. They are also
> absent from `/v1/models` on every reachable region. The four NVIDIA models that
> *are* in the catalogue are all **text-only**.
>
> **TEMPORARY DEVELOPMENT MODEL — NOT THE NVIDIA HACKATHON MODEL.**
> Switching back to an eligible NVIDIA model requires only changing
> `NEBIUS_MODEL`; no code change is needed. See
> [`docs/DEVPOST-SUBMISSION.md`](./docs/DEVPOST-SUBMISSION.md) for full evidence.

---

## Project

Construction teams photograph a site every day. Turning those photographs into
*structured project information* — progress, deviations, risks, follow-ups —
normally means manual review, and it usually stalls when there is no perfect BIM
model to compare against.

**SiteLens AI Reality Inspector** takes one construction capture, has an
**NVIDIA open-source multimodal model** (running on **Nebius Token Factory**)
describe what is actually visible, and converts that description into a
**strict, structured observation** that a human then verifies.

The defining constraint is deliberate: **AI output is never accepted as ground
truth.** Every observation is born `AI_GENERATED` + `UNVERIFIED`, and only a
human can verify or reject it.

---

## Problem

| Problem today | What this changes |
|---|---|
| Site photos sit in a folder nobody reads | Each capture produces structured, reviewable observations |
| Progress reporting depends on manual site walks | A model surfaces *candidate* progress indicators for a human to check |
| "Is this a deviation?" needs an engineer and a BIM model | A model flags *potential* deviations as candidates — never as verdicts |
| No audit trail of what was observed and when | Every observation carries provider, model, timestamp and a human decision |

**We deliberately do not claim accuracy numbers.** This project demonstrates a
working, honest pipeline — not a benchmark. No detection-rate or precision
figure is asserted anywhere in this repository because none has been measured.

---

## New hackathon capability

Everything in this repository is new work created for the hackathon. The AI
Reality Inspector consists of:

1. **A provider abstraction** (`src/providers/provider.ts`) — the UI never
   calls Nebius directly; it depends on this interface only.
2. **A real Nebius provider** (`src/providers/nebius-nvidia.provider.ts`)
   — speaks the OpenAI-compatible Token Factory API.
3. **A deterministic offline provider** (`src/providers/demo-fixture.provider.ts`)
   — lets a judge run the entire flow with no account and no network.
4. **The trust boundary** (`src/inspector.ts`) — the single place where
   untrusted model output becomes structured product data.
5. **A strict output contract** (`src/types/observation.ts`) — schema
   validation that rejects rather than repairs.
6. **The inspection surface** (`src/session.ts`) — one provenance record
   shared by the UI and the CLI, so they cannot disagree about what ran.
7. **Actionable findings** (`src/findings.ts`) — a finding can only be raised
   from a human-verified observation, and never becomes a production issue.
8. **Eligibility rules** (`src/eligibility.ts`) — three-state classification
   so an unverified NVIDIA id can never be presented as satisfying the
   requirement.

---
## Architecture

```text
Construction capture (image)
        ↓
AI Reality Inspector  (src/inspector.ts — the trust boundary)
        ↓
AIProvider interface  (src/providers/provider.ts — provider-neutral)
        ↓
NebiusNvidiaProvider
        ↓
Nebius Token Factory   https://api.tokenfactory.nebius.com/v1/
        ↓
NVIDIA Nemotron-3-Nano-Omni  (multimodal: vision + video + text)
        ↓
Raw JSON observations  ← UNTRUSTED
        ↓
Strict schema validation  ← invalid entries are DROPPED, never repaired
        ↓
AIObservation  (AI_GENERATED + UNVERIFIED)
        ↓
Human verification  (VERIFY / REJECT / OVERRIDE)
```

### Why the provider abstraction matters

The `AIProvider` interface is the seam keeping hackathon infrastructure out of
the product. Swapping Nebius for another backend means writing one new class —
no inspector code changes. `AI_PROVIDER` selects the implementation, and there is
**no silent fallback**: if `AI_PROVIDER=nebius` and the key is missing you get an
explicit `NOT_CONFIGURED` failure, never a demo result that would misrepresent
which model actually ran.

### Failure behaviour (fail-closed, verified by tests)

| Situation | Result |
|---|---|
| Missing `NEBIUS_API_KEY` | `NOT_CONFIGURED`, **zero observations**, non-zero exit |
| HTTP 401 / 403 | `AUTHENTICATION`, key never echoed into logs |
| HTTP 429 | `RATE_LIMITED` |
| HTTP 5xx / network error | `UNAVAILABLE` |
| Deadline exceeded | `TIMEOUT` (enforced with `AbortController`) |
| Non-JSON or missing `observations` | `MALFORMED_RESPONSE` — **never** silently "0 findings" |
| Invalid field values | Entry dropped and reported in `rejected[]` |

**If Nebius is unavailable, SiteLens does not invent an AI result.**

---

## Nebius usage

| Item | Value |
|---|---|
| **Service** | Nebius **Token Factory** (serverless, OpenAI-compatible inference) |
| **Endpoint** | `https://api.tokenfactory.nebius.com/v1/chat/completions` |
| **Regional variants** | e.g. `https://api.tokenfactory.us-central1.nebius.com/v1/` |
| **Authentication** | `Authorization: Bearer $NEBIUS_API_KEY` |
| **Runtime path** | `NebiusNvidiaProvider.inspect()` → base64 data URL → `chat/completions` |
| **Why required** | The hackathon requires every submission to run on Nebius Token Factory or Nebius AI Cloud |

The base URL is **validated**: only `*.nebius.com` over HTTPS is accepted. A
misconfigured or hostile `NEBIUS_BASE_URL` falls back to the documented default
rather than shipping construction imagery to an unintended host.

---

## NVIDIA usage

| Item | Value |
|---|---|
| **Model** | `nvidia/nemotron-3-nano-omni` |
| **Provider** | NVIDIA |
| **Modality** | *UNVERIFIED* — intended multimodal (vision + video + text); **not** confirmed against a live response |
| **Licence** | NVIDIA Open Model License |
| **Served via** | Nebius Token Factory |
| **Availability** | ❌ **NOT SERVED** — live run returned `HTTP 404 — model does not exist` |

> ### Model availability finding
>
> `nvidia/nemotron-3-nano-omni` returns `HTTP 404 — model does not exist` and is
> absent from every reachable region. The four NVIDIA models that *are* in the
> catalogue are all **text-only** (verified by sending a real image). The two
> NVIDIA **Vision** candidates shown on the platform console —
> `Cosmos3-Super-Reasoner` and `Nemotron-Nano-V2-12b` — are **not served by
> Token Factory at all**; 36 id variants were probed and every one returned
> `404 model does not exist`. They are listed on the platform but are not
> callable through this account, and no dedicated-deployment endpoint exists.
>
> Until an eligible NVIDIA Vision model is reachable, this project runs on a
> **temporary non-NVIDIA Vision model** and **does NOT satisfy the hackathon
> requirement**. The demo prints this explicitly on every run.

**Vision models verified through the full pipeline (all non-NVIDIA):**

| Model | Provider | API ID | Pipeline |
|---|---|---|---|
| Qwen3.8-27B | Qwen | `Qwen/Qwen3.8-27B` | 3 069 ms — **configured** |
| Kimi-K3 | Moonshot AI | `moonshotai/Kimi-K3` | 4 090 ms |
| MiniCPM-V-4_5 | OpenBMB | `openbmb/MiniCPM-V-4_5` | 4 337 ms |
| GLM-5.3-Flash | Z.ai | `zai-org/GLM-5.3-Flash` | 7 006 ms |
| Kimi-K2.6 | Moonshot AI | `moonshotai/Kimi-K2.6` | 11 625 ms |
| DeepSeek V4.1 Flash | DeepSeek | `deepseek-ai/DeepSeek-V4.1-Flash` | 16 830 ms |
| gemma-3-27b-it | Google | `google/gemma-3-27b-it` | 45 509 ms |

Latencies are single samples from one session, **not benchmarks**, and are not a
quality ranking.

**Selecting a model on Token Factory:** `GET /v1/models` exposes only
`id`, `created`, `object`, `owned_by` — **no modality metadata** — and a
well-formed id can still 404. Always verify a candidate by sending a real image;
text-only deployments reject it at validation with
`400 This model does not support image input` before any tokens are spent.

**Why the NVIDIA model is intended to qualify:** the hackathon requires *"at least one NVIDIA open source
model"*, served on Nebius. Nemotron-3-Nano-Omni is an NVIDIA open-source
multimodal model served by Token Factory. It was chosen over the text-only
Nemotron reasoning models because **construction analysis is a vision task** —
the model must read the photograph.

**Input it receives:** the capture image (a `data:image/...;base64` URL) plus an
instruction to describe only visible reality.
**Output it produces:** strict JSON — an `observations` array of structured
entries (category, observation, evidence, confidence, severity, suggested action,
optional normalized bounding box).

The system prompt explicitly forbids the model from declaring compliance,
structural safety, or measurements it cannot read from the image.

---
## The observation contract

Every observation is a structured record — never free-form text treated as truth:

```ts
interface AIObservation {
  id: string;
  captureId: string;
  projectId: string | null;
  zoneId: string | null;
  category:
    | 'OBSERVED_ELEMENT'
    | 'PROGRESS_OBSERVATION'
    | 'POTENTIAL_DEVIATION'
    | 'POTENTIAL_RISK'
    | 'SUGGESTED_FOLLOW_UP';
  observation: string;          // one factual sentence about what is VISIBLE
  evidence: {
    description: string;        // why the model said it
    boundingBox: { x, y, width, height } | null;  // normalized [0,1]
    zoneId: string | null;
  };
  confidence: number;           // model confidence in [0,1] — NOT a measurement
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';   // advisory only
  suggestedAction: 'NO_ACTION' | 'HUMAN_REVIEW' | 'INSPECT_CLOSER'
                 | 'CAPTURE_REFERENCE_PLAN' | 'SCHEDULE_FOLLOW_UP';
  model: string;
  provider: string;
  generatedAt: string;
  origin: 'AI_GENERATED';        // set once, at creation
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'OVERRIDDEN';
  review: { status, reviewer, reviewedAt, note } | null;
}
```

### The trust rules, and why they are enforced in code

1. **`origin` is always `AI_GENERATED`** and **`verificationStatus` always starts
   `UNVERIFIED`.** These are set in exactly one place and are never derived from
   model content — a model cannot talk its way into being "verified".
2. **Confidence cannot auto-verify.** A `0.99` observation is still `UNVERIFIED`
   until a human acts. There is a test asserting exactly this.
3. **Validation rejects, it never repairs.** A non-numeric confidence, an
   unknown category, or a pixel-space bounding box causes the entry to be
   **dropped and reported** — not coerced into something that looks valid.
4. **Model output is untrusted input.** All model strings are rendered as plain
   text in any UI; this repository injects no model output into HTML.
5. **A provider outage yields zero observations**, never a fabricated result.

---

## Running locally

Requires **Node.js 22.6+** (uses native TypeScript execution). No build step.

```bash
git clone <this-repo>
cd sitelens-ai-reality-inspector
npm install
```

### The inspector (recommended)

```bash
AI_PROVIDER=nebius npm run ui
# open http://127.0.0.1:4317
```

The UI is a local inspection instrument: pick a scene, press **Run AI
Inspection**, read the observations against the evidence boxes drawn over the
capture, then review each one as a named human. The server binds to loopback
only. It works with the offline provider too, so it runs with no account and no
network.

### Option A — deterministic demo (no account, no network)

```bash
AI_PROVIDER=demo npm run demo
```

### Option B — real Nebius + NVIDIA

```bash
cp .env.example .env      # then set NEBIUS_API_KEY
export NEBIUS_API_KEY="<your Token Factory key>"
AI_PROVIDER=nebius npm run demo
```

Get a key at **https://tokenfactory.nebius.com**.

Select the model with `NEBIUS_MODEL`. The default is the intended NVIDIA model;
any callable vision-capable model id works for development, and no code change is
needed to switch. See "Model availability finding" for what is currently
reachable from this account.

### Compatibility evaluation

```bash
AI_PROVIDER=nebius npm run eval
```

Runs each generated construction scene through the real pipeline and reports
request success, accepted and rejected counts, and whether the trust boundary
held. It is a **reliability report, not an accuracy benchmark**: there is no
ground truth, so no correctness score is produced.

### Tests

```bash
npm test        # 89 tests
npm run typecheck
```

---

## Environment variables

**Variable names only — no secret values are ever documented or committed.**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEBIUS_API_KEY` | yes for `nebius` | — | Token Factory credential (**SECRET**) |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1/` | Endpoint; `*.nebius.com` HTTPS only |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-nano-omni` | Model id. **Intended NVIDIA model (404 today).** Set to any callable Vision id — e.g. `Qwen/Qwen3.8-27B` — to run for development. Switching is configuration only |
| `NEBIUS_TIMEOUT_MS` | no | `60000` | Per-call deadline |
| `AI_PROVIDER` | no | `nebius` | `nebius` (real) or `demo` (offline) |
| `AI_MAX_OBSERVATIONS` | no | `6` | Cap on observations per capture |
## Demo — how a judge reproduces it

```bash
AI_PROVIDER=demo npm run demo
```

The run prints, in order:

1. **STEP 1** — the selected capture (capture / project / zone).
2. **STEP 2** — the AI Reality Inspector running, naming the provider and model.
3. **STEP 3** — structured observations, each tagged
   `origin: AI_GENERATED`, `verification: UNVERIFIED`, with evidence, confidence
   band, severity and suggested action.
4. **STEP 4** — a **human verification** action showing the status change from
   `UNVERIFIED` → `VERIFIED`.
5. **Provenance** — provider, model, and an explicit `hackathon-eligible: YES/NO`
   line so it is never ambiguous which run was real.

To prove the fail-closed behaviour, run without a key:

```bash
AI_PROVIDER=nebius npm run demo    # no NEBIUS_API_KEY
# → INSPECTION FAILED (NOT_CONFIGURED), zero observations, exit code 1
```

---

## Security posture

- **Secrets**: read from the environment only; sent as a bearer header and
  nowhere else. `redactSecrets()` masks the key and any `Bearer …` token in error
  paths. No secret is written to disk, logged, or returned.
- **Imagery**: treated as sensitive. It is transmitted only to a validated
  `*.nebius.com` HTTPS endpoint.
- **SSRF guard**: a non-Nebius or non-HTTPS `NEBIUS_BASE_URL` is rejected and
  replaced with the documented default.
- **No customer data**: the committed demo asset is a generated 1×1 PNG
  placeholder. No customer imagery, media, or database dumps are in this repo.
- **Untrusted output**: model output is validated and treated as data, never as
  instructions or markup.

---

## Testing

89 tests, all passing (`npm test`), covering:

| Area | Covered |
|---|---|
| Request validation | empty image, non-image media type |
| Response validation | valid, missing fields, wrong types, unknown categories, out-of-range confidence, pixel-space bounding boxes, overlong strings |
| Malformed model output | non-JSON, JSON without `observations`, missing `choices` |
| Nebius failure | 401, 429, 503, network error |
| Timeout | a hanging provider is aborted at the deadline → `TIMEOUT` |
| Missing API key | `NOT_CONFIGURED`, and **no network call is made** |
| Credential handling | bearer header shape, redaction, no leak in error details |
| Host validation | non-Nebius and non-HTTPS base URLs rejected |
| Unverified status | every observation starts `AI_GENERATED` + `UNVERIFIED` |
| Human verification | VERIFY, REJECT, unknown id refused, anonymous reviewer refused |
| Confidence safety | `0.99` confidence does **not** auto-verify |
| No fabricated results | provider failure → zero observations |
| Demo flow | offline end-to-end run |
| Prompt contract | no pipe-separated choice list in any JSON value; each template field carries one legal enum value; the full legal set is still named in prose; the live "combined category" defect shape is **still rejected** by validation |
| Demo provenance | hackathon eligibility follows the **model id**, not the provider class — a non-NVIDIA model on the live path reports NOT eligible; provenance always prints, even with zero observations |
| Failure modes | HTTP 400/404/429/500/503, timeout, missing credential, non-image media type, empty and malformed images, oversized image; every one produces **zero observations** and no verified truth |
| Response integrity | non-JSON, missing `choices`, missing `observations` array, invalid enum, missing field, pixel-space bounding box — all rejected or classified distinctly |
| Outcome honesty | provider failure, validation failure and a genuinely empty result are three **separate** outcomes |
| Findings | only a `VERIFIED` decision raises a finding; `REJECTED` and `NEEDS_REVIEW` never do |
| Geometry | normalized boxes project onto real pixels; a missing box or missing image header yields no box rather than a guessed one |

The prompt-contract tests guard a defect found in a **live** run: the prompt
had presented enums as `"A | B | C"` inside the JSON template, and models copy
such placeholders verbatim, producing `"category": "OBSERVED_ELEMENT |
PROGRESS_OBSERVATION"` — which strict validation correctly rejected. The prompt
was fixed; the validator was not weakened.

No accuracy or performance statistics are asserted anywhere.

---

## Future SiteLens integration (NOT implemented here)

Deliberately out of scope. Proposed future shape:

```text
Existing SiteLens capture + tenancy
        ↓
AI Reality Inspector API (this contract)
        ↓
Nebius Token Factory
        ↓
NVIDIA Nemotron multimodal model
        ↓
Structured observation
        ↓
SiteLens observation / risk / issue  (human-verified)
```

Integration would require mapping `captureId`/`projectId` to SiteLens tenancy,
enforcing project-ancestry authorization before any capture is read, and
persisting verified observations into SiteLens' own schema. **None of this is
implemented, and this repository contains no SiteLens code.**

---

## Licence

MIT — see [LICENSE](./LICENSE).

The Nemotron model is licensed by NVIDIA (NVIDIA Open Model License); it is
called remotely and is **not redistributed** here.

## Relationship to SiteLens

This is a standalone hackathon repository. It contains no SiteLens production
code, no credentials, and no customer data. The "SiteLens" name and the
*Reality Is the Reference™* principle are used to describe the capability and
its intent.

`.env` is git-ignored. `.env.example` contains placeholders only.

---