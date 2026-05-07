import { useCallback, useEffect, useRef, useState } from 'react'
import type { SelectedPlace } from './useTourEngine'

export type OnboardingStep =
  | 'place'
  | 'bridge_place'
  | 'persona'
  | 'vibes'
  | 'bridge_persona'
  | 'tour'

const BRIDGE1_MS = 3500

function placeKey(p: SelectedPlace): string {
  if (p.placeId?.trim()) return `pid:${p.placeId.trim()}`
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
}

type UseOnboardingFlowArgs = {
  selectedPlace: SelectedPlace | null
  prefetchLoading: boolean
  canGenerate: boolean
  /** True when the tour player can be shown from the persona bridge (script done + audio prep or ready for manual play). */
  bridgeTourContentReady: boolean
  stopTour: () => void
  cancelTourPrep: () => void
  /** Clears place/persona UI state; called after internal flow reset. */
  onRestartApp?: () => void
  /** Called when backing from tour to narrator, before `stopTour` (album still in memory). */
  beforeLeaveTour?: () => void | Promise<void>
}

export function useOnboardingFlow({
  selectedPlace,
  prefetchLoading,
  canGenerate,
  bridgeTourContentReady,
  stopTour,
  cancelTourPrep,
  onRestartApp,
  beforeLeaveTour,
}: UseOnboardingFlowArgs) {
  const [step, setStep] = useState<OnboardingStep>('place')
  const [prefetchTimedOut, setPrefetchTimedOut] = useState(false)
  const lastBridgedPlaceKey = useRef<string | null>(null)
  const bridge2Started = useRef(false)
  /** After backing out of bridge 1, skip one effect tick so we do not immediately re-enter the bridge. */
  const skipNextPlaceBridgeRef = useRef(false)

  /** After picking a location on step 1, enter the first bridge (unless returning from persona with same pin). */
  useEffect(() => {
    if (step !== 'place' || !selectedPlace) return
    if (skipNextPlaceBridgeRef.current) {
      skipNextPlaceBridgeRef.current = false
      return
    }
    const key = placeKey(selectedPlace)
    if (lastBridgedPlaceKey.current === key) return
    lastBridgedPlaceKey.current = key
    setPrefetchTimedOut(false)
    setStep('bridge_place')
  }, [selectedPlace, step])

  /** Soft timeout: never stall on bridge 1 forever. */
  useEffect(() => {
    if (step !== 'bridge_place') return
    const id = window.setTimeout(() => {
      setPrefetchTimedOut(true)
      setStep('persona')
    }, BRIDGE1_MS)
    return () => window.clearTimeout(id)
  }, [step])

  /** Prefetch ready with usable context — leave bridge early. */
  useEffect(() => {
    if (step !== 'bridge_place') return
    if (prefetchLoading || !canGenerate) return
    const id = window.requestAnimationFrame(() => {
      setStep('persona')
    })
    return () => window.cancelAnimationFrame(id)
  }, [step, prefetchLoading, canGenerate])

  /** When the main script is done and main-stop audio is prepared, show the tour sheet for manual play. */
  useEffect(() => {
    if (step !== 'bridge_persona') return
    if (!bridgeTourContentReady) return
    const id = window.requestAnimationFrame(() => {
      setStep('tour')
    })
    return () => window.cancelAnimationFrame(id)
  }, [step, bridgeTourContentReady])

  const goBack = useCallback(() => {
    const syncKey = () => {
      lastBridgedPlaceKey.current = selectedPlace
        ? placeKey(selectedPlace)
        : null
    }

    if (step === 'tour') {
      void beforeLeaveTour?.()
      stopTour()
      bridge2Started.current = false
      syncKey()
      setStep('persona')
      return
    }
    if (step === 'persona') {
      syncKey()
      setStep('place')
      return
    }
    if (step === 'bridge_place') {
      lastBridgedPlaceKey.current = null
      skipNextPlaceBridgeRef.current = true
      setStep('place')
      return
    }
    if (step === 'bridge_persona') {
      cancelTourPrep()
      bridge2Started.current = false
      setStep('vibes')
      return
    }
    if (step === 'vibes') {
      setStep('persona')
      return
    }
  }, [step, stopTour, cancelTourPrep, selectedPlace, beforeLeaveTour])

  const advanceToVibesSheet = useCallback(() => {
    setStep('vibes')
  }, [])

  const advanceToPersonaBridge = useCallback(() => {
    setStep('bridge_persona')
  }, [])

  /** Jump to tour sheet (e.g. restored saved audio) without running generation. */
  const enterTourFromLibrary = useCallback(() => {
    bridge2Started.current = true
    setStep('tour')
  }, [])

  /** Close the tour sheet and return to the place step (full stack dismiss). */
  const dismissTourSheet = useCallback(() => {
    cancelTourPrep()
    stopTour()
    bridge2Started.current = false
    if (selectedPlace) {
      lastBridgedPlaceKey.current = placeKey(selectedPlace)
    }
    setStep('place')
  }, [cancelTourPrep, stopTour, selectedPlace])

  const restart = useCallback(() => {
    cancelTourPrep()
    stopTour()
    bridge2Started.current = false
    lastBridgedPlaceKey.current = null
    skipNextPlaceBridgeRef.current = false
    setPrefetchTimedOut(false)
    setStep('place')
    onRestartApp?.()
  }, [cancelTourPrep, stopTour, onRestartApp])

  const overlayCoversPlace = step !== 'place'

  return {
    step,
    prefetchTimedOut,
    goBack,
    restart,
    advanceToVibesSheet,
    advanceToPersonaBridge,
    overlayCoversPlace,
    enterTourFromLibrary,
    dismissTourSheet,
  }
}
