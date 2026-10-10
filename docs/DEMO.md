# SiteLens™ Hero Demo Script & Recording Guide

> **REALITY IS THE REFERENCE™**

This document contains the official **2–3 minute video demo script**, **pre-recording checklist**, and **screenshot guide** for presenting **SiteLens AI Reality Inspector**.

---

## 1. 2–3 Minute Hero Demo Script

**Primary Asset**: Hero Capture `030` (`030-hero-rebar-and-concrete-forms-piers.jpg`).

---

### 0:00–0:20 — The Problem: Photos vs Expected State
> *"Construction teams capture hundreds of site photographs every day. But knowing whether what is in a photo actually matches what was expected requires tedious manual cross-referencing. Perfect 3D BIM models aren't always available or up to date on active sites. At SiteLens, we start with reality."*

---

### 0:20–0:40 — Reality & Expected Reference
> *"Here is SiteLens. We load a real construction photograph — in this case, rebar and concrete form piers from Zone Level 02. Beside it is our Expected Reference State, defining the planned structural elements: columns, slabs, MEP rough-ins, and wall openings."*

---

### 0:40–1:05 — Step 1: SEE (MiniCPM-V Visual Reading)
> *"When we click 'Inspect Reality', our hybrid AI pipeline begins. First, MiniCPM-V on Nebius Token Factory performs visual reading. It identifies visible elements, counts structural items, and extracts visual observations directly from the photograph."*

---

### 1:05–1:30 — Step 2: COMPARE (Deterministic Engine)
> *"Next is Stage 2: COMPARE. This is NOT an AI guess — it is pure deterministic TypeScript code. It compares MiniCPM's visual counts against our expected reference. It categorizes results cleanly into MATCH, ATTENTION required, or UNDETERMINED. UNDETERMINED means this specific photograph doesn't show enough evidence — it's explicit uncertainty, not a fabricated failure."*

---

### 1:30–1:55 — Step 3: UNDERSTAND (Nemotron Construction Reasoning)
> *"In Stage 3, NVIDIA Nemotron-3-Ultra takes over. Nemotron is given NO image pixels. It reads the structured observations and deterministic comparison data to provide construction reasoning: explaining why a discrepancy matters, assessing risk, and recommending what physical checks to perform."*

---

### 1:55–2:20 — Step 4: VERIFY & Multilingual Projection (Named Human Verification + 4 Languages)
> *"Finally, Stage 4: VERIFY. AI output remains unverified until a named human inspector approves it. With our reviewer identity configured — 'Takou Rah, Lead Structural Inspector' — we inspect the evidence overlay, verify the finding details, and click VERIFIED. And because construction sites are multilingual, we can switch the inspection language between English, French, Arabic (full right-to-left layout), and Chinese instantly — with zero re-inference, pixel-identical evidence boxes, and a 'View original' toggle on translated AI findings."*

---

### 2:20–2:40 — Conclusion
> *"See with MiniCPM-V. Compare with deterministic code. Understand with Nemotron. Verify with a human — in English, French, Arabic, or Chinese. SiteLens: Reality is the Reference."*

---

## 2. Pre-Recording Checklist

Before recording the demo video:

- [ ] **Clean Environment**: Server running locally (`AI_PROVIDER=nebius npm run ui` or `AI_PROVIDER=demo npm run ui`).
- [ ] **Browser Window**: Chrome or Edge set to 1440×900 or 1920×1080 desktop resolution (and 390×844 mobile viewport if showcasing responsive layout).
- [ ] **Clean Canvas**: Clear temporary screenshots or developer tools overlays.
- [ ] **Active Project**: Open default project or select Hero Capture `030` (or up to 6 captures for a multi-photograph group run).
- [ ] **Reviewer Configured**: Configure reviewer name (`Takou Rah`) and role (`Lead Structural Inspector`) via the Reviewer Gate before running the inspection.
- [ ] **No Secrets**: Confirm `.env` or API credentials are not visible on screen.

---

## 3. Recommended Screenshot Plan

When capturing promotional screenshots for the hackathon submission:

1. **Screenshot 1 — Core Capture Workspace**: Full interface showing capture selection, expected reference state, and configured reviewer gate.
2. **Screenshot 2 — Deterministic Comparison & Nemotron Reasoning (`02 Inspect`)**: Stage 2 comparison panel (`MATCH`, `ATTENTION`, `UNDETERMINED`) and Stage 3 Nemotron construction reasoning panel.
3. **Screenshot 3 — Evidence Stage & Bounding Boxes (`03 Evidence`)**: Selected finding highlighting localized bounding boxes mapped onto the painted site photograph.
4. **Screenshot 4 — Human Verification & Translation Toggle (`04 Findings`)**: Finding cards showing `VERIFIED` human decision attribution, provenance badges, and the `View original` translation toggle.
5. **Screenshot 5 — Multilingual RTL/LTR Switch (`العربية` / `Français` / `中文`)**: Same inspection rendered in Arabic RTL (mirroring layout chrome while preserving evidence box pixel geometry) and French/Chinese LTR.
