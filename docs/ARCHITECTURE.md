# SiteLens™ Architecture & Technical Specification

> **REALITY IS THE REFERENCE™**

This document provides a technical walkthrough of the **SiteLens AI Reality Inspector** architecture, pipeline boundaries, safety properties, and domain data models.

---

## 1. High-Level Pipeline Architecture

SiteLens processes site photographs through a multi-stage hybrid pipeline. The pipeline strictly isolates visual observation, mathematical comparison, construction reasoning, and human verification.

```text
               CONSTRUCTION REALITY PHOTOGRAPH
           (User Upload or Local Dataset Capture)
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Stage 1: SEE — Vision Model                             │
 │ openbmb/MiniCPM-V-4_5 (via Nebius Token Factory)        │
 │ Extracts visible site elements, counts, & observations  │
 └────────────────────────────┬────────────────────────────┘
                              │ Visual Observations
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Stage 2: COMPARE — Deterministic Engine                 │
 │ src/compare.ts (Pure TypeScript Code)                  │
 │ Evaluates reality against project Expected Reference    │
 │ Outputs: MATCH / ATTENTION / UNDETERMINED               │
 └────────────────────────────┬────────────────────────────┘
                              │ Structured Observations + Comparison Rows
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Stage 3: UNDERSTAND — Construction Reasoning Model      │
 │ nvidia/Nemotron-3-Ultra-550b-a55b                       │
 │ Generates site risk rationale, advice, & verification   │
 └────────────────────────────┬────────────────────────────┘
                              │ Candidate Findings
                              ▼
┌─────────────────────────────────────────────────────────┐
  │ Stage 4: VERIFY — Named Human Reviewer                  │
  │ Web UI. Reviewer name/role is a typed attribution      │
  │ field only — this is NOT authentication.               │
  │ Manual Decision: VERIFIED / NEEDS REVIEW / REJECTED     │
  └─────────────────────────────────────────────────────────┘
```

---

## 2. Stage-by-Stage Specification

### Stage 1: SEE (`openbmb/MiniCPM-V-4_5`)
* **Role**: Visual reading of construction photographs.
* **Input**: Base64 JPEG/PNG image data URL + prompt requesting visible element detection.
* **Output**: Validated array of detected elements (`COLUMN`, `SLAB`, `WALL`, `REBAR`, `MEP_ROUGH_IN`, etc.) with visual counts and optional bounding boxes.
* **Safety Boundary**: The vision stage is forbidden from asserting structural compliance, design engineering validity, or building code safety.

### Stage 2: COMPARE (`src/compare.ts`)
* **Role**: Deterministic evaluation of reality against the active expected reference.
* **Input**: Stage 1 detected elements + Project `ExpectedState`.
* **Output**: Structured comparison rows categorized into:
  * `MATCH`: Reality matches expectations.
  * `ATTENTION`: Discrepancy observed (count deficit, missing element, or unapproved addition).
  * `UNDETERMINED`: Evidence in the photograph is insufficient to draw a conclusion.
* **Safety Boundary**: Operates via pure arithmetic and exact string matching in TypeScript. It is completely isolated from LLM opinion.

### Stage 3: UNDERSTAND (`nvidia/Nemotron-3-Ultra-550b-a55b`)
* **Role**: Construction-oriented reasoning over observed conditions.
* **Input**: Stage 1 observations + Stage 2 comparison rows (Text payload only; **NO image payload**).
* **Output**: Rationale, site risk analysis, physical verification recommendations, and qualitative certainty.
* **Safety Boundary**: Nemotron cannot modify Stage 2 comparison statuses or upgrade an `UNDETERMINED` item into a `MATCH`.

### Stage 4: VERIFY (Named Human Reviewer)
* **Role**: The sole authority to transition candidate findings from `UNVERIFIED` to settled state.
* **Input**: Synthesized findings displayed in the UI.
* **Output**: Stored decision (`VERIFIED`, `NEEDS_REVIEW`, or `REJECTED`) tagged with the reviewer's name, role, timestamp, and optional note.
* **Not authentication**: The reviewer name and role are a typed attribution field recorded alongside each decision. There is no login, credential, or permission model in this project; anonymous submissions are rejected with `HTTP 400` so that no decision is stored unattributed.

---

## 3. Key Safety Boundaries & Anti-Hallucination Guards

1. **Anti-Echo Guard**: The schema validators invoked by `RealityInspector` (`validateDetectedElement`, `validateModelObservation`, `validateModelFinding`) discard entries that assert nothing (zero confidence) or contradict their own evidence, and normalize zero-area bounding boxes to "not localized". Rejected entries are reported, never silently dropped.
2. **Deterministic Comparison Boundary**: LLM prose cannot alter computed arithmetic comparisons.
3. **Explicit Uncertainty**: Items where visual evidence is incomplete are marked `UNDETERMINED` (severity `INFO`) rather than flagged as defects.
4. **No Automatic Verification**: Model confidence scores do not auto-verify findings.
5. **Reviewer Attribution Integrity**: Each review stores the reviewer name in force when the decision was made, so reconfiguring the project's reviewer afterwards does not rewrite earlier attributions.

---

## 4. Domain Data Models

### Project & Reviewer Model (`src/projects.ts`)
```typescript
export interface ReviewerIdentity {
  readonly name: string;
  readonly role: string | null;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly createdAt: string;
  readonly demo: boolean;
  readonly reviewer: ReviewerIdentity | null;
}
```

### Finding Review Model (`src/session.ts`)
```typescript
export interface FindingReview {
  readonly status: 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW';
  readonly reviewer: string; // "Name · Role"
  readonly reviewedAt: string;
  readonly note: string | null;
}
```

---

## 5. Multi-Photograph Group Inspection (`src/multi-image.ts`)

An inspection session can operate on a single photograph or a group of up to **6 photographs** (`MAX_INSPECTION_CAPTURES = 6`) opened together for a project:
* **Per-Photo Vision Reading**: Stage 1 (`openbmb/MiniCPM-V-4_5`) runs per photograph (`1..N`). Every extracted element detection, visual observation, and AI finding is tagged with the `captureId` and `captureLabel` of the frame that produced it.
* **Cross-Frame Aggregation**: Stage 2 (`src/compare.ts`) evaluates expected elements across the analyzed frames, taking the maximum observed count per element type across frames rather than summing overlapping views.
* **Single Reasoning Pass**: Stage 3 (`nvidia/Nemotron-3-Ultra-550b-a55b`) runs **once** over the combined, frame-attributed observations and comparison rows.
* **Partial-Analysis Separation**: If a subset of photographs fails vision reading while at least one succeeds, the run is marked `PARTIAL` (reporting exact analyzed vs. failed counts and keeping failed captures visible as failed) rather than disguising a partial run as complete or discarding valid readings.

---

## 6. Multilingual Projection & RTL/LTR Layout (`src/localization.ts`, `src/localized-inspection.ts`, `src/model-translation.ts`)

Every completed inspection ships a four-language projection (`en`, `fr`, `ar`, `zh`) alongside the canonical inspection record:
* **Canonical Invariance**: Finding IDs, severities, confidence scores, normalized bounding boxes, comparison statuses, and human verification records live in the canonical structure and are never mutated by localization.
* **Deterministic Regeneration**: Comparison rows, comparison-derived findings, priority rankings, and the reality brief are regenerated deterministically from structured machine facts in all four languages (`English`, `Français`, `العربية`, `中文`). Regenerating in English reproduces the canonical English strings character for character.
* **AI Prose Translation & Provenance**: Model-authored prose (MiniCPM visual findings/observations and Nemotron reasoning) is translated into French, Arabic, and Chinese via `src/model-translation.ts` (backed by deterministic offline translation memory for known fixtures and batched Nemotron JSON translation for novel live prose). Translated cards carry an explicit **"Translated from English"** badge and a **"View original / View translation"** toggle; untranslated prose remains in English and is never mislabeled as translated.
* **Document Direction & Pixel Geometry**: Switching languages updates `document.documentElement.lang` (`en`, `fr`, `ar`, `zh-CN`) and `dir` (`rtl` for Arabic, `ltr` for English/French/Chinese) immediately in the browser with zero network requests. CSS logical properties mirror chrome, menus, and reading-start accents in Arabic RTL while keeping evidence photographs and bounding-box pixel overlays strictly LTR (`direction: ltr`).

---

## 7. Image Processing & EXIF Geometry (`src/image-metadata.ts`)

SiteLens inspects image headers for EXIF orientation tags.
* When an EXIF orientation tag requiring rotation (e.g., orientation `3`, `6`, or `8`) is detected, `normalizeOrientation()` updates the orientation header to `1` (normal) before processing.
* This ensures that stored pixels, vision model coordinate grids, and UI canvas overlay boxes align without pixel degradation or re-encoding. Only the two-byte tag value is rewritten; the image data is never re-encoded.
* Because the stored pixels are preserved as-is, images whose source pixels were captured upside down (orientation `3`/`4`) additionally receive a display-only 180-degree correction in the browser, with evidence boxes transformed by the same correction. Correcting the bytes themselves would require a JPEG codec, which this project deliberately does not ship.

---

## 8. Persistence Model (`src/persistence.ts`)

State persistence operates via atomic JSON updates under `data/`:
* `data/workspace.json`: Workspace configuration, projects, references, active capture selection, and active reviewer identity.
* `data/uploads/<captureId>.<ext>`: Raw capture image files.
* `data/inspections/<captureId>.json`: Full inspection snapshots, raw provider payloads, Nemotron reasoning records, localized projections, and human verification logs.

If `SITELENS_PERSIST=off` is set, state runs entirely in process memory.
