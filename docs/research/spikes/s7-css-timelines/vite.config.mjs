import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const pages = Object.fromEntries(
  readdirSync(resolve(root, 'pages'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, 'pages', f)])
)

// Production build served by `vite preview`. The fixtures are CSS; the only
// script is the read-out helper (src/probe.js).
export default defineConfig({
  root,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    // keep every <style> exactly as written: no CSS minification or lowering
    cssMinify: false,
    cssTarget: 'esnext',
    target: 'esnext',
    rollupOptions: { input: pages }
  }
})
