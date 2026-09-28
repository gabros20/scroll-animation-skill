// The Motion page's server render: tests/reveal.mjs builds this for Node and injects the HTML into motion.html, so
// the checks see what a Next page ships before hydration.
import { renderToString } from 'react-dom/server'

import { App } from './motion-app'

export function render(): string {
  return renderToString(<App />)
}
