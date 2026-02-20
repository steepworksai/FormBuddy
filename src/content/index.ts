type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

interface FieldFocusedPayload {
  fieldId: string
  fieldLabel: string
  tagName: string
}

let lastFocusedEl: FieldElement | null = null
let lastHoveredEl: FieldElement | null = null
let activeFieldPayload: FieldFocusedPayload | null = null
let hoverLookupTimer: number | null = null
let hoverSuggestionCard: HTMLDivElement | null = null
let hoverCardCloseTimer: number | null = null

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

function clearHoverCard(): void {
  if (hoverCardCloseTimer !== null) {
    window.clearTimeout(hoverCardCloseTimer)
    hoverCardCloseTimer = null
  }
  if (!hoverSuggestionCard) return
  hoverSuggestionCard.remove()
  hoverSuggestionCard = null
}

function cancelHoverCardClose(): void {
  if (hoverCardCloseTimer === null) return
  window.clearTimeout(hoverCardCloseTimer)
  hoverCardCloseTimer = null
}

function scheduleHoverCardClose(delayMs = 180): void {
  cancelHoverCardClose()
  hoverCardCloseTimer = window.setTimeout(() => {
    clearHoverCard()
  }, delayMs)
}

function fillField(el: FieldElement, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  if (el instanceof HTMLSelectElement) {
    const matching = Array.from(el.options).find(
      option => option.value === value || option.text === value
    )
    if (!matching) return
    el.value = matching.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

function sendFieldLookup(el: FieldElement): void {
  const payload = buildPayload(el)
  if (!payload) return

  activeFieldPayload = payload
  chrome.runtime.sendMessage({
    type: 'FIELD_FOCUSED',
    payload,
  })
}

function showHoverSuggestionCard(target: FieldElement, suggestion: {
  id: string
  fieldId: string
  fieldLabel: string
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
  reason: string
  confidence: 'high' | 'medium' | 'low'
  sessionId: string
}): void {
  clearHoverCard()

  const rect = target.getBoundingClientRect()
  const card = document.createElement('div')
  card.style.position = 'absolute'
  card.style.zIndex = '2147483647'
  card.style.left = `${window.scrollX + rect.left}px`
  card.style.top = `${window.scrollY + rect.bottom + 6}px`
  card.style.maxWidth = '320px'
  card.style.background = '#ffffff'
  card.style.border = '1px solid #d1d5db'
  card.style.borderRadius = '8px'
  card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'
  card.style.padding = '10px'
  card.style.fontFamily = 'system-ui, sans-serif'
  card.style.fontSize = '12px'
  card.style.color = '#111827'
  card.addEventListener('mouseenter', cancelHoverCardClose)
  card.addEventListener('mouseleave', () => scheduleHoverCardClose(220))

  const title = document.createElement('div')
  title.textContent = suggestion.fieldLabel
  title.style.fontWeight = '700'
  title.style.marginBottom = '4px'

  const value = document.createElement('div')
  value.textContent = suggestion.value
  value.style.fontSize = '13px'
  value.style.fontWeight = '700'
  value.style.marginBottom = '6px'

  const meta = document.createElement('div')
  meta.textContent = `From: ${suggestion.sourceFile}${suggestion.sourcePage ? `, Page ${suggestion.sourcePage}` : ''}`
  meta.style.fontSize = '11px'
  meta.style.color = '#4b5563'
  meta.style.marginBottom = '8px'

  const row = document.createElement('div')
  row.style.display = 'flex'
  row.style.gap = '6px'

  const fillBtn = document.createElement('button')
  fillBtn.textContent = 'Fill'
  fillBtn.style.border = 'none'
  fillBtn.style.borderRadius = '5px'
  fillBtn.style.padding = '5px 10px'
  fillBtn.style.background = '#2563eb'
  fillBtn.style.color = '#ffffff'
  fillBtn.style.cursor = 'pointer'
  fillBtn.addEventListener('click', () => {
    fillField(target, suggestion.value)
    lastFocusedEl = target
    chrome.runtime.sendMessage({
      type: 'SUGGESTION_ACCEPTED',
      payload: suggestion,
    })
    clearHoverCard()
  })

  const closeBtn = document.createElement('button')
  closeBtn.textContent = 'Dismiss'
  closeBtn.style.border = '1px solid #d1d5db'
  closeBtn.style.borderRadius = '5px'
  closeBtn.style.padding = '5px 10px'
  closeBtn.style.background = '#ffffff'
  closeBtn.style.color = '#374151'
  closeBtn.style.cursor = 'pointer'
  closeBtn.addEventListener('click', clearHoverCard)

  row.append(fillBtn, closeBtn)
  card.append(title, value, meta, row)
  document.body.appendChild(card)
  hoverSuggestionCard = card
}

document.addEventListener('focusin', (event) => {
  if (!isFieldElement(event.target)) return

  // Suppress duplicate sends when the same field is focused repeatedly.
  if (lastFocusedEl === event.target) return

  lastFocusedEl = event.target
  sendFieldLookup(event.target)
})

document.addEventListener('mouseover', (event) => {
  if (!isFieldElement(event.target)) return
  if (lastHoveredEl === event.target) return

  lastHoveredEl = event.target
  if (hoverLookupTimer !== null) window.clearTimeout(hoverLookupTimer)
  hoverLookupTimer = window.setTimeout(() => {
    sendFieldLookup(event.target as FieldElement)
    hoverLookupTimer = null
  }, 220)
})

document.addEventListener('mouseout', (event) => {
  if (!isFieldElement(event.target)) return
  if (event.target !== lastHoveredEl) return
  if (hoverLookupTimer !== null) {
    window.clearTimeout(hoverLookupTimer)
    hoverLookupTimer = null
  }
  const next = event.relatedTarget
  if (hoverSuggestionCard && next instanceof Node && hoverSuggestionCard.contains(next)) {
    return
  }
  scheduleHoverCardClose()
})

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type?: string
    payload?: {
      id?: string
      fieldId?: string
      fieldLabel?: string
      value?: string
      sourceFile?: string
      sourcePage?: number
      sourceText?: string
      reason?: string
      confidence?: 'high' | 'medium' | 'low'
      sessionId?: string
    }
  }

  if (msg.type === 'AUTOFILL_FIELD') {
    if (!lastFocusedEl) return
    fillField(lastFocusedEl, msg.payload?.value ?? '')
    return
  }

  if (msg.type === 'NEW_SUGGESTION' && msg.payload?.id && msg.payload.value && msg.payload.fieldId) {
    if (activeFieldPayload?.fieldId !== msg.payload.fieldId) return

    const target = lastHoveredEl ?? lastFocusedEl
    if (!target) return

    showHoverSuggestionCard(target, {
      id: msg.payload.id,
      fieldId: msg.payload.fieldId,
      fieldLabel: msg.payload.fieldLabel ?? activeFieldPayload?.fieldLabel ?? 'Field',
      value: msg.payload.value,
      sourceFile: msg.payload.sourceFile ?? 'Unknown source',
      sourcePage: msg.payload.sourcePage,
      sourceText: msg.payload.sourceText ?? '',
      reason: msg.payload.reason ?? '',
      confidence: msg.payload.confidence ?? 'low',
      sessionId: msg.payload.sessionId ?? '',
    })
    return
  }

  if (msg.type === 'SUGGESTION_APPLIED') {
    clearHoverCard()
  }
})

document.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey
  const screenshotKey = event.key.toLowerCase() === 's'
  if (!modifierPressed || !event.shiftKey || !screenshotKey) return

  chrome.runtime.sendMessage({ type: 'SCREENSHOT_HOTKEY' })
})
