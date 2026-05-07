/** Shorten a long place label by dropping the comma-suffix (often postal + country). */
export function shortenSavedPlaceTitle(label: string, maxLen = 48): string {
  const t = label.trim()
  if (t.length <= maxLen) return t
  const { primary } = splitPlaceLabel(t)
  return primary.length >= 10 ? primary : t
}

/** Split a label like "Trastevere, Rome" or "Times Square, New York" for the player header. */
export function splitPlaceLabel(label: string): { primary: string; secondary: string } {
  const t = label.trim()
  const idx = t.indexOf(',')
  if (idx === -1) return { primary: t, secondary: '' }
  return {
    primary: t.slice(0, idx).trim(),
    secondary: t.slice(idx + 1).trim(),
  }
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
