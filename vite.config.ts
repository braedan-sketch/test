import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves this repo at /test/. Local preview stays relative.
  base: process.env.GITHUB_PAGES === 'true' ? '/test/' : './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
