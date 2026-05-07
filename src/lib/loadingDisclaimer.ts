import type { PersonaId } from './personas'

/** Full two-part disclaimer for the tour generation (loading) sheet. */
export const LOADING_DISCLAIMER_BY_PERSONA: Record<PersonaId, string> = {
  deadpan:
    "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Dr. Ellison has been instructed to cite real history where possible. He has not been instructed to make it interesting.",
  enthusiastic:
    "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Frankie may exaggerate. She can't help it. She just really loves this place.",
  haunted:
    "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Shiva has been known to embellish. The darker the detail, the less you should trust it.",
  rick: "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Rick has been here before, or somewhere like it. Details may be approximate.",
  rosa: "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Rosa draws on decades of travel. Some memories are clearer than others.",
  gary: "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Gary has done extensive research. We have not been able to verify any of it.",
  vega: "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Vega's observations are based on limited fieldwork and several significant misunderstandings.",
  thomas:
    "Elsewhere is AI-powered and occasionally confidently wrong. Always a good story though. Thomas has been instructed to fill in the gaps with personal anecdotes, which he's likely made up.",
}

export function loadingDisclaimerFor(persona: PersonaId): string {
  return LOADING_DISCLAIMER_BY_PERSONA[persona]
}
