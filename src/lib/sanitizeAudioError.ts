/** Generic copy when we hide vendor / technical details from TTS failures. */
export const GENERIC_AUDIO_PREP_FAILED =
  'We could not prepare the narration audio. Check your connection, then try again.'

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message.trim()
  if (typeof err === 'string') return err.trim()
  return ''
}

/**
 * User-visible audio/TTS error: never empty, never names third-party providers.
 * Use for `audioError`, track `errorMessage`, and album fetch failures.
 */
export function userFacingAudioErrorMessage(err: unknown): string {
  const raw = rawMessage(err)
  if (!raw) return GENERIC_AUDIO_PREP_FAILED
  const lower = raw.toLowerCase()
  if (
    lower.includes('elevenlabs') ||
    lower.includes('eleven labs') ||
    lower.includes('xi-api') ||
    lower.includes('xi api') ||
    lower.includes('could not reach') ||
    lower.includes('could not read audio') ||
    lower.includes('bad gateway') ||
    lower.includes('err_file_not_found')
  ) {
    return GENERIC_AUDIO_PREP_FAILED
  }
  if (/^audio failed \(\d+\)/i.test(raw)) return GENERIC_AUDIO_PREP_FAILED
  if (raw.length > 220) return GENERIC_AUDIO_PREP_FAILED
  return raw
}
