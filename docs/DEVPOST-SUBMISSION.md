# Devpost Submission — SiteLens™ AI Reality Inspector

> **Submission Package**: This document mirrors [HACKATHON-SUBMISSION.md](./HACKATHON-SUBMISSION.md) for quick submission to Devpost.

---

## Elevator Pitch
Construction photos become structured, human-verified progress observations using a hybrid vision + Nemotron reasoning pipeline with deterministic comparison and mandatory human verification.

---

## Detailed Submission Content

See full submission documentation in:
* [README.md](../README.md) — Product overview & execution instructions
* [HACKATHON-SUBMISSION.md](./HACKATHON-SUBMISSION.md) — Submission copy, technological breakdown, and measured performance
* [ARCHITECTURE.md](./ARCHITECTURE.md) — System architecture, pipeline boundaries, and safety properties
* [DEMO.md](./DEMO.md) — 2–3 minute hero demo script, pre-recording checklist, and screenshot plan

---

## Verified Hackathon Product State
* **Branch**: `main`
* **Test Suite**: 583/583 tests passing (32 test suites)
* **Typecheck**: 0 TypeScript errors (`npx tsc --noEmit`)
* **Browser Verification**: 32/32 locale × viewport × bay acceptance cells verified in Playwright Chromium (`en`, `fr`, `ar` RTL, `zh-CN` LTR across `1440×900` desktop and `390×844` mobile)
* **AI Architecture**: Hybrid `openbmb/MiniCPM-V-4_5` (SEE, 1–6 photos with per-frame attribution) + `src/compare.ts` (COMPARE, deterministic arithmetic) + `nvidia/Nemotron-3-Ultra-550b-a55b` via Nebius Token Factory (UNDERSTAND) + Named Human Inspector Gate (VERIFY) + 4-language projection (`en`, `fr`, `ar` RTL, `zh-CN` LTR)