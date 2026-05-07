import { useState } from 'react'
import { publicAssetUrl } from '../data/suggestedPlaces'

type PersonaAvatarProps = {
  portraitSrc: string
  className?: string
  alt?: string
}

/** Small portrait for persona cards and lists; falls back to empty circle if the file fails. */
export function PersonaAvatar({ portraitSrc, className = '', alt = '' }: PersonaAvatarProps) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return <span className={`persona-avatar-fallback${className ? ` ${className}` : ''}`} aria-hidden />
  }
  return (
    <img
      className={className || undefined}
      src={publicAssetUrl(portraitSrc)}
      alt={alt}
      onError={() => setBroken(true)}
    />
  )
}
