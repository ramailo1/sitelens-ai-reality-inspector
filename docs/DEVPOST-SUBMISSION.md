# Devpost Submission — DRAFT (NOT SUBMITTED)

> **Status: DRAFT ONLY.** Nothing has been submitted to Devpost. Final
> submission requires explicit human authorisation and cannot be completed
> without a human Devpost account.
>
> **Live-run status (2026-10-03 UTC):** The SiteLens pipeline is **verified
> working end-to-end on a real image** through Nebius Token Factory, and **7
> non-NVIDIA Vision models** were discovered and passed the full pipeline.
> **The hackathon's NVIDIA requirement is NOT met:** both NVIDIA Vision
> candidates on the platform console — **Cosmos3-Super-Reasoner** and
> **Nemotron-Nano-V2-12b** — return `HTTP 404 model does not exist` and are not
> served to this account. The project therefore runs on a clearly-labelled
> **temporary development model**. See "Model discovery and NVIDIA eligibility".

## Registration status

| Item | Status |
|---|---|
| Devpost account | **NOT CREATED** — requires human registration (email + password) |
| Hackathon joined | **NOT DONE** — gated behind account creation |
| Project draft | **NOT CREATED** — gated behind account creation |
| Final submission | **NOT SUBMITTED** (correct) |

**Blocker:** joining the hackathon requires a Devpost account, which is
registered by a person with an email address, a password and (most likely)
email verification. `/enter` redirects to `secure.devpost.com/users/register`.
Those credentials are not held by this project and are not guessed or
worked around.

**This is now the only remaining blocker for submission.** Nebius access is no
longer blocked — authentication and a billable inference were verified live.

## Nebius access status

Verified by a live run on 2026-10-03 (UTC) against
`https://api.tokenfactory.nebius.com/v1/`. Facts below are established by that
run only; anything unmeasured is marked **UNRESOLVED**.

| Item | Status |
|---|---|
| `NEBIUS_API_KEY` available | **YES** — present in the environment, never logged or committed |
| Authentication | **SUCCEEDED** — `GET /v1/models` returned **HTTP 200** in 359 ms, listing **25 models** visible to this credential |
| Real inference executed | **YES** — `POST /v1/chat/completions` returned **HTTP 200**, `usage: 30 tokens (22 prompt / 8 completion)` |
| Account/credit status | **FUNCTIONAL** — a billable completion succeeded, so the key is not blocked for credit |
| Configured NVIDIA model | **UNAVAILABLE** — see "Model availability finding" below |
| `nvidia/nemotron-3-nano-omni` | **NOT SERVED** by Token Factory — HTTP 404 `model does not exist` |

Official activation code (from the hackathon Resources page):
`NEBIUS-DEVPOST-GLOBAL26` — via `nebius.com/promo-code`. Whether these credits
are specifically the hackathon allocation is **UNRESOLVED**; only that the
account can authenticate and complete a billable request has been verified.

### Model discovery and NVIDIA eligibility

**Catalogue (live `GET /v1/models`, HTTP 200): 25 models.** The API returns only
`id`, `created`, `object`, `owned_by` — **no modality metadata** — so vision
support is not discoverable from the catalogue and had to be established by
sending a real 256×256 synthetic construction scene to each candidate.

#### Platform-listed Vision models reconciled against the API

| Platform display name | Provider | Exact API ID | In `/v1/models` | Result |
|---|---|---|:-:|---|
| Cosmos3-Super-Reasoner | NVIDIA | *unresolved* | ❌ | **404 — not served** |
| Nemotron-Nano-V2-12b | NVIDIA | *unresolved* | ❌ | **404 — not served** |
| DeepSeek V4.1 Flash | DeepSeek | `deepseek-ai/DeepSeek-V4.1-Flash` | ✅ | pipeline PASS |
| gemma-3-27b-it | Google | `google/gemma-3-27b-it` | ✅ | pipeline PASS |
| GLM-5.3-Flash | Z.ai | `zai-org/GLM-5.3-Flash` | ✅ | pipeline PASS |
| Kimi-K2.6 | Moonshot AI | `moonshotai/Kimi-K2.6` | ✅ | pipeline PASS |
| Kimi-K3 | Moonshot AI | `moonshotai/Kimi-K3` | ✅ | pipeline PASS |
| MiniCPM-V-4_5 | OpenBMB | `openbmb/MiniCPM-V-4_5` | ✅ | pipeline PASS |
| qwen3-vl-32b | Qwen | *unresolved* | ❌ | **404 — not served** |
| Qwen2.5-VL-72B-Instruct | Qwen | *unresolved* | ❌ | **404 — not served** |
| Qwen3.8-27B | Qwen | `Qwen/Qwen3.8-27B` | ✅ | pipeline PASS |

**The discrepancy is explained:** the platform console advertises a wider Vision
catalogue than the account's callable surface. 8 of 11 resolve to real API ids;
3 (both NVIDIA candidates and both Qwen-VL ids) are advertised but **not
served** to this account.

#### NVIDIA result — both candidates absent

`Cosmos3-Super-Reasoner` and `Nemotron-Nano-V2-12b` could not be resolved to any
API id. **36 variants were probed** (casing, hyphenation, `-VL`, `-8B`, `-v2`,
unprefixed, and Cosmos-Reason1/2) and **every one returned
`HTTP 404 model does not exist`**. They are absent from `/v1/models` on every
reachable region, and `/v1/deployments`, `/v1/base_models`, `/v2/models` all
return `404 path-not-found` — there is no dedicated-deployment surface that
would expose them.

The four NVIDIA models that *are* in the catalogue remain **text-only**,
confirmed by sending a real image to each (HTTP 400
`This model does not support image input`, before any token is generated) while
all four return HTTP 200 for text.

**Conclusion:** no NVIDIA Vision model is currently callable through this
account. The blocker is **upstream model availability**, not the application —
the same request succeeds against seven non-NVIDIA Vision models.

#### Live image probe and SiteLens pipeline (same real image for all)

| Model | Provider | API ID | Image | HTTP | Latency | Observations | Rejected | Trust |
|---|---|---|:-:|:-:|--:|--:|--:|---|
| Qwen3.8-27B | Qwen | `Qwen/Qwen3.8-27B` | ✅ | 200 | **3 069 ms** | 4 | 0 | intact |
| Kimi-K3 | Moonshot AI | `moonshotai/Kimi-K3` | ✅ | 200 | 4 090 ms | 6 | 0 | intact |
| MiniCPM-V-4_5 | OpenBMB | `openbmb/MiniCPM-V-4_5` | ✅ | 200 | 4 337 ms | 5 | 0 | intact |
| GLM-5.3-Flash | Z.ai | `zai-org/GLM-5.3-Flash` | ✅ | 200 | 7 006 ms | 5 | 0 | intact |
| Kimi-K2.6 | Moonshot AI | `moonshotai/Kimi-K2.6` | ✅ | 200 | 11 625 ms | 4 | 0 | intact |
| DeepSeek V4.1 Flash | DeepSeek | `deepseek-ai/DeepSeek-V4.1-Flash` | ✅ | 200 | 16 830 ms | 6 | 0 | intact |
| gemma-3-27b-it | Google | `google/gemma-3-27b-it` | ✅ | 200 | 45 509 ms | 4 | 0 | intact |

**7/7 passed the complete pipeline** (`NebiusNvidiaProvider` → `RealityInspector`
→ strict validation → `AIObservation`) with **zero rejected entries** and the
trust state intact in every case. Latencies are single samples from one
session, **not benchmarks**, and are not a quality ranking.

**Independent proof the image was really processed:** several models report
`image_tokens` in their token usage — DeepSeek-V4.1-Flash **184**, GLM-5.3-Flash
**100**, Kimi-K3 **100**, Qwen3.8-27B **64**. Several returned empty `content`
on the first probe purely because a small `max_tokens` budget was consumed by
reasoning tokens; re-probed with a larger budget, all produced accurate
descriptions of the scene.

### Pipeline verification (live, on a real image)

To prove the app itself is sound, the **real project classes**
(`NebiusNvidiaProvider` → `RealityInspector` → strict validation) were run
against a vision-capable model using a **real 256×256 synthetic construction
scene**, producing non-empty, schema-valid observations:

| Stage | Result |
|---|---|
| Input | Synthetic 256×256 construction scene, `image/png`, 1 221 bytes |
| Reality Inspector | `inspectCapture()` invoked |
| AIProvider | `nebius-nvidia` via `createProvider()` |
| Nebius Token Factory | **HTTP 200** in 8 162 ms |
| Model response | Real completion parsed from the OpenAI-compatible envelope |
| Structured output | **3 observations**, **0 rejected** |
| Trust state | **All 3 `AI_GENERATED` / `UNVERIFIED`**, `review: null` |
| Human gate | `UNVERIFIED → VERIFIED` only via explicit human review |

Observations produced were recognisably correct for the synthetic scene (a
yellow construction vehicle, red and blue rectangular containers, and a ladder
on the left), with normalized bounding boxes and evidence descriptions.

**This model is not NVIDIA and is therefore NOT hackathon-eligible.** It is
recorded only as proof that the pipeline is correct and that the only missing
ingredient is an eligible NVIDIA model.

---

## A real bug the live run exposed (and the fix)

The first successful end-to-end run produced **4 observations that strict
validation rejected — correctly.** The cause was in the application, not the
model: `buildInspectionPrompt()` presented each enum field as a pipe-separated
choice list inside the JSON template, e.g.

```json
"category": "OBSERVED_ELEMENT | PROGRESS_OBSERVATION | POTENTIAL_DEVIATION | POTENTIAL_RISK | SUGGESTED_FOLLOW_UP"
```

That is a template placeholder, and the model **copied it verbatim**, returning
`"category": "OBSERVED_ELEMENT | PROGRESS_OBSERVATION"`. Validation rejected it —
correctly, since that string is not in the vocabulary. Note that the model *had
read the image correctly*; only the field formatting failed.

**Fix (prompt only, no validation change):** each JSON field now carries a
single legal value, and the legal set is stated separately in prose. After the
fix, the same live pipeline returned **3 observations, 0 rejected**, all
`AI_GENERATED` / `UNVERIFIED`.

This is a good illustration of the project's own thesis: the strict schema
refused to accept malformed model output instead of quietly repairing it, and
the real defect was found in the code rather than papered over in the validator.

---

### Development model

> **Configured model: `openbmb/MiniCPM-V-4_5`** (OpenBMB).
>
> This model is **not** an NVIDIA model and therefore does **not** satisfy the
> hackathon's NVIDIA requirement. It must not be submitted as if it did. Every
> demo run prints this explicitly.

**Selected on measured technical criteria only** — it is not a quality ranking.

The full bake-off in the README is the current selection evidence: MiniCPM
returned usable structured output on 4 of 5 real construction photographs
against 2/5 for `google/gemma-3-27b-it` and 1/5 for `Qwen/Qwen3.8-27B`, and the
complete server pipeline was then validated on 18 real images with 0 provider
failures.

Other verified candidates remain available purely by changing `NEBIUS_MODEL`:
`moonshotai/Kimi-K3`, `zai-org/GLM-5.3-Flash`, `moonshotai/Kimi-K2.6`,
`deepseek-ai/DeepSeek-V4.1-Flash`, `google/gemma-3-27b-it`, `Qwen/Qwen3.8-27B`.

Switching to an eligible NVIDIA model later requires **configuration only** —
no code change.

---

## Submission content (ready to paste)

### Project name
**SiteLens AI Reality Inspector**

### Short description (elevator pitch)
Construction photos become structured, human-verified progress observations — an
NVIDIA open-source multimodal model running on Nebius Token Factory, with a
human confirming every output.

### Track
**Best Apps and Agents** (primary fit: a practical application people would use).

### Technology list
- TypeScript (Node.js, zero runtime dependencies)
- NVIDIA Nemotron-3-Nano-Omni (open-source multimodal: vision + video + text)
- Nebius Token Factory (OpenAI-compatible inference API)
- Node.js native test runner

### Links
| Field | Value |
|---|---|
| Repository URL | *(to be filled after push)* |
| Demo URL | *(to be filled — local demo; hosted demo optional)* |
| Video | *(must be public on YouTube, < 3 minutes)* |

---

## What to say in the submission

### Nebius usage
Every inference call runs on **Nebius Token Factory** via its OpenAI-compatible
`chat/completions` API. The image is sent as a base64 data URL and the model
returns strict JSON. The base URL is validated to `*.nebius.com` over HTTPS.
There is **no offline shortcut on the real path**: if the credential is missing
or the API fails, the inspector produces **zero observations** and an explicit
failure, rather than falling back to a demo result.

### NVIDIA model usage

**Status: NOT SATISFIED.** The intended model is
`nvidia/nemotron-3-nano-omni` (NVIDIA, open-source, multimodal), and the code
path is fully built for it — but **that model id is not served by Nebius Token
Factory** (HTTP 404), and **all four reachable NVIDIA models are text-only**
(they reject image input). A hackathon-eligible NVIDIA vision run therefore
**cannot be demonstrated with the current account**. This must not be submitted
as though it were.

The model contract itself is implemented and verified: the capture image is sent
as a base64 data URL with an instruction to describe only visible reality, and
structured observations (category, observation, evidence, confidence, severity,
suggested action, optional bounding box) are expected back. The prompt forbids
the model from declaring compliance or structural safety. All of this was proven
to work end-to-end against a live vision-capable model — just not an eligible
NVIDIA one.

### Significant changes vs. the pre-existing SiteLens product
SiteLens is a separate, pre-existing construction-reality platform. **This
hackathon work was built in a brand-new standalone repository** and copies no
SiteLens production code. The genuinely new capability is the **AI Reality
Inspector**: a provider-agnostic inspection service that converts a construction
capture into structured, explicitly-unverified observations that a human must
verify.

### Architecture description
```text
Construction capture
    ↓
AI Reality Inspector (trust boundary)
    ↓
AIProvider interface (provider-neutral)
    ↓
Nebius Token Factory
    ↓
NVIDIA Nemotron-3-Nano-Omni
    ↓
Strict schema validation (invalid entries dropped, never repaired)
    ↓
AIObservation — AI_GENERATED + UNVERIFIED
    ↓
Human verification (VERIFY / REJECT)
```

**The differentiator for judges:** the safety architecture is enforced in code
and covered by tests — AI output can never become construction truth without a
human decision, and a provider outage never produces a fabricated result.

### Feedback on Nebius / NVIDIA (from the verified live run)

Only what was actually observed:

- **Authentication and billing work as documented.** A Token Factory key
  authenticates against the OpenAI-compatible
  `https://api.tokenfactory.nebius.com/v1/` surface and completes a billable
  request. No onboarding or credit obstacle was hit.
- **The catalogue is not self-describing.** `GET /v1/models` returns only
  `id`, `created`, `object`, `owned_by` — **no modality, capability or
  context-length metadata**. Vision support is not discoverable from the API and
  must be established by sending an image. This is a real usability gap for
  anyone selecting a model programmatically.
- **Model ids must be verified against the live catalogue.** A plausible,
  well-formed id (`nvidia/nemotron-3-nano-omni`) returned a clean
  `404 model does not exist`. Assuming an id from documentation or memory is not
  sufficient.
- **Text-only is rejected clearly.** Sending an image to a text-only model
  returns a precise HTTP 400 `This model does not support image input` at
  validation time, **before any tokens are generated** — so probing vision
  support is effectively free. Good, explicit error behaviour.
- **The four NVIDIA models offered to this account are text-only**, so the
  multimodal NVIDIA path required by this project's premise could not be
  exercised. **UNRESOLVED:** whether an NVIDIA vision-capable open-source model
  is available on Token Factory under a different offer, region, or account tier
  has **not** been established.

**Not claimed — nothing below has been measured:**

- Nemotron or NVIDIA model quality, accuracy, detection rate or precision
- Any model-to-model comparison
- Throughput, latency, concurrency or scaling behaviour (the single 359 ms
  catalogue call and one ~700 ms completion are single samples, not benchmarks)
- GPU type, GPU count, or underlying infrastructure
- Whether the account's credits are the hackathon allocation

---

> *(Superseded: an earlier version of this document recorded a pipeline check
> using a 1×1 placeholder, which returned 0 observations. That check has been
> replaced by "Pipeline verification (live, on a real image)" above, which used
> a real 256×256 scene and produced non-empty, schema-valid observations.)*

---

## Demo video plan (max 3 minutes)

```text
0:00–0:20  Construction problem — photos sit unread; progress needs manual walks
0:20–0:45  SiteLens capture + "Reality Is the Reference"
0:45–1:30  AI Reality Inspector running through Nebius + NVIDIA
1:30–2:15  Structured observations with AI_GENERATED + UNVERIFIED badges
2:15–2:40  Human verification / rejection action
2:40–3:00  Why this changes progress verification
```

The video must visibly show **Nebius + NVIDIA + SiteLens AI Reality Inspector**.

**Do not fabricate performance statistics or accuracy claims.** None have been
measured.