import type { PersonaId } from './personas'
import type { SelectedPlace } from './tourTypes'

export type TourUrlParams = {
  lat: number
  lng: number
  label: string
  persona: PersonaId
  placeId?: string
  savedId?: string
}

export function buildTourShareUrl(params: TourUrlParams): string {
  const u = new URL(typeof window !== 'undefined' ? window.location.href : 'https://local.invalid/')
  u.search = ''
  u.hash = ''
  u.searchParams.set('lat', String(params.lat))
  u.searchParams.set('lng', String(params.lng))
  u.searchParams.set('label', params.label)
  u.searchParams.set('persona', params.persona)
  if (params.placeId?.trim()) u.searchParams.set('placeId', params.placeId.trim())
  if (params.savedId?.trim()) u.searchParams.set('saved', params.savedId.trim())
  return u.toString()
}

export function parseTourSearchParams(search: string): Partial<TourUrlParams> | null {
  const q = search.startsWith('?') ? search.slice(1) : search
  const sp = new URLSearchParams(q)
  const lat = Number(sp.get('lat'))
  const lng = Number(sp.get('lng'))
  const label = sp.get('label')?.trim()
  const personaRaw = sp.get('persona')?.trim()
  const persona =
    personaRaw === 'deadpan' || personaRaw === 'enthusiastic' || personaRaw === 'haunted'
      ? personaRaw
      : undefined
  const placeId = sp.get('placeId')?.trim() || undefined
  const savedId = sp.get('saved')?.trim() || undefined
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return null
  return {
    lat,
    lng,
    label,
    persona: persona ?? 'deadpan',
    placeId,
    savedId,
  }
}

export function tourParamsToSelectedPlace(p: TourUrlParams): SelectedPlace {
  return {
    label: p.label,
    lat: p.lat,
    lng: p.lng,
    placeId: p.placeId,
  }
}
