"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Library,
  PlayCircle,
  BookmarkPlus,
  PauseCircle,
  CheckCircle2,
  Heart,
  ListChecks,
  BarChart3,
  Search,
  Loader2,
  RefreshCw,
  AlertCircle,
  WifiOff,
  Download,
  LayoutGrid,
  List as ListIcon,
  SlidersHorizontal,
  X,
  Film,
  Tv,
  Sparkles,
  Clapperboard,
  Layers,
  FileVideo,
  SortAsc,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import MediaCard from "./cinema/MediaCard"
import MediaDetail from "./cinema/MediaDetail"
import CollectionsPanel from "./cinema/CollectionsPanel"
import StatsPanel from "./cinema/StatsPanel"

import type {
  Collection,
  MediaItem,
  MediaState,
  MediaType,
  PlayableFile,
} from "@/lib/cinema-types"
import {
  cacheLibrary,
  cacheState,
  loadCachedLibrary,
  loadCachedState,
  loadCollections,
  loadViewMode,
  saveCollections,
  saveViewMode,
  type ViewMode,
  STATUS_LABEL,
} from "@/lib/cinema-storage"

type SectionKey =
  | "library"
  | "continue"
  | "plan"
  | "watching"
  | "completed"
  | "favorites"
  | "collections"
  | "stats"

type SortKey =
  | "recent"
  | "title"
  | "year"
  | "rating"
  | "runtime"
  | "added"

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently watched" },
  { value: "title", label: "Title (A→Z)" },
  { value: "year", label: "Year (new→old)" },
  { value: "rating", label: "Your rating" },
  { value: "runtime", label: "Runtime" },
  { value: "added", label: "Recently added" },
]

const TYPE_FILTERS: { value: MediaType | "all"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "movie", label: "Movies", icon: Film },
  { value: "series", label: "Series", icon: Tv },
  { value: "animation", label: "Animation", icon: Sparkles },
  { value: "documentary", label: "Docs", icon: Clapperboard },
  { value: "short", label: "Shorts", icon: FileVideo },
]

const TYPE_LABEL: Record<MediaType, string> = {
  movie: "Movie",
  series: "Series",
  animation: "Animation",
  documentary: "Documentary",
  short: "Short",
  other: "Other",
}

interface LibraryPayload {
  items: MediaItem[]
  count: number
  state?: Record<string, MediaState>
}

function pickResumeFile(media: MediaItem): PlayableFile | null {
  if (media.seasons && media.seasons.length) {
    const first = media.seasons[0]?.episodes[0]
    if (!first) return null
    return {
      id: first.id,
      title: first.title,
      mediaId: media.id,
      filePath: first.path,
      subtitles: first.subtitles,
      isEpisode: true,
      seasonNumber: media.seasons[0].number,
      episodeNumber: first.number,
    }
  }
  const first = media.files[0]
  if (!first) return null
  return {
    id: first.id,
    title: first.filename,
    mediaId: media.id,
    filePath: first.path,
    subtitles: first.subtitles,
  }
}

function progressPercent(s?: MediaState): number | null {
  if (!s || !s.progress || !s.duration) return null
  const pct = (s.progress / s.duration) * 100
  if (pct < 2 || pct > 98) return null
  return pct
}

function isContinuing(s?: MediaState): boolean {
  if (!s || !s.progress || !s.duration) return false
  const pct = s.progress / s.duration
  return pct > 0.05 && pct < 0.95
}

export default function CinemaContent() {
  const cached = useMemo(() => loadCachedLibrary(), [])
  const [media, setMedia] = useState<MediaItem[]>(() => cached?.items ?? [])
  const [stateMap, setStateMap] = useState<Record<string, MediaState>>(() => loadCachedState())
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [section, setSection] = useState<SectionKey>("library")
  const [typeFilter, setTypeFilter] = useState<MediaType | "all">("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("recent")
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode())
  const [openMediaId, setOpenMediaId] = useState<string | null>(null)
  const [autoPlay, setAutoPlay] = useState(false)

  // Persist view mode + library + state caches.
  useEffect(() => {
    saveViewMode(viewMode)
  }, [viewMode])
  useEffect(() => {
    if (media.length) cacheLibrary(media)
  }, [media])
  useEffect(() => {
    if (Object.keys(stateMap).length) cacheState(stateMap)
  }, [stateMap])
  useEffect(() => {
    saveCollections(collections)
  }, [collections])

  // Fetch library + state.
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [libRes, stateRes] = await Promise.all([
        fetch(`/api/cinema/library`),
        fetch(`/api/cinema/state`),
      ])
      if (!libRes.ok) throw new Error(`Library request failed (${libRes.status})`)
      const lib: LibraryPayload = await libRes.json()
      const stateData: { state: Record<string, MediaState> } = stateRes.ok
        ? await stateRes.json()
        : { state: {} }
      const inline: Record<string, MediaState> = {}
      for (const m of lib.items ?? []) {
        // @ts-expect-error: backend may attach "state" alongside the item.
        if (m.state) inline[m.id] = m.state as MediaState
      }
      const merged: Record<string, MediaState> = { ...(stateData.state ?? {}), ...inline }
      // Backfill any screenshot URLs the backend didn't attach (older
      // server versions or a localStorage cache written before this fix).
      const items = (lib.items ?? []).map((m) => {
        if (!m.screenshots?.length) return m
        const shots = m.screenshots.map((s) =>
          s.url ? s : { ...s, url: `/api/cinema/screenshots/${encodeURIComponent(m.id)}?name=${encodeURIComponent(s.name)}` }
        )
        return { ...m, screenshots: shots }
      })
      setMedia(items)
      setStateMap(merged)
      setOffline(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error"
      setError(msg)
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await refresh()
      void cancelled
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Track browser online/offline.
  useEffect(() => {
    const onOnline = () => {
      setOffline(false)
      void refresh()
    }
    const onOffline = () => setOffline(true)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [refresh])

  // ---------------------- Derived data ----------------------

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const m of media) set.add(m.category)
    return Array.from(set).sort()
  }, [media])

  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  useEffect(() => {
    if (categoryFilter !== "all" && !categories.includes(categoryFilter)) {
      // Drop a stale category filter when the library no longer contains it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCategoryFilter("all")
    }
  }, [categories, categoryFilter])
  const effectiveCategory = categoryFilter

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = media.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false
      if (effectiveCategory !== "all" && m.category !== effectiveCategory) return false
      if (q) {
        const hay = `${m.title} ${m.originalTitle} ${m.director ?? ""} ${m.cast.join(" ")} ${m.genres.join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    list = list.filter((m) => sectionFilter(m, section, stateMap))
    list = sortMedia(list, sort, stateMap)
    return list
  }, [media, typeFilter, effectiveCategory, search, section, sort, stateMap])

  // For sections that don't use sort/search filters, override.
  const sectionItems = useMemo(() => {
    if (section === "library") return filtered
    if (section === "continue") {
      return media
        .filter((m) => isContinuing(stateMap[m.id]))
        .sort((a, b) => {
          const ta = stateMap[a.id]?.lastWatchedAt ?? 0
          const tb = stateMap[b.id]?.lastWatchedAt ?? 0
          return tb - ta
        })
    }
    if (section === "plan") {
      return media
        .filter((m) => stateMap[m.id]?.status === "plan")
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    }
    if (section === "watching") {
      return media
        .filter((m) => stateMap[m.id]?.status === "watching")
        .sort((a, b) => {
          const ta = stateMap[a.id]?.lastWatchedAt ?? 0
          const tb = stateMap[b.id]?.lastWatchedAt ?? 0
          return tb - ta
        })
    }
    if (section === "completed") {
      return media
        .filter((m) => stateMap[m.id]?.status === "completed")
        .sort((a, b) => {
          const ta = stateMap[a.id]?.lastWatchedAt ?? 0
          const tb = stateMap[b.id]?.lastWatchedAt ?? 0
          return tb - ta
        })
    }
    if (section === "favorites") {
      return media
        .filter((m) => stateMap[m.id]?.favorite)
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    }
    return []
  }, [filtered, section, media, stateMap])

  // Section counts for tabs.
  const counts = useMemo(() => {
    return {
      library: media.length,
      continue: media.filter((m) => isContinuing(stateMap[m.id])).length,
      plan: media.filter((m) => stateMap[m.id]?.status === "plan").length,
      watching: media.filter((m) => stateMap[m.id]?.status === "watching").length,
      completed: media.filter((m) => stateMap[m.id]?.status === "completed").length,
      favorites: media.filter((m) => stateMap[m.id]?.favorite).length,
      collections: collections.length,
    }
  }, [media, stateMap, collections])

  // ---------------------- Handlers ----------------------

  const handleOpenMedia = useCallback((m: MediaItem, play = false) => {
    setAutoPlay(play)
    setOpenMediaId(m.id)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setOpenMediaId(null)
    setAutoPlay(false)
  }, [])

  const handleStateChange = useCallback(
    (mediaId: string, patch: Partial<MediaState>) => {
      // Optimistic update + persist to server.
      setStateMap((prev) => {
        const cur = prev[mediaId] ?? { status: "none" }
        const next: MediaState = {
          ...cur,
          ...patch,
          updatedAt: Date.now(),
        }
        if (patch.status === "completed" || (patch.progress && patch.duration && patch.progress / patch.duration >= 0.95)) {
          // already handled inline; just merge
        }
        return { ...prev, [mediaId]: next }
      })
      // Fire-and-forget persistence; on failure we keep the optimistic update.
      fetch(`/api/cinema/state/${encodeURIComponent(mediaId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {
        /* offline — local cache will be the source until reconnect */
      })
    },
    []
  )

  const handleCreateCollection = useCallback(
    (name: string, type: Collection["type"] = "custom", description?: string) => {
      setCollections((prev) => {
        const next: Collection = {
          id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          description,
          type,
          mediaIds: [],
          createdAt: Date.now(),
        }
        return [next, ...prev]
      })
    },
    []
  )

  const handleDeleteCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleRenameCollection = useCallback(
    (id: string, name: string, description?: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, name, description: description || c.description }
            : c
        )
      )
    },
    []
  )

  const handleToggleCollection = useCallback(
    (id: string, mediaId: string) => {
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c
          const has = c.mediaIds.includes(mediaId)
          return {
            ...c,
            mediaIds: has
              ? c.mediaIds.filter((m) => m !== mediaId)
              : [...c.mediaIds, mediaId],
          }
        })
      )
    },
    []
  )

  const handleAddMediaToCollection = useCallback(
    (collectionId: string, mediaId: string) => {
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== collectionId) return c
          if (c.mediaIds.includes(mediaId)) return c
          return { ...c, mediaIds: [...c.mediaIds, mediaId] }
        })
      )
    },
    []
  )

  const handleRemoveMediaFromCollection = useCallback(
    (collectionId: string, mediaId: string) => {
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== collectionId) return c
          return { ...c, mediaIds: c.mediaIds.filter((m) => m !== mediaId) }
        })
      )
    },
    []
  )

  const handleExport = useCallback((format: "json" | "csv" | "md") => {
    if (typeof window === "undefined") return
    const url = `/api/cinema/export?format=${format}`
    window.open(url, "_blank")
  }, [])

  // ---------------------- Render ----------------------

  const openMedia = openMediaId ? media.find((m) => m.id === openMediaId) ?? null : null
  const openState = openMediaId ? stateMap[openMediaId] : undefined

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Personal Cinema
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {media.length === 0
              ? "Drop video folders into Videos/Cinema to get started."
              : `${media.length} item${media.length === 1 ? "" : "s"} in your library · ${
                  Object.values(stateMap).filter((s) => s.status === "completed").length
                } completed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <ExportMenu onExport={handleExport} />
          <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none border-0 h-8 w-8"
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none border-0 h-8 w-8"
              onClick={() => setViewMode("list")}
              aria-label="List view"
            >
              <ListIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Disconnect banner */}
      {offline && (
        <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
          <WifiOff className="w-3.5 h-3.5" />
          <span className="flex-1">
            Couldn&apos;t reach the server — showing cached data.
          </span>
          <Button size="xs" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      <Tabs value={section} onValueChange={(v) => setSection(v as SectionKey)}>
        <div className="overflow-x-auto -mx-2 px-2">
          <TabsList variant="line" className="h-9 inline-flex w-auto min-w-full">
            <SectionTab value="library" label="Library" icon={Library} count={counts.library} />
            <SectionTab value="continue" label="Continue" icon={PlayCircle} count={counts.continue} />
            <SectionTab value="plan" label="Watchlist" icon={BookmarkPlus} count={counts.plan} />
            <SectionTab value="watching" label="Watching" icon={PauseCircle} count={counts.watching} />
            <SectionTab value="completed" label="Completed" icon={CheckCircle2} count={counts.completed} />
            <SectionTab value="favorites" label="Favorites" icon={Heart} count={counts.favorites} />
            <SectionTab value="collections" label="Collections" icon={ListChecks} count={counts.collections} />
            <SectionTab value="stats" label="Stats" icon={BarChart3} count={undefined} />
          </TabsList>
        </div>

        <TabsContent value={section} className="mt-4 space-y-4">
          {section === "stats" ? (
            <StatsPanel media={media} state={stateMap} />
          ) : section === "collections" ? (
            <CollectionsPanel
              collections={collections}
              media={media}
              state={stateMap}
              onCreate={(name, type, description) => handleCreateCollection(name, type, description)}
              onDelete={handleDeleteCollection}
              onRename={handleRenameCollection}
              onRemoveMedia={handleRemoveMediaFromCollection}
              onAddMedia={handleAddMediaToCollection}
              onOpenMedia={(m) => handleOpenMedia(m)}
              onPlayMedia={(m) => handleOpenMedia(m, true)}
            />
          ) : (
            <>
              {/* Filters */}
              {section === "library" && (
                <FilterBar
                  search={search}
                  onSearch={setSearch}
                  typeFilter={typeFilter}
                  onTypeFilter={setTypeFilter}
                  categoryFilter={categoryFilter}
                  onCategoryFilter={setCategoryFilter}
                  categories={categories}
                  sort={sort}
                  onSort={setSort}
                />
              )}

              {/* Error */}
              {error && !offline && (
                <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 px-3 py-2 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-200">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span className="flex-1">{error}</span>
                </div>
              )}

              {/* Loading state */}
              {loading && media.length === 0 ? (
                <CenteredMessage
                  icon={Loader2}
                  spinning
                  title="Loading your library…"
                  hint="Scanning Videos/Cinema and Videos/Documentary."
                />
              ) : sectionItems.length === 0 ? (
                <EmptyState section={section} typeFilter={typeFilter} search={search} />
              ) : (
                <Results
                  items={sectionItems}
                  stateMap={stateMap}
                  viewMode={viewMode}
                  onOpen={(m) => handleOpenMedia(m)}
                  onPlay={(m) => handleOpenMedia(m, true)}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      {openMedia && (
        <MediaDetail
          media={openMedia}
          state={openState}
          collections={collections}
          open={!!openMedia}
          onOpenChange={(o) => {
            if (!o) handleCloseDetail()
          }}
          onStateChange={handleStateChange}
          onToggleCollection={handleToggleCollection}
          onCreateCollection={(name) => handleCreateCollection(name)}
          onDeleteCollection={handleDeleteCollection}
          autoPlay={autoPlay}
          onRefresh={refresh}
        />
      )}
    </div>
  )
}

// ---------------------- Sub-components ----------------------

function SectionTab({
  value,
  label,
  icon: Icon,
  count,
}: {
  value: SectionKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  count: number | undefined
}) {
  return (
    <TabsTrigger value={value} className="gap-1.5 text-xs">
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-zinc-200 dark:bg-zinc-800 text-[9px] tabular-nums text-zinc-600 dark:text-zinc-300">
          {count}
        </span>
      )}
    </TabsTrigger>
  )
}

function FilterBar({
  search,
  onSearch,
  typeFilter,
  onTypeFilter,
  categoryFilter,
  onCategoryFilter,
  categories,
  sort,
  onSort,
}: {
  search: string
  onSearch: (v: string) => void
  typeFilter: MediaType | "all"
  onTypeFilter: (v: MediaType | "all") => void
  categoryFilter: string
  onCategoryFilter: (v: string) => void
  categories: string[]
  sort: SortKey
  onSort: (v: SortKey) => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search title, cast, director, genre…"
            className="h-8 pl-8 pr-8 text-sm"
          />
          {search && (
            <button
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => onSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SortAsc className="w-3.5 h-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {TYPE_FILTERS.map((f) => {
          const Icon = f.icon
          const active = typeFilter === f.value
          return (
            <button
              key={f.value}
              onClick={() => onTypeFilter(f.value)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors",
                active
                  ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
                  : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              )}
            >
              <Icon className="w-3 h-3" />
              {f.label}
            </button>
          )
        })}
        {categories.length > 1 && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700 mx-1">|</span>
            <button
              onClick={() => onCategoryFilter("all")}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors",
                categoryFilter === "all"
                  ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
                  : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              )}
            >
              <SlidersHorizontal className="w-3 h-3" />
              All folders
            </button>
            {categories.map((c) => {
              const active = categoryFilter === c
              return (
                <button
                  key={c}
                  onClick={() => onCategoryFilter(c)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors",
                    active
                      ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
                      : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                  )}
                >
                  {c}
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function Results({
  items,
  stateMap,
  viewMode,
  onOpen,
  onPlay,
}: {
  items: MediaItem[]
  stateMap: Record<string, MediaState>
  viewMode: ViewMode
  onOpen: (m: MediaItem) => void
  onPlay: (m: MediaItem) => void
}) {
  if (viewMode === "list") {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-900/40 divide-y divide-zinc-100 dark:divide-zinc-800 p-1.5">
        {items.map((m) => (
          <MediaCard
            key={m.id}
            media={m}
            state={stateMap[m.id]}
            variant="list"
            onOpen={() => onOpen(m)}
            onPlay={() => onPlay(m)}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((m) => (
        <MediaCard
          key={m.id}
          media={m}
          state={stateMap[m.id]}
          onOpen={() => onOpen(m)}
          onPlay={() => onPlay(m)}
        />
      ))}
    </div>
  )
}

function EmptyState({
  section,
  typeFilter,
  search,
}: {
  section: SectionKey
  typeFilter: MediaType | "all"
  search: string
}) {
  if (search) {
    return (
      <CenteredMessage
        icon={Search}
        title="No results"
        hint={`Nothing matches “${search}”. Try a different keyword or clear filters.`}
      />
    )
  }
  if (section === "library" && typeFilter !== "all") {
    return (
      <CenteredMessage
        icon={Layers}
        title={`No ${TYPE_LABEL[typeFilter].toLowerCase()}s found`}
        hint="Try a different type filter, or add some to your library."
      />
    )
  }
  const emptyMessages: Record<SectionKey, { title: string; hint: string }> = {
    library: {
      title: "Your library is empty",
      hint: "Drop movie or series folders into Videos/Cinema/ to populate it. The server scans the folder structure on every load.",
    },
    continue: {
      title: "Nothing in progress",
      hint: "Start watching something — anything past 5% will appear here so you can pick it back up.",
    },
    plan: {
      title: "Watchlist is empty",
      hint: "Open any item and set its status to “Watch later” to save it for a rainy day.",
    },
    watching: {
      title: "Not watching anything",
      hint: "Mark a title as “Watching” to keep tabs on it here.",
    },
    completed: {
      title: "No completions yet",
      hint: "Once you finish a movie or series, it'll show up here.",
    },
    favorites: {
      title: "No favorites yet",
      hint: "Tap the heart on any item to add it to your favorites.",
    },
    collections: {
      title: "No collections",
      hint: "Group your media into personal collections like “Weekend watches” or “Director: Nolan”.",
    },
    stats: {
      title: "No stats yet",
      hint: "Start watching — your activity shows up here.",
    },
  }
  const m = emptyMessages[section]
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 flex flex-col items-center gap-3 text-center bg-white/40 dark:bg-zinc-900/40">
      <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
        {section === "library" ? (
          <Film className="w-5 h-5" />
        ) : section === "continue" ? (
          <PlayCircle className="w-5 h-5" />
        ) : section === "plan" ? (
          <BookmarkPlus className="w-5 h-5" />
        ) : section === "watching" ? (
          <PauseCircle className="w-5 h-5" />
        ) : section === "completed" ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : section === "favorites" ? (
          <Heart className="w-5 h-5" />
        ) : (
          <ListChecks className="w-5 h-5" />
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{m.title}</h3>
        <p className="text-xs text-zinc-500 max-w-md">{m.hint}</p>
      </div>
      {STATUS_LABEL && section === "plan" && (
        <Badge variant="outline" className="gap-1">
          {STATUS_LABEL.plan}
        </Badge>
      )}
    </div>
  )
}

function CenteredMessage({
  icon: Icon,
  title,
  hint,
  spinning,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
  spinning?: boolean
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-10 flex flex-col items-center gap-3 text-center bg-white/40 dark:bg-zinc-900/40">
      <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
        <Icon className={cn("w-5 h-5", spinning && "animate-spin")} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-zinc-500 max-w-md">{hint}</p>}
      </div>
    </div>
  )
}

function ExportMenu({
  onExport,
}: {
  onExport: (format: "json" | "csv" | "md") => void
}) {
  return (
    <Select onValueChange={(v) => onExport(v as "json" | "csv" | "md")}>
      <SelectTrigger className="h-8 w-32 text-xs">
        <Download className="w-3.5 h-3.5" />
        <SelectValue placeholder="Export" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="json">JSON</SelectItem>
        <SelectItem value="csv">CSV</SelectItem>
        <SelectItem value="md">Markdown</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ---------------------- Helpers ----------------------

function sectionFilter(
  m: MediaItem,
  section: SectionKey,
  stateMap: Record<string, MediaState>
): boolean {
  switch (section) {
    case "library":
      return true
    case "continue":
      return isContinuing(stateMap[m.id])
    case "plan":
      return stateMap[m.id]?.status === "plan"
    case "watching":
      return stateMap[m.id]?.status === "watching"
    case "completed":
      return stateMap[m.id]?.status === "completed"
    case "favorites":
      return !!stateMap[m.id]?.favorite
    default:
      return true
  }
}

function sortMedia(
  list: MediaItem[],
  sort: SortKey,
  stateMap: Record<string, MediaState>
): MediaItem[] {
  const arr = [...list]
  switch (sort) {
    case "title":
      arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      return arr
    case "year":
      arr.sort((a, b) => (b.year || 0) - (a.year || 0))
      return arr
    case "rating":
      arr.sort(
        (a, b) => (stateMap[b.id]?.rating || 0) - (stateMap[a.id]?.rating || 0)
      )
      return arr
    case "runtime":
      arr.sort((a, b) => (b.runtime || 0) - (a.runtime || 0))
      return arr
    case "added":
      arr.sort((a, b) => {
        const ta = stateMap[a.id]?.addedAt ?? 0
        const tb = stateMap[b.id]?.addedAt ?? 0
        return tb - ta
      })
      return arr
    case "recent":
    default:
      arr.sort((a, b) => {
        const ta = stateMap[a.id]?.lastWatchedAt ?? 0
        const tb = stateMap[b.id]?.lastWatchedAt ?? 0
        if (ta && tb) return tb - ta
        if (ta) return -1
        if (tb) return 1
        return (a.title || "").localeCompare(b.title || "")
      })
      return arr
  }
}

// Silence unused-warning for pickResumeFile (kept for future use in onPlay).
void pickResumeFile
void progressPercent
