import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Check,
  ChevronLeft,
  Dices,
  Heart,
  Loader2,
  MapPin,
  MoreVertical,
  Pencil,
  RotateCcw,
  Share2,
  Shuffle,
  Trash2,
} from 'lucide-react'
import { GenerationStatusTheater } from './components/GenerationStatusTheater'
import { PlacesSearch } from './components/PlacesSearch'
import { TourPlayerSheet } from './components/TourPlayerSheet'
import './components/TourPlayerSheet.css'
import {
  pickRandomPlace,
  pickSuggestedPlaces,
  publicAssetUrl,
  SUGGESTED_PLACES_POOL,
  type SuggestedPlace,
} from './data/suggestedPlaces'
import { useGeolocationOnDemand } from './hooks/useGeolocationOnDemand'
import { useOnboardingFlow } from './hooks/useOnboardingFlow'
import {
  type SelectedPlace,
  useTourEngine,
} from './hooks/useTourEngine'
import { type PersonaId, PERSONAS } from './lib/personas'
import { useNav } from './NavContext'
import {
  albumTracksFromSaved,
  deleteAllNonFavouritedTours,
  deleteSavedTour,
  findSavedTourByFingerprint,
  listSavedTours,
  placeFingerprint,
  shareLabelForSavedTour,
  updateSavedTourFavourite,
  updateSavedTourSavedLabel,
  upsertTourFromAlbum,
  type SavedTourRecord,
} from './lib/savedToursDb'
import { buildTourShareUrl, parseTourSearchParams, tourParamsToSelectedPlace, type TourUrlParams } from './lib/deepLink'
import { shortenSavedPlaceTitle } from './lib/placeHeading'
import './App.css'

const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

function placeKey(p: SelectedPlace): string {
  if (p.placeId?.trim()) return `pid:${p.placeId.trim()}`
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
}

function suggestedToSelected(s: SuggestedPlace): SelectedPlace {
  return {
    label: `${s.name}, ${s.descriptor}`,
    lat: s.lat,
    lng: s.lng,
  }
}

function suggestThumbInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0]![0]!
    const b = parts[1]![0]!
    return `${a.toLocaleUpperCase()}${b.toLowerCase()}`
  }
  const w = parts[0] ?? '?'
  if (w.length >= 2) return `${w[0]!.toLocaleUpperCase()}${w[1]!.toLowerCase()}`
  return w.slice(0, 1).toLocaleUpperCase()
}

function SuggestedPlaceCardButton({
  place,
  selected,
  onPick,
}: {
  place: SuggestedPlace
  selected: boolean
  onPick: () => void
}) {
  const [coverBroken, setCoverBroken] = useState(false)
  const coverPath = place.coverSrc?.trim()
  const showCover = Boolean(coverPath) && !coverBroken

  return (
    <button
      type="button"
      role="listitem"
      className={`suggest-card suggest-card-landscape suggest-card-photo${selected ? ' suggest-card-selected' : ''}`}
      onClick={onPick}
    >
      <span className="suggest-card-visual" aria-hidden>
        {showCover && coverPath ? (
          <img
            className="suggest-card-bg-img"
            src={publicAssetUrl(coverPath)}
            alt=""
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <span className="suggest-card-bg-fallback" />
        )}
        {!showCover ? (
          <span className="suggest-card-fallback-letters">{suggestThumbInitials(place.name)}</span>
        ) : null}
        <span className="suggest-card-bg-overlay" />
      </span>
      <div className="suggest-card-text suggest-card-text--on-photo">
        <span className="suggest-name">{place.name}</span>
        <span className="suggest-desc">{place.descriptor}</span>
      </div>
    </button>
  )
}

function CardBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="drawer-round-btn card-back-btn"
      onClick={onClick}
      aria-label="Back"
    >
      <ChevronLeft size={18} strokeWidth={2} aria-hidden />
    </button>
  )
}

function DrawerRestartButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="drawer-round-btn drawer-restart-btn"
      onClick={onClick}
      aria-label="Restart from the beginning"
      title="Restart"
    >
      <RotateCcw size={20} strokeWidth={2} aria-hidden />
    </button>
  )
}

function BridgeLoadingIndicator() {
  return (
    <div className="bridge-loading" role="status" aria-label="Loading">
      <Loader2 className="bridge-loading-icon" size={30} strokeWidth={1.75} aria-hidden />
    </div>
  )
}

type OnboardingDrawerProps = {
  titleId: string
  onBack: () => void
  onRestart: () => void
  bodyClassName?: string
  footer?: ReactNode
  children: ReactNode
}

function OnboardingDrawer({
  titleId,
  onBack,
  onRestart,
  bodyClassName,
  footer,
  children,
}: OnboardingDrawerProps) {
  const bodyCls = ['card-drawer-body', bodyClassName].filter(Boolean).join(' ')
  return (
    <div
      className="card-layer card-layer-front card-front-animate"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="card-drawer-header">
        <CardBackButton onClick={onBack} />
        <DrawerRestartButton onClick={onRestart} />
      </header>
      <div className={bodyCls}>{children}</div>
      {footer ? <div className="card-drawer-footer">{footer}</div> : null}
    </div>
  )
}

export default function App() {
  const nav = useNav()
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null)
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [persona, setPersona] = useState<PersonaId>('deadpan')

  const [savedList, setSavedList] = useState<SavedTourRecord[]>([])
  const [savedMenuId, setSavedMenuId] = useState<string | null>(null)
  const [savedShareOkId, setSavedShareOkId] = useState<string | null>(null)
  const [renameModal, setRenameModal] = useState<{ id: string; draft: string } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameTitleId = useId()

  const refreshSaved = useCallback(async () => {
    try {
      setSavedList(await listSavedTours())
    } catch {
      setSavedList([])
    }
  }, [])

  const favouriteList = useMemo(
    () => savedList.filter((r) => r.favourited),
    [savedList],
  )
  const historyList = useMemo(
    () => savedList.filter((r) => !r.favourited),
    [savedList],
  )

  const handleRestartApp = useCallback(() => {
    setSelectedPlace(null)
    setPersona('deadpan')
    setShuffleSeed(Math.floor(Math.random() * 1e9))
    void refreshSaved()
  }, [refreshSaved])

  const {
    prefetchLoading,
    canGenerate,
    tourBusy,
    startFullTour,
    primeAudioPlayback,
    stopTour,
    cancelTourPrep,
    scriptBusy,
    scriptError,
    audioError,
    albumError,
    audioPhase,
    scriptText,
    albumTracks,
    secondariesRequestLoading,
    currentTrackIndex,
    goToTrack,
    nextTrack,
    prevTrack,
    currentTime,
    duration,
    audioPaused,
    togglePlayPause,
    seekBy,
    seekTo,
    restoreAlbumFromTracks,
  } = useTourEngine(selectedPlace, persona)

  const flushAutosaveTour = useCallback(async () => {
    if (!selectedPlace || albumTracks.length === 0) return
    try {
      await upsertTourFromAlbum({ place: selectedPlace, persona, tracks: albumTracks })
      await refreshSaved()
    } catch {
      /* ignore persist errors */
    }
  }, [selectedPlace, persona, albumTracks, refreshSaved])

  const bridgeTourContentReady = useMemo(() => {
    const main = albumTracks[0]
    if (!main?.scriptText?.trim()) return false
    if (scriptBusy) return false
    return (
      audioPhase === 'playing' ||
      audioPhase === 'loading' ||
      Boolean(main.hasStartedPlayback) ||
      (audioPhase === 'idle' && Boolean(main.audioObjectUrl))
    )
  }, [albumTracks, scriptBusy, audioPhase])

  const { step, prefetchTimedOut, goBack, restart, advanceToPersonaBridge, overlayCoversPlace, enterTourFromLibrary, dismissTourSheet } =
    useOnboardingFlow({
      selectedPlace,
      prefetchLoading,
      canGenerate,
      bridgeTourContentReady,
      stopTour,
      cancelTourPrep,
      onRestartApp: handleRestartApp,
      beforeLeaveTour: flushAutosaveTour,
    })

  const handleDismissTour = useCallback(async () => {
    await flushAutosaveTour()
    dismissTourSheet()
  }, [flushAutosaveTour, dismissTourSheet])

  const geo = useGeolocationOnDemand()

  const suggestedVisible = useMemo(
    () => pickSuggestedPlaces(SUGGESTED_PLACES_POOL, shuffleSeed),
    [shuffleSeed],
  )

  const handleSearchSelect = useCallback((p: SelectedPlace) => {
    setSelectedPlace(p)
  }, [])

  const handleUseLocation = useCallback(() => {
    geo.request({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
      onSuccess: (lat, lng) => {
        setSelectedPlace({
          label: 'Your location',
          lat,
          lng,
        })
      },
    })
  }, [geo])

  useEffect(() => {
    stopTour()
  }, [selectedPlace?.lat, selectedPlace?.lng, stopTour])

  const selectedKey = selectedPlace ? placeKey(selectedPlace) : null

  useEffect(() => {
    queueMicrotask(() => {
      void refreshSaved()
    })
  }, [refreshSaved])

  useEffect(() => {
    const parsed = parseTourSearchParams(window.location.search)
    if (!parsed || !Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng) || !parsed.label) return
    queueMicrotask(() => {
      setSelectedPlace(
        tourParamsToSelectedPlace({
          lat: parsed.lat,
          lng: parsed.lng,
          label: parsed.label,
          persona: parsed.persona ?? 'deadpan',
          placeId: parsed.placeId,
        } as TourUrlParams),
      )
      if (parsed.persona) setPersona(parsed.persona)
      window.history.replaceState({}, '', window.location.pathname)
    })
  }, [])

  const handleShareTour = useCallback(async (): Promise<boolean> => {
    if (!selectedPlace) return false
    const fp = placeFingerprint(selectedPlace, persona)
    const hit = savedList.find((r) => placeFingerprint(r.place, r.persona) === fp)
    const label = hit ? shareLabelForSavedTour(hit) : selectedPlace.label
    const url = buildTourShareUrl({
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
      label,
      persona,
      placeId: selectedPlace.placeId,
    })
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      return false
    }
  }, [selectedPlace, persona, savedList])

  const handleShareTourForSaved = useCallback(async (row: SavedTourRecord): Promise<boolean> => {
    const url = buildTourShareUrl({
      lat: row.place.lat,
      lng: row.place.lng,
      label: shareLabelForSavedTour(row),
      persona: row.persona,
      placeId: row.place.placeId,
    })
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      return false
    }
  }, [])

  const openRenameSaved = useCallback((row: SavedTourRecord) => {
    setSavedMenuId(null)
    setRenameModal({ id: row.id, draft: shareLabelForSavedTour(row) })
  }, [])

  const closeRenameSaved = useCallback(() => {
    setRenameModal(null)
  }, [])

  const confirmRenameSaved = useCallback(async () => {
    if (!renameModal) return
    const t = renameModal.draft.trim()
    try {
      await updateSavedTourSavedLabel(renameModal.id, t || undefined)
      await refreshSaved()
      setRenameModal(null)
    } catch {
      /* ignore */
    }
  }, [renameModal, refreshSaved])

  useLayoutEffect(() => {
    if (!renameModal) return
    const el = renameInputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
  }, [renameModal])

  useEffect(() => {
    if (!renameModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRenameSaved()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renameModal, closeRenameSaved])

  const handleFavouriteToggleFromSheet = useCallback(async () => {
    if (!selectedPlace || albumTracks.length === 0) return
    const prior = await findSavedTourByFingerprint(selectedPlace, persona)
    const nextFav = !prior?.favourited
    try {
      await upsertTourFromAlbum({ place: selectedPlace, persona, tracks: albumTracks })
      const row = await findSavedTourByFingerprint(selectedPlace, persona)
      if (row) await updateSavedTourFavourite(row.id, nextFav)
      await refreshSaved()
    } catch {
      /* ignore */
    }
  }, [selectedPlace, persona, albumTracks, refreshSaved])

  const isTourFavourited = useMemo(() => {
    if (!selectedPlace) return false
    const fp = placeFingerprint(selectedPlace, persona)
    const hit = savedList.find((r) => placeFingerprint(r.place, r.persona) === fp)
    return Boolean(hit?.favourited)
  }, [selectedPlace, persona, savedList])

  const hasSavedRecordForTour = useMemo(() => {
    if (!selectedPlace) return false
    const fp = placeFingerprint(selectedPlace, persona)
    return savedList.some((r) => placeFingerprint(r.place, r.persona) === fp)
  }, [selectedPlace, persona, savedList])

  const tourSheetHeadingLabel = useMemo(() => {
    if (!selectedPlace) return undefined
    const fp = placeFingerprint(selectedPlace, persona)
    const hit = savedList.find((r) => placeFingerprint(r.place, r.persona) === fp)
    if (!hit) return undefined
    return shareLabelForSavedTour(hit)
  }, [selectedPlace, persona, savedList])

  const handleDeleteAllHistory = useCallback(async () => {
    const count = savedList.filter((r) => !r.favourited).length
    if (count === 0) return
    if (
      !window.confirm(
        `Remove all ${count} saved tour${count === 1 ? '' : 's'} from this device? Favourites will stay.`,
      )
    ) {
      return
    }
    await deleteAllNonFavouritedTours()
    await refreshSaved()
  }, [savedList, refreshSaved])

  const handleDeleteCurrentSavedTour = useCallback(async () => {
    if (!selectedPlace) return
    const fp = placeFingerprint(selectedPlace, persona)
    const hit = savedList.find((r) => placeFingerprint(r.place, r.persona) === fp)
    if (!hit) return
    await deleteSavedTour(hit.id)
    await refreshSaved()
  }, [selectedPlace, persona, savedList, refreshSaved])

  useEffect(() => {
    if (!savedMenuId) return
    const down = (e: PointerEvent) => {
      const root = document.querySelector(`[data-saved-card="${savedMenuId}"]`)
      if (root?.contains(e.target as Node)) return
      setSavedMenuId(null)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [savedMenuId])

  useEffect(() => {
    if (!savedShareOkId) return
    const t = window.setTimeout(() => setSavedShareOkId(null), 2400)
    return () => window.clearTimeout(t)
  }, [savedShareOkId])

  useEffect(() => {
    if (step !== 'tour' || !selectedPlace || albumTracks.length === 0) return
    if (!albumTracks[0]?.scriptText?.trim()) return
    const id = window.setTimeout(() => {
      void flushAutosaveTour()
    }, 3000)
    return () => window.clearTimeout(id)
  }, [step, selectedPlace, albumTracks, flushAutosaveTour])

  const shuffle = useCallback(() => {
    setShuffleSeed(Math.floor(Math.random() * 1e9))
  }, [])

  const feelingLucky = useCallback(() => {
    const pick = pickRandomPlace(SUGGESTED_PLACES_POOL)
    setSelectedPlace(suggestedToSelected(pick))
  }, [])

  const onPickSuggested = useCallback((s: SuggestedPlace) => {
    setSelectedPlace(suggestedToSelected(s))
  }, [])

  const onPersonaPick = useCallback(
    (id: PersonaId) => {
      primeAudioPlayback()
      setPersona(id)
      advanceToPersonaBridge()
      void startFullTour(id)
    },
    [advanceToPersonaBridge, primeAudioPlayback, startFullTour],
  )

  const personaHeadingRef = useRef<HTMLHeadingElement>(null)
  const bridgePlaceHeadingRef = useRef<HTMLHeadingElement>(null)
  const bridgeHeadingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const opts = { preventScroll: true } as const
    if (step === 'bridge_place') {
      bridgePlaceHeadingRef.current?.focus(opts)
    } else if (step === 'persona') {
      personaHeadingRef.current?.focus(opts)
    } else if (step === 'bridge_persona') {
      bridgeHeadingRef.current?.focus(opts)
    }
  }, [step])

  return (
    <div className="passerby-page">
      <main className="passerby-shell passerby-stack">
        <div
          className={`card-layer card-layer-back${overlayCoversPlace ? ' card-layer-back-dimmed' : ''}`}
          aria-hidden={overlayCoversPlace}
        >
          <header className="passerby-header">
            <p className="wordmark">elsewhere</p>
            <p className="wordmark-tagline">An audio guide to everywhere.</p>
          </header>

          <section className="stack-section stack-section--location" aria-label="Location">
            <PlacesSearch
              key={mapsKey ?? 'no-key'}
              apiKey={mapsKey}
              reflectLabel={selectedPlace?.label}
              onPlaceSelected={handleSearchSelect}
            />

            <div className="location-row">
              <button
                type="button"
                className="link-location"
                onClick={handleUseLocation}
                disabled={geo.loading}
              >
                <MapPin className="icon-pin" size={14} strokeWidth={2} aria-hidden />
                {geo.loading ? 'Getting location…' : 'Use my location'}
              </button>
              <button type="button" className="link-location" onClick={feelingLucky}>
                <Dices size={14} strokeWidth={2} className="icon-pin" aria-hidden />
                I&apos;m feeling lucky
              </button>
            </div>
            {geo.error && (
              <p className="field-hint field-hint-warn" role="alert">
                {geo.error.message ||
                  'Could not read your location. Check permissions.'}
              </p>
            )}
          </section>

          <section
            className="stack-section stack-section--suggest"
            aria-labelledby="suggest-heading"
          >
            <div className="section-head">
              <h2 id="suggest-heading" className="section-label">
                Or visit…
              </h2>
              <div className="section-head-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={shuffle}
                  aria-label="Shuffle suggested places"
                  title="Shuffle"
                >
                  <Shuffle size={16} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </div>

            <div className="suggest-carousel-wrap">
              <div className="suggest-carousel" role="list">
                {suggestedVisible.map((s) => {
                  const sel =
                    selectedPlace &&
                    placeKey(suggestedToSelected(s)) === selectedKey
                  return (
                    <SuggestedPlaceCardButton
                      key={`${s.id}-${s.coverSrc ?? ''}`}
                      place={s}
                      selected={!!sel}
                      onPick={() => onPickSuggested(s)}
                    />
                  )
                })}
              </div>
            </div>
          </section>

          {favouriteList.length > 0 ? (
            <section className="stack-section stack-section--saved" aria-labelledby="favourites-heading">
              <h2 id="favourites-heading" className="section-label">
                Favourites
              </h2>
              <ul className="tour-stops-list tour-stops-list--timeline tour-stops-list--saved-home">
                {favouriteList.map((row, si) => {
                  const nar = PERSONAS.find((p) => p.id === row.persona)?.label ?? row.persona
                  const menuOpen = savedMenuId === row.id
                  const nTracks = row.tracks.length
                  const placeTitle = shortenSavedPlaceTitle(shareLabelForSavedTour(row))
                  const openTour = () => {
                    setSavedMenuId(null)
                    setSelectedPlace(row.place)
                    setPersona(row.persona)
                    restoreAlbumFromTracks(albumTracksFromSaved(row))
                    enterTourFromLibrary()
                  }
                  return (
                    <li key={row.id} className="tour-stop-row">
                      <button type="button" className="tour-stop-dot-btn" aria-label="Open saved tour" onClick={openTour}>
                        <span className="tour-stop-dot-inner">{si + 1}</span>
                      </button>
                      <div className="tour-stop-card tour-stop-card--saved-home" data-saved-card={row.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="tour-stop-card-body tour-stop-card-body--grow"
                          onClick={openTour}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openTour()
                            }
                          }}
                        >
                          <h3 className="tour-stop-name">{placeTitle}</h3>
                          <p className="tour-stop-card-saved-meta">
                            {nTracks} {nTracks === 1 ? 'track' : 'tracks'} · Narrated by {nar}
                          </p>
                        </div>
                        <div className="tour-stop-card-menu">
                          <button
                            type="button"
                            className="drawer-round-btn tour-stop-card-kebab tour-stop-card-kebab--favourited"
                            aria-label="Saved tour actions"
                            aria-expanded={menuOpen}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSavedMenuId(menuOpen ? null : row.id)
                            }}
                          >
                            <Heart size={18} strokeWidth={2} fill="currentColor" aria-hidden />
                          </button>
                          {menuOpen ? (
                            <div className="tour-player-popover tour-player-popover--anchored" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={async () => {
                                  setSavedMenuId(null)
                                  await updateSavedTourFavourite(row.id, false)
                                  await refreshSaved()
                                }}
                              >
                                <Heart size={16} strokeWidth={2} aria-hidden />
                                <span>Unfavourite</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={() => openRenameSaved(row)}
                              >
                                <Pencil size={16} strokeWidth={2} aria-hidden />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={async () => {
                                  const ok = await handleShareTourForSaved(row)
                                  if (ok) setSavedShareOkId(row.id)
                                }}
                              >
                                {savedShareOkId === row.id ? (
                                  <Check size={16} strokeWidth={2} aria-hidden />
                                ) : (
                                  <Share2 size={16} strokeWidth={2} aria-hidden />
                                )}
                                <span>{savedShareOkId === row.id ? 'Link copied' : 'Share'}</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item tour-player-popover-item--danger"
                                onClick={async () => {
                                  setSavedMenuId(null)
                                  await deleteSavedTour(row.id)
                                  await refreshSaved()
                                }}
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden />
                                <span>Delete</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {historyList.length > 0 ? (
            <section className="stack-section stack-section--saved" aria-labelledby="saved-heading">
              <div className="section-head section-head--saved-history">
                <h2 id="saved-heading" className="section-label">
                  Take me back…
                </h2>
                <div className="section-head-actions">
                  <button
                    type="button"
                    className="saved-delete-all-btn"
                    onClick={() => void handleDeleteAllHistory()}
                  >
                    Delete all
                  </button>
                </div>
              </div>
              <ul className="tour-stops-list tour-stops-list--timeline tour-stops-list--saved-home">
                {historyList.map((row, si) => {
                  const nar = PERSONAS.find((p) => p.id === row.persona)?.label ?? row.persona
                  const menuOpen = savedMenuId === row.id
                  const nTracks = row.tracks.length
                  const placeTitle = shortenSavedPlaceTitle(shareLabelForSavedTour(row))
                  const openTour = () => {
                    setSavedMenuId(null)
                    setSelectedPlace(row.place)
                    setPersona(row.persona)
                    restoreAlbumFromTracks(albumTracksFromSaved(row))
                    enterTourFromLibrary()
                  }
                  return (
                    <li key={row.id} className="tour-stop-row">
                      <button type="button" className="tour-stop-dot-btn" aria-label="Open saved tour" onClick={openTour}>
                        <span className="tour-stop-dot-inner">{si + 1}</span>
                      </button>
                      <div className="tour-stop-card tour-stop-card--saved-home" data-saved-card={row.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="tour-stop-card-body tour-stop-card-body--grow"
                          onClick={openTour}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openTour()
                            }
                          }}
                        >
                          <h3 className="tour-stop-name">{placeTitle}</h3>
                          <p className="tour-stop-card-saved-meta">
                            {nTracks} {nTracks === 1 ? 'track' : 'tracks'} · Narrated by {nar}
                          </p>
                        </div>
                        <div className="tour-stop-card-menu">
                          <button
                            type="button"
                            className="drawer-round-btn tour-stop-card-kebab"
                            aria-label="Saved tour actions"
                            aria-expanded={menuOpen}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSavedMenuId(menuOpen ? null : row.id)
                            }}
                          >
                            <MoreVertical size={18} strokeWidth={2} aria-hidden />
                          </button>
                          {menuOpen ? (
                            <div className="tour-player-popover tour-player-popover--anchored" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={async () => {
                                  setSavedMenuId(null)
                                  await updateSavedTourFavourite(row.id, true)
                                  await refreshSaved()
                                }}
                              >
                                <Heart size={16} strokeWidth={2} aria-hidden />
                                <span>Favourite</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={() => openRenameSaved(row)}
                              >
                                <Pencil size={16} strokeWidth={2} aria-hidden />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item"
                                onClick={async () => {
                                  const ok = await handleShareTourForSaved(row)
                                  if (ok) setSavedShareOkId(row.id)
                                }}
                              >
                                {savedShareOkId === row.id ? (
                                  <Check size={16} strokeWidth={2} aria-hidden />
                                ) : (
                                  <Share2 size={16} strokeWidth={2} aria-hidden />
                                )}
                                <span>{savedShareOkId === row.id ? 'Link copied' : 'Share'}</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="tour-player-popover-item tour-player-popover-item--danger"
                                onClick={async () => {
                                  setSavedMenuId(null)
                                  await deleteSavedTour(row.id)
                                  await refreshSaved()
                                }}
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden />
                                <span>Delete</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className="passerby-footer">
          <p className="passerby-footer-text">
            Another silly little experiment from{' '}
            <a
              className="passerby-footer-link"
              href="https://thedataface.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              DF Labs
            </a>
            {' · '}
            <a
              href="/privacy"
              className="passerby-footer-link"
              onClick={(e) => {
                e.preventDefault()
                nav.go('/privacy')
              }}
            >
              Privacy
            </a>
          </p>
        </footer>

        {step === 'bridge_place' && (
          <OnboardingDrawer
            titleId="bridge-place-title"
            onBack={goBack}
            onRestart={restart}
            bodyClassName="card-drawer-body--center"
          >
            <h2
              id="bridge-place-title"
              ref={bridgePlaceHeadingRef}
              tabIndex={-1}
              className="bridge-title"
            >
              Finding context for your stop…
            </h2>
            <p className="bridge-sub">
              {prefetchLoading
                ? 'Pulling nearby places and the closest Wikipedia article.'
                : 'Almost ready.'}
            </p>
            {prefetchLoading ? <BridgeLoadingIndicator /> : null}
          </OnboardingDrawer>
        )}

        {step === 'persona' && (
          <OnboardingDrawer
            titleId="persona-step-title"
            onBack={goBack}
            onRestart={restart}
          >
            <h2
              id="persona-step-title"
              ref={personaHeadingRef}
              tabIndex={-1}
              className="card-step-title"
            >
              Choose a narrator
            </h2>
            {prefetchTimedOut && !canGenerate && (
              <p className="field-hint field-hint-warn" role="status">
                Limited context for this pin — you can still try, or pick
                another stop.
              </p>
            )}
            <div className="persona-row" role="radiogroup" aria-labelledby="persona-step-title">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={persona === p.id}
                  className={`persona-card${persona === p.id ? ' persona-card-active' : ''}`}
                  disabled={tourBusy}
                  onClick={() => onPersonaPick(p.id)}
                >
                  <span className="persona-name">{p.label}</span>
                </button>
              ))}
            </div>
          </OnboardingDrawer>
        )}

        {step === 'bridge_persona' && (
          <OnboardingDrawer
            titleId="bridge-persona-title"
            onBack={goBack}
            onRestart={restart}
          >
            <h2
              id="bridge-persona-title"
              ref={bridgeHeadingRef}
              tabIndex={-1}
              className="card-step-title"
            >
              Preparing your tour…
            </h2>
            {(scriptError || audioError) && (
              <p className="field-hint field-hint-warn" role="alert">
                {scriptError ?? audioError ?? albumError}
              </p>
            )}
            {!scriptError && !audioError ? (
              <GenerationStatusTheater
                scriptBusy={scriptBusy}
                audioPhase={audioPhase}
                secondariesRequestLoading={secondariesRequestLoading}
              />
            ) : null}
          </OnboardingDrawer>
        )}

        {step === 'tour' && selectedPlace && (
          <div
            className="card-layer card-layer-front card-front-animate tour-player-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Tour player"
          >
            <TourPlayerSheet
              selectedPlace={selectedPlace}
              placeHeadingLabel={tourSheetHeadingLabel}
              narratorLabel={PERSONAS.find((p) => p.id === persona)?.label ?? ''}
              scriptText={scriptText}
              scriptError={scriptError}
              audioError={audioError}
              audioPhase={audioPhase}
              currentTime={currentTime}
              duration={duration}
              audioPaused={audioPaused}
              albumTracks={albumTracks}
              albumError={albumError}
              secondariesRequestLoading={secondariesRequestLoading}
              currentTrackIndex={currentTrackIndex}
              onBack={goBack}
              onDismissTour={handleDismissTour}
              togglePlayPause={togglePlayPause}
              seekBy={seekBy}
              seekTo={seekTo}
              goToTrack={goToTrack}
              nextTrack={nextTrack}
              prevTrack={prevTrack}
              onShare={handleShareTour}
              isFavourited={isTourFavourited}
              onFavouriteToggle={() => void handleFavouriteToggleFromSheet()}
              hasSavedRecord={hasSavedRecordForTour}
              onDeleteSavedTour={handleDeleteCurrentSavedTour}
            />
          </div>
        )}
      </main>

      {renameModal ? (
        <div
          className="rename-place-backdrop"
          role="presentation"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeRenameSaved()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={renameTitleId}
            className="rename-place-dialog"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id={renameTitleId} className="rename-place-title">
              Name this place
            </h2>
            <form
              className="rename-place-form"
              onSubmit={(e) => {
                e.preventDefault()
                void confirmRenameSaved()
              }}
            >
              <input
                ref={renameInputRef}
                type="text"
                className="rename-place-input"
                value={renameModal.draft}
                onChange={(e) =>
                  setRenameModal((m) => (m ? { ...m, draft: e.target.value } : m))
                }
                autoComplete="off"
                aria-label="Place name"
              />
              <div className="rename-place-actions">
                <button type="button" className="rename-place-btn rename-place-btn--ghost" onClick={closeRenameSaved}>
                  Cancel
                </button>
                <button type="submit" className="rename-place-btn rename-place-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
