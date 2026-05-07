import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  FastForward,
  Heart,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Rewind,
  Share2,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import type { AlbumTrack, SelectedPlace } from '../lib/tourTypes'
import { googleMapsSearchUrl } from '../lib/externalLinks'
import { formatAudioTime, splitPlaceLabel } from '../lib/placeHeading'
import './TourPlayerSheet.css'

type TabId = 'player' | 'stops' | 'transcript'

function mapsHrefForTrack(track: AlbumTrack, placeSubtitle: string | undefined): string {
  if (track.googleMapsUrl?.trim()) return track.googleMapsUrl.trim()
  const q =
    track.mapsSearchQuery?.trim() ||
    `${track.title}${placeSubtitle ? ` ${placeSubtitle}` : ''}`.trim()
  return googleMapsSearchUrl(q)
}

function AlbumSkeleton() {
  return (
    <div className="tour-stops-skeleton" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="tour-stops-skeleton-card">
          <div className="tour-stops-skeleton-line tour-stops-skeleton-line--title" />
          <div className="tour-stops-skeleton-line" />
        </div>
      ))}
    </div>
  )
}

export type TourPlayerSheetProps = {
  selectedPlace: SelectedPlace
  narratorLabel: string
  scriptText: string
  scriptError: string | null
  audioError: string | null
  audioPhase: 'idle' | 'loading' | 'playing'
  currentTime: number
  duration: number
  audioPaused: boolean
  albumTracks: AlbumTrack[]
  albumError: string | null
  secondariesRequestLoading: boolean
  currentTrackIndex: number
  onBack: () => void
  /** Full dismiss (e.g. X) — exits the tour stack to the place step. */
  onDismissTour: () => void
  togglePlayPause: () => void
  seekBy: (seconds: number) => void
  seekTo: (seconds: number) => void
  goToTrack: (index: number) => void | Promise<void>
  nextTrack: () => void | Promise<void>
  prevTrack: () => void | Promise<void>
  onShare: () => boolean | Promise<boolean>
  isFavourited: boolean
  onFavouriteToggle: () => void | Promise<void>
  /** True once this place+persona exists in local saved tours (after autosave). */
  hasSavedRecord?: boolean
  onDeleteSavedTour?: () => void | Promise<void>
}

export function TourPlayerSheet({
  selectedPlace,
  narratorLabel,
  scriptText,
  scriptError,
  audioError,
  audioPhase,
  currentTime,
  duration,
  audioPaused,
  albumTracks,
  albumError,
  secondariesRequestLoading,
  currentTrackIndex,
  onBack,
  onDismissTour,
  togglePlayPause,
  seekBy,
  seekTo,
  goToTrack,
  nextTrack,
  prevTrack,
  onShare,
  isFavourited,
  onFavouriteToggle,
  hasSavedRecord = false,
  onDeleteSavedTour,
}: TourPlayerSheetProps) {
  const [tab, setTab] = useState<TabId>('player')
  const [tourMenuOpen, setTourMenuOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const tourMenuRef = useRef<HTMLDivElement | null>(null)
  const placeTitleRef = useRef<HTMLHeadingElement>(null)

  const { primary: placeTitle, secondary: placeSubtitle } = useMemo(
    () => splitPlaceLabel(selectedPlace.label),
    [selectedPlace.label],
  )

  useLayoutEffect(() => {
    placeTitleRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!tourMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (tourMenuRef.current?.contains(e.target as Node)) return
      setTourMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [tourMenuOpen])

  const durationLabel =
    duration > 0 && Number.isFinite(duration) ? formatAudioTime(duration) : '—'
  const scrubMax = duration > 0 && Number.isFinite(duration) ? duration : 0
  const canScrub = audioPhase === 'playing' && scrubMax > 0
  const showPlayingUi = audioPhase === 'playing' || audioPhase === 'idle'

  const canPrevTrack = currentTrackIndex > 0
  const canNextTrack = currentTrackIndex < albumTracks.length - 1

  const handleShareClick = useCallback(async () => {
    const ok = await onShare()
    if (ok) {
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2400)
    }
    setTourMenuOpen(false)
  }, [onShare])

  const handleFavouriteFromMenu = useCallback(async () => {
    await onFavouriteToggle()
    setTourMenuOpen(false)
  }, [onFavouriteToggle])

  const handleDeleteFromMenu = useCallback(async () => {
    await onDeleteSavedTour?.()
    setTourMenuOpen(false)
  }, [onDeleteSavedTour])

  return (
    <div className="tour-player-sheet">
      <header className="tour-player-header tour-player-header--actions">
        <button
          type="button"
          className="tour-player-back drawer-round-btn"
          onClick={onBack}
          aria-label="Back to narrator"
        >
          <ChevronLeft size={20} strokeWidth={2} aria-hidden />
        </button>
        <div className="tour-player-header-main">
          <h1 ref={placeTitleRef} tabIndex={-1} className="tour-player-place-title">
            {placeTitle}
          </h1>
          {placeSubtitle ? <p className="tour-player-place-sub">{placeSubtitle}</p> : null}
          <div className="tour-player-meta-row">
            <span className="tour-player-meta-duration">{durationLabel}</span>
            <span className="tour-player-narrated">
              Narrated by <strong>{narratorLabel}</strong>
            </span>
          </div>
        </div>
        <div className="tour-player-header-actions tour-player-header-actions--end">
          <button
            type="button"
            className="drawer-round-btn tour-player-icon-btn"
            onClick={onDismissTour}
            aria-label="Close tour"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
          <div className="tour-player-overflow-wrap" ref={tourMenuRef}>
            <button
              type="button"
              className="drawer-round-btn tour-player-icon-btn"
              aria-label="Tour actions"
              aria-expanded={tourMenuOpen}
              onClick={() => setTourMenuOpen((o) => !o)}
            >
              <MoreVertical size={18} strokeWidth={2} aria-hidden />
            </button>
            {tourMenuOpen ? (
              <div className="tour-player-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="tour-player-popover-item"
                  onClick={() => void handleFavouriteFromMenu()}
                  disabled={albumTracks.length === 0}
                >
                  <Heart size={16} strokeWidth={2} aria-hidden fill={isFavourited ? 'currentColor' : 'none'} />
                  <span>{isFavourited ? 'Unfavourite' : 'Favourite'}</span>
                </button>
                <button type="button" role="menuitem" className="tour-player-popover-item" onClick={() => void handleShareClick()}>
                  {shareCopied ? <Check size={16} strokeWidth={2} aria-hidden /> : <Share2 size={16} strokeWidth={2} aria-hidden />}
                  <span>{shareCopied ? 'Link copied' : 'Share'}</span>
                </button>
                {hasSavedRecord && onDeleteSavedTour ? (
                  <button type="button" role="menuitem" className="tour-player-popover-item tour-player-popover-item--danger" onClick={() => void handleDeleteFromMenu()}>
                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                    <span>Delete from this device</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="tour-player-tabs" role="tablist" aria-label="Tour views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'player'}
          className={`tour-player-tab${tab === 'player' ? ' tour-player-tab--active' : ''}`}
          onClick={() => setTab('player')}
        >
          Player
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stops'}
          className={`tour-player-tab${tab === 'stops' ? ' tour-player-tab--active' : ''}`}
          onClick={() => setTab('stops')}
        >
          Stops
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'transcript'}
          className={`tour-player-tab${tab === 'transcript' ? ' tour-player-tab--active' : ''}`}
          onClick={() => setTab('transcript')}
        >
          Transcript
        </button>
      </nav>

      <div className="tour-player-panels">
        {tab === 'player' && (
          <div
            key="panel-player"
            className="tour-player-panel tour-player-panel--player tour-player-panel-animate"
            role="tabpanel"
          >
            {(scriptError || audioError) && (
              <p className="field-hint field-hint-warn tour-player-alert" role="alert">
                {scriptError ?? audioError}
              </p>
            )}

            <div className="tour-player-transport tour-player-transport--wide">
              <button
                type="button"
                className="tour-player-skip tour-player-skip--ghost"
                onClick={() => void prevTrack()}
                disabled={!canPrevTrack}
                aria-label="Previous track"
              >
                <SkipBack size={22} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="tour-player-skip"
                onClick={() => seekBy(-15)}
                disabled={!canScrub}
                aria-label="Skip back 15 seconds"
              >
                <Rewind size={26} strokeWidth={1.75} aria-hidden />
                <span className="tour-player-skip-cap">15s</span>
              </button>
              <button
                type="button"
                className="tour-player-play"
                onClick={togglePlayPause}
                disabled={audioPhase === 'loading' || (!scriptText.trim() && audioPhase === 'idle')}
                aria-label={audioPaused || audioPhase === 'idle' ? 'Play' : 'Pause'}
              >
                {audioPhase === 'loading' ? (
                  <Loader2 className="tour-player-play-loading-icon" size={32} strokeWidth={2} aria-hidden />
                ) : audioPaused || audioPhase === 'idle' ? (
                  <Play size={36} fill="currentColor" aria-hidden />
                ) : (
                  <Pause size={36} fill="currentColor" aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="tour-player-skip"
                onClick={() => seekBy(15)}
                disabled={!canScrub}
                aria-label="Skip forward 15 seconds"
              >
                <FastForward size={26} strokeWidth={1.75} aria-hidden />
                <span className="tour-player-skip-cap">15s</span>
              </button>
              <button
                type="button"
                className="tour-player-skip tour-player-skip--ghost"
                onClick={() => void nextTrack()}
                disabled={!canNextTrack}
                aria-label="Next track"
              >
                {canNextTrack && albumTracks[currentTrackIndex + 1]?.status !== 'ready' ? (
                  <Loader2 className="tour-player-play-loading-icon" size={22} strokeWidth={2} aria-hidden />
                ) : (
                  <SkipForward size={22} strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>

            <div className="tour-player-scrub">
              <span className="tour-player-time">{formatAudioTime(currentTime)}</span>
              <input
                type="range"
                className="tour-player-range"
                min={0}
                max={scrubMax || 1}
                step={0.25}
                value={Math.min(currentTime, scrubMax || 0)}
                disabled={!canScrub}
                aria-label="Playback position"
                onChange={(e) => seekTo(Number(e.target.value))}
              />
              <span className="tour-player-time">{durationLabel}</span>
            </div>
          </div>
        )}

        {tab === 'transcript' && (
          <div
            key="panel-transcript"
            className="tour-player-panel tour-player-panel--transcript tour-player-panel-animate"
            role="tabpanel"
          >
            <div className="tour-transcript-body tour-transcript-body--tab tour-transcript-body--all">
              {albumTracks.some((tr) => tr.scriptText.trim()) ? (
                albumTracks.map((tr) =>
                  tr.scriptText.trim() ? (
                    <section key={tr.id} className="tour-transcript-block">
                      <h3 className="tour-transcript-block-title">{tr.title}</h3>
                      <p className="tour-transcript-text">{tr.scriptText.trim()}</p>
                    </section>
                  ) : null,
                )
              ) : scriptText.trim() ? (
                <p className="tour-transcript-text">{scriptText.trim()}</p>
              ) : (
                <p className="field-hint">No transcript yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'stops' && (
          <div
            key="panel-stops"
            className="tour-player-panel tour-player-panel--stops tour-player-panel-animate"
            role="tabpanel"
          >
            <div className="tour-stops-scroll">
              {secondariesRequestLoading && albumTracks.length <= 1 ? (
                <>
                  <p className="tour-stops-status">Planning walking tour…</p>
                  <AlbumSkeleton />
                </>
              ) : albumError && albumTracks.length <= 1 ? (
                <p className="field-hint field-hint-warn" role="alert">
                  {albumError}
                </p>
              ) : albumTracks.length === 0 ? (
                <p className="field-hint">No stops yet.</p>
              ) : (
                <ul className="tour-stops-list tour-stops-list--timeline">
                  {albumTracks.map((track, idx) => {
                    const dim = track.status !== 'ready' || !track.audioObjectUrl
                    const active = idx === currentTrackIndex
                    const mapsHref = mapsHrefForTrack(track, placeSubtitle)
                    const wikiHref = track.wikipediaUrl?.trim()
                    const desc =
                      track.description?.trim() ||
                      (track.scriptText
                        ? `${track.scriptText.trim().slice(0, 120)}${track.scriptText.length > 120 ? '…' : ''}`
                        : '')
                    const showSpinner = track.status === 'synthesizing' || (dim && active)
                    const playingThisStop =
                      active && audioPhase === 'playing' && !audioPaused && !dim
                    return (
                      <li key={track.id} className="tour-stop-row">
                        <button
                          type="button"
                          className={`tour-stop-dot-btn${active ? ' tour-stop-dot-btn--active' : ''}`}
                          aria-label={`Stop ${idx + 1}`}
                          onClick={() => void goToTrack(idx)}
                        >
                          <span className="tour-stop-dot-inner">{idx + 1}</span>
                        </button>
                        <div
                          role="button"
                          tabIndex={0}
                          className={`tour-stop-card${dim ? ' tour-stop-card--pending' : ''}${active ? ' tour-stop-card--active' : ''}`}
                          onClick={() => void goToTrack(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              void goToTrack(idx)
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="tour-stop-card-play"
                            aria-label={
                              showSpinner
                                ? 'Preparing audio'
                                : playingThisStop
                                  ? 'Pause this stop'
                                  : active
                                    ? 'Resume this stop'
                                    : dim
                                      ? 'Prepare audio for this stop'
                                      : 'Play this stop'
                            }
                            disabled={false}
                            onClick={(e) => {
                              e.stopPropagation()
                              void goToTrack(idx)
                            }}
                          >
                            {showSpinner ? (
                              <Loader2 className="tour-stop-card-play-spin" size={20} strokeWidth={2} aria-hidden />
                            ) : playingThisStop ? (
                              <Pause size={20} fill="currentColor" aria-hidden />
                            ) : (
                              <Play size={20} fill="currentColor" aria-hidden />
                            )}
                          </button>
                          <div className="tour-stop-card-body">
                            <h3 className="tour-stop-name">{track.title}</h3>
                            {desc ? <p className="tour-stop-desc">{desc}</p> : null}
                            {track.status === 'error' && track.errorMessage ? (
                              <p className="field-hint field-hint-warn">{track.errorMessage}</p>
                            ) : null}
                            <div className="tour-stop-links">
                              <a
                                href={mapsHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="tour-stop-link"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Google Maps
                              </a>
                              {wikiHref ? (
                                <a
                                  href={wikiHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="tour-stop-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Wikipedia
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {showPlayingUi && (
              <div className="tour-mini-player">
                <button
                  type="button"
                  className="tour-mini-player-playbtn"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePlayPause()
                  }}
                  aria-label={audioPaused || audioPhase === 'idle' ? 'Play' : 'Pause'}
                >
                  {audioPaused || audioPhase === 'idle' ? (
                    <Play size={22} fill="currentColor" aria-hidden />
                  ) : (
                    <Pause size={22} fill="currentColor" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className="tour-mini-player-expand"
                  onClick={() => setTab('player')}
                  aria-label="Open player"
                >
                  <span className="tour-mini-player-bar-wrap">
                    <span
                      className="tour-mini-player-bar"
                      style={{
                        width: `${scrubMax > 0 ? Math.min(100, (currentTime / scrubMax) * 100) : 0}%`,
                      }}
                    />
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
