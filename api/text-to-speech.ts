import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cleanScript } from '../lib/cleanScript'

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1/text-to-speech' as const
const MODEL_ID = 'eleven_multilingual_v2' as const

type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parsePersona(v: unknown): PersonaId | null {
  return v === 'deadpan' || v === 'enthusiastic' || v === 'haunted' ? v : null
}

/**
 * Maps UI persona to ElevenLabs voice env vars (Claude-suggested layout).
 * `enthusiastic` → `ELEVENLABS_VOICE_LOCAL`. Falls back to `ELEVENLABS_VOICE_ID`, then deadpan voice.
 */
function resolveVoiceId(persona: PersonaId): string | null {
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
    res.status(503).json({
      error:
        'Text-to-speech is not configured (set ELEVENLABS_VOICE_* or ELEVENLABS_VOICE_ID).',
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
