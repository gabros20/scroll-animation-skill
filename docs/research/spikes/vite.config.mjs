import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
// SPIKE_PAGES=s2 limits the build to pages/s2*.html (set by run/harness.mjs).
const prefix = process.env.SPIKE_PAGES ?? ''
const pages = Object.fromEntries(
  readdirSync(resolve(root, 'pages'))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, 'pages', f)])
)

// Production build (React prod, no HMR client) served by `vite preview`, so the
// per-frame numbers are not inflated by dev-mode overhead.
export default defineConfig({
  root,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: pages,
      // framer-motion's per-file "use client" directives are meaningless in a client bundle
      onwarn(w, warn) {
        if (w.code !== 'MODULE_LEVEL_DIRECTIVE') warn(w)
      }
    }
  }
})
