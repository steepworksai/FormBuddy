# FormBuddy — Claude Context File

## What This Is
A Chrome & Edge Extension (Manifest V3) that acts as a universal form-filling assistant. It reads a user-defined local folder of personal documents (PDFs, screenshots, notes), indexes them locally, and suggests values for web form fields — with citations showing exactly which file and page the data came from. Nothing leaves the user's device except API calls to the LLM provider.

---

## Current Status
**Shipped.** v1.0.0 submitted to Chrome Web Store and Microsoft Edge Add-ons.
- All 12 milestones complete
- 188 unit tests (Vitest) + 16 e2e tests (Playwright) passing
- Open source under MIT license
- Landing page + privacy policy live on GitHub Pages

---

## Company / Publisher
**Waystone Studios**
Used as developer name on both store listings and in LICENSE, README, and docs footers.

---

## URLs

| Purpose | URL |
|---|---|
| Landing page | `https://steepworksai.github.io/FormBuddy/` |
| Privacy policy | `https://steepworksai.github.io/FormBuddy/privacy.html` |
| Support | `https://github.com/steepworksai/FormBuddy/issues` |
| GitHub repo | `https://github.com/steepworksai/FormBuddy` |

GitHub Pages is served from the `docs/` folder on the `main` branch.

---

## Tech Stack
| Layer | Technology |
|---|---|
| Language | TypeScript (throughout) |
| Platform | Chrome & Edge Extension — Manifest V3 |
| Build Tool | Vite + `@crxjs/vite-plugin` |
| UI | React + Tailwind CSS |
| PDF Parsing | `pdfjs-dist` (text) + `Tesseract.js` (OCR fallback) |
| LLM — Claude | `@anthropic-ai/sdk` |
| LLM — OpenAI | `openai` |
| LLM — Gemini | Gemini REST API (fetch) |
| Folder Access | File System Access API (no server upload) |
| Storage | `chrome.storage.local` (sandboxed, encrypted) |
| Testing | Vitest (188 unit tests) + Playwright (16 e2e tests) |

---

## Folder Structure
```
src/
├── background/index.ts        # Service worker — session state, LLM calls, navigation
├── content/index.ts           # Injected into pages — field detection, autofill
├── sidepanel/SidePanel.tsx    # Main UI — suggestions, folder manager, scan & fill
├── popup/Popup.tsx            # Settings popup — BYOK API key entry
├── lib/
│   ├── llm/
│   │   ├── index.ts           # Unified callLLM() dispatcher
│   │   ├── claude.ts          # Anthropic SDK wrapper
│   │   ├── openai.ts          # OpenAI SDK wrapper
│   │   ├── gemini.ts          # Gemini REST wrapper
│   │   └── formMapper.ts      # Maps LLM response to form fields (Scan & Auto Fill)
│   ├── parser/
│   │   ├── pdf.ts             # extractTextFromPDF() via pdfjs-dist
│   │   └── ocr.ts             # extractTextFromImage() via Tesseract.js
│   ├── indexing/
│   │   ├── indexer.ts         # indexDocument() — routes parser, writes uuid.json
│   │   ├── checksum.ts        # computeChecksum() via crypto.subtle SHA-256
│   │   ├── manifest.ts        # readManifest() / writeManifest()
│   │   └── query.ts           # queryIndex() — keyword match before LLM call
│   ├── folder/
│   │   └── access.ts          # requestFolderAccess(), listFiles(), writeFileToFolder()
│   ├── config/
│   │   └── supportedTypes.ts  # File type registry (PDF, PNG, JPG, TXT, etc.)
│   └── utils/
│       └── modelName.ts       # shortModelName() — "claude-sonnet-4-6" → "Sonnet 4.6"
└── types/
    ├── index.ts               # Suggestion, DocumentEntry, Session, LLMConfig
    └── fsa.d.ts               # FileSystemDirectoryHandle augmentations
docs/
├── index.html                 # Landing page (GitHub Pages)
└── privacy.html               # Privacy policy (GitHub Pages)
tests/
├── unit/                      # Vitest unit tests
├── e2e/                       # Playwright e2e tests
└── mocks/                     # Shared test mocks (FSA, chrome API)
```

---

## Core Data Models

```typescript
interface Suggestion {
  id: string;
  fieldId: string;
  fieldLabel: string;
  value: string;
  sourceFile: string;
  sourcePage?: number;
  sourceText: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  usedAt?: Date;
  sessionId: string;
}

interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;      // stored in chrome.storage.local
  model: string;
}
```

---

## .indexing Local Database (written next to user's documents)

```
Context Folder/
├── W2_2025.pdf
└── .indexing/
    ├── manifest.json        # Registry: fileName, checksum, indexFile, needsReindex
    ├── <uuid>.json          # Per-doc: rawText, pages[].fields[], entities{}, summary, usedFields[]
    └── usage.json           # Cross-session history of all accepted suggestions
```

**Checksum logic:** SHA-256 of each file compared to manifest on every folder open. Changed files are re-indexed; unchanged files are skipped.

**LLM token efficiency:** `queryIndex()` does keyword matching first — only the matched snippet is sent to the LLM, never the full document.

---

## Key Message Types (Chrome runtime messages)

| Message | Direction | Purpose |
|---|---|---|
| `FIELD_FOCUSED` | content → background | User focused an input, sends `fieldId`, `fieldLabel` |
| `NEW_SUGGESTION` | background → sidepanel | Push suggestion card to display |
| `SUGGESTION_ACCEPTED` | sidepanel → background | User clicked Accept |
| `AUTOFILL_FIELD` | background → content | Fill the field with the value |
| `PAGE_NAVIGATED` | background → sidepanel | Browser navigated (multi-page form) |
| `CONTEXT_UPDATED` | sidepanel → background | New documents indexed |
| `QUICK_ADD` | background internal | Right-click / note added to folder |
| `MANUAL_FIELD_FETCH` | sidepanel → background | User manually requests suggestion for a field |
| `FORM_KV_FORCE_REFRESH` | sidepanel → background | Force re-scan of all fields on page |

---

## Session Lifecycle
- **Session starts** when user opens a form page
- **Session persists** across same-domain navigations (multi-page forms)
- **Session ends** when user navigates to a different domain or resets manually
- `isAlreadyUsed(fieldId)` is checked at the top of every `FIELD_FOCUSED` handler — used fields are silently skipped

---

## Supported LLM Models
- Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Google: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`
- Model selection exposed in the popup settings UI
- Active model shown as a badge in the side panel (via `shortModelName()`)

---

## BYOK Flow
1. User opens popup → selects provider + pastes API key
2. Extension makes a lightweight test call to verify the key
3. Key stored in `chrome.storage.local` — never sent to any FormBuddy server
4. Side panel shows active model badge (e.g. "Sonnet 4.6")

---

## Manifest V3 Permissions
`storage`, `activeTab`, `scripting`, `sidePanel`, `webNavigation`, `tabs`, `contextMenus`, `host_permissions: <all_urls>`

**Why `<all_urls>`:** Content script must be pre-injected at `document_idle` on any page to passively listen for field focus events. `activeTab` alone does not work because it only grants access after an explicit user gesture — the suggestion must appear automatically when a field is focused.

---

## Packaging for Store Submission

```bash
npm run build
cd dist && zip -r ../formbuddy-v1.0.0.zip . --exclude "*.DS_Store" --exclude ".vite/*" && cd ..
```

**Critical:** exclude `.vite/` — it contains Vite's internal `manifest.json` which triggers a "more than one manifest.json" validation error on both Chrome and Edge stores.

The same ZIP works for both Chrome Web Store and Microsoft Edge Add-ons.

---

## Privacy Guarantees
- No backend server — extension is entirely client-side
- Documents never uploaded anywhere
- LLM receives only matched snippets, not full documents
- API keys sandboxed in `chrome.storage.local`
- `usage.json` stays on user's disk in their chosen folder

---

## Development Commands
```bash
npm install          # install dependencies
npm run dev          # start Vite dev server
npm run build        # production build → dist/
npm run test:unit    # run Vitest unit tests
npm run test:e2e     # run Playwright e2e tests
npm run test:all     # build + all tests
```

---

## Key Implementation Decisions & History
- **`labelTokens` removed** — was a duplicate of `tokenize()`; background now calls `tokenize(label)` directly
- **`formMapper.ts` simplified** — dead try/catch removed; `parseKeyValueMappings()` called once
- **`claude.ts` guard added** — `if (!block) throw new Error('Empty response from Claude')`
- **`screenshotStatus` error state removed** — dead state; catch block now sets status to `'idle'` directly
- **FSA `queryPermission`/`requestPermission` added to `fsa.d.ts`** — fixes TS2339 build error
- **`shortModelName()` extracted to `src/lib/utils/modelName.ts`** — converts model IDs to display names
- **Gemini added as third provider** — REST-based (no official SDK), fetch wrapper in `gemini.ts`
- **`IncomingMessage` discriminated union** — type-safe chrome.runtime.onMessage handling via `isTypedMessage()` guard
- **ZIP must exclude `.vite/`** — store validators reject packages with multiple `manifest.json` files

---

## Git Workflow Note
Do not run `git add`, `git commit`, or `git push` — leave all git operations to the user.
