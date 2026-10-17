// motion.html's entry: hydrates the server-rendered page. `?progress` hydrates with progress on (the server render
// is the same: progress renders nothing).
import { hydrateRoot } from 'react-dom/client'

import { App } from './motion-app'

hydrateRoot(document.getElementById('root')!, <App progress={new URLSearchParams(location.search).has('progress')} />)
