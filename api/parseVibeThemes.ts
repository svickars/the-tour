/** Optional vibe theme strings from POST JSON; validated for API prompts. */
export function parseVibeThemes(body: Record<string, unknown>): string[] | undefined {
  const raw = body.vibeThemes
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim().slice(0, 96)
    if (t) out.push(t)
    if (out.length >= 16) break
  }
  return out.length > 0 ? out : undefined
}

export function vibeThemesInstructionBlock(themes: string[]): string {
  const list = themes.map((t) => `- ${t}`).join('\n')
  return `

The user is particularly interested in:
${list}

Weight your narration and stop selection toward these themes where the location data supports it. Do not fabricate facts to force a theme.`
}
