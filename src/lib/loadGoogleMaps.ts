const SCRIPT_ID = 'elsewhere-maps-bootstrap'
/** Earlier builds used these ids; remove so we can reload with `loading=async` + `callback`. */
const LEGACY_SCRIPT_IDS = ['passerby-maps-bootstrap', 'passerby-google-maps-js'] as const

let loadPromise: Promise<void> | null = null

/** True once the bootstrap exposes dynamic `importLibrary` (required for Places). */
function isMapsLoaderReady(): boolean {
  return Boolean(
    typeof window !== 'undefined' && window.google?.maps?.importLibrary,
  )
}

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Maps can only load in the browser.'))
  }

  if (isMapsLoaderReady()) {
    return Promise.resolve()
  }

  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (isMapsLoaderReady()) {
        resolve()
        return
      }
      const done = () => {
        if (isMapsLoaderReady()) resolve()
        else reject(new Error('Google Maps failed to initialize.'))
      }
      existing.addEventListener('load', done, { once: true })
      existing.addEventListener(
        'error',
        () => {
          loadPromise = null
          reject(new Error('Failed to load Google Maps'))
        },
        { once: true },
      )
      return
    }

    for (const id of LEGACY_SCRIPT_IDS) {
      document.getElementById(id)?.remove()
    }

    const callbackName = `__elsewhereMapsCb_${Math.random().toString(36).slice(2, 11)}`
    ;(window as unknown as Record<string, () => void>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName]
      resolve()
    }

    const s = document.createElement('script')
    s.id = SCRIPT_ID
    s.async = true
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=places&loading=async&callback=${callbackName}`
    s.onerror = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName]
      loadPromise = null
      s.remove()
      reject(new Error('Failed to load Google Maps'))
    }
    document.head.appendChild(s)
  })

  return loadPromise
}
