// The React page's server render: tests/header-theme.mjs builds this for Node and injects the HTML into motion.html, so
// the checks see what a Next page ships before hydration (the hook's server snapshot included).
import { renderToString } from 'react-dom/server'

import { App } from './motion-app'

export function render(): string {
  return renderToString(<App />)
}
