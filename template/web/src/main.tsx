import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// duck:if ssr
// A server-rendered note link (/n/<id>) opens the note in the app.
const ssrNote = location.pathname.match(/^\/n\/([^/]+)$/)
if (ssrNote && !location.hash) history.replaceState(null, '', '/#/notes/' + ssrNote[1])
// duck:end

createRoot(document.getElementById('root')!).render(<App />)
// duck:if ssr
// The server's first paint (#ssr) gives way to the app.
document.documentElement.classList.add('hydrated')
// duck:end
