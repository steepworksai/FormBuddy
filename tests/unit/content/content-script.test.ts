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
  delete (window as Window & { __FORMBUDDY_CONTENT_INIT__?: boolean }).__FORMBUDDY_CONTENT_INIT__

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

  function dispatchHover(element: Element) {
    const event = new MouseEvent('mouseover', { bubbles: true })
    element.dispatchEvent(event)
  }

  function emitRuntimeMessage(message: unknown) {
    for (const listener of onMessageListeners) listener(message)
  }

  return { sendMessageMock, dispatchFocus, dispatchHover, emitRuntimeMessage }
}

describe('TM4 content script behavior', () => {
  beforeEach(() => {
    for (const item of activeDocumentListeners) {
      document.removeEventListener(item.type, item.listener, item.options)
    }
    activeDocumentListeners = []
    vi.resetModules()
    document.body.innerHTML = ''
    delete (window as Window & { __FORMBUDDY_CONTENT_INIT__?: boolean }).__FORMBUDDY_CONTENT_INIT__
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

    const focusedCalls = sendMessageMock.mock.calls.filter(call => call[0]?.type === 'FIELD_FOCUSED')
    expect(focusedCalls).toHaveLength(1)
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

  it('triggers lookup on hover and shows floating fill card', async () => {
    vi.useFakeTimers()
    const { sendMessageMock, dispatchHover, emitRuntimeMessage } = await setupWithHtml(
      `<input id="passport" aria-label="Passport Number" />`
    )
    const input = document.getElementById('passport') as HTMLInputElement

    dispatchHover(input)
    vi.advanceTimersByTime(250)

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FIELD_FOCUSED',
        payload: expect.objectContaining({ fieldId: 'passport', fieldLabel: 'Passport Number' }),
      })
    )

    emitRuntimeMessage({
      type: 'NEW_SUGGESTION',
      payload: {
        id: 's1',
        fieldId: 'passport',
        fieldLabel: 'Passport Number',
        value: 'P9384721',
        sourceFile: 'profile.pdf',
        confidence: 'high',
        sessionId: 'sess-1',
      },
    })

    const fillButton = Array.from(document.querySelectorAll('button')).find(
      node => node.textContent === 'Fill'
    ) as HTMLButtonElement | undefined

    expect(fillButton).toBeTruthy()
    fillButton?.click()
    expect(input.value).toBe('P9384721')
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SUGGESTION_ACCEPTED',
        payload: expect.objectContaining({ id: 's1', fieldId: 'passport', value: 'P9384721' }),
      })
    )
    vi.useRealTimers()
  })

  it('sends selected text for sidepanel search', async () => {
    const { sendMessageMock } = await setupWithHtml(`<p id="t">passport number</p>`)
    const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'passport number',
    } as unknown as Selection)

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SELECTION_CHANGED',
        payload: { text: 'passport number' },
      })
    )
    selectionSpy.mockRestore()
  })

  it('copies hover suggestion value on Space key', async () => {
    const { dispatchHover, emitRuntimeMessage } = await setupWithHtml(
      `<input id="email" aria-label="Email Address" />`
    )
    const input = document.getElementById('email') as HTMLInputElement
    const clipboardWrite = vi.fn(async () => undefined)
    ;(globalThis.navigator as Navigator & { clipboard?: { writeText: (value: string) => Promise<void> } }).clipboard = {
      writeText: clipboardWrite,
    }

    vi.useFakeTimers()
    dispatchHover(input)
    vi.advanceTimersByTime(250)
    emitRuntimeMessage({
      type: 'NEW_SUGGESTION',
      payload: {
        id: 's2',
        fieldId: 'email',
        fieldLabel: 'Email Address',
        value: 'venkatesh.poosarla@example.com',
        sourceFile: 'profile.pdf',
        confidence: 'high',
        sessionId: 'sess-2',
      },
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(clipboardWrite).toHaveBeenCalledWith('venkatesh.poosarla@example.com')
    vi.useRealTimers()
  })
})
