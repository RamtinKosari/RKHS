// Local storage helpers for the Cinema tab.
// Server-side state (ratings/notes/progress) is the source of truth and synced
// from the backend; these helpers cover local-only caches (favorites,
// collections, view mode, resume tracking) and offline fallback.

import type {
  Collection,
  MediaItem,
  MediaState,
  WatchStatus,
} from "./cinema-types"

const KEY_PREFIX = "rkhs-cinema"
const K_COLLECTIONS = `${KEY_PREFIX}-collections`
const K_VIEW_MODE = `${KEY_PREFIX}-view-mode`
const K_LIBRARY_CACHE = `${KEY_PREFIX}-library-cache`
const K_STATE_CACHE = `${KEY_PREFIX}-state-cache`

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadJSON<T>(key: string, fallback: T): T {
  const s = safeStorage()
  if (!s) return fallback
  try {
    const raw = s.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed as T
  } catch {
    return fallback
  }
}

export function saveJSON<T>(key: string, value: T) {
  const s = safeStorage()
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

// ---------------- Collections ----------------

export function loadCollections(): Collection[] {
  return loadJSON<Collection[]>(K_COLLECTIONS, [])
}

export function saveCollections(collections: Collection[]) {
  saveJSON(K_COLLECTIONS, collections)
}

export function createCollection(
  collections: Collection[],
  name: string,
  type: Collection["type"] = "custom",
  description = ""
): Collection[] {
  const trimmed = name.trim()
  if (!trimmed) return collections
  const next: Collection = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    description: description.trim() || undefined,
    type,
    mediaIds: [],
    createdAt: Date.now(),
  }
  return [next, ...collections]
}

export function updateCollection(
  collections: Collection[],
  id: string,
  patch: Partial<Collection>
): Collection[] {
  return collections.map((c) => (c.id === id ? { ...c, ...patch } : c))
}

export function deleteCollection(collections: Collection[], id: string): Collection[] {
  return collections.filter((c) => c.id !== id)
}

export function toggleMediaInCollection(
  collections: Collection[],
  id: string,
  mediaId: string
): Collection[] {
  return collections.map((c) => {
    if (c.id !== id) return c
    const has = c.mediaIds.includes(mediaId)
    return {
      ...c,
      mediaIds: has ? c.mediaIds.filter((m) => m !== mediaId) : [...c.mediaIds, mediaId],
    }
  })
}

// ---------------- View preference ----------------

export type ViewMode = "grid" | "list"

export function loadViewMode(): ViewMode {
  return loadJSON<ViewMode>(K_VIEW_MODE, "grid")
}

export function saveViewMode(mode: ViewMode) {
  saveJSON(K_VIEW_MODE, mode)
}

// ---------------- Library / State caches ----------------

export function cacheLibrary(items: MediaItem[]) {
  saveJSON(K_LIBRARY_CACHE, { items, ts: Date.now() })
}

export function loadCachedLibrary(): { items: MediaItem[]; ts: number } | null {
  const data = loadJSON<{ items: MediaItem[]; ts: number } | null>(K_LIBRARY_CACHE, null as never)
  return data || null
}

export function cacheState(state: Record<string, MediaState>) {
  saveJSON(K_STATE_CACHE, state)
}

export function loadCachedState(): Record<string, MediaState> {
  return loadJSON<Record<string, MediaState>>(K_STATE_CACHE, {})
}

// ---------------- Status helpers ----------------

export const STATUS_LABEL: Record<WatchStatus, string> = {
  none: "Not on list",
  plan: "Watch later",
  watching: "Watching",
  completed: "Completed",
  dropped: "Dropped",
}

export const STATUS_OPTIONS: WatchStatus[] = [
  "none",
  "plan",
  "watching",
  "completed",
  "dropped",
]