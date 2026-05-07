import type { VercelRequest, VercelResponse } from '@vercel/node'
import { parseVibeThemes, vibeThemesInstructionBlock } from './parseVibeThemes'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages' as const
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6' as const
const ANTHROPIC_VERSION = '2023-06-01' as const

type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted' | 'rick' | 'rosa' | 'gary' | 'thomas' | 'vega'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parsePersona(v: unknown): PersonaId | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return s === 'deadpan' ||
    s === 'enthusiastic' ||
    s === 'haunted' ||
    s === 'rick' ||
    s === 'rosa' ||
    s === 'gary' ||
    s === 'thomas' ||
    s === 'vega'
    ? (s as PersonaId)
    : null
}

function parsePlaces(v: unknown): {
  name: string
  types: string[]
  placeId?: string
  lat?: number
  lng?: number
  rating?: number
  userRatingCount?: number
}[] {
  if (!Array.isArray(v)) return []
  const out: {
    name: string
    types: string[]
    placeId?: string
    lat?: number
    lng?: number
    rating?: number
    userRatingCount?: number
  }[] = []
  for (const row of v) {
    if (!isRecord(row)) continue
    if (typeof row.name !== 'string' || !row.name.trim()) continue
    const typesRaw = row.types
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
    out.push({
      name: row.name.trim(),
      types,
      placeId,
      lat,
      lng,
      rating,
      userRatingCount,
    })
  }
  return out
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim()
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown
    } catch {
      return null
    }
  }
  let p = tryParse(trimmed)
  if (p != null) return p
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    p = tryParse(fence[1].trim())
    if (p != null) return p
  }
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start >= 0 && end > start) {
    p = tryParse(trimmed.slice(start, end + 1))
    if (p != null) return p
  }
  return null
}

function wikiSearchUrl(query: string): string {
  const q = query.trim()
  return `https://en.wikipedia.org/w/index.php?title=Special:Search&search=${encodeURIComponent(q)}`
}

function wikiArticleUrl(title: string): string {
  const t = title.trim().replace(/\s+/g, '_')
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(t)}`
}

function googleMapsUrlFromQuery(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`
}

export type SecondaryTrackPayload = {
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
}

function normalizeTracks(raw: unknown): SecondaryTrackPayload[] {
  if (!Array.isArray(raw)) return []
  const out: SecondaryTrackPayload[] = []
  let i = 0
  for (const row of raw) {
    if (!isRecord(row)) continue
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const script = typeof row.script === 'string' ? row.script.trim() : ''
    if (!title || !script) continue
    const description =
      typeof row.description === 'string' && row.description.trim()
        ? row.description.trim().slice(0, 220)
        : undefined
    const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined
    const lng = typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : undefined
    const mapsSearchQuery =
      typeof row.mapsSearchQuery === 'string' && row.mapsSearchQuery.trim()
        ? row.mapsSearchQuery.trim()
        : undefined
    const wikiTitle =
      typeof row.wikipediaArticleTitle === 'string' && row.wikipediaArticleTitle.trim()
        ? row.wikipediaArticleTitle.trim()
        : undefined
    const wikiSearchQ =
      typeof row.wikipediaSearchQuery === 'string' && row.wikipediaSearchQuery.trim()
        ? row.wikipediaSearchQuery.trim()
        : undefined
    const includeWiki =
      typeof row.includeWikipedia === 'boolean' ? row.includeWikipedia : true
    let wikipediaUrl: string | undefined
    if (includeWiki) {
      if (wikiTitle) wikipediaUrl = wikiArticleUrl(wikiTitle)
      else if (wikiSearchQ) wikipediaUrl = wikiSearchUrl(wikiSearchQ)
      else wikipediaUrl = wikiSearchUrl(title)
    }
    const googleMapsUrl =
      typeof row.googleMapsUrl === 'string' && row.googleMapsUrl.trim()
        ? row.googleMapsUrl.trim()
        : googleMapsUrlFromQuery(mapsSearchQuery ?? title)
    const rating =
      typeof row.rating === 'number' && Number.isFinite(row.rating) ? row.rating : undefined
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `sec-${i}`
    out.push({
      id,
      title,
      script,
      description,
      lat,
      lng,
      mapsSearchQuery,
      googleMapsUrl,
      wikipediaUrl,
      rating,
    })
    i++
    if (out.length >= 5) break
  }
  return out
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body as string) : req.body
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  if (!isRecord(body)) {
    res.status(400).json({ error: 'Expected JSON object' })
    return
  }

  const persona = parsePersona(body.persona)
  if (!persona) {
    res.status(400).json({ error: 'Invalid or missing persona' })
    return
  }

  const mainScript = typeof body.mainScript === 'string' ? body.mainScript.trim() : ''
  if (!mainScript) {
    res.status(400).json({ error: 'Missing mainScript' })
    return
  }

  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Invalid latitude or longitude' })
    return
  }

  const placeScope = body.placeScope === 'specific' || body.placeScope === 'broad' ? body.placeScope : 'broad'
  const places = parsePlaces(body.places)
  const wikiTitle = typeof body.wikiTitle === 'string' ? body.wikiTitle : ''
  const wikiExtract = typeof body.wikiExtract === 'string' ? body.wikiExtract : ''
  const placeDetailsJson =
    typeof body.placeDetailsJson === 'string' ? body.placeDetailsJson.trim() : ''

  const vibeThemes = parseVibeThemes(body)
  const vibeBlock = vibeThemes?.length ? vibeThemesInstructionBlock(vibeThemes) : ''

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({ error: 'Secondary tracks are not configured (missing API key).' })
    return
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL

  const groundingRule =
    persona === 'gary'
      ? '- Use real candidate place names from the nearby list as each clip subject, but facts, dates, causes, and citations may be confidently invented or wrong—that is the persona. Do not invent street addresses or URLs not implied by context.'
      : '- Scripts must be grounded in the provided nearby list / Wikipedia / place details. Do not invent addresses.'

  const system = `You create SHORT secondary walking-tour audio scripts (companion clips to a main narration).

Return ONLY a JSON array (no markdown fences, no commentary). Each element must be an object with:
- "id": short kebab-case string unique in this array
- "title": string (place name the clip is about)
- "description": string, ONE short sentence (max ~140 characters) for a UI card — what a visitor would notice first; no spoilers from the script
- "script": string (25–45 seconds spoken when read aloud; same persona/voice rules as main tour)
- "lat": optional number (WGS84 latitude if you are confident)
- "lng": optional number (WGS84 longitude if confident)
- "mapsSearchQuery": optional string (Google Maps search query if lat/lng uncertain)
- "googleMapsUrl": optional string (full https Google Maps URL; omit if you only have mapsSearchQuery)
- "wikipediaArticleTitle": optional string (exact English Wikipedia article title if a clear article exists, e.g. "Times Square")
- "wikipediaSearchQuery": optional string (only if no exact article title — search query for Wikipedia)
- "includeWikipedia": optional boolean (default true). Set false only when there is genuinely no sensible Wikipedia topic for this stop
- "rating": optional number (0–5) if you are inferring popularity from provided data only

Rules:
- Exactly 3 to 5 entries. Each must be a DISTINCT nearby place not identical to the main pin label.
- If placeScope is "specific", pick human-scale neighbours (streets, small venues, stations) that match the anchor's weight.
- If placeScope is "broad", pick iconic/high-signal stops a visitor might walk to nearby (landmarks, famous hotels, notable food).
${groundingRule}
- Same narrator persona as specified in the user message (${persona}).
- Plain spoken words only for "script" — no stage directions, markdown, or meta.

Persona texture:
- deadpan: dry, precise, wry asides.
- enthusiastic (Frankie): punchy jokes, hyperbole, one absurd comparison per clip, still truthful anchors.
- haunted (Shiva): darker mood, brief ghost-story beats clearly moored to real names/facts from context; label invention as mood not history when needed.
- rick (Rick): extra chill, laid-back bar energy; pile on "like", "whatever", "honestly", "friggin'", "freakin'" without forcing every line. Mild sarcasm, never mean. OK to skew darker or less rosy—rough reviews, sketchy blocks, the stop people love to hate—when context supports it; do not invent quotes or reviewer names. Short tangents, never tour-guide patter.
- rosa (Rosa): warm, slow, emotional; beauty in ordinary details—food, light, smell, crowds. Wistful asides OK; phrases like "what I love about this place", "you have to understand". Never rushed; no invented reviewer names or long fake quotes.
- gary (Gary): maximum bluff—fake journals, bogus symposia, invented scholars, self-contradiction ignored; still use real candidate titles from the list. "Historians have long debated", "little known fact", "as many of you will know", "famously of course". Earnest, never in on the joke; crank the pomposity.
- thomas (Thomas): Victorian gentleman adrift in the present—long winding sentences, heavy anecdote load (expeditions, steamers, luncheons abroad), then pivot to the modern absurdity at hand. "I say", "upon my word", "most curious", "Hobson would have known"; address Hobson though he is absent. Architecture, civic order, pigeons as moral actors; baffled courtesy toward technology. Still use real candidate titles from the list.
- vega (Vega / X-9): alien field report—flat affect, wrong-but-logical purpose guesses, "the subjects" / "biological units", "this unit has observed", "classification: unclear", occasional "recalibrating"; treat every stop with identical clinical fascination. Still use real candidate titles from the list.${vibeBlock}`

  const userLines = [
    `persona: ${persona}`,
    `placeScope: ${placeScope}`,
    `Anchor coordinates: ${lat}, ${lng}`,
    wikiTitle ? `Wikipedia article: ${wikiTitle}` : '',
    wikiExtract.trim() ? `Wikipedia excerpt (trimmed): ${wikiExtract.trim().slice(0, 1400)}` : '',
    places.length
      ? `Nearby candidates (JSON-ish): ${JSON.stringify(places).slice(0, 6000)}`
      : '',
    placeDetailsJson ? `Primary place details JSON: ${placeDetailsJson.slice(0, 4000)}` : '',
    '',
    'Main tour script (for continuity — do not repeat verbatim):',
    mainScript.slice(0, 3500),
  ]

  const userContent = userLines.filter(Boolean).join('\n')

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': process.env.ANTHROPIC_API_VERSION?.trim() || ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: false,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
  } catch {
    res.status(502).json({ error: 'Could not reach Anthropic API.' })
    return
  }

  const detail = await upstream.text()
  if (!upstream.ok) {
    res.status(502).json({
      error: 'Secondary tracks request failed.',
      detail: detail.slice(0, 500),
    })
    return
  }

  let text = ''
  try {
    const j = JSON.parse(detail) as {
      content?: { type?: string; text?: string }[]
    }
    const blocks = j.content
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') text += b.text
      }
    }
  } catch {
    res.status(502).json({ error: 'Invalid response from model.' })
    return
  }

  const parsed = extractJsonArray(text)
  const tracks = normalizeTracks(parsed)
  res.status(200).json({ tracks })
}
