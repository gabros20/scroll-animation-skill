// motion.html's entry: hydrates the server-rendered page after `?boot`. MotionProvider marks the engine ready in its
// layout effect, at hydration, so the page before that is exactly the server HTML under the gate.
import { hydrateRoot } from 'react-dom/client'

import { App, setRouteVisible } from './motion-app'
import { boot } from './boot'

boot(() => hydrateRoot(document.getElementById('root')!, <App />), {
  hide: () => setRouteVisible(false),
  show: () => setRouteVisible(true),
})
