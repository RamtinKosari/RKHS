"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, FileVideo } from "lucide-react"

interface VideoPlayerProps {
  src: string
  className?: string
  autoPlay?: boolean
}

/**
 * Single-video player used inside the preview carousel and fullscreen dialog.
 *
 * Why a dedicated component:
 *   - We deliberately render ONE <video> element per carousel slot, not three.
 *     Mounting three live videos per swipe is what made the side preview
 *     lag on mobile and is what raced with the fullscreen dialog (the
 *     "looks like 3x speed" impression).
 *   - The <video> DOM is preserved across src changes (no key swap), so the
 *     browser keeps its decoder/buffer pipeline and we avoid hammering
 *     the network with three parallel range requests per swipe.
 *   - On src change we explicitly pause and drop back to t=0 once metadata
 *     loads; we never carry over playback state from the previous file.
 */
export default function VideoPlayer({
  src,
  className,
  autoPlay = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    try {
      el.pause()
    } catch {
      // Ignore: some browsers throw if the element is mid-teardown.
    }
    setIsLoading(true)
    setHasError(false)
  }, [src])

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center bg-black ${
        className || ""
      }`}
    >
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        controlsList="nodownload"
        className="max-w-full max-h-full object-contain"
        onLoadedMetadata={(e) => {
          setIsLoading(false)
          // Snap back to t=0 once metadata is ready; some browsers ignore
          // the assignment we tried to make during the src-change effect.
          const el = e.currentTarget
          try {
            el.currentTime = 0
          } catch {
            // Ignore seek errors on freshly-loaded media.
          }
        }}
        onError={() => {
          setIsLoading(false)
          setHasError(true)
        }}
      />
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-white/70" />
        </div>
      )}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-300 text-xs pointer-events-none">
          <FileVideo className="w-6 h-6 opacity-70" />
          <span>Failed to load video</span>
        </div>
      )}
    </div>
  )
}
