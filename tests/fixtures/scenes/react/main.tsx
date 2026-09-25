import { hydrateRoot } from 'react-dom/client'

import { App } from './App'

// Hydrates the markup tests/scene-traces.mjs server-rendered into #root at
// build time (server.tsx), the way ScrubVideo ships under Next. The page is
// its full height from the first layout, which is where browsers restore the
// scroll position on reload; rendered on the client instead, the page is still
// short then, the restore clamps to the top, and the reload case never mounts
// the scene mid-range.
hydrateRoot(document.getElementById('root')!, <App />)
