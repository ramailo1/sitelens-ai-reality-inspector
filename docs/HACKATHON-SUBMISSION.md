# SiteLens™ AI Reality Inspector — Hackathon Submission Package

> **Nebius × NVIDIA Global AI Hackathon Submission Copy**

---

## 1. Project Overview

### Project Name
**SiteLens AI Reality Inspector**

### One-Line Description
Turn site photographs into evidence-backed, human-verified construction observations using a hybrid MiniCPM + Nemotron AI pipeline and deterministic comparison.

### Short Pitch (2–3 Sentences)
Construction teams capture thousands of site photos daily, but verifying progress against planned expectations remains slow and manual. SiteLens starts with reality: it combines MiniCPM visual readings, deterministic comparison against expected state, and NVIDIA Nemotron construction reasoning—closing the loop with mandatory human inspector verification.

---

## 2. The Problem & Solution

### The Problem
* **BIM Fragility**: Perfect 3D BIM models are often outdated, incomplete, or unavailable on active job sites.
* **Photo Overwhelm**: Site photos accumulate in unorganized folders without structured comparison against expected progress.
* **AI Hallucination Risk**: Unconstrained AI vision models hallucinate compliance, fake measurements, or make unfounded engineering claims.

### The Solution: "Reality is the Reference"
SiteLens treats the physical site photograph as the primary truth reference:
1. **SEE**: MiniCPM-V extracts visible physical elements and counts.
2. **COMPARE**: Deterministic TypeScript code compares observations against expected reference state without relying on AI opinions.
3. **UNDERSTAND**: NVIDIA Nemotron-3-Ultra provides construction-oriented reasoning and risk advice over structured text.
4. **VERIFY**: Named human inspectors verify or reject findings, creating a persisted, per-reviewer attribution trail.

---

## 3. How It Works: The 4-Stage Pipeline

```text
REALITY IMAGE ➔ [1] MiniCPM-V (SEE) ➔ [2] compare.ts (COMPARE) ➔ [3] Nemotron (UNDERSTAND) ➔ [4] Human (VERIFY)
```

1. **SEE (MiniCPM-V-4_5)**: Analyzes pixels to detect structural elements (`COLUMN`, `SLAB`, `WALL`, `REBAR`, `MEP_ROUGH_IN`) and visual counts.
2. **COMPARE (`src/compare.ts`)**: Evaluates expected vs. observed counts mathematically, flagging `MATCH`, `ATTENTION`, or `UNDETERMINED`.
3. **UNDERSTAND (`nvidia/Nemotron-3-Ultra-550b-a55b`)**: Receives structured comparison data (no image pixels) to generate construction risk assessments and physical verification recommendations.
4. **VERIFY (Human Inspector)**: A named reviewer reviews candidate findings and marks them `VERIFIED`, `NEEDS_REVIEW`, or `REJECTED`.

---

## 4. Why SiteLens is Different

* **No Perfect BIM Required**: Operates directly on site photographs and lightweight expected-state references.
* **Deterministic Isolation**: Comparison logic lives in code, preventing LLM prose from altering mathematical compliance evaluations.
* **Explicit Uncertainty**: Insufficient evidence produces an `UNDETERMINED` result (severity `INFO`) rather than a false defect or fabricated match.
* **Truthful Evidence**: Features localized bounding boxes, full-frame disclosures, or explicit "unlocalized" state—never synthetic boxes.
* **Reviewer Attribution**: Verification decisions record the reviewer identity in force at the time, and persist across server restarts without rewriting historical records. These are local JSON records, not a tamper-evident ledger.

---

## 5. Technology Stack & Partner Contributions

### Technology Stack
* **Language & Runtime**: TypeScript, Node.js (≥ 22.6, zero runtime dependencies, native type-stripping).
* **Testing**: Node.js native test runner (339 tests passing, 0 TypeScript errors).
* **Persistence**: Atomic JSON storage under `data/`.

### NVIDIA Contribution
* **Model**: `nvidia/Nemotron-3-Ultra-550b-a55b`.
* **Role**: Stage 3 Construction Reasoning. Synthesizes structured vision readings and comparison data into actionable engineering recommendations.

### Nebius Contribution
* **Platform**: Nebius Token Factory API (`https://api.tokenfactory.nebius.com/v1/`).
* **Role**: High-speed, OpenAI-compatible model serving for reasoning completions over HTTPS.

---

## 6. Measured Performance & Demo Timings

* Observed hero live inspection timings:
  * **Vision Stage (MiniCPM-V)**: ~14.1 seconds
  * **Reasoning Stage (Nemotron-3-Ultra)**: ~3.8 seconds
  * **Total Pipeline Execution**: ~18 seconds
* *Note: Timings are single-session measured observations, not guaranteed SLAs.*

---

## 7. Dataset & Hygiene Truth

* **Local Dataset**: Integrates 38 license-clean construction photographs (`001`–`038`).
* **Git Hygiene**: `data/` (runtime state) and `sample/` (dataset) are strictly excluded via `.gitignore`.
* **Secret Safety**: No API keys, credentials, or `.env` files are tracked in Git.

---

## 8. Stated Limitations

* **Local Demo Scope**: Built for local execution; no multi-tenant enterprise RBAC or cloud database attached.
* **Visual Bounding Boxes**: Vision models occasionally provide unlocalized readings; SiteLens discloses unlocalized evidence rather than fabricating regions.
* **Single Capture Scope**: Analyzes individual spatial captures rather than multi-date 4D timelines.
