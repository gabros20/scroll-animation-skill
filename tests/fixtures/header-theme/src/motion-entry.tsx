// motion.html's entry: hydrates the server-rendered page.
import { hydrateRoot } from 'react-dom/client'

import { App } from './motion-app'

hydrateRoot(document.getElementById('root')!, <App />)
