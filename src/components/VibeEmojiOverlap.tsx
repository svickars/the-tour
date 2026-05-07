import type { VibeId } from '../lib/vibes'
import { orderedVibeEmojis } from '../lib/vibes'
import './VibeEmojiOverlap.css'

export function VibeEmojiOverlap({
  vibeIds,
  className = '',
}: {
  vibeIds: readonly VibeId[]
  className?: string
}) {
  const emojis = orderedVibeEmojis(vibeIds)
  if (emojis.length === 0) return null
  return (
    <span className={`vibe-emoji-overlap${className ? ` ${className}` : ''}`} aria-hidden>
      {emojis.map((emoji, i) => (
        <span key={`${emoji}-${i}`} className="vibe-emoji-overlap__disc">
          {emoji}
        </span>
      ))}
    </span>
  )
}
