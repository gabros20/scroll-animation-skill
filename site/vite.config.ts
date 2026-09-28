import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import { animationHtml } from './plugins/animation-html.ts'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  // Two pages, two scroll authorities: / runs ScrollSmoother, /guide/ scrolls natively.
  appType: 'mpa',
  plugins: [animationHtml()],
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
