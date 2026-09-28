import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server listens on localhost only; `npm run dev:lan` exposes it to
// other devices on the network (for testing on a phone or tablet).
export default defineConfig({
  plugins: [cloudflare(), react(), tailwindcss()],
})
