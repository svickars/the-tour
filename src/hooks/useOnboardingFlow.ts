import { useCallback, useEffect, useRef, useState } from 'react'
import type { SelectedPlace } from './useTourEngine'

export type OnboardingStep =
  | 'place'
  | 'bridge_place'
  | 'persona'
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
  audioPhase: 'idle' | 'loading' | 'playing'
  /** True after the main tour clip has started (including first chunk of segmented TTS). */
  mainTourPlaybackStarted: boolean
  stopTour: () => void
  cancelTourPrep: () => void
  /** Clears place/persona UI state; called after internal flow reset. */
  onRestartApp?: () => void
}

export function useOnboardingFlow({
  selectedPlace,
  prefetchLoading,
  canGenerate,
  audioPhase,
  mainTourPlaybackStarted,
  stopTour,
  cancelTourPrep,
  onRestartApp,
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

  /** When main audio actually starts (first chunk), show the tour card. */
  useEffect(() => {
    if (step !== 'bridge_persona') return
    if (audioPhase !== 'playing' && !mainTourPlaybackStarted) return
    const id = window.requestAnimationFrame(() => {
      setStep('tour')
    })
    return () => window.cancelAnimationFrame(id)
  }, [step, audioPhase, mainTourPlaybackStarted])

  const goBack = useCallback(() => {
    const syncKey = () => {
      lastBridgedPlaceKey.current = selectedPlace
        ? placeKey(selectedPlace)
        : null
    }

    if (step === 'tour') {
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
      setStep('persona')
    }
  }, [step, stopTour, cancelTourPrep, selectedPlace])

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
    advanceToPersonaBridge,
    overlayCoversPlace,
    enterTourFromLibrary,
    dismissTourSheet,
  }
}
