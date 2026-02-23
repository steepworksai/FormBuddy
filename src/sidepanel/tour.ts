import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './tour.css'

const STORAGE_KEY = 'formbuddy_tour_done'

export async function isTourDone(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, r => resolve(!!r[STORAGE_KEY]))
  })
}

export async function markTourDone(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: true }, resolve)
  })
}

export function startTour(hasFolder: boolean): void {
  const baseSteps = [
    {
      popover: {
        title: '👋 Welcome to FormBuddy',
        description: `
          <p>Your <strong>AI-powered form assistant</strong> — paste a key, pick a folder, and it fills any web form from your documents.</p>
          <p style="margin-top:8px;font-size:12px;color:#6b7280;">🔒 Everything stays on your device. No uploads, no backend.</p>
        `,
      },
    },
    {
      element: '#fb-settings-btn',
      popover: {
        title: '🤖 Connect an AI Provider',
        description: `
          <p>Click here to add your API key. <strong>Google Gemini is free</strong> — no credit card needed.</p>
          <p style="margin-top:8px;font-size:11px;color:#6b7280;">Claude and GPT-4o are also supported.</p>
        `,
        side: 'bottom' as const,
        align: 'end' as const,
      },
    },
    {
      element: '#fb-choose-folder',
      popover: {
        title: '📂 Connect Your Documents',
        description: `
          <p>Pick a folder of <strong>PDFs, images, or notes</strong>. FormBuddy indexes them locally — nothing leaves your device.</p>
        `,
        side: 'bottom' as const,
        align: 'center' as const,
      },
    },
  ]

  const folderSteps = hasFolder
    ? [
      {
        element: '#fb-file-list',
        popover: {
          title: '📋 Your Documents',
          description: `
              <p>Indexed files appear here. <strong>Check specific files</strong> to limit which ones FormBuddy searches.</p>
            `,
          side: 'bottom' as const,
        },
      },
      {
        element: '#fb-scan-btn',
        popover: {
          title: '⚡ Scan &amp; Auto Fill',
          description: `
              <p>One click — <strong>detects all fields</strong> on this page, matches values from your documents, and fills everything automatically.</p>
            `,
          side: 'top' as const,
          align: 'center' as const,
        },
      },
    ]
    : []

  const finalStep = [
    {
      popover: {
        title: '🚀 You\'re all set!',
        description: `
          <p>${hasFolder
            ? 'Click <strong>Scan &amp; Auto Fill</strong> on any web form and watch FormBuddy handle it!'
            : 'Start by clicking <strong>Choose Folder</strong> to connect your documents.'
          }</p>
          <p style="margin-top:10px;font-size:11px;color:#9ca3af;">You can replay this tour anytime using the <strong>?</strong> icon.</p>
        `,
      },
    },
  ]

  const driverObj = driver({
    showProgress: false,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    stagePadding: 8,
    stageRadius: 10,
    popoverClass: 'fb-tour-popover',
    progressText: 'Step {{current}} of {{total}}',
    nextBtnText: 'Next &rarr;',
    prevBtnText: '&larr; Back',
    doneBtnText: hasFolder ? 'Let\'s go! 🚀' : 'Got it! 🎉',
    steps: [...baseSteps, ...folderSteps, ...finalStep],
    onPopoverRender: (popover) => {
      if (driverObj.isLastStep()) return
      const skipBtn = document.createElement('button')
      skipBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
          fill="none" stroke="#fff" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"
          style="display:inline-block;vertical-align:middle;margin-right:5px;margin-bottom:1px;flex-shrink:0">
          <polygon points="13 19 22 12 13 5 13 19"/>
          <polygon points="2 19 11 12 2 5 2 19"/>
        </svg>Skip`
      skipBtn.className = 'fb-tour-skip-btn'
      Object.assign(skipBtn.style, {
        background: 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
        color: '#ffffff',
        border: 'none',
        borderRadius: '10px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: '700',
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: '0.2px',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 14px rgba(100,116,139,0.4)',
        display: 'inline-flex',
        alignItems: 'center',
        textDecoration: 'none',
      })
      skipBtn.addEventListener('click', () => {
        void markTourDone()
        driverObj.destroy()
      })
      popover.footer.insertBefore(skipBtn, popover.footerButtons)
    },
    onDestroyStarted: () => {
      void markTourDone()
      driverObj.destroy()
    },
  })

  driverObj.drive()
}
