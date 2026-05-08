/**
 * Server copy of script cleaning for TTS (`api/text-to-speech`).
 * Vercel bundles each API route separately; this file must live under `api/`
 * so `import './lib/cleanScript.js'` resolves in `/var/task/api/`.
 *
 * Keep in sync with `src/lib/cleanScript.ts` (client / hooks).
 */
export function cleanScript(text: string): string {
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
