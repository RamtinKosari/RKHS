"use client"

import Hls, { type ErrorData } from "hls.js"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Settings,
  Subtitles,
  X,
  Download,
  AlertCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import type { SubtitleTrack } from "@/lib/cinema-types"

// `AudioTrackList` was removed from the standard lib.dom typing but the
// experimental video.audioTracks API is still used by some browsers.
interface CinemaAudioTrack {
  id?: string
  label?: string
  language?: string
  enabled?: boolean
}
interface CinemaAudioTrackList extends ArrayLike<CinemaAudioTrack> {
  selectedIndex?: number
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface ResolvedPlay {
  /** A direct, range-served URL the browser can play natively. */
  kind: "direct"
  url: string
}
interface ResolvedRemux {
  /** A remuxed fMP4 URL produced by stream-copying a decodable codec into
   *  an MP4 container. Plays like a direct file once ready. */
  kind: "remux"
  url: string
  status: "ready"
}
interface ResolvedHls {
  /** An HLS playlist URL (CMAF / fMP4) the browser plays via hls.js or
   *  native HLS (Safari). */
  kind: "hls"
  url: string
  status: "ready"
}

export interface CinemaPlayerProps {
  mediaId: string
  filePath: string
  /** Playable id (used as `resumeFileId` for resume across sessions). */
  fileId: string
  poster?: string
  subtitles?: SubtitleTrack[]
  /** Saved progress in seconds (clamped to <95% & >5% on the server). */
  initialProgress?: number
  initialDuration?: number
  /** Show an "X" close button (e.g. when used inside a modal). */
  showCloseButton?: boolean
  onClose?: () => void
  /** Called every few seconds while playing with persisted progress. */
  onProgress?: (info: {
    fileId: string
    mediaId: string
    currentTime: number
    duration: number
  }) => void
  onEnded?: () => void
  onNext?: () => void
  onPrevious?: () => void
  className?: string
}

/**
 * Personal Cinema player. Resolves playback via the unified
 * `/api/cinema/play/<id>?file=...` endpoint which tells us whether the
 * file is browser-friendly (serve raw) or not (serve a live HLS
 * rendition that's transcoded in the background by ffmpeg).
 *
 * For non-friendly files we poll the endpoint until HLS is ready,
 * then attach hls.js to the <video> element. fMP4 segments go
 * straight into MSE — no transmuxing, fast startup, low CPU.
 */
export default function CinemaPlayer({
  mediaId,
  filePath,
  fileId,
  poster,
  subtitles = [],
  initialProgress = 0,
  initialDuration = 0,
  showCloseButton = false,
  onClose,
  onProgress,
  onEnded,
  onNext,
  onPrevious,
  className,
}: CinemaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hideControlsTimer = useRef<number | null>(null)
  const hlsRef = useRef<Hls | null>(null)

  /** What we actually attached to the <video> element. `undefined`
   *  means "not decided yet" (still resolving). */
  const [resolved, setResolved] = useState<ResolvedPlay | ResolvedRemux | ResolvedHls | undefined>(undefined)
  /** Visible status while the backend is warming up the HLS transcode
   *  (or before we've even asked it). */
  const [transcodeStatus, setTranscodeStatus] = useState<"idle" | "starting" | "running" | "ready" | "error">("idle")
  const [preparingKind, setPreparingKind] = useState<"remux" | "hls" | null>(null)
  const [transcodeError, setTranscodeError] = useState<string | null>(null)
  const [transcodeProgress, setTranscodeProgress] = useState<{ duration: number } | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSeeking, setIsSeeking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDuration || 0)
  const [volume, setVolume] = useState(0.9)
  const [isMuted, setIsMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string; lang: string }[]>([])
  const [activeAudioIndex, setActiveAudioIndex] = useState(0)
  const [hasResumed, setHasResumed] = useState(false)
  const subtitleTracks = useMemo(() => subtitles, [subtitles])

  // ------------------ Resolve playback via /play ------------------
  // Hit the unified endpoint on mount / when (mediaId, filePath) changes.
  // For browser-friendly files this returns immediately with a "direct"
  // URL. For everything else it returns 202 "starting" and we poll
  // every second until the HLS playlist exists, then attach hls.js.
  useEffect(() => {
    let cancelled = false
    // Reset transient state when (mediaId, filePath) changes. These are
    // local mirrors of the underlying <video> element and the imperative
    // reset is the cleanest way to keep them in sync across src changes.
    /* eslint-disable react-hooks/set-state-in-effect */
    setResolved(undefined)
    setErrorMessage(null)
    setTranscodeStatus("idle")
    setPreparingKind(null)
    setTranscodeError(null)
    setTranscodeProgress(null)
    setHasResumed(false)
    setCurrentTime(0)
    setIsLoading(true)
    /* eslint-enable react-hooks/set-state-in-effect */

    const params = new URLSearchParams({ file: filePath })

    const pollOnce = async (): Promise<
      ResolvedPlay | ResolvedRemux | ResolvedHls | "still-preparing" | "unsupported" | "gone"
    > => {
      try {
        const res = await fetch(
          `/api/cinema/play/${encodeURIComponent(mediaId)}?${params.toString()}`
        )
        if (res.status === 404) return "gone"
        if (res.status === 409) return "unsupported"
        if (res.status === 202) {
          const body = (await res.json().catch(() => ({}))) as {
            kind?: "direct" | "remux" | "hls"
            status?: string
          }
          setTranscodeStatus(body.status === "queued" ? "starting" : "running")
          setPreparingKind(body.kind === "remux" ? "remux" : "hls")
          return "still-preparing"
        }
        if (!res.ok) {
          setTranscodeError(`Server error (${res.status})`)
          return "gone"
        }
        const body = (await res.json()) as {
          kind: "direct" | "remux" | "hls"
          url?: string
          status?: string
          progress?: { duration: number }
          download?: string
        }
        if (body.kind === "direct" && body.url) {
          setTranscodeStatus("ready")
          return { kind: "direct", url: body.url }
        }
        if (body.kind === "remux" && body.status === "ready" && body.url) {
          setTranscodeStatus("ready")
          return { kind: "remux", url: body.url, status: "ready" }
        }
        if (body.kind === "hls" && body.status === "ready" && body.url) {
          setTranscodeStatus("ready")
          if (body.progress?.duration) {
            setTranscodeProgress({ duration: body.progress.duration })
          }
          return { kind: "hls", url: body.url, status: "ready" }
        }
        return "still-preparing"
      } catch (err) {
        setTranscodeError(err instanceof Error ? err.message : "Network error")
        return "still-preparing"
      }
    }

    const run = async () => {
      // First call: may already be ready, may be starting, may be unsupported.
      const first = await pollOnce()
      if (cancelled) return
      if (first === "gone") {
        setErrorMessage("This file is no longer in your library. Please refresh and try again.")
        setIsLoading(false)
        return
      }
      if (first === "unsupported") {
        setErrorMessage("Transcoding is unavailable on this server (ffmpeg not installed).")
        setIsLoading(false)
        return
      }
      if (first === "still-preparing") {
        // Poll up to ~10 minutes. HEVC sources need the decoder to
        // chew through a few GOPs before ffmpeg can emit the first
        // fMP4 segment; veryfast preset is ~10–15× realtime on this
        // hardware, so a 2.5-hour movie's first segment lands in
        // 30–90 s. The first poll after the playlist appears is what
        // kicks hls.js off, so this only gates the very first play.
        for (let i = 0; i < 600 && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          if (cancelled) return
          const next = await pollOnce()
          if (cancelled) return
          if (next === "gone") {
            setErrorMessage("This file is no longer in your library. Please refresh and try again.")
            setIsLoading(false)
            return
          }
          if (next === "unsupported") {
            setErrorMessage("Transcoding is unavailable on this server (ffmpeg not installed).")
            setIsLoading(false)
            return
          }
          if (next !== "still-preparing") {
            setResolved(next)
            setIsLoading(false)
            return
          }
        }
        if (!cancelled) {
          setErrorMessage("Transcoding timed out — the server is busy or the file is too large.")
          setIsLoading(false)
        }
        return
      }
      setResolved(first)
      setIsLoading(false)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [mediaId, filePath])

  // ------------------ Attach the resolved source to <video> ------------------
  // For "direct" URLs we just set <video src> and the browser does the
  // rest. For "hls" URLs we prefer native HLS on Safari (which works
  // with ManagedMediaSource on iOS 17.1+) and hls.js everywhere else.
  //
  // This effect only depends on ``resolved``. Re-running it on every
  // progress save (which updates ``initialProgress``) would re-assign
  // ``v.src = sameUrl`` and, in some browsers, the browser interprets
  // that as a fresh source load — which dumps the user back at 0:00.
  // The resume logic is handled separately by ``handleLoadedMetadata``
  // below using the ``initialProgress`` prop on first load only.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !resolved) return

    // Tear down any previous hls.js instance.
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (resolved.kind === "direct" || resolved.kind === "remux") {
      // Guard against re-assigning the same URL. Some browsers reset
      // ``currentTime`` to 0 on any ``src`` assignment, even with an
      // identical value, which would kill playback mid-movie.
      if (v.src !== resolved.url) {
        try {
          v.src = resolved.url
        } catch {
          /* ignore — <video>.onError will surface the failure */
        }
      }
      return
    }

    // HLS path.
    const isHls = /\.m3u8($|\?)/i.test(resolved.url)
    if (!isHls) {
      if (v.src !== resolved.url) {
        try {
          v.src = resolved.url
        } catch {
          /* ignore */
        }
      }
      return
    }

    // Safari: prefer native HLS via the standard video element. This
    // works on macOS Safari and iPadOS Safari 13+ (and iOS 17.1+ via
    // Managed Media Source for fMP4 HLS).
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      if (v.src !== resolved.url) {
        try {
          v.src = resolved.url
        } catch {
          /* ignore */
        }
      }
      return
    }

    if (!Hls.isSupported()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setErrorMessage(
        "Your browser doesn't support HLS playback. Please open the file in VLC, IINA, or MPV."
      )
      return
    }

    const hls = new Hls({
      enableWorker: true,
      // BackBuffer is large enough for smooth seek-back without
      // re-fetching many segments.
      backBufferLength: 30,
      startPosition: initialProgress > 0 ? initialProgress : -1,
    })
    hls.loadSource(resolved.url)
    hls.attachMedia(v)
    hls.on(Hls.Events.ERROR, (_event: unknown, data: ErrorData) => {
      if (!data.fatal) return
      // Preserve the current playback position across recovery so a seek or
      // transient segment error doesn't dump the user back at the start.
      const resumeAt = hls.media?.currentTime || 0
      // hls.js has its own recovery for transient errors. Only surface
      // when it gives up entirely.
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        if (resumeAt > 0 && hls.media) {
          hls.media.currentTime = resumeAt
        }
        return
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad(resumeAt > 0 ? resumeAt : -1)
        return
      }
      setErrorMessage(
        `Playback error: ${data.details || data.type}${data.error?.message ? ` — ${data.error.message}` : ""}`
      )
    })
    hlsRef.current = hls
    return () => {
      hls.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved])

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [])

  // ------------------ Resume / progress / play state ------------------
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration || initialDuration || 0)
    setIsLoading(false)
    if (!hasResumed && initialProgress > 0) {
      const total = v.duration || initialDuration
      const pct = total > 0 ? initialProgress / total : 0
      if (pct > 0.05 && pct < 0.95) {
        try {
          v.currentTime = initialProgress
        } catch {
          /* ignore */
        }
      }
      setHasResumed(true)
    } else {
      setHasResumed(true)
    }
  }, [hasResumed, initialDuration, initialProgress])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
  }, [])

  const handleProgressEmit = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const total = v.duration || duration
    onProgress?.({
      fileId,
      mediaId,
      currentTime: v.currentTime,
      duration: total,
    })
  }, [duration, fileId, mediaId, onProgress])

  useEffect(() => {
    if (!isPlaying) return
    const id = window.setInterval(() => handleProgressEmit(), 5000)
    return () => window.clearInterval(id)
  }, [handleProgressEmit, isPlaying])

  // ------------------ Audio tracks ------------------
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const update = () => {
      const list = (v as unknown as { audioTracks?: CinemaAudioTrackList }).audioTracks
      if (!list || !list.length) {
        setAudioTracks([])
        return
      }
      const items: { id: string; label: string; lang: string }[] = []
      for (let i = 0; i < list.length; i++) {
        const t = list[i]
        items.push({
          id: t.id ?? String(i),
          label: t.label || `Track ${i + 1}`,
          lang: t.language || "",
        })
      }
      setAudioTracks(items)
      setActiveAudioIndex(list.selectedIndex ?? 0)
    }
    update()
    const list = (v as unknown as { audioTracks?: CinemaAudioTrackList }).audioTracks
    list?.addEventListener?.("addtrack", update)
    list?.addEventListener?.("removetrack", update)
    list?.addEventListener?.("change", update)
    return () => {
      list?.removeEventListener?.("addtrack", update)
      list?.removeEventListener?.("removetrack", update)
      list?.removeEventListener?.("change", update)
    }
  }, [resolved])

  const handleSelectAudioTrack = useCallback((index: number) => {
    const liveTracks = (videoRef.current as unknown as { audioTracks?: CinemaAudioTrackList } | null)?.audioTracks
    if (!liveTracks) return
    const tracks: CinemaAudioTrack[] = Array.from(liveTracks)
    for (let i = 0; i < tracks.length; i++) {
      const next = i === index
      tracks[i].enabled = next
      // Apply back to the live list — this is the documented API for the
      // (non-standard) video.audioTracks extension.
      // eslint-disable-next-line react-hooks/immutability
      liveTracks[i].enabled = next
    }
    setActiveAudioIndex(index)
  }, [])

  // ------------------ Controls visibility ------------------
  const bumpControls = useCallback(() => {
    setShowControls(true)
    if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current)
    if (isPlaying) {
      hideControlsTimer.current = window.setTimeout(() => setShowControls(false), 2800)
    }
  }, [isPlaying])

  useEffect(() => {
    // Show controls whenever the play state changes (e.g. on pause the
    // overlay should appear immediately). The body deliberately mirrors
    // the latest `isPlaying` into a ref-scheduled timer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    bumpControls()
  }, [bumpControls, isPlaying])

  // ------------------ Playback actions ------------------
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false))
    } else {
      v.pause()
      setIsPlaying(false)
      handleProgressEmit()
    }
  }, [handleProgressEmit])

  const handleSeek = useCallback(
    (value: number[]) => {
      const v = videoRef.current
      if (!v) return
      const target = (value[0] / 100) * (v.duration || duration)
      v.currentTime = target
      setCurrentTime(target)
    },
    [duration]
  )

  const handleSkip = useCallback((seconds: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.min(Math.max(v.currentTime + seconds, 0), v.duration || 0)
  }, [])

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0] / 100
    setVolume(newVolume)
    if (videoRef.current) {
      videoRef.current.volume = newVolume
    }
    if (newVolume > 0) setIsMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (isMuted) {
      v.volume = volume
      setIsMuted(false)
    } else {
      v.volume = 0
      setIsMuted(true)
    }
  }, [isMuted, volume])

  const handleSpeedChange = useCallback((s: number) => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = s
    setSpeed(s)
  }, [])

  const handleSelectSubtitle = useCallback((lang: string | null) => {
    const v = videoRef.current
    if (!v) return
    const tracks = v.textTracks
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]
      const trackLang = t.language
      t.mode = lang !== null && trackLang === lang ? "showing" : "hidden"
    }
    setActiveSubtitleLang(lang)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      /* ignore */
    }
  }, [])

  const togglePiP = useCallback(async () => {
    const v = videoRef.current
    if (!v) return
    try {
      const doc = document as unknown as {
        pictureInPictureElement?: Element | null
        exitPictureInPicture?: () => Promise<void>
      }
      if (doc.pictureInPictureElement === v) {
        await doc.exitPictureInPicture?.()
      } else if (!v.disablePictureInPicture) {
        await v.requestPictureInPicture?.()
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFSChange)
    const v = videoRef.current
    const onPiPEnter = () => setIsPiP(true)
    const onPiPLeave = () => setIsPiP(false)
    v?.addEventListener("enterpictureinpicture", onPiPEnter)
    v?.addEventListener("leavepictureinpicture", onPiPLeave)
    return () => {
      document.removeEventListener("fullscreenchange", onFSChange)
      v?.removeEventListener("enterpictureinpicture", onPiPEnter)
      v?.removeEventListener("leavepictureinpicture", onPiPLeave)
    }
  }, [resolved])

  // ------------------ Keyboard shortcuts ------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return
      }
      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault()
          togglePlay()
          break
        case "arrowleft":
        case "j":
          e.preventDefault()
          handleSkip(-10)
          break
        case "arrowright":
        case "l":
          e.preventDefault()
          handleSkip(10)
          break
        case "f":
          e.preventDefault()
          toggleFullscreen()
          break
        case "m":
          e.preventDefault()
          toggleMute()
          break
        case "p":
          e.preventDefault()
          togglePiP()
          break
        case "n":
          e.preventDefault()
          onNext?.()
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleSkip, onNext, toggleFullscreen, toggleMute, togglePiP, togglePlay])

  // ------------------ Subtitle <track> elements ------------------
  const trackElements = useMemo(() => {
    return subtitleTracks.map((t, i) => {
      const params = new URLSearchParams({ name: t.filename, file: filePath })
      return (
        <track
          key={`${t.lang}-${i}`}
          kind="subtitles"
          src={`/api/cinema/subtitle/${encodeURIComponent(mediaId)}?${params.toString()}`}
          srcLang={t.lang}
          label={t.label}
        />
      )
    })
  }, [filePath, mediaId, subtitleTracks])

  // ------------------ Render ------------------
  const videoSrc = resolved?.kind === "direct" || resolved?.kind === "remux"
    ? resolved.url
    : undefined
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const isTranscoding = transcodeStatus === "starting" || transcodeStatus === "running"

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/player relative w-full h-full bg-black select-none overflow-hidden rounded-xl",
        className
      )}
      onMouseMove={bumpControls}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onClick={(e) => {
        // Click-to-play/pause on the video surface only (not on controls).
        if ((e.target as HTMLElement).closest("[data-player-controls]")) return
        if ((e.target as HTMLElement).closest("video")) {
          togglePlay()
        }
      }}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full h-full object-contain bg-black"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false)
          handleProgressEmit()
        }}
        onEnded={() => {
          setIsPlaying(false)
          handleProgressEmit()
          onEnded?.()
        }}
        onSeeking={() => setIsSeeking(true)}
        onSeeked={() => setIsSeeking(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false)
          setIsSeeking(false)
        }}
        onError={() => {
          setIsLoading(false)
          setIsSeeking(false)
          const code = videoRef.current?.error?.code
          const reason = code === 1
            ? "aborted"
            : code === 2
              ? "network error — the server blocked or dropped a request"
              : code === 3
                ? "decode error — the browser can't decode this codec"
                : code === 4
                  ? "source not supported"
                  : "unknown"
          setErrorMessage(
            `The browser couldn't play this file (${reason}). Download it and open it in VLC, IINA, or MPV.`
          )
        }}
        controlsList="nodownload noremoteplayback"
      >
        {trackElements}
      </video>

      {/* Transcoding overlay */}
      {isTranscoding && !errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-200 text-sm px-6 text-center bg-black/40 pointer-events-none">
          <Loader2 className="w-8 h-8 animate-spin text-white/80" />
          <span className="font-medium">
            {transcodeStatus === "starting"
              ? preparingKind === "remux"
                ? "Starting remux…"
                : "Starting transcode…"
              : preparingKind === "remux"
                ? "Server is remuxing the container…"
                : "Server is transcoding for browser playback…"}
          </span>
          <span className="text-xs text-zinc-400 max-w-sm">
            {preparingKind === "remux"
              ? "Copying streams into an MP4 the browser can play — no quality loss, fast startup."
              : "Playback will start as soon as the first segment lands — no need to wait for the full file to finish."}
          </span>
          {transcodeProgress && transcodeProgress.duration > 0 && (
            <span className="text-[11px] text-zinc-500">
              {Math.round(transcodeProgress.duration)}s of source ready
            </span>
          )}
        </div>
      )}

      {/* Loading overlay during initial resolve, seek, or segment fetch */}
      {isLoading && !errorMessage && !isTranscoding && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Loader2 className="w-8 h-8 animate-spin text-white/70" />
          <span className="text-xs text-zinc-300">
            {isSeeking ? "Seeking…" : resolved ? "Loading segment…" : "Loading…"}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-200 text-sm px-6 text-center bg-black/70">
          <AlertCircle className="w-7 h-7 text-rose-400" />
          <span className="font-medium">{errorMessage}</span>
          {transcodeError && transcodeError !== errorMessage && (
            <span className="text-xs text-zinc-400 max-w-sm">{transcodeError}</span>
          )}
          {/* Offer a download fallback so the user is never stuck. */}
          <a
            href={`/api/cinema/stream/${encodeURIComponent(mediaId)}?file=${encodeURIComponent(filePath)}`}
            download
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download file
          </a>
        </div>
      )}

      {/* Center play button overlay when paused */}
      {!isPlaying && !isLoading && !errorMessage && resolved && (
        <button
          aria-label="Play"
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/55 transition-colors"
        >
          <Play className="w-9 h-9 ml-1" fill="currentColor" />
        </button>
      )}

      {/* Top close button */}
      {showCloseButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute top-3 right-3 z-20 bg-black/40 text-white hover:bg-black/60 hover:text-white"
          aria-label="Close player"
        >
          <X className="w-4 h-4" />
        </Button>
      )}

      {/* Bottom controls */}
      <div
        data-player-controls
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 px-3 pb-3 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <Slider
          value={[progressPct]}
          max={100}
          step={0.1}
          onValueChange={handleSeek}
          className="mb-2 cursor-pointer"
        />
        <div className="flex items-center gap-2 text-white">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrevious}
            className="text-white hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label="Previous"
            disabled={!onPrevious}
          >
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={togglePlay}
            className="text-white hover:bg-white/15 hover:text-white h-9 w-9"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNext}
            className="text-white hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label="Next"
            disabled={!onNext}
          >
            <SkipForward className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSkip(-10)}
            className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label="Back 10 seconds"
            title="Back 10s (←)"
          >
            <span className="text-[10px] font-semibold">−10</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSkip(10)}
            className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label="Forward 10 seconds"
            title="Forward 10s (→)"
          >
            <span className="text-[10px] font-semibold">+10</span>
          </Button>

          <span className="text-[11px] tabular-nums text-white/80 ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            max={100}
            step={1}
            onValueChange={handleVolumeChange}
            className="w-24 cursor-pointer"
          />

          {/* Subtitles menu */}
          {subtitleTracks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
                  aria-label="Subtitles"
                  title="Subtitles"
                >
                  <Subtitles className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuLabel className="text-xs">Subtitles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => handleSelectSubtitle(null)}
                  className={cn(activeSubtitleLang === null && "text-primary")}
                >
                  Off
                </DropdownMenuItem>
                {subtitleTracks.map((t) => (
                  <DropdownMenuItem
                    key={t.lang}
                    onSelect={() => handleSelectSubtitle(t.lang)}
                    className={cn(activeSubtitleLang === t.lang && "text-primary")}
                  >
                    {t.label}
                    <span className="ml-auto text-[10px] text-zinc-500 uppercase">{t.lang}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Speed / settings menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
                aria-label="Playback settings"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel className="text-xs">Playback speed</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SPEEDS.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => handleSpeedChange(s)}
                  className={cn(speed === s && "text-primary")}
                >
                  {s === 1 ? "Normal" : `${s}×`}
                </DropdownMenuItem>
              ))}
              {audioTracks.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Audio</DropdownMenuLabel>
                  {audioTracks.map((t, i) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => handleSelectAudioTrack(i)}
                      className={cn(activeAudioIndex === i && "text-primary")}
                    >
                      {t.label || `Track ${i + 1}`}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={togglePiP}
            className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label={isPiP ? "Exit picture-in-picture" : "Picture-in-picture"}
            title="Picture-in-picture (P)"
          >
            <PictureInPicture2 className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            className="text-white/80 hover:bg-white/15 hover:text-white h-8 w-8"
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
