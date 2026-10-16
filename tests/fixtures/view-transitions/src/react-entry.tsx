// react.html's entry: a client render (no server render: the transitions are what is checked).
import { createRoot } from 'react-dom/client'

import { App } from './react-app'

createRoot(document.getElementById('root')!).render(<App />)
