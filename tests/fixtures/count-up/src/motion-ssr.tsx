// The Motion page's server render: tests/count-up.mjs builds this for Node and injects the HTML into motion.html, so
// the checks see what a Next page ships before hydration: the final values.
import { renderToString } from 'react-dom/server'

import { App } from './motion-app'

export function render(): string {
  return renderToString(<App />)
}
