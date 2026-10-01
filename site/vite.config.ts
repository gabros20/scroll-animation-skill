import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

import { animationHtml } from './plugins/animation-html.ts'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * `/guide` → 301 → `/guide/`, in dev and in `vite preview`, as a static host with directory indexes does. Without it
 * a page folder typed without its slash is a 404 locally.
 */
function trailingSlash(): Plugin {
  const redirect = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [path, query] = (req.url ?? '/').split('?')
    const folder = path !== '/' && !path.endsWith('/') && !path.split('/').pop()!.includes('.')
    if (folder && existsSync(page(`.${path}/index.html`))) {
      res.statusCode = 301
      res.setHeader('Location', `${path}/${query ? `?${query}` : ''}`)
      res.end()
      return
    }
    next()
  }
  return {
    name: 'trailing-slash',
    configureServer: (server) => void server.middlewares.use(redirect),
    configurePreviewServer: (server) => void server.middlewares.use(redirect),
  }
}

export default defineConfig({
  // Two pages, two scroll authorities: / runs ScrollSmoother, /guide/ scrolls natively.
  appType: 'mpa',
  plugins: [animationHtml(), trailingSlash()],
  css: {
    postcss: {
      // Comments only: the rest ships as written (see build.cssMinify).
      plugins: [
        {
          postcssPlugin: 'strip-comments',
          Once(root) {
            root.walkComments((comment) => {
              comment.remove()
            })
          },
        },
      ],
    },
  },
  build: {
    // The blocks' CSS ships as written. Vite 8's default CSS minifier, Lightning CSS, rewrites it: for Vite's default
    // targets it turns css/scroll-effects.css's :dir(rtl) into a :lang() list, and it folds `transform`, `translate`
    // and `scale` in one block into a single transform (animation.css now resets `transform` alone for that reason).
    cssMinify: false,
    rolldownOptions: {
      input: { home: page('./index.html'), guide: page('./guide/index.html') },
      output: {
        codeSplitting: {
          groups: [
            { name: 'gsap', test: /[\\/]node_modules[\\/]gsap[\\/]/ },
            { name: 'animation', test: /[\\/]src[\\/]animation[\\/]/ },
          ],
        },
      },
    },
  },
})
