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
const appendUsageMock = vi.fn()
const markUsedFieldInDocumentMock = vi.fn()

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

vi.mock('../../../src/lib/indexing/usage', () => ({
  appendUsage: appendUsageMock,
  markUsedFieldInDocument: markUsedFieldInDocumentMock,
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
    },
  }

  return chromeMock
}

describe('TM6 sidepanel component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestFolderAccessMock.mockResolvedValue({ name: 'FormBuddyDocs' })
    indexDocumentMock.mockResolvedValue({ status: 'indexed', entry: { id: 'd1' } })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders default empty state cleanly', async () => {
    installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    expect(screen.getByRole('heading', { name: 'FormBuddy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeInTheDocument()
    expect(screen.getByText('Field Activity')).toBeInTheDocument()
    expect(screen.getByText('Suggestions')).toBeInTheDocument()
    expect(screen.getByText('Filled This Session')).toBeInTheDocument()
  })

  it('renders suggestion card from runtime message and supports dismiss', async () => {
    const chromeMock = installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    chromeMock.runtimeMessageListener?.({
      type: 'NEW_SUGGESTION',
      payload: {
        id: 's1',
        fieldId: 'passport_number',
        fieldLabel: 'Passport Number',
        sessionId: 'sess-1',
        value: 'AB123456',
        sourceFile: 'passport.pdf',
        sourcePage: 1,
        sourceText: 'Passport AB123456',
        reason: 'Found in source',
        confidence: 'high',
      },
    })

    expect(await screen.findByText('AB123456')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => {
      expect(screen.queryByText('AB123456')).not.toBeInTheDocument()
    })
  })

  it('sends accept and reject messages for suggestion actions', async () => {
    const chromeMock = installChromeMock()
    const { default: SidePanel } = await import('../../../src/sidepanel/SidePanel')
    render(<SidePanel />)

    chromeMock.runtimeMessageListener?.({
      type: 'NEW_SUGGESTION',
      payload: {
        id: 's2',
        fieldId: 'passport_number',
        fieldLabel: 'Passport Number',
        sessionId: 'sess-2',
        value: 'CD987654',
        sourceFile: 'passport.pdf',
        sourcePage: 1,
        sourceText: 'Passport CD987654',
        reason: 'Found in source',
        confidence: 'high',
      },
    })

    await screen.findByText('CD987654')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(chromeMock.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SUGGESTION_ACCEPTED' })
    )

    chromeMock.runtimeMessageListener?.({
      type: 'NEW_SUGGESTION',
      payload: {
        id: 's3',
        fieldId: 'email',
        fieldLabel: 'Email',
        sessionId: 'sess-3',
        value: 'user@example.com',
        sourceFile: 'note.txt',
        sourceText: 'user@example.com',
        reason: 'Found in note',
        confidence: 'medium',
      },
    })
    await screen.findByText('user@example.com')
    const emailValueNode = screen.getByText('user@example.com')
    const emailCard = emailValueNode.closest('li')
    expect(emailCard).not.toBeNull()
    const rejectButton = emailCard?.querySelector('button:last-of-type') as HTMLButtonElement
    fireEvent.click(rejectButton)
    expect(chromeMock.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SUGGESTION_REJECTED',
        payload: { fieldId: 'email' },
      })
    )
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
})
