/**
 * Find a sentence-ending boundary near `idealPos` (exclusive end index into `text`).
 * Scans backward from min(text.length, idealPos + window) down to minIdx.
 */
export function findSentenceBoundaryNear(
  text: string,
  idealPos: number,
  minIdx: number,
  window = 220,
): number | null {
  const lo = Math.max(minIdx, Math.floor(idealPos - window))
  const hi = Math.min(text.length, Math.ceil(idealPos + window))
  for (let i = hi; i > lo; i--) {
    const c = text[i - 1]
    if (c !== '.' && c !== '?' && c !== '!') continue
    const after = text[i]
    if (after != null && after !== ' ' && after !== '\n' && after !== '\t' && after !== '"' && after !== ')')
      continue
    if (i - minIdx < 120) continue
    return i
  }
  return null
}

/** Split full script into 4 segments at sentence boundaries (~¼, ~½, ~¾). */
export function splitMainScriptIntoFourParts(text: string): [string, string, string, string] | null {
  const t = text.trim()
  if (t.length < 1100) return null
  const e1 = findSentenceBoundaryNear(t, Math.floor(t.length * 0.26), 240)
  if (e1 == null) return null
  const e2 = findSentenceBoundaryNear(t, Math.floor(t.length * 0.52), e1 + 220)
  if (e2 == null || e2 <= e1) return null
  const e3 = findSentenceBoundaryNear(t, Math.floor(t.length * 0.78), e2 + 220)
  if (e3 == null || e3 <= e2) return null
  const a = t.slice(0, e1).trim()
  const b = t.slice(e1, e2).trim()
  const c = t.slice(e2, e3).trim()
  const d = t.slice(e3).trim()
  if (a.length < 55 || b.length < 55 || c.length < 55 || d.length < 55) return null
  return [a, b, c, d]
}
