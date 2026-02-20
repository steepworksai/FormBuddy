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

// ── Indexing types ──────────────────────────────────────────

export interface FieldEntry {
  label: string;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  boundingContext: string;
}

export interface PageEntry {
  page: number;
  rawText: string;
  fields: FieldEntry[];
}

export interface UsedField {
  fieldLabel: string;
  value: string;
  usedOn: string;
  usedAt: string;
  sessionId: string;
}

export interface DocumentIndex {
  id: string;
  fileName: string;
  type: 'pdf' | 'image' | 'text' | 'screenshot';
  indexedAt: string;
  language: string;
  pageCount: number;
  pages: PageEntry[];
  entities: Record<string, string[]>;
  summary: string;
  usedFields: UsedField[];
}

export interface ManifestEntry {
  id: string;
  fileName: string;
  type: string;
  indexFile: string;
  checksum: string;
  sizeBytes: number;
  indexedAt: string;
  language: string;
  needsReindex: boolean;
}

export interface Manifest {
  version: string;
  createdAt: string;
  lastUpdated: string;
  documents: ManifestEntry[];
}
