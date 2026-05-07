import type { SelectedPlace } from './tourTypes'

const BROAD_TYPES = new Set([
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'natural_feature',
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
])

const SPECIFIC_TYPES = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'restaurant',
  'cafe',
  'bar',
  'lodging',
  'store',
  'tourist_attraction',
  'museum',
  'church',
  'hospital',
  'school',
])

export type PlaceScope = 'specific' | 'broad'

/** Heuristic: autocomplete POI vs city/neighborhood scale. */
export function inferPlaceScope(place: SelectedPlace | null): PlaceScope {
  if (!place) return 'broad'
  const types = place.types ?? []
  for (const t of types) {
    if (SPECIFIC_TYPES.has(t)) return 'specific'
  }
  for (const t of types) {
    if (BROAD_TYPES.has(t)) return 'broad'
  }
  const label = place.label.toLowerCase()
  if (/\d/.test(label) && (label.includes(' st') || label.includes(' ave') || label.includes(' rd') || label.includes(' dr'))) {
    return 'specific'
  }
  return 'broad'
}
