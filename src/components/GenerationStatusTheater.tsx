import { useEffect, useMemo, useRef, useState } from 'react'
import './GenerationStatusTheater.css'

type Phase = 'thinking' | 'writing' | 'studio' | 'recording' | 'album'

const LINES: Record<Phase, string> = {
  thinking: 'Thinking about this corner of the world…',
  writing: 'Writing the script…',
  studio: 'Setting up the studio…',
  recording: 'Recording your guide…',
  album: 'Sketching the walking tour…',
}

export type GenerationStatusTheaterProps = {
  scriptBusy: boolean
  audioPhase: 'idle' | 'loading' | 'playing'
  secondariesRequestLoading: boolean
}

export function GenerationStatusTheater({
  scriptBusy,
  audioPhase,
  secondariesRequestLoading,
}: GenerationStatusTheaterProps) {
  const phase: Phase = useMemo(() => {
    if (scriptBusy) return 'writing'
    if (audioPhase === 'loading') return 'recording'
    if (audioPhase === 'playing' && secondariesRequestLoading) return 'album'
    if (audioPhase === 'playing') return 'album'
    return 'thinking'
  }, [scriptBusy, audioPhase, secondariesRequestLoading])

  const [visibleLine, setVisibleLine] = useState('')
  const [wipe, setWipe] = useState(false)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const full = LINES[phase]
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      queueMicrotask(() => {
        setVisibleLine(full)
        setWipe(false)
      })
      return
    }

    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    queueMicrotask(() => setWipe(true))
    const wipeT = window.setTimeout(() => {
      setVisibleLine('')
      setWipe(false)
    }, 110)

    const startT = window.setTimeout(() => {
      let i = 0
      intervalRef.current = window.setInterval(() => {
        i += 1
        setVisibleLine(full.slice(0, i))
        if (i >= full.length && intervalRef.current != null) {
          window.clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }, 14)
    }, 130)

    return () => {
      window.clearTimeout(wipeT)
      window.clearTimeout(startT)
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [phase])

  return (
    <div className={`gen-theater${wipe ? ' gen-theater--wipe' : ''}`} aria-live="polite">
      <p className="gen-theater-line">{visibleLine}</p>
    </div>
  )
}
