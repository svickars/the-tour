/**
 * Geo-related HTTP helpers. Google Places Nearby Search runs on the server
 * (`/api/places-nearby`); the browser never sees `GOOGLE_PLACES_API_KEY`.
 * Use `vercel dev` locally so `/api` routes are available alongside Vite.
 */

import type { PlaceDetailsSummary } from './tourTypes'

export type NearbyPlace = {
  name: string
  types: string[]
  placeId?: string
  lat?: number
  lng?: number
  rating?: number
  userRatingCount?: number
}

export type NearbyPlacesResult =
  | { ok: true; places: NearbyPlace[] }
  | { ok: false; error: string }

export type WikipediaExtractResult =
  | { ok: true; title: string; extract: string }
  | { ok: false; error: string }

export type FetchNearbyPlacesOptions = {
  /** Search radius in meters (default 500). */
  radiusMeters?: number
}

export type FetchWikipediaExtractOptions = {
  /** Geosearch radius in meters (default 1000, max 10_000). */
  radiusMeters?: number
  /** Wikipedia language subdomain (default `"en"`). */
  language?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseNearbyPlacesResponse(body: unknown): NearbyPlacesResult {
  if (!isRecord(body) || typeof body.ok !== 'boolean') {
    return { ok: false, error: 'Invalid response from places API.' }
  }
  if (body.ok === false) {
    const err = body.error
    return {
      ok: false,
      error: typeof err === 'string' && err.trim() ? err : 'Places search failed.',
    }
  }
  const placesRaw = body.places
  if (!Array.isArray(placesRaw)) {
    return { ok: false, error: 'Invalid response from places API.' }
  }
  const places: NearbyPlace[] = []
  for (const row of placesRaw) {
    if (!isRecord(row)) continue
    const name = row.name
    const typesRaw = row.types
    if (typeof name !== 'string' || !name.trim()) continue
    const types: string[] = []
    if (Array.isArray(typesRaw)) {
      for (const t of typesRaw) {
        if (typeof t === 'string') types.push(t)
      }
    }
    const placeId =
      typeof row.placeId === 'string' && row.placeId.trim() ? row.placeId.trim() : undefined
    const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined
    const lng = typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : undefined
    const rating =
      typeof row.rating === 'number' && Number.isFinite(row.rating) ? row.rating : undefined
    const userRatingCount =
      typeof row.userRatingCount === 'number' && Number.isFinite(row.userRatingCount)
        ? row.userRatingCount
        : undefined
    places.push({
      name: name.trim(),
      types,
      placeId,
      lat,
      lng,
      rating,
      userRatingCount,
    })
  }
  return { ok: true, places }
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetailsSummary> {
  const id = placeId.trim()
  if (!id) {
    return { ok: false, error: 'Missing place id.' }
  }
  try {
    const res = await fetch('/api/place-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: id }),
    })
    const raw = await res.text()
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      return { ok: false, error: `Could not parse place details (HTTP ${res.status}).` }
    }
    if (!isRecord(body) || typeof body.ok !== 'boolean') {
      return { ok: false, error: 'Invalid place details response.' }
    }
    if (body.ok === false) {
      const err = body.error
      return {
        ok: false,
        error: typeof err === 'string' && err.trim() ? err : 'Place details failed.',
      }
    }
    const displayName = body.displayName
    const typesRaw = body.types
    const reviewSnippetsRaw = body.reviewSnippets
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return { ok: false, error: 'Invalid place details payload.' }
    }
    const types: string[] = []
    if (Array.isArray(typesRaw)) {
      for (const t of typesRaw) {
        if (typeof t === 'string') types.push(t)
      }
    }
    const reviewSnippets: { text: string; authorLabel?: string }[] = []
    if (Array.isArray(reviewSnippetsRaw)) {
      for (const r of reviewSnippetsRaw) {
        if (!isRecord(r)) continue
        const text = typeof r.text === 'string' ? r.text : ''
        if (!text.trim()) continue
        const authorLabel =
          typeof r.authorLabel === 'string' && r.authorLabel.trim()
            ? r.authorLabel.trim()
            : undefined
        reviewSnippets.push({ text: text.trim(), authorLabel })
      }
    }
    const editorialSummary =
      typeof body.editorialSummary === 'string' && body.editorialSummary.trim()
        ? body.editorialSummary.trim()
        : undefined
    const rating =
      typeof body.rating === 'number' && Number.isFinite(body.rating) ? body.rating : undefined
    const userRatingCount =
      typeof body.userRatingCount === 'number' && Number.isFinite(body.userRatingCount)
        ? Math.floor(body.userRatingCount)
        : undefined
    return {
      ok: true,
      displayName: displayName.trim(),
      types,
      editorialSummary,
      rating,
      userRatingCount,
      reviewSnippets,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not load place details.',
    }
  }
}

/**
 * Proxies to server `/api/places-nearby` (Places API v1 Nearby Search).
 */
export async function fetchNearbyPlaceNamesAndTypes(
  latitude: number,
  longitude: number,
  options?: FetchNearbyPlacesOptions,
): Promise<NearbyPlacesResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'Invalid latitude or longitude.' }
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  })
  if (options?.radiusMeters !== undefined) {
    params.set('radius', String(options.radiusMeters))
  }

  try {
    const res = await fetch(`/api/places-nearby?${params.toString()}`)

    const raw = await res.text()
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      const preview = raw.slice(0, 120).replace(/\s+/g, ' ')
      if (res.status === 502 && raw.trimStart().startsWith('<')) {
        return {
          ok: false,
          error:
            'Places API returned an error page (HTTP 502). For local dev run `pnpm dev:vercel` so `/api` routes run, and set `GOOGLE_PLACES_API_KEY` with Places API (New) enabled.',
        }
      }
      return {
        ok: false,
        error: `Could not parse places API response (HTTP ${res.status}). ${preview}`,
      }
    }

    const parsed = parseNearbyPlacesResponse(body)
    if (!res.ok && parsed.ok) {
      return { ok: false, error: 'Places search failed.' }
    }
    return parsed
  } catch (e) {
    const message =
      e instanceof TypeError && e.message === 'Failed to fetch'
        ? 'Network error (use `vercel dev` locally so /api routes are served).'
        : e instanceof Error
          ? e.message
          : 'Unknown error while contacting places API.'
    return { ok: false, error: message }
  }
}

function wikipediaApiUrl(language: string): string {
  const host = `${language.trim() || 'en'}.wikipedia.org`
  return `https://${host}/w/api.php`
}

/** Wikimedia JSON uses `error: { code, info }` instead of `query` when the request is rejected. */
function parseMediaWikiError(body: unknown): string | null {
  if (!isRecord(body)) return null
  const err = body.error
  if (!isRecord(err)) return null
  if (typeof err.info === 'string' && err.info.trim()) return err.info.trim()
  if (typeof err.code === 'string' && err.code.trim()) return err.code.trim()
  return null
}

function readPageId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function parseGeosearchFirstPageId(body: unknown): number | null {
  if (!isRecord(body) || !isRecord(body.query)) return null
  const list = body.query.geosearch
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0]
  if (!isRecord(first)) return null
  return readPageId(first.pageid)
}

function parseExtractFromPages(
  body: unknown,
  pageId: number,
): { title: string; extract: string } | null {
  if (!isRecord(body) || !isRecord(body.query)) return null
  const pages = body.query.pages
  if (!isRecord(pages)) return null
  const page = pages[String(pageId)]
  if (!isRecord(page)) return null

  const missing = page.missing
  if (missing === true || missing === '') return null

  const title = typeof page.title === 'string' ? page.title : ''
  const extract = typeof page.extract === 'string' ? page.extract : ''
  return { title, extract }
}

/**
 * Uses Wikipedia `geosearch` for the nearest page, then fetches an introductory plain-text `extract`.
 */
export async function fetchNearestWikipediaExtract(
  latitude: number,
  longitude: number,
  options?: FetchWikipediaExtractOptions,
): Promise<WikipediaExtractResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'Invalid latitude or longitude.' }
  }

  const language = options?.language ?? 'en'
  const radius = Math.min(
    10_000,
    Math.max(1, Math.floor(options?.radiusMeters ?? 1000)),
  )
  const base = wikipediaApiUrl(language)

  const geoParams = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${latitude}|${longitude}`,
    gsradius: String(radius),
    gslimit: '1',
    gsnamespace: '0',
    format: 'json',
    origin: '*',
  })

  const wikiHeaders = {
    Accept: 'application/json',
    'User-Agent': 'TheTour/1.0 (https://github.com/svickars/the-tour; contact: local-dev)',
  } as const

  try {
    const geoRes = await fetch(`${base}?${geoParams.toString()}`, {
      headers: wikiHeaders,
    })

    let geoBody: unknown
    try {
      geoBody = await geoRes.json()
    } catch {
      return { ok: false, error: 'Could not parse Wikipedia geosearch response.' }
    }

    if (!geoRes.ok) {
      return {
        ok: false,
        error: `Wikipedia geosearch failed (${geoRes.status}).`,
      }
    }

    const wikiErr = parseMediaWikiError(geoBody)
    if (wikiErr) {
      return { ok: false, error: wikiErr }
    }

    const pageId = parseGeosearchFirstPageId(geoBody)
    if (pageId === null) {
      return {
        ok: false,
        error: 'No Wikipedia article found near this location.',
      }
    }

    const extractParams = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exintro: 'true',
      explaintext: 'true',
      pageids: String(pageId),
      format: 'json',
      origin: '*',
    })

    const exRes = await fetch(`${base}?${extractParams.toString()}`, {
      headers: wikiHeaders,
    })

    let exBody: unknown
    try {
      exBody = await exRes.json()
    } catch {
      return { ok: false, error: 'Could not parse Wikipedia extract response.' }
    }

    if (!exRes.ok) {
      return {
        ok: false,
        error: `Wikipedia extract request failed (${exRes.status}).`,
      }
    }

    const extractErr = parseMediaWikiError(exBody)
    if (extractErr) {
      return { ok: false, error: extractErr }
    }

    const parsed = parseExtractFromPages(exBody, pageId)
    if (!parsed) {
      return {
        ok: false,
        error: 'Wikipedia returned no extract for the nearest article.',
      }
    }

    return { ok: true, title: parsed.title, extract: parsed.extract }
  } catch (e) {
    const message =
      e instanceof TypeError && e.message === 'Failed to fetch'
        ? 'Network error while contacting Wikipedia.'
        : e instanceof Error
          ? e.message
          : 'Unknown error while contacting Wikipedia.'
    return { ok: false, error: message }
  }
}
