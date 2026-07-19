import { defineManifest } from '@crxjs/vite-plugin'

export const trustedAppMatches = [
  'https://movie-app.jordanvorster404.workers.dev/*',
  'http://127.0.0.1:4173/*',
  'http://localhost:4173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:5173/*',
]

export function createManifest(extraHostPermissions: string[] = [], name = 'Fedora Movies Watch Sync') {
  return defineManifest({
    manifest_version: 3,
    name,
    description: 'Synchronize an approved native video element with a Fedora Movies watch party.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage', 'webNavigation'],
    host_permissions: [...trustedAppMatches, ...extraHostPermissions],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    background: {
      service_worker: 'src/background.ts',
      type: 'module',
    },
    action: {
      default_title: 'Fedora Movies Watch Sync',
      default_popup: 'src/popup/index.html',
    },
    content_scripts: [{
      matches: trustedAppMatches,
      js: ['src/content/app-bridge.ts'],
      run_at: 'document_start',
    }],
  })
}

export default createManifest()
