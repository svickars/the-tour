import type { VercelRequest, VercelResponse } from '@vercel/node'

const PLACES_GET_BASE = 'https://places.googleapis.com/v1/places/' as const

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
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  const top = body.message
  if (typeof top === 'string' && top.trim()) return top.trim()
  return `Google Places request failed (${status})`
}

function clientStatusForGoogleResponse(googleStatus: number): number {
  if (googleStatus >= 400 && googleStatus < 500) return googleStatus
  return 502
}

function normalizePlaceResourceName(placeId: string): string {
  const t = placeId.trim()
  if (!t) return ''
  if (t.startsWith('places/')) return t.slice('places/'.length)
  return t
}

export type PlaceDetailsOk = {
  ok: true
  displayName: string
  types: string[]
  editorialSummary?: string
  rating?: number
  userRatingCount?: number
  reviewSnippets: { text: string; authorLabel?: string }[]
}

export type PlaceDetailsPayload = PlaceDetailsOk | { ok: false; error: string }

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' } satisfies PlaceDetailsPayload)
    return
  }

  let body: unknown
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body as string) : req.body
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid JSON body' } satisfies PlaceDetailsPayload)
    return
  }

  if (!isRecord(body)) {
    res.status(400).json({ ok: false, error: 'Expected JSON object' } satisfies PlaceDetailsPayload)
    return
  }

  const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : ''
  if (!placeId) {
    res.status(400).json({ ok: false, error: 'Missing placeId' } satisfies PlaceDetailsPayload)
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({
      ok: false,
      error: 'Places details is not configured on the server.',
    } satisfies PlaceDetailsPayload)
    return
  }

  const idPart = encodeURIComponent(normalizePlaceResourceName(placeId))
  const url = `${PLACES_GET_BASE}${idPart}`
  const fieldMask = [
    'id',
    'displayName',
    'types',
    'editorialSummary',
    'rating',
    'userRatingCount',
    'reviews',
  ].join(',')

  try {
    const googleRes = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
    })

    const rawText = await googleRes.text()
    let parsed: unknown
    try {
      parsed = rawText ? JSON.parse(rawText) : null
    } catch {
      res.status(502).json({
        ok: false,
        error: `Could not parse Google Places response (HTTP ${googleRes.status}).`,
      } satisfies PlaceDetailsPayload)
      return
    }

    if (!googleRes.ok) {
      res.status(clientStatusForGoogleResponse(googleRes.status)).json({
        ok: false,
        error: readGoogleErrorMessage(parsed, googleRes.status),
      } satisfies PlaceDetailsPayload)
      return
    }

    if (!isRecord(parsed)) {
      res.status(502).json({ ok: false, error: 'Invalid Places response.' } satisfies PlaceDetailsPayload)
      return
    }

    let displayName = ''
    const dn = parsed.displayName
    if (isRecord(dn) && typeof dn.text === 'string') displayName = dn.text.trim()

    const typesRaw = parsed.types
    const types: string[] = []
    if (Array.isArray(typesRaw)) {
      for (const t of typesRaw) {
        if (typeof t === 'string') types.push(t)
      }
    }

    const editorialSummary = (() => {
      const es = parsed.editorialSummary
      if (isRecord(es) && typeof es.text === 'string') return es.text.trim()
      return undefined
    })()

    const rating = typeof parsed.rating === 'number' && Number.isFinite(parsed.rating) ? parsed.rating : undefined
    const userRatingCount =
      typeof parsed.userRatingCount === 'number' && Number.isFinite(parsed.userRatingCount)
        ? Math.floor(parsed.userRatingCount)
        : undefined

    const reviewSnippets: { text: string; authorLabel?: string }[] = []
    const reviewsRaw = parsed.reviews
    if (Array.isArray(reviewsRaw)) {
      for (const r of reviewsRaw) {
        if (!isRecord(r)) continue
        const text = (() => {
          const t = r.text
          if (isRecord(t) && typeof t.text === 'string') return t.text.trim()
          return ''
        })()
        if (!text) continue
        const authorLabel = (() => {
          const a = r.authorAttribution
          if (!isRecord(a)) return undefined
          const disp = typeof a.displayName === 'string' ? a.displayName.trim() : ''
          return disp || undefined
        })()
        reviewSnippets.push({ text: text.slice(0, 800), authorLabel })
        if (reviewSnippets.length >= 5) break
      }
    }

    const payload: PlaceDetailsPayload = {
      ok: true,
      displayName: displayName || 'Place',
      types,
      editorialSummary,
      rating,
      userRatingCount,
      reviewSnippets,
    }
    res.status(200).json(payload)
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Unknown error'
    res.status(502).json({
      ok: false,
      error: `Places details request failed: ${detail}`,
    } satisfies PlaceDetailsPayload)
  }
}
