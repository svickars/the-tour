import { useCallback, useState } from 'react'

export type GeolocationOnDemandError = GeolocationPositionError | Error

export type GeolocationRequestOptions = PositionOptions & {
  onSuccess?: (latitude: number, longitude: number) => void
}

export type UseGeolocationOnDemandResult = {
  latitude: number | null
  longitude: number | null
  loading: boolean
  error: GeolocationOnDemandError | null
  request: (options?: GeolocationRequestOptions) => void
  reset: () => void
}

export function useGeolocationOnDemand(): UseGeolocationOnDemandResult {
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<GeolocationOnDemandError | null>(null)

  const reset = useCallback(() => {
    setLatitude(null)
    setLongitude(null)
    setError(null)
    setLoading(false)
  }, [])

  const request = useCallback((options?: GeolocationRequestOptions) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError(new Error('Geolocation is not supported in this browser'))
      return
    }

    const { onSuccess, enableHighAccuracy, maximumAge, timeout } =
      options ?? {}

    setLoading(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setLatitude(lat)
        setLongitude(lng)
        setLoading(false)
        onSuccess?.(lat, lng)
      },
      (positionError) => {
        setError(positionError)
        setLoading(false)
      },
      {
        enableHighAccuracy: enableHighAccuracy ?? true,
        maximumAge: maximumAge ?? 0,
        timeout: timeout ?? 15_000,
      },
    )
  }, [])

  return { latitude, longitude, loading, error, request, reset }
}
