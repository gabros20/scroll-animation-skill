/**
 * plugins/render-blocking.ts — keeps `<script type="module" blocking="render" src="…">` render-blocking through the
 * build. Vite folds every module script of a page into the page's one entry chunk and writes that tag without the
 * attribute (measured on Vite 8.3: transitions.ts and home.ts became one deferred home-*.js), which would leave a
 * `pagereveal` listener late, or the whole page's JavaScript on the render path. Each blocking script is built as an
 * entry of its own instead (list it in build.rolldownOptions.input), and its tag goes back where it was, with the
 * attribute, pointing at that entry's chunk. Keep what it imports small: everything it imports blocks rendering too
 * (vite.config.ts keeps the view-transitions modules out of the `animation` chunk, which imports GSAP).
 * The dev server serves the HTML as written.
 */
import type { Plugin } from 'vite'

const BLOCKING = /<script type="module" blocking="render" src="([^"]+)"><\/script>/g
const PLACEHOLDER = /<!--render-blocking:([^>]+)-->/g

/** Two plugins: the tag comes out before Vite folds the page's scripts, and goes back once the bundle exists. */
export function renderBlocking(): Plugin[] {
  return [
    {
      name: 'render-blocking:out',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace(BLOCKING, (_, src: string) => `<!--render-blocking:${src}-->`),
      },
    },
    {
      name: 'render-blocking:in',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html, { path, bundle }) {
          return html.replace(PLACEHOLDER, (_, src: string) => {
            const chunk = Object.values(bundle ?? {}).find(
              (c) => c.type === 'chunk' && c.isEntry && c.facadeModuleId?.endsWith(src),
            )
            if (!chunk) throw new Error(`render-blocking: ${path} loads ${src}, which isn't an entry in build.rolldownOptions.input`)
            return `<script type="module" blocking="render" crossorigin src="/${chunk.fileName}"></script>`
          })
        },
      },
    },
  ]
}
