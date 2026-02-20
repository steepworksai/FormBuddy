// FormBuddy — Background Service Worker

// Open the side panel when the toolbar icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FormBuddy] Extension installed.')
})

interface FieldFocusedPayload {
  fieldId: string
  fieldLabel: string
  tagName?: string
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'FIELD_FOCUSED') return

  const payload = message.payload as FieldFocusedPayload
  if (!payload?.fieldId || !payload?.fieldLabel) return

  console.log('[FormBuddy] FIELD_FOCUSED', {
    fieldId: payload.fieldId,
    fieldLabel: payload.fieldLabel,
    tagName: payload.tagName,
    url: sender.url ?? sender.tab?.url ?? 'unknown',
    tabId: sender.tab?.id,
  })

  chrome.runtime.sendMessage({
    type: 'FIELD_DETECTED',
    payload: {
      fieldId: payload.fieldId,
      fieldLabel: payload.fieldLabel,
      detectedAt: new Date().toISOString(),
    },
  })
})
