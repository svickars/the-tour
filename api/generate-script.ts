import type { VercelRequest, VercelResponse } from '@vercel/node'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages' as const
/** `claude-sonnet-4-20250514` was deprecated; returns 404 when removed. Override with `ANTHROPIC_MODEL`. */
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6' as const
const ANTHROPIC_VERSION = '2023-06-01' as const

type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted'

const PERSONA_DISPLAY: Record<PersonaId, string> = {
  deadpan: 'Deadpan Academic',
  enthusiastic: 'Overly Enthusiastic Local',
  haunted: 'Haunted History Guide',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseAnthropicErrorMessage(detail: string, status: number): string {
  try {
    const j = JSON.parse(detail) as {
      error?: { message?: string; type?: string }
    }
    const msg = j.error?.message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  } catch {
    /* not JSON */
  }
  return `Anthropic request failed (${status}).`
}

function parsePersona(v: unknown): PersonaId | null {
  return v === 'deadpan' || v === 'enthusiastic' || v === 'haunted' ? v : null
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

function buildSystemPrompt(personaId: PersonaId): string {
  const name = PERSONA_DISPLAY[personaId]
  return `You are a guided audio tour narrator. Write a 60-90 second spoken script for a visitor at the provided location.

Rules:
- Stay in character as ${name} at all times
- Be specific about real place names and any real history provided
- Where real detail is thin, zoom out to the neighbourhood, city, or region and find something true to anchor the narration
- You may invent small, plausible details and stories, but never contradict real information provided
- Never mention AI, APIs, or that you are generating this
- Write for the ear, not the eye -- short sentences, natural pauses
- End with something that makes the listener look up and notice where they are
- Output the script as plain spoken words only. No stage directions, no sound cues, no throat-clearing, no markdown, no headers, no asterisks, no parentheticals, no delivery instructions. Write only the words the narrator will speak aloud.

Location scope:
- When the user message says placeScope is "specific", lean on the PRIMARY PLACE DETAILS and nearby list. You may paraphrase short review themes in natural speech (do not quote long passages; do not invent reviewer names or quotes that are not implied by the provided snippets).
- When placeScope is "broad", keep neighbourhood- and city-scale storytelling like a classic walking tour overview.

Personas:
- Deadpan Academic: dry, precise, slightly bored by your enthusiasm but genuinely knowledgeable. Occasional withering aside.
- Overly Enthusiastic Local (Frankie): everything is the BEST. Add one or two sharp comic beats per script (callbacks, hyperbole, a silly comparison) while staying truthful to anchors.
- Haunted History Guide (Shiva): lean heavily into haunted texture—dread, silence, what used to be here. Weave in brief ghost-story beats that are clearly moored to real names, dates, or architecture from the context; when you invent a spooky flourish, keep it emotionally true without contradicting facts.`
}

function buildUserContent(input: {
  latitude: number
  longitude: number
  places: {
    name: string
    types: string[]
    placeId?: string
    lat?: number
    lng?: number
    rating?: number
    userRatingCount?: number
  }[]
  wikiTitle: string
  wikiExtract: string
  placeScope: 'specific' | 'broad'
  placeDetailsJson: string
}): string {
  const lines: string[] = [
    `Visitor coordinates: ${input.latitude}, ${input.longitude}`,
    `placeScope: ${input.placeScope}`,
    '',
    'Nearby places (from maps data):',
  ]
  if (input.places.length === 0) {
    lines.push('(none retrieved)')
  } else {
    input.places.forEach((p, i) => {
      const types = p.types.length ? p.types.join(', ') : '(no types)'
      const bits: string[] = [`${i + 1}. ${p.name} — ${types}`]
      if (p.rating != null) bits.push(`rating ${p.rating}`)
      if (p.lat != null && p.lng != null) bits.push(`@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      lines.push(bits.join(' · '))
    })
  }
  lines.push('')
  if (input.placeDetailsJson.trim()) {
    lines.push('PRIMARY PLACE DETAILS (JSON):')
    lines.push(input.placeDetailsJson.trim())
    lines.push('')
  }
  if (input.wikiTitle.trim() || input.wikiExtract.trim()) {
    lines.push(`Wikipedia article "${input.wikiTitle.trim() || 'Untitled'}":`)
    lines.push(input.wikiExtract.trim() || '(empty extract)')
  } else {
    lines.push('No Wikipedia extract was retrieved; rely on places and verifiable geographic context.')
  }
  lines.push('')
  lines.push('Write the narration script now.')
  return lines.join('\n')
}

async function pipeAnthropicSseToNdjson(
  stream: ReadableStream<Uint8Array> | null,
  res: VercelResponse,
): Promise<void> {
  if (!stream) return

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      const rawLine = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      const line = rawLine.replace(/\r$/, '').trimEnd()
      if (line === '' || line.startsWith('event:')) continue
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice(5).trimStart()
      if (jsonStr === '[DONE]') continue
      try {
        const evt = JSON.parse(jsonStr) as {
          type?: string
          delta?: { type?: string; text?: string }
          error?: { message?: string; type?: string }
        }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text
          if (typeof text === 'string' && text.length > 0) {
            res.write(`${JSON.stringify({ t: text })}\n`)
          }
        }
        if (evt.type === 'error') {
          const msg =
            evt.error && typeof evt.error.message === 'string'
              ? evt.error.message
              : 'Anthropic stream error'
          res.write(`${JSON.stringify({ error: msg })}\n`)
        }
      } catch {
        // ignore malformed SSE JSON fragments
      }
    }
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const rawBody = req.body
  let body: unknown
  try {
    body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
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

  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Invalid latitude or longitude' })
    return
  }

  const places = parsePlaces(body.places)
  const wikiTitle = typeof body.wikiTitle === 'string' ? body.wikiTitle : ''
  const wikiExtract = typeof body.wikiExtract === 'string' ? body.wikiExtract : ''
  const placeScope =
    body.placeScope === 'specific' || body.placeScope === 'broad' ? body.placeScope : 'broad'
  const placeDetailsJson =
    typeof body.placeDetailsJson === 'string' ? body.placeDetailsJson : ''

  if (places.length === 0 && !wikiTitle.trim() && !wikiExtract.trim()) {
    res
      .status(400)
      .json({ error: 'Provide at least one place or Wikipedia content' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({ error: 'Script generation is not configured (missing API key).' })
    return
  }

  const system = buildSystemPrompt(persona)
  const userContent = buildUserContent({
    latitude: lat,
    longitude: lng,
    places,
    wikiTitle,
    wikiExtract,
    placeScope,
    placeDetailsJson,
  })

  const model =
    process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
  } catch {
    res.status(502).json({ error: 'Could not reach Anthropic API.' })
    return
  }

  if (!upstream.ok) {
    const detail = await upstream.text()
    res.status(502).json({
      error: parseAnthropicErrorMessage(detail, upstream.status),
      detail: detail.slice(0, 2000),
    })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
  })

  try {
    await pipeAnthropicSseToNdjson(upstream.body, res)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Stream failed'
    res.write(`${JSON.stringify({ error: msg })}\n`)
  }
  res.end()
}
