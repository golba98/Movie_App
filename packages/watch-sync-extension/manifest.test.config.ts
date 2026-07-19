import { createManifest } from './manifest.config'

export default createManifest(
  [
    'http://127.0.0.1:4300/*',
    'http://127.0.0.1:4301/*',
  ],
  'Fedora Movies Watch Sync (Test)',
)
