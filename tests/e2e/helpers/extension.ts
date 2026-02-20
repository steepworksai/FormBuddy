import path from 'node:path'
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'

interface SeedFile {
  name: string
  content: string
  mimeType?: string
}

export interface ExtensionHarness {
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
}

export async function launchExtensionHarness(): Promise<ExtensionHarness> {
  const extensionPath = path.resolve(process.cwd(), 'dist')
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  const serviceWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(serviceWorker.url()).host

  return { context, extensionId, serviceWorker }
}

export async function installMockDirectoryPicker(
  page: Page,
  files: SeedFile[] = [{ name: 'sample-note.txt', content: 'Sample context for FormBuddy tests.' }],
): Promise<void> {
  await page.addInitScript((seed: SeedFile[]) => {
    const store = new Map<string, { content: string; mimeType: string }>()
    for (const file of seed) {
      store.set(`/root/${file.name}`, {
        content: file.content,
        mimeType: file.mimeType ?? 'text/plain',
      })
    }

    function makeFileHandle(filePath: string) {
      const fileName = filePath.split('/').pop() ?? 'file.txt'
      return {
        kind: 'file',
        name: fileName,
        async getFile() {
          const next = store.get(filePath) ?? { content: '', mimeType: 'text/plain' }
          return new File([next.content], fileName, { type: next.mimeType })
        },
        async createWritable() {
          return {
            async write(data: string | Blob | ArrayBuffer) {
              let content = ''
              if (typeof data === 'string') {
                content = data
              } else if (data instanceof Blob) {
                content = await data.text()
              } else if (data instanceof ArrayBuffer) {
                content = new TextDecoder().decode(new Uint8Array(data))
              }
              const existing = store.get(filePath)
              store.set(filePath, { content, mimeType: existing?.mimeType ?? 'text/plain' })
            },
            async close() {
              return
            },
          }
        },
      }
    }

    function makeDirHandle(basePath: string, dirName: string) {
      return {
        kind: 'directory',
        name: dirName,
        async *values() {
          for (const [filePath] of store.entries()) {
            if (filePath.startsWith(`${basePath}/`) && !filePath.slice(basePath.length + 1).includes('/')) {
              yield makeFileHandle(filePath)
            }
          }
        },
        async getDirectoryHandle(name: string) {
          return makeDirHandle(`${basePath}/${name}`, name)
        },
        async getFileHandle(name: string, opts?: { create?: boolean }) {
          const targetPath = `${basePath}/${name}`
          if (opts?.create && !store.has(targetPath)) {
            store.set(targetPath, { content: '', mimeType: 'text/plain' })
          }
          return makeFileHandle(targetPath)
        },
      }
    }

    ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => {
      return makeDirHandle('/root', 'FormBuddyDocs')
    }
  }, files)
}
