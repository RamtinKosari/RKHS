"use client"

import { useMemo, useState } from "react"
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ListChecks,
  Search,
  Sparkles,
  Film,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import MediaCard from "./MediaCard"

import type { Collection, MediaItem, MediaState } from "@/lib/cinema-types"

const COLLECTION_TYPES: { value: Collection["type"]; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "smart", label: "Smart" },
  { value: "franchise", label: "Franchise" },
  { value: "director", label: "By director" },
  { value: "actor", label: "By actor" },
]

export interface CollectionsPanelProps {
  collections: Collection[]
  media: MediaItem[]
  state: Record<string, MediaState>
  onCreate: (name: string, type: Collection["type"], description?: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string, description?: string) => void
  onRemoveMedia: (collectionId: string, mediaId: string) => void
  onOpenMedia: (media: MediaItem) => void
  onPlayMedia: (media: MediaItem) => void
  onAddMedia: (collectionId: string, mediaId: string) => void
}

export default function CollectionsPanel({
  collections,
  media,
  state,
  onCreate,
  onDelete,
  onRename,
  onRemoveMedia,
  onOpenMedia,
  onPlayMedia,
  onAddMedia,
}: CollectionsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    collections[0]?.id ?? null
  )
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<Collection["type"]>("custom")
  const [description, setDescription] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameDesc, setRenameDesc] = useState("")
  const [search, setSearch] = useState("")

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaItem>()
    for (const m of media) map.set(m.id, m)
    return map
  }, [media])

  const selected = useMemo(
    () => collections.find((c) => c.id === selectedId) ?? null,
    [collections, selectedId]
  )

  const selectedItems = useMemo(() => {
    if (!selected) return []
    return selected.mediaIds
      .map((id) => mediaById.get(id))
      .filter((m): m is MediaItem => Boolean(m))
  }, [mediaById, selected])

  const addableItems = useMemo(() => {
    if (!selected) return []
    const inCol = new Set(selected.mediaIds)
    const q = search.trim().toLowerCase()
    return media
      .filter((m) => !inCol.has(m.id))
      .filter((m) =>
        q ? m.title.toLowerCase().includes(q) : true
      )
      .slice(0, 50)
  }, [media, search, selected])

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed, type, description.trim() || undefined)
    setName("")
    setDescription("")
    setType("custom")
    setCreating(false)
  }

  function beginRename() {
    if (!selected) return
    setRenameValue(selected.name)
    setRenameDesc(selected.description ?? "")
    setRenaming(true)
  }

  function commitRename() {
    if (!selected) return
    if (renameValue.trim()) {
      onRename(selected.id, renameValue.trim(), renameDesc.trim() || undefined)
    }
    setRenaming(false)
  }

  if (collections.length === 0 && !creating) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 flex flex-col items-center gap-3 text-center bg-white/40 dark:bg-zinc-900/40">
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
          <ListChecks className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-medium">No collections yet</h3>
          <p className="text-xs text-zinc-500 max-w-sm">
            Group movies and series into your own collections — favorites,
            franchises, weekend watches, anything you like.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          Create your first collection
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      {/* Sidebar list */}
      <aside className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-2">
        <div className="flex items-center justify-between px-1.5 py-1">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Collections
          </h3>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setCreating((c) => !c)}
            aria-label="New collection"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        {creating && (
          <div className="space-y-1.5 p-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name"
              className="h-7 text-xs"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Collection["type"])}
              className="w-full h-7 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs"
            >
              {COLLECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="h-7 text-xs"
            />
            <div className="flex gap-1.5">
              <Button size="xs" onClick={handleCreate} className="flex-1">
                Create
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setCreating(false)
                  setName("")
                  setDescription("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="max-h-[400px]">
          <ul className="space-y-0.5">
            {collections.map((c) => {
              const active = c.id === selectedId
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                    )}
                  >
                    <span className="flex-1 truncate">{c.name}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "opacity-80" : "text-zinc-500"
                      )}
                    >
                      {c.mediaIds.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </aside>

      {/* Detail */}
      <section>
        {!selected ? (
          <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Select a collection on the left, or create a new one.
          </div>
        ) : (
          <div className="space-y-4">
            <header className="flex flex-col gap-2">
              {renaming ? (
                <div className="space-y-1.5">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Input
                    value={renameDesc}
                    onChange={(e) => setRenameDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Button size="xs" onClick={commitRename} className="gap-1">
                      <Check className="w-3 h-3" />
                      Save
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setRenaming(false)}
                      className="gap-1"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-2 justify-between">
                  <div>
                    <h2 className="text-lg font-semibold leading-tight">
                      {selected.name}
                    </h2>
                    {selected.description && (
                      <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
                        {selected.description}
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {COLLECTION_TYPES.find((t) => t.value === selected.type)?.label}
                      <span>·</span>
                      {selected.mediaIds.length} item
                      {selected.mediaIds.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={beginRename}
                      className="gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      Rename
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onDelete(selected.id)}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </header>

            {selectedItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-500">
                This collection is empty. Add items from your library below.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {selectedItems.map((m) => (
                  <div key={m.id} className="relative group">
                    <MediaCard
                      media={m}
                      state={state[m.id]}
                      onOpen={() => onOpenMedia(m)}
                      onPlay={() => onPlayMedia(m)}
                    />
                    <button
                      onClick={() => onRemoveMedia(selected.id, m.id)}
                      className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-black/80"
                      aria-label={`Remove ${m.title} from collection`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add items */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-900/40 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your library…"
                    className="h-7 text-xs pl-7"
                  />
                </div>
                <span className="text-[10px] text-zinc-500">
                  {addableItems.length} match{addableItems.length === 1 ? "" : "es"}
                </span>
              </div>
              {addableItems.length > 0 ? (
                <ul className="max-h-60 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                  {addableItems.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 py-1.5 text-xs"
                    >
                      <Film className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{m.title}</p>
                        <p className="text-[10px] text-zinc-500 truncate">
                          {m.year ? `${m.year} · ` : ""}
                          {m.type}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onAddMedia(selected.id, m.id)}
                        className="gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500 py-2 text-center">
                  {search
                    ? "No matching items in your library."
                    : "All library items are already in this collection."}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
