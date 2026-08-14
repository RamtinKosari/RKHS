"use client"

import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"

// 3-slide carousel that feels like a native phone gallery.
//
// All 3 slides (prev / current / next) are pre-rendered side-by-side in a
// flex row. The container is translated so the current slide is centered.
// During a drag we update the translation directly on the DOM (batched via
// rAF) so the parent never re-renders. On release we animate to the
// neighbouring position, then silently snap back to center and call
// onNavigate(newIndex) — the new "current" slide is already sitting in the
// middle, so there's no visible jump. The cyclic prev/next indices mean it
// wraps around at the ends.
const SWIPE_THRESHOLD_RATIO = 0.25
const VELOCITY_THRESHOLD = 0.4
const TRANSITION_MS = 250

interface PreviewCarouselProps<T> {
  items: T[]
  currentIndex: number
  onNavigate: (newIndex: number) => void
  renderSlide: (item: T, position: "prev" | "current" | "next") => ReactNode
  className?: string
}

export default function PreviewCarousel<T>({
  items,
  currentIndex,
  onNavigate,
  renderSlide,
  className,
}: PreviewCarouselProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef(0)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startTimeRef = useRef(0)
  const trackingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const isAnimatingRef = useRef(false)
  const onNavigateRef = useRef(onNavigate)
  useLayoutEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])

  const prevIndex = useMemo(
    () =>
      items.length > 0
        ? (currentIndex - 1 + items.length) % items.length
        : 0,
    [items.length, currentIndex],
  )
  const nextIndex = useMemo(
    () => (items.length > 0 ? (currentIndex + 1) % items.length : 0),
    [items.length, currentIndex],
  )

  const updateTransform = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const width = container.offsetWidth || 1
    const offsetPercent = (dragOffsetRef.current / width) * 100
    container.style.transform = `translateX(calc(-100% + ${offsetPercent}%))`
  }, [])

  // Snap the strip back to center when the current index changes externally
  // (e.g. user tapped a row in the table) — but only when we're not in the
  // middle of a programmatic navigation animation, otherwise we'd clobber
  // the snap-to-neighbor transform.
  useLayoutEffect(() => {
    if (isAnimatingRef.current) return
    const container = containerRef.current
    if (!container) return
    container.style.transition = "none"
    container.style.transform = "translateX(-100%)"
    dragOffsetRef.current = 0
  }, [currentIndex, items.length])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      if (isAnimatingRef.current) return
      const t = e.touches[0]
      startXRef.current = t.clientX
      startYRef.current = t.clientY
      startTimeRef.current = Date.now()
      trackingRef.current = false
      container.style.transition = "none"
    }

    const handleMove = (e: TouchEvent) => {
      if (startTimeRef.current === 0) return
      if (isAnimatingRef.current) return
      const t = e.touches[0]
      const dx = t.clientX - startXRef.current
      const dy = t.clientY - startYRef.current
      if (!trackingRef.current) {
        if (Math.abs(dx) < 8) return
        if (Math.abs(dx) < Math.abs(dy) * 1.2) {
          // Looks like a vertical scroll, abandon.
          startTimeRef.current = 0
          return
        }
        trackingRef.current = true
      }
      dragOffsetRef.current = dx
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateTransform)
    }

    const snapToNeighbor = (direction: "prev" | "next") => {
      container.style.transition = `transform ${TRANSITION_MS}ms ease-out`
      container.style.transform = `translateX(${direction === "next" ? -200 : 0}%)`
      isAnimatingRef.current = true

      const onTransitionEnd = (ev: TransitionEvent) => {
        if (ev.propertyName !== "transform") return
        container.removeEventListener("transitionend", onTransitionEnd)
        // Snap back to center with no transition. The slide that was visible
        // at the neighbor position is now sitting in the middle slot of the
        // freshly-shrunk list, so the user sees no jump.
        container.style.transition = "none"
        container.style.transform = "translateX(-100%)"
        // Force a reflow so the transition:none + new transform is committed
        // before React swaps the children in.
        void container.offsetHeight
        dragOffsetRef.current = 0
        isAnimatingRef.current = false
        const newIndex = direction === "next" ? nextIndex : prevIndex
        onNavigateRef.current(newIndex)
      }
      container.addEventListener("transitionend", onTransitionEnd)
    }

    const snapBack = () => {
      container.style.transition = `transform ${TRANSITION_MS}ms ease-out`
      container.style.transform = "translateX(-100%)"
      dragOffsetRef.current = 0
    }

    const handleEnd = (e: TouchEvent) => {
      if (startTimeRef.current === 0) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startXRef.current
      const elapsed = Date.now() - startTimeRef.current
      const wasTracking = trackingRef.current
      startTimeRef.current = 0
      trackingRef.current = false

      if (!wasTracking) {
        dragOffsetRef.current = 0
        updateTransform()
        return
      }

      const width = container.offsetWidth || 1
      const velocity = Math.abs(dx) / Math.max(elapsed, 1)
      const shouldNavigate =
        Math.abs(dx) > width * SWIPE_THRESHOLD_RATIO ||
        velocity > VELOCITY_THRESHOLD

      if (shouldNavigate) {
        snapToNeighbor(dx < 0 ? "next" : "prev")
      } else {
        snapBack()
      }
    }

    const handleCancel = () => {
      if (startTimeRef.current === 0) return
      startTimeRef.current = 0
      trackingRef.current = false
      snapBack()
    }

    container.addEventListener("touchstart", handleStart, { passive: true })
    container.addEventListener("touchmove", handleMove, { passive: true })
    container.addEventListener("touchend", handleEnd, { passive: true })
    container.addEventListener("touchcancel", handleCancel, { passive: true })

    return () => {
      container.removeEventListener("touchstart", handleStart)
      container.removeEventListener("touchmove", handleMove)
      container.removeEventListener("touchend", handleEnd)
      container.removeEventListener("touchcancel", handleCancel)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updateTransform, prevIndex, nextIndex])

  if (items.length === 0 || currentIndex < 0 || currentIndex >= items.length) {
    return null
  }

  return (
    <div
      className={`overflow-hidden touch-pan-y select-none ${className || ""}`}
    >
      <div
        ref={containerRef}
        className="flex"
        style={{
          transform: "translateX(-100%)",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      >
        <div className="w-full shrink-0">
          {renderSlide(items[prevIndex], "prev")}
        </div>
        <div className="w-full shrink-0">
          {renderSlide(items[currentIndex], "current")}
        </div>
        <div className="w-full shrink-0">
          {renderSlide(items[nextIndex], "next")}
        </div>
      </div>
    </div>
  )
}
