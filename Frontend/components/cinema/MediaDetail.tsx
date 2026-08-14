"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Play,
  Star,
  Heart,
  X,
  Calendar,
  Clock,
  User,
  Clapperboard,
  FileVideo,
  Plus,
  Minus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  BookmarkPlus,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Tag,
  PlusCircle,
  ImageOff,
  Tv,
  Sparkles,
  ImagePlus,
  Trash2,
  Upload,
  Loader2,
  Film,
  Cpu,
  HardDriveDownload,
  Images,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import type {
  Collection,
  Episode,
  MediaFile,
  MediaItem,
  MediaState,
  PlayableFile,
  Season,
  ScreenshotEntry,
  WatchStatus,
} from "@/lib/cinema-types"
import { STATUS_LABEL, STATUS_OPTIONS } from "@/lib/cinema-storage"

import CinemaPlayer from "./CinemaPlayer"

// Every backend call goes through the Next.js rewrite proxy (see
// `next.config.ts`), so relative URLs are always safe — no port, no
// CORS gymnastics.
//
// ``artUrl`` takes an optional ``version`` so the UI can bust the
// browser's image cache immediately after a poster/backdrop upload
// (otherwise the new image only shows after a hard refresh, even
// though the backend now serves Cache-Control: no-cache).
function artUrl(
  media: MediaItem,
  kind: "poster" | "backdrop",
  name?: string | null,
  version?: number | null
) {
  const file = name ?? (kind === "poster" ? media.poster : media.backdrop)
  if (!file) return null
  const params = new URLSearchParams({ kind, name: file })
  if (version) params.set("v", String(version))
  return `/api/cinema/art/${encodeURIComponent(media.id)}?${params.toString()}`
}

function durationLabel(media: MediaItem) {
  if (media.runtime) return `${media.runtime} min`
  if (media.seasons) {
    const eps = media.seasons.reduce((sum, s) => sum + s.episodes.length, 0)
    return `${media.seasons.length} season${media.seasons.length === 1 ? "" : "s"} · ${eps} ep`
  }
  return null
}

function fileCount(media: MediaItem) {
  if (media.seasons) return media.seasons.reduce((sum, s) => sum + s.episodes.length, 0)
  return media.files.length
}

const STATUS_ICON: Record<WatchStatus, React.ComponentType<{ className?: string }>> = {
  none: BookmarkPlus,
  plan: BookmarkPlus,
  watching: PauseCircle,
  completed: CheckCircle2,
  dropped: XCircle,
}

function buildPlayableQueue(media: MediaItem): PlayableFile[] {
  const out: PlayableFile[] = []
  if (media.seasons && media.seasons.length) {
    media.seasons.forEach((s) => {
      s.episodes.forEach((ep) => {
        out.push(episodeToPlayable(media, s, ep))
      })
    })
    return out
  }
  media.files.forEach((f, i) => {
    out.push(fileToPlayable(media, f, i))
  })
  return out
}

function fileToPlayable(media: MediaItem, file: MediaFile, index: number): PlayableFile {
  return {
    id: file.id,
    title: file.filename,
    mediaId: media.id,
    filePath: file.path,
    subtitles: file.subtitles,
    duration: undefined,
    isEpisode: false,
    episodeNumber: index + 1,
    browserFriendly: file.browserFriendly,
    videoCodec: file.videoCodec ?? null,
    playbackStrategy: file.playbackStrategy,
  }
}

function episodeToPlayable(media: MediaItem, season: Season, ep: Episode): PlayableFile {
  return {
    id: ep.id,
    title: `S${String(season.number).padStart(2, "0")}E${String(ep.number).padStart(2, "0")} · ${ep.title}`,
    mediaId: media.id,
    filePath: ep.path,
    subtitles: ep.subtitles,
    duration: undefined,
    isEpisode: true,
    seasonNumber: season.number,
    episodeNumber: ep.number,
    browserFriendly: ep.browserFriendly,
    videoCodec: ep.videoCodec ?? null,
    playbackStrategy: ep.playbackStrategy,
  }
}

export interface MediaDetailProps {
  media: MediaItem
  state?: MediaState
  collections: Collection[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Save state changes (status, rating, review, notes, tags, favorite, rewatchCount, etc.) */
  onStateChange: (mediaId: string, patch: Partial<MediaState>) => void
  /** Toggle a media's membership in a collection (for the dropdown). */
  onToggleCollection: (collectionId: string, mediaId: string) => void
  /** Create a new collection. */
  onCreateCollection: (name: string) => void
  /** Remove a collection. */
  onDeleteCollection: (id: string) => void
  /** If true, the player opens immediately when the dialog opens. */
  autoPlay?: boolean
  /** Reload the library (e.g. after a poster upload so the new art shows up). */
  onRefresh?: () => void
}

export default function MediaDetail({
  media,
  state,
  collections,
  open,
  onOpenChange,
  onStateChange,
  onToggleCollection,
  onCreateCollection,
  onDeleteCollection,
  autoPlay = false,
  onRefresh,
}: MediaDetailProps) {
  const queue = useMemo(() => buildPlayableQueue(media), [media])

  const initialIndex = useMemo(() => {
    if (!queue.length) return -1
    const resumeId = state?.resumeFileId
    if (resumeId) {
      const idx = queue.findIndex((p) => p.id === resumeId)
      if (idx >= 0) return idx
    }
    // If we have progress but no resumeFileId, resume from first playable.
    return 0
  }, [queue, state?.resumeFileId])

  const [activeIndex, setActiveIndex] = useState<number>(initialIndex)
  const [playerOpen, setPlayerOpen] = useState<boolean>(autoPlay)
  const [posterFailed, setPosterFailed] = useState(false)
  const [backdropFailed, setBackdropFailed] = useState(false)
  /**
   * Cache-bust timestamps for the poster / backdrop. The backend serves
   * `Cache-Control: no-cache` but the browser still keeps the rendered
   * `<img>` element's bitmap in memory; bumping this version forces
   * React to swap the src, the browser to re-fetch, and the user sees
   * the new poster/backdrop immediately after upload.
   */
  const [posterVersion, setPosterVersion] = useState<number>(0)
  const [backdropVersion, setBackdropVersion] = useState<number>(0)

  // Re-sync activeIndex when the queue changes (different media opened).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(Math.max(0, initialIndex))
    setPlayerOpen(autoPlay)
    setPosterFailed(false)
    setBackdropFailed(false)
    setPosterVersion(0)
    setBackdropVersion(0)
  }, [initialIndex, media.id, autoPlay])

  const active = activeIndex >= 0 && activeIndex < queue.length ? queue[activeIndex] : null

  const handlePlay = useCallback(
    (index: number) => {
      setActiveIndex(index)
      setPlayerOpen(true)
    },
    []
  )

  const handleNext = useCallback(() => {
    setActiveIndex((i) => (i + 1 < queue.length ? i + 1 : i))
  }, [queue.length])

  const handlePrevious = useCallback(() => {
    setActiveIndex((i) => (i - 1 >= 0 ? i - 1 : 0))
  }, [])

  // Persist playback progress for the active file.
  const handleProgress = useCallback(
    (info: { fileId: string; mediaId: string; currentTime: number; duration: number }) => {
      const total = info.duration || state?.duration || 0
      const progress = info.currentTime
      if (!total || total <= 0) {
        // We still want to remember the resume file even if duration is unknown.
        onStateChange(media.id, { resumeFileId: info.fileId, lastWatchedAt: Date.now() })
        return
      }
      const finished = progress / total >= 0.95
      const patch: Partial<MediaState> = {
        progress: finished ? total : progress,
        duration: total,
        resumeFileId: info.fileId,
        lastWatchedAt: Date.now(),
      }
      if (!state?.startedAt) patch.startedAt = Date.now()
      if (finished && state?.status !== "completed") patch.status = "completed"
      onStateChange(media.id, patch)
    },
    [media.id, onStateChange, state?.duration, state?.startedAt, state?.status]
  )

  const handleEnded = useCallback(() => {
    onStateChange(media.id, {
      progress: state?.duration || 0,
      status: "completed",
      lastWatchedAt: Date.now(),
    })
    // Advance to the next file if there is one.
    setActiveIndex((i) => (i + 1 < queue.length ? i + 1 : i))
  }, [media.id, onStateChange, queue.length, state?.duration])

  // ---------------- Status / rating / review / notes / tags ----------------

  const updateField = useCallback(
    (patch: Partial<MediaState>) => {
      onStateChange(media.id, patch)
    },
    [media.id, onStateChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(96vw,1100px)] sm:max-w-3xl lg:max-w-5xl p-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 max-h-[92vh] overflow-y-auto"
      >
        <DialogTitle className="sr-only">{media.title}</DialogTitle>

        {/* Backdrop hero (video banner). 24:6 ≈ 4:1 keeps the banner
            short (2/3 of the previous 24:9 height) so the header and
            body sections stay in view at 100% zoom. `isolate` creates
            a stacking context so the gradients never bleed into the
            header below. */}
        <div className="relative w-full aspect-[24/6] overflow-hidden bg-zinc-200 dark:bg-zinc-900 group/backdrop isolate shrink-0">
          {!backdropFailed && media.backdrop ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`backdrop-${backdropVersion}`}
              src={artUrl(media, "backdrop", null, backdropVersion) ?? ""}
              alt={media.title}
              onError={() => setBackdropFailed(true)}
              className="absolute inset-0 w-full h-full object-cover [image-rendering:-webkit-optimize-contrast]"
            />
          ) : (
            <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-zinc-300 to-zinc-500 dark:from-zinc-800 dark:to-zinc-900" />
          )}
          {/* Strong gradient so the backdrop fades into the content below
              instead of cutting off abruptly at the edge. */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-zinc-50/70 to-zinc-50 dark:via-zinc-950/70 dark:to-zinc-950 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-50 dark:from-zinc-950 via-zinc-50/30 dark:via-zinc-950/30 to-transparent pointer-events-none" />

          {/* Backdrop upload overlay (mirrors the poster upload button). */}
          <BackdropUploader
            mediaId={media.id}
            hasArt={!!media.backdrop}
            onUploaded={() => {
              setBackdropVersion(Date.now())
              onRefresh?.()
            }}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="absolute top-3 right-3 z-20 bg-black/45 text-white hover:bg-black/65 hover:text-white backdrop-blur-sm"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Header block: [Poster | Title + Metadata] flowing into the
            action buttons. `flex-shrink-0` on every row keeps the header
            from being compressed when the modal hits `max-h-[92vh]`;
            `flex-1 min-w-0` on the title cell lets the title wrap
            predictably without being squashed by the poster. */}
        <div className="relative px-5 pt-3 pb-3 flex flex-col gap-3 shrink-0">
          <div className="flex gap-4 items-start shrink-0">
            <div className="relative w-24 sm:w-32 aspect-[2/3] shrink-0 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl shadow-black/30 dark:shadow-black/60 group/poster">
              {!posterFailed && media.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`poster-${posterVersion}`}
                  src={artUrl(media, "poster", null, posterVersion) ?? ""}
                  alt={media.title}
                  onError={() => setPosterFailed(true)}
                  className="w-full h-full object-cover [image-rendering:-webkit-optimize-contrast]"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                  <ImageOff className="w-6 h-6" />
                </div>
              )}
              {/* Poster upload button (overlay) */}
              <PosterUploader
                mediaId={media.id}
                hasArt={!!media.poster}
                onUploaded={() => {
                  setPosterVersion(Date.now())
                  onRefresh?.()
                }}
              />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <Badge variant="secondary" className="capitalize">{media.type}</Badge>
                {media.year && (
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="w-3 h-3" />
                    {media.year}
                  </Badge>
                )}
                {durationLabel(media) && (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="w-3 h-3" />
                    {durationLabel(media)}
                  </Badge>
                )}
                {fileCount(media) > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <FileVideo className="w-3 h-3" />
                    {fileCount(media)} file{fileCount(media) === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight">
                {media.title}
              </h2>
              {media.originalTitle && media.originalTitle !== media.title && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                  {media.originalTitle}
                </p>
              )}
            </div>
          </div>

          {/* Action row: `relative` establishes a clipping boundary so
              dropdown carets/SVGs can never escape the button bounds
              upward into the backdrop. `flex flex-wrap` keeps wraps
              tidy without resorting to absolute positioning, and
              `shrink-0` guarantees this row is never clipped by the
              dialog's `max-h-[92vh] overflow-y-auto` ceiling. */}
          <div className="relative flex flex-wrap items-center gap-2 shrink-0">
            <WatchlistToggle
              active={state?.status === "plan"}
              onChange={(on) => updateField({ status: on ? "plan" : "none" })}
            />
            <WatchingToggle
              active={state?.status === "watching"}
              onChange={(on) => updateField({ status: on ? "watching" : "none" })}
            />
            <MarkWatchedToggle
              active={state?.status === "completed"}
              onToggle={() => {
                const cur = state?.status ?? "none"
                updateField({ status: cur === "completed" ? "none" : "completed" })
              }}
            />
            <FavoriteToggle
              active={!!state?.favorite}
              onChange={(v) => updateField({ favorite: v })}
            />
            <StatusPicker
              value={state?.status ?? "none"}
              onChange={(v) => updateField({ status: v })}
            />
            <CollectionPicker
              collections={collections}
              mediaId={media.id}
              onToggle={onToggleCollection}
              onCreate={onCreateCollection}
              onDelete={onDeleteCollection}
            />
          </div>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {/* Player slot: when the user picks a file from the Files
              section, the player swaps in here. No more "Play now" banner
              sitting in this slot in the dark theme. */}
          {playerOpen && active && (
            <div className="rounded-xl overflow-hidden bg-black aspect-video ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-md shadow-black/20 dark:shadow-black/40">
              <CinemaPlayer
                key={active.filePath}
                mediaId={media.id}
                filePath={active.filePath}
                fileId={active.id}
                subtitles={active.subtitles}
                poster={artUrl(media, "poster", null, posterVersion) ?? undefined}
                initialProgress={state?.resumeFileId === active.id ? state.progress || 0 : 0}
                initialDuration={state?.duration || 0}
                showCloseButton
                onClose={() => setPlayerOpen(false)}
                onProgress={handleProgress}
                onEnded={handleEnded}
                onNext={activeIndex + 1 < queue.length ? handleNext : undefined}
                onPrevious={activeIndex > 0 ? handlePrevious : undefined}
              />
            </div>
          )}

          {/* Artwork (poster / backdrop upload). Placed right after the
              player slot so it's the first scrollable section below the
              header and stays visible at 100% zoom. */}
          <ArtManager
            mediaId={media.id}
            hasPoster={!!media.poster}
            hasBackdrop={!!media.backdrop}
            onUploaded={onRefresh}
          />

          {/* Synopsis */}
          {media.synopsis && (
            <Section title="Synopsis" icon={Clapperboard}>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                {media.synopsis}
              </p>
            </Section>
          )}

          {/* Compatibility (one-click MKV → MP4 conversion) */}
          <ConvertManager
            mediaId={media.id}
            files={playableFilesForConvert(media)}
            onConverted={onRefresh}
          />

          {/* Screenshots gallery */}
          <ScreenshotsManager
            mediaId={media.id}
            screenshots={media.screenshots ?? []}
            onChanged={onRefresh}
          />

          {/* Meta grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {media.director && (
              <MetaCell icon={User} label="Director" value={media.director} />
            )}
            {media.genres.length > 0 && (
              <MetaCell
                icon={Tag}
                label="Genres"
                value={media.genres.join(", ")}
              />
            )}
            {media.cast.length > 0 && (
              <MetaCell
                icon={User}
                label="Cast"
                value={media.cast.slice(0, 3).join(", ") + (media.cast.length > 3 ? "…" : "")}
              />
            )}
            {media.rating != null && (
              <MetaCell
                icon={Star}
                label="Community"
                value={`${media.rating.toFixed(1)} / 10`}
              />
            )}
          </div>

          {/* Files / seasons */}
          {media.seasons ? (
            <SeasonList
              media={media}
              onPlay={handlePlay}
              activeFileId={active?.id ?? null}
            />
          ) : media.files.length > 0 ? (
            <FileList
              files={media.files}
              onPlay={(i) => handlePlay(i)}
              activeFileId={active?.id ?? null}
            />
          ) : null}

          {/* Trailer */}
          {media.trailer && (
            <Section title="Trailer" icon={Play}>
              <a
                href={media.trailer}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-primary hover:underline break-all"
              >
                {media.trailer}
              </a>
            </Section>
          )}

          {/* Personal */}
          <Section title="Your rating" icon={Star}>
            <RatingPicker
              value={state?.rating ?? null}
              onChange={(v) => updateField({ rating: v })}
            />
          </Section>

          {/* Watch status lives in the header action bar via StatusPicker,
              so this section only carries the rewatch counter to avoid
              duplicating the same five status buttons. */}
          <Section title="Rewatched" icon={BookmarkPlus}>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Count</span>
              <Button
                size="icon-xs"
                variant="outline"
                onClick={() =>
                  updateField({ rewatchCount: Math.max(0, (state?.rewatchCount ?? 0) - 1) })
                }
                aria-label="Decrement rewatch count"
              >
                <Minus className="w-3 h-3" />
              </Button>
              <span className="w-6 text-center tabular-nums">{state?.rewatchCount ?? 0}</span>
              <Button
                size="icon-xs"
                variant="outline"
                onClick={() => updateField({ rewatchCount: (state?.rewatchCount ?? 0) + 1 })}
                aria-label="Increment rewatch count"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </Section>

          <Section title="Review" icon={Clapperboard}>
            <Textarea
              value={state?.review ?? ""}
              onChange={(v) => updateField({ review: v })}
              placeholder="What did you think?"
              rows={4}
            />
          </Section>

          <Section title="Notes" icon={Tag}>
            <Textarea
              value={state?.notes ?? ""}
              onChange={(v) => updateField({ notes: v })}
              placeholder="Cold open at 00:32:14…"
              rows={3}
            />
          </Section>

          <Section title="Tags" icon={Tag}>
            <TagInput
              values={state?.tags ?? []}
              onChange={(v) => updateField({ tags: v })}
              placeholder="mind-bending, slow-burn…"
            />
          </Section>

          <Section title="Moods" icon={Sparkles}>
            <TagInput
              values={state?.moods ?? []}
              onChange={(v) => updateField({ moods: v })}
              placeholder="late-night, focus, rain…"
            />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ----------------- Sub-components -----------------

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function MetaCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-xs text-zinc-900 dark:text-zinc-100 mt-1 line-clamp-2">
        {value}
      </div>
    </div>
  )
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-y"
    />
  )
}

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")
  function commit() {
    const t = draft.trim()
    if (!t) return
    if (values.includes(t)) {
      setDraft("")
      return
    }
    onChange([...values, t])
    setDraft("")
  }
  function remove(t: string) {
    onChange(values.filter((x) => x !== t))
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && (
          <span className="text-xs text-zinc-400">No tags yet</span>
        )}
        {values.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-1">
            {t}
            <button
              onClick={() => remove(t)}
              className="ml-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              aria-label={`Remove ${t}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              commit()
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
        <Button size="sm" variant="outline" onClick={commit} className="h-7 px-2">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  )
}

function RatingPicker({
  value,
  onChange,
}: {
  value: number | null | undefined
  onChange: (v: number | null) => void
}) {
  const stars = useMemo(() => Array.from({ length: 10 }, (_, i) => i + 1), [])
  const [hover, setHover] = useState<number | null>(null)
  const display = hover ?? value ?? 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        {stars.map((s) => {
          const filled = display >= s
          return (
            <button
              key={s}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onChange(value === s ? null : s)}
              className="p-0.5"
              aria-label={`${s} out of 10`}
            >
              <Star
                className={cn(
                  "w-4 h-4 transition-colors",
                  filled
                    ? "fill-amber-400 text-amber-400"
                    : "text-zinc-300 dark:text-zinc-700"
                )}
              />
            </button>
          )
        })}
      </div>
      <span className="text-xs tabular-nums text-zinc-500 w-10 text-right">
        {value != null ? `${value.toFixed(1)}/10` : "—"}
      </span>
      {value != null && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onChange(null)}
          className="text-zinc-500"
        >
          Clear
        </Button>
      )}
    </div>
  )
}

function FavoriteToggle({
  active,
  onChange,
}: {
  active: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => onChange(!active)}
      aria-label={active ? "Unfavorite" : "Favorite"}
      className={cn(active && "text-rose-500 border-rose-300 dark:border-rose-800")}
    >
      <Heart className={cn("w-4 h-4", active && "fill-current")} />
    </Button>
  )
}

function WatchlistToggle({
  active,
  onChange,
}: {
  active: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onChange(!active)}
      aria-label={active ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(
        "gap-1.5 h-8",
        active && "text-amber-600 border-amber-300 dark:text-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20"
      )}
    >
      <BookmarkPlus className={cn("w-3.5 h-3.5", active && "fill-current")} />
      {active ? "On watchlist" : "Watchlist"}
    </Button>
  )
}

function WatchingToggle({
  active,
  onChange,
}: {
  active: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onChange(!active)}
      aria-label={active ? "Stop watching" : "Mark as watching"}
      className={cn(
        "gap-1.5 h-8",
        active && "text-emerald-600 border-emerald-300 dark:text-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
      )}
    >
      <PauseCircle className={cn("w-3.5 h-3.5", active && "fill-current")} />
      {active ? "Watching" : "Mark watching"}
    </Button>
  )
}

function MarkWatchedToggle({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      aria-label={active ? "Mark as unwatched" : "Mark as watched"}
      className={cn(
        "gap-1.5 h-8",
        active && "text-blue-600 border-blue-300 dark:text-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
      )}
    >
      <CheckCircle2 className={cn("w-3.5 h-3.5", active && "fill-current")} />
      {active ? "Watched" : "Mark watched"}
    </Button>
  )
}

function StatusPicker({
  value,
  onChange,
}: {
  value: WatchStatus
  onChange: (v: WatchStatus) => void
}) {
  const Icon = STATUS_ICON[value]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <Icon className="w-3.5 h-3.5" />
          {STATUS_LABEL[value]}
          <ChevronDown className="w-3 h-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel className="text-xs">Watch status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_OPTIONS.map((opt) => {
          const I = STATUS_ICON[opt]
          return (
            <DropdownMenuItem
              key={opt}
              onSelect={() => onChange(opt)}
              className={cn(value === opt && "text-primary")}
            >
              <I className="w-3.5 h-3.5" />
              {STATUS_LABEL[opt]}
              {value === opt && <Check className="w-3 h-3 ml-auto" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CollectionPicker({
  collections,
  mediaId,
  onToggle,
  onCreate,
  onDelete,
}: {
  collections: Collection[]
  mediaId: string
  onToggle: (id: string, mediaId: string) => void
  onCreate: (name: string) => void
  onDelete: (id: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <PlusCircle className="w-3.5 h-3.5" />
          Collection
          <ChevronDown className="w-3 h-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs">Add to collection</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {collections.length === 0 && !creating && (
          <div className="px-2 py-1.5 text-xs text-zinc-500">No collections yet</div>
        )}
        {collections.map((c) => {
          const inCol = c.mediaIds.includes(mediaId)
          return (
            <DropdownMenuItem
              key={c.id}
              onSelect={(e) => {
                e.preventDefault()
                onToggle(c.id, mediaId)
              }}
            >
              {inCol ? (
                <Check className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-[10px] text-zinc-500">
                {c.mediaIds.length}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="px-2 py-1.5 space-y-1.5">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name"
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onCreate(name.trim())
                  setName("")
                  setCreating(false)
                } else if (e.key === "Escape") {
                  setCreating(false)
                  setName("")
                }
              }}
            />
            <div className="flex gap-1.5">
              <Button
                size="xs"
                onClick={() => {
                  if (name.trim()) {
                    onCreate(name.trim())
                    setName("")
                    setCreating(false)
                  }
                }}
              >
                Create
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setCreating(false)
                  setName("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCreating(true) }}>
            <PlusCircle className="w-3.5 h-3.5" />
            New collection
          </DropdownMenuItem>
        )}
        {collections.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Manage</DropdownMenuLabel>
            {collections.map((c) => (
              <DropdownMenuItem
                key={c.id}
                variant="destructive"
                onSelect={() => onDelete(c.id)}
              >
                <X className="w-3.5 h-3.5" />
                Delete &quot;{c.name}&quot;
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FileList({
  files,
  onPlay,
  activeFileId,
}: {
  files: MediaFile[]
  onPlay: (index: number) => void
  activeFileId: string | null
}) {
  return (
    <Section title="Files" icon={FileVideo}>
      <ul className="space-y-1">
        {files.map((f, i) => (
          <li key={f.id}>
            <button
              onClick={() => onPlay(i)}
              className={cn(
                "w-full flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors",
                "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                activeFileId === f.id
                  ? "border-primary/50 bg-primary/5"
                  : "border-zinc-200 dark:border-zinc-800"
              )}
            >
              <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0">
                <FileVideo className="w-3.5 h-3.5 text-zinc-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{f.filename}</p>
                <p className="text-[10px] text-zinc-500">
                  {f.size} · .{f.ext} · {f.subtitles.length} subtitle{f.subtitles.length === 1 ? "" : "s"}
                </p>
              </div>
              <Play className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function SeasonList({
  media,
  onPlay,
  activeFileId,
}: {
  media: MediaItem
  onPlay: (index: number) => void
  activeFileId: string | null
}) {
  if (!media.seasons) return null

  return (
    <Section title="Seasons" icon={Tv}>
      <div className="space-y-3">
        {media.seasons.map((s) => (
          <details
            key={s.number}
            open={s.number === 1}
            className="rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="px-3 py-2 cursor-pointer text-xs font-medium flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 rounded-md">
              <ChevronDown className="w-3.5 h-3.5 transition-transform [[open]_&]:rotate-0 rotate-[-90deg]" />
              {s.title} · {s.episodes.length} ep
            </summary>
            <ul className="px-2 pb-2 space-y-1">
              {s.episodes.map((ep) => {
                // Resolve flat index in queue.
                const idx = globalIndex(media, s.number, ep.id)
                const active = activeFileId === ep.id
                return (
                  <li key={ep.id}>
                    <button
                      onClick={() => onPlay(idx)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors",
                        "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        active && "bg-primary/5 ring-1 ring-primary/40"
                      )}
                    >
                      <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-[10px] tabular-nums text-zinc-500 shrink-0">
                        {String(ep.number).padStart(2, "0")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{ep.title}</p>
                        <p className="text-[10px] text-zinc-500">
                          {ep.size} · .{ep.ext} · {ep.subtitles.length} sub
                        </p>
                      </div>
                      <Play className="w-3.5 h-3.5 text-zinc-400" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </div>
    </Section>
  )
}

function globalIndex(media: MediaItem, seasonNumber: number, episodeId: string) {
  if (!media.seasons) return -1
  let i = 0
  for (const s of media.seasons) {
    for (const ep of s.episodes) {
      if (s.number === seasonNumber && ep.id === episodeId) return i
      i++
    }
  }
  return -1
}

function ArtManager({
  mediaId,
  hasPoster,
  hasBackdrop,
  onUploaded,
}: {
  mediaId: string
  hasPoster: boolean
  hasBackdrop: boolean
  onUploaded?: () => void
}) {
  const posterInputRef = useRef<HTMLInputElement | null>(null)
  const backdropInputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<"poster" | "backdrop" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(kind: "poster" | "backdrop", file: File) {
    setError(null)
    setBusy(kind)
    try {
      const fd = new FormData()
      fd.set("kind", kind)
      fd.set("file", file)
      const res = await fetch(
        `/api/cinema/art/${encodeURIComponent(mediaId)}`,
        { method: "POST", body: fd }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed (${res.status})`)
      }
      onUploaded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(null)
      if (kind === "poster" && posterInputRef.current) {
        posterInputRef.current.value = ""
      }
      if (kind === "backdrop" && backdropInputRef.current) {
        backdropInputRef.current.value = ""
      }
    }
  }

  async function handleRemove(kind: "poster" | "backdrop") {
    setError(null)
    setBusy(kind)
    try {
      const res = await fetch(
        `/api/cinema/art/${encodeURIComponent(mediaId)}?kind=${kind}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Delete failed (${res.status})`)
      }
      onUploaded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Artwork" icon={ImagePlus}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ArtSlot
          label="Poster"
          has={hasPoster}
          busy={busy === "poster"}
          inputRef={posterInputRef}
          onPick={(f) => handleUpload("poster", f)}
          onClear={() => handleRemove("poster")}
        />
        <ArtSlot
          label="Backdrop"
          has={hasBackdrop}
          busy={busy === "backdrop"}
          inputRef={backdropInputRef}
          onPick={(f) => handleUpload("backdrop", f)}
          onClear={() => handleRemove("backdrop")}
        />
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
        JPEG / PNG / WebP. Posters save as <code>poster.&lt;ext&gt;</code> and
        backdrops as <code>backdrop.&lt;ext&gt;</code> inside the media folder.
      </p>
      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
          {error}
        </p>
      )}
    </Section>
  )
}

function PosterUploader({
  mediaId,
  hasArt,
  onUploaded,
}: {
  mediaId: string
  hasArt: boolean
  onUploaded?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set("kind", "poster")
      fd.set("file", file)
      const res = await fetch(
        `/api/cinema/art/${encodeURIComponent(mediaId)}`,
        { method: "POST", body: fd }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed (${res.status})`)
      }
      onUploaded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={hasArt ? "Replace poster" : "Upload poster"}
        title={error ?? (hasArt ? "Replace poster" : "Upload poster")}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/0 hover:bg-black/45 text-white opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Upload className="w-5 h-5" />
        )}
        <span className="text-[10px] font-medium">
          {hasArt ? "Replace" : "Upload"}
        </span>
      </button>
    </>
  )
}

function BackdropUploader({
  mediaId,
  hasArt,
  onUploaded,
}: {
  mediaId: string
  hasArt: boolean
  onUploaded?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set("kind", "backdrop")
      fd.set("file", file)
      const res = await fetch(
        `/api/cinema/art/${encodeURIComponent(mediaId)}`,
        { method: "POST", body: fd }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed (${res.status})`)
      }
      onUploaded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={hasArt ? "Replace backdrop" : "Upload backdrop"}
        title={error ?? (hasArt ? "Replace backdrop" : "Upload backdrop")}
        className="absolute bottom-3 left-3 z-20 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-black/45 text-white hover:bg-black/65 hover:text-white backdrop-blur-sm opacity-0 group-hover/backdrop:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        <span className="text-xs font-medium">
          {hasArt ? "Replace" : "Upload backdrop"}
        </span>
      </button>
    </>
  )
}

function ArtSlot({
  label,
  has,
  busy,
  inputRef,
  onPick,
  onClear,
}: {
  label: string
  has: boolean
  busy: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: (file: File) => void
  onClear: () => void
}) {
  return (
    <div className="rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-zinc-500">
          {has ? "Uploaded" : "Not set"}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="gap-1.5"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        {has ? "Replace" : "Upload"}
      </Button>
      {has && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClear}
          disabled={busy}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="text-zinc-500 hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screenshots gallery
// ---------------------------------------------------------------------------
//
// Users can drop screenshots next to their video (or upload them from the
// UI). The scanner picks them up on the next library refresh and the modal
// shows them as a small grid. Drop multiple files at once; each gets the
// next free ``screenshot-N`` index so existing ones are never overwritten.

/** Per-media screenshot cap. The backend enforces this authoritatively. */
const MAX_SCREENSHOTS = 6

function ScreenshotTile({
  shot,
  onRemove,
  busy,
  onPreview,
}: {
  shot: ScreenshotEntry
  onRemove: (name: string) => void | Promise<void>
  busy: boolean
  onPreview: (shot: ScreenshotEntry) => void
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="group/shot relative aspect-video rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shot.url}
          alt={shot.name}
          onError={() => setFailed(true)}
          onClick={() => onPreview(shot)}
          className="w-full h-full object-cover [image-rendering:-webkit-optimize-contrast] transition-transform duration-300 group-hover/shot:scale-105 cursor-zoom-in"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onPreview(shot)
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">
          ?
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover/shot:opacity-100 transition-opacity">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-white truncate">{shot.name}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(shot.name)
            }}
            disabled={busy}
            aria-label={`Remove ${shot.name}`}
            title="Remove screenshot"
            className="h-5 w-5 text-white hover:text-rose-300 hover:bg-white/10"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ScreenshotLightbox({
  shots,
  index,
  open,
  onOpenChange,
  onIndexChange,
}: {
  shots: ScreenshotEntry[]
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (i: number) => void
}) {
  const shot = shots[index]
  const hasPrev = index > 0
  const hasNext = index < shots.length - 1

  const goPrev = useCallback(() => {
    if (hasPrev) onIndexChange(index - 1)
  }, [hasPrev, index, onIndexChange])
  const goNext = useCallback(() => {
    if (hasNext) onIndexChange(index + 1)
  }, [hasNext, index, onIndexChange])

  // Keyboard nav: ←/→ to step, Esc closes (Radix handles Esc via onOpenChange).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        goPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, goPrev, goNext])

  if (!shot) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(96vw,1400px)] max-w-none sm:max-w-none p-0 overflow-hidden bg-black/95 border-0 text-white max-h-[96vh]"
      >
        <DialogTitle className="sr-only">{shot.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Screenshot {index + 1} of {shots.length}: {shot.name}
        </DialogDescription>
        <div className="relative flex items-center justify-center min-h-[60vh] max-h-[88vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.url}
            alt={shot.name}
            className="max-h-[88vh] max-w-full w-auto h-auto object-contain select-none"
            draggable={false}
          />
          {/* Close */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close preview"
            className="absolute top-3 right-3 text-white/80 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </Button>
          {/* Prev / Next */}
          {shots.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={goPrev}
                disabled={!hasPrev}
                aria-label="Previous screenshot"
                className="absolute left-2 top-1/2 -translate-y-1/2 text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={goNext}
                disabled={!hasNext}
                aria-label="Next screenshot"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-xs text-white/70 border-t border-white/10">
          <span className="truncate">{shot.name}</span>
          <span>
            {index + 1} / {shots.length}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ScreenshotsManager({
  mediaId,
  screenshots,
  onChanged,
}: {
  mediaId: string
  screenshots: ScreenshotEntry[]
  onChanged?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const atLimit = screenshots.length >= MAX_SCREENSHOTS
  const openPreview = useCallback((shot: ScreenshotEntry) => {
    const i = screenshots.findIndex((s) => s.name === shot.name)
    if (i >= 0) setPreviewIndex(i)
  }, [screenshots])
  const closePreview = useCallback(() => setPreviewIndex(null), [])
  // Clamp the lightbox index into range if the screenshot list shrinks
  // (e.g. a delete while the lightbox is open). Derived during render
  // so we don't trigger a cascading setState from an effect.
  const safePreviewIndex =
    previewIndex !== null && previewIndex < screenshots.length
      ? previewIndex
      : previewIndex !== null
        ? screenshots.length - 1
        : null
  const effectivePreviewOpen = safePreviewIndex !== null

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    setError(null)
    const slots = Math.max(0, MAX_SCREENSHOTS - screenshots.length)
    const accepted = slots > 0 ? files.slice(0, slots) : []
    const skipped = files.length - accepted.length
    if (!accepted.length) {
      setError(`Maximum of ${MAX_SCREENSHOTS} screenshots per media item.`)
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      for (const f of accepted) fd.append("files", f)
      const res = await fetch(
        `/api/cinema/screenshots/${encodeURIComponent(mediaId)}`,
        { method: "POST", body: fd }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed (${res.status})`)
      }
      if (skipped > 0) {
        setError(
          `Only ${accepted.length} of ${files.length} uploaded — ${MAX_SCREENSHOTS}-screenshot limit reached.`
        )
      }
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleRemove(name: string) {
    setError(null)
    setBusyName(name)
    try {
      const res = await fetch(
        `/api/cinema/screenshots/${encodeURIComponent(mediaId)}?name=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Delete failed (${res.status})`)
      }
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusyName(null)
    }
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter((f) =>
      /\.(jpe?g|png|webp)$/i.test(f.name)
    )
    if (files.length) void uploadFiles(files)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
      /\.(jpe?g|png|webp)$/i.test(f.name)
    )
    if (files.length) void uploadFiles(files)
  }

  return (
    <Section title="Screenshots" icon={Images}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handlePick}
      />
      <div
        onDragOver={(e) => {
          if (atLimit) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg border border-dashed transition-colors p-3",
          atLimit
            ? "border-zinc-200 dark:border-zinc-800 opacity-70"
            : dragOver
              ? "border-primary bg-primary/5"
              : "border-zinc-200 dark:border-zinc-800"
        )}
      >
        {screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Images className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-2" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              Drop screenshots here, or click the button below.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Upload screenshots
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {screenshots.map((shot) => (
                <ScreenshotTile
                  key={shot.name}
                  shot={shot}
                  busy={busyName === shot.name}
                  onRemove={handleRemove}
                  onPreview={openPreview}
                />
              ))}
              {!atLimit && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="aspect-video rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors flex flex-col items-center justify-center gap-1 text-zinc-500"
                >
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ImagePlus className="w-5 h-5" />
                  )}
                  <span className="text-[10px]">Add</span>
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {screenshots.length} / {MAX_SCREENSHOTS} screenshot{screenshots.length === 1 ? "" : "s"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || atLimit}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload more
              </Button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-2">{error}</p>
      )}
      <ScreenshotLightbox
        shots={screenshots}
        index={safePreviewIndex ?? 0}
        open={effectivePreviewOpen}
        onOpenChange={(o) => {
          if (!o) closePreview()
        }}
        onIndexChange={setPreviewIndex}
      />
    </Section>
  )
}

// Transcode status / "Make playable" UI was removed: the unified
// `/api/cinema/play` endpoint and the new CinemaPlayer handle codec
// conversion transparently. The legacy `/api/cinema/transcode` endpoint
// remains for back-compat but is no longer surfaced in the UI.

// ---------------------------------------------------------------------------
// MKV → MP4 conversion UI
// ---------------------------------------------------------------------------
//
// The ConvertManager surfaces a "Convert to MP4" button per file/episode.
// The backend picks the fastest viable path (stream copy → HW H.264 →
// libx264 software) and writes a sibling ``<basename>.mp4`` next to the
// source so the next library refresh picks it up and the player serves it
// directly with zero CPU.

interface ConvertFileEntry {
  /** Stable file id used by the backend. */
  id: string
  /** Display name shown in the list. */
  filename: string
  /** Path passed to the convert endpoint as the ``file`` query arg. */
  path: string
  /** Whether the file is already browser-decodable (hides the button). */
  browserFriendly?: boolean | null
}

interface ConvertJobState {
  status:
    | "idle"
    | "queued"
    | "running"
    | "ready"
    | "error"
    | "unavailable"
    | "cancelled"
  mode?: string
  modeReason?: string
  size?: number
  sizeHuman?: string
  error?: string
  hwEncoder?: string | null
  /** Live progress (0–1). Backend carries the last known value forward so
   *  a finished conversion still shows a 100% bar until the next refresh. */
  progress?: {
    percent?: number
    outTime?: number | null
    totalSize?: number | null
    speed?: number | null
    fps?: number | null
    bitrateKbps?: number | null
    etaSeconds?: number | null
    updatedAt?: number
  }
}

function playableFilesForConvert(media: MediaItem): ConvertFileEntry[] {
  const out: ConvertFileEntry[] = []
  if (media.seasons && media.seasons.length) {
    media.seasons.forEach((s) => {
      s.episodes.forEach((ep) => {
        out.push({
          id: ep.id,
          filename: ep.filename,
          path: ep.path,
          browserFriendly: ep.browserFriendly,
        })
      })
    })
    return out
  }
  media.files.forEach((f) => {
    out.push({
      id: f.id,
      filename: f.filename,
      path: f.path,
      browserFriendly: f.browserFriendly,
    })
  })
  return out
}

const POLL_INTERVAL_MS = 2000

function ConvertFileRow({
  file,
  mediaId,
  onConverted,
}: {
  file: ConvertFileEntry
  mediaId: string
  onConverted?: () => void
}) {
  const [state, setState] = useState<ConvertJobState>({ status: "idle" })
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/cinema/convert/${encodeURIComponent(mediaId)}?file=${encodeURIComponent(file.path)}`,
        { cache: "no-store" }
      )
      if (!res.ok) {
        setState({ status: "error", error: `HTTP ${res.status}` })
        stopPolling()
        return
      }
      const data = await res.json()
      const next: ConvertJobState = {
        status: data.status ?? "idle",
        mode: data.mode,
        modeReason: data.modeReason,
        size: data.size,
        sizeHuman: data.sizeHuman,
        error: data.error,
        hwEncoder: data.hwEncoder,
        progress: data.progress,
      }
      setState(next)
      if (next.status === "ready") {
        stopPolling()
        onConverted?.()
      } else if (next.status === "error" || next.status === "unavailable" || next.status === "cancelled") {
        stopPolling()
      }
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err.message : String(err) })
      stopPolling()
    }
  }, [mediaId, file.path, onConverted, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS)
  }, [refresh, stopPolling])

  useEffect(() => {
    // Initial poll so the badge reflects an already-finished conversion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
    return () => stopPolling()
  }, [refresh, stopPolling])

  async function handleConvert() {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/cinema/convert/${encodeURIComponent(mediaId)}?file=${encodeURIComponent(file.path)}`,
        { method: "POST" }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await refresh()
      startPolling()
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await fetch(
        `/api/cinema/convert/${encodeURIComponent(mediaId)}?file=${encodeURIComponent(file.path)}`,
        { method: "DELETE" }
      )
      await refresh()
    } catch {
      // Best-effort: surface the error in the next refresh.
    } finally {
      setBusy(false)
    }
  }

  const isConverted = state.status === "ready"
  const isRunning = state.status === "running" || state.status === "queued"
  const isMp4 = file.filename.toLowerCase().endsWith(".mp4") || file.filename.toLowerCase().endsWith(".m4v")
  const alreadyFriendly = file.browserFriendly !== false && isMp4
  const progressPct = Math.max(
    0,
    Math.min(100, Math.round((state.progress?.percent ?? 0) * 100))
  )
  const showProgressBar = isRunning || isConverted

  let badge: React.ReactNode = null
  if (isRunning) {
    badge = (
      <Badge variant="secondary" className="gap-1 font-normal">
        <Loader2 className="w-3 h-3 animate-spin" />
        {state.status === "queued" ? "Queued…" : `Converting… ${progressPct}%`}
      </Badge>
    )
  } else if (isConverted) {
    badge = (
      <Badge variant="secondary" className="gap-1 font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <Check className="w-3 h-3" />
        Converted{state.sizeHuman ? ` · ${state.sizeHuman}` : ""}
      </Badge>
    )
  } else if (state.status === "error") {
    badge = (
      <Badge variant="destructive" className="gap-1 font-normal">
        Failed
      </Badge>
    )
  } else if (state.status === "unavailable") {
    badge = (
      <Badge variant="secondary" className="gap-1 font-normal">
        ffmpeg missing
      </Badge>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-2.5 rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0">
          <Film className="w-3.5 h-3.5 text-zinc-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{file.filename}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {badge}
            {isRunning && state.mode && (
              <span className="text-[10px] text-zinc-500">
                {state.mode}
              </span>
            )}
            {isConverted && state.mode && (
              <span className="text-[10px] text-zinc-500">
                via {state.mode}
                {state.hwEncoder ? ` (GPU)` : ""}
              </span>
            )}
          </div>
          {state.error && state.status === "error" && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 line-clamp-2">{state.error}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!alreadyFriendly && state.status !== "ready" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleConvert}
              disabled={busy || isRunning || state.status === "unavailable"}
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="w-3.5 h-3.5" />
              )}
              Convert
            </Button>
          )}
          {state.status === "ready" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDelete}
              disabled={busy}
              aria-label="Remove converted MP4"
              title="Remove converted MP4 (keeps the source file)"
              className="text-zinc-500 hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      {showProgressBar && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-label={`Convert progress for ${file.filename}`}
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className={cn(
                "h-full transition-[width] duration-500 ease-out",
                isConverted
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : "bg-amber-500 dark:bg-amber-400"
              )}
              style={{ width: `${progressPct}%` }}
            />
            {isRunning && (
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            <span>
              {isConverted ? "100% · complete" : `${progressPct}%`}
              {isRunning && state.progress?.speed
                ? ` · ${state.progress.speed.toFixed(1)}x`
                : ""}
              {isRunning && state.progress?.etaSeconds != null && state.progress.etaSeconds > 0
                ? ` · ETA ${formatEta(state.progress.etaSeconds)}`
                : ""}
            </span>
            {isRunning && state.progress?.bitrateKbps ? (
              <span>{state.progress.bitrateKbps.toFixed(0)} kbps</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function formatEta(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "—"
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function ConvertManager({
  mediaId,
  files,
  onConverted,
}: {
  mediaId: string
  files: ConvertFileEntry[]
  onConverted?: () => void
}) {
  if (!files.length) return null

  return (
    <Section title="Compatibility" icon={Cpu}>
      <div className="space-y-1.5">
        {files.map((f) => (
          <ConvertFileRow
            key={f.id}
            file={f}
            mediaId={mediaId}
            onConverted={onConverted}
          />
        ))}
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
        One-click MKV → MP4 conversion. Output lives next to the source as
        <code> &lt;name&gt;.mp4</code>; the library picks it up on the next
        refresh and playback switches to direct streaming. Use the trash icon
        to remove the converted file without touching the original.
      </p>
    </Section>
  )
}
