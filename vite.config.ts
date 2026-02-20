import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx, defineManifest } from '@crxjs/vite-plugin'

const manifest = defineManifest({
  manifest_version: 3,
  name: 'FormBuddy',
  version: '0.1.0',
  description: 'Universal form-filling assistant powered by your personal documents',
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'sidePanel',
    'webNavigation',
    'tabs',
    'contextMenus',
  ],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'FormBuddy',
  },
  options_ui: {
    page: 'src/popup/index.html',
    open_in_tab: true,
  },
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
})

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    // PDF.js and Tesseract.js are large — expected for an extension
    chunkSizeWarningLimit: 1500,
  },
})
