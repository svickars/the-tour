import { useEffect, useRef, useState } from 'react'
import { loadGoogleMapsScript } from '../lib/loadGoogleMaps'
import type { SelectedPlace } from '../lib/tourTypes'

export type PlacesSearchProps = {
  apiKey: string | undefined
  /** When set (e.g. after “Use my location” or a card), mirrors the chosen label in the widget. */
  reflectLabel?: string | undefined
  onPlaceSelected: (place: SelectedPlace) => void
}

export function PlacesSearch({
  apiKey,
  reflectLabel,
  onPlaceSelected,
}: PlacesSearchProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const pacRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null)
  const [mapsError, setMapsError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const key = apiKey?.trim()
    if (!key) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        await loadGoogleMapsScript(key)
        if (cancelled) return
        await google.maps.importLibrary('places')
        if (cancelled) return
        setMapsError(null)
        setReady(true)
      } catch (e: unknown) {
        if (cancelled) return
        setReady(false)
        setMapsError(
          e instanceof Error ? e.message : 'Could not load address search.',
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apiKey])

  useEffect(() => {
    if (!ready || !apiKey?.trim()) return
    const host = hostRef.current
    if (!host) return

    const el = new google.maps.places.PlaceAutocompleteElement({})
    el.placeholder = 'Visit anywhere...'

    let alive = true

    const onSelect = async (ev: Event) => {
      if (!alive) return
      const e = ev as google.maps.places.PlacePredictionSelectEvent
      const place = e.placePrediction.toPlace()
      try {
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'id', 'types'],
        })
      } catch {
        if (!alive) return
        setMapsError('Could not load place details.')
        return
      }

      if (!alive) return

      const loc = place.location
      if (!loc) {
        setMapsError('No coordinates for this place.')
        return
      }

      setMapsError(null)
      const lat = loc.lat()
      const lng = loc.lng()
      const dn = place.displayName
      const displayText =
        typeof dn === 'string'
          ? dn.trim()
          : dn && typeof dn === 'object' && 'text' in dn && typeof (dn as { text?: string }).text === 'string'
            ? (dn as { text: string }).text.trim()
            : ''
      const label =
        place.formattedAddress?.trim() || displayText || 'Selected place'
      let placeId: string | undefined
      if (typeof place.id === 'string' && place.id.trim()) {
        placeId = place.id.trim().replace(/^places\//, '')
      }
      const types: string[] = []
      if (Array.isArray(place.types)) {
        for (const t of place.types) {
          if (typeof t === 'string') types.push(t)
        }
      }
      onPlaceSelected({
        label,
        lat,
        lng,
        placeId,
        displayName: displayText || undefined,
        types: types.length ? types : undefined,
      })
    }

    const ac = new AbortController()
    el.addEventListener('gmp-select', (ev) => void onSelect(ev), {
      signal: ac.signal,
    })
    host.appendChild(el)
    pacRef.current = el

    return () => {
      alive = false
      ac.abort()
      pacRef.current = null
      el.remove()
    }
  }, [ready, apiKey, onPlaceSelected])

  useEffect(() => {
    if (!ready || reflectLabel === undefined || reflectLabel === '') return
    const el = pacRef.current
    if (!el) return
    el.value = reflectLabel
  }, [reflectLabel, ready])

  const hasKey = Boolean(apiKey?.trim())

  return (
    <div className="places-search">
      <div className="places-autocomplete-pill">
        <div
          ref={hostRef}
          className="places-autocomplete-host"
          aria-label="Visit anywhere"
        />
      </div>
      {!hasKey && (
        <p className="field-hint field-hint-warn" role="status">
          Set <code className="inline-code">VITE_GOOGLE_MAPS_API_KEY</code> to
          enable search.
        </p>
      )}
      {hasKey && !ready && !mapsError && (
        <p className="field-hint" role="status">
          Loading search…
        </p>
      )}
      {mapsError && (
        <p className="field-hint field-hint-warn" role="alert">
          {mapsError}
        </p>
      )}
    </div>
  )
}
