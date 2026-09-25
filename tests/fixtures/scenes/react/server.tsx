import { renderToString } from 'react-dom/server'

import { App } from './App'

// The build-time render tests/scene-traces.mjs writes into index.html's #root.
export function render(): string {
  return renderToString(<App />)
}
