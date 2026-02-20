import type { DocumentIndex, FormKVMapping, LLMConfig, Suggestion } from '../types'
import { queryIndex } from '../lib/indexing/query'
import { generateSuggestionWithLLM } from '../lib/llm/suggestion'
import { buildFormAutofillMapWithLLM } from '../lib/llm/formMapper'

// FormBuddy — Background Service Worker

// Open the side panel when the toolbar icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FormBuddy] Extension installed.')
  chrome.contextMenus.create({
    id: 'add-to-formbuddy',
    title: 'Add to FormBuddy folder',
    contexts: ['selection', 'image'],
  })
})

interface FieldFocusedPayload {
  fieldId: string
  fieldLabel: string
  tagName?: string
}

interface ContextUpdatedPayload {
  documents: DocumentIndex[]
}

interface FormSchemaPayload {
  fields: FieldFocusedPayload[]
}

interface ManualFieldFetchPayload {
  fields: string[]
}

type SuggestionOverride = Omit<Suggestion, 'id' | 'sessionId' | 'usedAt'> | null

let indexedDocuments: DocumentIndex[] = []
let activeDomain = ''
let activeSessionId = ''
let pageHistory: string[] = []
let currentFormFields: FieldFocusedPayload[] = []
let lastFormTabId: number | null = null
let formMappingSignature = ''
let formMappingBuildInFlight: Promise<void> | null = null
const mappedByFieldId = new Map<string, Omit<Suggestion, 'id' | 'sessionId'>>()
const mappedByFieldLabel = new Map<string, Omit<Suggestion, 'id' | 'sessionId'>>()
const usedFieldIds = new Set<string>()
const rejectedFieldIds = new Set<string>()

function logFormKv(step: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[FormBuddy][FormKV] ${step}`, meta)
    return
  }
  console.log(`[FormBuddy][FormKV] ${step}`)
}

function emitFormKvStatus(
  status: 'idle' | 'running' | 'ready' | 'error',
  payload?: Record<string, unknown>
): void {
  chrome.runtime.sendMessage({
    type: 'FORM_KV_STATUS',
    payload: {
      status,
      ...payload,
      emittedAt: new Date().toISOString(),
    },
  })
}

function getSuggestionOverride(): SuggestionOverride | undefined {
  return (globalThis as unknown as { __FORMBUDDY_SUGGESTION_OVERRIDE?: SuggestionOverride })
    .__FORMBUDDY_SUGGESTION_OVERRIDE
}

function getDomain(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function isBrowserInternalUrl(url: string | undefined): boolean {
  if (!url) return false
  return /^(chrome|chrome-extension|edge|about):/i.test(url)
}

function ensureSession(url?: string): string {
  const domain = getDomain(url)
  if (!activeSessionId || !activeDomain || activeDomain !== domain) {
    activeDomain = domain
    activeSessionId = crypto.randomUUID()
    pageHistory = []
    usedFieldIds.clear()
    rejectedFieldIds.clear()
  }
  return activeSessionId
}

function resetSession(): void {
  activeDomain = ''
  activeSessionId = ''
  pageHistory = []
  currentFormFields = []
  formMappingSignature = ''
  mappedByFieldId.clear()
  mappedByFieldLabel.clear()
  formMappingBuildInFlight = null
  usedFieldIds.clear()
  rejectedFieldIds.clear()
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function overlapScore(a: string, bTokens: string[]): number {
  const lower = a.toLowerCase()
  return bTokens.reduce((acc, token) => acc + (lower.includes(token) ? 1 : 0), 0)
}

function labelTokens(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function bestFieldFromDocs(label: string): {
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
  confidence: 'high' | 'medium' | 'low'
} | null {
  const tokens = labelTokens(label)
  let best: {
    value: string
    sourceFile: string
    sourcePage?: number
    sourceText: string
    score: number
  } | null = null

  for (const doc of indexedDocuments) {
    for (const [key, value] of Object.entries(doc.searchIndex?.autofill ?? {})) {
      const score = overlapScore(key, tokens) * 4 + overlapScore(value, tokens)
      if (score <= 0) continue
      if (!best || score > best.score) {
        best = { value, sourceFile: doc.fileName, sourcePage: 1, sourceText: key, score }
      }
    }
    for (const page of doc.pages) {
      for (const field of page.fields) {
        const score = overlapScore(field.label, tokens) * 4 + overlapScore(field.value, tokens)
        if (score <= 0) continue
        if (!best || score > best.score) {
          best = {
            value: field.value,
            sourceFile: doc.fileName,
            sourcePage: page.page,
            sourceText: field.boundingContext || field.value,
            score,
          }
        }
      }
    }
  }

  if (!best) return null
  return {
    value: best.value,
    sourceFile: best.sourceFile,
    sourcePage: best.sourcePage,
    sourceText: best.sourceText,
    confidence: 'medium',
  }
}

function regexFallbackFromDocs(label: string): {
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
} | null {
  const lower = label.toLowerCase()
  const patterns: Array<{ when: (v: string) => boolean; regexes: RegExp[] }> = [
    {
      when: v => v.includes('issue') && v.includes('date'),
      regexes: [
        /(?:issue(?:d)?\s*date|iss)\s*[:\-]?\s*([0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2}|[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i,
      ],
    },
    {
      when: v => v.includes('height') || v.includes('hgt'),
      regexes: [
        /(?:height|hgt)\s*[:\-]?\s*([0-9]'\s?[0-9]{1,2}"?|[0-9]{2,3}\s?(?:cm|in))/i,
      ],
    },
    {
      when: v => v.includes('weight') || v.includes('wgt'),
      regexes: [
        /(?:weight|wgt)\s*[:\-]?\s*([0-9]{2,3}\s?(?:lb|lbs|kg)?)/i,
      ],
    },
    {
      when: v => v.includes('eye') && v.includes('color'),
      regexes: [
        /(?:eye\s*color|eyes?)\s*[:\-]?\s*([A-Z]{3,5}|brown|blue|green|hazel|gray|grey|black)/i,
      ],
    },
  ]

  const matcher = patterns.find(p => p.when(lower))
  if (!matcher) return null

  for (const doc of indexedDocuments) {
    for (const page of doc.pages) {
      const text = page.rawText
      for (const rx of matcher.regexes) {
        const hit = rx.exec(text)
        if (hit?.[1]) {
          return {
            value: hit[1].trim(),
            sourceFile: doc.fileName,
            sourcePage: page.page,
            sourceText: hit[0].trim(),
          }
        }
      }
    }
  }
  return null
}

function findLocalFieldSuggestion(fieldId: string, fieldLabel: string): Omit<Suggestion, 'id' | 'sessionId'> | null {
  const tokens = tokenize(fieldLabel)
  let best: {
    value: string
    sourceFile: string
    sourcePage?: number
    sourceText: string
    score: number
  } | null = null

  for (const doc of indexedDocuments) {
    for (const [key, value] of Object.entries(doc.searchIndex?.autofill ?? {})) {
      const score = overlapScore(key, tokens) * 4 + overlapScore(value, tokens) * 2
      if (score <= 0) continue
      if (!best || score > best.score) {
        best = {
          value,
          sourceFile: doc.fileName,
          sourcePage: 1,
          sourceText: key,
          score,
        }
      }
    }

    for (const item of doc.searchIndex?.items ?? []) {
      const aliasScore = (item.aliases ?? []).reduce((acc, alias) => acc + overlapScore(alias, tokens), 0)
      const score = overlapScore(item.fieldLabel, tokens) * 4 + overlapScore(item.value, tokens) * 2 + aliasScore
      if (score <= 0) continue
      if (!best || score > best.score) {
        best = {
          value: item.value,
          sourceFile: doc.fileName,
          sourcePage: 1,
          sourceText: item.sourceText || item.value,
          score,
        }
      }
    }

    for (const page of doc.pages) {
      for (const field of page.fields) {
        const score = overlapScore(field.label, tokens) * 3 + overlapScore(field.value, tokens)
        if (score <= 0) continue
        if (!best || score > best.score) {
          best = {
            value: field.value,
            sourceFile: doc.fileName,
            sourcePage: page.page,
            sourceText: field.boundingContext || field.value,
            score,
          }
        }
      }
    }
  }

  if (!best) return null
  return {
    fieldId,
    fieldLabel,
    value: best.value,
    sourceFile: best.sourceFile,
    sourcePage: best.sourcePage,
    sourceText: best.sourceText,
    reason: 'Matched from indexed field data',
    confidence: 'medium',
  }
}

async function loadLLMConfig(): Promise<LLMConfig | null> {
  const result = await chrome.storage.local.get('llmConfig')
  return (result.llmConfig as LLMConfig) ?? null
}

async function requestFormSchemaFromActiveTab(): Promise<number> {
  async function extractSchemaViaScript(tabId: number): Promise<number> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ')
          const humanize = (value: string) =>
            normalize(value)
              .replace(/[_-]+/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase())

          const readLabel = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
            const aria = normalize(el.getAttribute('aria-label'))
            if (aria) return aria
            if (el.id) {
              const linked = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
              if (linked instanceof HTMLLabelElement) {
                const txt = normalize(linked.textContent)
                if (txt) return txt
              }
            }
            if ('placeholder' in el) {
              const placeholder = normalize((el as HTMLInputElement | HTMLTextAreaElement).placeholder)
              if (placeholder) return placeholder
            }
            const parentLabel = el.closest('label')
            if (parentLabel) {
              const txt = normalize(parentLabel.textContent)
              if (txt) return txt
            }
            return ''
          }

          const all = Array.from(document.querySelectorAll('input, textarea, select'))
          const seen = new Set<string>()
          const fields: Array<{ fieldId: string; fieldLabel: string; tagName: string }> = []
          for (const node of all) {
            if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) continue
            const primaryLabel = readLabel(node)
            const fallbackLabel =
              humanize(node.name) ||
              humanize(node.id) ||
              ('placeholder' in node ? humanize((node as HTMLInputElement | HTMLTextAreaElement).placeholder) : '') ||
              'Field'
            const fieldLabel =
              primaryLabel && fallbackLabel && primaryLabel.toLowerCase() !== fallbackLabel.toLowerCase()
                ? `${primaryLabel} (${fallbackLabel})`
                : (primaryLabel || fallbackLabel)
            const fieldId = normalize(node.id) || normalize(node.name) || fieldLabel
            if (!fieldId) continue
            const key = fieldId.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            fields.push({ fieldId, fieldLabel, tagName: node.tagName })
          }
          return fields
        },
      })
      const fields = (results?.[0]?.result ?? []) as FieldFocusedPayload[]
      if (Array.isArray(fields) && fields.length > 0) {
        currentFormFields = fields.filter(field => field.fieldId && field.fieldLabel).slice(0, 100)
        logFormKv('Fallback script extracted form schema', { fields: currentFormFields.length })
        return currentFormFields.length
      }
    } catch (err) {
      logFormKv('Fallback script schema extraction failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return 0
  }

  if (lastFormTabId) {
    try {
      logFormKv('Requesting form schema from last known form tab', { tabId: lastFormTabId })
      const response = await chrome.tabs.sendMessage(lastFormTabId, { type: 'REQUEST_FORM_SCHEMA' }, { frameId: 0 }) as
        | { ok?: boolean; fields?: FieldFocusedPayload[] }
        | undefined
      if (response?.ok && Array.isArray(response.fields)) {
        currentFormFields = response.fields.filter(field => field.fieldId && field.fieldLabel).slice(0, 100)
        logFormKv('Received form schema from last known tab', { fields: currentFormFields.length })
      }
      logFormKv('Form schema request sent (last known form tab)')
      if (currentFormFields.length > 0) return currentFormFields.length
      return await extractSchemaViaScript(lastFormTabId)
    } catch {
      logFormKv('Last known form tab is unavailable, trying fallback tab selection')
    }
  }

  const tabs = await chrome.tabs.query({ currentWindow: true })
  const active = tabs.find(tab => tab.active && tab.id && !isBrowserInternalUrl(tab.url))
  const fallback = tabs.find(tab => tab.id && !isBrowserInternalUrl(tab.url))
  const target = active ?? fallback
  if (!target?.id) {
    logFormKv('No eligible webpage tab for schema request')
    return 0
  }
  logFormKv('Requesting form schema from selected tab', { tabId: target.id, url: target.url ?? '' })
  try {
    const response = await chrome.tabs.sendMessage(target.id, { type: 'REQUEST_FORM_SCHEMA' }, { frameId: 0 }) as
      | { ok?: boolean; fields?: FieldFocusedPayload[] }
      | undefined
    if (response?.ok && Array.isArray(response.fields)) {
      currentFormFields = response.fields.filter(field => field.fieldId && field.fieldLabel).slice(0, 100)
      if (target.id) lastFormTabId = target.id
      logFormKv('Received form schema from selected tab', { fields: currentFormFields.length })
    }
    logFormKv('Form schema request sent')
    if (currentFormFields.length > 0) return currentFormFields.length
    return await extractSchemaViaScript(target.id)
  } catch {
    logFormKv('Failed to send form schema request (no content script/tab not ready)')
    return await extractSchemaViaScript(target.id)
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function applyMappings(mappings: FormKVMapping[]): void {
  mappedByFieldId.clear()
  mappedByFieldLabel.clear()
  for (const item of mappings) {
    const mapped: Omit<Suggestion, 'id' | 'sessionId'> = {
      fieldId: item.fieldId,
      fieldLabel: item.fieldLabel,
      value: item.value,
      sourceFile: item.sourceFile || 'Selected documents',
      sourceText: item.reason || item.value,
      reason: item.reason || 'Mapped from selected documents and form schema',
      confidence: item.confidence,
    }
    mappedByFieldId.set(normalizeKey(item.fieldId), mapped)
    mappedByFieldLabel.set(normalizeKey(item.fieldLabel), mapped)
  }
}

async function requestFormKVCache(signature: string): Promise<FormKVMapping[] | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FORM_KV_CACHE_GET',
      payload: { signature },
    }) as { ok?: boolean; cached?: FormKVMapping[] | null }
    if (!response?.ok) return null
    logFormKv('Cache lookup response received', { ok: response.ok, size: response.cached?.length ?? 0 })
    return Array.isArray(response.cached) ? response.cached : null
  } catch {
    logFormKv('Cache lookup failed')
    return null
  }
}

async function storeFormKVCache(signature: string, mappings: FormKVMapping[]): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'FORM_KV_CACHE_SET',
      payload: { signature, mappings },
    })
    logFormKv('Cache stored', { size: mappings.length })
  } catch {
    logFormKv('Cache store skipped/failed (sidepanel may be closed)')
    // Sidepanel may not be open; in-memory cache still applies for current session.
  }
}

function mappingSignature(): string {
  const docsSig = indexedDocuments
    .map(doc => `${doc.id}:${doc.indexedAt}:${Object.keys(doc.searchIndex?.autofill ?? {}).length}:${doc.searchIndex?.items?.length ?? 0}`)
    .join('|')
  const fieldSig = currentFormFields
    .map(field => `${normalizeKey(field.fieldId)}:${normalizeKey(field.fieldLabel)}`)
    .join('|')
  return `${docsSig}__${fieldSig}`
}

async function ensureFormMapping(llmConfig: LLMConfig): Promise<void> {
  if (!currentFormFields.length || !indexedDocuments.length) {
    logFormKv('Skipping mapping due to missing inputs', {
      formFields: currentFormFields.length,
      indexedDocs: indexedDocuments.length,
    })
    return
  }
  const nextSignature = mappingSignature()
  if (formMappingSignature === nextSignature) return
  if (formMappingBuildInFlight) {
    await formMappingBuildInFlight
    return
  }

  formMappingBuildInFlight = (async () => {
    logFormKv('Mapping run started', {
      formFields: currentFormFields.length,
      indexedDocs: indexedDocuments.length,
    })
    emitFormKvStatus('running', { progress: 5, stage: 'Preparing mapping' })

    const cached = await requestFormKVCache(nextSignature)
    if (cached && cached.length > 0) {
      logFormKv('Cache hit', { mappings: cached.length })
      applyMappings(cached)
      formMappingSignature = nextSignature
      emitFormKvStatus('ready', { count: cached.length, cached: true, progress: 100, stage: 'Loaded from cache' })
      chrome.runtime.sendMessage({
        type: 'FORM_KV_READY',
        payload: {
          count: cached.length,
          mappings: cached,
          cached: true,
          generatedAt: new Date().toISOString(),
        },
      })
      return
    }
    logFormKv('Cache miss')

    const docsPayload = indexedDocuments
      .map(doc => ({
        fileName: doc.fileName,
        autofill: doc.searchIndex?.autofill ?? {},
        items: (doc.searchIndex?.items ?? []).slice(0, 60).map(item => ({
          fieldLabel: item.fieldLabel,
          value: item.value,
          aliases: item.aliases ?? [],
        })),
      }))
      .filter(doc => Object.keys(doc.autofill).length > 0 || doc.items.length > 0)
      .slice(0, 12)
    if (!docsPayload.length) {
      logFormKv('No searchable document payload for mapping')
      emitFormKvStatus('idle', { reason: 'no-indexed-search-data', progress: 0, stage: 'No indexed data' })
      return
    }

    logFormKv('Calling LLM form mapper', {
      fields: currentFormFields.length,
      docs: docsPayload.length,
    })
    emitFormKvStatus('running', { progress: 45, stage: 'Running LLM mapping' })
    const mappings = await buildFormAutofillMapWithLLM(
      currentFormFields.map(field => ({ fieldId: field.fieldId, fieldLabel: field.fieldLabel })),
      docsPayload,
      llmConfig
    )

    emitFormKvStatus('running', { progress: 85, stage: 'Saving mapping cache' })
    applyMappings(mappings)
    logFormKv('LLM form mapper returned', { mappings: mappings.length })
    await storeFormKVCache(nextSignature, mappings)
    formMappingSignature = nextSignature
    emitFormKvStatus('ready', { count: mappings.length, cached: false, progress: 100, stage: 'Ready' })

    chrome.runtime.sendMessage({
      type: 'FORM_KV_READY',
      payload: {
        count: mappings.length,
        mappings,
        cached: false,
        generatedAt: new Date().toISOString(),
      },
    })
  })().finally(() => {
    formMappingBuildInFlight = null
  })

  await formMappingBuildInFlight
}

function getMappedSuggestion(fieldId: string, fieldLabel: string): Omit<Suggestion, 'id' | 'sessionId'> | null {
  return (
    mappedByFieldId.get(normalizeKey(fieldId)) ??
    mappedByFieldLabel.get(normalizeKey(fieldLabel)) ??
    null
  )
}

async function handleFieldFocused(payload: FieldFocusedPayload, sender: chrome.runtime.MessageSender) {
  if (sender.tab?.id) lastFormTabId = sender.tab.id
  const sessionId = ensureSession(sender.url ?? sender.tab?.url)
  if (usedFieldIds.has(payload.fieldId) || rejectedFieldIds.has(payload.fieldId)) return

  console.log('[FormBuddy] FIELD_FOCUSED', {
    fieldId: payload.fieldId,
    fieldLabel: payload.fieldLabel,
    tagName: payload.tagName,
    url: sender.url ?? sender.tab?.url ?? 'unknown',
    tabId: sender.tab?.id,
    sessionId,
  })

  chrome.runtime.sendMessage({
    type: 'FIELD_DETECTED',
    payload: {
      fieldId: payload.fieldId,
      fieldLabel: payload.fieldLabel,
      detectedAt: new Date().toISOString(),
    },
  })

  const override = getSuggestionOverride()
  if (override !== undefined) {
    if (!override?.value) return
    chrome.runtime.sendMessage({
      type: 'NEW_SUGGESTION',
      payload: {
        id: crypto.randomUUID(),
        sessionId,
        ...override,
      },
    })
    return
  }

  if (!indexedDocuments.length) return

  const llmConfig = await loadLLMConfig()
  if (llmConfig?.apiKey) {
    try {
      await ensureFormMapping(llmConfig)
      const mapped = getMappedSuggestion(payload.fieldId, payload.fieldLabel)
      if (mapped?.value) {
        chrome.runtime.sendMessage({
          type: 'NEW_SUGGESTION',
          payload: {
            id: crypto.randomUUID(),
            sessionId,
            ...mapped,
          },
        })
        return
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emitFormKvStatus('error', { message })
      console.warn('[FormBuddy] Form mapping LLM call failed:', message)
    }
  }

  const candidates = queryIndex(payload.fieldLabel, indexedDocuments, 5)
  if (!candidates.length) return

  if (!llmConfig?.apiKey) {
    const local = findLocalFieldSuggestion(payload.fieldId, payload.fieldLabel)
    if (!local?.value) return
    chrome.runtime.sendMessage({
      type: 'NEW_SUGGESTION',
      payload: {
        id: crypto.randomUUID(),
        sessionId,
        ...local,
      },
    })
    return
  }

  let suggested: Awaited<ReturnType<typeof generateSuggestionWithLLM>> = null
  try {
    suggested = await generateSuggestionWithLLM(
      payload.fieldId,
      payload.fieldLabel,
      candidates,
      llmConfig
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown LLM error'
    const local = findLocalFieldSuggestion(payload.fieldId, payload.fieldLabel)
    if (local?.value) {
      chrome.runtime.sendMessage({
        type: 'NEW_SUGGESTION',
        payload: {
          id: crypto.randomUUID(),
          sessionId,
          ...local,
        },
      })
      return
    }
    chrome.runtime.sendMessage({ type: 'APP_ERROR', payload: { message: `LLM error: ${message}` } })
    return
  }
  if (!suggested?.value) {
    const local = findLocalFieldSuggestion(payload.fieldId, payload.fieldLabel)
    if (!local?.value) return
    chrome.runtime.sendMessage({
      type: 'NEW_SUGGESTION',
      payload: {
        id: crypto.randomUUID(),
        sessionId,
        ...local,
      },
    })
    return
  }

  const suggestion: Suggestion = {
    id: crypto.randomUUID(),
    sessionId,
    ...suggested,
  }

  chrome.runtime.sendMessage({
    type: 'NEW_SUGGESTION',
    payload: suggestion,
  })
}

async function handleManualFieldFetch(payload: ManualFieldFetchPayload): Promise<{
  results: Array<{
    fieldLabel: string
    value: string
    sourceFile: string
    sourcePage?: number
    sourceText: string
    confidence: 'high' | 'medium' | 'low'
  }>
  reason?: string
}> {
  const llmConfig = await loadLLMConfig()
  const labels = (payload.fields ?? []).map(v => v.trim()).filter(Boolean).slice(0, 25)
  if (!labels.length) return { results: [], reason: 'No fields were provided.' }
  if (!indexedDocuments.length) return { results: [], reason: 'No indexed documents are selected.' }

  const results: Array<{
  fieldLabel: string
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
  confidence: 'high' | 'medium' | 'low'
  }> = []
  const seenLabels = new Set<string>()
  let hadSearchPayload = false

  if (llmConfig?.apiKey && indexedDocuments.length > 0) {
    try {
      const docsPayload = indexedDocuments
        .map(doc => ({
          fileName: doc.fileName,
          autofill: doc.searchIndex?.autofill ?? {},
          items: [
            ...(doc.searchIndex?.items ?? []).slice(0, 80).map(item => ({
              fieldLabel: item.fieldLabel,
              value: item.value,
              aliases: item.aliases ?? [],
            })),
            ...doc.pages
              .flatMap(page => page.fields.map(field => ({
                fieldLabel: field.label,
                value: field.value,
                aliases: [],
              })))
              .slice(0, 80),
            ...doc.pages
              .filter(page => page.rawText.trim().length > 0)
              .slice(0, 10)
              .map(page => ({
                fieldLabel: 'document_text',
                value: page.rawText.slice(0, 220),
                aliases: [],
              })),
          ],
        }))
        .filter(doc => Object.keys(doc.autofill).length > 0 || doc.items.length > 0)
        .slice(0, 20)
      hadSearchPayload = docsPayload.length > 0

      if (docsPayload.length > 0) {
        logFormKv('Manual field fetch: running required bulk LLM call', {
          requestedFields: labels.length,
          docs: docsPayload.length,
        })
        const llmMappings = await buildFormAutofillMapWithLLM(
          labels.map(label => ({
            fieldId: normalizeKey(label).replace(/\s+/g, '_') || label,
            fieldLabel: label,
          })),
          docsPayload,
          llmConfig
        )

        for (const mapping of llmMappings) {
          const norm = normalizeKey(mapping.fieldLabel)
          if (seenLabels.has(norm) || !mapping.value) continue
          seenLabels.add(norm)
          results.push({
            fieldLabel: mapping.fieldLabel,
            value: mapping.value,
            sourceFile: mapping.sourceFile || 'Selected docs',
            sourcePage: 1,
            sourceText: mapping.reason || mapping.value,
            confidence: mapping.confidence ?? 'medium',
          })
        }
      }
    } catch (err) {
      logFormKv('Manual field bulk LLM matching failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeKey(label)
    if (seenLabels.has(normalizedLabel)) continue

    const fieldId = normalizeKey(label).replace(/\s+/g, '_') || `field_${results.length + 1}`
    const local = findLocalFieldSuggestion(fieldId, label)
    const candidates = queryIndex(label, indexedDocuments, 5)

    if (llmConfig?.apiKey && candidates.length > 0) {
      try {
        const suggested = await generateSuggestionWithLLM(fieldId, label, candidates, llmConfig)
        if (suggested?.value) {
          results.push({
            fieldLabel: label,
            value: suggested.value,
            sourceFile: suggested.sourceFile || local?.sourceFile || 'Selected docs',
            sourcePage: suggested.sourcePage ?? local?.sourcePage,
            sourceText: suggested.sourceText || local?.sourceText || suggested.value,
            confidence: suggested.confidence ?? 'medium',
          })
          seenLabels.add(normalizedLabel)
          continue
        }
      } catch {
        // Fallback to local match below.
      }
    }

    if (local?.value) {
      results.push({
        fieldLabel: label,
        value: local.value,
        sourceFile: local.sourceFile,
        sourcePage: local.sourcePage,
        sourceText: local.sourceText,
        confidence: local.confidence,
      })
      seenLabels.add(normalizedLabel)
      continue
    }

    const direct = bestFieldFromDocs(label)
    if (direct?.value) {
      results.push({
        fieldLabel: label,
        value: direct.value,
        sourceFile: direct.sourceFile,
        sourcePage: direct.sourcePage,
        sourceText: direct.sourceText,
        confidence: direct.confidence,
      })
      seenLabels.add(normalizedLabel)
      continue
    }

    const regex = regexFallbackFromDocs(label)
    if (regex?.value) {
      results.push({
        fieldLabel: label,
        value: regex.value,
        sourceFile: regex.sourceFile,
        sourcePage: regex.sourcePage,
        sourceText: regex.sourceText,
        confidence: 'medium',
      })
      seenLabels.add(normalizedLabel)
    }
  }

  if (results.length > 0) return { results }
  if (!llmConfig?.apiKey) {
    return {
      results: [],
      reason: 'No API key set and local index did not contain matching values.',
    }
  }
  if (!hadSearchPayload) {
    return {
      results: [],
      reason: 'Selected docs do not have usable parsed search data yet. Reindex the selected file(s).',
    }
  }
  return {
    results: [],
    reason: 'LLM and local matching found no confident value for requested fields.',
  }
}

async function sendAutofillToActiveTab(value: string): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeTab = tabs[0]
  if (!activeTab?.id) return

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: 'AUTOFILL_FIELD',
      payload: { value },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Autofill failed'
    chrome.runtime.sendMessage({
      type: 'APP_ERROR',
      payload: { message },
    })
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CONTEXT_UPDATED') {
    const payload = message.payload as ContextUpdatedPayload
    indexedDocuments = payload.documents ?? []
    formMappingSignature = ''
    mappedByFieldId.clear()
    mappedByFieldLabel.clear()
    void (async () => {
      const llmConfig = await loadLLMConfig()
      if (!llmConfig?.apiKey) return
      await ensureFormMapping(llmConfig)
    })()
    console.log(`[FormBuddy] Context updated: ${indexedDocuments.length} indexed document(s)`)
    return
  }

  if (message?.type === 'FORM_SCHEMA') {
    const payload = message.payload as FormSchemaPayload
    if (sender.tab?.id) lastFormTabId = sender.tab.id
    currentFormFields = (payload.fields ?? []).filter(field => field.fieldId && field.fieldLabel).slice(0, 100)
    logFormKv('Received form schema', { fields: currentFormFields.length })
    formMappingSignature = ''
    mappedByFieldId.clear()
    mappedByFieldLabel.clear()
    void (async () => {
      const llmConfig = await loadLLMConfig()
      if (!llmConfig?.apiKey) return
      try {
        await ensureFormMapping(llmConfig)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emitFormKvStatus('error', { message })
      }
    })()
    return
  }

  if (message?.type === 'FORM_KV_FORCE_REFRESH') {
    formMappingSignature = ''
    mappedByFieldId.clear()
    mappedByFieldLabel.clear()
    emitFormKvStatus('running', { stage: 'Trigger received' })
    logFormKv('Manual fetch trigger received')
    sendResponse({ ok: true })
    void (async () => {
      const llmConfig = await loadLLMConfig()
      if (!llmConfig?.apiKey) {
        logFormKv('Manual fetch aborted: missing API key')
        emitFormKvStatus('error', { message: 'Set API key in Settings first.' })
        return
      }
      try {
        const fetchedCount = await requestFormSchemaFromActiveTab()
        logFormKv('Schema fetch completed', { fields: fetchedCount })
        if (!currentFormFields.length) {
          logFormKv('Manual fetch aborted: no form fields detected')
          emitFormKvStatus('error', { message: 'No form fields detected on this page.' })
          return
        }
        await ensureFormMapping(llmConfig)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logFormKv('Manual fetch failed', { message })
        emitFormKvStatus('error', { message })
      }
    })()
    return true
  }

  if (message?.type === 'MANUAL_FIELD_FETCH') {
    const payload = message.payload as ManualFieldFetchPayload
    void (async () => {
      try {
        const output = await handleManualFieldFetch(payload)
        sendResponse({ ok: true, ...output })
      } catch (err) {
        sendResponse({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return true
  }

  if (message?.type === 'FIELD_FOCUSED') {
    const payload = message.payload as FieldFocusedPayload
    if (!payload?.fieldId || !payload?.fieldLabel) return
    void handleFieldFocused(payload, sender)
    return
  }

  if (message?.type === 'SUGGESTION_ACCEPTED') {
    const payload = message.payload as Suggestion
    if (!payload?.fieldId || !payload?.value) return

    usedFieldIds.add(payload.fieldId)
    void sendAutofillToActiveTab(payload.value)

    chrome.runtime.sendMessage({
      type: 'SUGGESTION_APPLIED',
      payload: {
        id: payload.id,
        fieldId: payload.fieldId,
        usedAt: new Date().toISOString(),
        sessionId: payload.sessionId,
      },
    })
    return
  }

  if (message?.type === 'SUGGESTION_REJECTED') {
    const payload = message.payload as { fieldId?: string }
    if (!payload?.fieldId) return
    rejectedFieldIds.add(payload.fieldId)
    return
  }

  if (message?.type === 'SCREENSHOT_HOTKEY') {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT_REQUEST',
      payload: { requestedAt: new Date().toISOString() },
    })
    return
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'add-to-formbuddy') return

  const content = info.selectionText ?? info.srcUrl ?? ''
  if (!content) return

  chrome.runtime.sendMessage({
    type: 'QUICK_ADD',
    payload: {
      content,
      tabUrl: tab?.url ?? '',
      createdAt: new Date().toISOString(),
    },
  })
})

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return

  const newDomain = getDomain(details.url)
  if (!newDomain) return

  if (!activeSessionId || !activeDomain) {
    activeDomain = newDomain
    activeSessionId = crypto.randomUUID()
    pageHistory = [details.url]
  } else if (newDomain === activeDomain) {
    if (pageHistory[pageHistory.length - 1] !== details.url) {
      pageHistory.push(details.url)
    }
  } else {
    resetSession()
    activeDomain = newDomain
    activeSessionId = crypto.randomUUID()
    pageHistory = [details.url]
  }

  chrome.runtime.sendMessage({
    type: 'PAGE_NAVIGATED',
    payload: {
      sessionId: activeSessionId,
      url: details.url,
      pageIndex: pageHistory.length,
      domain: activeDomain,
    },
  })
})
