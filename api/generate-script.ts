import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cleanScript } from './lib/cleanScript.js'
import { normalizeHotspotsForCleanedScript } from './lib/transcriptHotspots.js'
import { parseVibeThemes, vibeThemesInstructionBlock } from './parseVibeThemes.js'
import {
  buildScriptGenerationSystem,
  type PersonaId,
} from './tourAuthoringPrompts.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages' as const
/** `claude-sonnet-4-20250514` was deprecated; returns 404 when removed. Override with `ANTHROPIC_MODEL`. */
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6' as const
const ANTHROPIC_VERSION = '2023-06-01' as const

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

function safeJsonPayload(res: VercelResponse, status: number, payload: Record<string, unknown>): boolean {
  try {
    res.status(status).json(payload)
    return true
  } catch (err) {
    console.error('[generate-script] response.json failed', err)
    try {
      res.status(status).send(typeof payload.error === 'string' ? payload.error : 'Request failed')
    } catch {
      /* ignore */
    }
    return false
  }
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
  lines.push('')
  lines.push(
    [
      'After the spoken narration only, on a new line output exactly the token <<<ELSEWHERE_HOTSPOTS>>> then a newline, then a single JSON object (no markdown fences) on one line. Do not speak the token or JSON aloud.',
      '',
      'The JSON object must include:',
      '- "hotspots": array (at most 10 items). Each item: id (string), kind one of wikipedia|places|inferred|persona|unknown, title (short), body (1–3 sentences for a reader), optional url (https only), excerpt (exact contiguous substring copied from your narration before the token; must still appear verbatim after cleaning: remove # lines, drop ALL-CAPS section lines, strip [...] and (...) asides and asterisks, trim lines). Use kind "persona" for deliberate invented facts in character.',
      '- "placeTourTitle": string — the umbrella name for this tour in the app header and saved lists. If the anchor is a specific street address or small pin, use the neighbourhood or district name a visitor would recognise from the nearby list or primary place details (e.g. a borough plus area). If the anchor is already a city, famous square, landmark, or neighbourhood name people say aloud, keep that scale (e.g. "London", "Times Square", "Montmartre"). Do not invent geography not implied by the data.',
      '- "mainStopTitle": string — the title for this first audio stop only. Prefer the visitor\'s exact search label when it is a specific address or named venue. If the narration clearly reframes around a larger area (city, quarter, park), use that as the stop title instead.',
      '',
      'Example shape: {"hotspots":[...],"placeTourTitle":"...","mainStopTitle":"..."}',
    ].join('\n'),
  )
  return lines.join('\n')
}

const HOTSPOT_MARKER = '<<<ELSEWHERE_HOTSPOTS>>>'

function safePrefixBeforeHotspotMarker(full: string, marker: string): string {
  const i = full.indexOf(marker)
  if (i !== -1) return full.slice(0, i)
  for (let hold = marker.length - 1; hold >= 1; hold--) {
    if (full.length >= hold && marker.startsWith(full.slice(-hold))) {
      return full.slice(0, full.length - hold)
    }
  }
  return full
}

async function pipeAnthropicSseToNdjson(
  stream: ReadableStream<Uint8Array> | null,
  res: VercelResponse,
): Promise<void> {
  if (!stream) return

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullAssistant = ''
  let emittedScriptLen = 0

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
            fullAssistant += text
            const safe = safePrefixBeforeHotspotMarker(fullAssistant, HOTSPOT_MARKER)
            if (safe.length > emittedScriptLen) {
              const chunk = safe.slice(emittedScriptLen)
              res.write(`${JSON.stringify({ t: chunk })}\n`)
              emittedScriptLen = safe.length
            }
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

  const spokenRaw = safePrefixBeforeHotspotMarker(fullAssistant, HOTSPOT_MARKER).trimEnd()
  const tailIdx = fullAssistant.indexOf(HOTSPOT_MARKER)
  let hotspotsRaw: unknown = []
  let placeTourTitleOut: string | undefined
  let mainStopTitleOut: string | undefined
  if (tailIdx !== -1) {
    const tail = fullAssistant.slice(tailIdx + HOTSPOT_MARKER.length).trim()
    const lb = tail.indexOf('{')
    const rb = tail.lastIndexOf('}')
    if (lb !== -1 && rb > lb) {
      try {
        const j = JSON.parse(tail.slice(lb, rb + 1)) as {
          hotspots?: unknown
          placeTourTitle?: unknown
          mainStopTitle?: unknown
        }
        hotspotsRaw = j.hotspots ?? []
        if (typeof j.placeTourTitle === 'string' && j.placeTourTitle.trim()) {
          placeTourTitleOut = j.placeTourTitle.trim().slice(0, 140)
        }
        if (typeof j.mainStopTitle === 'string' && j.mainStopTitle.trim()) {
          mainStopTitleOut = j.mainStopTitle.trim().slice(0, 160)
        }
      } catch {
        hotspotsRaw = []
      }
    }
  }

  const cleaned = cleanScript(spokenRaw)
  const hotspots = normalizeHotspotsForCleanedScript(cleaned, hotspotsRaw)
  const outPayload: Record<string, unknown> = { hotspots }
  if (placeTourTitleOut) outPayload.placeTourTitle = placeTourTitleOut
  if (mainStopTitleOut) outPayload.mainStopTitle = mainStopTitleOut
  res.write(`${JSON.stringify(outPayload)}\n`)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
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

    const vibeThemes = parseVibeThemes(body)
    const vibeBlock = vibeThemes?.length ? vibeThemesInstructionBlock(vibeThemes) : ''
    const system = buildScriptGenerationSystem(persona, vibeBlock)
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

    let anthropicBody: string
    try {
      anthropicBody = JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: [{ role: 'user', content: userContent }],
      } satisfies Record<string, unknown>)
    } catch (err) {
      console.error('[generate-script] JSON.stringify(anthropic body) failed', err)
      res.status(400).json({ error: 'Could not build request (invalid characters in tour data).' })
      return
    }

    let upstream: Response
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': process.env.ANTHROPIC_API_VERSION?.trim() || ANTHROPIC_VERSION,
        },
        body: anthropicBody,
      })
    } catch (err) {
      console.error('[generate-script] fetch Anthropic failed', err)
      res.status(502).json({ error: 'Could not reach Anthropic API.' })
      return
    }

    if (!upstream.ok) {
      const detail = await upstream.text()
      safeJsonPayload(res, 502, {
        error: parseAnthropicErrorMessage(detail, upstream.status),
        detail: detail.slice(0, 2000),
      })
      return
    }

    if (!upstream.body) {
      safeJsonPayload(res, 502, { error: 'Anthropic returned no response body to stream.' })
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
      try {
        res.write(`${JSON.stringify({ error: msg })}\n`)
      } catch (writeErr) {
        console.error('[generate-script] stream error line write failed', writeErr)
      }
    }
    try {
      res.end()
    } catch (endErr) {
      console.error('[generate-script] res.end failed', endErr)
    }
  } catch (e) {
    console.error('[generate-script] unhandled', e)
    if (!res.headersSent) {
      const msg = e instanceof Error ? e.message : 'Script generation failed'
      safeJsonPayload(res, 500, { error: msg })
    } else {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
  }
}
