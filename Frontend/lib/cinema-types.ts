// Shared types for the Personal Cinema feature

export type MediaType =
  | "movie"
  | "series"
  | "animation"
  | "documentary"
  | "short"
  | "other"

export type WatchStatus = "none" | "watching" | "completed" | "dropped" | "plan"

export interface SubtitleTrack {
  lang: string
  label: string
  filename: string
  format: "srt" | "vtt"
}

export type PlaybackStrategy = "direct" | "remux" | "remux-hevc" | "transcode"

export interface MediaFile {
  id: string
  filename: string
  path: string
  size: string
  sizeBytes: number
  ext: string
  subtitles: SubtitleTrack[]
  /** Codec reported by ffprobe (e.g. "hevc", "h264"). */
  videoCodec?: string | null
  /** Pixel format reported by ffprobe (e.g. "yuv420p10le"). */
  pixelFormat?: string | null
  /** Audio codec reported by ffprobe (e.g. "aac", "dts"). */
  audioCodec?: string | null
  /** Container / format names reported by ffprobe. */
  containerFormat?: string | null
  /** Duration in seconds if ffprobe could determine it. */
  duration?: number | null
  /** True when the browser can decode the file natively. */
  browserFriendly?: boolean
  /** How the server will serve this file. */
  playbackStrategy?: PlaybackStrategy
}

export interface Episode {
  id: string
  number: number
  title: string
  filename: string
  path: string
  size: string
  sizeBytes: number
  ext: string
  subtitles: SubtitleTrack[]
  videoCodec?: string | null
  pixelFormat?: string | null
  audioCodec?: string | null
  containerFormat?: string | null
  duration?: number | null
  browserFriendly?: boolean
  playbackStrategy?: PlaybackStrategy
}

export interface Season {
  number: number
  title: string
  path: string
  episodes: Episode[]
}

export interface MediaItem {
  id: string
  title: string
  originalTitle: string
  year: number | null
  type: MediaType
  category: string
  path: string
  poster: string | null
  backdrop: string | null
  synopsis: string
  genres: string[]
  rating: number | null
  runtime: number | null
  cast: string[]
  director: string | null
  trailer: string | null
  files: MediaFile[]
  seasons: Season[] | null
  /** User-uploaded movie screenshots. Each carries its own URL. */
  screenshots?: ScreenshotEntry[]
}

export interface ScreenshotEntry {
  /** Filename on disk (e.g. ``screenshot-1.jpg``). */
  name: string
  /** Sort index — ``0`` is the unsuffixed ``screenshot.<ext>``. */
  index: number
  /** Size in bytes. */
  size: number
  /** Cache-busted URL served by ``GET /api/cinema/screenshots/<id>?name=``. */
  url: string
}

export interface MediaState {
  status: WatchStatus
  rating?: number | null
  review?: string
  notes?: string
  tags?: string[]
  favorite?: boolean
  rewatchCount?: number
  progress?: number
  duration?: number
  lastWatchedAt?: number
  addedAt?: number
  updatedAt?: number
  /** ID of the last file/episode played for resume */
  resumeFileId?: string | null
  /** Optional per-episode/season progress (series) */
  episodeProgress?: Record<string, { progress: number; duration: number; updatedAt: number }>
  /** Mood tags the user attached to a viewing session */
  moods?: string[]
  /** True once user has at least started watching */
  startedAt?: number
}

export interface Collection {
  id: string
  name: string
  description?: string
  type: "custom" | "smart" | "franchise" | "director" | "actor"
  mediaIds: string[]
  createdAt: number
}

export interface PlayableFile {
  /** Stable ID (MediaFile.id or Episode.id) */
  id: string
  /** Display title for the file (movie file name or episode title) */
  title: string
  /** Parent media id */
  mediaId: string
  /** Path used in the stream API */
  filePath: string
  /** Subtitles available for this file */
  subtitles: SubtitleTrack[]
  /** Duration in seconds if known (from state) */
  duration?: number
  /** Whether this file is a series episode */
  isEpisode?: boolean
  /** Optional season number (1-based) */
  seasonNumber?: number
  /** Optional episode number within season */
  episodeNumber?: number
  /** Whether the browser can decode this file natively. */
  browserFriendly?: boolean
  /** Codec reported by the scanner (e.g. "hevc"). */
  videoCodec?: string | null
  /** How the server will serve this file. */
  playbackStrategy?: PlaybackStrategy
}