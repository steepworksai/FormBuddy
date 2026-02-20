import type { DocumentIndex } from '../../types'

export interface QueryCandidate {
  documentId: string
  fileName: string
  sourcePage?: number
  sourceText: string
  score: number
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'at', 'is', 'are',
  'my', 'your', 'their', 'this', 'that', 'with', 'from', 'by', 'as', 'be',
])

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !STOP_WORDS.has(token))
}

function scoreText(text: string, tokens: string[]): number {
  if (!tokens.length) return 0
  const haystack = text.toLowerCase()
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0)
}

function getEntityBucketsForTokens(tokens: string[]): string[] {
  const buckets = new Set<string>()

  if (tokens.some(t => ['passport', 'ssn', 'social', 'ein', 'identifier', 'id', 'license', 'policy'].includes(t))) {
    buckets.add('identifiers')
  }
  if (tokens.some(t => ['name', 'first', 'last', 'applicant'].includes(t))) {
    buckets.add('names')
  }
  if (tokens.some(t => ['address', 'street', 'city', 'state', 'zip', 'postal'].includes(t))) {
    buckets.add('addresses')
  }
  if (tokens.some(t => ['date', 'dob', 'birth'].includes(t))) {
    buckets.add('dates')
  }
  if (tokens.some(t => ['employer', 'company'].includes(t))) {
    buckets.add('employers')
  }
  if (tokens.some(t => ['income', 'wage', 'salary', 'amount', 'tax', 'price', 'cost'].includes(t))) {
    buckets.add('currencies')
  }
  if (tokens.some(t => ['number', 'reference', 'confirmation', 'account'].includes(t))) {
    buckets.add('numbers')
  }

  return [...buckets]
}

function makeSnippet(text: string, tokens: string[], maxLen = 220): string {
  const lower = text.toLowerCase()
  const firstToken = tokens.find(t => lower.includes(t))
  if (!firstToken) return text.slice(0, maxLen)

  const hit = lower.indexOf(firstToken)
  const start = Math.max(0, hit - 90)
  const end = Math.min(text.length, hit + 130)
  return text.slice(start, end).trim()
}

export function queryIndex(
  fieldLabel: string,
  entries: DocumentIndex[],
  maxCandidates = 5
): QueryCandidate[] {
  const tokens = tokenize(fieldLabel)
  if (!tokens.length) return []

  const candidates: QueryCandidate[] = []

  for (const entry of entries) {
    // 1) Entity-first lookup
    const buckets = getEntityBucketsForTokens(tokens)
    for (const bucket of buckets) {
      const values = entry.entities[bucket] ?? []
      for (const value of values) {
        const score = scoreText(value, tokens) + 2
        if (score <= 2) continue

        candidates.push({
          documentId: entry.id,
          fileName: entry.fileName,
          sourcePage: 1,
          sourceText: value,
          score,
        })
      }
    }

    // 2) Raw text fallback lookup
    for (const page of entry.pages) {
      const textScore = scoreText(page.rawText, tokens)
      if (textScore === 0) continue

      candidates.push({
        documentId: entry.id,
        fileName: entry.fileName,
        sourcePage: page.page,
        sourceText: makeSnippet(page.rawText, tokens),
        score: textScore,
      })
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
}
