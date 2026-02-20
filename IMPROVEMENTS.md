# FormBuddy — Improvements Roadmap (Post-Milestone)

This document defines what to do after the current 12 milestones, and what should be done before/during milestone completion so the next phase is faster and safer.

---

## What To Do Before Milestone 12 Is Fully Complete

These are high-priority prerequisites. Do these now (or in parallel) instead of waiting.

### 1. Lock data contracts and naming
- Finalize one canonical schema for:
  - `.indexing/manifest.json`
  - `.indexing/<uuid>.json`
  - `.indexing/usage.json`
- Freeze field names (`checksum`, `sourceFile`, `sourcePage`, `confidence`, etc.) and version with `schemaVersion`.
- Add migration logic for future schema updates.

### 2. Resolve architecture/document mismatches
- Standardize checksum algorithm everywhere to SHA-256.
- Standardize model naming across docs and settings UI.
- Standardize index location references (`.indexing/manifest.json` vs `index.json`).
- Add an ADR log (`docs/adr/`) for major decisions so future changes are intentional.

### 3. Add reliability instrumentation (local only)
- Add structured logs with event IDs for:
  - Indexing start/end/failure
  - LLM request/response failure
  - Suggestion accepted/dismissed/rejected
- Add a debug export button (JSON) for troubleshooting.

### 4. Add safety controls before scale
- Mark sensitive field classes (SSN, tax IDs, passport numbers, account numbers).
- Require explicit confirmation before autofill for sensitive classes.
- Add optional value masking in suggestion cards and logs.

### 5. Complete performance baseline
- Track local metrics:
  - Time to first suggestion
  - Indexing latency per MB
  - OCR latency per page
  - Suggestion acceptance rate
- Define release targets (example: first suggestion < 2.5s for cached index + valid key).

### 6. Create a strict test matrix
- Expand tests before adding new features:
  - Unit: parser, indexer, query ranking, field-label extraction
  - Integration: background/content messaging
  - E2E: multi-page forms, iframe fields, auth redirects, invalid API keys
- Add at least one regression fixture each for tax, visa, insurance, and travel.

---

## Post-Milestone Improvement Phases

## Phase A — Trust and Accuracy (v1.1)

### Goals
- Increase user trust and reduce wrong fills.

### Features
- Verification Mode:
  - Show source snippet preview beside each suggestion.
  - Show reason + confidence + risk flag.
- Conflict Resolver:
  - If multiple values match, show chooser with “preferred for this session” and “always prefer”.
- Smart normalization:
  - Date formats, phone formats, country-specific address formatting.
  - “Use raw” vs “Use normalized” toggle.
- Freshness checks:
  - Detect stale or expired documents and warn before fill.

### Success metrics
- Suggestion acceptance rate improves by 15%+.
- Wrong-fill correction events decrease by 30%+.

---

## Phase B — Speed and Cost Control (v1.2)

### Goals
- Improve responsiveness while reducing token usage.

### Features
- Hybrid retrieval pipeline:
  - Deterministic local extraction first (regex/rules + entities)
  - LLM only for disambiguation or low-confidence matches
- Prompt minimization:
  - Send only ranked snippets, capped token budget per request.
- Caching:
  - Cache field-label-to-value candidates per domain/session.
- Offline fallback mode:
  - If provider is unreachable, offer local rule-based suggestions with “lower confidence” tag.

### Success metrics
- LLM token usage per accepted suggestion drops by 35%+.
- Median suggestion latency drops by 25%+.

---

## Phase C — Workflow Automation (v2.0)

### Goals
- Let users fill long forms with fewer manual clicks.

### Features
- Page scan mode:
  - Scan all visible fields and generate queued suggestions.
- Review queue:
  - Approve one-by-one or “approve all low-risk”.
- Form memory:
  - Save field mapping patterns by domain/form signature.
- Session resume:
  - Reopen interrupted multi-page form sessions with context.

### Success metrics
- Manual clicks per form reduced by 40%+.
- Repeat-form completion time reduced by 50%+.

---

## Phase D — Power User Capabilities (v2.1+)

### Features
- Encrypted backup/export for `.indexing` metadata and preferences.
- Shared profile packs (optional): personal, spouse, business contexts.
- Advanced audit trail search (“show every field filled from passport document this month”).
- Optional plugin/provider architecture for additional LLM vendors.

---

## Suggested Backlog Order (Top 10)

1. Canonical schema + versioning + migration support.
2. Sensitive-field confirmation + masking.
3. Verification Mode with snippet preview.
4. Conflict resolver for multiple candidate values.
5. Smart normalization layer for dates/phones/addresses.
6. Hybrid retrieval (local first, LLM second).
7. Token/latency instrumentation dashboard (local).
8. Offline fallback suggestions.
9. Page scan + review queue.
10. Domain/form memory.

---

## Go/No-Go Checklist Before Starting Phase A

- [ ] Milestones 1–12 pass with green tests.
- [ ] Schema versioning and migration logic implemented.
- [ ] Reliability logs and debug export available.
- [ ] Sensitive-field safeguards enabled.
- [ ] Baseline metrics captured on at least 10 real form runs.

If any item is not complete, do that first before adding Phase A features.
