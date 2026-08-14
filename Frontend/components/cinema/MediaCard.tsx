"use client"

import { useMemo, useState } from "react"
import {
  Play,
  Star,
  Heart,
  CheckCircle2,
  BookmarkPlus,
  PauseCircle,
  XCircle,
  Clock,
  Film,
  Tv,
  Sparkles,
  Clapperboard,
  Layers,
  FileVideo,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

import type { MediaItem, MediaState } from "@/lib/cinema-types"

function posterUrl(media: MediaItem, kind: "poster" | "backdrop" = "poster") {
  if (!media.poster && kind === "poster") return null
  if (!media.backdrop && kind === "backdrop") return null
  const name = kind === "poster" ? media.poster : media.backdrop
  if (!name) return null
  return `/api/cinema/art/${encodeURIComponent(media.id)}?kind=${kind}&name=${encodeURIComponent(name)}`
}

function TypeIcon({ type, className }: { type: MediaItem["type"]; className?: string }) {
  if (type === "series") return <Tv className={className} />
  if (type === "animation") return <Sparkles className={className} />
  if (type === "documentary") return <Clapperboard className={className} />
  if (type === "short") return <Layers className={className} />
  return <Film className={className} />
}

const TYPE_LABEL: Record<MediaItem["type"], string> = {
  movie: "Movie",
  series: "Series",
  animation: "Animation",
  documentary: "Documentary",
  short: "Short",
  other: "Other",
}

function statusBadge(state?: MediaState) {
  if (!state) return null
  if (state.favorite) {
    return { icon: Heart, label: "Favorite", className: "bg-rose-500/90 text-white" }
  }
  switch (state.status) {
    case "watching":
      return { icon: PauseCircle, label: "Watching", className: "bg-emerald-500/90 text-white" }
    case "completed":
      return { icon: CheckCircle2, label: "Completed", className: "bg-blue-500/90 text-white" }
    case "dropped":
      return { icon: XCircle, label: "Dropped", className: "bg-zinc-700/90 text-white" }
    case "plan":
      return { icon: BookmarkPlus, label: "Watch later", className: "bg-amber-500/90 text-white" }
    default:
      return null
  }
}

function progressPercent(state?: MediaState): number | null {
  if (!state || !state.progress || !state.duration) return null
  const pct = (state.progress / state.duration) * 100
  if (pct < 2 || pct > 98) return null
  return Math.min(100, Math.max(0, pct))
}

function fileCount(media: MediaItem): number {
  if (media.seasons) {
    return media.seasons.reduce((sum, s) => sum + s.episodes.length, 0)
  }
  return media.files.length
}

function codecBadge(media: MediaItem): string | null {
  const all = media.seasons
    ? media.seasons.flatMap((s) => s.episodes)
    : media.files
  for (const f of all) {
    if (f.browserFriendly === false) {
      const codec = f.videoCodec?.toUpperCase()
      if (codec === "HEVC" || codec === "VP9") {
        return codec === "HEVC" && (f.pixelFormat ?? "").endsWith("10le")
          ? "HEVC 10-bit"
          : codec
      }
    }
  }
  return null
}

function durationLabel(media: MediaItem): string | null {
  if (media.runtime) return `${media.runtime} min`
  if (media.seasons) {
    const eps = media.seasons.reduce((sum, s) => sum + s.episodes.length, 0)
    const seasons = media.seasons.length
    return `${seasons} season${seasons === 1 ? "" : "s"} · ${eps} ep`
  }
  return null
}

export interface MediaCardProps {
  media: MediaItem
  state?: MediaState
  onOpen?: () => void
  onPlay?: () => void
  variant?: "grid" | "list"
  className?: string
}

export default function MediaCard({
  media,
  state,
  onOpen,
  onPlay,
  variant = "grid",
  className,
}: MediaCardProps) {
  const poster = useMemo(() => posterUrl(media, "poster"), [media])
  const backdrop = useMemo(() => posterUrl(media, "backdrop"), [media])
  const badge = useMemo(() => statusBadge(state), [state])
  const progress = useMemo(() => progressPercent(state), [state])
  const files = fileCount(media)
  const duration = durationLabel(media)
  const codec = useMemo(() => codecBadge(media), [media])

  const [imgFailed, setImgFailed] = useState(false)
  const showPoster = poster && !imgFailed

  if (variant === "list") {
    return (
      <button
        onClick={onOpen}
        className={cn(
          "w-full text-left flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors group",
          className
        )}
      >
        <div className="relative w-12 h-16 shrink-0 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-900">
          {showPoster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt={media.title}
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <TypeIcon type={media.type} className="w-4 h-4 text-zinc-400" />
            </div>
          )}
          {progress !== null && (
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-white/30">
              <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{media.title}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
            <TypeIcon type={media.type} className="w-3 h-3" />
            <span>{TYPE_LABEL[media.type]}</span>
            {media.year ? <span>· {media.year}</span> : null}
            {duration ? <span>· {duration}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {typeof state?.rating === "number" && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-500">
              <Star className="w-3 h-3 fill-current" />
              {state.rating.toFixed(1)}
            </span>
          )}
          {onPlay && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation()
                onPlay()
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Play"
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </button>
    )
  }

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group/card relative cursor-pointer rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 hover:ring-zinc-300 dark:hover:ring-zinc-700 shadow-md shadow-black/10 dark:shadow-black/40 hover:shadow-xl hover:shadow-black/20 dark:hover:shadow-black/60 transition-all",
        className
      )}
    >
      <div className="relative aspect-[2/3] overflow-hidden">
        {showPoster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster}
            alt={media.title}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105"
          />
        ) : backdrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdrop}
            alt={media.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-800 dark:to-zinc-900 text-zinc-500">
            <TypeIcon type={media.type} className="w-10 h-10 mb-2" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">
              {TYPE_LABEL[media.type]}
            </span>
          </div>
        )}

        {/* Top-left type badge */}
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium text-white">
          <TypeIcon type={media.type} className="w-3 h-3" />
          {TYPE_LABEL[media.type]}
        </div>

        {/* Top-right status badge */}
        {badge && (
          <div
            className={cn(
              "absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium",
              badge.className
            )}
          >
            <badge.icon className="w-3 h-3" />
            {badge.label}
          </div>
        )}

        {/* Codec chip below the type badge */}
        {codec && (
          <div className="absolute top-9 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-900/80 text-amber-300 text-[10px] font-mono">
            {codec}
          </div>
        )}

        {/* Hover overlay with play button */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200">
          <div className="absolute inset-0 flex items-center justify-center">
            {onPlay && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay()
                }}
                className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center text-white hover:bg-white/25 transition-colors"
                aria-label="Play"
              >
                <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom progress bar */}
        {progress !== null && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/40">
            <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-1">
        <h3 className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate leading-tight">
          {media.title}
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
          {media.year && <span>{media.year}</span>}
          {duration && (
            <>
              {media.year && <span className="text-zinc-300 dark:text-zinc-700">·</span>}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {duration}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {files > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                <FileVideo className="w-3 h-3" /> {files}
              </span>
            )}
          </div>
          {typeof state?.rating === "number" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500">
              <Star className="w-3 h-3 fill-current" />
              {state.rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}