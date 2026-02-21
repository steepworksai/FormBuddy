# FormBuddy — AI Form Filler

> Fill any web form instantly from your personal documents — locally, privately, with AI-powered suggestions and full citations.

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-v1.0.0-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore/detail/formbuddy)
[![Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-v1.0.0-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/formbuddy)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/)

---

## What it does

FormBuddy reads your PDFs, passport scans, tax forms, and notes — indexes them **entirely on your device** — then suggests the right value for every form field you click on any website.

- **Scan & Auto Fill** — detects all fields on a page and fills them at once
- **Every suggestion cites its source** — file name, page number, exact snippet
- **Works on any website** — visa applications, insurance claims, tax returns, travel bookings
- **Multi-page form support** — tracks which fields were already filled across page navigations
- **Quick Add** — drag-drop files, right-click to save selected text, or take a screenshot

---

## Privacy first

| What happens | Detail |
|---|---|
| Documents | Read locally via File System Access API — never uploaded |
| LLM calls | Short text snippets sent **directly** from your browser to your chosen AI provider |
| API keys | Stored in Chrome's encrypted `chrome.storage.local` — never sent to FormBuddy |
| Analytics | None. No backend server exists. |

See the full [Privacy Policy](https://venkateshpoosarla.github.io/FormBuddy/privacy.html).

---

## Bring Your Own Key (BYOK)

FormBuddy uses your own API key — no FormBuddy subscription or monthly fee.

| Provider | Models |
|---|---|
| Anthropic | `claude-sonnet-4-6`, `claude-haiku-4-5` |
| OpenAI | `gpt-4o`, `gpt-4o-mini` |
| Google | `gemini-2.0-flash`, `gemini-1.5-pro` |

---

## Getting started

### Install from a browser store

[**Add to Chrome →**](https://chrome.google.com/webstore/detail/formbuddy)
[**Add to Microsoft Edge →**](https://microsoftedge.microsoft.com/addons/detail/formbuddy)

### Run locally from source

```bash
git clone https://github.com/venkateshpoosarla/FormBuddy.git
cd FormBuddy
npm install
npm run build
```

Then load the unpacked extension:

**Chrome:** Go to `chrome://extensions` → Enable **Developer mode** → **Load unpacked** → select `dist/`

**Edge:** Go to `edge://extensions` → Enable **Developer mode** → **Load unpacked** → select `dist/`

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Platform | Chrome & Edge Extension — Manifest V3 |
| Build | Vite + `@crxjs/vite-plugin` |
| UI | React + Tailwind CSS |
| PDF parsing | `pdfjs-dist` + Tesseract.js (OCR) |
| LLM | Anthropic SDK, OpenAI SDK, Gemini REST |
| Folder access | File System Access API |
| Storage | `chrome.storage.local` |
| Testing | Vitest (188 unit tests) + Playwright (16 e2e tests) |

---

## Development

```bash
npm install          # install dependencies
npm run dev          # start Vite dev server
npm run build        # production build → dist/
npm run test:unit    # run Vitest unit tests
npm run test:e2e     # run Playwright e2e tests
npm run test:all     # build + all tests
```

### Project structure

```
src/
├── background/      # Service worker — session state, LLM calls
├── content/         # Content script — field detection, autofill
├── sidepanel/       # Main UI — folder manager, scan & fill
├── popup/           # Settings — API key, model selection
└── lib/
    ├── llm/         # Claude, OpenAI, Gemini wrappers
    ├── indexing/    # Document indexing pipeline
    ├── parser/      # PDF text extraction + OCR
    └── folder/      # File System Access API helpers
```

---

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss significant changes.

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes with tests
4. Open a pull request

---

## License

[MIT](LICENSE) © 2026 Cairn Labs
