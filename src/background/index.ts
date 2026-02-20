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

interface ManualFieldFetchPayload {
  fields: string[]
  rawInput?: string
}

type SuggestionOverride = Omit<Suggestion, 'id' | 'sessionId' | 'usedAt'> | null

let indexedDocuments: DocumentIndex[] = []
let activeDomain = ''
let activeSessionId = ''
let pageHistory: string[] = []
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

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function manualFetchSignature(labels: string[], rawInput: string | undefined): string {
  const docsSig = indexedDocuments
    .map(doc => `${doc.id}:${doc.indexedAt}:${doc.fileName}`)
    .sort()
    .join('|')
  const fieldsSig = labels.map(label => normalizeKey(label)).sort().join('|')
  const rawSig = normalizeKey(rawInput ?? '')
  return `manual_fetch::${docsSig}::${fieldsSig}::${rawSig}`
}

async function requestFormKVCache(signature: string): Promise<FormKVMapping[] | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FORM_KV_CACHE_GET',
      payload: { signature },
    }) as { ok?: boolean; cached?: FormKVMapping[] | null }
    if (!response?.ok) return null
    return Array.isArray(response.cached) ? response.cached : null
  } catch {
    return null
  }
}

async function storeFormKVCache(signature: string, mappings: FormKVMapping[]): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'FORM_KV_CACHE_SET',
      payload: { signature, mappings },
    })
  } catch {
    // Sidepanel may be closed; skip cache persistence.
  }
}

function mappingToManualResult(mapping: FormKVMapping): {
  fieldLabel: string
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
  confidence: 'high' | 'medium' | 'low'
} {
  return {
    fieldLabel: mapping.fieldLabel || mapping.fieldId,
    value: mapping.value,
    sourceFile: mapping.sourceFile || 'Selected docs',
    sourcePage: 1,
    sourceText: mapping.reason || mapping.value,
    confidence: mapping.confidence ?? 'medium',
  }
}

function manualResultToMapping(item: {
  fieldLabel: string
  value: string
  sourceFile: string
  sourceText: string
  confidence: 'high' | 'medium' | 'low'
}): FormKVMapping {
  return {
    fieldId: normalizeKey(item.fieldLabel).replace(/\s+/g, '_') || item.fieldLabel,
    fieldLabel: item.fieldLabel,
    value: item.value,
    sourceFile: item.sourceFile,
    reason: item.sourceText || item.value,
    confidence: item.confidence,
  }
}

async function handleFieldFocused(payload: FieldFocusedPayload, sender: chrome.runtime.MessageSender) {
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

  console.log('[FormBuddy][BG] handleManualFieldFetch start', {
    labelCount: labels.length,
    labels,
    indexedDocumentCount: indexedDocuments.length,
    indexedDocuments: indexedDocuments.map(d => d.fileName),
    hasApiKey: !!llmConfig?.apiKey,
    provider: llmConfig?.provider,
    model: llmConfig?.model,
  })

  if (!labels.length) return { results: [], reason: 'No fields were provided.' }
  if (!indexedDocuments.length) {
    console.warn('[FormBuddy][BG] No indexed documents in memory — was CONTEXT_UPDATED received?')
    return { results: [], reason: 'No indexed documents are selected.' }
  }
  const signature = manualFetchSignature(labels, payload.rawInput)

  const cached = await requestFormKVCache(signature)
  if (cached) {
    logFormKv('Manual field fetch cache hit', { signature, mappings: cached.length })
    const cachedResults = cached.map(mappingToManualResult)
    if (cachedResults.length > 0) return { results: cachedResults }
    return { results: [], reason: 'No matching values found for the requested fields.' }
  }
  logFormKv('Manual field fetch cache miss', { signature })

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
          items: (doc.searchIndex?.items ?? []).slice(0, 200).map(item => ({
            fieldLabel: item.fieldLabel,
            value: item.value,
            aliases: item.aliases ?? [],
          })),
          referenceJson: doc,
        }))
        .filter(doc => Object.keys(doc.autofill).length > 0 || doc.items.length > 0 || !!doc.referenceJson)
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
          llmConfig,
          {
            rawFieldsInput: payload.rawInput,
          }
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

  // Bulk LLM already handled all fields — skip per-field fallbacks
  if (results.length > 0) {
    logFormKv('Bulk LLM produced results — skipping per-field fallback', { resultCount: results.length })
  }

  for (const label of labels) {
    if (results.length > 0) break   // bulk LLM succeeded; don't append fallback results
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

  if (results.length > 0) {
    await storeFormKVCache(signature, results.map(manualResultToMapping))
    return { results }
  }
  if (!llmConfig?.apiKey) {
    await storeFormKVCache(signature, [])
    return {
      results: [],
      reason: 'No API key set and local index did not contain matching values.',
    }
  }
  if (!hadSearchPayload) {
    await storeFormKVCache(signature, [])
    return {
      results: [],
      reason: 'Selected docs do not have usable parsed search data yet. Reindex the selected file(s).',
    }
  }
  await storeFormKVCache(signature, [])
  return {
    results: [],
    reason: 'LLM and local matching found no confident value for requested fields.',
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CONTEXT_UPDATED') {
    const payload = message.payload as ContextUpdatedPayload
    indexedDocuments = payload.documents ?? []
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: true, documentCount: indexedDocuments.length })
    }
    console.log(`[FormBuddy] Context updated: ${indexedDocuments.length} indexed document(s)`)
    return true
  }

  if (message?.type === 'FORM_SCHEMA') {
    logFormKv('FORM_SCHEMA ignored (auto mapping is disabled)')
    return
  }

  if (message?.type === 'FORM_KV_FORCE_REFRESH') {
    emitFormKvStatus('idle', { reason: 'auto-mapping-disabled' })
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: true, disabled: true })
    }
    return
  }

  if (message?.type === 'MANUAL_FIELD_FETCH') {
    const payload = message.payload as ManualFieldFetchPayload
    console.log('[FormBuddy][BG] MANUAL_FIELD_FETCH received', {
      fieldCount: payload?.fields?.length,
      fields: payload?.fields,
      indexedDocumentCount: indexedDocuments.length,
    })
    void (async () => {
      try {
        const output = await handleManualFieldFetch(payload)
        console.log('[FormBuddy][BG] MANUAL_FIELD_FETCH responding', {
          ok: true,
          resultCount: output.results.length,
          reason: output.reason,
        })
        sendResponse({ ok: true, ...output })
      } catch (err) {
        console.error('[FormBuddy][BG] MANUAL_FIELD_FETCH threw', err)
        sendResponse({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return true
  }

  if (message?.type === 'GET_PAGE_FIELDS') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ ok: false, fields: [] })
          return
        }
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_FORM_SCHEMA' })
        sendResponse({ ok: true, fields: (result?.fields ?? []) as Array<{ fieldLabel: string }> })
      } catch (err) {
        sendResponse({ ok: false, fields: [], reason: err instanceof Error ? err.message : String(err) })
      }
    })()
    return true
  }

  if (message?.type === 'BULK_AUTOFILL') {
    const mappings = message.payload?.mappings as Array<{ fieldLabel: string; value: string }> | undefined
    if (!mappings?.length) {
      sendResponse({ ok: false, reason: 'No mappings provided.' })
      return true
    }
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ ok: false, reason: 'No active tab found.' })
          return
        }
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: 'BULK_AUTOFILL',
          payload: { mappings },
        })
        sendResponse({ ok: true, ...result })
      } catch (err) {
        sendResponse({ ok: false, reason: err instanceof Error ? err.message : String(err) })
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
