# FormBuddy — Publishing Guide (Chrome Web Store & Microsoft Edge Add-ons)

This document covers every step required to submit FormBuddy to the Chrome Web Store and Microsoft Edge Add-ons store. The same ZIP works for both stores — no code changes required.

---

## Table of Contents

1. [Pre-submission Checklist](#1-pre-submission-checklist)
2. [Developer Account Setup](#2-developer-account-setup)
3. [Build the Extension](#3-build-the-extension)
4. [Required Assets](#4-required-assets)
5. [Privacy Policy](#5-privacy-policy)
6. [Store Listing Copy](#6-store-listing-copy)
7. [Submitting to the Chrome Web Store Dashboard](#7-submitting-to-the-chrome-web-store-dashboard)
8. [Submitting to Microsoft Edge Add-ons](#8-submitting-to-microsoft-edge-add-ons)
9. [Review Process](#9-review-process)
10. [Post-Publish Maintenance](#10-post-publish-maintenance)

---

## 1. Pre-submission Checklist

Complete all items before uploading the ZIP.

### Code & Build
- [ ] `npm run build` completes with **zero TypeScript errors**
- [ ] `dist/` directory is generated and complete
- [ ] All unit tests pass: `npm run test`
- [ ] All Playwright e2e tests pass: `npx playwright test`
- [ ] No hardcoded API keys, credentials, or PII in source files
- [ ] `manifest.json` version is set to `1.0.0` (or your release version)
- [ ] `manifest.json` includes `privacy_policy` URL field

### Manifest Fields Required by Chrome
```json
{
  "manifest_version": 3,
  "name": "FormBuddy",
  "version": "1.0.0",
  "description": "Fill any web form instantly using your personal documents — locally, with AI assistance and full citations.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "homepage_url": "https://your-website.com",
  "privacy_policy": "https://your-website.com/privacy"
}
```

### Permissions Audit
Review every permission listed in `manifest.json` and confirm each is actually used. Chrome reviewers will reject extensions with unused permissions.

| Permission | Why FormBuddy needs it |
|---|---|
| `storage` | Stores API keys and session state in `chrome.storage.local` |
| `activeTab` | Reads the currently active tab for field detection |
| `scripting` | Injects content script into form pages |
| `sidePanel` | Displays the suggestion feed alongside the active tab |
| `webNavigation` | Detects page navigation for multi-page form session continuity |
| `tabs` | Opens provider billing pages (Anthropic/OpenAI) from the popup |
| `contextMenus` | Adds "Add to FormBuddy folder" right-click option |
| `host_permissions: <all_urls>` | Required to inject content script on any form page |

**Do not include** any permission you cannot directly justify with user-facing functionality.

---

## 2. Developer Account Setup

### One-time Setup
1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with a Google account (use a dedicated account for the extension, not a personal account)
3. Pay the **one-time $5 registration fee** (credit/debit card required)
4. Complete identity verification if prompted

### Group Publisher (Optional)
If publishing as a team or organization:
- Go to **Dashboard → Group Publishers**
- Create a group and invite team members with appropriate roles (Owner, Developer, Viewer)
- All group members share access to the same listing

---

## 3. Build the Extension

### Production Build
```bash
npm run build
```
This produces the `dist/` directory using Vite + `@crxjs/vite-plugin`.

### Create the ZIP
```bash
cd dist && zip -r ../formbuddy-v1.0.0.zip . --exclude "*.DS_Store" --exclude ".vite/*" && cd ..
```

**Do not** include `.vite/` in the ZIP — it contains Vite's internal asset manifest which triggers a "more than one manifest.json" validation error on both stores. The ZIP must contain only the compiled `dist/` contents minus `.vite/`.

### Verify the ZIP Before Uploading
1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top-right toggle)
3. Click **Load unpacked** and select your `dist/` folder
4. Confirm the extension loads with no errors in `chrome://extensions`
5. Run through the core flow: choose folder → index a document → focus a form field → accept a suggestion

---

## 4. Required Assets

Prepare all assets before opening the store dashboard. Chrome requires specific sizes.

### Extension Icons (inside the ZIP)
Place these in `dist/icons/`:

| File | Size | Format | Usage |
|---|---|---|---|
| `icon16.png` | 16×16 px | PNG | Browser toolbar favicon |
| `icon48.png` | 48×48 px | PNG | Extension management page |
| `icon128.png` | 128×128 px | PNG | Chrome Web Store listing |

**Design tips:**
- Use a transparent background
- Ensure the icon is recognizable at 16×16 (avoid thin lines or small text)
- Keep the design consistent across all sizes

### Store Listing Images (uploaded to dashboard, not in ZIP)

| Asset | Size | Required? | Notes |
|---|---|---|---|
| **Store icon** | 128×128 px PNG | Yes | Main icon displayed in search results |
| **Screenshots** | 1280×800 or 640×400 px PNG/JPG | Yes (min 1, max 5) | Show real UI — not mockups |
| **Promotional tile (small)** | 440×280 px PNG/JPG | Recommended | Used in featured placements |
| **Promotional tile (marquee)** | 1400×560 px PNG/JPG | Optional | Used in homepage features |

#### Screenshot Suggestions for FormBuddy
Capture these screens to tell the story clearly:

1. **Side panel open with a suggestion card** — show the value, source file citation ("passport_scan.pdf, Page 1"), and reason text
2. **Folder manager view** — show a list of indexed documents with type icons
3. **Form being filled** — show a web form with a field highlighted and the suggestion tooltip visible
4. **Settings popup** — show the API key entry screen with the "Connected" green badge
5. **Multi-source suggestion** — show a suggestion that cites a specific document and page number

---

## 5. Privacy Policy

Chrome Web Store **requires** a privacy policy URL for any extension that:
- Handles personal data
- Uses remote code (LLM API calls count)
- Requests `<all_urls>` host permissions

FormBuddy handles all three. The privacy policy must be hosted at a stable URL.

### Minimum Required Content

```
FormBuddy Privacy Policy

Last updated: [Date]

1. Data Collection
FormBuddy does not collect, store, or transmit any personal data to
FormBuddy servers. No FormBuddy backend server exists.

2. Documents and Files
Documents in your context folder are read locally on your device using
the File System Access API. They are never uploaded to any server.

3. LLM API Calls
When you use AI-powered suggestions, text snippets from your documents
are sent directly from your browser to the AI provider you have chosen
(Anthropic or OpenAI). This is governed by their respective privacy
policies:
  - Anthropic: https://www.anthropic.com/privacy
  - OpenAI: https://openai.com/privacy

4. API Keys
Your API key is stored locally in Chrome's encrypted extension storage
(chrome.storage.local). It is never sent to FormBuddy or any third party
other than the provider you chose.

5. Usage Data
Session data (which fields were filled, from which document) is stored
locally in a usage.json file in your context folder on your device.
FormBuddy does not have access to this file.

6. Contact
[your contact email]
```

**Where to host it:** GitHub Pages, your own website, or a simple static page. The URL must be publicly accessible without login.

---

## 6. Store Listing Copy

### Name
```
FormBuddy — AI Form Filler
```
Maximum 45 characters. Do not use the word "Chrome" or "Extension" in the name.

### Short Description (≤132 characters)
```
Fill any web form instantly from your personal documents — locally, privately, with AI-powered suggestions and full citations.
```

### Long Description (≤16,000 characters)
```
FormBuddy is an AI-powered form-filling assistant that reads your personal
documents — passports, tax forms, insurance cards, utility bills — and
intelligently suggests the right value for every form field you click on any
website.

HOW IT WORKS

1. Point FormBuddy to a folder on your computer containing your documents
   (PDFs, images, text files)
2. FormBuddy indexes the documents locally — nothing is uploaded anywhere
3. When you click any form field on any website, FormBuddy finds the right
   answer from your documents and shows it as a suggestion
4. Accept with one click — the field fills instantly

EVERY SUGGESTION COMES WITH A CITATION

FormBuddy never guesses. Every suggestion shows you exactly where the data
came from:

  Passport Number: AB1234567
  From: passport_scan.pdf, Page 1 — "Document Number"

PRIVACY BY DESIGN

• Your documents never leave your device
• No FormBuddy backend server — the extension is entirely client-side
• API keys are stored in Chrome's encrypted local storage
• Only text snippets (not full documents) are sent to your chosen AI provider
• You control exactly which folder FormBuddy can read

BRING YOUR OWN AI KEY (BYOK)

FormBuddy uses your own API key from Anthropic (Claude) or OpenAI (GPT-4o).
This means:
• No FormBuddy subscription or monthly fee
• Pay only for what you use, directly to the AI provider
• Full transparency into your AI usage and costs

WORKS ON ANY FORM

• Tax returns (W-2, 1099, Schedule forms)
• Visa and passport applications
• Insurance claims
• Travel and hotel bookings
• Medical and government forms
• Any website with input fields

MULTI-PAGE FORM SUPPORT

FormBuddy tracks which fields you have already filled across page navigations.
On page 2 of a multi-page form, it never repeats a suggestion you already used
on page 1.

QUICK ADD

Add new information without leaving the page:
• Drag and drop files directly into the side panel
• Right-click any text on a web page → "Add to FormBuddy folder"
• Type a quick note (e.g. "My loyalty number is ABC-123") and save it
• Take a screenshot of anything on screen — it is indexed immediately

SUPPORTED DOCUMENT TYPES

• PDF (text-based and scanned)
• PNG, JPG (passport scans, insurance cards)
• Text notes

SUPPORTED AI PROVIDERS

• Anthropic Claude (claude-sonnet, claude-haiku)
• OpenAI (GPT-4o, GPT-4o mini)
```

### Category
**Productivity**

### Language
**English**

### Tags / Keywords (used internally, not shown to users)
```
form filler, autofill, AI assistant, document reader, productivity,
PDF reader, form automation, personal assistant
```

---

## 7. Submitting to the Chrome Web Store Dashboard

### Step-by-Step

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

2. Click **New Item**

3. **Upload the ZIP**
   - Drag and drop `formbuddy-v1.0.0.zip` or click to browse
   - Wait for it to validate — the dashboard will flag any manifest errors immediately
   - Fix any reported errors before continuing

4. **Store Listing tab**
   - Fill in: Name, Short Description, Long Description
   - Upload Store Icon (128×128)
   - Upload Screenshots (minimum 1, recommended 3–5)
   - Upload Promotional Tile if available
   - Set Category: Productivity
   - Set Language: English

5. **Privacy Practices tab**
   - Enter your Privacy Policy URL
   - Answer each data collection question honestly:
     - "Does your extension collect personally identifiable information?" → No (data stays local)
     - "Does your extension use remote code?" → Yes (LLM API calls)
     - Complete the data usage disclosure table (Chrome will prompt you for each permission)

6. **Distribution tab**
   - Visibility: **Public** (for a public launch) or **Unlisted** (for beta testing)
   - Countries: All regions (or restrict if needed)
   - Pricing: Free

7. Click **Submit for Review**

### Justification Text for Sensitive Permissions

The dashboard requires written justification for certain permissions. Use these:

**`host_permissions: <all_urls>`**
> FormBuddy injects a content script into any webpage the user visits in order to detect focused form fields and display inline suggestion tooltips. The extension cannot function on arbitrary form pages without broad host permissions. The content script only reads field labels and fills field values — it does not read, store, or transmit any other page content.

**`scripting`**
> Required to programmatically inject the content script that detects form fields and applies autofill values when the user accepts a suggestion.

**`webNavigation`**
> Required to detect when the user navigates between pages of a multi-page form so that the session context (including previously used suggestions) is preserved across page loads within the same domain.

---

## 8. Submitting to Microsoft Edge Add-ons

The same `formbuddy-v1.0.0.zip` built for Chrome works on Edge without modification. Manifest V3 is supported on Edge 121+ and the `sidePanel` API is available on Edge 125+.

### One-time Account Setup

1. Go to [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. Sign in with a Microsoft account (personal or work/school account)
3. Registration is **free** — no fee unlike Chrome Web Store
4. Accept the Microsoft Edge Add-ons developer agreement

### Submitting Your Extension

1. Click **Create new extension** in the Partner Center dashboard

2. **Upload the package**
   - Upload `formbuddy-v1.0.0.zip` — the same ZIP used for Chrome
   - Partner Center will validate the manifest automatically

3. **Store listings tab**
   - Language: English
   - Name: `FormBuddy — AI Form Filler`
   - Short description (≤250 characters): use the same short description from section 6
   - Long description: use the same long description from section 6
   - Category: **Productivity**
   - Upload the same icons and screenshots prepared for Chrome

4. **Availability tab**
   - Visibility: **Public** or **Hidden** (for staged rollout)
   - Markets: All markets, or restrict as needed

5. **Properties tab**
   - Privacy policy URL: `https://venkateshpoosarla.github.io/FormBuddy/privacy.html`
   - Website URL: `https://venkateshpoosarla.github.io/FormBuddy/`
   - Support URL: your GitHub Issues page

6. **Privacy practices tab**
   - Does the extension collect personal data? → **No**
   - Does it send data to a remote server? → **Yes** (LLM API calls go directly to Anthropic/OpenAI/Google — not to FormBuddy)
   - Explain data usage honestly; Partner Center will not approve vague descriptions

7. Click **Publish** to submit for review

### Key Differences from Chrome Web Store

| Item | Chrome Web Store | Edge Add-ons |
|---|---|---|
| Registration fee | $5 one-time | Free |
| Dashboard URL | chrome.google.com/webstore/devconsole | partner.microsoft.com/dashboard/microsoftedge |
| Review time | 1–3 business days | 1–7 business days |
| Screenshot sizes | 1280×800 or 640×400 | 1280×800 recommended |
| Required permissions justification | In dashboard UI | In dashboard UI (similar flow) |
| Developer mode URL | `chrome://extensions` | `edge://extensions` |

### Verify Before Submitting on Edge

1. Open `edge://extensions`
2. Enable **Developer mode** (left sidebar toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Confirm the extension loads, the side panel opens, and the form-fill flow works end-to-end

---

## 9. Review Process

### Timeline
- Initial review typically takes **1–3 business days** for a new submission
- Updates to existing extensions are usually reviewed within **a few hours to 2 days**
- Extensions with sensitive permissions (like `<all_urls>`) may receive additional scrutiny

### Common Rejection Reasons and Fixes

| Rejection Reason | Fix |
|---|---|
| Unused permissions in manifest | Remove any permission not actively used in code |
| Missing privacy policy | Host a policy page and add its URL to the manifest and dashboard |
| Screenshots show mockups, not real UI | Replace with actual screenshots of the running extension |
| Short description exceeds 132 characters | Trim to fit |
| Remote code execution detected | Ensure no `eval()` or dynamic `Function()` calls exist |
| `<all_urls>` not justified | Add detailed justification in the dashboard permissions tab |
| Extension name contains "Chrome" | Rename to remove the word |
| Deceptive functionality | Ensure all described features actually work |

### If Rejected
1. Read the rejection email carefully — Chrome provides specific reasons
2. Make the required changes to code or store listing
3. Re-submit from the same dashboard item (do not create a new item)
4. Your item retains its listing ID across re-submissions

---

## 10. Post-Publish Maintenance

### Releasing Updates

1. Make your code changes and bump the version in `manifest.json`:
   ```json
   "version": "1.0.1"
   ```
2. Run `npm run build`
3. Create a new ZIP: `cd dist && zip -r ../formbuddy-v1.0.1.zip . && cd ..`
4. Go to the dashboard, open your listing, click **Package** → **Upload new package**
5. Upload the new ZIP and submit for review
6. Existing users will be automatically updated within 24–48 hours after approval

### Version Numbering
Follow [Semantic Versioning](https://semver.org/):
- `1.0.0` — initial release
- `1.0.1` — bug fixes
- `1.1.0` — new features (backward compatible)
- `2.0.0` — breaking changes

Chrome extension versions must be numeric only (e.g. `1.0.0`, not `1.0.0-beta`).

### Monitoring

- **Chrome Web Store Reviews**: Check the dashboard weekly. Respond to user reviews professionally.
- **Error Monitoring**: Consider adding an error reporting mechanism (without sending personal data) to detect crashes in the wild.
- **Permission Changes**: If you add a new permission in an update, users are prompted to re-approve. Minimize new permissions to avoid churn.

### User Support
- Add a **Support URL** in the dashboard pointing to a GitHub Issues page or a support email
- Respond to 1-star reviews with helpful guidance — this influences store ranking

---

## Quick Reference: Asset Sizes

| Asset | Size | Format |
|---|---|---|
| Extension icon (in ZIP) | 16, 48, 128 px | PNG |
| Store icon (dashboard) | 128×128 px | PNG |
| Screenshots (dashboard) | 1280×800 or 640×400 px | PNG or JPG |
| Small promo tile | 440×280 px | PNG or JPG |
| Marquee promo tile | 1400×560 px | PNG or JPG |

---

## Quick Reference: Required URLs

| Item | Where it goes |
|---|---|
| Privacy Policy URL | `manifest.json` → `"privacy_policy"` field AND dashboard Privacy tab |
| Support URL | Dashboard → Store Listing → Support URL |
| Homepage URL | `manifest.json` → `"homepage_url"` AND dashboard listing |
