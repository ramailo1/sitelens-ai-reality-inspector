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
* **Product Commit**: `780b92f00eb95f3d35734b7bda692055ab32fc83`
* **Test Suite**: 339/339 tests passing
* **Typecheck**: 0 TypeScript errors
* **AI Architecture**: Hybrid MiniCPM-V-4_5 (SEE) + `compare.ts` (COMPARE) + `nvidia/Nemotron-3-Ultra-550b-a55b` via Nebius Token Factory (UNDERSTAND) + Named Human Inspector (VERIFY)