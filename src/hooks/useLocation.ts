import { useEffect, useState } from 'react'

export type UseLocationError = GeolocationPositionError | Error

export type UseLocationResult = {
  latitude: number | null
  longitude: number | null
  loading: boolean
  error: UseLocationError | null
}

function isGeolocationUnsupported(): boolean {
  return typeof navigator !== 'undefined' && !navigator.geolocation
}

/**
 * Requests the user's current position via the browser Geolocation API.
 * Pass `options` to tune `getCurrentPosition` (e.g. `enableHighAccuracy`, `timeout`, `maximumAge`).
 * Memoize `options` if you build it inline to avoid extra requests on re-renders.
 */
export function useLocation(options?: PositionOptions): UseLocationResult {
  const unsupported = isGeolocationUnsupported()

  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [loading, setLoading] = useState(() => !unsupported)
  const [error, setError] = useState<UseLocationError | null>(() =>
    unsupported
      ? new Error('Geolocation is not supported in this browser')
      : null,
  )

  const enableHighAccuracy = options?.enableHighAccuracy
  const maximumAge = options?.maximumAge
  const timeout = options?.timeout

  useEffect(() => {
    if (unsupported) return

    let cancelled = false

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setError(null)
        setLoading(false)
      },
      (positionError) => {
        if (cancelled) return
        setError(positionError)
        setLoading(false)
      },
      {
        enableHighAccuracy,
        maximumAge,
        timeout,
      },
    )

    return () => {
      cancelled = true
    }
  }, [unsupported, enableHighAccuracy, maximumAge, timeout])

  return { latitude, longitude, loading, error }
}
