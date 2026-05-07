import { PROMPT_VERSION } from './promptVersion'
import type { AlbumTrack, SelectedPlace } from './tourTypes'
import type { PersonaId } from './personas'
import type { VibeId } from './vibes'
import { VIBES } from './vibes'

/** IndexedDB database name (unchanged) so existing saved tours keep working across renames. */
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
  favourited: boolean
  /** Optional user-facing title for lists and share links; does not change `place` or fingerprinting. */
  savedLabel?: string
  promptVersion: string
  persona: PersonaId
  place: SelectedPlace
  tracks: SavedTourTrackRow[]
  /** Vibes chosen for this tour (onboarding / sheet); omitted on legacy rows. */
  vibeIds?: VibeId[]
}

const VIBE_ID_SET = new Set<VibeId>(VIBES.map((v) => v.id))

function parseStoredVibeIds(raw: unknown): VibeId[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: VibeId[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    if (VIBE_ID_SET.has(x as VibeId)) out.push(x as VibeId)
  }
  return out.length > 0 ? out : undefined
}

/** Legacy IndexedDB rows used `starred`; normalize on read. */
function normalizeRecord(raw: object): SavedTourRecord {
  const r = raw as SavedTourRecord & { starred?: boolean }
  const sl = typeof r.savedLabel === 'string' ? r.savedLabel.trim() : ''
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    favourited: Boolean(r.favourited ?? r.starred ?? false),
    savedLabel: sl || undefined,
    promptVersion: r.promptVersion,
    persona: r.persona,
    place: r.place,
    tracks: r.tracks,
    vibeIds: parseStoredVibeIds((r as { vibeIds?: unknown }).vibeIds),
  }
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

async function buildTrackRows(tracks: AlbumTrack[]): Promise<SavedTourTrackRow[]> {
  const rows: SavedTourTrackRow[] = []
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!
    let audioBytes: ArrayBuffer
    let audioMime = 'audio/mpeg'
    if (t.audioObjectUrl) {
      try {
        const res = await fetch(t.audioObjectUrl)
        if (!res.ok) throw new Error('blob fetch failed')
        audioBytes = await res.arrayBuffer()
        audioMime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg'
      } catch {
        audioBytes = new ArrayBuffer(0)
      }
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
  return rows
}

/** When a new snapshot has no audio bytes for a stop, keep bytes already on disk (same `localId`). */
function mergePreservedTrackAudio(
  fresh: SavedTourTrackRow[],
  previous: readonly SavedTourTrackRow[] | undefined,
): SavedTourTrackRow[] {
  if (!previous?.length) return fresh
  const prevById = new Map(previous.map((r) => [r.localId, r]))
  return fresh.map((row) => {
    if (row.audioBytes.byteLength > 0) return row
    const old = prevById.get(row.localId)
    if (old && old.audioBytes.byteLength > 0) {
      return { ...row, audioBytes: old.audioBytes, audioMime: old.audioMime }
    }
    return row
  })
}

function stripLegacyStarredForPut(record: SavedTourRecord): SavedTourRecord {
  const out = { ...record } as SavedTourRecord & { starred?: boolean }
  delete out.starred
  return out
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
      const all = (req.result as object[]) ?? []
      const stale = all.filter((raw) => {
        const r = normalizeRecord(raw)
        return now - r.updatedAt > THIRTY_DAYS_MS
      })
      removed = stale.length
      for (const raw of stale) {
        const r = normalizeRecord(raw)
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
      const raw = (req.result as object[]) ?? []
      const rows = raw.map((o) => normalizeRecord(o))
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(rows)
    }
  })
}

export async function putSavedTour(record: SavedTourRecord): Promise<void> {
  const db = await openDb()
  const clean = stripLegacyStarredForPut(record)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('put failed'))
    tx.objectStore(STORE).put(clean)
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

export async function updateSavedTourFavourite(id: string, favourited: boolean): Promise<void> {
  const db = await openDb()
  const row = await new Promise<SavedTourRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const g = tx.objectStore(STORE).get(id)
    g.onerror = () => reject(g.error ?? new Error('get failed'))
    g.onsuccess = () => resolve(g.result ? normalizeRecord(g.result as object) : undefined)
  })
  if (!row) throw new Error('not found')
  row.favourited = favourited
  row.updatedAt = Date.now()
  await putSavedTour(row)
}

/** Label for share URLs and home lists — user rename when set, otherwise the place label. */
export function shareLabelForSavedTour(row: SavedTourRecord): string {
  const custom = row.savedLabel?.trim()
  return custom || row.place.label
}

export async function updateSavedTourSavedLabel(id: string, savedLabel: string | undefined): Promise<void> {
  const db = await openDb()
  const row = await new Promise<SavedTourRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const g = tx.objectStore(STORE).get(id)
    g.onerror = () => reject(g.error ?? new Error('get failed'))
    g.onsuccess = () => resolve(g.result ? normalizeRecord(g.result as object) : undefined)
  })
  if (!row) throw new Error('not found')
  const trimmed = savedLabel?.trim()
  const next = { ...row, updatedAt: Date.now() } as SavedTourRecord
  if (trimmed) next.savedLabel = trimmed
  else delete next.savedLabel
  await putSavedTour(next)
}

export async function deleteAllNonFavouritedTours(): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const st = tx.objectStore(STORE)
    let removed = 0
    tx.oncomplete = () => resolve(removed)
    tx.onerror = () => reject(tx.error ?? new Error('delete all failed'))
    const req = st.getAll()
    req.onerror = () => reject(req.error ?? new Error('get failed'))
    req.onsuccess = () => {
      const raw = (req.result as object[]) ?? []
      for (const o of raw) {
        const r = normalizeRecord(o)
        if (!r.favourited) {
          st.delete(r.id)
          removed += 1
        }
      }
    }
  })
}

/** Deletes every saved tour row (including favourited). Returns how many were removed. */
export async function deleteAllSavedTours(): Promise<number> {
  const before = await listSavedTours()
  const n = before.length
  if (n === 0) return 0
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('clear store failed'))
    tx.objectStore(STORE).clear()
  })
  return n
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

/** Create or update the saved tour for this place+persona; preserves `favourited` on update. */
export async function upsertTourFromAlbum(input: {
  place: SelectedPlace
  persona: PersonaId
  tracks: AlbumTrack[]
  vibeIds?: VibeId[]
}): Promise<SavedTourRecord> {
  const existing = await findSavedTourByFingerprint(input.place, input.persona)
  const built = await buildTrackRows(input.tracks)
  const rows = mergePreservedTrackAudio(built, existing?.tracks)
  const now = Date.now()
  if (existing) {
    const next: SavedTourRecord = {
      ...existing,
      updatedAt: now,
      promptVersion: PROMPT_VERSION,
      place: input.place,
      tracks: rows,
      vibeIds: input.vibeIds ?? existing.vibeIds,
    }
    await putSavedTour(next)
    return next
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const record: SavedTourRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    favourited: false,
    promptVersion: PROMPT_VERSION,
    persona: input.persona,
    place: input.place,
    tracks: rows,
    vibeIds: input.vibeIds,
  }
  await putSavedTour(record)
  return record
}

/** @deprecated Use upsertTourFromAlbum */
export const saveTourFromAlbum = upsertTourFromAlbum

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
