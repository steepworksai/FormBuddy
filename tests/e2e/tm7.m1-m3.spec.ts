import path from 'node:path'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'

test.describe('TM7 — E2E milestones 1-3', () => {
  let context: BrowserContext
  let extensionId = ''

  test.beforeAll(async () => {
    const extensionPath = path.resolve(process.cwd(), 'dist')

    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })

    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    extensionId = new URL(sw.url()).host
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('TM7.1 extension service worker is active', async () => {
    expect(extensionId.length).toBeGreaterThan(5)
  })

  test('TM7.2 sidepanel app renders', async () => {
    const page = await context.newPage()
    await page.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_DISABLE_TOUR__?: boolean }).__FORMBUDDY_DISABLE_TOUR__ = true
    })
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)

    await expect(page.getByAltText('FormBuddy')).toBeVisible()
    await expect(page.locator('#fb-choose-folder')).toBeVisible()
  })

  test('TM7.3 folder selection shows file listing with mocked local docs', async () => {
    const page = await context.newPage()

    await page.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_DISABLE_TOUR__?: boolean }).__FORMBUDDY_DISABLE_TOUR__ = true

      const store = new Map<string, string>()
      store.set('/root/sample-note.txt', 'This is a sample note for TM7.')

      function makeFileHandle(filePath: string) {
        const fileName = filePath.split('/').pop() ?? 'file.txt'
        return {
          kind: 'file',
          name: fileName,
          async getFile() {
            const content = store.get(filePath) ?? ''
            return new File([content], fileName, { type: 'text/plain' })
          },
          async createWritable() {
            return {
              async write(data: string | Blob | ArrayBuffer) {
                if (typeof data === 'string') {
                  store.set(filePath, data)
                  return
                }
                if (data instanceof Blob) {
                  store.set(filePath, await data.text())
                  return
                }
                if (data instanceof ArrayBuffer) {
                  store.set(filePath, new TextDecoder().decode(new Uint8Array(data)))
                }
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
            if (basePath === '/root') {
              yield makeFileHandle('/root/sample-note.txt')
            }
          },
          async getDirectoryHandle(name: string, _opts?: { create?: boolean }) {
            return makeDirHandle(`${basePath}/${name}`, name)
          },
          async getFileHandle(name: string, opts?: { create?: boolean }) {
            const targetPath = `${basePath}/${name}`
            if (opts?.create && !store.has(targetPath)) store.set(targetPath, '')
            return makeFileHandle(targetPath)
          },
        }
      }

      ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => {
        return makeDirHandle('/root', 'FormBuddyDocs')
      }
    })

    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await page.locator('#fb-choose-folder').click()

    await expect(page.getByText('sample-note.txt')).toBeVisible()
    await expect(page.getByText('FormBuddyDocs')).toBeVisible()
  })
})
