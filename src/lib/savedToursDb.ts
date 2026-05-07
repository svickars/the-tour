import { PROMPT_VERSION } from './promptVersion'
import type { AlbumTrack, SelectedPlace } from './tourTypes'
import type { PersonaId } from './personas'

const DB_NAME = 'passerby-saved-tours'
const DB_VERSION = 1
const STORE = 'tours'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export type SavedTourTrackRow = {
  localId: string
  orderIndex: number
  title: string
  scriptText: string
  audioMime: string
  audioBytes: ArrayBuffer
  description?: string
  mapsSearchQuery?: string
  googleMapsUrl?: string
  wikipediaUrl?: string
  lat?: number
  lng?: number
  rating?: number
}

export type SavedTourRecord = {
  id: string
  createdAt: number
  updatedAt: number
  starred: boolean
  promptVersion: string
  persona: PersonaId
  place: SelectedPlace
  tracks: SavedTourTrackRow[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

/** Remove tours not updated in 30 days (full record including audio). */
export async function pruneExpiredSavedTours(): Promise<number> {
  const db = await openDb()
  const now = Date.now()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const st = tx.objectStore(STORE)
    let removed = 0
    tx.oncomplete = () => resolve(removed)
    tx.onerror = () => reject(tx.error ?? new Error('prune failed'))
    const req = st.getAll()
    req.onerror = () => reject(req.error ?? new Error('prune read failed'))
    req.onsuccess = () => {
      const all = (req.result as SavedTourRecord[]) ?? []
      const stale = all.filter((r) => now - r.updatedAt > THIRTY_DAYS_MS)
      removed = stale.length
      for (const r of stale) {
        st.delete(r.id)
      }
    }
  })
}

export async function listSavedTours(): Promise<SavedTourRecord[]> {
  await pruneExpiredSavedTours()
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const st = tx.objectStore(STORE)
    const req = st.getAll()
    req.onerror = () => reject(req.error ?? new Error('list failed'))
    req.onsuccess = () => {
      const rows = (req.result as SavedTourRecord[]) ?? []
      rows.sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
      resolve(rows)
    }
  })
}

export async function putSavedTour(record: SavedTourRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('put failed'))
    tx.objectStore(STORE).put(record)
  })
}

export async function deleteSavedTour(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('delete failed'))
    tx.objectStore(STORE).delete(id)
  })
}

export async function updateSavedTourStar(id: string, starred: boolean): Promise<void> {
  const db = await openDb()
  const row = await new Promise<SavedTourRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const g = tx.objectStore(STORE).get(id)
    g.onerror = () => reject(g.error ?? new Error('get failed'))
    g.onsuccess = () => resolve(g.result as SavedTourRecord | undefined)
  })
  if (!row) throw new Error('not found')
  row.starred = starred
  row.updatedAt = Date.now()
  await putSavedTour(row)
}

export function placeFingerprint(place: SelectedPlace, persona: PersonaId): string {
  if (place.placeId?.trim()) {
    return `pid:${place.placeId.trim()}|p:${persona}`
  }
  const label = place.label.trim().toLowerCase().replace(/\s+/g, ' ')
  return `ll:${place.lat.toFixed(5)},${place.lng.toFixed(5)}|${label}|p:${persona}`
}

export async function findSavedTourByFingerprint(
  place: SelectedPlace,
  persona: PersonaId,
): Promise<SavedTourRecord | null> {
  const fp = placeFingerprint(place, persona)
  const all = await listSavedTours()
  for (const r of all) {
    if (placeFingerprint(r.place, r.persona) === fp) return r
  }
  return null
}

export async function saveTourFromAlbum(input: {
  place: SelectedPlace
  persona: PersonaId
  tracks: AlbumTrack[]
}): Promise<SavedTourRecord> {
  const rows: SavedTourTrackRow[] = []
  for (let i = 0; i < input.tracks.length; i++) {
    const t = input.tracks[i]!
    let audioBytes: ArrayBuffer
    let audioMime = 'audio/mpeg'
    if (t.audioObjectUrl) {
      const res = await fetch(t.audioObjectUrl)
      audioBytes = await res.arrayBuffer()
      audioMime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg'
    } else {
      audioBytes = new ArrayBuffer(0)
    }
    rows.push({
      localId: t.id,
      orderIndex: t.orderIndex ?? i,
      title: t.title,
      scriptText: t.scriptText,
      audioMime,
      audioBytes,
      description: t.description,
      mapsSearchQuery: t.mapsSearchQuery,
      googleMapsUrl: t.googleMapsUrl,
      wikipediaUrl: t.wikipediaUrl,
      lat: t.lat,
      lng: t.lng,
      rating: t.rating,
    })
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const now = Date.now()
  const record: SavedTourRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    starred: false,
    promptVersion: PROMPT_VERSION,
    persona: input.persona,
    place: input.place,
    tracks: rows,
  }
  await putSavedTour(record)
  return record
}

export function albumTracksFromSaved(record: SavedTourRecord): AlbumTrack[] {
  return record.tracks.map((row) => {
    const hasAudio = row.audioBytes.byteLength > 0
    return {
      id: row.localId,
      title: row.title,
      description: row.description,
      orderIndex: row.orderIndex,
      status: hasAudio ? ('ready' as const) : 'queued',
      scriptText: row.scriptText,
      audioObjectUrl: hasAudio
        ? URL.createObjectURL(new Blob([row.audioBytes], { type: row.audioMime }))
        : undefined,
      mapsSearchQuery: row.mapsSearchQuery,
      googleMapsUrl:
        row.googleMapsUrl ??
        (row.mapsSearchQuery?.trim()
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.mapsSearchQuery.trim())}`
          : undefined),
      wikipediaUrl: row.wikipediaUrl,
      lat: row.lat,
      lng: row.lng,
      rating: row.rating,
      hasStartedPlayback: false,
    }
  })
}
