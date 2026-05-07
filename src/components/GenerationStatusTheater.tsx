import { useEffect, useRef, useState } from 'react'
import './GenerationStatusTheater.css'

type Phase = 'thinking' | 'writing' | 'studio' | 'recording' | 'album'

const LINES: Record<Phase, string> = {
  thinking: 'Thinking about this corner of the world…',
  writing: 'Writing the script…',
  studio: 'Setting up the studio…',
  recording: 'Recording your guide…',
  album: 'Sketching the walking tour…',
}

/** Narrative order; cycles on a timer independent of script/audio readiness. */
const LINE_ORDER: Phase[] = ['thinking', 'writing', 'studio', 'recording', 'album']

const TYPEWRITER_MS = 14
const WIPE_MS = 110
const AFTER_WIPE_MS = 130
/** Pause after a line finishes typing before the next line starts. */
const HOLD_FULL_MS = 420
const REDUCED_ROTATE_MS = 2000

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
  void scriptBusy
  void audioPhase
  void secondariesRequestLoading
  const [cycleIdx, setCycleIdx] = useState(0)
  const [visibleLine, setVisibleLine] = useState('')
  const [wipe, setWipe] = useState(false)
  const timerIdsRef = useRef<number[]>([])

  useEffect(() => {
    for (const id of timerIdsRef.current) {
      window.clearTimeout(id)
      window.clearInterval(id)
    }
    timerIdsRef.current = []

    const phase = LINE_ORDER[cycleIdx % LINE_ORDER.length]!
    const full = LINES[phase]

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      queueMicrotask(() => {
        setVisibleLine(full)
        setWipe(false)
      })
      const t = window.setTimeout(() => {
        setCycleIdx((c) => (c + 1) % LINE_ORDER.length)
      }, REDUCED_ROTATE_MS)
      timerIdsRef.current.push(t)
      return () => {
        window.clearTimeout(t)
        timerIdsRef.current = []
      }
    }

    queueMicrotask(() => setWipe(true))
    const wipeT = window.setTimeout(() => {
      setVisibleLine('')
      setWipe(false)
    }, WIPE_MS)
    timerIdsRef.current.push(wipeT)

    const startT = window.setTimeout(() => {
      let i = 0
      const intervalId = window.setInterval(() => {
        i += 1
        setVisibleLine(full.slice(0, i))
        if (i >= full.length) {
          window.clearInterval(intervalId)
          timerIdsRef.current = timerIdsRef.current.filter((id) => id !== intervalId)
          const advanceId = window.setTimeout(() => {
            setCycleIdx((c) => (c + 1) % LINE_ORDER.length)
          }, HOLD_FULL_MS)
          timerIdsRef.current.push(advanceId)
        }
      }, TYPEWRITER_MS)
      timerIdsRef.current.push(intervalId)
    }, AFTER_WIPE_MS)
    timerIdsRef.current.push(startT)

    return () => {
      for (const id of timerIdsRef.current) {
        window.clearTimeout(id)
        window.clearInterval(id)
      }
      timerIdsRef.current = []
    }
  }, [cycleIdx])

  return (
    <div className={`gen-theater${wipe ? ' gen-theater--wipe' : ''}`} aria-live="polite">
      <p className="gen-theater-line">{visibleLine}</p>
    </div>
  )
}
