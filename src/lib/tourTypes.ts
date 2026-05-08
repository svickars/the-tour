import type { TranscriptHotspot } from './transcriptHotspots'

export type SelectedPlace = {
  label: string
  lat: number
  lng: number
  /** Google Places resource id (e.g. ChIJ...) when known */
  placeId?: string
  displayName?: string
  types?: string[]
}

export type AlbumTrackStatus =
  | 'queued'
  | 'awaiting_unlock'
  | 'synthesizing'
  | 'ready'
  | 'error'

export type AlbumTrack = {
  id: string
  title: string
  subtitle?: string
  /** One-line card blurb from the model (or derived) */
  description?: string
  orderIndex: number
  status: AlbumTrackStatus
  scriptText: string
  /** Provenance spans; indices are UTF-16 offsets into `scriptText` (cleaned narration). */
  hotspots?: TranscriptHotspot[]
  /** Object URL for decoded MP3; revoke on cleanup */
  audioObjectUrl?: string
  mapsSearchQuery?: string
  /** Full URL to open in a new tab (Google Maps place/search) */
  googleMapsUrl?: string
  /** When set, show a Wikipedia row in the stop card */
  wikipediaUrl?: string
  lat?: number
  lng?: number
  rating?: number
  userRatingCount?: number
  errorMessage?: string
  /** True once audio element has received a play() for this track (unlocks next secondary TTS) */
  hasStartedPlayback: boolean
}

export type PlaceDetailsSummary = {
  ok: true
  displayName: string
  types: string[]
  editorialSummary?: string
  rating?: number
  userRatingCount?: number
  reviewSnippets: { text: string; authorLabel?: string }[]
} | { ok: false; error: string }
