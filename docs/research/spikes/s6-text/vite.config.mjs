import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const pages = Object.fromEntries(
  readdirSync(resolve(root, 'pages'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, 'pages', f)])
)

// The late web font for S6a: served by the preview server itself, S6_FONT_DELAY
// ms after the request (no browser-side interception). The file is S6_FONT, or
// the first of these that exists; the runner sets both.
const FONT =
  process.env.S6_FONT ??
  ['/System/Library/Fonts/Supplemental/Courier New.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/TTF/DejaVuSansMono.ttf'].find((f) => existsSync(f))
const lateFont = {
  name: 'late-font',
  configurePreviewServer(server) {
    server.middlewares.use('/__late-font', (req, res) => {
      const delay = Number(process.env.S6_FONT_DELAY ?? 1000)
      setTimeout(() => {
        res.setHeader('Content-Type', 'font/ttf')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(FONT))
      }, delay)
    })
  }
}

// Production build (React prod) served by `vite preview`.
// @gsap/react is only installed at the repository root; dedupe makes it share
// this folder's react and gsap (../node_modules) instead of loading second copies.
export default defineConfig({
  root,
  logLevel: 'warn',
  plugins: [lateFont],
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom', 'gsap'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    cssMinify: false,
    target: 'esnext',
    rollupOptions: { input: pages }
  }
})
