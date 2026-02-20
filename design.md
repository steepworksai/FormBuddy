# FormBuddy — Product Design Document

## Overview

FormBuddy is a Chrome extension that acts as a universal form-filling assistant. It reads from a user-defined local folder of personal documents (PDFs, screenshots, notes) and intelligently suggests answers for any form field on any web page — tax forms, visa applications, insurance forms, travel bookings, and more. Every suggestion is backed by a citation so the user always knows where the information came from.

---

## Core Philosophy

- **Local first** — all documents stay on the user's machine, never uploaded to a server
- **Transparent** — every suggestion explains why it was made and where the data came from
- **Non-repetitive** — once a piece of information is used to fill a field, it is never suggested again in that session
- **Universal** — works for any form, in any language, on any website

---

## Key Features

### 1. Context Folder
The user points the extension to a local folder on their computer. This folder is the single source of truth for all personal information. It can contain:
- Tax documents (W-2s, 1099s, receipts)
- Identity documents (passport scans, driver's license)
- Insurance cards
- Bank statements
- Flight and hotel confirmations
- Visa documents
- Vaccination records
- Utility bills and lease agreements
- Any other personal documents

The extension uses the **File System Access API** to read from and write to this folder, keeping everything local with no server uploads.

### 2. Form Field Detection
When the user focuses on any input field on a web form, the extension detects the field label and intent using a content script injected into the page. It then queries the context pool (built from the folder) to find the most relevant answer.

### 3. Suggestions with Citations
Every suggestion the extension makes is accompanied by a clear explanation:

> **Field: Passport Number**
> Suggesting: `AB1234567`
> *From: passport_scan.pdf, Page 1 — "Document Number"*

The citation always includes the source file, page number, and the original text it was extracted from.

### 4. Used Suggestion Tracking
Once a suggestion is accepted and a field is filled, that specific piece of data is marked as used for the current session. It will not be suggested again, preventing double-counting or repetition across multi-page forms.

### 5. Multi-Page / Redirect Awareness
When a form spans multiple pages and the browser redirects between them, the extension:
- Detects the navigation event via `chrome.webNavigation.onCompleted`
- Re-injects the content script on the new page
- Retains the full session context and used-suggestions history from previous pages
- Proactively scans new page fields and queues suggestions before the user even clicks

The session resets only when the user navigates away to an unrelated site or manually resets it.

### 6. Screenshot Capture & Query
The user can trigger a screenshot at any time using a hotkey (`Cmd+Shift+S` / `Ctrl+Shift+S`) or a button in the side panel. The extension:
- Captures the visible tab or a user-selected screen region
- Runs OCR/vision extraction to pull text and numbers from the image
- Adds the extracted data to the context pool with the source tagged as "Screenshot — [date, time]"
- Makes it available for future field suggestions with the same citation format

This is useful when information appears on screen during a call, a shared screen, or a document being displayed elsewhere.

### 7. Quick Add to Folder
New information can be added to the context folder in multiple ways:
- **Drag and drop** files directly into the side panel
- **Right-click** any text or image on a web page → "Add to FormBuddy folder"
- **Screenshot button** in the side panel — saves directly to the folder and indexes immediately
- **Quick text note** — type or dictate something heard verbally, saved as a timestamped `.txt` file in the folder

### 8. Physical PDF & Language Translation
When a scanned or image-based PDF is added to the folder (such as a form received in another language), the extension:
- Runs OCR to extract the text
- Translates it if needed
- Indexes the content for use in suggestions
- Can pre-populate answers in translated forms using existing documents in the folder

This makes the extension useful for immigrants, expats, and international travelers dealing with foreign-language paperwork.

---

## User Interface

### Side Panel
The extension uses Chrome's built-in side panel, which sits alongside the active tab. It contains:
- **Suggestion feed** — active suggestions for the current form, each with citation and reason
- **Session tracker** — shows which fields have been filled and what data was used
- **Context folder manager** — view, add, and remove documents from the folder
- **Provider settings** — LLM provider selection and API key entry
- **Screenshot / Add note buttons** — quick-add tools for capturing new information

### Suggestion UI (inline on page)
When a field is focused, a subtle tooltip appears near the field showing the suggested value and a one-line reason. The user can accept with one click or dismiss. Dismissed suggestions return to the pool unless explicitly rejected.

---

## LLM Integration — Bring Your Own Key (BYOK)

FormBuddy uses LLMs (Claude by Anthropic or OpenAI's GPT models) for:
- Understanding what each form field is asking for
- Matching field intent to the right document and value in the context pool
- Generating the human-readable "why" for every suggestion
- OCR interpretation and language translation

### Payment Model
The app never handles money or stores payment information. The model is:

1. User clicks "Connect AI" in the extension settings
2. Extension opens the chosen provider's billing page (Anthropic or OpenAI) in a new tab
3. User creates an account and adds credits directly on the provider's platform
4. User copies their API key from the provider dashboard
5. User pastes the API key into the extension settings
6. The extension stores the key locally using encrypted Chrome storage
7. All LLM API calls are made directly from the extension to the provider — no intermediary server

This means zero PCI compliance burden, no financial data ever touches FormBuddy's systems, and the user retains full visibility of their usage and billing through the provider's own dashboard.

### Supported Providers
- **Anthropic Claude** (claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5)
- **OpenAI** (GPT-4o, GPT-4o mini)

The LLM call is abstracted behind a single interface in the codebase, making it trivial to add new providers.

---

## Technical Architecture

### Stack
- **Language**: TypeScript (throughout)
- **Platform**: Chrome Extension — Manifest V3
- **LLM SDKs**: Anthropic TypeScript SDK, OpenAI TypeScript SDK
- **PDF parsing**: `pdfjs-dist` for text-based PDFs, `Tesseract.js` for scanned/image PDFs
- **Folder access**: File System Access API (no server upload required)
- **Local storage**: Encrypted Chrome extension storage for API keys and session state

### Extension Components

```
FormBuddy Chrome Extension
├── Background Service Worker
│   ├── Manages context pool (indexed document data)
│   ├── Handles LLM API calls
│   ├── Tracks used suggestions across session
│   └── Listens for navigation events (redirect detection)
│
├── Content Script (injected into form pages)
│   ├── Detects focused field and its label
│   ├── Communicates with background worker
│   └── Renders inline suggestion tooltips
│
├── Side Panel
│   ├── Suggestion feed UI
│   ├── Session and usage tracker
│   ├── Folder manager (add/remove documents)
│   └── Settings (provider, API key, hotkeys)
│
└── Context Folder (local, user-defined)
    ├── PDFs (tax docs, identity, insurance, etc.)
    ├── Screenshots (saved with timestamp)
    ├── Text notes (voice/manual entries)
    └── index.json (tracks what has been indexed and used)
```

### Suggestion Data Model

Every suggestion carries a structured object:

```typescript
interface Suggestion {
  fieldId: string;          // Identifier of the form field
  fieldLabel: string;       // Human-readable field name
  value: string;            // Suggested answer
  sourceFile: string;       // File it came from
  sourcePage?: number;      // Page number in the file
  sourceText: string;       // Original text it was extracted from
  reason: string;           // Human-readable explanation generated by LLM
  confidence: 'high' | 'medium' | 'low';
  usedAt?: Date;            // Set when accepted, null if unused
  sessionId: string;        // Groups suggestions within one form journey
}
```

### Session Management

A session starts when the user opens a form page and ends when they navigate to an unrelated domain or manually reset. The session tracks:
- All suggestions made
- All suggestions accepted (and to which fields)
- Page-by-page navigation history within the form
- The full audit trail of what data was used and why

---

## Use Cases

### Tax Filing
Extract W-2, 1099, and receipt data from the folder and auto-suggest values for every field across a multi-page tax return.

### Visa Applications
Fill passport number, travel history, home address, employer details, and other repeated fields across lengthy visa form pages.

### Travel & Bookings
Use flight confirmations, hotel bookings, and passport scans to pre-populate traveler info on booking platforms.

### Insurance Claims
Pull policy numbers, incident dates, and personal details from existing insurance documents.

### Medical & Government Forms
Use existing records to fill patient intake forms, benefit applications, and government paperwork.

### International / Foreign Language Forms
Translate scanned foreign-language forms and fill them using documents already in the folder.

---

## Privacy & Security

- No data ever leaves the user's device except API calls to the chosen LLM provider (Anthropic or OpenAI)
- API keys are stored encrypted in Chrome's local extension storage
- No FormBuddy backend server exists — the extension operates entirely client-side
- Payment and billing are handled entirely by the LLM provider
- The user retains full control of their context folder at all times
- Session data is cleared when the browser closes or the user resets manually

---

## Future Considerations

- Voice input for capturing spoken information into the folder
- Offline LLM support (local model via WebLLM or similar)
- Firefox and Edge extension ports
- Mobile companion app for photographing physical documents directly into the folder
- End-to-end encrypted sync of the context folder across devices
