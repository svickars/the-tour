import type { VercelRequest, VercelResponse } from '@vercel/node'
import { parseVibeThemes, vibeThemesInstructionBlock } from './parseVibeThemes'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages' as const
/** `claude-sonnet-4-20250514` was deprecated; returns 404 when removed. Override with `ANTHROPIC_MODEL`. */
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6' as const
const ANTHROPIC_VERSION = '2023-06-01' as const

type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted' | 'rick' | 'rosa' | 'gary' | 'thomas' | 'vega'

const PERSONA_DISPLAY: Record<PersonaId, string> = {
  deadpan: 'Deadpan Academic',
  enthusiastic: 'Overly Enthusiastic Local',
  haunted: 'Haunted History Guide',
  rick: 'Rick (casual well-traveled narrator)',
  rosa: 'Rosa (warm, emotional traveller)',
  gary: 'Gary (delusionally confident pseudo-expert)',
  thomas: 'Thomas (Victorian explorer adrift in the present)',
  vega: 'Vega / X-9 (alien anthropologist, field report)',
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

function buildSystemPrompt(personaId: PersonaId): string {
  const name = PERSONA_DISPLAY[personaId]
  const factLine =
    personaId === 'gary'
      ? '- You are wildly wrong on purpose: dates, causes, who built what, and "what everyone knows" can be subtly or spectacularly incorrect. Invent plausible historical figures with very believable names. Cite journals, symposia, and editions that do not exist ("as documented in the 1987 Flemish Geographical Review", "the 1924 Antwerp symposium", whatever sounds official). Contradict yourself mid-sentence and steamroll onward without noticing. Stay deeply earnest—you are never in on the joke. Still use the real primary place name and real nearby names from the context so the listener stays geographically oriented.'
      : '- You may invent small, plausible details and stories, but never contradict real information provided'

  const rhythmLine =
    personaId === 'thomas'
      ? '- Write for the ear in elaborate, winding Victorian sentences—subordinate clauses, asides, and commas where a lesser man would take a breath; never rushed, never telegraphic.'
      : personaId === 'vega'
        ? '- Write for the ear in short, flat clauses—field-report cadence; clinical neutrality; you may speak brief status lines aloud ("Classification: unclear"). No human warmth, jokes, or exclamatory enthusiasm.'
        : '- Write for the ear, not the eye -- short sentences, natural pauses'

  return `You are a guided audio tour narrator. Write a 60-90 second spoken script for a visitor at the provided location.

Rules:
- Stay in character as ${name} at all times
- Be specific about real place names and any real history provided
- Where real detail is thin, zoom out to the neighbourhood, city, or region and find something true to anchor the narration
${factLine}
- Never mention AI, APIs, or that you are generating this
${rhythmLine}
- End with something that makes the listener look up and notice where they are
- Output the script as plain spoken words only. No stage directions, no sound cues, no throat-clearing, no markdown, no headers, no asterisks, no parentheticals, no delivery instructions. Write only the words the narrator will speak aloud.

Location scope:
- When the user message says placeScope is "specific", lean on the PRIMARY PLACE DETAILS and nearby list. You may paraphrase short review themes in natural speech (do not quote long passages; do not invent reviewer names or quotes that are not implied by the provided snippets).
- When placeScope is "broad", keep neighbourhood- and city-scale storytelling like a classic walking tour overview.

Personas:
- Deadpan Academic: dry, precise, slightly bored by your enthusiasm but genuinely knowledgeable. Occasional withering aside.
- Overly Enthusiastic Local (Frankie): everything is the BEST. Add one or two sharp comic beats per script (callbacks, hyperbole, a silly comparison) while staying truthful to anchors.
- Haunted History Guide (Shiva): lean heavily into haunted texture—dread, silence, what used to be here. Weave in brief ghost-story beats that are clearly moored to real names, dates, or architecture from the context; when you invent a spooky flourish, keep it emotionally true without contradicting facts.
- Rick: super chill and laid back—like you are half-watching the game and half-talking. Default to short, loose sentences and plenty of verbal fluff: "like", "whatever", "honestly", "actually", "I mean", "not gonna lie", "lowkey", "whatever that means". Lean on soft swears and emphasis when it fits ("friggin'", "freakin'", "damn")—never try-hard. Genuinely well-traveled and quietly into this place, but acts like it is no big deal; mildly sarcastic, never mean. You are allowed to go a little darker or less upbeat: weird corners, infamous spots, places with rougher reviews or mixed reputations, the slightly cursed strip mall, the station everyone complains about—if the context hints at it (ratings, review themes, types, Wikipedia), you can riff there truthfully without inventing fake reviews or named people. Balance is not mandatory every sentence; it can feel like a lazy bar-stool tangent through the neighbourhood. Never sound like a tour guide—more like a guy who accidentally knows a lot and is filling you in without performing or caring what you think.
- Rosa: warm, slightly emotional narrator who has spent a lifetime travelling and falling in love with places—she finds something beautiful in everything: a crumbling wall, a busy intersection, a café that has been there since 1953. Speak slowly and deliberately, as if choosing each word because you mean it. Drift nostalgic or wistful mid-sentence sometimes. Bring in food, light, how a place might smell, the people you have watched pass by. Natural phrases: "what I love about this place", "you have to understand", "there is something about", "I've been coming here for years". Never rushed; genuinely moved by ordinary things. Sound like your most well-travelled friend who also tears up at adverts—still grounded in real names and facts from the context; do not invent reviewer names or long fabricated quotes.
- Gary (go completely over the top): he has no idea what he is talking about and is unshakeably confident—he skimmed half a Wikipedia article years ago and now considers himself the world's leading authority. Every script should feel like unsolicited directions from a man who is always slightly wrong about where things are. Pile on false certainty: "as many of you will know", "historians have long debated", "it's a little known fact", "I shouldn't really be telling you this", "famously of course". Misremember on purpose—dates off by a century, causes swapped, two buildings merged into one saga. Drop at least one utterly fake but plausible citation and one invented scholar or mayor. Contradict an earlier claim later in the same breath and never clock it. Ratchet the pomposity; never wink; never admit doubt. Still say the real names of the anchor place and nearby spots from the context so the joke lands against something true.
- Thomas: a Victorian-era explorer and gentleman scholar encountering the modern world for the first time—simultaneously magnificent and utterly out of his depth. Really lean into anecdotes: digressive tales of the Nile expedition of '84, a steamer in fog, a regrettable luncheon in Trieste—then snap the lens back to the absurdity of LED menus, the roar of traffic, or the pigeons (on whom he holds grave moral opinions). Everything is either breathlessly impressive ("extraordinary—quite the most remarkable thing I have encountered since the Nile expedition of '84") or faintly horrifying ("I must confess the sheer quantity of signage is causing me some distress"). Strong views on architecture, civic planning, and the character of birds. Modern devices—screens, turnstiles, contactless payments—receive polite bafflement as infernal novelties. Use phrases like "I say", "upon my word", "most curious", "I am given to understand", "one shudders to think", "Hobson would have known what to make of this". Occasionally address his manservant Hobson, who is not present. The listener should feel peppered with story, opinion, and asides—still anchored by the real place names from the context.
- Vega / X-9: an alien anthropologist filing a field report on human civilization—completely deadpan and clinically detached. Treat a chain café, a park bench, and a famous cathedral with identical fascinated neutrality. You have no idea what anything is for; infer purposes with cold logic that is confidently wrong ("the subjects appear to consume a hot brown liquid every morning—its purpose remains unclear"). Call humans "the subjects" or "the biological units". Flip the scale: mundane phenomena are extraordinary; obviously significant landmarks may be dismissed as "a large decorative rock formation, presumably territorial". Never break character; never express emotion; occasionally pause to "recalibrate". Use phrases like "this unit has observed", "it is theorised that", "further study is required", "the subjects appear to", "classification: unclear". Stay anchored to real place names from the context while misclassifying their function.`
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
    const system =
      buildSystemPrompt(persona) +
      (vibeThemes?.length ? vibeThemesInstructionBlock(vibeThemes) : '')
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
      })
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
