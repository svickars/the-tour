import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type TransitionEvent } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { buildTranscriptSegments, type TranscriptHotspot } from '../lib/transcriptHotspots'

function kindEyebrow(kind: TranscriptHotspot['kind']): string {
  switch (kind) {
    case 'wikipedia':
      return 'Wikipedia'
    case 'places':
      return 'Maps & places'
    case 'inferred':
      return 'Inference'
    case 'persona':
      return 'Character & invention'
    case 'unknown':
    default:
      return 'Details'
  }
}

type TranscriptWithHotspotsProps = {
  readonly text: string
  readonly hotspots?: TranscriptHotspot[]
  /** Fired when the hotspot detail sheet is fully dismissed (after close animation). */
  readonly onHotspotSheetPresenceChange?: (open: boolean) => void
}

export function TranscriptWithHotspots({
  text,
  hotspots,
  onHotspotSheetPresenceChange,
}: TranscriptWithHotspotsProps) {
  const uid = useId()
  const sheetDomId = `hotspot-dialog-${uid.replace(/:/g, '')}`
  const sheetTitleId = `hotspot-title-${uid.replace(/:/g, '')}`
  const [hotspot, setHotspot] = useState<TranscriptHotspot | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openRunRef = useRef(0)

  const segments = buildTranscriptSegments(text, hotspots)

  const openFor = useCallback(
    (h: TranscriptHotspot, btn: HTMLButtonElement | null) => {
      lastTriggerRef.current = btn
      openRunRef.current += 1
      setHotspot(h)
      setSheetOpen(false)
      onHotspotSheetPresenceChange?.(true)
    },
    [onHotspotSheetPresenceChange],
  )

  const finishClose = useCallback(() => {
    setHotspot(null)
    setSheetOpen(false)
    onHotspotSheetPresenceChange?.(false)
    queueMicrotask(() => lastTriggerRef.current?.focus())
  }, [onHotspotSheetPresenceChange])

  const requestClose = useCallback(() => {
    setSheetOpen(false)
  }, [])

  useLayoutEffect(() => {
    if (!hotspot) return
    const run = openRunRef.current
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (openRunRef.current !== run) return
        setSheetOpen(true)
      })
    })
    return () => cancelAnimationFrame(id)
  }, [hotspot])

  useEffect(() => {
    if (!hotspot) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hotspot, requestClose])

  const onSheetPanelTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName !== 'transform') return
      if (sheetOpen) return
      if (!hotspot) return
      finishClose()
    },
    [sheetOpen, finishClose, hotspot],
  )

  const sheet =
    hotspot && typeof document !== 'undefined'
      ? createPortal(
          <div className={`tour-hotspot-sheet-root${sheetOpen ? ' tour-hotspot-sheet-root--open' : ''}`}>
            <button
              type="button"
              className="tour-hotspot-sheet-backdrop"
              aria-label="Dismiss"
              onClick={requestClose}
            />
            <div className="tour-hotspot-sheet-dock">
              <div
                id={sheetDomId}
                role="dialog"
                aria-modal="true"
                aria-labelledby={sheetTitleId}
                className="tour-hotspot-sheet-panel"
                onTransitionEnd={onSheetPanelTransitionEnd}>
              <header className="tour-hotspot-sheet-header">
                <span id={sheetTitleId} className="tour-hotspot-sheet-kind">
                  {kindEyebrow(hotspot.kind)}
                </span>
                <button
                  type="button"
                  ref={closeRef}
                  className="drawer-round-btn tour-player-icon-btn tour-hotspot-sheet-close"
                  aria-label="Close"
                  onClick={requestClose}>
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </header>
              <h4 className="tour-hotspot-sheet-title">{hotspot.title}</h4>
              <p className="tour-hotspot-sheet-body">{hotspot.body}</p>
              {hotspot.url ? (
                <a
                  href={hotspot.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tour-hotspot-sheet-link">
                  Open link
                </a>
              ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <p className="tour-transcript-text tour-transcript-text--hotspots">
        {segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return <span key={`t-${i}`}>{seg.text}</span>
          }
          const h = seg.hotspot
          return (
            <span key={`h-${h.id}-${i}`} className="tour-transcript-hotspot-wrap">
              <span className="tour-transcript-hotspot-quoted">{text.slice(h.start, h.end)}</span>
              <button
                type="button"
                className="tour-transcript-hotspot-btn"
                aria-haspopup="dialog"
                aria-expanded={hotspot?.id === h.id && sheetOpen}
                aria-controls={hotspot?.id === h.id ? sheetDomId : undefined}
                title="Source details"
                aria-label={`Details: ${h.title}`}
                onClick={(e) => openFor(h, e.currentTarget)}>
                <Info size={14} strokeWidth={2} aria-hidden />
              </button>
            </span>
          )
        })}
      </p>
      {sheet}
    </>
  )
}
