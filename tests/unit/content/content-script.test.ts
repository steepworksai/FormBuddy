import { beforeEach, describe, expect, it, vi } from 'vitest'

let activeDocumentListeners: Array<{
  type: string
  listener: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
}> = []

const originalAddEventListener = document.addEventListener.bind(document)

document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
  activeDocumentListeners.push({ type, listener, options })
  return originalAddEventListener(type, listener, options)
}) as typeof document.addEventListener

async function setupWithHtml(html: string) {
  vi.resetModules()
  document.body.innerHTML = html

  const sendMessageMock = vi.fn()
  const onMessageListeners: Array<(message: unknown) => void> = []

  ;(globalThis as unknown as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: (fn: (message: unknown) => void) => {
          onMessageListeners.push(fn)
        },
      },
    },
  }

  await import('../../../src/content/index')

  function dispatchFocus(element: Element) {
    const event = new FocusEvent('focusin', { bubbles: true })
    element.dispatchEvent(event)
  }

  function emitRuntimeMessage(message: unknown) {
    for (const listener of onMessageListeners) listener(message)
  }

  return { sendMessageMock, dispatchFocus, emitRuntimeMessage }
}

describe('TM4 content script behavior', () => {
  beforeEach(() => {
    for (const item of activeDocumentListeners) {
      document.removeEventListener(item.type, item.listener, item.options)
    }
    activeDocumentListeners = []
    vi.resetModules()
    document.body.innerHTML = ''
  })

  it('uses aria-label before all other label sources', async () => {
    const { sendMessageMock, dispatchFocus } = await setupWithHtml(`
      <label for="f1">FromLabelFor</label>
      <input id="f1" aria-label="FromAria" placeholder="FromPlaceholder" />
    `)

    dispatchFocus(document.getElementById('f1') as HTMLInputElement)

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FIELD_FOCUSED',
        payload: expect.objectContaining({ fieldLabel: 'FromAria' }),
      })
    )
  })

  it('falls back to label[for], then placeholder, then parent label', async () => {
    const { sendMessageMock, dispatchFocus } = await setupWithHtml(`
      <label for="f2">LabelForText</label>
      <input id="f2" />
      <input id="f3" placeholder="PlaceholderText" />
      <label>ParentLabelText <input id="f4" /></label>
    `)

    dispatchFocus(document.getElementById('f2') as HTMLInputElement)
    dispatchFocus(document.getElementById('f3') as HTMLInputElement)
    dispatchFocus(document.getElementById('f4') as HTMLInputElement)

    const labels = sendMessageMock.mock.calls
      .filter(call => call[0]?.type === 'FIELD_FOCUSED')
      .map(call => call[0].payload.fieldLabel)

    expect(labels).toEqual(['LabelForText', 'PlaceholderText', 'ParentLabelText'])
  })

  it('suppresses duplicate events for same focused element', async () => {
    const { sendMessageMock, dispatchFocus } = await setupWithHtml(`<input id="f1" aria-label="Email" />`)
    const input = document.getElementById('f1') as HTMLInputElement

    dispatchFocus(input)
    dispatchFocus(input)

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('autofills focused input and dispatches input/change events', async () => {
    const { dispatchFocus, emitRuntimeMessage } = await setupWithHtml(`<input id="f1" aria-label="First name" />`)
    const input = document.getElementById('f1') as HTMLInputElement

    const inputEventSpy = vi.fn()
    const changeEventSpy = vi.fn()
    input.addEventListener('input', inputEventSpy)
    input.addEventListener('change', changeEventSpy)

    dispatchFocus(input)
    emitRuntimeMessage({ type: 'AUTOFILL_FIELD', payload: { value: 'Alice' } })

    expect(input.value).toBe('Alice')
    expect(inputEventSpy).toHaveBeenCalledTimes(1)
    expect(changeEventSpy).toHaveBeenCalledTimes(1)
  })

  it('sends screenshot hotkey message for Cmd/Ctrl + Shift + S', async () => {
    const { sendMessageMock } = await setupWithHtml('<div></div>')
    const event = new KeyboardEvent('keydown', {
      key: 's',
      shiftKey: true,
      ctrlKey: true,
      bubbles: true,
    })
    document.dispatchEvent(event)

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'SCREENSHOT_HOTKEY' })
  })
})
