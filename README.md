# SiteLens™ AI Reality Inspector

**One real construction photograph → visual reading → deterministic SiteLens comparison → Nemotron construction reasoning → named human verification.**

> **REALITY IS THE REFERENCE™**

Built for the **Nebius × NVIDIA Global AI Hackathon**.

> ### AI does not replace the inspector.
> ### AI tells the inspector where to look, what it means, and what to verify.

---

## Quick Start

```bash
npm install          # zero runtime dependencies
npm test             # 339 tests passing
npm run typecheck    # strict tsc, 0 errors

# Option A: Real inference on Nebius Token Factory (MiniCPM-V + Nemotron):
AI_PROVIDER=nebius npm run ui     # -> http://127.0.0.1:4317

# Option B: Deterministic offline demo (no network or API key required):
AI_PROVIDER=demo npm run ui
```

*Requires Node ≥ 22.6 (uses native type-stripping; no build step required).*

Set `SITELENS_PERSIST=off` to run entirely in memory. Without it, state is written to `data/` and survives server restarts — see [Storage and Persistence](#storage-and-persistence).

---

## The Hybrid AI Architecture

SiteLens combines **two specialized AI models**, **deterministic application logic in code**, and **mandatory human verification**:

```text
       CONSTRUCTION REALITY (photograph upload or local dataset)
                                 │
                                 ▼
[1] MiniCPM-V-4_5     SEE         Visual reading of site photograph
                                 Elements, counts, visual observations
                                 │
                                 ▼
[2] compare.ts        COMPARE     MATCH / ATTENTION / UNDETERMINED — in code
                                 Arithmetic over expected-state reference
                                 │
                                 ▼
[3] Nemotron          UNDERSTAND  Construction reasoning over [1] and [2]
                                 Summary, recommendations, what to verify
                                 (Sees NO image; receives structured text only)
                                 │
                                 ▼
[4] Named Human       VERIFY      The ONLY path from candidate to settled
                                 VERIFIED / NEEDS REVIEW / REJECTED
```

### Why the Pipeline Split is Real

| Pipeline Stage | Component | Responsibility | Boundary & Safety Rule |
|---|---|---|---|
| **SEE** | `openbmb/MiniCPM-V-4_5` | Visual extraction of physical elements | Forbidden from declaring structural compliance or measurements |
| **COMPARE** | `src/compare.ts` | Arithmetic evaluation against expected state | Strictly deterministic code; ignores model opinions |
| **UNDERSTAND** | `nvidia/Nemotron-3-Ultra-550b-a55b` | Construction-oriented rationale and risk advice | Forbidden from altering comparison status or upgrading `UNDETERMINED` |
| **VERIFY** | Named Human Inspector | Final verification verdict | The sole authority to settle findings |

**Nemotron receives no image.** It receives MiniCPM's validated observations and the computed comparison rows from `compare.ts`. The vision stage owns pixels, the deterministic engine owns comparison, the reasoning stage owns narrative context, and the human owns verification.

This architectural boundary is enforced in code and tested in `tests/hybrid-pipeline.test.ts`: a reasoning model claiming compliance cannot alter a deterministic comparison row.

---

## NVIDIA + Nebius Integration

* **NVIDIA Contribution**: `nvidia/Nemotron-3-Ultra-550b-a55b` provides the construction-oriented reasoning stage, analyzing visual observations and deterministic comparison data to generate actionable risk assessments and physical verification recommendations.
* **Nebius Infrastructure**: Model serving is routed through **Nebius Token Factory** (`https://api.tokenfactory.nebius.com/v1/`).
* **Resilience**: If reasoning is disabled or unavailable (`NOT_CONFIGURED`, `DISABLED`, `TIMEOUT`, `MALFORMED_RESPONSE`), the vision reading and deterministic comparison stand unchanged, with an explicit notice displayed to the operator.

---

## Key Product Concepts

### 1. Deterministic Comparison & Explicit Uncertainty
* **MATCH**: Observed state satisfies the expected reference.
* **ATTENTION**: A discrepancy exists (e.g., visual count shortfall or unexpected element).
* **UNDETERMINED**: Evidence in this photograph is insufficient to confirm or refute the expectation. *`UNDETERMINED` indicates insufficient evidence, not a construction defect.*

### 2. Evidence States
* **LOCALIZED**: Visual bounding box mapped to painted image coordinates.
* **FULL_FRAME**: Supported by image evidence, but no discrete region box was returned.
* **NONE**: Comparison finding resting on expected state without direct visual evidence in this capture.

### 3. Reviewer Identity & Historical Attribution
* Human verification requires a configured reviewer identity (Name and optional Role).
* Review decisions (`VERIFIED`, `NEEDS_REVIEW`, `REJECTED`) are persisted per project.
* **Historical Attribution Guarantee**: Changing the active project reviewer does *not* rewrite existing human verification records.

---

## Local Construction Dataset

The repository includes a local dataset integration tool supporting **38 license-clean construction photographs** (`001`–`038`).

* The dataset lives in `sample/` and is **git-ignored** (~107 MB).
* Importing a dataset item creates a real capture record (`LOCAL_DATASET` provenance).
* The core application operates completely independently of the dataset.

---

## Storage and Persistence

State is saved atomically under `data/`:
* `data/workspace.json`: Projects, expected-state references, capture metadata, and reviewer identity.
* `data/uploads/`: Original uploaded capture bytes.
* `data/inspections/`: Raw model payloads, comparison results, reasoning outcomes, and human review logs.

Runtime persistence is git-ignored and local-only.

---

## Codebase Safety Principles

1. **Anti-Echo**: Candidate element payloads echoing prompt template placeholders are discarded.
2. **Zero-Area Box Protection**: Zero-area bounding boxes are treated as unlocalized rather than rendered.
3. **No Auto-Verification**: AI confidence scores never auto-verify a finding.
4. **Anonymous Review Refusal**: Review decisions submitted without a reviewer identity return `HTTP 400`.

---

## Project Structure

```text
src/
  types/inspection.ts    Domain contracts and schema validation
  compare.ts             Deterministic REALITY vs EXPECTED engine
  reasoning.ts           Stage-3 Nemotron reasoning contract & validation
  synthesis.ts           Findings synthesis, reality brief, and counters
  expected-state.ts      Reference expected state catalog and management
  projects.ts            Project, capture, and project-scoped reviewer store
  persistence.ts         Atomic JSON storage under data/
  dataset.ts             Local dataset discovery and import
  inspector.ts           Observation validation and trust boundary
  session.ts             Inspection session pipeline (SEE -> COMPARE -> UNDERSTAND)
  server.ts              HTTP REST API and static asset server
  ui/                    Modular UI text templates (index.html, app.css, app.js)
docs/
  ARCHITECTURE.md        System architecture and trust boundary documentation
  DEMO.md                Hero demo script, walkthrough, and recording checklist
  HACKATHON-SUBMISSION.md Formatted submission package for judges
  DEVPOST-SUBMISSION.md  Condensed submission mirror for Devpost
tests/                   Node.js native test suite (339 tests)
```

---

## Test Suite

Run the full automated test suite:

```bash
npm test             # 339 tests passing
npm run typecheck    # 0 TypeScript errors
```

---

## License

MIT — See [LICENSE](./LICENSE).
