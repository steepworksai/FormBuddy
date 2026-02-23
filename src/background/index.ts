import type { DocumentIndex, FormKVMapping, LLMConfig, Suggestion } from '../types'
import { generateSuggestionWithLLM } from '../lib/llm/suggestion'
import { buildFormAutofillMapWithLLM } from '../lib/llm/formMapper'

// FormBuddy — Background Service Worker

// Open the side panel when the toolbar icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

chrome.runtime.onInstalled.addListener(() => {
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

type IncomingMessage =
  | { type: 'CONTEXT_UPDATED'; payload: ContextUpdatedPayload }
  | { type: 'FORM_SCHEMA' }
  | { type: 'FORM_KV_FORCE_REFRESH' }
  | { type: 'MANUAL_FIELD_FETCH'; payload: ManualFieldFetchPayload }
  | { type: 'GET_PAGE_FIELDS' }
  | { type: 'BULK_AUTOFILL'; payload: { mappings?: Array<{ fieldLabel: string; value: string }> } }
  | { type: 'FIELD_FOCUSED'; payload: FieldFocusedPayload }
  | { type: 'SUGGESTION_ACCEPTED'; payload: Suggestion }
  | { type: 'SUGGESTION_REJECTED'; payload: { fieldId?: string } }
  | { type: 'SCREENSHOT_HOTKEY' }

function isTypedMessage(msg: unknown): msg is IncomingMessage {
  return typeof msg === 'object' && msg !== null && typeof (msg as Record<string, unknown>).type === 'string'
}

let indexedDocuments: DocumentIndex[] = []
let activeDomain = ''
let activeSessionId = ''
let pageHistory: string[] = []
const usedFieldIds = new Set<string>()
const rejectedFieldIds = new Set<string>()

/**
 * Ensure the content script is alive in the given tab, then send a message.
 * Always injects the content script first — the script's __FORMBUDDY_CONTENT_INIT__
 * guard makes double-injection a safe no-op on tabs that already have it loaded.
 * This avoids the "Receiving end does not exist" error on tabs that were open
 * before the extension was installed or reloaded.
 */
/**
 * Reload a tab and resolve when it reaches status 'complete'.
 * Times out after 10 seconds to avoid hanging forever.
 */
function reloadAndWait(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error('Page took too long to reload. Try again.'))
    }, 10_000)

    function onUpdated(updatedTabId: number, changeInfo: { status?: string }) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timeout)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.reload(tabId)
  })
}

/**
 * Ensure the content script is alive in the given tab, then send a message.
 * Always injects the content script first — the script's __FORMBUDDY_CONTENT_INIT__
 * guard makes double-injection a safe no-op on tabs that already have it loaded.
 */
async function sendToTab(tabId: number, message: unknown): Promise<unknown> {
  const manifest = chrome.runtime.getManifest()
  const files = manifest.content_scripts?.[0]?.js ?? []
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files })
  } catch {
    // Restricted URL (chrome://, file://) or page not ready — proceed anyway;
    // if the script is already running the send will still succeed.
  }
  return await chrome.tabs.sendMessage(tabId, message)
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
  return (globalThis as Record<string, unknown>).__FORMBUDDY_SUGGESTION_OVERRIDE as SuggestionOverride | undefined
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

async function storeFormKVCache(
  signature: string,
  mappings: FormKVMapping[],
  documents: Array<{ fileName: string; cleanText: string }> = [],
  requestedFields: string[] = []
): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'FORM_KV_CACHE_SET',
      payload: { signature, mappings, documents, requestedFields },
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
    sourceText: mapping.sourceText || mapping.reason || mapping.value,
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
    sourceText: item.sourceText,
    reason: item.sourceText || item.value,
    confidence: item.confidence,
  }
}

async function handleFieldFocused(payload: FieldFocusedPayload, sender: chrome.runtime.MessageSender) {
  const sessionId = ensureSession(sender.url ?? sender.tab?.url)
  if (usedFieldIds.has(payload.fieldId) || rejectedFieldIds.has(payload.fieldId)) return

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
    chrome.runtime.sendMessage({ type: 'NEW_SUGGESTION', payload: { id: crypto.randomUUID(), sessionId, ...override } })
    return
  }

  if (!indexedDocuments.length) return

  const llmConfig = await loadLLMConfig()
  if (!llmConfig?.apiKey) return

  const docs = indexedDocuments.map(d => ({
    fileName: d.fileName,
    cleanText: d.cleanText ?? d.rawText ?? d.pages.map(p => p.rawText).join('\n'),
  })).filter(d => d.cleanText.trim().length > 0)

  if (!docs.length) return

  try {
    const suggested = await generateSuggestionWithLLM(payload.fieldId, payload.fieldLabel, docs, llmConfig)
    if (!suggested?.value) return
    chrome.runtime.sendMessage({
      type: 'NEW_SUGGESTION',
      payload: { id: crypto.randomUUID(), sessionId, ...suggested },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown LLM error'
    chrome.runtime.sendMessage({ type: 'APP_ERROR', payload: { message: `LLM error: ${message}` } })
  }
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
  if (!llmConfig?.apiKey) return { results: [], reason: 'No API key configured. Open settings to add your key.' }

  const signature = manualFetchSignature(labels, payload.rawInput)
  const cached = await requestFormKVCache(signature)
  if (cached) {
    const cachedResults = cached.map(mappingToManualResult)
    if (cachedResults.length > 0) return { results: cachedResults }
    return { results: [], reason: 'No matching values found for the requested fields.' }
  }

  const docsPayload = indexedDocuments
    .map(doc => ({
      fileName: doc.fileName,
      cleanText: doc.cleanText ?? doc.rawText ?? doc.pages.map(p => p.rawText).join('\n').trim(),
    }))
    .filter(doc => doc.cleanText.trim().length > 0)
    .slice(0, 20)

  if (!docsPayload.length) {
    return { results: [], reason: 'Documents have no text content yet. Reindex the selected file(s).' }
  }

  try {
    const llmMappings = await buildFormAutofillMapWithLLM(
      labels.map(label => ({
        fieldId: normalizeKey(label).replace(/\s+/g, '_') || label,
        fieldLabel: label,
      })),
      docsPayload,
      llmConfig,
      { rawFieldsInput: payload.rawInput }
    )

    const results = llmMappings
      .filter(m => m.value)
      .map(m => ({
        fieldLabel: m.fieldLabel,
        value: m.value,
        sourceFile: m.sourceFile || 'Selected docs',
        sourcePage: undefined as number | undefined,
        sourceText: m.sourceText || m.reason || m.value,
        confidence: m.confidence ?? ('medium' as const),
      }))

    await storeFormKVCache(signature, results.map(manualResultToMapping), docsPayload, labels)
    if (results.length > 0) return { results }
    return { results: [], reason: 'LLM found no values for the requested fields.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[FormBuddy] LLM mapping failed:', msg)
    return { results: [], reason: `LLM error: ${msg}` }
  }
}

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (!isTypedMessage(rawMessage)) return

  const message = rawMessage

  if (message.type === 'CONTEXT_UPDATED') {
    indexedDocuments = message.payload.documents ?? []
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: true, documentCount: indexedDocuments.length })
    }
    return true
  }

  if (message.type === 'FORM_SCHEMA') {
    return
  }

  if (message.type === 'FORM_KV_FORCE_REFRESH') {
    emitFormKvStatus('idle', { reason: 'auto-mapping-disabled' })
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: true, disabled: true })
    }
    return
  }

  if (message.type === 'MANUAL_FIELD_FETCH') {
    const payload = message.payload
    void (async () => {
      try {
        const output = await handleManualFieldFetch(payload)
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

  if (message.type === 'GET_PAGE_FIELDS') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ ok: false, fields: [], reason: 'No active tab found.' })
          return
        }
        if (tab.url && /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) {
          sendResponse({ ok: false, fields: [], reason: 'Cannot scan browser internal pages. Navigate to a web form first.' })
          return
        }
        await reloadAndWait(tab.id)
        const raw = await sendToTab(tab.id, { type: 'REQUEST_FORM_SCHEMA' })
        const fields = (
          typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).fields)
            ? (raw as { fields: Array<{ fieldLabel: string }> }).fields
            : []
        )
        sendResponse({ ok: true, fields })
      } catch (err) {
        sendResponse({ ok: false, fields: [], reason: err instanceof Error ? err.message : String(err) })
      }
    })()
    return true
  }

  if (message.type === 'BULK_AUTOFILL') {
    const mappings = message.payload?.mappings
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
        const raw = await sendToTab(tab.id, {
          type: 'BULK_AUTOFILL',
          payload: { mappings },
        })
        const extra = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
        sendResponse({ ok: true, ...extra })
      } catch (err) {
        sendResponse({ ok: false, reason: err instanceof Error ? err.message : String(err) })
      }
    })()
    return true
  }

  if (message.type === 'FIELD_FOCUSED') {
    const payload = message.payload
    if (!payload?.fieldId || !payload?.fieldLabel) return
    void handleFieldFocused(payload, sender)
    return
  }

  if (message.type === 'SUGGESTION_ACCEPTED') {
    const payload = message.payload
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

  if (message.type === 'SUGGESTION_REJECTED') {
    const payload = message.payload
    if (!payload?.fieldId) return
    rejectedFieldIds.add(payload.fieldId)
    return
  }

  if (message.type === 'SCREENSHOT_HOTKEY') {
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
