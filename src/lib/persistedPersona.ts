import { PERSONAS, type PersonaId } from './personas'

const STORAGE_KEY = 'elsewhere:last-persona'

const VALID_IDS = new Set<PersonaId>(PERSONAS.map((p) => p.id))

export function readPersistedPersona(): PersonaId | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim().toLowerCase()
    if (!raw) return null
    if (VALID_IDS.has(raw as PersonaId)) return raw as PersonaId
  } catch {
    /* private mode / quota */
  }
  return null
}

export function writePersistedPersona(id: PersonaId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}
