# FormBuddy — Tester Guide

Internal only. Not for customers.

---

## What You're Testing

FormBuddy is a Chrome extension that reads personal documents you store in a local folder (PDFs, images, notes) and auto-fills web form fields from them. No data leaves your device except the API call to the LLM provider.

The core flow is:
1. User picks a local folder of documents
2. Extension indexes them (parses text, runs LLM cleanup)
3. User opens a web form and clicks **Scan & Auto Fill**
4. Extension scans the form fields, matches values from documents, fills the form

---

## Installation

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. The FormBuddy icon appears in the toolbar
5. Click it → the side panel opens on the right

To reload after a code change: click the refresh icon on the extension card in `chrome://extensions`.

---

## First-Time Setup

### 1. Add an API Key

Click the **Settings** (gear icon) in the side panel.

Supported providers and recommended models:

| Provider | Model to use | Where to get key |
|---|---|---|
| Anthropic (Claude) | `claude-sonnet-4-6` | console.anthropic.com |
| OpenAI | `gpt-4o` | platform.openai.com |
| Google Gemini | `gemini-2.5-flash` | aistudio.google.com |

Paste the key and click **Verify**. A test call confirms it works.

### 2. Choose a Documents Folder

Click **Choose Folder** in the side panel. Select any local folder containing your test documents. The extension will create a `FormBuddy-DB/` subfolder inside it for its index.

---

## Demo Documents

Ready-made test files are in `output/`. Use these for repeatable testing.

### Passenger travel scenario

**Documents to index** (in `output/pdf/`):
```
john-smith.pdf    John Andrew Smith  | DOB: 15 March 1985 | Passport: P12345678 | +1 (312) 555-0147
sarah-lee.pdf     Sarah Mei Lee      | DOB: 22 July 1990  | Passport: P98765432 | +1 (415) 555-0293
raj-patel.pdf     Raj Kumar Patel    | DOB: 03 Nov 1978   | Passport: P55512349 | +1 (212) 555-0384
```

**Form to fill** (`output/html/flight-booking-form.html`):
- Open in Chrome via `File > Open`
- 3 passenger sections, 12 fields each
- All inputs have `aria-label="Passenger N Field Name"` — labels are unambiguous
- Expected: FormBuddy fills all 3 passengers correctly on Scan & Fill

### Tax form scenario

**Document to index** (`output/pdf/1099b-apex-brokerage.pdf`):
- Brokerage statement with stock transactions

**Form to fill** (`output/html/form-8949.html`):
- IRS Form 8949 (sales of capital assets)
- Tests financial data extraction

### Driver's licence scenario

**Document to index** (`output/pdf/FAKE_DL.png`):
- Fake DL image — tests OCR (Tesseract fallback)

**Form to fill** (`output/html/formbuddy-dl-test-form.html`):
- Standard personal details form

---

## Key Features to Test

### Scan & Auto Fill
1. Index the documents
2. Open a form
3. Click **Scan & Auto Fill** in the side panel
4. Watch the status bar: Scanning → Finding values → Filling
5. Check the results table — green = filled, red = skipped

### Real-time hover suggestions
1. Index documents
2. Open any form
3. Hover over or click into a field
4. A suggestion card should appear at the top of the page
5. Press **Space** or click **Copy** to accept

### Cache behaviour
- Run Scan & Fill once — note the time (LLM call happens)
- Run it again on the same form with same docs — should be instant (cache hit)
- Click **Clear Cache** in the side panel to force a fresh LLM call

### Screenshot / OCR (Milestone 10)
- Press **Cmd+Shift+S** (Mac) or **Ctrl+Shift+S** (Windows) on any page
- A screenshot is captured, OCR'd via Tesseract, and indexed immediately

---

## Testing on Real Forms

### Recommended test sites

| Site | What to test |
|---|---|
| `output/html/flight-booking-form.html` | Multi-passenger, clean labels |
| emirates.com booking (passenger details step) | Real airline SPA, `aria-labelledby`, complex DOM |
| Any Google Form | Simple fields |

### Getting to the Emirates passenger form
1. Go to emirates.com
2. Search any route (e.g. JFK → DXB), 3 passengers, future date
3. Select a flight → proceed through to **Passenger Details** (Step 2)
4. Click **Scan & Auto Fill**

Known Emirates-specific behaviour:
- DOB field uses `aria-labelledby` (not `aria-label`) — supported from build 0.1.x
- DOB field is `type="tel" pattern="\d*"` — expects digits. Value may not validate if filled as `DD/MM/YYYY` text; Emirates may auto-format as you type
- Date pickers and dropdowns cannot be filled via `element.value` assignment — fields will appear in the "skipped" list

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Multi-passenger same-label forms | If a form has 3 "First Name" fields with no `aria-label` / `aria-labelledby`, FormBuddy can't tell which passenger each belongs to |
| Native date pickers (`<input type="date">`) | `element.value` assignment works but React/Angular forms may not pick up the change event correctly |
| Digit-only inputs with auto-format (e.g. Emirates DOB) | FormBuddy sends formatted text; field may reject it |
| Shadow DOM | Inputs inside shadow DOM are not scanned |
| iframes | Cross-origin iframes are not accessible |
| Select dropdowns | Matched by option text; fails if the option text differs from the document value |

---

## Debugging

### Where is the index stored?
Inside the folder you chose: `<your-folder>/FormBuddy-DB/`

```
FormBuddy-DB/
├── manifest.json          # Registry of all indexed documents
├── <uuid>.json            # Per-document: cleanText, pages, indexedAt
├── form-kv/
│   └── <hash>.json        # Cached LLM mappings for each form+docs combination
└── usage.json             # History of accepted suggestions
```

### Cache file anatomy (`form-kv/<hash>.json`)
```json
{
  "signature": "manual_fetch::...",
  "generatedAt": "2026-02-24T...",
  "requestedFields": [
    "Passenger 1 Date of Birth [format: DD/MM/YYYY]",
    "Passenger 1 First Name"
  ],
  "mappings": [
    { "fieldLabel": "Passenger 1 First Name", "value": "John", "sourceFile": "john-smith.pdf", ... }
  ]
}
```

`requestedFields` shows what was sent to the LLM, including any format hints detected from the DOM. If a field you expect to see is missing here, the content script didn't detect it.

### Console logs
- **Background service worker**: `chrome://extensions` → FormBuddy → **Service Worker** link → DevTools console
- **Content script**: open DevTools on the target page → Console tab — logs prefixed `[FormBuddy]`
- **Side panel**: right-click the side panel → **Inspect** → Console

### Useful log messages
| Message | Meaning |
|---|---|
| `[FormBuddy] LLM mapping failed:` | LLM call errored — check API key / quota |
| `[FormBuddy] SECTION_FILL_REQUEST failed:` | Bulk fill errored |
| `FORM_KV_STATUS running` | LLM call in progress |
| `FORM_KV_STATUS ready` | Mappings received and ready |

---

## Reporting Issues

Please include:
1. Which form URL (or attach the HTML file)
2. Which documents were indexed (filenames + what data they contain)
3. What the `requestedFields` array shows in the cache JSON
4. Screenshot of the results table in the side panel
5. Any `[FormBuddy]` errors from the console
6. Provider + model used (Claude / OpenAI / Gemini, and model name)
