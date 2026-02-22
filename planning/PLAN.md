# FormBuddy — Build Plan

Each milestone is a shippable slice. It has one clear goal, a list of low-level
checks you mark off during development, and one or two high-level browser tests
that prove the milestone is done.

---

## Milestone 1 — Extension Skeleton Loads

**Goal:** The extension installs in Chrome, the toolbar icon appears, and the
side panel opens as a blank React app.

### Low-level checks (mark off during dev)
- [ ] `npm create vite@latest` with `react-ts` template initialised
- [ ] `@crxjs/vite-plugin` installed and configured in `vite.config.ts`
- [ ] `manifest.json` written with MV3, permissions (`storage`, `activeTab`,
      `scripting`, `sidePanel`, `webNavigation`, `tabs`), background service
      worker path, content script path, and side panel path
- [ ] `npm run build` completes with no errors
- [ ] Folder structure created: `src/background/index.ts`,
      `src/content/index.ts`, `src/sidepanel/`, `src/popup/`, `src/lib/`,
      `src/types/index.ts`
- [ ] Shared TypeScript types defined: `Suggestion`, `DocumentEntry`,
      `Session`, `LLMConfig`
- [ ] Empty background service worker registered (no errors in
      `chrome://extensions`)
- [ ] Empty content script injected (no console errors on any page)

### Browser test — milestone is done when:
1. Load `dist/` as an unpacked extension in `chrome://extensions` — no errors shown.
2. Click the FormBuddy toolbar icon — side panel slides open showing a React
   placeholder ("FormBuddy is loading").
3. Open any web page (e.g. `google.com`) — no console errors injected by the
   content script.

---

## Milestone 2 — Folder Selection & File Listing

**Goal:** User picks a local folder from the side panel. The extension lists
every file in that folder with its name and size. Nothing is parsed yet.

### Low-level checks
- [ ] `src/lib/folder/access.ts` written — `requestFolderAccess()`,
      `listFiles()`, `writeFileToFolder()` using the File System Access API
- [ ] Side panel has a "Choose Folder" button that calls
      `window.showDirectoryPicker()`
- [ ] `FileSystemDirectoryHandle` is stored in React state (in-memory only for
      now — persisting the handle across sessions is Milestone 3)
- [ ] File list renders in the side panel: filename, type icon, size in KB/MB
- [ ] Only files at the top level of the folder are listed (no deep recursion yet)
- [ ] Error state shown if user cancels the picker or denies permission

### Browser test — milestone is done when:
1. Click "Choose Folder" in the side panel, pick a folder that contains a PDF
   and a PNG — both filenames appear in the panel within 1 second.
2. Close and reopen the side panel — folder prompt appears again (handle is not
   yet persisted, that is expected at this stage).
3. Pick a folder with 10+ files — all listed, no crash or hang.

---

## Milestone 3 — Document Indexing Into `.indexing`

**Goal:** When a folder is selected, every file is parsed and a `.indexing`
subfolder is written next to the documents. Re-selecting the same folder skips
unchanged files using checksum comparison.

### Low-level checks
- [ ] `src/lib/indexing/checksum.ts` — `computeChecksum(file)` using
      `crypto.subtle.digest('SHA-256')`
- [ ] `src/lib/indexing/manifest.ts` — `readManifest()` and `writeManifest()`
      reading/writing `.indexing/manifest.json`
- [ ] `src/lib/parser/pdf.ts` — `extractTextFromPDF(file)` using `pdfjs-dist`
- [ ] `src/lib/parser/ocr.ts` — `extractTextFromImage(file)` using
      `Tesseract.js`; used as fallback when PDF text is < 50 characters
- [ ] `src/lib/indexing/indexer.ts` — `indexDocument(file, dirHandle)` that
      routes to correct parser, then writes `<uuid>.json` to `.indexing/`
- [ ] `<uuid>.json` structure contains: `id`, `fileName`, `type`, `indexedAt`,
      `pageCount`, `pages[].rawText`, `entities` (placeholder empty object for
      now), `summary` (empty for now), `usedFields []`
- [ ] `manifest.json` updated after each file with `checksum`, `indexFile`,
      `sizeBytes`, `needsReindex: false`
- [ ] Re-selecting the same unchanged folder skips all files (checksum match
      logged to console)
- [ ] Modifying a file and re-selecting triggers re-index of only that file

### Browser test — milestone is done when:
1. Select a folder with a text-based PDF — open `.indexing/<uuid>.json` in any
   text editor and confirm `rawText` on page 1 contains real words from the PDF.
2. Select the same folder again — browser console shows "Skipped (unchanged)"
   for every file. No new writes to `.indexing/`.
3. Replace the PDF with a scanned image PDF — the uuid.json still contains
   readable text (Tesseract OCR ran as fallback).

---

## Milestone 4 — LLM Entity Extraction

**Goal:** After parsing, each document's raw text is sent to the LLM. The LLM
returns a structured entity object and a plain-English summary, both written
into the `<uuid>.json`.

### Low-level checks
- [ ] `src/lib/llm/claude.ts` — `callClaude(prompt, config)` wrapping
      `@anthropic-ai/sdk`
- [ ] `src/lib/llm/openai.ts` — `callOpenAI(prompt, config)` wrapping
      `openai` SDK
- [ ] `src/lib/llm/index.ts` — `callLLM(prompt, config)` dispatcher that
      routes to the right provider
- [ ] `src/lib/llm/extractor.ts` — `extractEntitiesWithLLM(rawText, fileName,
      config)` that returns `{ pages, entities, summary }`
- [ ] `entities` object populated with keys: `numbers`, `dates`, `names`,
      `addresses`, `employers`, `currencies`, `identifiers`
- [ ] `summary` is a 1–2 sentence plain-English description of the document
- [ ] `<uuid>.json` on disk contains the populated `entities` and `summary`
      after indexing
- [ ] LLM call is skipped and a warning logged if `llmConfig` is missing from
      `chrome.storage.local`
- [ ] API key stored and retrieved from `chrome.storage.local` (not hardcoded)

### Browser test — milestone is done when:
1. Add a W-2 PDF to the folder, set a valid API key in settings, re-select the
   folder — open `<uuid>.json` and confirm `entities.identifiers` contains the
   SSN and EIN numbers, `entities.currencies` contains wage values.
2. Add a passport scan PNG — `entities.identifiers` contains the passport number.
3. Open settings, enter an invalid API key — indexing fails gracefully with an
   error message in the side panel ("LLM error: check your API key"), no crash.

---

## Milestone 5 — BYOK Settings & API Key Verification

**Goal:** The popup has a working settings screen. User selects a provider,
opens the provider's billing page, pastes their API key, and the extension
verifies it with a lightweight test call before saving.

### Low-level checks
- [ ] `src/popup/Popup.tsx` renders: provider selector (Anthropic / OpenAI),
      "Open billing page" button, API key input, Save button, status indicator
- [ ] "Open Anthropic" button calls `chrome.tabs.create({ url: 'https://console.anthropic.com' })`
- [ ] "Open OpenAI" button calls `chrome.tabs.create({ url: 'https://platform.openai.com' })`
- [ ] `verifyApiKey(config)` makes a minimal API call (5 token max) and returns
      `true` or `false`
- [ ] On save: verify → if valid, write to `chrome.storage.local` and show
      "Connected" badge in green; if invalid, show "Invalid key" in red
- [ ] Model selector shown for each provider (e.g. claude-sonnet-4-5, GPT-4o)
- [ ] API key masked in the input field (type="password")
- [ ] Clearing the key removes it from `chrome.storage.local`

### Browser test — milestone is done when:
1. Open the popup, enter a valid Anthropic API key, click Save — green
   "Connected" badge appears within 3 seconds.
2. Enter a deliberately wrong key, click Save — red "Invalid key" message
   appears, nothing saved to storage.
3. Close and reopen the popup — the green badge is still shown (key persisted).
4. Click "Open Anthropic" — `console.anthropic.com` opens in a new tab.

---

## Milestone 6 — Form Field Detection

**Goal:** Focusing any input field on any web page sends the field's label to
the background worker. The label is printed to the side panel (no suggestion
yet — just proof the pipeline is live).

### Low-level checks
- [ ] `src/content/index.ts` listens for `focusin` on `INPUT`, `TEXTAREA`,
      `SELECT`
- [ ] `getFieldLabel(el)` resolves label in order: `aria-label` → `<label
      for="...">` → `placeholder` → parent `<label>` text → empty string
- [ ] Duplicate field triggers suppressed (same field focused twice in a row
      sends only one message)
- [ ] `chrome.runtime.sendMessage({ type: 'FIELD_FOCUSED', payload: { fieldId,
      fieldLabel } })` sent to background
- [ ] Background logs received `FIELD_FOCUSED` messages to the service worker
      console
- [ ] Side panel displays a live feed of "Detected: [fieldLabel]" entries as
      fields are focused (debug UI, replaced in Milestone 7)
- [ ] Content script handles fields inside iframes (best-effort, not required
      to be perfect at this stage)

### Browser test — milestone is done when:
1. Go to any sign-up form (e.g. a Google Form or a contact page), click the
   "First name" field — the side panel shows "Detected: First name" within
   half a second.
2. Click 5 different fields in sequence — 5 separate entries appear in the
   side panel feed with the correct labels.
3. Click the same field twice — only one entry in the feed (deduplication
   working).

---

## Milestone 7 — Suggestion Generation & Side Panel Card

**Goal:** Focusing a field triggers a full suggestion cycle: field label →
index query → LLM → suggestion card in the side panel with value, source
file, page, and reason.

### Low-level checks
- [ ] `src/lib/indexing/query.ts` — `queryIndex(fieldLabel, dirHandle)` does
      keyword match against `pages[].fields[].label` in all `<uuid>.json`
      files, returns matched candidates with `documentId`, `fileName`,
      `candidates[]`, `summary`
- [ ] Background worker receives `FIELD_FOCUSED`, calls `queryIndex`, sends
      matched snippet to LLM, receives structured response
- [ ] LLM suggestion prompt returns JSON: `{ value, sourceFile, sourcePage,
      sourceText, reason, confidence }`
- [ ] Background sends `{ type: 'NEW_SUGGESTION', payload: Suggestion }` to
      side panel
- [ ] Side panel renders suggestion card: value (large), source file name,
      page number, reason text, confidence badge (high/medium/low colour coded)
- [ ] If no match found in index, no card is shown (silent — not an error)
- [ ] If LLM returns `value: null`, no card shown
- [ ] Each suggestion has a unique `id` and is tied to a `sessionId`

### Browser test — milestone is done when:
1. Add a W-2 to the folder and index it. Go to any form with a "Wages" or
   "Income" field, click it — a suggestion card appears in the side panel
   within 3 seconds showing the wage value, "W2_2025.pdf", page 1, and a
   plain-English reason.
2. Click a field like "Email" where no matching document exists — no card
   appears, no error shown.
3. Click a "Passport Number" field after adding a passport scan — suggestion
   card shows the passport number with the correct source file cited.

---

## Milestone 8 — Accept, Autofill & Used-Suggestion Tracking

**Goal:** Clicking Accept on a suggestion fills the field on the page. That
field is marked as used and the same suggestion is never offered again in the
same session.

### Low-level checks
- [ ] Side panel "Accept" button sends `{ type: 'SUGGESTION_ACCEPTED', payload:
      Suggestion }` to background
- [ ] Background sends `{ type: 'AUTOFILL_FIELD', payload: { value } }` to
      content script in the active tab
- [ ] Content script sets `input.value = value` and dispatches `new Event('input',
      { bubbles: true })` and `new Event('change', { bubbles: true })`
- [ ] Background marks `fieldId` as used in the current session object
      (`session.usedSuggestions`)
- [ ] `isAlreadyUsed(fieldId)` checked at the top of the `FIELD_FOCUSED`
      handler — used fields are silently skipped
- [ ] `usedFields` array updated in the document's `<uuid>.json` on disk
- [ ] `usage.json` appended with the full suggestion record including
      `usedAt`, `domain`, `sessionId`
- [ ] Side panel "Dismiss" returns suggestion to pool (not marked used)
- [ ] Side panel "Reject" removes suggestion from pool for the session
      (not written to `usedFields` on disk)

### Browser test — milestone is done when:
1. Get a suggestion for "Passport Number", click Accept — the passport number
   field on the page is filled instantly. Check `.indexing/usage.json` — the
   entry is recorded.
2. Click the same "Passport Number" field again — no new suggestion card
   appears (already used).
3. Click Dismiss on a suggestion, then click the same field again — the
   suggestion reappears (dismiss does not mark as used).

---

## Milestone 9 — Multi-Page Form Session Continuity

**Goal:** When a form spans multiple pages and the browser navigates between
them, the session stays alive. Used suggestions from page 1 are still marked
used on page 2. No data is repeated.

### Low-level checks
- [ ] `chrome.webNavigation.onCompleted` listener active in background
- [ ] On navigation: compare new URL's `hostname` to session's `domain`
- [ ] Same domain → session kept alive, `usedSuggestions` array preserved,
      `pageHistory` array extended
- [ ] Different domain → session ended, state cleared, `usage.json` finalised
      with `endedAt` timestamp
- [ ] Content script re-injects correctly on the new page (or relies on
      `run_at: document_idle` re-injection — confirm which)
- [ ] Side panel receives `{ type: 'PAGE_NAVIGATED', payload: { url } }` and
      updates a page indicator ("Page 2 of form")
- [ ] Suggestions pre-queued for new page fields before user clicks anything

### Browser test — milestone is done when:
1. Use a real multi-page form (e.g. a government visa form or a travel booking
   checkout). Fill page 1 using FormBuddy, click Next — on page 2, fields
   already filled on page 1 do not get suggested again.
2. Navigate away to a completely different site — then return to a new form.
   The session resets (the panel shows a fresh state with no prior used
   suggestions).
3. Check `usage.json` after a two-page form — both pages' filled fields appear
   under the same `sessionId`.

---

## Milestone 10 — Screenshot Capture & Instant Indexing

**Goal:** A screenshot hotkey or side panel button captures the current tab,
saves the PNG to the context folder, OCRs it, and makes it available for
suggestions immediately — with the citation showing timestamp and "Screenshot".

### Low-level checks
- [ ] `captureScreenshot()` calls `chrome.tabs.captureVisibleTab({ format:
      'png' })` and receives a base64 data URL
- [ ] PNG converted to `File` object with filename
      `screenshot-YYYY-MM-DD-HHmm.png`
- [ ] File written to the context folder via `writeFileToFolder()`
- [ ] `indexDocument()` called immediately on the new file
- [ ] OCR (`Tesseract.js`) runs on the image, extracts text
- [ ] LLM extracts entities from OCR text
- [ ] `<uuid>.json` written to `.indexing/` with
      `type: 'screenshot'`
- [ ] Suggestion citation shows: "Screenshot — Feb 19 2026, 2:32 PM"
- [ ] Hotkey `Cmd+Shift+S` / `Ctrl+Shift+S` registered in the content script
      and triggers capture
- [ ] Side panel button also triggers capture
- [ ] Side panel shows a brief "Indexing screenshot..." spinner, then
      "Ready" when done

### Browser test — milestone is done when:
1. Open a page that displays your flight confirmation number on screen. Press
   the hotkey — the side panel shows "Indexing screenshot... Ready". Then go
   to a booking form and click the "Confirmation Number" field — the screenshot
   is suggested as the source.
2. Check the context folder — `screenshot-YYYY-MM-DD-HHmm.png` is present. Open
   `.indexing/<uuid>.json` — `type` is `"screenshot"` and `rawText` contains
   text from the page.

---

## Milestone 11 — Quick Add (Drag-Drop, Right-Click, Text Note)

**Goal:** Three ways to add information to the context folder without leaving
the page: drag a file into the side panel, right-click selected text, or type
a quick note.

### Low-level checks
- [ ] **Drag-drop**: `onDragOver` / `onDrop` handlers on the side panel root
      element; dropped files passed to `indexDocument()` and saved to folder
- [ ] **Right-click**: `contextMenus` permission added to manifest;
      `chrome.contextMenus.create` called on `runtime.onInstalled` for
      contexts `['selection', 'image']`; `onClicked` handler sends
      `{ type: 'QUICK_ADD', payload: { content } }` to background; background
      saves as `note-<timestamp>.txt` and indexes
- [ ] **Text note**: side panel has a textarea and a "Save Note" button;
      content saved as `note-<timestamp>.txt` to folder and indexed
      immediately
- [ ] All three methods trigger the same indexing pipeline as Milestone 3–4
- [ ] Side panel file list updates immediately after each add (no manual
      refresh)
- [ ] Dropping an unsupported file type (e.g. `.xlsx`) shows a graceful
      "Unsupported file type" message

### Browser test — milestone is done when:
1. Drag a PNG of an insurance card from Finder into the side panel — the file
   appears in the file list within 2 seconds and is indexed (check
   `.indexing/`).
2. On any web page, select a phone number in text, right-click → "Add to
   FormBuddy folder" — the note appears in the file list, and clicking a
   "Phone" field on a form surfaces it as a suggestion.
3. Type a note "My loyalty number is ABC-123-XYZ" into the text note field,
   click Save — clicking a "Loyalty Number" field on a form surfaces
   "ABC-123-XYZ" as a suggestion.

---

## Milestone 12 — Polish, Error Handling & Chrome Web Store Ready

**Goal:** The extension is stable enough to submit. Every error path is
handled gracefully. The store listing assets are prepared.

### Low-level checks
- [ ] All `chrome.runtime.lastError` cases caught and surfaced in the UI
- [ ] LLM API errors (rate limit, invalid key, network timeout) show user-
      facing messages, not raw stack traces
- [ ] File System Access API permission revocation handled (prompt re-grant)
- [ ] Side panel empty state shown when no folder is selected or no documents
      are indexed
- [ ] Loading spinners on all async operations (indexing, LLM call, screenshot)
- [ ] Vitest unit tests written and passing for: `computeChecksum`,
      `extractTextFromPDF`, `getFieldLabel`, `queryIndex`, `isAlreadyUsed`
- [ ] Playwright e2e test: full flow — folder select → index PDF → focus field
      → accept suggestion → verify field filled → navigate to page 2 → verify
      no repeat
- [ ] `npm run build` produces a clean `dist/` with no TypeScript errors
- [ ] `manifest.json` version bumped to `1.0.0`
- [ ] Privacy policy URL added to manifest (required by Chrome Web Store)
- [ ] Store listing assets prepared: icon 128×128, at least 3 screenshots,
      short description (≤132 chars), long description

### Browser test — milestone is done when:
1. Load the extension fresh (no prior storage). Go through the full onboarding:
   choose folder → add a document → set API key → go to a form → get a
   suggestion → accept it. Everything works end-to-end with no console errors.
2. Disconnect from the internet, then try to get a suggestion — graceful
   "Network error, please check your connection" message in the side panel.
3. Run `npx playwright test` — all e2e tests green.
4. Zip `dist/` and upload to Chrome Web Store developer dashboard — upload
   succeeds with no manifest validation errors.

---

## Summary Table

| Milestone | Deliverable | Done when you can... |
|---|---|---|
| 1 | Extension skeleton | See the side panel open in Chrome |
| 2 | Folder picker + file list | Pick a folder, see files listed |
| 3 | Local indexing + `.indexing` | See `rawText` in uuid.json |
| 4 | LLM entity extraction | See `entities` + `summary` in uuid.json |
| 5 | BYOK settings | Save a key, see green "Connected" badge |
| 6 | Field detection | See field labels appear in side panel |
| 7 | Suggestion card | See a suggestion appear when a field is focused |
| 8 | Accept + autofill + tracking | Click Accept, see field filled; same field skipped next time |
| 9 | Multi-page session | Same session across page navigations, no repeats |
| 10 | Screenshot capture | Screenshot instantly becomes a suggestion source |
| 11 | Quick add (3 methods) | Drag, right-click, and note all feed suggestions |
| 12 | Polish + Web Store ready | End-to-end works, tests pass, zip uploads cleanly |
