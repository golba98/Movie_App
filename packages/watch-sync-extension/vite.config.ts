import { crx } from '@crxjs/vite-plugin'
import { defineConfig } from 'vite'
import manifest from './manifest.config'
import testManifest from './manifest.test.config'

export default defineConfig({
  plugins: [crx({
    manifest: process.env.WATCH_SYNC_TEST_MANIFEST === '1' ? testManifest : manifest,
    contentScripts: {
      standaloneFiles: ['src/content/player-controller.ts'],
    },
  })],
})
