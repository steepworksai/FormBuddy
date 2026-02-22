# FormBuddy — Post-Milestone Plan

This plan starts after Milestones 1–12 are complete.
Each milestone includes improvements labeled as `milestone_num.improvement_num`.

---

## Milestone 13 — Foundation Hardening

**Goal:** Stabilize architecture and remove ambiguity before advanced features.

- [ ] **13.1** Standardize checksum usage to SHA-256 across code/docs.
- [ ] **13.2** Finalize canonical `.indexing` schema with `schemaVersion`.
- [ ] **13.3** Add schema migration handler for backward compatibility.
- [ ] **13.4** Standardize model names and provider config keys.
- [ ] **13.5** Add ADR notes for indexing, session, and retrieval decisions.

### Done when
1. All docs and code references use one checksum method and one schema shape.
2. Old index data can be upgraded automatically with no data loss.

---

## Milestone 14 — Safety and Trust Controls

**Goal:** Reduce high-impact autofill mistakes.

- [ ] **14.1** Add sensitive-field detection (SSN, tax ID, passport, account numbers).
- [ ] **14.2** Require explicit confirmation before filling sensitive fields.
- [ ] **14.3** Add masking mode in UI and logs for sensitive values.
- [ ] **14.4** Add source freshness warnings (expired/outdated docs).
- [ ] **14.5** Add conflict resolver when multiple sources disagree.

### Done when
1. Sensitive fills always require user confirmation.
2. Conflicting values show a chooser instead of silent auto-selection.

---

## Milestone 15 — Retrieval and Ranking Upgrade

**Goal:** Improve suggestion accuracy and lower token usage.

- [ ] **15.1** Implement local-first candidate retrieval (entities/rules/regex).
- [ ] **15.2** Add candidate ranking before LLM call.
- [ ] **15.3** Send only top-ranked snippets to LLM (token budget cap).
- [ ] **15.4** Add fallback path when LLM is unavailable.
- [ ] **15.5** Add per-field confidence scoring pipeline.

### Done when
1. Median latency improves against Milestone 12 baseline.
2. LLM token usage per accepted suggestion drops measurably.

---

## Milestone 16 — Verification UX

**Goal:** Make every suggestion auditable in one click.

- [ ] **16.1** Add evidence drawer with source snippet and citation metadata.
- [ ] **16.2** Add risk badges (low/medium/high risk) on suggestions.
- [ ] **16.3** Add pre-fill normalization preview (date/phone/address).
- [ ] **16.4** Add `Use raw` vs `Use normalized` toggle.
- [ ] **16.5** Add undo/restore for latest fill action.

### Done when
1. Users can see evidence before accepting each suggestion.
2. Undo works reliably for latest accepted fill.

---

## Milestone 17 — Bulk Assist Workflow

**Goal:** Reduce clicks for long multi-page forms.

- [ ] **17.1** Add `Scan This Page` to detect all fillable fields.
- [ ] **17.2** Generate queued suggestions for all detected fields.
- [ ] **17.3** Add review queue with accept/dismiss/reject per item.
- [ ] **17.4** Add `Approve all low-risk` action.
- [ ] **17.5** Add post-fill validation summary for required fields/format errors.

### Done when
1. User can process a full page from one review queue.
2. Validation summary flags bad formats before submit.

---

## Milestone 18 — Session Intelligence

**Goal:** Improve continuity and repeat-form performance.

- [ ] **18.1** Add domain/form fingerprinting.
- [ ] **18.2** Save field mapping memory by fingerprint.
- [ ] **18.3** Add interrupted session recovery and resume.
- [ ] **18.4** Add cross-page prefetch of likely next-field suggestions.
- [ ] **18.5** Add duplicate-fill prevention beyond `fieldId` (semantic dedup).

### Done when
1. Repeat forms show faster and more accurate suggestions.
2. Crashed/reloaded sessions can be resumed with history intact.

---

## Milestone 19 — Observability and Quality

**Goal:** Make quality measurable and regressions easy to catch.

- [ ] **19.1** Add structured event logging for indexing, retrieval, fill actions.
- [ ] **19.2** Add local metrics panel (latency, acceptance, rejection reasons).
- [ ] **19.3** Add debug export package (JSON) for issue triage.
- [ ] **19.4** Expand regression fixtures: tax, visa, insurance, travel.
- [ ] **19.5** Add failure-injection tests (network down, invalid key, permission loss).

### Done when
1. Team can diagnose failures without reproducing manually every time.
2. CI catches core regressions before release.

---

## Milestone 20 — Power Features and Packaging

**Goal:** Add advanced user capabilities and prepare next major release.

- [ ] **20.1** Add encrypted import/export for settings and index metadata.
- [ ] **20.2** Add profile contexts (personal/spouse/business).
- [ ] **20.3** Add token/cost guardrails per session.
- [ ] **20.4** Add advanced audit search/filter for filled history.
- [ ] **20.5** Prepare release checklist and versioned migration notes.

### Done when
1. Users can migrate data safely between machines.
2. Release artifacts and migration notes are ready for rollout.

---

## Recommended Execution Order

1. Milestone 13
2. Milestone 14
3. Milestone 15
4. Milestone 16
5. Milestone 17
6. Milestone 18
7. Milestone 19
8. Milestone 20

