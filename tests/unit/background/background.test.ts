import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentIndex, Suggestion } from '../../../src/types'

interface ChromeMockState {
  runtimeOnMessage?: (message: unknown, sender: chrome.runtime.MessageSender) => void
  runtimeOnInstalled?: () => void
  webNavigationOnCompleted?: (details: { frameId: number; url: string }) => void
  contextMenuOnClicked?: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void
  sendMessage: ReturnType<typeof vi.fn>
  tabsSendMessage: ReturnType<typeof vi.fn>
  tabsQuery: ReturnType<typeof vi.fn>
  setPanelBehavior: ReturnType<typeof vi.fn>
  contextMenusCreate: ReturnType<typeof vi.fn>
}

function createChromeMock(llmConfig?: { provider: 'anthropic' | 'openai' | 'gemini'; apiKey: string; model: string }): ChromeMockState {
  const state: ChromeMockState = {
    sendMessage: vi.fn(),
    tabsSendMessage: vi.fn(async () => undefined),
    tabsQuery: vi.fn(async () => [{ id: 99 }]),
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    contextMenusCreate: vi.fn(),
  }

  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
    sidePanel: {
      setPanelBehavior: state.setPanelBehavior,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ llmConfig })),
      },
    },
    tabs: {
      query: state.tabsQuery,
      sendMessage: state.tabsSendMessage,
    },
    runtime: {
      onInstalled: {
        addListener: (fn: () => void) => {
          state.runtimeOnInstalled = fn
        },
      },
      onMessage: {
        addListener: (fn: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
          state.runtimeOnMessage = fn
        },
      },
      sendMessage: state.sendMessage,
    },
    contextMenus: {
      create: state.contextMenusCreate,
      onClicked: {
        addListener: (fn: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) => {
          state.contextMenuOnClicked = fn
        },
      },
    },
    webNavigation: {
      onCompleted: {
        addListener: (fn: (details: { frameId: number; url: string }) => void) => {
          state.webNavigationOnCompleted = fn
        },
      },
    },
  }

  return state
}

async function loadBackgroundWithMocks(options?: {
  queryCandidates?: Array<{ documentId: string; fileName: string; sourceText: string; sourcePage?: number; score: number }>
  suggestion?: Omit<Suggestion, 'id' | 'sessionId' | 'usedAt'> | null
  llmConfig?: { provider: 'anthropic' | 'openai' | 'gemini'; apiKey: string; model: string }
}) {
  vi.resetModules()
  const queryCandidates = options?.queryCandidates ?? [
    { documentId: 'doc-1', fileName: 'passport.pdf', sourcePage: 1, sourceText: 'Passport AB123456', score: 5 },
  ]
  const suggestion =
    options?.suggestion ??
    ({
      fieldId: 'passport_number',
      fieldLabel: 'Passport Number',
      value: 'AB123456',
      sourceFile: 'passport.pdf',
      sourcePage: 1,
      sourceText: 'Passport AB123456',
      reason: 'Found in passport scan',
      confidence: 'high',
    } satisfies Omit<Suggestion, 'id' | 'sessionId' | 'usedAt'>)

  const queryIndexMock = vi.fn(() => queryCandidates)
  const generateSuggestionWithLLMMock = vi.fn(async () => suggestion)

  vi.doMock('../../../src/lib/indexing/query', () => ({
    queryIndex: queryIndexMock,
  }))
  vi.doMock('../../../src/lib/llm/suggestion', () => ({
    generateSuggestionWithLLM: generateSuggestionWithLLMMock,
  }))

  const chromeState = createChromeMock(
    options?.llmConfig ?? { provider: 'anthropic', apiKey: 'key', model: 'claude-sonnet-4-6' }
  )

  await import('../../../src/background/index')
  return { chromeState, queryIndexMock, generateSuggestionWithLLMMock }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

const sampleDoc = {
  id: 'doc-1',
  fileName: 'passport.pdf',
  type: 'pdf',
  indexedAt: new Date().toISOString(),
  language: 'en',
  pageCount: 1,
  pages: [{ page: 1, rawText: 'passport number AB123456', fields: [] }],
  entities: { identifiers: ['AB123456'] },
  summary: 'passport',
  usedFields: [],
} satisfies DocumentIndex

describe('TM5 background workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes side panel behavior and context menu on install', async () => {
    const { chromeState } = await loadBackgroundWithMocks()
    expect(chromeState.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })

    chromeState.runtimeOnInstalled?.()
    expect(chromeState.contextMenusCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'add-to-formbuddy' })
    )
  })

  it('runs FIELD_FOCUSED -> NEW_SUGGESTION pipeline', async () => {
    const { chromeState } = await loadBackgroundWithMocks()
    chromeState.runtimeOnMessage?.(
      { type: 'CONTEXT_UPDATED', payload: { documents: [sampleDoc] } },
      {} as chrome.runtime.MessageSender
    )
    chromeState.runtimeOnMessage?.(
      { type: 'FIELD_FOCUSED', payload: { fieldId: 'passport_number', fieldLabel: 'Passport Number' } },
      { url: 'https://form.example.com/start', tab: { id: 1, url: 'https://form.example.com/start' } } as chrome.runtime.MessageSender
    )
    await flushAsync()

    expect(chromeState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FIELD_DETECTED' })
    )
    expect(chromeState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NEW_SUGGESTION',
        payload: expect.objectContaining({ value: 'AB123456' }),
      })
    )
  })

  it('handles accept/reject and suppression behavior', async () => {
    const { chromeState } = await loadBackgroundWithMocks()
    chromeState.runtimeOnMessage?.(
      {
        type: 'SUGGESTION_ACCEPTED',
        payload: {
          id: 's1',
          fieldId: 'passport_number',
          fieldLabel: 'Passport Number',
          value: 'AB123456',
          sourceFile: 'passport.pdf',
          sourceText: 'Passport AB123456',
          reason: 'found',
          confidence: 'high',
          sessionId: 'sess',
        },
      },
      {} as chrome.runtime.MessageSender
    )
    await flushAsync()

    expect(chromeState.tabsSendMessage).toHaveBeenCalledWith(
      99,
      expect.objectContaining({
        type: 'AUTOFILL_FIELD',
        payload: { value: 'AB123456' },
      })
    )
    expect(chromeState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SUGGESTION_APPLIED' })
    )

    chromeState.runtimeOnMessage?.(
      { type: 'SUGGESTION_REJECTED', payload: { fieldId: 'email' } },
      {} as chrome.runtime.MessageSender
    )
    chromeState.runtimeOnMessage?.(
      { type: 'CONTEXT_UPDATED', payload: { documents: [sampleDoc] } },
      {} as chrome.runtime.MessageSender
    )
    chromeState.runtimeOnMessage?.(
      { type: 'FIELD_FOCUSED', payload: { fieldId: 'email', fieldLabel: 'Email' } },
      { url: 'https://form.example.com/start', tab: { id: 1 } } as chrome.runtime.MessageSender
    )
    await flushAsync()

    expect(
      chromeState.sendMessage.mock.calls.some(
        call => call[0]?.type === 'NEW_SUGGESTION' && call[0]?.payload?.fieldId === 'email'
      )
    ).toBe(false)
  })

  it('maps screenshot hotkey to capture request', async () => {
    const { chromeState } = await loadBackgroundWithMocks()
    chromeState.runtimeOnMessage?.(
      { type: 'SCREENSHOT_HOTKEY' },
      {} as chrome.runtime.MessageSender
    )
    expect(chromeState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAPTURE_SCREENSHOT_REQUEST' })
    )
  })

  it('tracks PAGE_NAVIGATED continuity on same domain and resets on domain change', async () => {
    const { chromeState } = await loadBackgroundWithMocks()
    chromeState.webNavigationOnCompleted?.({ frameId: 0, url: 'https://a.example.com/page1' })
    chromeState.webNavigationOnCompleted?.({ frameId: 0, url: 'https://a.example.com/page2' })
    chromeState.webNavigationOnCompleted?.({ frameId: 0, url: 'https://b.example.com/start' })

    const navMessages = chromeState.sendMessage.mock.calls
      .map(call => call[0])
      .filter(message => message?.type === 'PAGE_NAVIGATED')

    expect(navMessages).toHaveLength(3)
    expect(navMessages[0].payload.pageIndex).toBe(1)
    expect(navMessages[1].payload.pageIndex).toBe(2)
    expect(navMessages[2].payload.pageIndex).toBe(1)
    expect(navMessages[2].payload.domain).toBe('b.example.com')
  })
})
