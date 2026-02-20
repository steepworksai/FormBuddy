type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

interface FieldFocusedPayload {
  fieldId: string
  fieldLabel: string
  tagName: string
}

let lastFocusedEl: FieldElement | null = null

function isFieldElement(target: EventTarget | null): target is FieldElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function normalize(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ')
}

function getFieldLabel(el: FieldElement): string {
  const ariaLabel = normalize(el.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  if (el.id) {
    const linkedLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (linkedLabel instanceof HTMLLabelElement) {
      const labelText = normalize(linkedLabel.textContent)
      if (labelText) return labelText
    }
  }

  if ('placeholder' in el) {
    const placeholder = normalize((el as HTMLInputElement | HTMLTextAreaElement).placeholder)
    if (placeholder) return placeholder
  }

  const parentLabel = el.closest('label')
  if (parentLabel) {
    const text = normalize(parentLabel.textContent)
    if (text) return text
  }

  return ''
}

function getFieldId(el: FieldElement, fieldLabel: string): string {
  return normalize(el.id) || normalize(el.name) || fieldLabel
}

function buildPayload(el: FieldElement): FieldFocusedPayload | null {
  const fieldLabel = getFieldLabel(el)
  if (!fieldLabel) return null

  return {
    fieldId: getFieldId(el, fieldLabel),
    fieldLabel,
    tagName: el.tagName,
  }
}

document.addEventListener('focusin', (event) => {
  if (!isFieldElement(event.target)) return

  // Suppress duplicate sends when the same field is focused repeatedly.
  if (lastFocusedEl === event.target) return

  const payload = buildPayload(event.target)
  if (!payload) return

  lastFocusedEl = event.target

  chrome.runtime.sendMessage({
    type: 'FIELD_FOCUSED',
    payload,
  })
})

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type?: string
    payload?: { value?: string }
  }
  if (msg.type !== 'AUTOFILL_FIELD') return
  if (!lastFocusedEl) return

  const value = msg.payload?.value ?? ''
  if (lastFocusedEl instanceof HTMLInputElement || lastFocusedEl instanceof HTMLTextAreaElement) {
    lastFocusedEl.value = value
    lastFocusedEl.dispatchEvent(new Event('input', { bubbles: true }))
    lastFocusedEl.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  if (lastFocusedEl instanceof HTMLSelectElement) {
    const matching = Array.from(lastFocusedEl.options).find(
      option => option.value === value || option.text === value
    )
    if (matching) {
      lastFocusedEl.value = matching.value
      lastFocusedEl.dispatchEvent(new Event('input', { bubbles: true }))
      lastFocusedEl.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
})

document.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey
  const screenshotKey = event.key.toLowerCase() === 's'
  if (!modifierPressed || !event.shiftKey || !screenshotKey) return

  chrome.runtime.sendMessage({ type: 'SCREENSHOT_HOTKEY' })
})
