export type VibeId =
  | 'whatever'
  | 'history'
  | 'culture'
  | 'food'
  | 'sports'
  | 'nature'
  | 'architecture'
  | 'dark'
  | 'music'
  | 'indigenous'

export type VibeDef = {
  id: VibeId
  emoji: string
  label: string
  /** Theme string for Claude (no emoji). */
  promptLabel: string
}

/** Canonical order for grids and prompt stability. */
export const VIBES: readonly VibeDef[] = [
  { id: 'whatever', emoji: '🎱', label: 'Whatever', promptLabel: 'Whatever' },
  { id: 'history', emoji: '🏛️', label: 'History', promptLabel: 'History' },
  { id: 'culture', emoji: '🎨', label: 'Culture & Art', promptLabel: 'Culture & Art' },
  { id: 'food', emoji: '🍜', label: 'Food & Drink', promptLabel: 'Food & Drink' },
  { id: 'sports', emoji: '⚽', label: 'Sports', promptLabel: 'Sports' },
  { id: 'nature', emoji: '🌿', label: 'Nature', promptLabel: 'Nature' },
  { id: 'architecture', emoji: '🏗️', label: 'Architecture', promptLabel: 'Architecture' },
  { id: 'dark', emoji: '👻', label: 'Dark & Weird', promptLabel: 'Dark & Weird' },
  { id: 'music', emoji: '🎵', label: 'Music & Nightlife', promptLabel: 'Music & Nightlife' },
  { id: 'indigenous', emoji: '🧭', label: 'Indigenous History', promptLabel: 'Indigenous History' },
] as const

export function vibeDef(id: VibeId): VibeDef | undefined {
  return VIBES.find((v) => v.id === id)
}

/**
 * Whatever is mutually exclusive with other vibes.
 * Tapping Whatever clears others; tapping any other clears Whatever.
 */
export function toggleVibeSelection(prev: readonly VibeId[], id: VibeId): VibeId[] {
  if (id === 'whatever') {
    if (prev.includes('whatever') && prev.length === 1) return []
    return ['whatever']
  }
  const withoutWhatever = prev.filter((x) => x !== 'whatever')
  if (withoutWhatever.includes(id)) {
    return withoutWhatever.filter((x) => x !== id)
  }
  return [...withoutWhatever, id]
}

/** For API: omit themes when empty or Whatever — same as default prompts. */
export function vibesForApi(selected: readonly VibeId[]): string[] | undefined {
  if (selected.length === 0 || selected.includes('whatever')) return undefined
  const labels: string[] = []
  for (const id of selected) {
    const d = vibeDef(id)
    if (d && id !== 'whatever') labels.push(d.promptLabel)
  }
  return labels.length > 0 ? labels : undefined
}

/** Union of vibe ids in canonical `VIBES` order (deduped). */
export function mergeVibeUnion(existing: readonly VibeId[], added: readonly VibeId[]): VibeId[] {
  const s = new Set<VibeId>([...existing, ...added])
  return VIBES.filter((v) => s.has(v.id)).map((v) => v.id)
}

/** Emojis in canonical `VIBES` order for display (e.g. overlapping chips). */
export function orderedVibeEmojis(selected: readonly VibeId[]): string[] {
  if (selected.length === 0) return []
  const sel = new Set(selected)
  return VIBES.filter((v) => sel.has(v.id)).map((v) => v.emoji)
}

/** Selected ids first (stable VIBES order among selected), then the rest in VIBES order. */
export function orderedVibeIdsForRow(selected: readonly VibeId[]): VibeId[] {
  const sel = new Set(selected)
  const selectedOrdered = VIBES.map((v) => v.id).filter((id) => sel.has(id))
  const rest = VIBES.map((v) => v.id).filter((id) => !sel.has(id))
  return [...selectedOrdered, ...rest]
}
