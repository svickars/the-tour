import { createContext, useContext } from 'react'

export type NavApi = {
  go: (path: string) => void
}

export const NavContext = createContext<NavApi | null>(null)

export function useNav(): NavApi {
  const ctx = useContext(NavContext)
  if (!ctx) {
    return {
      go: (path: string) => {
        window.history.pushState(null, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      },
    }
  }
  return ctx
}
