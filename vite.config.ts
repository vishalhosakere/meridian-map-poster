import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seo } from './scripts/vite-plugin-seo'

// Local-only by policy: never expose the dev/preview servers on the LAN.
export default defineConfig({
  plugins: [react(), seo()],
  server: {
    host: '127.0.0.1',
    port: 4102,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4112,
    strictPort: true,
  },
})
