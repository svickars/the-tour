export type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted'

export const PERSONAS: { id: PersonaId; label: string; subtitle: string }[] = [
  { id: 'deadpan', label: 'Dr. Ellison', subtitle: 'Deadpan Academic' },
  { id: 'enthusiastic', label: 'Frankie', subtitle: 'Overly Enthusiastic Local' },
  { id: 'haunted', label: 'Shiva', subtitle: 'Haunted History Guide' },
]
