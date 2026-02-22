# FormBuddy — System Flow Diagrams

---

## 1. Overall System Architecture

The `.indexing` folder is the core local database of the entire app. Every read, write, and suggestion flows through it. Nothing is stored on any server.

```mermaid
flowchart TD
    subgraph Computer["User's Computer - Everything stays here"]

        subgraph CF["Context Folder - Source Documents"]
            PDFs["PDFs"]
            IMGS["Images and Screenshots"]
            NOTES["Text Notes"]
        end

        subgraph DB[".indexing - Local Database"]
            MF[("manifest.json\nDocument Registry\nfileName, checksum, indexFile, needsReindex")]
            UI[("uuid.json per document\nExtracted Fields, Entities\nPage Text, Summary, usedFields")]
            UL[("usage.json\nSession History\nAll accepted suggestions across all forms")]
        end

        CF -->|"New or modified file triggers indexing"| DB
        DB -->|"Checksum check prevents re-indexing unchanged files"| CF
    end

    subgraph Extension["FormBuddy Chrome Extension"]
        SP["Side Panel UI\nSuggestions, Folder Manager, Settings"]
        CS["Content Script\nField Detection and Autofill"]
        BW["Background Service Worker\nDB Queries, LLM Calls, Session State"]
    end

    subgraph Providers["LLM Providers - BYOK"]
        AN["Anthropic Claude"]
        OA["OpenAI GPT"]
    end

    subgraph Browser["Active Browser Tab"]
        WF["Web Form\nTax, Visa, Travel, Insurance, Medical"]
    end

    DB -->|"Read fields and entities for suggestion lookup"| BW
    BW -->|"Write usedFields and session log after autofill"| DB
    BW -->|"Write new index entry after parsing"| DB

    CS -->|"FIELD_FOCUSED event with label"| BW
    BW -->|"Suggestion with value, citation, reason"| SP
    SP -->|"User accepts suggestion"| BW
    BW -->|"AUTOFILL_FIELD command"| CS
    CS -->|"Set field value and dispatch events"| WF
    WF -->|"User focuses a field"| CS

    BW -->|"API call with matched snippet only"| AN
    BW -->|"API call with matched snippet only"| OA
    AN -->|"value, sourceText, reason, confidence"| BW
    OA -->|"value, sourceText, reason, confidence"| BW

    SP -->|"Add file, screenshot, or note"| CF
```

---

## 2. Document Indexing Flow

Triggered automatically whenever a file is added or modified in the context folder.

```mermaid
flowchart TD
    A["New file detected in Context Folder"] --> B["Compute SHA-256 checksum"]
    B --> C{"Check manifest.json"}

    C -->|"Not in manifest"| D["Begin indexing"]
    C -->|"Checksum unchanged"| E["Skip - already up to date"]
    C -->|"Checksum changed"| D

    D --> F{"What file type?"}
    F -->|"PDF"| G["pdfjs-dist extracts text per page"]
    F -->|"Scanned PDF or Image"| H["Tesseract.js OCR"]
    F -->|"Text or Note"| I["Read as plain text"]

    G --> J{"Extracted text long enough?"}
    J -->|"No - likely a scanned PDF"| H
    J -->|"Yes"| K["Send text to LLM"]
    H --> K
    I --> K

    K --> L["LLM extracts structured fields and entities\nnumbers, dates, names, addresses, currencies"]
    L --> M["Build per-page field list with labels and values"]
    M --> N["Generate plain-English summary of document"]
    N --> O["Write uuid.json to .indexing folder"]
    O --> P["Update manifest.json with checksum and metadata"]
    P --> Q["Document is ready for field suggestions"]
```

---

## 3. Form Field Suggestion Flow

Triggered every time the user focuses a field on any web form.

```mermaid
flowchart TD
    A["User clicks into a form field"] --> B["Content Script fires on focusin event"]
    B --> C["Extract field label from DOM\naria-label, label tag, placeholder, parent text"]
    C --> D["Send FIELD_FOCUSED message to Background Worker"]
    D --> E{"Already used this field\nin current session?"}

    E -->|"Yes"| F["Silently skip - no suggestion"]
    E -->|"No"| G["Query .indexing manifest"]

    G --> H["Search entity index for keyword match\nagainst field label"]
    H --> I{"Any candidates found\nin unused fields?"}

    I -->|"No match"| J["No suggestion shown to user"]
    I -->|"Match found"| K["Extract matched snippet from uuid.json"]

    K --> L["Send field label plus snippet to LLM"]
    L --> M["LLM returns structured response\nvalue, sourceFile, sourcePage, sourceText, reason, confidence"]

    M --> N["Push suggestion to Side Panel"]
    N --> O["Side Panel renders suggestion card\nwith value, source file, page, reason and confidence badge"]

    O --> P{"User decision"}
    P -->|"Accept"| Q["Background Worker sends AUTOFILL_FIELD to Content Script"]
    P -->|"Dismiss"| R["Suggestion stays in pool\nfor potential reuse on other fields"]
    P -->|"Reject"| S["Suggestion permanently removed\nfrom pool for this session"]

    Q --> T["Content Script sets input.value"]
    T --> U["Dispatch input and change events\nso the form registers the change"]
    U --> V["Mark field as used in uuid.json usedFields"]
    V --> W["Append to usage.json session log"]
```

---

## 4. Multi-Page Form and Redirect Flow

Ensures the session and used-suggestion state survive across page navigations.

```mermaid
flowchart TD
    A["User starts filling Page 1 of a form"] --> B["Extension creates new session ID"]
    B --> C["Content Script detects and fills fields on Page 1"]
    C --> D["Used fields logged to session state in Background Worker"]
    D --> E["User clicks Next - browser redirects to Page 2"]

    E --> F["chrome.webNavigation.onCompleted fires in Background Worker"]
    F --> G{"Is new URL on the same domain?"}

    G -->|"Different domain - unrelated site"| H["End current session"]
    H --> I["Clear used-suggestion state"]
    I --> J["Ready for a new session on the new site"]

    G -->|"Same domain - form continues"| K["Session remains active"]
    K --> L["All used fields from Page 1 stay marked"]
    L --> M["Content Script re-injects on Page 2"]
    M --> N["Scans new page fields immediately"]
    N --> O["Queues suggestions for fields not yet filled"]
    O --> P["Side Panel updates with Page 2 suggestions"]
    P --> Q["Process repeats for every subsequent page"]
    Q --> R["Full audit trail in usage.json\nspanning all pages"]
```

---

## 5. Screenshot Capture Flow

Triggered by hotkey or Side Panel button to capture on-screen information.

```mermaid
flowchart TD
    A["User triggers screenshot capture"] --> B{"How was it triggered?"}
    B -->|"Hotkey Cmd+Shift+S or Ctrl+Shift+S"| C["Content Script catches keyboard event"]
    B -->|"Side Panel button"| D["Side Panel sends capture request"]

    C --> E["Call chrome.tabs.captureVisibleTab"]
    D --> E

    E --> F["Chrome returns PNG as base64 data URL"]
    F --> G["Convert to File object with timestamp filename\nscreenshot-2026-02-19-1432.png"]
    G --> H["Save file to Context Folder via File System Access API"]
    H --> I["Trigger indexing pipeline on new file"]

    I --> J["Tesseract.js runs OCR on the image"]
    J --> K["LLM extracts entities and field values from OCR text"]
    K --> L["Write to .indexing as screenshot entry"]
    L --> M["Available immediately for field suggestions"]
    M --> N["Citation shown as: Screenshot captured Feb 19 2026 at 2:32 PM"]
```

---

## 6. BYOK API Key Setup Flow

How the user connects their LLM provider. No payment data ever passes through FormBuddy.

```mermaid
flowchart TD
    A["User opens FormBuddy Settings popup"] --> B["Clicks Connect AI Provider"]
    B --> C{"Which provider?"}

    C -->|"Anthropic Claude"| D["Open console.anthropic.com in new tab"]
    C -->|"OpenAI GPT"| E["Open platform.openai.com in new tab"]

    D --> F["User creates account on provider platform"]
    E --> F

    F --> G["User adds credits directly with provider\nNo payment info touches FormBuddy"]
    G --> H["User generates API key on provider dashboard"]
    H --> I["User copies API key"]
    I --> J["User pastes key into FormBuddy Settings"]
    J --> K["Extension sends lightweight test API call\nto verify the key works"]

    K --> L{"Key valid?"}
    L -->|"Invalid"| M["Show error message\nAsk user to check and re-enter"]
    M --> J
    L -->|"Valid"| N["Encrypt key and store in chrome.storage.local\nsandboxed to this extension only"]

---

## 7. End-to-End Sequence Diagram (Current Flow)

```mermaid
sequenceDiagram
    autonumber
    participant U as "User"
    participant SP as "SidePanel UI"
    participant BG as "Background Worker"
    participant CS as "Content Script"
    participant IDX as ".indexing Store"
    participant LLM as "LLM Provider (Claude/OpenAI/Gemini)"
    participant TAB as "Active Web Form Tab"

    U->>SP: Choose folder / change folder
    SP->>IDX: Read files + manifest
    loop "Per file"
        SP->>BG: Index request (via indexer pipeline)
        BG->>IDX: Read checksum / previous entries
        alt "Changed or new file"
            BG->>BG: Parse PDF or OCR/image extraction
            alt "API key present"
                BG->>LLM: Search-index + extraction prompts
                LLM-->>BG: Structured fields/autofill/entities
            end
            BG->>IDX: Write document index + search index + manifest
        else "Unchanged"
            BG-->>SP: Skip indexing
        end
    end
    SP->>BG: CONTEXT_UPDATED (selected docs only)

    U->>TAB: Open a webpage form
    TAB->>CS: Page loads
    CS->>BG: FORM_SCHEMA (best-effort snapshot)

    U->>SP: Paste field list in "Fields From Doc"
    U->>SP: Click "Fetch Fields From Doc"
    SP->>BG: MANUAL_FIELD_FETCH {fields[]}

    alt "API key present"
        BG->>BG: Build docs payload (search index + parsed fallback)
        BG->>LLM: One bulk mapping call for requested fields
        LLM-->>BG: Field-value mappings + confidence
    else "No API key"
        BG->>BG: Local deterministic matching only
    end

    BG->>BG: Fill unmatched items via local fallback
    BG-->>SP: Fetch response {results[], reason?}
    SP-->>U: Render result cards with Copy buttons

    U->>SP: Click Copy
    SP-->>U: Value copied to clipboard

    opt "Optional hover/focus autofill flow"
        U->>TAB: Focus form field
        CS->>BG: FIELD_FOCUSED
        BG->>IDX: Query indexed context
        BG->>LLM: Suggestion ranking (if API key)
        LLM-->>BG: Suggested value
        BG-->>CS: NEW_SUGGESTION
        CS-->>U: Top overlay suggestion (Fill / Dismiss / Space copy)
        U->>CS: Fill
        CS->>TAB: Set input value + dispatch events
        CS->>BG: SUGGESTION_ACCEPTED
        BG->>IDX: Update usage state
    end
```

    N --> O["Extension is ready to make LLM calls"]
    O --> P["User controls spending via provider dashboard"]
    P --> Q["FormBuddy never sees billing or payment details"]
```
