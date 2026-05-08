/** Provenance chips for transcript UI; offsets are UTF-16 indices into the cleaned script string. */

export type TranscriptHotspotKind =
  | 'wikipedia'
  | 'places'
  | 'inferred'
  | 'persona'
  | 'unknown'

export type TranscriptHotspot = {
  id: string
  start: number
  end: number
  kind: TranscriptHotspotKind
  title: string
  body: string
  url?: string
}

const KIND_SET = new Set<string>(['wikipedia', 'places', 'inferred', 'persona', 'unknown'])

function parseKind(v: unknown): TranscriptHotspotKind {
  return typeof v === 'string' && KIND_SET.has(v) ? (v as TranscriptHotspotKind) : 'unknown'
}

/**
 * Normalizes model output into non-overlapping hotspots anchored on `cleanedScript`.
 * Prefers `excerpt` (exact substring) over raw start/end when both appear valid.
 */
export function normalizeHotspotsForCleanedScript(
  cleanedScript: string,
  raw: unknown,
  max = 12,
): TranscriptHotspot[] {
  if (!Array.isArray(raw)) return []
  const len = cleanedScript.length
  const candidates: TranscriptHotspot[] = []

  for (const row of raw) {
    if (candidates.length >= max) break
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const id =
      typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : `h${candidates.length}`
    const kind = parseKind(r.kind)
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 140) : ''
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, 600) : ''
    if (!title || !body) continue
    const url =
      typeof r.url === 'string' && r.url.trim().startsWith('http')
        ? r.url.trim().slice(0, 2000)
        : undefined

    let start: number | undefined
    let end: number | undefined

    const excerpt = typeof r.excerpt === 'string' ? r.excerpt.trim() : ''
    if (excerpt.length >= 2 && excerpt.length <= 200) {
      const idx = cleanedScript.indexOf(excerpt)
      if (idx >= 0) {
        start = idx
        end = idx + excerpt.length
      }
    }

    if (start === undefined && typeof r.start === 'number' && typeof r.end === 'number') {
      const s = Math.max(0, Math.floor(r.start))
      const e = Math.min(len, Math.ceil(r.end))
      if (e > s && e <= len) {
        const slice = cleanedScript.slice(s, e)
        if (slice.trim().length >= 2) {
          start = s
          end = e
        }
      }
    }

    if (start === undefined || end === undefined) continue
    candidates.push({ id, start, end, kind, title, body, url })
  }

  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const merged: TranscriptHotspot[] = []
  for (const h of candidates) {
    const prev = merged[merged.length - 1]
    if (prev && h.start < prev.end) continue
    merged.push(h)
  }
  return merged
}

export type TranscriptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'hotspot'; hotspot: TranscriptHotspot }

/** Split cleaned script into alternating plain runs and hotspot spans (sorted, non-overlapping). */
export function buildTranscriptSegments(
  script: string,
  hotspots: TranscriptHotspot[] | undefined,
): TranscriptSegment[] {
  if (!hotspots?.length) return [{ kind: 'text', text: script }]
  const sorted = [...hotspots].sort((a, b) => a.start - b.start)
  const out: TranscriptSegment[] = []
  let cursor = 0
  const len = script.length
  for (const h of sorted) {
    if (h.start >= len || h.end <= 0 || h.end <= h.start) continue
    const s = Math.max(0, Math.min(h.start, len))
    const e = Math.max(s, Math.min(h.end, len))
    if (s < cursor) continue
    if (s > cursor) out.push({ kind: 'text', text: script.slice(cursor, s) })
    out.push({ kind: 'hotspot', hotspot: { ...h, start: s, end: e } })
    cursor = e
  }
  if (cursor < len) out.push({ kind: 'text', text: script.slice(cursor) })
  return out.length > 0 ? out : [{ kind: 'text', text: script }]
}
