# FormBuddy — Claude Context File

## What This Is
A Chrome Extension (Manifest V3) that acts as a universal form-filling assistant. It reads a user-defined local folder of personal documents (PDFs, screenshots, notes), indexes them locally, and suggests values for web form fields — with citations showing exactly which file and page the data came from. Nothing leaves the user's device except API calls to the LLM provider.

---

## Tech Stack
| Layer | Technology |
|---|---|
| Language | TypeScript (throughout) |
| Platform | Chrome Extension — Manifest V3 |
| Build Tool | Vite + `@crxjs/vite-plugin` |
| UI | React + Tailwind CSS |
| PDF Parsing | `pdfjs-dist` (text) + `Tesseract.js` (OCR fallback) |
| LLM — Claude | `@anthropic-ai/sdk` |
| LLM — OpenAI | `openai` |
| Folder Access | File System Access API (no server upload) |
| Storage | `chrome.storage.local` (sandboxed, encrypted) |
| Testing | Vitest (unit) + Playwright (e2e) |

---

## Project Files (planning-only stage — no source code yet)

| File | Purpose |
|---|---|
| `PLAN.md` | 12 milestones with low-level dev checklist and browser acceptance tests |
| `design.md` | Full product design doc (features, UI, architecture, privacy) |
| `build-steps.md` | Chronological step-by-step build guide with code snippets |
| `flow-diagrams.md` | Mermaid diagrams for all major system flows |
| `indexing-system.md` | Deep design of the `.indexing` local database folder |

**No source code exists yet.** The project is in the planning/design phase.

---

## Planned Folder Structure (to be created)
```
src/
├── background/index.ts        # Service worker — session state, LLM calls, navigation
├── content/index.ts           # Injected into pages — field detection, autofill
├── sidepanel/SidePanel.tsx    # Main UI — suggestions, folder manager, settings
├── popup/Popup.tsx            # Settings popup — BYOK API key entry
├── lib/
│   ├── llm/
│   │   ├── index.ts           # Unified callLLM() dispatcher
│   │   ├── claude.ts          # Anthropic SDK wrapper
│   │   └── openai.ts          # OpenAI SDK wrapper
│   ├── parser/
│   │   ├── pdf.ts             # extractTextFromPDF() via pdfjs-dist
│   │   └── ocr.ts             # extractTextFromImage() via Tesseract.js
│   ├── indexing/
│   │   ├── indexer.ts         # indexDocument() — routes parser, writes uuid.json
│   │   ├── checksum.ts        # computeChecksum() via crypto.subtle SHA-256
│   │   ├── manifest.ts        # readManifest() / writeManifest()
│   │   └── query.ts           # queryIndex() — keyword match before LLM call
│   └── folder/
│       └── access.ts          # requestFolderAccess(), listFiles(), writeFileToFolder()
└── types/index.ts             # Suggestion, DocumentEntry, Session, LLMConfig
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
  provider: 'anthropic' | 'openai';
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

---

## Session Lifecycle
- **Session starts** when user opens a form page
- **Session persists** across same-domain navigations (multi-page forms)
- **Session ends** when user navigates to a different domain or resets manually
- `isAlreadyUsed(fieldId)` is checked at the top of every `FIELD_FOCUSED` handler — used fields are silently skipped

---

## BYOK Payment Flow
1. User opens popup → clicks "Connect AI Provider"
2. Extension opens `console.anthropic.com` or `platform.openai.com` in a new tab
3. User gets API key from provider
4. User pastes key into extension → lightweight test call verifies it
5. Key stored in `chrome.storage.local` — never sent to any FormBuddy server (no server exists)

---

## Manifest V3 Permissions
`storage`, `activeTab`, `scripting`, `sidePanel`, `webNavigation`, `tabs`, `contextMenus`, `host_permissions: <all_urls>`

---

## 12 Build Milestones (current status: none started)
| # | Goal |
|---|---|
| 1 | Extension skeleton loads in Chrome, side panel opens |
| 2 | Folder picker + file list in side panel |
| 3 | Document indexing into `.indexing` with checksum dedup |
| 4 | LLM entity extraction written into uuid.json |
| 5 | BYOK settings popup with API key verification |
| 6 | Form field detection (content script → background) |
| 7 | Suggestion card in side panel with citation |
| 8 | Accept → autofill → used-suggestion tracking |
| 9 | Multi-page form session continuity |
| 10 | Screenshot capture → OCR → immediate indexing |
| 11 | Quick-add: drag-drop, right-click, text note |
| 12 | Polish, error handling, tests, Chrome Web Store ready |

---

## Supported LLM Models
- Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Model selection exposed in the popup settings UI

---

## Privacy Guarantees
- No backend server — extension is entirely client-side
- Documents never uploaded anywhere
- LLM receives only matched snippets, not full documents
- API keys sandboxed in `chrome.storage.local`
- `usage.json` stays on user's disk in their chosen folder
