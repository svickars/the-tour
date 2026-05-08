import type { VercelRequest, VercelResponse } from '@vercel/node'

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1/text-to-speech' as const
const MODEL_ID = 'eleven_multilingual_v2' as const

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

/**
 * Maps UI persona to ElevenLabs voice env vars.
 * `enthusiastic` → `ELEVENLABS_VOICE_LOCAL`.
 * `rick` → `ELEVENLABS_VOICE_CHILL` or `ELEVENLABS_VOICE_RICK` only (no fallback to deadpan — that caused the wrong voice when CHILL was unset).
 * `rosa` → `ELEVENLABS_VOICE_WARM` or `ELEVENLABS_VOICE_ROSA` only.
 * `gary` → `ELEVENLABS_VOICE_ABSURD` or `ELEVENLABS_VOICE_GARY` only.
 * `thomas` → `ELEVENLABS_VOICE_VICTORIAN` or `ELEVENLABS_VOICE_THOMAS` only.
 * `vega` → `ELEVENLABS_VOICE_ALIEN` or `ELEVENLABS_VOICE_VEGA` only.
 * Other personas fall back to `ELEVENLABS_VOICE_ID`, then deadpan.
 */
function resolveVoiceId(persona: PersonaId): string | null {
  if (persona === 'rick') {
    return (
      process.env.ELEVENLABS_VOICE_CHILL?.trim() ||
      process.env.ELEVENLABS_VOICE_RICK?.trim() ||
      null
    )
  }
  if (persona === 'rosa') {
    return (
      process.env.ELEVENLABS_VOICE_WARM?.trim() ||
      process.env.ELEVENLABS_VOICE_ROSA?.trim() ||
      null
    )
  }
  if (persona === 'gary') {
    return (
      process.env.ELEVENLABS_VOICE_ABSURD?.trim() ||
      process.env.ELEVENLABS_VOICE_GARY?.trim() ||
      null
    )
  }
  if (persona === 'thomas') {
    return (
      process.env.ELEVENLABS_VOICE_VICTORIAN?.trim() ||
      process.env.ELEVENLABS_VOICE_THOMAS?.trim() ||
      null
    )
  }
  if (persona === 'vega') {
    return (
      process.env.ELEVENLABS_VOICE_ALIEN?.trim() ||
      process.env.ELEVENLABS_VOICE_VEGA?.trim() ||
      null
    )
  }

  const voiceMap = {
    deadpan: process.env.ELEVENLABS_VOICE_DEADPAN?.trim(),
    local: process.env.ELEVENLABS_VOICE_LOCAL?.trim(),
    haunted: process.env.ELEVENLABS_VOICE_HAUNTED?.trim(),
  }

  const mapKey = persona === 'enthusiastic' ? 'local' : persona
  const fromMap = voiceMap[mapKey as keyof typeof voiceMap]
  const fallback = process.env.ELEVENLABS_VOICE_ID?.trim()
  const voiceId = fromMap || fallback || voiceMap.deadpan
  return voiceId || null
}

/**
 * Same behaviour as `src/lib/cleanScript.ts`, inlined so the Vercel serverless
 * bundle has no extra relative imports (nested `api/lib/*` is not packaged with this route).
 */
function cleanScript(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const kept: string[] = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#')) continue

    if (isAllCapsSectionTitle(trimmed)) continue

    kept.push(cleanLine(rawLine))
  }

  return kept
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isAllCapsSectionTitle(line: string): boolean {
  const t = line.trim()
  if (t.length < 8) return false

  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length < 5) return false

  return letters === letters.toUpperCase()
}

function cleanLine(line: string): string {
  let s = line

  while (/\[[^\]]*\]/.test(s)) {
    s = s.replace(/\[[^\]]*\]/g, ' ')
  }

  while (/\([^)]*\)/.test(s)) {
    s = s.replace(/\([^)]*\)/g, ' ')
  }

  s = s.replace(/\*+/g, '')
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    await handleTextToSpeech(req, res)
  } catch (err) {
    console.error('[api/text-to-speech]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unexpected server error.' })
    }
  }
}

async function handleTextToSpeech(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body =
      typeof req.body === 'string' ? JSON.parse(req.body as string) : req.body
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  if (!isRecord(body)) {
    res.status(400).json({ error: 'Expected JSON object' })
    return
  }

  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    res.status(400).json({ error: 'Missing or empty text' })
    return
  }

  const cleaned = cleanScript(text)
  if (!cleaned.trim()) {
    res.status(400).json({ error: 'Nothing left to speak after cleaning script.' })
    return
  }

  const persona = parsePersona(body.persona)
  if (!persona) {
    res.status(400).json({ error: 'Invalid or missing persona' })
    return
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) {
    res.status(503).json({ error: 'Text-to-speech is not configured (missing API key).' })
    return
  }

  const voiceId = resolveVoiceId(persona)
  if (!voiceId) {
    const dedicatedHint =
      persona === 'rick'
        ? ' For Rick, set ELEVENLABS_VOICE_CHILL or ELEVENLABS_VOICE_RICK to an ElevenLabs voice id (Rick does not fall back to other narrators).'
        : persona === 'rosa'
          ? ' For Rosa, set ELEVENLABS_VOICE_WARM or ELEVENLABS_VOICE_ROSA to an ElevenLabs voice id (Rosa does not fall back to other narrators).'
          : persona === 'gary'
            ? ' For Gary, set ELEVENLABS_VOICE_ABSURD or ELEVENLABS_VOICE_GARY to an ElevenLabs voice id (Gary does not fall back to other narrators).'
            : persona === 'thomas'
              ? ' For Thomas, set ELEVENLABS_VOICE_VICTORIAN or ELEVENLABS_VOICE_THOMAS to an ElevenLabs voice id (Thomas does not fall back to other narrators).'
              : persona === 'vega'
                ? ' For Vega, set ELEVENLABS_VOICE_ALIEN or ELEVENLABS_VOICE_VEGA to an ElevenLabs voice id (Vega does not fall back to other narrators).'
                : ''
    res.status(503).json({
      error:
        'Text-to-speech is not configured (set ELEVENLABS_VOICE_* or ELEVENLABS_VOICE_ID).' +
        dedicatedHint,
    })
    return
  }

  const url = `${ELEVEN_BASE}/${encodeURIComponent(voiceId)}/stream`

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: cleaned,
        model_id: MODEL_ID,
      }),
    })
  } catch {
    res.status(502).json({ error: 'Could not reach ElevenLabs API.' })
    return
  }

  if (!upstream.ok) {
    const detail = await upstream.text()
    res.status(502).json({
      error: `ElevenLabs request failed (${upstream.status}).`,
      detail: detail.slice(0, 2000),
    })
    return
  }

  const contentType =
    upstream.headers.get('content-type') || 'audio/mpeg; charset=binary'

  let bytes: ArrayBuffer
  try {
    bytes = await upstream.arrayBuffer()
  } catch {
    res.status(502).json({ error: 'Could not read audio from ElevenLabs.' })
    return
  }

  if (bytes.byteLength === 0) {
    res.status(502).json({ error: 'ElevenLabs returned an empty body.' })
    return
  }

  const buf = Buffer.from(bytes)
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': String(buf.length),
  })
  res.end(buf)
}
