import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx, defineManifest } from '@crxjs/vite-plugin'

const manifest = defineManifest({
  manifest_version: 3,
  name: 'FormBuddy',
  version: '1.0.0',
  description: 'Fill any web form instantly from your personal documents — locally, privately, with AI-powered suggestions and full citations.',
  homepage_url: 'https://steepworksai.github.io/FormBuddy/',
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
      all_frames: true,
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
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
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
    // PDF.js worker is large — expected for an extension
    chunkSizeWarningLimit: 1500,
  },
})
