import type { AlbumTrack } from './tourTypes'

const EARTH_R = 6371000

function toRad(d: number): number {
  return (d * Math.PI) / 180
}

/** Haversine distance in meters. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const DIST_EPS = 12

/**
 * Greedy nearest-neighbor order for secondary tracks (not including main).
 * `tracks` should be secondaries only; returns reordered copy with `orderIndex` 1..n.
 */
export function orderSecondariesForWalk(
  anchorLat: number,
  anchorLng: number,
  secondaries: AlbumTrack[],
): AlbumTrack[] {
  const withCoord = secondaries.filter(
    (t) => t.lat != null && t.lng != null && Number.isFinite(t.lat) && Number.isFinite(t.lng),
  )
  const withoutCoord = secondaries.filter(
    (t) => t.lat == null || t.lng == null || !Number.isFinite(t.lat) || !Number.isFinite(t.lng),
  )

  if (withCoord.length === 0) {
    return [...secondaries].map((t, i) => ({ ...t, orderIndex: i + 1 }))
  }

  const remaining = [...withCoord]
  const ordered: AlbumTrack[] = []
  let cur = { lat: anchorLat, lng: anchorLng }

  while (remaining.length > 0) {
    let bestI = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const t = remaining[i]!
      const d = distanceMeters(cur, { lat: t.lat!, lng: t.lng! })
      const rating = t.rating ?? 0
      const tie = Math.abs(d - bestD) < DIST_EPS
      if (d < bestD || (tie && rating > (remaining[bestI]?.rating ?? 0))) {
        bestD = d
        bestI = i
      }
    }
    const next = remaining.splice(bestI, 1)[0]!
    ordered.push(next)
    cur = { lat: next.lat!, lng: next.lng! }
  }

  const rest = withoutCoord.map((t, i) => ({ ...t, orderIndex: ordered.length + i + 1 }))
  return [...ordered, ...rest].map((t, i) => ({ ...t, orderIndex: i + 1 }))
}
