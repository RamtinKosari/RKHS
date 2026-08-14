"use client"

import { useState, useEffect, useMemo, memo } from "react"
import dynamic from "next/dynamic"
import {
  Download,
  Trash2,
  Music,
  FileText,
  FileCode,
  FileImage,
  FileVideo,
  File,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Folder,
  FolderOpen,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ErrorBoundary } from "@/components/ErrorBoundary"

import PreviewCarousel from "./PreviewCarousel"
import VideoPlayer from "./VideoPlayer"
import type { StorageItem } from "@/lib/types"

const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:5000/api`
    : "http://localhost:5000/api"

const PdfPreview = dynamic(() => import("@/components/file-manager/PdfPreview"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400 p-4">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading PDF viewer...
    </div>
  ),
})

interface PreviewCardProps {
  selectedItem: StorageItem | null
  setSelectedItem: (item: StorageItem | null) => void
  filteredItems: StorageItem[]
  onDownload: (item: StorageItem) => void
  onDelete: (item: StorageItem) => void
}

function formatDate(ts: string) {
  const num = Number(ts)
  if (!num) return "—"
  return new Date(num * 1000).toLocaleString()
}

function getItemIcon(item: StorageItem) {
  if (item.type === "folder") {
    return <FolderOpen className="w-4 h-4 text-blue-500" />
  }
  switch (item.type) {
    case "pdf":
      return <FileText className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "code":
      return <FileCode className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "spreadsheet":
      return <FileImage className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "image":
      return <FileImage className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "video":
      return <FileVideo className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "audio":
      return <Music className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    default:
      return <File className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
  }
}

const CodePreview = memo(function CodePreview({ code }: { code: string }) {
  const lines = useMemo(() => code.split("\n").slice(0, 20), [code])
  return (
    <>
      {lines.map((line, lineIdx) => {
        const parts = line.split(
          /(\s+|[()[\]{},:;=+\-*/<>!&|.%]+|["'].*?["']|#.*|\/\/.*)/g,
        )
        return (
          <div
            key={lineIdx}
            className="table-row font-mono text-[10px] leading-tight"
          >
            <span className="table-cell text-right pr-2 select-none text-zinc-600 dark:text-zinc-700 w-5">
              {lineIdx + 1}
            </span>
            <span className="table-cell whitespace-pre">
              {parts.map((part, i) => {
                if (!part) return null
                if (part.startsWith("#") || part.startsWith("//")) {
                  return (
                    <span key={i} className="text-zinc-500 italic">
                      {part}
                    </span>
                  )
                }
                if (
                  (part.startsWith('"') && part.endsWith('"')) ||
                  (part.startsWith("'") && part.endsWith("'"))
                ) {
                  return (
                    <span key={i} className="text-emerald-400">
                      {part}
                    </span>
                  )
                }
                if (
                  /^(import|from|def|class|return|const|let|var|function|if|else|for|while|try|except|async|await|true|false|None|null|undefined)$/.test(
                    part.trim(),
                  )
                ) {
                  return (
                    <span key={i} className="text-purple-400 font-semibold">
                      {part}
                    </span>
                  )
                }
                if (/^\d+(\.\d+)?$/.test(part.trim())) {
                  return (
                    <span key={i} className="text-amber-400">
                      {part}
                    </span>
                  )
                }
                return (
                  <span key={i} className="text-zinc-200">
                    {part}
                  </span>
                )
              })}
            </span>
          </div>
        )
      })}
    </>
  )
})

// Renders the preview body for one slide of the right-side carousel. The
// current slide gets the full preview (with code, PDF, etc.); the prev/next
// slides get a lightweight placeholder so we don't kick off 3 PDF/code
// fetches per swipe.
//
// Videos are special: only the "current" slot mounts a real <video>. The
// other slots render a static placeholder so a single swipe never spins up
// more than one decoder. While the fullscreen dialog is open (`isHidden`)
// we render nothing — the dialog's player is the sole instance, which
// eliminates the side/fullscreen "double playback" race.
function renderSidePreviewSlide(
  item: StorageItem,
  position: "prev" | "current" | "next",
  codeContent: string,
  isLoadingCode: boolean,
  isHidden: boolean,
) {
  const isCurrent = position === "current"

  if (isHidden && isCurrent) {
    return null
  }

  if (item.type === "image") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-2">
        <img
          key={item.id}
          src={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
          alt={item.name}
          loading={isCurrent ? "eager" : "lazy"}
          decoding="async"
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
      </div>
    )
  }

  if (item.type === "video") {
    if (!isCurrent) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black text-zinc-400 gap-2">
          <FileVideo className="w-8 h-8" />
          <span className="text-xs truncate max-w-[200px]">{item.name}</span>
        </div>
      )
    }
    return (
      <VideoPlayer
        src={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
      />
    )
  }

  if (item.type === "audio") {
    return (
      <div className="flex flex-col items-center justify-center p-6 w-full space-y-4">
        <div className="p-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-full">
          <Music className="w-8 h-8 text-zinc-700 dark:text-zinc-300 animate-pulse" />
        </div>
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[220px]">
          {item.name}
        </span>
        <audio
          src={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
          controls
          className="w-full max-w-[260px] h-10"
        />
      </div>
    )
  }

  if (item.type === "code") {
    if (!isCurrent) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 gap-2">
          <FileCode className="w-8 h-8" />
          <span className="text-xs truncate max-w-[200px]">{item.name}</span>
        </div>
      )
    }
    return (
      <div className="w-full h-full flex flex-col bg-zinc-950 text-zinc-50 font-mono text-[10px] overflow-hidden select-text">
        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[10px]">
          <span>{item.name}</span>
          <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">
            First 20 Lines
          </span>
        </div>
        <div className="p-2 overflow-hidden flex-1">
          {isLoadingCode ? (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading code...
            </div>
          ) : (
            <CodePreview code={codeContent} />
          )}
        </div>
      </div>
    )
  }

  if (item.type === "pdf") {
    if (!isCurrent) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-400 gap-2">
          <FileText className="w-8 h-8" />
          <span className="text-xs truncate max-w-[200px]">{item.name}</span>
        </div>
      )
    }
    return (
      <ErrorBoundary
        fallback={
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-xs text-zinc-400">
            <FileText className="w-6 h-6 mb-1 opacity-60" />
            PDF preview unavailable.
          </div>
        }
      >
        <PdfPreview
          key={item.id}
          url={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
          width={400}
        />
      </ErrorBoundary>
    )
  }

  // Spreadsheet / other — no real preview
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <div className="p-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl mb-3 border border-zinc-300/40 dark:border-zinc-700/40 shadow-xs">
        {getItemIcon(item)}
      </div>
      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
        {item.name}
      </span>
      <span className="text-[10px] text-zinc-400 mt-1 uppercase tracking-wider bg-zinc-200/60 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
        {item.type} preview unavailable
      </span>
    </div>
  )
}

function renderFullscreenSlide(
  item: StorageItem,
  position: "prev" | "current" | "next",
) {
  const isCurrent = position === "current"

  if (item.type === "image") {
    return (
      <div className="w-full h-full flex items-center justify-center p-2">
        <img
          key={item.id}
          src={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
          alt={item.name}
          loading={isCurrent ? "eager" : "lazy"}
          decoding="async"
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
      </div>
    )
  }
  if (item.type === "video") {
    if (!isCurrent) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black text-zinc-400 gap-2">
          <FileVideo className="w-10 h-10" />
          <span className="text-sm truncate max-w-[240px]">{item.name}</span>
        </div>
      )
    }
    return (
      <VideoPlayer
        src={`${API_BASE}/download?path=${encodeURIComponent(item.path)}`}
      />
    )
  }
  return null
}

export default function PreviewCard({
  selectedItem,
  setSelectedItem,
  filteredItems,
  onDownload,
  onDelete,
}: PreviewCardProps) {
  const [fullscreenItem, setFullscreenItem] = useState<StorageItem | null>(null)
  const [codeContent, setCodeContent] = useState("")
  const [isLoadingCode, setIsLoadingCode] = useState(false)

  // Non-folder items form the carousel's navigation set (cyclic, wraps at
  // the ends). Computing it once here means both the right-side carousel
  // and the fullscreen dialog share the exact same prev/next ordering.
  const fileItems = useMemo(
    () => filteredItems.filter((i) => i.type !== "folder"),
    [filteredItems],
  )

  const currentIndex = useMemo(() => {
    if (!selectedItem) return -1
    return fileItems.findIndex((i) => i.id === selectedItem.id)
  }, [fileItems, selectedItem])

  const fullscreenIndex = useMemo(() => {
    if (!fullscreenItem) return -1
    return fileItems.findIndex((i) => i.id === fullscreenItem.id)
  }, [fileItems, fullscreenItem])

  // Load code content for the currently focused code file.
  useEffect(() => {
    if (selectedItem?.type !== "code") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodeContent("")
      return
    }
    let cancelled = false
    setIsLoadingCode(true)
    fetch(
      `${API_BASE}/content?path=${encodeURIComponent(selectedItem.path)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCodeContent(data.content || "")
      })
      .catch(() => {
        if (!cancelled) setCodeContent("Error loading code preview.")
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCode(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedItem])

  // Fixed aspect ratio for the right-side preview area. Keeping it stable
  // (instead of resizing to each item's intrinsic ratio) means the carousel
  // doesn't jolt in size as the user swipes between items of different
  // shapes.
  const previewAspectRatio =
    selectedItem?.type === "code" ||
    selectedItem?.type === "spreadsheet" ||
    selectedItem?.type === "audio"
      ? 4 / 3
      : 16 / 9

  const showPreview = !!selectedItem && selectedItem.type !== "folder"

  const goTo = (index: number) => {
    if (index < 0 || index >= fileItems.length) return
    setSelectedItem(fileItems[index])
  }

  const handleSideNavigate = (newIndex: number) => {
    setSelectedItem(fileItems[newIndex])
  }

  const handleFullscreenNavigate = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= fileItems.length) return
    const next = fileItems[newIndex]
    setFullscreenItem(next)
    // Keep selectedItem in sync so when the user closes fullscreen, the
    // right-side preview shows the file they were last looking at.
    setSelectedItem(next)
  }

  const handleFullscreenPrev = () => {
    if (fullscreenIndex < 0) return
    goTo((fullscreenIndex - 1 + fileItems.length) % fileItems.length)
  }

  const handleFullscreenNext = () => {
    if (fullscreenIndex < 0) return
    goTo((fullscreenIndex + 1) % fileItems.length)
  }

  return (
    <>
      <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            File Inspector
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showPreview ? (
            <>
              <div
                className="relative bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                style={{ aspectRatio: `${previewAspectRatio}` }}
              >
                <PreviewCarousel
                  items={fileItems}
                  currentIndex={currentIndex}
                  onNavigate={handleSideNavigate}
                  renderSlide={(item, position) =>
                    renderSidePreviewSlide(
                      item,
                      position,
                      codeContent,
                      isLoadingCode,
                      !!fullscreenItem,
                    )
                  }
                  className="absolute inset-0"
                />

                {(selectedItem.type === "image" ||
                  selectedItem.type === "video") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFullscreenItem(selectedItem)
                    }}
                    onTouchStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 z-10 h-8 w-8 bg-black/50 hover:bg-black/70 text-white rounded-md backdrop-blur-sm"
                    title="View fullscreen"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-zinc-400">File Name:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[180px]">
                    {selectedItem.name}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-zinc-400">File Size:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedItem.size}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-zinc-400">Uploader:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedItem.uploader}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-zinc-400">Last Modified:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {formatDate(selectedItem.updatedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block mb-1">Server Path:</span>
                  <code className="text-[10px] bg-zinc-100 dark:bg-zinc-950 p-1.5 rounded block font-mono text-zinc-500 truncate">
                    ./uploads/{selectedItem.path}
                  </code>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  onClick={() => onDownload(selectedItem)}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Download className="w-3 h-3 mr-1.5" /> Download
                </Button>
                <Button
                  onClick={() => onDelete(selectedItem)}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8 text-red-600 dark:text-red-400 border-zinc-200 dark:border-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="w-3 h-3 mr-1.5" /> Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-zinc-400 text-xs">
              {selectedItem?.type === "folder" ? (
                <div className="space-y-2">
                  <Folder className="w-10 h-10 mx-auto text-blue-500" />
                  <p className="font-medium">{selectedItem.name}</p>
                  <p>Double-click a folder to open it.</p>
                </div>
              ) : (
                <p>Select a file from the table to inspect details.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!fullscreenItem}
        onOpenChange={(open) => {
          if (!open) setFullscreenItem(null)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-screen h-screen max-w-none sm:max-w-none sm:rounded-none bg-black border-zinc-800 p-0 flex flex-col gap-0 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 p-3 sm:p-4 text-white shrink-0">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">
                {fullscreenItem?.name}
              </span>
              {fullscreenItem && fullscreenIndex >= 0 && (
                <span className="text-[10px] text-zinc-400">
                  {fullscreenIndex + 1} of {fileItems.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFullscreenPrev}
                className="h-9 w-9 text-white hover:bg-white/10"
                title="Previous (swipe right)"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFullscreenNext}
                className="h-9 w-9 text-white hover:bg-white/10"
                title="Next (swipe left)"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFullscreenItem(null)}
                className="h-9 w-9 text-white hover:bg-white/10"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
          <PreviewCarousel
            items={fileItems}
            currentIndex={fullscreenIndex}
            onNavigate={handleFullscreenNavigate}
            renderSlide={(item, position) =>
              renderFullscreenSlide(item, position)
            }
            className="flex-1 min-h-0"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
