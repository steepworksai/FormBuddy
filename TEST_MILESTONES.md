# FormBuddy — Detailed Test Milestones Guide

This guide explains, milestone by milestone, what test coverage you are building, why it matters, how to know it is complete, and what gaps usually get missed.

It uses:
- `Vitest` for fast unit/integration tests.
- `Playwright` for extension UI/E2E tests.

---

## How To Use This Guide

For each test milestone (`TM1`..`TM12`), follow this order:
1. Implement the listed test artifacts.
2. Run the milestone command(s).
3. Validate the "Evidence you should have".
4. Check the "What you are missing if this fails" section.

Do not move to the next milestone until the current one is green.

---

## TM1 — Test Infrastructure

## What you are achieving
- A repeatable test system anyone can run locally and in CI.
- A known test command contract (`test:unit`, `test:e2e`, `test:all`).

## Why it matters
- Without this, later tests are unreliable and expensive to maintain.
- Most teams lose time here when commands/configs are inconsistent.

## Deliverables
- Dependencies installed:
  - `vitest`
  - `@playwright/test`
  - `jsdom`
  - `@testing-library/react` (recommended)
- Files:
  - `vitest.config.ts`
  - `playwright.config.ts`
- `package.json` scripts:
  - `test:unit`
  - `test:unit:watch`
  - `test:e2e`
  - `test:e2e:headed`
  - `test:milestones`
  - `test:all`
- Test directories:
  - `tests/unit`
  - `tests/e2e`
  - `tests/fixtures`
  - `tests/mocks`
  - `tests/utils`

## Evidence you should have
- `npm run test:unit` executes and exits 0.
- `npm run test:e2e` executes Playwright and runs a sample spec.

## Common misses
- No deterministic browser setup path for extension tests.
- Unit and E2E commands use inconsistent tsconfig/module settings.

## What you are missing if this fails
- You cannot trust any later milestone results.

---

## TM2 — Unit Tests: Indexing + Parsing

## What you are achieving
- Confidence that local data indexing is stable and deterministic.

## Why it matters
- If indexing fails, every downstream suggestion/autofill feature degrades.

## Coverage targets
- `src/lib/indexing/checksum.ts`
- `src/lib/indexing/manifest.ts`
- `src/lib/indexing/indexer.ts`
- `src/lib/config/supportedTypes.ts`
- parser selection/fallback points in `src/lib/parser/*`

## Test cases (minimum)
- Checksum:
  - same input -> same checksum
  - expected prefix and hash shape
- Manifest:
  - empty/missing file returns default manifest
  - write/read roundtrip preserves fields
- Indexer:
  - unchanged checksum -> `skipped`
  - new/changed file -> indexed entry written
  - `screenshot-*` file -> `type: 'screenshot'`
- Supported types:
  - allowed extensions accepted
  - unsupported extensions rejected

## Evidence you should have
- Failing fixtures for malformed/empty manifest are covered.
- At least one regression fixture per supported type (pdf/image/txt/screenshot).

## Common misses
- Not testing reindex logic after checksum match.
- No tests for malformed JSON handling.

## What you are missing if this fails
- High chance of silent indexing drift and stale suggestion context.

---

## TM3 — Unit Tests: LLM Layer

## What you are achieving
- Provider behavior is predictable across Anthropic/OpenAI/Gemini.

## Why it matters
- This is the highest change-risk area (SDK/API changes, parsing failures).

## Coverage targets
- `src/lib/llm/index.ts`
- `src/lib/llm/verify.ts`
- `src/lib/llm/suggestion.ts`
- `src/lib/llm/extractor.ts`
- provider clients (`claude.ts`, `openai.ts`, `gemini.ts`)

## Test cases (minimum)
- Dispatch:
  - provider `anthropic` routes correctly
  - provider `openai` routes correctly
  - provider `gemini` routes correctly
- Verification:
  - valid key path returns `true`
  - auth failure path returns `false`
  - network/server failure throws
- Parsing:
  - JSON wrapped in markdown fences parses
  - malformed JSON falls back safely
  - empty responses handled

## Evidence you should have
- Provider mocks for all three providers.
- Explicit test asserting invalid model/key surfaces user-meaningful errors.

## Common misses
- Treating all errors as invalid key (hides real outages).
- No tests for “empty but 200 OK” payloads.

## What you are missing if this fails
- Intermittent or wrong provider behavior in production.

---

## TM4 — Unit Tests: Content Script

## What you are achieving
- Stable field detection and autofill behavior across page structures.

## Why it matters
- This is where user trust starts: wrong field labels = wrong suggestions.

## Coverage targets
- `src/content/index.ts`

## Test cases (minimum)
- Label extraction priority:
  1. `aria-label`
  2. `label[for=...]`
  3. `placeholder`
  4. parent `label`
- Duplicate focus suppression for same element.
- `AUTOFILL_FIELD` writes value and dispatches `input` + `change`.
- Hotkey emits screenshot request message.

## Evidence you should have
- jsdom tests with synthetic DOM variations.
- A failing test if label priority order changes.

## Common misses
- No test for `SELECT` behavior.
- No test for repeated focus transitions.

## What you are missing if this fails
- High risk of incorrect field targeting and UX confusion.

---

## TM5 — Unit Tests: Background Workflow

## What you are achieving
- Confidence in orchestration, session state, and message routing.

## Why it matters
- Background logic glues together content, sidepanel, and LLM calls.

## Coverage targets
- `src/background/index.ts`

## Test cases (minimum)
- Session lifecycle:
  - new session on first domain
  - preserve session on same-domain navigation
  - reset on domain change
- Message flow:
  - `FIELD_FOCUSED` -> query -> LLM -> `NEW_SUGGESTION`
  - `SUGGESTION_ACCEPTED` -> `AUTOFILL_FIELD` + `SUGGESTION_APPLIED`
  - `SUGGESTION_REJECTED` suppresses further suggestions for field
  - `SCREENSHOT_HOTKEY` -> capture request message

## Evidence you should have
- Mocked `chrome.runtime`, `chrome.tabs`, `chrome.webNavigation` interfaces.
- Assertions on emitted messages and payload fields.

## Common misses
- Not testing async race conditions on rapid focus changes.
- No coverage for missing API key path.

## What you are missing if this fails
- Broken sessions, duplicate fills, and inconsistent suggestion behavior.

---

## TM6 — Unit/Component Tests: Sidepanel

## What you are achieving
- UI state logic is validated without full browser E2E overhead.

## Why it matters
- Most user-visible regressions are sidepanel state bugs.

## Coverage targets
- `src/sidepanel/SidePanel.tsx`

## Test cases (minimum)
- Empty states and warning states render as intended.
- Suggestion card actions:
  - Accept sends expected message
  - Dismiss removes card only
  - Reject removes card and sends rejection
- Refresh flow updates `noLLM` status correctly.
- `chrome.storage.onChanged` updates key warning in UI.
- Quick note save path calls indexing pipeline hooks.

## Evidence you should have
- Component tests for at least 3 core UI states:
  - no folder
  - folder/no suggestions
  - active suggestions

## Common misses
- No tests for rapid state transitions (e.g., refresh while indexing).
- Missing coverage for error banner behavior.

## What you are missing if this fails
- Frequent UX regressions despite passing unit logic tests.

---

## TM7 — E2E: Product Milestones 1–3

## What you are achieving
- Core extension startup path is proven in a real browser.

## Why it matters
- This validates integration beyond mocks.

## E2E scenarios
- Extension loads unpacked with no startup errors.
- Sidepanel opens from toolbar action.
- Folder selection and file listing work.
- `.indexing` outputs are created.

## Evidence you should have
- Playwright traces/screenshots for pass runs.
- Clean log for extension startup.

## Common misses
- Not pinning extension load path in Playwright fixtures.
- Brittle selectors for sidepanel.

## What you are missing if this fails
- No proof your app boots and indexes in real browser context.

---

## TM8 — E2E: Product Milestones 4–5

## What you are achieving
- BYOK onboarding and provider setup is production-realistic.

## Why it matters
- Key setup is first critical conversion point for users.

## E2E scenarios
- Settings popup opens.
- Provider/model can be changed.
- Verify & save success path.
- Invalid key path.
- Network error path.

## Evidence you should have
- Per-provider scenario evidence (Anthropic/OpenAI/Gemini).
- Clear UI feedback assertions.

## Common misses
- Using real keys in CI.
- No network-mocked failure tests.

## What you are missing if this fails
- Onboarding friction and false “connected” states.

---

## TM9 — E2E: Product Milestones 6–8

## What you are achieving
- End-to-end field detection to autofill is validated.

## Why it matters
- This is the primary value workflow of FormBuddy.

## E2E scenarios
- Focus field -> field activity updates.
- Suggestion appears with citation/reason.
- Accept fills field.
- Re-focus same field -> no repeated suggestion.

## Evidence you should have
- Trace showing full event chain.
- Assertion that autofilled value is reflected in DOM.

## Common misses
- Not waiting for async suggestion generation.
- Missing assertion for used-suppression behavior.

## What you are missing if this fails
- No reliable proof the core product loop works.

---

## TM10 — E2E: Product Milestones 9–10

## What you are achieving
- Session continuity and screenshot capture/index behavior are validated.

## Why it matters
- Multi-page forms and screenshot ingestion are major differentiation features.

## E2E scenarios
- Same-domain page navigation preserves session/page count.
- Cross-domain navigation resets session state.
- Screenshot button/hotkey triggers capture.
- Captured screenshot becomes indexed context.

## Evidence you should have
- Session indicator updates across pages.
- Screenshot file appears and is indexed.

## Common misses
- No deterministic way to assert screenshot availability.
- Flaky multi-page navigation timing.

## What you are missing if this fails
- High risk of broken real-world long-form usage.

---

## TM11 — E2E: Product Milestone 11

## What you are achieving
- All quick-add paths are proven to feed the same indexing pipeline.

## Why it matters
- Quick capture quality drives data completeness and suggestion quality.

## E2E scenarios
- Drag/drop supported file.
- Quick text note save.
- Context-menu quick add path (or equivalent simulated trigger).

## Evidence you should have
- Added item appears in file list.
- Item becomes part of suggestion context.

## Common misses
- Not testing unsupported file types.
- No assertion that context sync occurs post-add.

## What you are missing if this fails
- Data intake paths are unreliable, weakening suggestions over time.

---

## TM12 — Release Gate Suite (Product Milestone 12)

## What you are achieving
- A go/no-go automated gate for shipping.

## Why it matters
- Prevents regression release cycles.

## Required suites
- Happy path smoke:
  - setup -> index -> suggest -> accept -> navigation continuity
- Negative path:
  - no key
  - invalid key
  - network failure
  - folder permission loss
  - empty context

## Exit criteria (strict)
- `npm run test:all` passes.
- No flaky failures in 3 consecutive runs.
- Build + test artifacts archived for release candidate.

## Evidence you should have
- Test summary report.
- Failure triage notes for any quarantined tests.

## Common misses
- Marking flaky tests as pass.
- No ownership for fixing quarantined failures.

## What you are missing if this fails
- No trustworthy release quality signal.

---

## Command Contract (Target)

```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:milestones": "npm run test:unit && npm run test:e2e",
    "test:all": "npm run build && npm run test:milestones"
  }
}
```

---

## Progress Checklist

- [ ] TM1 complete
- [ ] TM2 complete
- [ ] TM3 complete
- [ ] TM4 complete
- [ ] TM5 complete
- [ ] TM6 complete
- [ ] TM7 complete
- [ ] TM8 complete
- [ ] TM9 complete
- [ ] TM10 complete
- [ ] TM11 complete
- [ ] TM12 complete

