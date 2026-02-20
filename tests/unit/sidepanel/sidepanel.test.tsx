import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestFolderAccessMock = vi.fn()
const listFilesMock = vi.fn(async () => [])
const writeFileToFolderMock = vi.fn()
const indexDocumentMock = vi.fn()
const readManifestMock = vi.fn(async () => ({
  version: '1.0',
  createdAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  documents: [],
}))
const writeManifestMock = vi.fn()
const readIndexEntryMock = vi.fn()

vi.mock('../../../src/lib/folder/access', () => ({
  requestFolderAccess: requestFolderAccessMock,
  listFiles: listFilesMock,
  writeFileToFolder: writeFileToFolderMock,
}))

vi.mock('../../../src/lib/indexing/indexer', () => ({
  indexDocument: indexDocumentMock,
}))

vi.mock('../../../src/lib/indexing/manifest', () => ({
  readManifest: readManifestMock,
  writeManifest: writeManifestMock,
  readIndexEntry: readIndexEntryMock,
}))

vi.mock('../../../src/lib/config/supportedTypes', () => ({
  getTypeInfo: vi.fn(() => ({ icon: '📄' })),
  isSupported: vi.fn(() => true),
}))

vi.mock('../../../src/lib/parser/pdf', () => ({
  MAX_PDF_PAGES: 25,
}))

interface ChromeMock {
  runtimeMessageListener?: (message: unknown) => void
  storageChangeListener?: (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void
  runtimeSendMessage: ReturnType<typeof vi.fn>
}

function installChromeMock(): ChromeMock {
  const chromeMock: ChromeMock = {
    runtimeSendMessage: vi.fn(),
  }

  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn((_key: string, cb: (result: Record<string, unknown>) => void) => cb({})),
      },
      onChanged: {
        addListener: (listener: ChromeMock['storageChangeListener']) => {
          chromeMock.storageChangeListener = listener
        },
        removeListener: vi.fn(),
      },
    },
    runtime: {
      onMessage: {
        addListener: (listener: ChromeMock['runtimeMessageListener']) => {
          chromeMock.runtimeMessageListener = listener
        },
        removeListener: vi.fn(),
      },
      sendMessage: chromeMock.runtimeSendMessage,
      getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
    },
    windows: {
      create: vi.fn(),
    },
    tabs: {
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      query: vi.fn(async () => [{ id: 1, active: true, windowId: 1, url: 'https://example.com' }]),
      update: vi.fn(async () => ({})),
    },
  }

  ;(globalThis.navigator as Navigator & { clipboard?: { writeText: (value: string) => Promise<void> } }).clipboard = {
    writeText: vi.fn(async () => undefined),
  }

  return chromeMock
}

describe('TM6 sidepanel component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestFolderAccessMock.mockResolvedValue({ name: 'FormBuddyDocs' })
    listFilesMock.mockResolvedValue([new File(['Passport Number: P9384721'], 'profile.txt', { type: 'text/plain' })])
    indexDocumentMock.mockResolvedValue({ status: 'indexed', entry: { id: 'd1' } })
    readManifestMock.mockResolvedValue({
      version: '1.0',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      documents: [
        {
          id: 'd1',
          fileName: 'profile.txt',
          type: 'text',
          indexFile: 'd1.json',
          checksum: 'x',
          sizeBytes: 10,
          indexedAt: new Date().toISOString(),
          language: 'en',
          llmPrepared: false,
          needsReindex: false,
        },
      ],
    })
    readIndexEntryMock.mockResolvedValue({
      id: 'd1',
      fileName: 'profile.txt',
      type: 'text',
      indexedAt: new Date().toISOString(),
      language: 'en',
      pageCount: 1,
      pages: [
        {
          page: 1,
          rawText: 'Passport Number: P9384721',
          fields: [
            {
              label: 'Passport Number',
              value: 'P9384721',
              confidence: 'high',
              boundingContext: 'Passport Number: P9384721',
            },
          ],
        },
      ],
      entities: { identifiers: ['P9384721'] },
      summary: 'test profile',
      usedFields: [],
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders search-driven layout', async () => {
    installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    expect(screen.getByRole('heading', { name: 'FormBuddy' })).toBeInTheDocument()
    expect(screen.getByText('Search & Copy')).toBeInTheDocument()
    expect(screen.getByText('Copied This Session')).toBeInTheDocument()
    expect(screen.queryByText('Field Activity')).not.toBeInTheDocument()
    expect(screen.queryByText('Suggestions')).not.toBeInTheDocument()
  })

  it('searches indexed field values and copies selected result', async () => {
    installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }))
    await screen.findByText('profile.txt')

    fireEvent.change(screen.getByPlaceholderText(/search field/i), { target: { value: 'passport number' } })
    await screen.findByText('P9384721')

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    await screen.findByText(/Passport Number -> P9384721/)
  })

  it('updates no-key warning when storage llmConfig changes', async () => {
    const chromeMock = installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    chromeMock.storageChangeListener?.(
      {
        llmConfig: {
          oldValue: { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6' },
          newValue: undefined,
        },
      },
      'local'
    )

    expect(await screen.findByText(/No API key set/i)).toBeInTheDocument()

    chromeMock.storageChangeListener?.(
      {
        llmConfig: {
          oldValue: undefined,
          newValue: { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6' },
        },
      },
      'local'
    )

    await waitFor(() => {
      expect(screen.queryByText(/No API key set/i)).not.toBeInTheDocument()
    })
  })

  it('updates search box from selection message', async () => {
    const chromeMock = installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    await waitFor(() => {
      expect(chromeMock.runtimeMessageListener).toBeDefined()
    })

    chromeMock.runtimeMessageListener?.({
      type: 'SELECTION_CHANGED',
      payload: { text: 'email address' },
    })

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search field/i)).toHaveValue('email address')
    })
  })
})
