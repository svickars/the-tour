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
  History,
  Home,
  Loader2,
  MapPin,
  MoreVertical,
  Pencil,
  RotateCcw,
  Share2,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react'
import { GenerationStatusTheater } from './components/GenerationStatusTheater'
import { LoadingDisclaimer } from './components/LoadingDisclaimer'
import { PersonaAvatar } from './components/PersonaAvatar'
import { PlacesSearch } from './components/PlacesSearch'
import { TourPlayerSheet } from './components/TourPlayerSheet'
import { VibeEmojiOverlap } from './components/VibeEmojiOverlap'
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
import { readPersistedPersona, writePersistedPersona } from './lib/persistedPersona'
import { mergeVibeUnion, toggleVibeSelection, vibesForApi, VIBES, type VibeId } from './lib/vibes'
import { useNav } from './NavContext'
import {
  albumTracksFromSaved,
  deleteAllNonFavouritedTours,
  deleteAllSavedTours,
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

type HomePanel = 'favourites' | 'discover' | 'visited'

const HOME_PANEL_ORDER: HomePanel[] = ['favourites', 'discover', 'visited']

function homePanelIndex(panel: HomePanel): number {
  return HOME_PANEL_ORDER.indexOf(panel)
}

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

function DrawerCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="drawer-round-btn drawer-close-btn"
      onClick={onClick}
      aria-label="Close"
      title="Close"
    >
      <X size={20} strokeWidth={2} aria-hidden />
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
  /** First bridge only: full reset to discover. */
  onRestart?: () => void
  /** Persona / vibes / tour-prep sheets: close overlay without clearing the app. */
  onCloseSheet?: () => void
  bodyClassName?: string
  footer?: ReactNode
  children: ReactNode
}

function OnboardingDrawer({
  titleId,
  onBack,
  onRestart,
  onCloseSheet,
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
        {onCloseSheet ? (
          <DrawerCloseButton onClick={onCloseSheet} />
        ) : onRestart ? (
          <DrawerRestartButton onClick={onRestart} />
        ) : null}
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
  const [persona, setPersona] = useState<PersonaId>(() => readPersistedPersona() ?? 'deadpan')
  const [vibeSelection, setVibeSelection] = useState<VibeId[]>([])
  /** Union of vibes used for the tour (initial + each successful “find more”); shown in header and persisted. */
  const [tourVibeChipUnion, setTourVibeChipUnion] = useState<VibeId[]>([])

  const [savedList, setSavedList] = useState<SavedTourRecord[]>([])
  const [savedMenuId, setSavedMenuId] = useState<string | null>(null)
  const [savedShareOkId, setSavedShareOkId] = useState<string | null>(null)
  const [homePanel, setHomePanel] = useState<HomePanel>('discover')
  const [favouritesVisibleCount, setFavouritesVisibleCount] = useState(5)
  const [visitedVisibleCount, setVisitedVisibleCount] = useState(5)
  const [renameModal, setRenameModal] = useState<{ id: string; draft: string } | null>(null)
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false)
  const [clearHistoryFavouritesToo, setClearHistoryFavouritesToo] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameTitleId = useId()
  const clearHistoryTitleId = useId()

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

  const handleRestartApp = useCallback(() => {
    setSelectedPlace(null)
    setShuffleSeed(Math.floor(Math.random() * 1e9))
    setVibeSelection([])
    setTourVibeChipUnion([])
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
    retryCurrentTrackNarration,
    appendMoreStops,
    moreStopsLoading,
    moreStopsError,
    lastAppendedStopIds,
  } = useTourEngine(selectedPlace, persona)

  const flushAutosaveTour = useCallback(async () => {
    if (!selectedPlace || albumTracks.length === 0) return
    try {
      await upsertTourFromAlbum({
        place: selectedPlace,
        persona,
        tracks: albumTracks,
        vibeIds: tourVibeChipUnion,
      })
      await refreshSaved()
    } catch {
      /* ignore persist errors */
    }
  }, [selectedPlace, persona, albumTracks, tourVibeChipUnion, refreshSaved])

  const bridgeTourContentReady = useMemo(() => {
    const main = albumTracks[0]
    if (!main?.scriptText?.trim()) return false
    if (scriptBusy) return false
    return audioPhase === 'idle' && Boolean(main.audioObjectUrl)
  }, [albumTracks, scriptBusy, audioPhase])

  const { step, prefetchTimedOut, goBack, restart, advanceToVibesSheet, advanceToPersonaBridge, overlayCoversPlace, enterTourFromLibrary, dismissTourSheet } =
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
    setVibeSelection([])
    setTourVibeChipUnion([])
    setSelectedPlace(p)
  }, [])

  const handleUseLocation = useCallback(() => {
    geo.request({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
      onSuccess: (lat, lng) => {
        setVibeSelection([])
        setTourVibeChipUnion([])
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

  useEffect(() => {
    writePersistedPersona(persona)
  }, [persona])

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
      setVibeSelection([])
      setTourVibeChipUnion([])
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
      await upsertTourFromAlbum({
        place: selectedPlace,
        persona,
        tracks: albumTracks,
        vibeIds: tourVibeChipUnion,
      })
      const row = await findSavedTourByFingerprint(selectedPlace, persona)
      if (row) await updateSavedTourFavourite(row.id, nextFav)
      await refreshSaved()
    } catch {
      /* ignore */
    }
  }, [selectedPlace, persona, albumTracks, tourVibeChipUnion, refreshSaved])

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

  const openClearHistoryModal = useCallback(() => {
    if (!savedList.some((r) => !r.favourited)) return
    setClearHistoryFavouritesToo(false)
    setClearHistoryOpen(true)
  }, [savedList])

  const closeClearHistoryModal = useCallback(() => {
    setClearHistoryOpen(false)
    setClearHistoryFavouritesToo(false)
  }, [])

  const confirmClearHistory = useCallback(async () => {
    const nonFav = savedList.filter((r) => !r.favourited).length
    if (nonFav === 0) {
      closeClearHistoryModal()
      return
    }
    if (clearHistoryFavouritesToo) {
      await deleteAllSavedTours()
    } else {
      await deleteAllNonFavouritedTours()
    }
    closeClearHistoryModal()
    await refreshSaved()
  }, [savedList, clearHistoryFavouritesToo, closeClearHistoryModal, refreshSaved])

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
    setVibeSelection([])
    setTourVibeChipUnion([])
    setSelectedPlace(suggestedToSelected(pick))
  }, [])

  const onPickSuggested = useCallback((s: SuggestedPlace) => {
    setVibeSelection([])
    setTourVibeChipUnion([])
    setSelectedPlace(suggestedToSelected(s))
  }, [])

  const onPersonaPick = useCallback(
    (id: PersonaId) => {
      primeAudioPlayback()
      setPersona(id)
      advanceToVibesSheet()
    },
    [advanceToVibesSheet, primeAudioPlayback],
  )

  const handleSwitchNarratorFromTour = useCallback(
    async (id: PersonaId) => {
      if (id === persona) return
      await flushAutosaveTour()
      cancelTourPrep()
      primeAudioPlayback()
      setPersona(id)
      setTourVibeChipUnion(mergeVibeUnion([], vibeSelection))
      advanceToPersonaBridge()
      void startFullTour(id, vibesForApi(vibeSelection))
    },
    [
      persona,
      vibeSelection,
      flushAutosaveTour,
      cancelTourPrep,
      primeAudioPlayback,
      advanceToPersonaBridge,
      startFullTour,
    ],
  )

  const handleFindMoreStops = useCallback(async () => {
    const snapshot = [...vibeSelection]
    const ok = await appendMoreStops(vibesForApi(snapshot))
    if (ok) setTourVibeChipUnion((prev) => mergeVibeUnion(prev, snapshot))
  }, [appendMoreStops, vibeSelection])

  const personaHeadingRef = useRef<HTMLHeadingElement>(null)
  const vibesHeadingRef = useRef<HTMLHeadingElement>(null)
  const bridgePlaceHeadingRef = useRef<HTMLHeadingElement>(null)
  const bridgeHeadingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const opts = { preventScroll: true } as const
    if (step === 'bridge_place') {
      bridgePlaceHeadingRef.current?.focus(opts)
    } else if (step === 'persona') {
      personaHeadingRef.current?.focus(opts)
    } else if (step === 'vibes') {
      vibesHeadingRef.current?.focus(opts)
    } else if (step === 'bridge_persona') {
      bridgeHeadingRef.current?.focus(opts)
    }
  }, [step])

  const homeChromeVisible = step === 'place'
  const homeSwipeIndex = homePanelIndex(homePanel)
  const favouritesPage = useMemo(
    () => favouriteList.slice(0, favouritesVisibleCount),
    [favouriteList, favouritesVisibleCount],
  )
  const visitedPage = useMemo(
    () => savedList.slice(0, visitedVisibleCount),
    [savedList, visitedVisibleCount],
  )
  const clearHistoryCounts = useMemo(() => {
    const nonFav = savedList.filter((r) => !r.favourited).length
    const fav = savedList.filter((r) => r.favourited).length
    return { nonFav, fav }
  }, [savedList])

  return (
    <div className="passerby-page">
      <main className="passerby-shell passerby-stack">
        <div className="home-stage">
          <div
            className={`card-layer card-layer-back home-shell-back${overlayCoversPlace ? ' card-layer-back-dimmed' : ''}`}
            aria-hidden={overlayCoversPlace}
          >
            <div className="home-swipe-viewport">
              <div
                className="home-swipe-track"
                style={{
                  transform: `translateX(calc(-${homeSwipeIndex} * 100% / 3))`,
                }}
              >
                <div
                  id="home-panel-favourites"
                  role="tabpanel"
                  aria-labelledby="home-tab-favourites"
                  aria-hidden={homePanel !== 'favourites'}
                  className="home-panel home-panel--saved"
                >
                  <header className="home-saved-header">
                    <button
                      type="button"
                      className="home-wordmark-btn"
                      onClick={() => setHomePanel('discover')}
                      aria-label="Back to discover"
                    >
                      <span className="wordmark home-wordmark-saved">elsewhere</span>
                    </button>
                    <p id="home-panel-favourites-subtitle" className="wordmark-tagline home-saved-kicker">
                      Favourite places
                    </p>
                  </header>
                  <div className="home-panel-scroll">
                    {favouriteList.length === 0 ? (
                      <div className="home-feed-empty">
                        <p className="home-feed-empty-title">No favourites yet</p>
                        <p className="home-feed-empty-sub">Save a tour from the player to see it here.</p>
                        <button type="button" className="home-feed-empty-cta" onClick={() => setHomePanel('discover')}>
                          Search a place
                        </button>
                      </div>
                    ) : (
                      <ul className="home-feed home-feed--cards" role="list">
                        {favouritesPage.map((row) => {
                          const personaMeta = PERSONAS.find((p) => p.id === row.persona)
                          const nar = personaMeta?.label ?? row.persona
                          const portraitSrc = personaMeta?.portraitSrc ?? PERSONAS[0]!.portraitSrc
                          const menuOpen = savedMenuId === row.id
                          const nTracks = row.tracks.length
                          const placeTitle = shortenSavedPlaceTitle(shareLabelForSavedTour(row))
                          const openTour = () => {
                            setSavedMenuId(null)
                            setVibeSelection(row.vibeIds ?? [])
                            setTourVibeChipUnion(row.vibeIds ?? [])
                            setSelectedPlace(row.place)
                            setPersona(row.persona)
                            restoreAlbumFromTracks(albumTracksFromSaved(row), row.persona)
                            enterTourFromLibrary()
                          }
                          return (
                            <li
                              key={row.id}
                              className={`home-feed-row${menuOpen ? ' home-feed-row--menu-open' : ''}`}
                              role="listitem"
                            >
                              <div className="home-feed-card" data-saved-card={row.id}>
                                <button type="button" className="home-feed-card__main" onClick={openTour}>
                                  <span className="home-feed-card__title">{placeTitle}</span>
                                  <span className="home-feed-card__meta">
                                    <span className="home-feed-card__meta-line">
                                      {nTracks} {nTracks === 1 ? 'track' : 'tracks'} · Narrated by{' '}
                                      <PersonaAvatar portraitSrc={portraitSrc} className="home-feed-card__avatar" alt="" />
                                      <span className="home-feed-card__nar">{nar}</span>
                                      {row.vibeIds?.length ? (
                                        <VibeEmojiOverlap vibeIds={row.vibeIds} className="home-feed-card__vibes" />
                                      ) : null}
                                    </span>
                                  </span>
                                </button>
                                <div className="home-feed-card__actions">
                                  <button
                                    type="button"
                                    className="home-feed-card__iconbtn home-feed-card__iconbtn--heart"
                                    aria-label="Favourite actions"
                                    aria-expanded={menuOpen}
                                    aria-haspopup="menu"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSavedMenuId(menuOpen ? null : row.id)
                                    }}
                                  >
                                    <Heart size={15} strokeWidth={2} fill="currentColor" aria-hidden />
                                  </button>
                                  {menuOpen ? (
                                    <div className="tour-player-popover home-popover" role="menu">
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
                    )}
                    {favouriteList.length > 0 && favouritesVisibleCount < favouriteList.length ? (
                      <button
                        type="button"
                        className="home-feed-loadmore"
                        onClick={() =>
                          setFavouritesVisibleCount((c) => Math.min(c + 5, favouriteList.length))
                        }
                      >
                        Load more
                      </button>
                    ) : null}
                  </div>
                </div>

                <div
                  id="home-panel-discover"
                  role="tabpanel"
                  aria-labelledby="home-tab-discover"
                  aria-hidden={homePanel !== 'discover'}
                  className="home-panel home-panel--discover"
                >
                  <div className="home-discover-inner">
                    <header className="home-discover-brand">
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
                      {geo.error ? (
                        <p className="field-hint field-hint-warn" role="alert">
                          {geo.error.message ||
                            'Could not read your location. Check permissions.'}
                        </p>
                      ) : null}
                    </section>

                    <div className="home-suggest-row">
                      <div className="suggest-carousel-wrap home-suggest-carousel">
                        <div className="suggest-carousel" role="list">
                          {suggestedVisible.map((s) => {
                            const sel =
                              selectedPlace && placeKey(suggestedToSelected(s)) === selectedKey
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
                      <button
                        type="button"
                        className="home-shuffle-btn"
                        onClick={shuffle}
                        aria-label="Shuffle suggested places"
                        title="Shuffle"
                      >
                        <Shuffle size={18} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  id="home-panel-visited"
                  role="tabpanel"
                  aria-labelledby="home-tab-visited"
                  aria-hidden={homePanel !== 'visited'}
                  className="home-panel home-panel--saved"
                >
                  <header className="home-saved-header">
                    <button
                      type="button"
                      className="home-wordmark-btn"
                      onClick={() => setHomePanel('discover')}
                      aria-label="Back to discover"
                    >
                      <span className="wordmark home-wordmark-saved">elsewhere</span>
                    </button>
                    <div className="home-saved-header__end">
                      <p id="home-panel-visited-subtitle" className="wordmark-tagline home-saved-kicker">
                        Take me back…
                      </p>
                      {savedList.some((r) => !r.favourited) ? (
                        <button
                          type="button"
                          className="home-header-clear-btn"
                          onClick={openClearHistoryModal}
                          aria-label="Clear saved tour history"
                          title="Clear history"
                        >
                          <Trash2 size={18} strokeWidth={2} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </header>
                  <div className="home-panel-scroll">
                    {savedList.length === 0 ? (
                      <div className="home-feed-empty">
                        <p className="home-feed-empty-title">No visits yet</p>
                        <p className="home-feed-empty-sub">Tours you listen to will show up here.</p>
                        <button type="button" className="home-feed-empty-cta" onClick={() => setHomePanel('discover')}>
                          Search a place
                        </button>
                      </div>
                    ) : (
                      <ul className="home-feed home-feed--cards" role="list">
                        {visitedPage.map((row) => {
                          const personaMeta = PERSONAS.find((p) => p.id === row.persona)
                          const nar = personaMeta?.label ?? row.persona
                          const portraitSrc = personaMeta?.portraitSrc ?? PERSONAS[0]!.portraitSrc
                          const menuOpen = savedMenuId === row.id
                          const nTracks = row.tracks.length
                          const placeTitle = shortenSavedPlaceTitle(shareLabelForSavedTour(row))
                          const openTour = () => {
                            setSavedMenuId(null)
                            setVibeSelection(row.vibeIds ?? [])
                            setTourVibeChipUnion(row.vibeIds ?? [])
                            setSelectedPlace(row.place)
                            setPersona(row.persona)
                            restoreAlbumFromTracks(albumTracksFromSaved(row), row.persona)
                            enterTourFromLibrary()
                          }
                          return (
                            <li
                              key={row.id}
                              className={`home-feed-row${menuOpen ? ' home-feed-row--menu-open' : ''}`}
                              role="listitem"
                            >
                              <div className="home-feed-card" data-saved-card={row.id}>
                                <button type="button" className="home-feed-card__main" onClick={openTour}>
                                  <span className="home-feed-card__title">{placeTitle}</span>
                                  <span className="home-feed-card__meta">
                                    <span className="home-feed-card__meta-line">
                                      {nTracks} {nTracks === 1 ? 'track' : 'tracks'} · Narrated by{' '}
                                      <PersonaAvatar portraitSrc={portraitSrc} className="home-feed-card__avatar" alt="" />
                                      <span className="home-feed-card__nar">{nar}</span>
                                      {row.vibeIds?.length ? (
                                        <VibeEmojiOverlap vibeIds={row.vibeIds} className="home-feed-card__vibes" />
                                      ) : null}
                                    </span>
                                  </span>
                                </button>
                                <div className="home-feed-card__actions">
                                  <button
                                    type="button"
                                    className="home-feed-card__iconbtn"
                                    aria-label="Saved tour actions"
                                    aria-expanded={menuOpen}
                                    aria-haspopup="menu"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSavedMenuId(menuOpen ? null : row.id)
                                    }}
                                  >
                                    <MoreVertical size={15} strokeWidth={2} aria-hidden />
                                  </button>
                                  {menuOpen ? (
                                    <div className="tour-player-popover home-popover" role="menu">
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
                    )}
                    {savedList.length > 0 && visitedVisibleCount < savedList.length ? (
                      <button
                        type="button"
                        className="home-feed-loadmore"
                        onClick={() => setVisitedVisibleCount((c) => Math.min(c + 5, savedList.length))}
                      >
                        Load more
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {homeChromeVisible ? (
          <>
            <nav
              className="home-tabbar"
              aria-label="Main"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault()
                  const i = homeSwipeIndex
                  if (i > 0) setHomePanel(HOME_PANEL_ORDER[i - 1]!)
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  const i = homeSwipeIndex
                  if (i < 2) setHomePanel(HOME_PANEL_ORDER[i + 1]!)
                }
              }}
            >
              <div className="home-tabbar-inner" role="tablist" aria-orientation="horizontal">
                <button
                  id="home-tab-favourites"
                  type="button"
                  role="tab"
                  aria-label="Favourites"
                  aria-selected={homePanel === 'favourites'}
                  aria-controls="home-panel-favourites"
                  tabIndex={homePanel === 'favourites' ? 0 : -1}
                  className={`home-tab${homePanel === 'favourites' ? ' home-tab--active' : ''}`}
                  onClick={() => setHomePanel('favourites')}
                >
                  <Heart size={26} strokeWidth={2} aria-hidden />
                </button>
                <button
                  id="home-tab-discover"
                  type="button"
                  role="tab"
                  aria-label="Discover"
                  aria-selected={homePanel === 'discover'}
                  aria-controls="home-panel-discover"
                  tabIndex={homePanel === 'discover' ? 0 : -1}
                  className={`home-tab${homePanel === 'discover' ? ' home-tab--active' : ''}`}
                  onClick={() => setHomePanel('discover')}
                >
                  <Home size={26} strokeWidth={2} aria-hidden />
                </button>
                <button
                  id="home-tab-visited"
                  type="button"
                  role="tab"
                  aria-label="Previously visited"
                  aria-selected={homePanel === 'visited'}
                  aria-controls="home-panel-visited"
                  tabIndex={homePanel === 'visited' ? 0 : -1}
                  className={`home-tab${homePanel === 'visited' ? ' home-tab--active' : ''}`}
                  onClick={() => setHomePanel('visited')}
                >
                  <History size={26} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </nav>

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
          </>
        ) : null}

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
            onCloseSheet={handleDismissTour}
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
                  aria-label={`${p.label}. ${p.subtitle}`}
                  className={`persona-card${persona === p.id ? ' persona-card-active' : ''}`}
                  disabled={tourBusy}
                  onClick={() => onPersonaPick(p.id)}
                >
                  <span className="persona-card-avatar" aria-hidden>
                    <PersonaAvatar portraitSrc={p.portraitSrc} className="persona-card-avatar-img" />
                  </span>
                  <span className="persona-card-text">
                    <span className="persona-name">{p.label}</span>
                    <span className="persona-sub">{p.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          </OnboardingDrawer>
        )}

        {step === 'vibes' && (
          <OnboardingDrawer
            titleId="vibes-step-title"
            onBack={goBack}
            onCloseSheet={handleDismissTour}
            bodyClassName="card-drawer-body--vibes"
            footer={
              <button
                type="button"
                className="vibes-sheet-cta"
                disabled={tourBusy}
                onClick={() => {
                  primeAudioPlayback()
                  setTourVibeChipUnion(mergeVibeUnion([], vibeSelection))
                  advanceToPersonaBridge()
                  void startFullTour(persona, vibesForApi(vibeSelection))
                }}
              >
                Take me there →
              </button>
            }
          >
            <h2
              id="vibes-step-title"
              ref={vibesHeadingRef}
              tabIndex={-1}
              className="card-step-title"
            >
              Vibes?
            </h2>
            <p className="vibes-sheet-sub">What are you here for? Pick as many as you like.</p>
            <div className="vibes-pill-grid" role="group" aria-labelledby="vibes-step-title">
              {VIBES.map((v) => {
                const selected = vibeSelection.includes(v.id)
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`vibes-pill${selected ? ' vibes-pill--selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setVibeSelection((prev) => toggleVibeSelection(prev, v.id))}
                  >
                    <span className="vibes-pill-emoji" aria-hidden>
                      {v.emoji}
                    </span>
                    <span className="vibes-pill-label">{v.label}</span>
                  </button>
                )
              })}
            </div>
          </OnboardingDrawer>
        )}

        {step === 'bridge_persona' && (
          <OnboardingDrawer
            titleId="bridge-persona-title"
            onBack={goBack}
            onCloseSheet={handleDismissTour}
          >
            <h2
              id="bridge-persona-title"
              ref={bridgeHeadingRef}
              tabIndex={-1}
              className="card-step-title"
            >
              Preparing your tour…
            </h2>
            {(scriptError || audioError || albumError) && (
              <p className="field-hint field-hint-warn" role="alert">
                {scriptError ?? audioError ?? albumError}
              </p>
            )}
            {audioError && albumTracks[0]?.scriptText?.trim() ? (
              <button
                type="button"
                className="tour-player-audio-retry-btn bridge-persona-retry"
                onClick={() => void retryCurrentTrackNarration()}
              >
                Try loading audio again
              </button>
            ) : null}
            {!scriptError && !audioError && !albumError ? (
              <div className="gen-loading-stack">
                <GenerationStatusTheater
                  scriptBusy={scriptBusy}
                  audioPhase={audioPhase}
                  secondariesRequestLoading={secondariesRequestLoading}
                />
                <LoadingDisclaimer key={persona} persona={persona} />
              </div>
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
              persona={persona}
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
              onDismissTour={handleDismissTour}
              onNarratorChange={handleSwitchNarratorFromTour}
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
              onRetryAudio={() => void retryCurrentTrackNarration()}
              vibeSelection={vibeSelection}
              onToggleVibe={(id) => setVibeSelection((prev) => toggleVibeSelection(prev, id))}
              onFindMoreStops={() => void handleFindMoreStops()}
              moreStopsLoading={moreStopsLoading}
              moreStopsError={moreStopsError}
              lastAppendedStopIds={lastAppendedStopIds}
              vibeIds={tourVibeChipUnion}
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

      {clearHistoryOpen ? (
        <div
          className="rename-place-backdrop"
          role="presentation"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeClearHistoryModal()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={clearHistoryTitleId}
            className="rename-place-dialog clear-history-dialog"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id={clearHistoryTitleId} className="rename-place-title">
              Clear saved tours
            </h2>
            <div className="clear-history-body">
              <p className="clear-history-lead">
                {clearHistoryCounts.nonFav === 1 ? (
                  <>
                    This will remove <strong>1 saved tour</strong> that is not in your favourites from this device.
                  </>
                ) : (
                  <>
                    This will remove <strong>{clearHistoryCounts.nonFav} saved tours</strong> that are not in your
                    favourites from this device.
                  </>
                )}{' '}
                You cannot undo this.
              </p>
              {clearHistoryCounts.fav > 0 ? (
                <label className="clear-history-checkbox">
                  <input
                    type="checkbox"
                    checked={clearHistoryFavouritesToo}
                    onChange={(e) => setClearHistoryFavouritesToo(e.target.checked)}
                  />
                  <span>
                    Also delete favourited places ({clearHistoryCounts.fav}{' '}
                    {clearHistoryCounts.fav === 1 ? 'tour' : 'tours'})
                  </span>
                </label>
              ) : null}
              {clearHistoryFavouritesToo && clearHistoryCounts.fav > 0 ? (
                <p className="clear-history-warn" role="status">
                  All {clearHistoryCounts.nonFav + clearHistoryCounts.fav} saved tours will be removed.
                </p>
              ) : null}
            </div>
            <div className="rename-place-actions">
              <button type="button" className="rename-place-btn rename-place-btn--ghost" onClick={closeClearHistoryModal}>
                Cancel
              </button>
              <button
                type="button"
                className="rename-place-btn rename-place-btn--danger"
                onClick={() => void confirmClearHistory()}
              >
                Clear tours
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
