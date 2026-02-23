# FormBuddy — .indexing Folder System Design

## Overview

When a user adds any document (PDF, image, screenshot, text note) to their context folder,
FormBuddy automatically creates and maintains a `.indexing` folder alongside it. This folder
acts as a local structured database — storing pre-extracted text, field entities, metadata,
and usage history so documents never need to be re-parsed from scratch.

---

## Folder Structure

```
📁 User's Context Folder/
├── W2_2025.pdf
├── passport_scan.pdf
├── insurance_card.png
├── flight_confirmation.txt
├── screenshot-2026-02-19.png
│
└── 📁 .indexing/
    ├── manifest.json              ← Master registry of all indexed documents
    ├── <uuid-1>.json              ← Index entry for W2_2025.pdf
    ├── <uuid-2>.json              ← Index entry for passport_scan.pdf
    ├── <uuid-3>.json              ← Index entry for insurance_card.png
    ├── <uuid-4>.json              ← Index entry for flight_confirmation.txt
    ├── <uuid-5>.json              ← Index entry for screenshot-2026-02-19.png
    └── usage.json                 ← Cross-session usage history
```

---

## File Specifications

### 1. manifest.json — Master Registry

The manifest is the entry point. It maps every document in the folder to its index file
and stores lightweight metadata so the extension can quickly check if a file is already
indexed or has changed since last indexing.

```json
{
  "version": "1.0",
  "createdAt": "2026-02-19T10:00:00Z",
  "lastUpdated": "2026-02-19T14:32:00Z",
  "documents": [
    {
      "id": "a1b2c3d4-...",
      "fileName": "W2_2025.pdf",
      "type": "pdf",
      "indexFile": "a1b2c3d4-....json",
      "checksum": "md5:e4d909c290d0fb1ca068ffaddf22cbd0",
      "sizeBytes": 204800,
      "indexedAt": "2026-02-19T10:05:00Z",
      "language": "en",
      "needsReindex": false
    },
    {
      "id": "b2c3d4e5-...",
      "fileName": "passport_scan.pdf",
      "type": "pdf",
      "indexFile": "b2c3d4e5-....json",
      "checksum": "md5:abc123...",
      "sizeBytes": 512000,
      "indexedAt": "2026-02-19T10:06:00Z",
      "language": "en",
      "needsReindex": false
    }
  ]
}
```

**Key field: `checksum`** — Every time the extension starts, it computes an MD5 of each
file in the folder and compares it to the stored checksum. If they differ, `needsReindex`
is set to `true` and the document is re-parsed automatically. This means the index always
stays in sync without manual intervention.

---

### 2. <uuid>.json — Per-Document Index Entry

Each document gets its own structured JSON file. This is the core of the database —
it stores everything the extension needs to answer field suggestions without ever
re-opening the original file.

```json
{
  "id": "a1b2c3d4-...",
  "fileName": "W2_2025.pdf",
  "type": "pdf",
  "indexedAt": "2026-02-19T10:05:00Z",
  "language": "en",
  "pageCount": 2,

  "pages": [
    {
      "page": 1,
      "rawText": "Employee's social security number 123-45-6789 Employer identification number 12-3456789 Wages, tips, other compensation 74250.00 Federal income tax withheld 8900.00 ...",
      "fields": [
        {
          "label": "Employee's social security number",
          "value": "123-45-6789",
          "confidence": "high",
          "boundingContext": "Employee's social security number 123-45-6789"
        },
        {
          "label": "Wages, tips, other compensation",
          "value": "74250.00",
          "confidence": "high",
          "boundingContext": "Wages, tips, other compensation 74250.00"
        },
        {
          "label": "Federal income tax withheld",
          "value": "8900.00",
          "confidence": "high",
          "boundingContext": "Federal income tax withheld 8900.00"
        }
      ]
    },
    {
      "page": 2,
      "rawText": "...",
      "fields": []
    }
  ],

  "entities": {
    "numbers": ["123-45-6789", "12-3456789", "74250.00", "8900.00"],
    "dates": ["2025"],
    "names": ["John Doe"],
    "addresses": ["123 Main St, Austin TX 78701"],
    "employers": ["Acme Corporation"],
    "currencies": ["74250.00", "8900.00"],
    "identifiers": ["123-45-6789", "12-3456789"]
  },

  "summary": "W-2 tax form for John Doe from Acme Corporation for tax year 2025. Wages: $74,250. Federal tax withheld: $8,900.",

  "usedFields": []
}
```

**The `entities` block** is a pre-extracted lookup table. When the extension gets a field
label like "Social Security Number", it can search `entities.identifiers` directly instead
of sending the entire raw text to the LLM — saving tokens and reducing latency significantly.

**The `usedFields` array** tracks which specific fields from this document have been
used in autofill, updated in real time as the user fills forms:

```json
"usedFields": [
  {
    "fieldLabel": "Wages, tips, other compensation",
    "value": "74250.00",
    "usedOn": "turbotax.intuit.com",
    "formPage": "Income Entry",
    "usedAt": "2026-02-19T14:30:00Z",
    "sessionId": "sess-xyz-..."
  }
]
```

---

### 3. usage.json — Cross-Session Usage History

Tracks all accepted suggestions across all sessions and all forms. This is the long-term
memory of the extension — useful for auditing, reviewing, and eventually training
personalized suggestions.

```json
{
  "sessions": [
    {
      "sessionId": "sess-xyz-...",
      "domain": "turbotax.intuit.com",
      "startedAt": "2026-02-19T14:00:00Z",
      "endedAt": "2026-02-19T15:30:00Z",
      "formName": "Federal Tax Return 2025",
      "usedSuggestions": [
        {
          "fieldLabel": "Wages, tips, other compensation",
          "value": "74250.00",
          "sourceFile": "W2_2025.pdf",
          "sourcePage": 1,
          "sourceText": "Wages, tips, other compensation 74250.00",
          "reason": "Found under 'Box 1' on your W-2 from Acme Corporation",
          "confidence": "high",
          "usedAt": "2026-02-19T14:30:00Z"
        }
      ]
    }
  ]
}
```

---

## Indexing Trigger Logic

```
Document added to folder
        ↓
Extension detects new file via File System Access API watcher
        ↓
Compute MD5 checksum of file
        ↓
Check manifest.json:
  → File not in manifest?     → Index it (full parse)
  → File in manifest but checksum differs? → Re-index it
  → File in manifest, checksum matches?    → Skip (already indexed)
        ↓
Parse document (pdfjs-dist + Tesseract fallback)
        ↓
LLM extracts structured fields and entities from raw text
        ↓
Write <uuid>.json to .indexing/
        ↓
Update manifest.json with new entry
```

This means indexing only ever happens once per document (or when the file changes),
not on every extension start or form visit.

---

## TypeScript Implementation

### Indexer Core

```typescript
// src/lib/indexing/indexer.ts

import { v4 as uuidv4 } from 'uuid';
import { extractTextFromPDF } from '../parser/pdf';
import { extractTextFromImage } from '../parser/ocr';
import { cleanTextWithLLM } from '../llm/extractor';
import { computeChecksum } from './checksum';
import { readManifest, writeManifest } from './manifest';
import { DocumentIndex, ManifestEntry } from '../../types/indexing';

export async function indexDocument(
  file: File,
  dirHandle: FileSystemDirectoryHandle
): Promise<DocumentIndex> {

  const manifest = await readManifest(dirHandle);
  const checksum = await computeChecksum(file);

  // Check if already indexed and unchanged
  const existing = manifest.documents.find(d => d.fileName === file.name);
  if (existing && existing.checksum === checksum && !existing.needsReindex) {
    return await readIndexEntry(dirHandle, existing.indexFile);
  }

  // Parse document
  const ext = file.name.split('.').pop()?.toLowerCase();
  let rawText = '';

  if (ext === 'pdf') {
    rawText = await extractTextFromPDF(file);
    if (rawText.trim().length < 50) {
      rawText = await extractTextFromImage(file); // OCR fallback
    }
  } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) {
    rawText = await extractTextFromImage(file);
  } else if (ext === 'txt') {
    rawText = await file.text();
  }

  // LLM cleans and de-noises raw text (Phase 2 — Cleanup)
  const cleanText = await cleanTextWithLLM(rawText, file.name);

  const id = existing?.id ?? uuidv4();
  const indexEntry: DocumentIndex = {
    id,
    fileName: file.name,
    type: ext === 'pdf' ? 'pdf' : ext === 'txt' ? 'text' : 'image',
    indexedAt: new Date().toISOString(),
    language: 'en',
    pageCount: pages.length,
    pages,
    entities,
    summary,
    usedFields: existing ? (await readIndexEntry(dirHandle, `${id}.json`)).usedFields : [],
  };

  // Write index entry
  await writeIndexEntry(dirHandle, `${id}.json`, indexEntry);

  // Update manifest
  const manifestEntry: ManifestEntry = {
    id,
    fileName: file.name,
    type: indexEntry.type,
    indexFile: `${id}.json`,
    checksum,
    sizeBytes: file.size,
    indexedAt: new Date().toISOString(),
    language: 'en',
    needsReindex: false,
  };

  const updatedManifest = {
    ...manifest,
    lastUpdated: new Date().toISOString(),
    documents: [
      ...manifest.documents.filter(d => d.fileName !== file.name),
      manifestEntry,
    ],
  };

  await writeManifest(dirHandle, updatedManifest);
  return indexEntry;
}
```

### Manifest Read/Write

```typescript
// src/lib/indexing/manifest.ts

import { Manifest } from '../../types/indexing';

const INDEXING_FOLDER = '.indexing';
const MANIFEST_FILE = 'manifest.json';

export async function readManifest(
  dirHandle: FileSystemDirectoryHandle
): Promise<Manifest> {
  try {
    const indexingDir = await dirHandle.getDirectoryHandle(INDEXING_FOLDER, { create: true });
    const fileHandle = await indexingDir.getFileHandle(MANIFEST_FILE, { create: true });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text ? JSON.parse(text) : { version: '1.0', createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), documents: [] };
  } catch {
    return { version: '1.0', createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), documents: [] };
  }
}

export async function writeManifest(
  dirHandle: FileSystemDirectoryHandle,
  manifest: Manifest
): Promise<void> {
  const indexingDir = await dirHandle.getDirectoryHandle(INDEXING_FOLDER, { create: true });
  const fileHandle = await indexingDir.getFileHandle(MANIFEST_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(manifest, null, 2));
  await writable.close();
}
```

### Checksum Utility

```typescript
// src/lib/indexing/checksum.ts

export async function computeChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

---

## Querying the Index

Instead of sending full document text to the LLM on every field focus, the extension
now queries the index first:

```typescript
// src/lib/indexing/query.ts

export async function queryIndex(
  fieldLabel: string,
  dirHandle: FileSystemDirectoryHandle
): Promise<IndexQueryResult[]> {

  const manifest = await readManifest(dirHandle);
  const results: IndexQueryResult[] = [];

  for (const entry of manifest.documents) {
    const index = await readIndexEntry(dirHandle, entry.indexFile);

    // Skip fields already used from this document
    const unusedFields = index.pages
      .flatMap(p => p.fields)
      .filter(f => !index.usedFields.some(u => u.fieldLabel === f.label));

    // Simple keyword match first (fast)
    const candidates = unusedFields.filter(f =>
      fieldLabel.toLowerCase().includes(f.label.toLowerCase()) ||
      f.label.toLowerCase().includes(fieldLabel.toLowerCase())
    );

    if (candidates.length > 0) {
      results.push({
        documentId: index.id,
        fileName: index.fileName,
        candidates,
        summary: index.summary,
      });
    }
  }

  return results;
}
```

This pre-filters candidates from the index before any LLM call — the LLM only gets
the relevant snippets, not the entire document corpus.

---

## Supported Database Backends

The indexing system is designed with a pluggable backend interface so users can
choose their preferred storage format:

### Option 1: JSON Files (Default)
- Human-readable, no dependencies
- Works entirely via the File System Access API
- Best for most users — easy to inspect and back up
- Stored in `.indexing/*.json`

### Option 2: SQLite via sql.js
For power users who want relational querying across documents:

```bash
npm install sql.js
```

```typescript
// Single SQLite file: .indexing/formbuddy.db
// Tables: documents, pages, fields, entities, usage

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  file_name TEXT,
  type TEXT,
  checksum TEXT,
  indexed_at TEXT,
  summary TEXT
);

CREATE TABLE fields (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  page INTEGER,
  label TEXT,
  value TEXT,
  confidence TEXT,
  used_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  entity_type TEXT,   -- 'number', 'date', 'name', 'address', etc.
  value TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

SQLite allows queries like:
```sql
-- Find all unused currency values across all documents
SELECT f.value, d.file_name, f.label
FROM fields f
JOIN documents d ON f.document_id = d.id
WHERE f.used_at IS NULL
AND d.id IN (SELECT document_id FROM entities WHERE entity_type = 'currency');
```

### Option 3: IndexedDB (Browser Native)
- No file system dependency
- Survives browser restarts natively
- Best for fast reads during active form filling
- Can be used alongside JSON files as a runtime cache

```typescript
const db = await openDB('formbuddy', 1, {
  upgrade(db) {
    db.createObjectStore('documents', { keyPath: 'id' });
    db.createObjectStore('fields', { keyPath: 'id' });
    db.createObjectStore('usage', { keyPath: 'sessionId' });
  },
});
```

### Comparison Table

| Feature | JSON Files | SQLite | IndexedDB |
|---|---|---|---|
| Human readable | ✅ Yes | ❌ No | ❌ No |
| Complex queries | ❌ No | ✅ Yes | ⚠️ Limited |
| Browser native | ✅ Yes | ⚠️ Via sql.js | ✅ Yes |
| Persists on disk | ✅ Yes | ✅ Yes | ❌ No (browser only) |
| Dependencies | None | sql.js | None |
| Best for | Default users | Power users | Runtime cache |

**Recommended approach:** JSON files as the primary on-disk store (default),
with IndexedDB as a runtime cache for fast lookups during active form sessions.
SQLite as an optional advanced mode for users who want to query their document
history directly.

---

## Information → Document Mapping

The manifest provides a reverse lookup — given a piece of information, find which
document it came from:

```typescript
// Example: find which document contains a given value
export async function findDocumentByValue(
  value: string,
  dirHandle: FileSystemDirectoryHandle
): Promise<ManifestEntry | null> {
  const manifest = await readManifest(dirHandle);

  for (const entry of manifest.documents) {
    const index = await readIndexEntry(dirHandle, entry.indexFile);
    const match = index.pages
      .flatMap(p => p.fields)
      .find(f => f.value === value);

    if (match) return entry;
  }

  return null;
}
```

This powers the "why" citation — when the extension suggests a value,
it can instantly tell the user exactly which document and which field it came from.

---

## .indexing Folder Lifecycle

| Event | Action |
|---|---|
| User selects context folder for first time | `.indexing/` created, `manifest.json` initialized |
| New file added to folder | File detected, indexed, `manifest.json` updated |
| Existing file modified | Checksum mismatch detected, file re-indexed |
| File deleted from folder | Entry removed from `manifest.json`, index file deleted |
| User accepts a suggestion | `usedFields` updated in document's index entry, `usage.json` updated |
| User resets session | Session cleared from `usage.json`, `usedFields` cleared for that session only |
| Extension reinstalled | `.indexing/` folder already exists — full history restored automatically |
