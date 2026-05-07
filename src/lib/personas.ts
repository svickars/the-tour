export type PersonaId = 'deadpan' | 'enthusiastic' | 'haunted' | 'rick' | 'rosa' | 'gary' | 'thomas' | 'vega'

export type PersonaDefinition = {
  id: PersonaId
  label: string
  subtitle: string
  /** Path under `public/` (e.g. `personas/dr-ellison.jpg`). */
  portraitSrc: string
}

export const PERSONAS: PersonaDefinition[] = [
  { id: 'deadpan', label: 'Dr. Ellison', subtitle: 'Knows a lot. Cares a little.', portraitSrc: 'personas/dr-ellison.jpg' },
  { id: 'enthusiastic', label: 'Frankie', subtitle: 'She loves it here. She loves it everywhere.', portraitSrc: 'personas/frankie.png' },
  { id: 'haunted', label: 'Shiva', subtitle: 'Every place has a past. His is darker.', portraitSrc: 'personas/shiva.png' },
  { id: 'rick', label: 'Rick', subtitle: 'Been here. Not that impressed. Kind of impressed.', portraitSrc: 'personas/rick.png' },
  { id: 'rosa', label: 'Rosa', subtitle: "She's seen the world. She means every word.", portraitSrc: 'personas/rosa.png' },
  { id: 'gary', label: 'Gary', subtitle: "He's done his research. Mostly.", portraitSrc: 'personas/gary.png' },
  { id: 'thomas', label: 'Thomas', subtitle: 'Magnificent. Or deeply troubling. Often both.', portraitSrc: 'personas/thomas.png' },
  { id: 'vega', label: 'Vega', subtitle: 'Not from here. Not from anywhere near here.', portraitSrc: 'personas/vega.png' },
]
