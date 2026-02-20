import type { DocumentIndex, LLMConfig, Suggestion } from '../types'
import { queryIndex } from '../lib/indexing/query'
import { generateSuggestionWithLLM } from '../lib/llm/suggestion'

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

type SuggestionOverride = Omit<Suggestion, 'id' | 'sessionId' | 'usedAt'> | null

let indexedDocuments: DocumentIndex[] = []
let activeDomain = ''
let activeSessionId = ''
let pageHistory: string[] = []
const usedFieldIds = new Set<string>()
const rejectedFieldIds = new Set<string>()

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

  const candidates = queryIndex(payload.fieldLabel, indexedDocuments, 5)
  if (!candidates.length) return

  const llmConfig = await loadLLMConfig()
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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'CONTEXT_UPDATED') {
    const payload = message.payload as ContextUpdatedPayload
    indexedDocuments = payload.documents ?? []
    console.log(`[FormBuddy] Context updated: ${indexedDocuments.length} indexed document(s)`)
    return
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
