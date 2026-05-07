import type { VercelRequest, VercelResponse } from '@vercel/node'

const GOOGLE_NEARBY_URL =
  'https://places.googleapis.com/v1/places:searchNearby' as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readGoogleErrorMessage(body: unknown, status: number): string {
  if (!isRecord(body)) {
    return `Google Places request failed (${status})`
  }
  const err = body.error
  if (isRecord(err)) {
    const message = err.message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
    const statusText = err.status
    if (typeof statusText === 'string' && statusText.trim()) {
      return `${statusText.trim()} (${status})`
    }
  }
  const top = body.message
  if (typeof top === 'string' && top.trim()) {
    return top.trim()
  }
  return `Google Places request failed (${status})`
}

function clientStatusForGoogleResponse(googleStatus: number): number {
  if (googleStatus >= 400 && googleStatus < 500) return googleStatus
  return 502
}

export type NearbyPlaceRow = {
  name: string
  types: string[]
  placeId?: string
  lat?: number
  lng?: number
  rating?: number
  userRatingCount?: number
}

function parseNearbyPlacesBody(body: unknown): NearbyPlaceRow[] {
  if (!isRecord(body) || !Array.isArray(body.places)) {
    return []
  }

  const out: NearbyPlaceRow[] = []

  for (const place of body.places) {
    if (!isRecord(place)) continue

    let name = ''
    const displayName = place.displayName
    if (isRecord(displayName) && typeof displayName.text === 'string') {
      name = displayName.text.trim()
    }

    const typesRaw = place.types
    const types: string[] = []
    if (Array.isArray(typesRaw)) {
      for (const t of typesRaw) {
        if (typeof t === 'string') types.push(t)
      }
    }

    let placeId: string | undefined
    if (typeof place.id === 'string' && place.id.trim()) {
      const id = place.id.trim()
      placeId = id.startsWith('places/') ? id.slice('places/'.length) : id
    }

    let lat: number | undefined
    let lng: number | undefined
    const loc = place.location
    if (isRecord(loc)) {
      const la = loc.latitude
      const ln = loc.longitude
      if (typeof la === 'number' && Number.isFinite(la)) lat = la
      if (typeof ln === 'number' && Number.isFinite(ln)) lng = ln
    }

    const rating =
      typeof place.rating === 'number' && Number.isFinite(place.rating) ? place.rating : undefined
    const userRatingCount =
      typeof place.userRatingCount === 'number' && Number.isFinite(place.userRatingCount)
        ? Math.floor(place.userRatingCount)
        : undefined

    if (name) {
      out.push({ name, types, placeId, lat, lng, rating, userRatingCount })
    }
    if (out.length >= 15) break
  }

  return out
}

type NearbyPlacesPayload =
  | { ok: true; places: NearbyPlaceRow[] }
  | { ok: false; error: string }

function firstQuery(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' } satisfies NearbyPlacesPayload)
    return
  }

  const lat = Number(firstQuery(req.query.latitude))
  const lng = Number(firstQuery(req.query.longitude))
  const radiusParam = firstQuery(req.query.radius)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res
      .status(400)
      .json({ ok: false, error: 'Invalid latitude or longitude.' } satisfies NearbyPlacesPayload)
    return
  }

  let radiusMeters = 800
  if (radiusParam !== undefined && radiusParam !== '') {
    const r = Number(radiusParam)
    if (Number.isFinite(r)) {
      radiusMeters = Math.min(50_000, Math.max(1, Math.floor(r)))
    }
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({
      ok: false,
      error: 'Places search is not configured on the server.',
    } satisfies NearbyPlacesPayload)
    return
  }

  try {
    const googleRes = await fetch(GOOGLE_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.types,places.id,places.location,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        maxResultCount: 15,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      }),
    })

    const rawText = await googleRes.text()
    let body: unknown
    try {
      body = rawText ? JSON.parse(rawText) : null
    } catch {
      const preview = rawText.slice(0, 160).replace(/\s+/g, ' ')
      res.status(502).json({
        ok: false,
        error: `Could not parse Google Places response (HTTP ${googleRes.status}). ${preview}`,
      } satisfies NearbyPlacesPayload)
      return
    }

    if (!googleRes.ok) {
      const payload: NearbyPlacesPayload = {
        ok: false,
        error: readGoogleErrorMessage(body, googleRes.status),
      }
      res.status(clientStatusForGoogleResponse(googleRes.status)).json(payload)
      return
    }

    const payload: NearbyPlacesPayload = {
      ok: true,
      places: parseNearbyPlacesBody(body),
    }
    res.status(200).json(payload)
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Unknown error'
    res.status(502).json({
      ok: false,
      error: `Places search request failed: ${detail}`,
    } satisfies NearbyPlacesPayload)
  }
}
