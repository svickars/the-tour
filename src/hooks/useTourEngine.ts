import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchNearbyPlaceNamesAndTypes,
  fetchNearestWikipediaExtract,
  fetchPlaceDetails,
  type NearbyPlacesResult,
  type WikipediaExtractResult,
} from '../lib/geoApis'
import { cleanScript } from '../lib/cleanScript'
import { googleMapsSearchUrl } from '../lib/externalLinks'
import { findSentenceBoundaryNear, splitMainScriptIntoFourParts } from '../lib/mainScriptChunks'
import type { PersonaId } from '../lib/personas'
import { inferPlaceScope } from '../lib/placeScope'
import { orderSecondariesForWalk } from '../lib/walkingOrder'
import type { AlbumTrack, AlbumTrackStatus, SelectedPlace } from '../lib/tourTypes'
import { wikipediaArticleUrl, wikipediaSearchUrl } from '../lib/wikipediaLinks'

export type { AlbumTrack, SelectedPlace } from '../lib/tourTypes'

type AudioPhase = 'idle' | 'loading' | 'playing'

/** Tiny WAV used only to satisfy mobile “audio started from a tap” heuristics before long async TTS work. */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAAAAAA=='

function applyMobileAudioAttrs(a: HTMLAudioElement) {
  a.preload = 'auto'
  a.setAttribute('playsinline', '')
  a.setAttribute('webkit-playsinline', '')
}

function isAutoplayPolicyBlock(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'SecurityError')
  )
}

function attachAudioUiSync(
  audio: HTMLAudioElement,
  setCurrentTime: (t: number) => void,
  setDuration: (d: number) => void,
  setAudioPaused: (p: boolean) => void,
): () => void {
  const onTimeUpdate = () => {
    setCurrentTime(audio.currentTime)
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration)
    }
  }
  const onDur = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration)
    }
  }
  const onPlay = () => setAudioPaused(false)
  const onPause = () => setAudioPaused(true)

  audio.addEventListener('timeupdate', onTimeUpdate)
  audio.addEventListener('loadedmetadata', onDur)
  audio.addEventListener('durationchange', onDur)
  audio.addEventListener('play', onPlay)
  audio.addEventListener('pause', onPause)
  onDur()
  onTimeUpdate()
  setAudioPaused(audio.paused)

  return () => {
    audio.removeEventListener('timeupdate', onTimeUpdate)
    audio.removeEventListener('loadedmetadata', onDur)
    audio.removeEventListener('durationchange', onDur)
    audio.removeEventListener('play', onPlay)
    audio.removeEventListener('pause', onPause)
  }
}

async function ttsBlobFor(text: string, persona: PersonaId, signal: AbortSignal): Promise<Blob> {
  const cleaned = cleanScript(text)
  if (!cleaned.trim()) throw new Error('Nothing to speak.')
  const res = await fetch('/api/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ text: cleaned, persona }),
  })
  if (!res.ok) {
    let msg = `Audio failed (${res.status})`
    try {
      const j = (await res.json()) as { error?: string }
      if (typeof j.error === 'string' && j.error.trim()) msg = j.error.trim()
    } catch {
      /* */
    }
    throw new Error(msg)
  }
  return res.blob()
}

function revokeTrackUrls(tracks: AlbumTrack[]) {
  for (const t of tracks) {
    if (t.audioObjectUrl) {
      URL.revokeObjectURL(t.audioObjectUrl)
    }
  }
}

type MainStreamTts = {
  e1: number
  p1: Promise<Blob>
  e2?: number
  p2?: Promise<Blob>
  e3?: number
  p3?: Promise<Blob>
}

function mainTrackDescriptionFromScript(script: string): string {
  const t = script.trim()
  if (!t) return ''
  const cut = t.slice(0, 140)
  return t.length > 140 ? `${cut}…` : cut
}

export function useTourEngine(selectedPlace: SelectedPlace | null, persona: PersonaId) {
  const placeScope = useMemo(() => inferPlaceScope(selectedPlace), [selectedPlace])

  const [prefetchLoading, setPrefetchLoading] = useState(false)
  const [nearby, setNearby] = useState<NearbyPlacesResult | null>(null)
  const [wiki, setWiki] = useState<WikipediaExtractResult | null>(null)
  const [placeDetailsLoading, setPlaceDetailsLoading] = useState(false)
  const [placeDetailsJson, setPlaceDetailsJson] = useState('')

  const [scriptText, setScriptText] = useState('')
  const [scriptBusy, setScriptBusy] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)

  const [albumTracks, setAlbumTracks] = useState<AlbumTrack[]>([])
  const [albumError, setAlbumError] = useState<string | null>(null)
  const [secondariesRequestLoading, setSecondariesRequestLoading] = useState(false)

  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)

  const scriptAbortRef = useRef<AbortController | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const secondaryListAbortRef = useRef<AbortController | null>(null)
  const secondarySynthAcRef = useRef<AbortController | null>(null)
  /** Up to three script splits during streaming + matching TTS promises; final chunk TTS starts after stream. */
  const mainTtsStreamRef = useRef<MainStreamTts | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const detachAudioUiRef = useRef<(() => void) | null>(null)
  const primingAudioRef = useRef<HTMLAudioElement | null>(null)

  const [audioPhase, setAudioPhase] = useState<AudioPhase>('idle')
  const audioPhaseRef = useRef<AudioPhase>('idle')
  useEffect(() => {
    audioPhaseRef.current = audioPhase
  }, [audioPhase])
  const [audioError, setAudioError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioPaused, setAudioPaused] = useState(true)

  const albumTracksRef = useRef<AlbumTrack[]>([])
  const currentTrackIndexRef = useRef(0)
  useEffect(() => {
    albumTracksRef.current = albumTracks
  }, [albumTracks])
  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex
  }, [currentTrackIndex])

  const lat = selectedPlace?.lat
  const lng = selectedPlace?.lng
  const placeId = selectedPlace?.placeId

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- prefetch lifecycle */
    if (lat == null || lng == null) {
      setNearby(null)
      setWiki(null)
      setPlaceDetailsJson('')
      setPrefetchLoading(false)
      setPlaceDetailsLoading(false)
      return
    }

    let cancelled = false
    setPrefetchLoading(true)
    setNearby(null)
    setWiki(null)
    setPlaceDetailsJson('')
    setPlaceDetailsLoading(Boolean(placeId?.trim()))

    const scope = inferPlaceScope(selectedPlace)
    const radiusMeters = scope === 'broad' ? 2800 : 900

    void (async () => {
      const [n, w] = await Promise.all([
        fetchNearbyPlaceNamesAndTypes(lat, lng, { radiusMeters }),
        fetchNearestWikipediaExtract(lat, lng),
      ])
      if (!cancelled) {
        setNearby(n)
        setWiki(w)
      }

      if (placeId?.trim()) {
        const pd = await fetchPlaceDetails(placeId)
        if (!cancelled) {
          if (pd.ok) {
            setPlaceDetailsJson(
              JSON.stringify({
                displayName: pd.displayName,
                types: pd.types,
                editorialSummary: pd.editorialSummary,
                rating: pd.rating,
                userRatingCount: pd.userRatingCount,
                reviewSnippets: pd.reviewSnippets,
              }),
            )
          } else {
            setPlaceDetailsJson('')
          }
          setPlaceDetailsLoading(false)
        }
      } else if (!cancelled) {
        setPlaceDetailsLoading(false)
      }

      if (!cancelled) setPrefetchLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [lat, lng, placeId, selectedPlace])

  const releaseAudioResources = useCallback(
    (opts?: { keepTimeline?: boolean }) => {
      detachAudioUiRef.current?.()
      detachAudioUiRef.current = null
      const a = audioRef.current
      let keepDuration = 0
      let keepTime = 0
      if (opts?.keepTimeline && a) {
        const d = a.duration
        if (Number.isFinite(d) && d > 0) {
          keepDuration = d
          keepTime = d
        }
      }
      if (a) {
        a.onended = null
        a.onerror = null
        a.pause()
        a.removeAttribute('src')
        a.load()
        audioRef.current = null
      }
      setCurrentTime(keepTime)
      setDuration(keepDuration)
      setAudioPaused(true)
    },
    [],
  )

  const stopTour = useCallback(() => {
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    releaseAudioResources()
    setAudioPhase('idle')
  }, [releaseAudioResources])

  const cancelTourPrep = useCallback(() => {
    secondaryListAbortRef.current?.abort()
    secondaryListAbortRef.current = null
    secondarySynthAcRef.current?.abort()
    secondarySynthAcRef.current = null
    scriptAbortRef.current?.abort()
    scriptAbortRef.current = null
    mainTtsStreamRef.current = null
    stopTour()
    setScriptBusy(false)
    setScriptText('')
    setSecondariesRequestLoading(false)
    setAlbumError(null)
    revokeTrackUrls(albumTracksRef.current)
    setAlbumTracks([])
    setCurrentTrackIndex(0)
  }, [stopTour])

  useEffect(() => {
    return () => {
      scriptAbortRef.current?.abort()
      ttsAbortRef.current?.abort()
      secondaryListAbortRef.current?.abort()
      secondarySynthAcRef.current?.abort()
      releaseAudioResources()
      revokeTrackUrls(albumTracksRef.current)
    }
  }, [releaseAudioResources])

  const audioBusy = audioPhase !== 'idle'

  const prefetchBlocking = prefetchLoading || placeDetailsLoading

  /**
   * Call synchronously from the same pointer/tap handler that starts a tour. iOS Safari only
   * allows `audio.play()` after long async work if playback was “opened” from that gesture.
   */
  const primeAudioPlayback = useCallback(() => {
    try {
      let a = primingAudioRef.current
      if (!a) {
        a = new Audio()
        primingAudioRef.current = a
      }
      applyMobileAudioAttrs(a)
      if (a.src !== SILENT_WAV_DATA_URI) {
        a.src = SILENT_WAV_DATA_URI
        a.load()
      }
      void a.play().then(() => {
        try {
          a.pause()
          a.currentTime = 0
        } catch {
          /* ignore */
        }
      })
    } catch {
      /* ignore */
    }
  }, [])

  const canGenerate =
    lat != null &&
    lng != null &&
    !prefetchBlocking &&
    ((nearby?.ok === true && nearby.places.length > 0) ||
      (wiki?.ok === true && wiki.extract.trim().length > 0))

  const playBlobUrl = useCallback(
    async (url: string, signal: AbortSignal): Promise<boolean> => {
      setAudioError(null)
      releaseAudioResources()
      setAudioPhase('loading')
      if (signal.aborted) {
        setAudioPhase('idle')
        return false
      }
      const audio = new Audio(url)
      applyMobileAudioAttrs(audio)
      audioRef.current = audio
      detachAudioUiRef.current = attachAudioUiSync(
        audio,
        setCurrentTime,
        setDuration,
        setAudioPaused,
      )
      audio.onended = () => {
        releaseAudioResources({ keepTimeline: true })
        setAudioPhase('idle')
      }
      audio.onerror = () => {
        setAudioError('Could not play audio in this browser.')
        releaseAudioResources()
        setAudioPhase('idle')
      }
      const markStarted = () => {
        const idx = currentTrackIndexRef.current
        setAlbumTracks((prev) =>
          prev.map((t, i) => (i === idx ? { ...t, hasStartedPlayback: true } : t)),
        )
      }
      audio.addEventListener('play', markStarted, { once: true })
      setAudioPhase('playing')
      try {
        await audio.play()
      } catch (e) {
        if (isAutoplayPolicyBlock(e)) {
          releaseAudioResources()
          setAudioPhase('idle')
          setAudioError(
            'This browser only allows audio right after you tap. Tap play to start.',
          )
          return false
        }
        setAudioError('Could not play audio in this browser.')
        releaseAudioResources()
        setAudioPhase('idle')
        return false
      }
      return true
    },
    [releaseAudioResources],
  )

  /**
   * One Audio element: merge segment blobs as each TTS promise resolves, patch the main track URL,
   * swap `src` while preserving playback time so the tour is one continuous file that grows.
   */
  const playGrowingMergedSegmentPromises = useCallback(
    async (mainId: string, segmentPromises: Promise<Blob>[], signal: AbortSignal) => {
      setAudioError(null)
      releaseAudioResources()
      setAudioPhase('loading')
      if (signal.aborted) {
        setAudioPhase('idle')
        return
      }
      for (const p of segmentPromises) {
        void p.catch(() => new Blob())
      }

      const audio = new Audio()
      applyMobileAudioAttrs(audio)
      audioRef.current = audio

      const markStartedOnce = () => {
        const idx = currentTrackIndexRef.current
        setAlbumTracks((prev) =>
          prev.map((t, i) => (i === idx ? { ...t, hasStartedPlayback: true } : t)),
        )
      }

      let lastCommittedUrl: string | null = null
      const blobs: Blob[] = []

      const waitLoadedMetadata = () =>
        new Promise<void>((resolve, reject) => {
          const ok = () => {
            audio.removeEventListener('loadedmetadata', ok)
            audio.removeEventListener('error', bad)
            resolve()
          }
          const bad = () => {
            audio.removeEventListener('loadedmetadata', ok)
            audio.removeEventListener('error', bad)
            reject(new Error('Could not load audio'))
          }
          audio.addEventListener('loadedmetadata', ok, { once: true })
          audio.addEventListener('error', bad, { once: true })
        })

      try {
        for (let i = 0; i < segmentPromises.length; i++) {
          if (signal.aborted) {
            setAudioPhase('idle')
            return
          }
          const piece = await segmentPromises[i]!
          if (signal.aborted) {
            setAudioPhase('idle')
            return
          }
          blobs.push(piece)
          const merged = new Blob(blobs, { type: 'audio/mpeg' })
          const url = URL.createObjectURL(merged)

          const prevTime = audio.src && audio.readyState >= 1 ? audio.currentTime : 0

          audio.pause()
          detachAudioUiRef.current?.()
          detachAudioUiRef.current = attachAudioUiSync(
            audio,
            setCurrentTime,
            setDuration,
            setAudioPaused,
          )
          audio.src = url
          audio.load()

          try {
            await waitLoadedMetadata()
          } catch {
            if (lastCommittedUrl) URL.revokeObjectURL(lastCommittedUrl)
            URL.revokeObjectURL(url)
            setAudioError('Could not play audio in this browser.')
            releaseAudioResources()
            setAudioPhase('idle')
            return
          }

          if (lastCommittedUrl) URL.revokeObjectURL(lastCommittedUrl)
          lastCommittedUrl = url
          setAlbumTracks((prev) =>
            prev.map((t) => (t.id === mainId ? { ...t, status: 'ready' as const, audioObjectUrl: url } : t)),
          )

          if (i > 0 && prevTime > 0) {
            const d = audio.duration
            const cap = Number.isFinite(d) && d > 0 ? Math.max(0, d - 0.06) : prevTime
            audio.currentTime = Math.min(prevTime, cap)
          }

          if (i === 0) {
            audio.addEventListener('play', markStartedOnce, { once: true })
          }

          setAudioPhase('playing')
          try {
            await audio.play()
          } catch (e) {
            if (isAutoplayPolicyBlock(e)) {
              setAudioError(
                'This browser only allows audio right after you tap. Tap play to start.',
              )
            } else {
              setAudioError('Could not play audio in this browser.')
            }
            releaseAudioResources()
            setAudioPhase('idle')
            return
          }
        }

        audio.onended = () => {
          releaseAudioResources({ keepTimeline: true })
          setAudioPhase('idle')
        }
        audio.onerror = () => {
          setAudioError('Could not play audio in this browser.')
          releaseAudioResources()
          setAudioPhase('idle')
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setAudioPhase('idle')
          return
        }
        setAudioError(e instanceof Error ? e.message : 'Failed to load audio.')
        releaseAudioResources()
        setAudioPhase('idle')
      }
    },
    [releaseAudioResources],
  )

  /** Patch album track by stable id */
  const patchTrack = useCallback((id: string, patch: Partial<AlbumTrack>) => {
    setAlbumTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const fetchSecondaries = useCallback(
    async (mainScript: string, signal: AbortSignal) => {
      setSecondariesRequestLoading(true)
      setAlbumError(null)
      const placesPayload = nearby?.ok === true ? nearby.places : []
      const wikiTitle = wiki?.ok === true ? wiki.title : ''
      const wikiExtract = wiki?.ok === true ? wiki.extract : ''
      try {
        const res = await fetch('/api/generate-secondary-tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            persona,
            mainScript,
            places: placesPayload,
            wikiTitle,
            wikiExtract,
            latitude: lat,
            longitude: lng,
            placeScope,
            placeDetailsJson,
          }),
        })
        if (!res.ok) {
          let msg = `Album tracks failed (${res.status})`
          try {
            const j = (await res.json()) as { error?: string }
            if (typeof j.error === 'string' && j.error.trim()) msg = j.error.trim()
          } catch {
            /* */
          }
          setAlbumError(msg)
          return []
        }
        const j = (await res.json()) as {
          tracks?: {
            id: string
            title: string
            script: string
            description?: string
            lat?: number
            lng?: number
            mapsSearchQuery?: string
            googleMapsUrl?: string
            wikipediaUrl?: string
            rating?: number
          }[]
        }
        const raw = Array.isArray(j.tracks) ? j.tracks : []
        const mapped: AlbumTrack[] = raw.map((row, i) => ({
          id: row.id || `sec-${i}`,
          title: row.title,
          description: row.description,
          orderIndex: i + 1,
          status: 'queued' as AlbumTrackStatus,
          scriptText: row.script,
          mapsSearchQuery: row.mapsSearchQuery,
          googleMapsUrl:
            row.googleMapsUrl?.trim() ||
            googleMapsSearchUrl(row.mapsSearchQuery?.trim() || row.title),
          wikipediaUrl: row.wikipediaUrl?.trim() || undefined,
          lat: row.lat,
          lng: row.lng,
          rating: row.rating,
          hasStartedPlayback: false,
        }))
        const ordered = orderSecondariesForWalk(lat!, lng!, mapped)
        return ordered
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return []
        setAlbumError(e instanceof Error ? e.message : 'Could not load album tracks.')
        return []
      } finally {
        setSecondariesRequestLoading(false)
      }
    },
    [lat, lng, persona, nearby, wiki, placeScope, placeDetailsJson],
  )

  const synthesizeTrackAudio = useCallback(
    async (trackId: string, rawScript: string, signal: AbortSignal) => {
      patchTrack(trackId, { status: 'synthesizing', errorMessage: undefined })
      try {
        const blob = await ttsBlobFor(rawScript, persona, signal)
        if (signal.aborted) return
        const url = URL.createObjectURL(blob)
        patchTrack(trackId, { status: 'ready', audioObjectUrl: url })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        patchTrack(trackId, {
          status: 'error',
          errorMessage: e instanceof Error ? e.message : 'TTS failed',
        })
      }
    },
    [patchTrack, persona],
  )

  const startFullTour = useCallback(
    async (personaOverride?: PersonaId) => {
      const voicePersona = personaOverride ?? persona
      setScriptError(null)
      setAudioError(null)
      setAlbumError(null)
      setAlbumTracks([])
      setCurrentTrackIndex(0)
      mainTtsStreamRef.current = null
      if (prefetchBlocking) {
        setScriptError('Still gathering context for this place.')
        return
      }
      if (!canGenerate || lat == null || lng == null) {
        setScriptError('No tour data available for this location.')
        return
      }

      scriptAbortRef.current?.abort()
      const scriptAc = new AbortController()
      scriptAbortRef.current = scriptAc

      secondaryListAbortRef.current?.abort()
      const listAc = new AbortController()
      secondaryListAbortRef.current = listAc

      ttsAbortRef.current?.abort()
      const ttsAc = new AbortController()
      ttsAbortRef.current = ttsAc

      setScriptText('')
      setScriptBusy(true)

      const placesPayload = nearby?.ok === true ? nearby.places : []
      const wikiTitle = wiki?.ok === true ? wiki.title : ''
      const wikiExtract = wiki?.ok === true ? wiki.extract : ''

      let accumulated = ''

      try {
        const res = await fetch('/api/generate-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: scriptAc.signal,
          body: JSON.stringify({
            persona: voicePersona,
            places: placesPayload,
            wikiTitle,
            wikiExtract,
            latitude: lat,
            longitude: lng,
            placeScope,
            placeDetailsJson,
          }),
        })

        if (!res.ok) {
          let msg = `Request failed (${res.status})`
          try {
            const j = (await res.json()) as { error?: string }
            if (typeof j.error === 'string' && j.error.trim()) msg = j.error.trim()
          } catch {
            /* */
          }
          mainTtsStreamRef.current = null
          setScriptError(msg)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          mainTtsStreamRef.current = null
          setScriptError('No response body from script API.')
          return
        }

        const decoder = new TextDecoder()
        let carry = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          carry += decoder.decode(value, { stream: true })

          while (true) {
            const nl = carry.indexOf('\n')
            if (nl === -1) break
            const line = carry.slice(0, nl).trim()
            carry = carry.slice(nl + 1)
            if (!line) continue
            try {
              const o = JSON.parse(line) as { t?: string; error?: string }
              if (typeof o.error === 'string' && o.error.trim()) {
                mainTtsStreamRef.current = null
                setScriptError(o.error.trim())
                return
              }
              if (typeof o.t === 'string' && o.t.length > 0) {
                accumulated += o.t
                setScriptText(accumulated)
                const cur = mainTtsStreamRef.current
                if (!cur && accumulated.length >= 420) {
                  const e1 = findSentenceBoundaryNear(accumulated, accumulated.length * 0.26, 240)
                  if (e1) {
                    mainTtsStreamRef.current = {
                      e1,
                      p1: ttsBlobFor(accumulated.slice(0, e1), voicePersona, ttsAc.signal),
                    }
                  }
                } else if (cur && cur.e2 == null && accumulated.length >= cur.e1 + 280) {
                  const e2 = findSentenceBoundaryNear(
                    accumulated,
                    accumulated.length * 0.52,
                    cur.e1 + 200,
                  )
                  if (e2) {
                    cur.e2 = e2
                    cur.p2 = ttsBlobFor(accumulated.slice(cur.e1, e2), voicePersona, ttsAc.signal)
                  }
                } else if (
                  cur &&
                  cur.e2 != null &&
                  cur.e3 == null &&
                  accumulated.length >= cur.e2 + 260
                ) {
                  const e3 = findSentenceBoundaryNear(
                    accumulated,
                    accumulated.length * 0.78,
                    cur.e2 + 200,
                  )
                  if (e3) {
                    cur.e3 = e3
                    cur.p3 = ttsBlobFor(accumulated.slice(cur.e2, e3), voicePersona, ttsAc.signal)
                  }
                }
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          mainTtsStreamRef.current = null
          return
        }
        mainTtsStreamRef.current = null
        setScriptError(e instanceof Error ? e.message : 'Failed to generate script.')
        return
      } finally {
        setScriptBusy(false)
        if (scriptAbortRef.current === scriptAc) scriptAbortRef.current = null
      }

      const fullScript = accumulated.trim()
      if (!fullScript) {
        mainTtsStreamRef.current = null
        return
      }

      const st = mainTtsStreamRef.current
      mainTtsStreamRef.current = null

      const mainId = 'track-main'
      const mainMapsQuery =
        selectedPlace?.label?.trim() && Number.isFinite(lat) && Number.isFinite(lng)
          ? `${selectedPlace.label.trim()} ${lat},${lng}`
          : selectedPlace?.label?.trim() || `${lat},${lng}`
      const mainGoogle = googleMapsSearchUrl(mainMapsQuery)
      const mainWiki =
        wiki?.ok === true && wiki.title.trim()
          ? wikipediaArticleUrl(wiki.title)
          : wikipediaSearchUrl(selectedPlace?.label?.trim() || mainMapsQuery)

      setAlbumTracks([
        {
          id: mainId,
          title: selectedPlace?.label ?? 'This stop',
          description: mainTrackDescriptionFromScript(fullScript),
          orderIndex: 0,
          status: 'queued',
          scriptText: fullScript,
          mapsSearchQuery: mainMapsQuery,
          googleMapsUrl: mainGoogle,
          wikipediaUrl: mainWiki,
          hasStartedPlayback: false,
        },
      ])

      void (async () => {
        const secs = await fetchSecondaries(fullScript, listAc.signal)
        if (listAc.signal.aborted) return
        setAlbumTracks((prev) => {
          const main = prev[0]
          if (!main) return prev
          return [main, ...secs]
        })
      })()

      setAudioPhase('loading')
      try {
        if (st?.e2 != null && st.p2 && st.e3 != null && st.p3) {
          const p4 = ttsBlobFor(accumulated.slice(st.e3).trim(), voicePersona, ttsAc.signal)
          await playGrowingMergedSegmentPromises(mainId, [st.p1, st.p2, st.p3, p4], ttsAc.signal)
        } else if (st?.e2 != null && st.p2) {
          const p3 = ttsBlobFor(accumulated.slice(st.e2).trim(), voicePersona, ttsAc.signal)
          await playGrowingMergedSegmentPromises(mainId, [st.p1, st.p2, p3], ttsAc.signal)
        } else if (st) {
          const pTail = ttsBlobFor(accumulated.slice(st.e1).trim(), voicePersona, ttsAc.signal)
          await playGrowingMergedSegmentPromises(mainId, [st.p1, pTail], ttsAc.signal)
        } else {
          const quad = splitMainScriptIntoFourParts(fullScript)
          if (quad) {
            const [a, b, c, d] = quad
            await playGrowingMergedSegmentPromises(
              mainId,
              [
                ttsBlobFor(a, voicePersona, ttsAc.signal),
                ttsBlobFor(b, voicePersona, ttsAc.signal),
                ttsBlobFor(c, voicePersona, ttsAc.signal),
                ttsBlobFor(d, voicePersona, ttsAc.signal),
              ],
              ttsAc.signal,
            )
          } else {
            const mergedBlob = await ttsBlobFor(fullScript, voicePersona, ttsAc.signal)
            if (ttsAc.signal.aborted) return
            const url = URL.createObjectURL(mergedBlob)
            patchTrack(mainId, { status: 'ready', audioObjectUrl: url })
            await playBlobUrl(url, ttsAc.signal)
            if (ttsAbortRef.current === ttsAc) ttsAbortRef.current = null
            return
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setAudioError(e instanceof Error ? e.message : 'Failed to load audio.')
        releaseAudioResources()
        setAudioPhase('idle')
      } finally {
        if (ttsAbortRef.current === ttsAc) ttsAbortRef.current = null
      }
    },
    [
      prefetchBlocking,
      canGenerate,
      lat,
      lng,
      persona,
      selectedPlace,
      nearby,
      wiki,
      placeScope,
      placeDetailsJson,
      fetchSecondaries,
      patchTrack,
      playBlobUrl,
      playGrowingMergedSegmentPromises,
      releaseAudioResources,
    ],
  )

  /** Sequential secondary synth: track1 after main audio ready; track k after track k-1 started playback. */
  useEffect(() => {
    const tracks = albumTracks
    if (tracks.length < 2) return

    const main = tracks[0]
    if (!main || main.status !== 'ready' || !main.audioObjectUrl) return

    const candidate = tracks.find((t, i) => {
      if (i === 0) return false
      if (t.status !== 'queued') return false
      if (i === 1) return true
      return tracks[i - 1]!.hasStartedPlayback
    })
    if (!candidate) return

    const ac = new AbortController()
    secondarySynthAcRef.current?.abort()
    secondarySynthAcRef.current = ac
    void synthesizeTrackAudio(candidate.id, candidate.scriptText, ac.signal)
    return undefined
  }, [albumTracks, synthesizeTrackAudio])

  const goToTrack = useCallback(
    async (index: number) => {
      const tracks = albumTracksRef.current
      if (index < 0 || index >= tracks.length) return
      const t = tracks[index]!
      const same = index === currentTrackIndexRef.current

      if (same && t.status === 'ready' && t.audioObjectUrl) {
        const a = audioRef.current
        const phase = audioPhaseRef.current
        if (a && phase === 'playing') {
          if (a.paused) void a.play()
          else a.pause()
          return
        }
        if (a && phase === 'idle') {
          ttsAbortRef.current?.abort()
          ttsAbortRef.current = new AbortController()
          setCurrentTrackIndex(index)
          await playBlobUrl(t.audioObjectUrl, ttsAbortRef.current.signal)
          return
        }
      }

      if (t.status === 'ready' && t.audioObjectUrl) {
        ttsAbortRef.current?.abort()
        ttsAbortRef.current = new AbortController()
        setCurrentTrackIndex(index)
        await playBlobUrl(t.audioObjectUrl, ttsAbortRef.current.signal)
        return
      }
      if (index > 0 && t.scriptText.trim() && (t.status === 'queued' || t.status === 'error')) {
        secondarySynthAcRef.current?.abort()
        const ac = new AbortController()
        secondarySynthAcRef.current = ac
        await synthesizeTrackAudio(t.id, t.scriptText, ac.signal)
        const after = albumTracksRef.current[index]
        if (after?.status === 'ready' && after.audioObjectUrl) {
          ttsAbortRef.current?.abort()
          ttsAbortRef.current = new AbortController()
          setCurrentTrackIndex(index)
          await playBlobUrl(after.audioObjectUrl, ttsAbortRef.current.signal)
        }
      }
    },
    [playBlobUrl, synthesizeTrackAudio],
  )

  const nextTrack = useCallback(async () => {
    const next = currentTrackIndex + 1
    if (next >= albumTracksRef.current.length) return
    await goToTrack(next)
  }, [currentTrackIndex, goToTrack])

  const prevTrack = useCallback(async () => {
    const prev = currentTrackIndex - 1
    if (prev < 0) return
    await goToTrack(prev)
  }, [currentTrackIndex, goToTrack])

  const seekBy = useCallback(
    (deltaSec: number) => {
      const a = audioRef.current
      if (!a || audioPhase !== 'playing') return
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration
      const next = Math.min(Math.max(0, a.currentTime + deltaSec), d || 0)
      a.currentTime = next
      setCurrentTime(next)
    },
    [audioPhase, duration],
  )

  const seekTo = useCallback(
    (t: number) => {
      const a = audioRef.current
      if (!a || audioPhase !== 'playing') return
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration
      const next = Math.min(Math.max(0, t), d || 0)
      a.currentTime = next
      setCurrentTime(next)
    },
    [audioPhase, duration],
  )

  const restartAudioFromStart = useCallback(async () => {
    const idx = currentTrackIndex
    const t = albumTracksRef.current[idx]
    if (!t?.scriptText.trim()) return
    const a = audioRef.current
    if (a && audioPhase === 'playing') {
      a.currentTime = 0
      setCurrentTime(0)
      void a.play()
      return
    }
    if (audioPhase === 'idle' && t?.audioObjectUrl) {
      ttsAbortRef.current?.abort()
      ttsAbortRef.current = new AbortController()
      await playBlobUrl(t.audioObjectUrl, ttsAbortRef.current.signal)
    }
  }, [audioPhase, currentTrackIndex, playBlobUrl])

  const tourBusy = scriptBusy || audioBusy || secondariesRequestLoading

  const togglePlayPause = useCallback(() => {
    const a = audioRef.current
    if (audioPhase === 'playing' && a) {
      if (a.paused) void a.play()
      else a.pause()
      return
    }
    if (audioPhase === 'idle') {
      const t = albumTracksRef.current[currentTrackIndex]
      if (t?.audioObjectUrl) {
        void restartAudioFromStart()
      }
    }
  }, [audioPhase, currentTrackIndex, restartAudioFromStart])

  const restoreAlbumFromTracks = useCallback((tracks: AlbumTrack[]) => {
    scriptAbortRef.current?.abort()
    secondaryListAbortRef.current?.abort()
    stopTour()
    setScriptBusy(false)
    setSecondariesRequestLoading(false)
    revokeTrackUrls(albumTracksRef.current)
    setAlbumTracks(tracks.map((t) => ({ ...t, hasStartedPlayback: false })))
    setScriptText(tracks[0]?.scriptText ?? '')
    setCurrentTrackIndex(0)
    setAudioPhase('idle')
    setAudioError(null)
    setScriptError(null)
    setAlbumError(null)
  }, [stopTour])

  return {
    prefetchLoading: prefetchBlocking,
    placeScope,
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
    restartAudioFromStart,
    restoreAlbumFromTracks,
  }
}
