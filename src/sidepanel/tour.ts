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
          <p>Your <strong>AI-powered form assistant</strong> that fills web forms directly from your personal documents.</p>
          <p style="margin-top:8px;color:#7c3aed;font-weight:600;font-size:12px;">Let's take a quick tour ✨</p>
        `,
      },
    },
    {
      popover: {
        title: '🔒 Your Privacy, Guaranteed',
        description: `
          <div class="fb-privacy-grid">
            <div class="fb-privacy-item">
              <span class="fb-privacy-icon">📄</span>
              <span><strong>Documents stay local</strong><br/>Your files never leave your device</span>
            </div>
            <div class="fb-privacy-item">
              <span class="fb-privacy-icon">🚫</span>
              <span><strong>Zero uploads</strong><br/>No cloud storage, no syncing</span>
            </div>
            <div class="fb-privacy-item">
              <span class="fb-privacy-icon">🔑</span>
              <span><strong>Keys sandboxed</strong><br/>API keys locked in your browser only</span>
            </div>
            <div class="fb-privacy-item">
              <span class="fb-privacy-icon">🏠</span>
              <span><strong>No backend</strong><br/>FormBuddy runs entirely client-side</span>
            </div>
          </div>
          <p class="fb-privacy-note">Only matched snippets — never full documents — are sent to the AI.</p>
        `,
      },
    },
    {
      element: '#fb-settings-btn',
      popover: {
        title: '⚙️ Connect an AI Provider',
        description: `
          <p>Open <strong>Settings</strong> to add your Anthropic or OpenAI API key.</p>
          <p>This unlocks smart extraction — FormBuddy will read and understand your documents much more accurately.</p>
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
          <p>Click here to pick a folder containing your <strong>PDFs, screenshots, or notes</strong>.</p>
          <p>FormBuddy indexes them locally — no uploads, ever.</p>
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
            title: '📋 Your Indexed Documents',
            description: `
              <p>All your documents appear here with their indexing status.</p>
              <p>Check a file's checkbox to <strong>filter</strong> which documents FormBuddy searches.</p>
            `,
            side: 'bottom' as const,
          },
        },
        {
          element: '#fb-fill-section',
          popover: {
            title: '✨ Fill From My Docs',
            description: `
              <p>This is your <strong>main workspace</strong>. Enter form field names here and FormBuddy will find the matching values from your documents.</p>
            `,
            side: 'top' as const,
          },
        },
        {
          element: '#fb-scan-btn',
          popover: {
            title: '⚡ Scan &amp; Auto Fill',
            description: `
              <p>One click does everything — <strong>scans the form</strong>, finds matching values from your documents, and <strong>fills it all automatically</strong>.</p>
              <p>Results appear in the table below with their source file.</p>
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
    showProgress: true,
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
    onDestroyStarted: () => {
      void markTourDone()
      driverObj.destroy()
    },
  })

  driverObj.drive()
}
