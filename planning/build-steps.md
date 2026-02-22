# FormBuddy — Technical Build Guide

A chronological, step-by-step guide to building the FormBuddy Chrome Extension from scratch.

---

## Stack Summary

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Platform | Chrome Extension — Manifest V3 |
| Build Tool | Vite + `crxjs` plugin |
| PDF Parsing | `pdfjs-dist` + `Tesseract.js` |
| LLM (Claude) | `@anthropic-ai/sdk` |
| LLM (OpenAI) | `openai` |
| Folder Access | File System Access API |
| Local Storage | Chrome Extension Storage API (encrypted) |
| UI Framework | React + Tailwind CSS |
| Testing | Vitest + Playwright |

---

## Phase 1 — Project Scaffold

### Step 1: Initialize the Project

```bash
mkdir formbuddy && cd formbuddy
npm create vite@latest . -- --template react-ts
npm install
```

### Step 2: Install the Chrome Extension Build Plugin

```bash
npm install -D @crxjs/vite-plugin
```

`crxjs` handles hot module reload for extensions during development and bundles correctly for Manifest V3.

### Step 3: Configure Vite for Chrome Extension

Update `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
})
```

### Step 4: Write the Manifest

Create `manifest.json` at the project root:

```json
{
  "manifest_version": 3,
  "name": "FormBuddy",
  "version": "0.1.0",
  "description": "Universal form-filling assistant powered by your personal documents",
  "permissions": [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
    "webNavigation",
    "tabs"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "action": {
    "default_title": "FormBuddy",
    "default_popup": "src/popup/index.html"
  }
}
```

### Step 5: Set Up Project Folder Structure

```
formbuddy/
├── src/
│   ├── background/
│   │   └── index.ts              # Service worker
│   ├── content/
│   │   └── index.ts              # Content script
│   ├── sidepanel/
│   │   ├── index.html
│   │   └── SidePanel.tsx         # Main side panel UI
│   ├── popup/
│   │   ├── index.html
│   │   └── Popup.tsx             # Settings / onboarding
│   ├── lib/
│   │   ├── llm/
│   │   │   ├── index.ts          # Unified LLM interface
│   │   │   ├── claude.ts         # Anthropic SDK wrapper
│   │   │   └── openai.ts         # OpenAI SDK wrapper
│   │   ├── parser/
│   │   │   ├── pdf.ts            # PDF text extraction
│   │   │   └── ocr.ts            # Tesseract OCR for images/scans
│   │   ├── context/
│   │   │   ├── indexer.ts        # Indexes folder documents
│   │   │   └── pool.ts           # Context pool management
│   │   ├── suggestions/
│   │   │   ├── engine.ts         # Suggestion generation logic
│   │   │   └── tracker.ts        # Used-suggestion tracking
│   │   └── folder/
│   │       └── access.ts         # File System Access API wrapper
│   └── types/
│       └── index.ts              # Shared TypeScript types
├── manifest.json
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Step 6: Define Shared Types

Create `src/types/index.ts`:

```typescript
export interface Suggestion {
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

export interface DocumentEntry {
  id: string;
  fileName: string;
  filePath: string;
  type: 'pdf' | 'image' | 'text' | 'screenshot';
  extractedText: string;
  language?: string;
  indexedAt: Date;
}

export interface Session {
  id: string;
  startedAt: Date;
  domain: string;
  usedSuggestions: Suggestion[];
  pageHistory: string[];
}

export type LLMProvider = 'anthropic' | 'openai';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
}
```

---

## Phase 2 — Folder Access & Document Parsing

### Step 7: Build the Folder Access Module

Install nothing extra — the File System Access API is built into Chrome.

Create `src/lib/folder/access.ts`:

```typescript
export async function requestFolderAccess(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return handle;
}

export async function listFiles(
  dirHandle: FileSystemDirectoryHandle
): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push(file);
    }
  }
  return files;
}

export async function writeFileToFolder(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
```

Store the folder handle reference in the side panel's React state and pass it to the background worker via `chrome.runtime.sendMessage`.

### Step 8: PDF Text Extraction

```bash
npm install pdfjs-dist
```

Create `src/lib/parser/pdf.ts`:

```typescript
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  'node_modules/pdfjs-dist/build/pdf.worker.min.js'
);

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += `\n[Page ${i}]\n${pageText}`;
  }

  return fullText;
}
```

### Step 9: OCR for Scanned PDFs and Images

```bash
npm install tesseract.js
```

Create `src/lib/parser/ocr.ts`:

```typescript
import Tesseract from 'tesseract.js';

export async function extractTextFromImage(file: File): Promise<string> {
  const { data: { text } } = await Tesseract.recognize(file, 'eng', {
    logger: () => {},
  });
  return text;
}
```

Use `extractTextFromPDF` first — if the result is mostly empty (scanned PDF), fall back to `extractTextFromImage`.

### Step 10: Build the Context Indexer

Create `src/lib/context/indexer.ts`:

```typescript
import { extractTextFromPDF } from '../parser/pdf';
import { extractTextFromImage } from '../parser/ocr';
import { DocumentEntry } from '../../types';

export async function indexFile(file: File): Promise<DocumentEntry> {
  let extractedText = '';
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    extractedText = await extractTextFromPDF(file);
    if (extractedText.trim().length < 50) {
      extractedText = await extractTextFromImage(file); // fallback OCR
    }
  } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) {
    extractedText = await extractTextFromImage(file);
  } else if (ext === 'txt') {
    extractedText = await file.text();
  }

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    filePath: file.name,
    type: ext === 'pdf' ? 'pdf' : ext === 'txt' ? 'text' : 'image',
    extractedText,
    indexedAt: new Date(),
  };
}
```

---

## Phase 3 — LLM Integration

### Step 11: Install LLM SDKs

```bash
npm install @anthropic-ai/sdk openai
```

### Step 12: Build the Unified LLM Interface

Create `src/lib/llm/index.ts`:

```typescript
import { LLMConfig, Suggestion } from '../../types';
import { callClaude } from './claude';
import { callOpenAI } from './openai';

export async function getSuggestion(
  fieldLabel: string,
  contextDocuments: string,
  config: LLMConfig
): Promise<Omit<Suggestion, 'id' | 'fieldId' | 'sessionId' | 'usedAt'>> {
  if (config.provider === 'anthropic') {
    return callClaude(fieldLabel, contextDocuments, config);
  }
  return callOpenAI(fieldLabel, contextDocuments, config);
}
```

Create `src/lib/llm/claude.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { LLMConfig } from '../../types';

const SYSTEM_PROMPT = `You are a form-filling assistant. Given a form field label and
a set of personal documents, find the most accurate value to fill in the field.
Always respond in JSON with this exact structure:
{
  "value": "the suggested value",
  "sourceFile": "filename it came from",
  "sourcePage": 1,
  "sourceText": "exact text from the document",
  "reason": "plain English explanation of why this value was chosen",
  "confidence": "high | medium | low"
}
If no relevant information is found, respond with value: null.`;

export async function callClaude(
  fieldLabel: string,
  contextDocuments: string,
  config: LLMConfig
) {
  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Field: "${fieldLabel}"\n\nDocuments:\n${contextDocuments}`,
      },
    ],
  });

  const text = (response.content[0] as any).text;
  return JSON.parse(text);
}
```

### Step 13: Store API Key Securely

```typescript
// Save
await chrome.storage.local.set({
  llmConfig: {
    provider: 'anthropic',
    apiKey: userEnteredKey,
    model: 'claude-sonnet-4-5-20250929',
  },
});

// Retrieve
const { llmConfig } = await chrome.storage.local.get('llmConfig');
```

Chrome's local storage is sandboxed to the extension — no other site or extension can access it.

---

## Phase 4 — Content Script & Field Detection

### Step 14: Detect Focused Form Fields

Create `src/content/index.ts`:

```typescript
let lastFocusedField: HTMLElement | null = null;

document.addEventListener('focusin', async (event) => {
  const target = event.target as HTMLElement;

  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

  const label = getFieldLabel(target);
  if (!label || label === getFieldLabel(lastFocusedField)) return;

  lastFocusedField = target;

  chrome.runtime.sendMessage({
    type: 'FIELD_FOCUSED',
    payload: {
      fieldId: target.id || target.name || label,
      fieldLabel: label,
      tagName: target.tagName,
    },
  });
});

function getFieldLabel(el: HTMLElement | null): string {
  if (!el) return '';
  // Check aria-label
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!;
  // Check associated <label> element
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) return label.textContent?.trim() ?? '';
  }
  // Check placeholder
  if (el.getAttribute('placeholder')) return el.getAttribute('placeholder')!;
  // Check parent label
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent?.trim() ?? '';
  return '';
}

// Listen for autofill command from background worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUTOFILL_FIELD' && lastFocusedField) {
    const input = lastFocusedField as HTMLInputElement;
    input.value = message.payload.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
```

---

## Phase 5 — Background Service Worker

### Step 15: Build the Background Worker

Create `src/background/index.ts`:

```typescript
import { getSuggestion } from '../lib/llm';
import { Session, Suggestion } from '../types';

let currentSession: Session | null = null;
let contextDocuments = '';

// Listen for field focus events from content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'FIELD_FOCUSED') {
    const { fieldId, fieldLabel } = message.payload;

    // Check if already used in this session
    if (isAlreadyUsed(fieldId)) return;

    const { llmConfig } = await chrome.storage.local.get('llmConfig');
    if (!llmConfig?.apiKey) return;

    const suggestion = await getSuggestion(fieldLabel, contextDocuments, llmConfig);
    if (!suggestion.value) return;

    const fullSuggestion: Suggestion = {
      ...suggestion,
      id: crypto.randomUUID(),
      fieldId,
      fieldLabel,
      sessionId: currentSession?.id ?? '',
    };

    // Send suggestion to side panel
    chrome.runtime.sendMessage({ type: 'NEW_SUGGESTION', payload: fullSuggestion });
  }

  if (message.type === 'SUGGESTION_ACCEPTED') {
    markAsUsed(message.payload);
    // Send autofill command to content script
    chrome.tabs.sendMessage(sender.tab!.id!, {
      type: 'AUTOFILL_FIELD',
      payload: { value: message.payload.value },
    });
  }

  if (message.type === 'CONTEXT_UPDATED') {
    contextDocuments = message.payload.documents;
  }
});

// Track navigation for multi-page form support
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  // Session continues — do not reset used suggestions
  // Just notify side panel of page change
  chrome.runtime.sendMessage({ type: 'PAGE_NAVIGATED', payload: { url: details.url } });
});

function isAlreadyUsed(fieldId: string): boolean {
  return currentSession?.usedSuggestions.some(s => s.fieldId === fieldId) ?? false;
}

function markAsUsed(suggestion: Suggestion): void {
  if (!currentSession) return;
  currentSession.usedSuggestions.push({ ...suggestion, usedAt: new Date() });
}
```

---

## Phase 6 — Side Panel UI

### Step 16: Build the Side Panel

Install Tailwind CSS:

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

The side panel React app (`src/sidepanel/SidePanel.tsx`) should contain:

- A **folder picker button** that calls `requestFolderAccess()`, indexes all files, and sends the extracted text to the background worker
- A **suggestions feed** that listens for `NEW_SUGGESTION` messages and renders each one with value, source, and reason
- An **Accept** and **Dismiss** button per suggestion
- A **used suggestions log** at the bottom showing the session audit trail
- A **screenshot button** using `chrome.tabs.captureVisibleTab()`
- A **text note field** for quick manual entries
- A **settings link** to the popup for API key configuration

### Step 17: Screenshot Capture

```typescript
async function captureScreenshot(): Promise<void> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  // Convert dataUrl to File
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
  // Save to folder
  const content = dataUrl; // or save blob
  await writeFileToFolder(folderHandle, file.name, await file.text());
  // Re-index
  const entry = await indexFile(file);
  addToContextPool(entry);
}
```

---

## Phase 7 — Quick Add Features

### Step 18: Right-Click Context Menu

Add to `manifest.json`:
```json
"permissions": ["contextMenus"]
```

In the background worker:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-to-formbuddy',
    title: 'Add to FormBuddy folder',
    contexts: ['selection', 'image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'add-to-formbuddy') {
    const content = info.selectionText ?? info.srcUrl ?? '';
    // Save as .txt to folder and re-index
    chrome.runtime.sendMessage({ type: 'QUICK_ADD', payload: { content } });
  }
});
```

### Step 19: Drag and Drop in Side Panel

In the side panel React component:

```typescript
const handleDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    const entry = await indexFile(file);
    addToContextPool(entry);
    await saveFileToFolder(folderHandle, file);
  }
};
```

---

## Phase 8 — Translation Support

### Step 20: Add Language Detection & Translation

Include language detection in the LLM prompt — instruct it to identify the document's language and translate relevant sections before extracting values. No separate translation library needed; the LLM handles this natively.

Update the system prompt in `claude.ts` to include:

```
If the document is not in English, translate the relevant sections before extracting the value.
Note the original language in your response.
```

---

## Phase 9 — BYOK Onboarding Flow

### Step 21: Build the Settings / Onboarding Popup

The popup (`src/popup/Popup.tsx`) should:

1. Show the current LLM provider and connection status
2. Have a **"Connect Anthropic"** button that opens `https://console.anthropic.com` in a new tab
3. Have a **"Connect OpenAI"** button that opens `https://platform.openai.com` in a new tab
4. Have an API key input field with a **Save** button
5. On save, store to `chrome.storage.local` and verify the key with a lightweight test API call

```typescript
async function verifyApiKey(config: LLMConfig): Promise<boolean> {
  try {
    if (config.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });
      await client.messages.create({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      });
    }
    return true;
  } catch {
    return false;
  }
}
```

---

## Phase 10 — Testing

### Step 22: Unit Tests with Vitest

```bash
npm install -D vitest
```

Write unit tests for:
- `extractTextFromPDF` — test with known PDF fixture
- `getSuggestion` — mock the LLM SDK, test prompt construction
- `isAlreadyUsed` — test session tracking logic
- `getFieldLabel` — test DOM label extraction with jsdom

### Step 23: End-to-End Tests with Playwright

```bash
npm install -D playwright @playwright/test
```

Playwright supports loading Chrome extensions in test mode:

```typescript
const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--load-extension=./dist`, `--disable-extensions-except=./dist`],
});
```

Test the full flow: open a form page, focus a field, verify suggestion appears, accept it, verify field is filled, navigate to next page, verify suggestion is not repeated.

---

## Phase 11 — Build & Publish

### Step 24: Production Build

```bash
npm run build
```

The `dist/` folder is the packaged extension ready for loading or submission.

### Step 25: Load Locally for Testing

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

### Step 26: Publish to Chrome Web Store

1. Zip the `dist/` folder
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Create a new item, upload the zip
4. Fill in store listing (description, screenshots, privacy policy)
5. Submit for review — Google's review typically takes 1–3 business days

---

## Development Milestones

| Milestone | Goal |
|---|---|
| M1 | Extension loads, side panel opens, folder can be selected |
| M2 | PDFs are parsed and text is extracted correctly |
| M3 | Focused form fields are detected and label is read |
| M4 | LLM returns a suggestion with citation for a focused field |
| M5 | Suggestion appears in side panel, user can accept or dismiss |
| M6 | Accepting autofills the field correctly |
| M7 | Used suggestions are not repeated within a session |
| M8 | Navigation across form pages retains session state |
| M9 | Screenshot capture works and gets indexed |
| M10 | Right-click add, drag-drop, and text notes all work |
| M11 | BYOK onboarding flow is complete with key verification |
| M12 | All tests pass, ready for Chrome Web Store submission |
