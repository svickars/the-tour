import { useEffect, useState } from 'react'
import type { PersonaId } from '../lib/personas'
import { loadingDisclaimerFor } from '../lib/loadingDisclaimer'
import './LoadingDisclaimer.css'

const FADE_IN_DELAY_MS = 420

type LoadingDisclaimerProps = {
  persona: PersonaId
}

export function LoadingDisclaimer({ persona }: LoadingDisclaimerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      queueMicrotask(() => setVisible(true))
      return undefined
    }
    const t = window.setTimeout(() => setVisible(true), FADE_IN_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [persona])

  return (
    <p
      role="note"
      className={`gen-loading-disclaimer${visible ? ' gen-loading-disclaimer--visible' : ''}`}
    >
      {loadingDisclaimerFor(persona)}
    </p>
  )
}
