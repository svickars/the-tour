import { useCallback, useEffect, useMemo, useState } from 'react'
import App from './App'
import { NavContext, type NavApi } from './NavContext'
import { PrivacyPage } from './pages/PrivacyPage'

function normalizePath(path: string): string {
  const p = path.replace(/\/$/, '') || '/'
  return p
}

export function Root() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname))

  const go = useCallback((to: string) => {
    if (/^https?:\/\//i.test(to)) {
      window.location.assign(to)
      return
    }
    window.history.pushState(null, '', to)
    setPath(normalizePath(window.location.pathname))
  }, [])

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const nav = useMemo<NavApi>(() => ({ go }), [go])

  useEffect(() => {
    const p = normalizePath(path)
    document.title = p === '/privacy' ? 'Privacy · Elsewhere' : 'Elsewhere'
  }, [path])

  const route = normalizePath(path)
  return (
    <NavContext.Provider value={nav}>
      {route === '/privacy' ? <PrivacyPage /> : <App />}
    </NavContext.Provider>
  )
}
