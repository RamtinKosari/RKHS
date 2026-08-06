"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"

import { 
  Upload, 
  File, 
  Download, 
  Trash2, 
  MoreVertical, 
  HardDrive, 
  Search,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  Music,
  CheckCircle2,
  Laptop,
  Wifi,
  Loader2,
  Folder,
  FolderOpen,
  FolderInput,
  Lock,
  Unlock,
  ArrowLeft,
  Home,
  Plus,
  Edit3,
  KeyRound,
  X,
  ChevronRight,
  AlertTriangle,
  Copy,
  Scissors,
  ClipboardPaste,
  GripVertical,
  ChevronDown,
  Check,
  RefreshCw
} from "lucide-react"
import { Label, Pie as RechartsPie, PieChart, Sector } from "recharts"

// Recharts v3 removed activeIndex/activeShape from the TypeScript typings,
// but the runtime still supports them. Cast so the build passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Pie = RechartsPie as any
import { QRCodeSVG } from "qrcode.react"

import { PieSectorDataItem } from "recharts/types/polar/Pie"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartConfig,
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type ItemType = "pdf" | "code" | "spreadsheet" | "image" | "video" | "audio" | "folder"

interface StorageItem {
  id: string
  name: string
  size?: string
  sizeBytes?: number
  type: ItemType
  path: string
  uploader: string
  updatedAt: string
  locked?: boolean
}

interface StatsData {
  counts: Record<string, number>
  sizes: Record<string, number>
}

interface FolderTreeNode {
  name: string
  path: string
  children: FolderTreeNode[]
}

interface ClipboardItem {
  items: StorageItem[]
  mode: "copy" | "cut"
}

const API_BASE = typeof window !== "undefined" 
  ? `http://${window.location.hostname}:5000/api` 
  : "http://localhost:5000/api"

const chartConfig = {
  value: { label: "Metric" },
  pdf: { label: "Documents", color: "#71717a" },
  code: { label: "Code", color: "#27272a" },
  spreadsheet: { label: "Spreadsheets", color: "#a1a1aa" },
  image: { label: "Images", color: "#d4d4d8" },
  video: { label: "Videos", color: "#52525b" },
  audio: { label: "Audio", color: "#3f3f46" },
} satisfies ChartConfig

export default function FileManagerContent() {
  const [items, setItems] = useState<StorageItem[]>([])
  const [stats, setStats] = useState<StatsData>({
    counts: { pdf: 0, code: 0, spreadsheet: 0, image: 0, video: 0, audio: 0 },
    sizes: { pdf: 0, code: 0, spreadsheet: 0, image: 0, video: 0, audio: 0 },
  })
  const [currentPath, setCurrentPath] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9)
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set())
  
  // Code content preview state
  const [codeContent, setCodeContent] = useState<string>("")
  const [isLoadingCode, setIsLoadingCode] = useState<boolean>(false)

  // Selection, clipboard, and file operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null)
  const [isCopying, setIsCopying] = useState(false)

  // Move dialog state
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [moveItems, setMoveItems] = useState<StorageItem[]>([])
  const [folderTree, setFolderTree] = useState<FolderTreeNode[]>([])
  const [moveTargetPath, setMoveTargetPath] = useState<string>("")
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isMoving, setIsMoving] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: StorageItem } | null>(null)

  // File rename dialog
  const [fileToRename, setFileToRename] = useState<StorageItem | null>(null)
  const [renameFileName, setRenameFileName] = useState("")
  const [isRenamingFile, setIsRenamingFile] = useState(false)

  const id = "pie-interactive-file-types"
  const types = useMemo(() => ["pdf", "code", "spreadsheet", "image", "video", "audio"], [])
  const [activeType, setActiveType] = useState<string>("pdf")

  const [sharedText, setSharedText] = useState("")
  const [isSavingText, setIsSavingText] = useState(false)
  const [textCopied, setTextCopied] = useState(false)

  // Upload dialog state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)

  // Folder management dialogs
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const [folderToRename, setFolderToRename] = useState<StorageItem | null>(null)
  const [renameFolderName, setRenameFolderName] = useState("")
  const [isRenamingFolder, setIsRenamingFolder] = useState(false)

  const [folderToPassword, setFolderToPassword] = useState<StorageItem | null>(null)
  const [folderPassword, setFolderPassword] = useState("")
  const [isSettingPassword, setIsSettingPassword] = useState(false)

  const [folderToUnlock, setFolderToUnlock] = useState<StorageItem | null>(null)
  const [unlockPassword, setUnlockPassword] = useState("")
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState("")

  const [itemToDelete, setItemToDelete] = useState<StorageItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const getFileSizeBytes = (f: StorageItem) => {
    if (f.sizeBytes && f.sizeBytes > 0) return f.sizeBytes
    if (!f.size) return 0
    const parts = f.size.split(" ")
    const val = parseFloat(parts[0]) || 0
    const unit = (parts[1] || "").toUpperCase()
    if (unit.includes("GB")) return val * 1024 * 1024 * 1024
    if (unit.includes("MB")) return val * 1024 * 1024
    if (unit.includes("KB")) return val * 1024
    return val 
  }

  const fetchItems = async (path: string = currentPath) => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      setItems(data.items || [])
      if (data.stats) {
        setStats(data.stats)
      }
      // Mark folders without password as unlocked
      const updatedUnlocked = new Set(unlockedFolders)
      data.items.forEach((item: StorageItem) => {
        if (item.type === "folder" && !item.locked) {
          updatedUnlocked.add(item.path)
        }
      })
      setUnlockedFolders(updatedUnlocked)
      if (data.items && data.items.length > 0 && !selectedItem) {
        setSelectedItem(data.items[0])
      }
    } catch (err) {
      console.error("Failed to connect to Flask backend:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadText = async () => {
      try {
        const res = await fetch(`${API_BASE}/text`)
        const data = await res.json()
        if (!cancelled && data.text) setSharedText(data.text)
      } catch (err) {
        console.error("Failed to load shared text:", err)
      }
    }

    loadText()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchItems(currentPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath])

  useEffect(() => {
    if (selectedItem?.type !== "code") return
    let cancelled = false

    const loadCode = async () => {
      setIsLoadingCode(true)
      try {
        const res = await fetch(`${API_BASE}/content?path=${encodeURIComponent(selectedItem.path)}`)
        const data = await res.json()
        if (!cancelled) setCodeContent(data.content || "")
      } catch {
        if (!cancelled) setCodeContent("Error loading code preview.")
      } finally {
        if (!cancelled) setIsLoadingCode(false)
      }
    }

    loadCode()
    return () => { cancelled = true }
  }, [selectedItem])

  const handleSaveText = async () => {
    setIsSavingText(true)
    try {
      await fetch(`${API_BASE}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sharedText }),
      })
    } catch (err) {
      console.error("Failed to save text:", err)
    } finally {
      setIsSavingText(false)
    }
  }

  const handleCopyText = () => {
    navigator.clipboard.writeText(sharedText)
    setTextCopied(true)
    setTimeout(() => setTextCopied(false), 2000)
  }

  const countData = useMemo(() => {
    return types.map(t => ({
      type: t,
      value: stats.counts[t] || 0,
      fill: `var(--color-${t})`
    }))
  }, [stats, types])

  const sizeData = useMemo(() => {
    return types.map(t => ({
      type: t,
      value: Number((stats.sizes[t] || 0).toFixed(2)),
      fill: `var(--color-${t})`
    }))
  }, [stats, types])

  const activeIndex = useMemo(
    () => countData.findIndex((item) => item.type === activeType),
    [activeType, countData]
  )

  const handleRealUpload = async () => {
    if (selectedUploadFiles.length === 0) return
    setIsUploading(true)

    const formData = new FormData()
    selectedUploadFiles.forEach(file => {
      formData.append("files", file)
    })
    formData.append("path", currentPath)

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        setUploadComplete(true)
        setSelectedUploadFiles([])
        await fetchItems(currentPath)
        setTimeout(() => {
          setIsUploadOpen(false)
          setUploadComplete(false)
        }, 1200)
      }
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDelete = async (item: StorageItem) => {
    setIsDeleting(true)
    try {
      const endpoint = item.type === "folder" ? "folders" : "files"
      const res = await fetch(`${API_BASE}/${endpoint}?path=${encodeURIComponent(item.path)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        await fetchItems(currentPath)
        if (selectedItem?.id === item.id) {
          setSelectedItem(null)
        }
        setSelectedIds(prev => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      }
    } catch (err) {
      console.error("Delete failed:", err)
    } finally {
      setIsDeleting(false)
      setItemToDelete(null)
    }
  }

  const handleDownload = (item: StorageItem) => {
    window.open(`${API_BASE}/download?path=${encodeURIComponent(item.path)}`, "_blank")
  }

  const filteredItems = useMemo(() => items.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())), [items, searchQuery])

  // Selection helpers
  const toggleSelection = (item: StorageItem, shiftKey: boolean = false) => {
    if (shiftKey && lastSelectedId) {
      const ids = filteredItems.map(i => i.id)
      const currentIdx = ids.indexOf(item.id)
      const lastIdx = ids.indexOf(lastSelectedId)
      if (currentIdx !== -1 && lastIdx !== -1) {
        const start = Math.min(currentIdx, lastIdx)
        const end = Math.max(currentIdx, lastIdx)
        const rangeIds = ids.slice(start, end + 1)
        setSelectedIds(prev => {
          const next = new Set(prev)
          rangeIds.forEach(id => next.add(id))
          return next
        })
        setLastSelectedId(item.id)
        return
      }
    }
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    setLastSelectedId(item.id)
  }

  const selectAll = useCallback(() => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)))
    }
  }, [selectedIds, filteredItems])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const selectedItems = useMemo(() => items.filter(i => selectedIds.has(i.id)), [items, selectedIds])

  // Move / Copy API helpers
  const handleMove = async (sources: string[], destination: string) => {
    if (!sources.length) return
    setIsMoving(true)
    try {
      const res = await fetch(`${API_BASE}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, destination }),
      })
      const data = await res.json()
      if (res.ok) {
        await fetchItems(currentPath)
        clearSelection()
        if (data.errors?.length) {
          alert("Move completed with errors:\n" + data.errors.join("\n"))
        }
      } else {
        alert(data.error || "Move failed")
      }
    } catch (err) {
      console.error("Move failed:", err)
      alert("Move failed")
    } finally {
      setIsMoving(false)
    }
  }

  const handleDuplicate = async (item: StorageItem) => {
    await handleCopyTo([item.path], currentPath)
  }

  const handleCopyTo = async (sources: string[], destination: string) => {
    if (!sources.length) return
    setIsCopying(true)
    try {
      const res = await fetch(`${API_BASE}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources, destination }),
      })
      const data = await res.json()
      if (res.ok) {
        await fetchItems(currentPath)
        clearSelection()
        if (data.errors?.length) {
          alert("Copy completed with errors:\n" + data.errors.join("\n"))
        }
      } else {
        alert(data.error || "Copy failed")
      }
    } catch (err) {
      console.error("Copy failed:", err)
      alert("Copy failed")
    } finally {
      setIsCopying(false)
    }
  }

  // Clipboard copy/cut
  const handleCopyToClipboard = useCallback((itemsToCopy: StorageItem[], mode: "copy" | "cut") => {
    setClipboard({ items: itemsToCopy, mode })
  }, [])

  const handlePaste = useCallback(async () => {
    if (!clipboard || clipboard.items.length === 0) return
    const sources = clipboard.items.map(i => i.path)
    if (clipboard.mode === "cut") {
      await handleMove(sources, currentPath)
      setClipboard(null)
    } else {
      await handleCopyTo(sources, currentPath)
    }
  }, [clipboard, currentPath, handleMove, handleCopyTo])

  // Keyboard shortcuts for file operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
      if (isTyping) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        selectAll()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault()
        if (selectedItems.length > 0) handleCopyToClipboard(selectedItems, "copy")
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        e.preventDefault()
        if (selectedItems.length > 0) handleCopyToClipboard(selectedItems, "cut")
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault()
        handlePaste()
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedItems.length > 0) {
          e.preventDefault()
          setItemToDelete(selectedItems[0])
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedItems, clipboard, currentPath, selectAll, handleCopyToClipboard, handlePaste])

  // Folder tree for move/copy dialogs
  const fetchFolderTree = async () => {
    try {
      const res = await fetch(`${API_BASE}/folders/tree`)
      const data = await res.json()
      setFolderTree(data || [])
    } catch (err) {
      console.error("Failed to load folder tree:", err)
    }
  }

  const openMoveDialog = async (itemsToMove: StorageItem[]) => {
    setMoveItems(itemsToMove)
    setMoveTargetPath(currentPath)
    setExpandedPaths(new Set([currentPath]))
    setIsMoveDialogOpen(true)
    await fetchFolderTree()
  }

  const confirmMove = async () => {
    await handleMove(moveItems.map(i => i.path), moveTargetPath)
    setIsMoveDialogOpen(false)
    setMoveItems([])
  }

  const confirmCopyTo = async () => {
    await handleCopyTo(moveItems.map(i => i.path), moveTargetPath)
    setIsMoveDialogOpen(false)
    setMoveItems([])
  }

  // File rename
  const handleRenameFile = async () => {
    if (!fileToRename || !renameFileName.trim()) return
    setIsRenamingFile(true)
    try {
      const res = await fetch(`${API_BASE}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fileToRename.path, newName: renameFileName.trim() }),
      })
      if (res.ok) {
        setFileToRename(null)
        setRenameFileName("")
        await fetchItems(currentPath)
      } else {
        const err = await res.json()
        alert(err.error || "Failed to rename file")
      }
    } catch (err) {
      console.error("Rename file failed:", err)
    } finally {
      setIsRenamingFile(false)
    }
  }

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, item: StorageItem) => {
    e.preventDefault()
    setSelectedItem(item)
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  const closeContextMenu = () => setContextMenu(null)

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: StorageItem) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(item))
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDropOnFolder = (e: React.DragEvent, folder: StorageItem) => {
    e.preventDefault()
    e.stopPropagation()
    const raw = e.dataTransfer.getData("text/plain")
    if (!raw) return
    try {
      const dragged: StorageItem = JSON.parse(raw)
      if (dragged.path === folder.path) return
      if (dragged.type === "folder" && folder.path.startsWith(dragged.path + "/")) return
      handleMove([dragged.path], folder.path)
    } catch {
      // ignore
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    setIsCreatingFolder(true)
    try {
      const res = await fetch(`${API_BASE}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name: newFolderName.trim() }),
      })
      if (res.ok) {
        setNewFolderName("")
        setIsCreateFolderOpen(false)
        await fetchItems(currentPath)
      } else {
        const err = await res.json()
        alert(err.error || "Failed to create folder")
      }
    } catch (err) {
      console.error("Create folder failed:", err)
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const handleRenameFolder = async () => {
    if (!folderToRename || !renameFolderName.trim()) return
    setIsRenamingFolder(true)
    try {
      const res = await fetch(`${API_BASE}/folders`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderToRename.path, newName: renameFolderName.trim() }),
      })
      if (res.ok) {
        setFolderToRename(null)
        setRenameFolderName("")
        await fetchItems(currentPath)
      } else {
        const err = await res.json()
        alert(err.error || "Failed to rename folder")
      }
    } catch (err) {
      console.error("Rename folder failed:", err)
    } finally {
      setIsRenamingFolder(false)
    }
  }

  const handleSetFolderPassword = async () => {
    if (!folderToPassword || !folderPassword) return
    setIsSettingPassword(true)
    try {
      const res = await fetch(`${API_BASE}/folders/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderToPassword.path, password: folderPassword }),
      })
      if (res.ok) {
        setFolderToPassword(null)
        setFolderPassword("")
        // Remove from unlocked set if it was there
        const updated = new Set(unlockedFolders)
        updated.delete(folderToPassword.path)
        setUnlockedFolders(updated)
        await fetchItems(currentPath)
      } else {
        const err = await res.json()
        alert(err.error || "Failed to set password")
      }
    } catch (err) {
      console.error("Set password failed:", err)
    } finally {
      setIsSettingPassword(false)
    }
  }

  const handleRemoveFolderPassword = async (item: StorageItem) => {
    try {
      const res = await fetch(`${API_BASE}/folders/password?path=${encodeURIComponent(item.path)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        const updated = new Set(unlockedFolders)
        updated.add(item.path)
        setUnlockedFolders(updated)
        await fetchItems(currentPath)
      }
    } catch (err) {
      console.error("Remove password failed:", err)
    }
  }

  const handleUnlockFolder = async () => {
    if (!folderToUnlock) return
    setIsUnlocking(true)
    setUnlockError("")
    try {
      const res = await fetch(`${API_BASE}/folders/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderToUnlock.path, password: unlockPassword }),
      })
      if (res.ok) {
        const updated = new Set(unlockedFolders)
        updated.add(folderToUnlock.path)
        setUnlockedFolders(updated)
        setFolderToUnlock(null)
        setUnlockPassword("")
        await fetchItems(currentPath)
      } else {
        const err = await res.json()
        setUnlockError(err.error || "Unlock failed")
      }
    } catch (err) {
      console.error("Unlock folder failed:", err)
      setUnlockError("Unlock failed")
    } finally {
      setIsUnlocking(false)
    }
  }

  const navigateToFolder = (item: StorageItem) => {
    if (item.type !== "folder") return
    if (item.locked && !unlockedFolders.has(item.path)) {
      setFolderToUnlock(item)
      return
    }
    setCurrentPath(item.path)
    setSelectedItem(null)
  }

  const navigateUp = () => {
    if (!currentPath) return
    const parts = currentPath.split("/").filter(Boolean)
    parts.pop()
    setCurrentPath(parts.join("/"))
    setSelectedItem(null)
  }

  const navigateToPath = (path: string) => {
    setCurrentPath(path)
    setSelectedItem(null)
  }

  const breadcrumbParts = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean)
    const result: { name: string; path: string }[] = []
    let built = ""
    parts.forEach(part => {
      built = built ? `${built}/${part}` : part
      result.push({ name: part, path: built })
    })
    return result
  }, [currentPath])

  const getItemIcon = (item: StorageItem) => {
    if (item.type === "folder") {
      if (item.locked && !unlockedFolders.has(item.path)) {
        return <Folder className="w-4 h-4 text-amber-500" />
      }
      return <FolderOpen className="w-4 h-4 text-blue-500" />
    }
    switch (item.type) {
      case "pdf": return <FileText className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "code": return <FileCode className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "spreadsheet": return <FileSpreadsheet className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "image": return <FileImage className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "video": return <FileVideo className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "audio": return <Music className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      default: return <File className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    }
  }

  // Colorful syntax highlighter helper for first 20 lines (non-scrollable)
  const renderHighlightedCode = (code: string) => {
    const lines = code.split("\n").slice(0, 20)
    return lines.map((line, lineIdx) => {
      const parts = line.split(/(\s+|[()[\]{},:;=+\-*/<>!&|.%]+|["'].*?["']|#.*|\/\/.*)/g)
      return (
        <div key={lineIdx} className="table-row font-mono text-[10px] leading-tight">
          <span className="table-cell text-right pr-2 select-none text-zinc-600 dark:text-zinc-700 w-5">{lineIdx + 1}</span>
          <span className="table-cell whitespace-pre">
            {parts.map((part, i) => {
              if (!part) return null
              if (part.startsWith("#") || part.startsWith("//")) {
                return <span key={i} className="text-zinc-500 italic">{part}</span>
              }
              if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
                return <span key={i} className="text-emerald-400">{part}</span>
              }
              if (/^(import|from|def|class|return|const|let|var|function|if|else|for|while|try|except|async|await|true|false|None|null|undefined)$/.test(part.trim())) {
                return <span key={i} className="text-purple-400 font-semibold">{part}</span>
              }
              if (/^\d+(\.\d+)?$/.test(part.trim())) {
                return <span key={i} className="text-amber-400">{part}</span>
              }
              return <span key={i} className="text-zinc-200">{part}</span>
            })}
          </span>
        </div>
      )
    })
  }

  const totalSizeBytes = useMemo(() => {
    return Object.values(stats.sizes).reduce((acc, v) => acc + v * 1024 * 1024, 0)
  }, [stats])
  const totalSizeMB = Number((totalSizeBytes / (1024 * 1024)).toFixed(1))
  const limitGB = 100
  const limitMB = limitGB * 1024
  const usagePercentage = Math.min((totalSizeMB / limitMB) * 100, 100)

  const fileCount = useMemo(() => {
    return Object.values(stats.counts).reduce((acc, v) => acc + v, 0)
  }, [stats])

  const previewAspectRatio =
    selectedItem?.type === "code" || selectedItem?.type === "spreadsheet" || selectedItem?.type === "audio"
      ? 4 / 3
      : aspectRatio

  const formatDate = (ts: string) => {
    const num = Number(ts)
    if (!num) return "—"
    return new Date(num * 1000).toLocaleString()
  }

  function toggleExpanded(path: string) {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function renderFolderTree(nodes: FolderTreeNode[], parentPath: string, depth = 0) {
    return nodes.map(node => {
      const isExpanded = expandedPaths.has(node.path)
      const isSelected = moveTargetPath === node.path
      const isDisabled = moveItems.some(i => i.path === node.path || (i.type === "folder" && node.path.startsWith(i.path + "/")))
      const hasChildren = node.children && node.children.length > 0
      return (
        <div key={node.path} style={{ paddingLeft: depth * 16 }}>
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button 
                onClick={() => toggleExpanded(node.path)} 
                className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : <span className="w-5" />}
            <Button
              variant={isSelected ? "secondary" : "ghost"}
              size="sm"
              disabled={isDisabled}
              onClick={() => !isDisabled && setMoveTargetPath(node.path)}
              className={`flex-1 justify-start text-xs h-8 ${isDisabled ? "opacity-50" : ""}`}
            >
              <Folder className={`w-3.5 h-3.5 mr-2 ${isSelected ? "text-blue-500" : ""}`} />
              <span className="truncate">{node.name}</span>
              {isSelected && <Check className="w-3.5 h-3.5 ml-auto" />}
            </Button>
          </div>
          {isExpanded && hasChildren && (
            <div className="mt-1">
              {renderFolderTree(node.children, node.path, depth + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ubuntu Local Storage</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              RKHS is Connected, Enjoy :D
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-zinc-200 dark:border-zinc-800">
                  <Plus className="w-4 h-4 mr-2" /> New Folder
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Create New Folder</DialogTitle>
                  <DialogDescription>
                    Create a new folder inside {currentPath || "root"}.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Input
                    placeholder="Folder name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                    className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
                  />
                </div>
                <DialogFooter>
                  <Button 
                    onClick={handleCreateFolder} 
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    {isCreatingFolder ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {isCreatingFolder ? "Creating..." : "Create Folder"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger asChild>
                <Button className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                  <Upload className="w-4 h-4 mr-2" /> Upload Files
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Upload Files to {currentPath || "Root"}</DialogTitle>
                  <DialogDescription>
                    Select one or more files. They will be stored directly on the server filesystem.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <label className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center flex flex-col items-center justify-center cursor-pointer hover:border-zinc-400 transition-colors">
                    <Upload className="w-8 h-8 text-zinc-400 mb-2" />
                    <span className="text-sm font-medium">
                      {selectedUploadFiles.length > 0 
                        ? `${selectedUploadFiles.length} file(s) selected` 
                        : "Click to select files"}
                    </span>
                    <span className="text-xs text-zinc-500 mt-1">Supports multiple files</span>
                    <input 
                      type="file" 
                      multiple
                      className="hidden" 
                      onChange={(e) => {
                        if (e.target.files) {
                          setSelectedUploadFiles(Array.from(e.target.files))
                        }
                      }} 
                    />
                  </label>

                  {selectedUploadFiles.length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 p-2 space-y-1">
                      {selectedUploadFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                          <span className="truncate max-w-[200px]">{file.name}</span>
                          <button 
                            onClick={() => setSelectedUploadFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="text-zinc-400 hover:text-red-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {uploadComplete && (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-md">
                      <CheckCircle2 className="w-4 h-4" /> Uploaded successfully!
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button 
                    onClick={handleRealUpload} 
                    disabled={selectedUploadFiles.length === 0 || isUploading || uploadComplete}
                    className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {isUploading ? "Uploading to Server..." : uploadComplete ? "Done" : "Upload Files"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Separator className="bg-zinc-200 dark:bg-zinc-800" />

        {/* Top 3-Card Grid Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Storage Used</CardTitle>
              <HardDrive className="w-4 h-4 text-zinc-500" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-2xl font-bold">
                  {totalSizeMB >= 1024 ? `${(totalSizeMB / 1024).toFixed(2)} GB` : `${totalSizeMB} MB`} / {limitGB} GB
                </div>
                <p className="text-xs text-zinc-500 mt-1">Active files: {fileCount}</p>
              </div>
              <Progress value={usagePercentage} className="h-2 bg-zinc-100 dark:bg-zinc-800" />
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Active Network Peers</CardTitle>
              <Wifi className="w-4 h-4 text-emerald-500 animate-pulse" />
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-zinc-500" />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">Flask Server (Active)</span>
                </div>
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">Port 5000</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-zinc-500" />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">Client Frontend</span>
                </div>
                <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded">Connected</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
            <ChartStyle id={id} config={chartConfig} />
            <CardHeader className="flex flex-row items-center space-y-0 pb-1 justify-between">
              <div>
                <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Files Count & Size</CardTitle>
              </div>
              <Select value={activeType} onValueChange={setActiveType}>
                <SelectTrigger
                  className="h-6 w-[120px] rounded-md pl-2 text-[11px] bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
                  aria-label="Select type"
                >
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent align="end" className="rounded-xl bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  {types.map((key) => {
                    const config = chartConfig[key as keyof typeof chartConfig]
                    if (!config) return null
                    return (
                      <SelectItem key={key} value={key} className="rounded-lg text-xs">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex h-2 w-2 shrink-0 rounded-xs" style={{ backgroundColor: `var(--color-${key})` }} />
                          {config.label}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="flex flex-1 justify-between items-center pb-2 pt-0 gap-2">
              <div className="flex-1 text-center flex flex-col items-center">
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">Count</span>
                <div className="w-full max-w-[110px] aspect-square">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full h-full">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={countData}
                        dataKey="value"
                        nameKey="type"
                        innerRadius={22}
                        outerRadius={38}
                        strokeWidth={3}
                        activeIndex={activeIndex >= 0 ? activeIndex : 0}
                        activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
                          <g>
                            <Sector {...props} outerRadius={outerRadius + 3} />
                            <Sector {...props} outerRadius={outerRadius + 7} innerRadius={outerRadius + 4} />
                          </g>
                        )}
                      >
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox && countData[activeIndex]) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="text-xs font-bold fill-zinc-900 dark:fill-zinc-50">
                                    {countData[activeIndex].value}
                                  </tspan>
                                </text>
                              )
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>
              </div>

              <div className="h-20 w-[1px] bg-zinc-100 dark:bg-zinc-800 my-auto" />

              <div className="flex-1 text-center flex flex-col items-center">
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">Size (MB)</span>
                <div className="w-full max-w-[110px] aspect-square">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full h-full">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={sizeData}
                        dataKey="value"
                        nameKey="type"
                        innerRadius={22}
                        outerRadius={38}
                        strokeWidth={3}
                        activeIndex={activeIndex >= 0 ? activeIndex : 0}
                        activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
                          <g>
                            <Sector {...props} outerRadius={outerRadius + 3} />
                            <Sector {...props} outerRadius={outerRadius + 7} innerRadius={outerRadius + 4} />
                          </g>
                        )}
                      >
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox && sizeData[activeIndex]) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="text-xs font-bold fill-zinc-900 dark:fill-zinc-50">
                                    {sizeData[activeIndex].value}m
                                  </tspan>
                                </text>
                              )
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cross-Device Temp Clipboard & Larger Dynamic QR Code Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 lg:col-span-2 flex flex-col justify-between p-6">
            <CardHeader className="p-0 pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Cross-Device Temp Clipboard
              </CardTitle>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleCopyText}
                  className="text-xs h-7 border-zinc-200 dark:border-zinc-800"
                >
                  {textCopied ? "Copied!" : "Copy Text"}
                </Button>
                <Button 
                  size="sm" 
                  onClick={handleSaveText}
                  disabled={isSavingText}
                  className="text-xs h-7 bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                >
                  {isSavingText ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  Save to Server
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col">
              <textarea
                value={sharedText}
                onChange={(e) => setSharedText(e.target.value)}
                placeholder="Paste links, snippets, code, or notes here... Open your IP on another computer to view and copy them instantly."
                className="w-full flex-1 min-h-[140px] p-3 text-xs font-mono bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400 text-zinc-900 dark:text-zinc-100 resize-none"
              />
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col items-center justify-between p-6">
            <CardHeader className="p-0 pb-3 w-full">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400 text-center">
                Instant QR Code
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex flex-col items-center justify-center flex-1">
              {sharedText ? (
                <div className="bg-white p-3.5 rounded-lg border border-zinc-200 shadow-xs">
                  <QRCodeSVG value={sharedText} size={140} level="M" />
                </div>
              ) : (
                <div className="w-[140px] h-[140px] bg-zinc-50 dark:bg-zinc-950 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg flex items-center justify-center text-[10px] text-zinc-400 text-center p-2">
                  Type text to generate QR
                </div>
              )}
              <span className="text-[10px] text-zinc-400 mt-2.5 text-center">Scan with phone camera</span>
            </CardContent>
          </Card>
        </div>

        {/* Main Section: Table on Left & Preview Card on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 lg:col-span-2">
            <CardHeader className="flex flex-col gap-3 pb-4">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg font-semibold">Files Directory</CardTitle>
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                  <Input
                    type="search"
                    placeholder="Search files and folders..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-xs h-9"
                  />
                </div>
              </div>

              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigateToPath("")}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  <Home className="w-3 h-3" /> Root
                </Button>
                {breadcrumbParts.map((part, idx) => (
                  <div key={part.path} className="flex items-center">
                    <ChevronRight className="w-3 h-3" />
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => navigateToPath(part.path)}
                      className="h-7 px-2 text-xs"
                    >
                      {part.name}
                    </Button>
                  </div>
                ))}
                {currentPath && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={navigateUp}
                    className="h-7 px-2 gap-1 text-xs ml-auto"
                  >
                    <ArrowLeft className="w-3 h-3" /> Up
                  </Button>
                )}
              </div>

              {/* Bulk actions toolbar */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-top-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 px-2">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-zinc-200 dark:border-zinc-800"
                    onClick={() => openMoveDialog(selectedItems)}
                  >
                    <FolderInput className="w-3 h-3" /> Move
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-zinc-200 dark:border-zinc-800"
                    onClick={() => handleCopyToClipboard(selectedItems, "copy")}
                  >
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-zinc-200 dark:border-zinc-800"
                    onClick={() => handleCopyToClipboard(selectedItems, "cut")}
                  >
                    <Scissors className="w-3 h-3" /> Cut
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-red-600 dark:text-red-400 border-zinc-200 dark:border-zinc-800"
                    onClick={() => setItemToDelete(selectedItems[0])}
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs ml-auto"
                    onClick={clearSelection}
                  >
                    <X className="w-3 h-3" /> Clear
                  </Button>
                </div>
              )}

              {/* Clipboard paste bar */}
              {clipboard && (
                <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 animate-in fade-in slide-in-from-top-1">
                  <span className="text-xs text-blue-700 dark:text-blue-300 px-2">
                    {clipboard.mode === "cut" ? "Cut" : "Copied"} {clipboard.items.length} item{clipboard.items.length === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 border-blue-200 dark:border-blue-900/50"
                    onClick={handlePaste}
                  >
                    <ClipboardPaste className="w-3 h-3" /> Paste here
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs ml-auto text-blue-700 dark:text-blue-300"
                    onClick={() => setClipboard(null)}
                  >
                    <X className="w-3 h-3" /> Clear
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredItems.length > 0 && selectedIds.size === filteredItems.length}
                        onCheckedChange={selectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-[40%]">Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploader</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-zinc-500">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Connecting to Flask server...
                      </TableCell>
                    </TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-zinc-500">
                        No files or folders found in this directory.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => (
                      <TableRow 
                        key={item.id} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, item)}
                        onContextMenu={(e) => handleContextMenu(e, item)}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            e.preventDefault()
                            toggleSelection(item)
                            return
                          }
                          if (e.shiftKey) {
                            e.preventDefault()
                            toggleSelection(item, true)
                            return
                          }
                          if (item.type === "folder") {
                            navigateToFolder(item)
                          } else {
                            setSelectedItem(item)
                          }
                        }}
                        onDrop={item.type === "folder" ? (e) => handleDropOnFolder(e, item) : undefined}
                        onDragOver={item.type === "folder" ? handleDragOver : undefined}
                        className={`border-zinc-200 dark:border-zinc-800 cursor-pointer transition-colors ${selectedItem?.id === item.id ? 'bg-zinc-100/80 dark:bg-zinc-800/60' : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30'} ${item.type === "folder" ? 'droppable-folder' : ''}`}
                      >
                        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelection(item)}
                            aria-label={`Select ${item.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium flex items-center gap-3">
                          <GripVertical className="w-3 h-3 text-zinc-400 cursor-grab active:cursor-grabbing" />
                          {getItemIcon(item)}
                          <span className="truncate max-w-[180px]">{item.name}</span>
                          {item.type === "folder" && item.locked && !unlockedFolders.has(item.path) && (
                            <Lock className="w-3 h-3 text-amber-500" />
                          )}
                        </TableCell>
                        <TableCell className="text-zinc-500 dark:text-zinc-400 text-xs">
                          {item.type === "folder" ? "—" : item.size}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                            {item.uploader}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="border-zinc-200 dark:border-zinc-800">
                              {item.type === "folder" ? (
                                <>
                                  <DropdownMenuItem onClick={() => navigateToFolder(item)} className="cursor-pointer gap-2">
                                    <FolderOpen className="w-4 h-4" /> Open
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setFolderToRename(item); setRenameFolderName(item.name) }} className="cursor-pointer gap-2">
                                    <Edit3 className="w-4 h-4" /> Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openMoveDialog([item])} className="cursor-pointer gap-2">
                                    <FolderInput className="w-4 h-4" /> Move to...
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyToClipboard([item], "copy")} className="cursor-pointer gap-2">
                                    <Copy className="w-4 h-4" /> Copy
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicate(item)} className="cursor-pointer gap-2">
                                    <RefreshCw className="w-4 h-4" /> Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setFolderToPassword(item); setFolderPassword("") }} className="cursor-pointer gap-2">
                                    <KeyRound className="w-4 h-4" /> {item.locked ? "Change Password" : "Set Password"}
                                  </DropdownMenuItem>
                                  {item.locked && (
                                    <DropdownMenuItem onClick={() => handleRemoveFolderPassword(item)} className="cursor-pointer gap-2">
                                      <Unlock className="w-4 h-4" /> Remove Password
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => setItemToDelete(item)} className="cursor-pointer gap-2 text-red-600 dark:text-red-400">
                                    <Trash2 className="w-4 h-4" /> Delete
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem onClick={() => handleDownload(item)} className="cursor-pointer gap-2">
                                    <Download className="w-4 h-4" /> Download
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setFileToRename(item); setRenameFileName(item.name) }} className="cursor-pointer gap-2">
                                    <Edit3 className="w-4 h-4" /> Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openMoveDialog([item])} className="cursor-pointer gap-2">
                                    <FolderInput className="w-4 h-4" /> Move to...
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyToClipboard([item], "copy")} className="cursor-pointer gap-2">
                                    <Copy className="w-4 h-4" /> Copy
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyToClipboard([item], "cut")} className="cursor-pointer gap-2">
                                    <Scissors className="w-4 h-4" /> Cut
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicate(item)} className="cursor-pointer gap-2">
                                    <RefreshCw className="w-4 h-4" /> Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => setItemToDelete(item)} className="cursor-pointer gap-2 text-red-600 dark:text-red-400">
                                    <Trash2 className="w-4 h-4" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Right: File Preview Card */}
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">File Inspector</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedItem && selectedItem.type !== "folder" ? (
                <>
                  <div 
                    className="w-full bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center overflow-hidden relative transition-all duration-300"
                    style={{ aspectRatio: `${previewAspectRatio}` }}
                  >
                    {selectedItem.type === "image" ? (
                      <img 
                        src={`${API_BASE}/download?path=${encodeURIComponent(selectedItem.path)}`} 
                        alt={selectedItem.name} 
                        className="w-full h-full object-contain"
                        onLoad={(e) => {
                          const img = e.currentTarget
                          if (img.naturalWidth && img.naturalHeight) {
                            setAspectRatio(img.naturalWidth / img.naturalHeight)
                          }
                        }}
                      />
                    ) : selectedItem.type === "video" ? (
                      <video 
                        src={`${API_BASE}/download?path=${encodeURIComponent(selectedItem.path)}`} 
                        controls
                        className="w-full h-full object-contain bg-black"
                      />
                    ) : selectedItem.type === "audio" ? (
                      <div className="flex flex-col items-center justify-center p-6 w-full space-y-4">
                        <div className="p-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-full">
                          <Music className="w-8 h-8 text-zinc-700 dark:text-zinc-300 animate-pulse" />
                        </div>
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[220px]">
                          {selectedItem.name}
                        </span>
                        <audio 
                          src={`${API_BASE}/download?path=${encodeURIComponent(selectedItem.path)}`} 
                          controls 
                          className="w-full max-w-[260px] h-10"
                        />
                      </div>
                    ) : selectedItem.type === "code" ? (
                      <div className="w-full h-full flex flex-col bg-zinc-950 text-zinc-50 font-mono text-[10px] overflow-hidden select-text">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[10px]">
                          <span>{selectedItem.name}</span>
                          <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">First 20 Lines</span>
                        </div>
                        <div className="p-2 overflow-hidden flex-1">
                          {isLoadingCode ? (
                            <div className="flex items-center justify-center h-full text-zinc-500">
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading code...
                            </div>
                          ) : (
                            renderHighlightedCode(codeContent)
                          )}
                        </div>
                      </div>
                    ) : selectedItem.type === "pdf" ? (
                      <div className="w-full h-full flex items-center justify-center bg-white dark:bg-zinc-900 overflow-hidden [&_canvas]:max-w-full [&_canvas]:max-h-full [&_canvas]:w-full [&_canvas]:h-auto">
                        <Document
                          file={`${API_BASE}/download?path=${encodeURIComponent(selectedItem.path)}`}
                          loading={
                            <div className="flex items-center justify-center text-xs text-zinc-400 p-4">
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading PDF...
                            </div>
                          }
                          error={
                            <div className="flex flex-col items-center justify-center p-4 text-center text-xs text-red-500">
                              <FileText className="w-6 h-6 mb-1 opacity-60" />
                              Failed to load PDF file.
                            </div>
                          }
                        >
                          <Page 
                            pageNumber={1} 
                            width={400} 
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            onLoadSuccess={(page) => {
                              if (page.width && page.height) {
                                setAspectRatio(page.width / page.height)
                              }
                            }}
                          />
                        </Document>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-center">
                        <div className="p-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-2xl mb-3 border border-zinc-300/40 dark:border-zinc-700/40 shadow-xs">
                          {getItemIcon(selectedItem)}
                        </div>
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
                          {selectedItem.name}
                        </span>
                        <span className="text-[10px] text-zinc-400 mt-1 uppercase tracking-wider bg-zinc-200/60 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                          {selectedItem.type} preview unavailable
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">File Name:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[180px]">{selectedItem.name}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">File Size:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedItem.size}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">Uploader:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedItem.uploader}</span>
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
                    <Button onClick={() => handleDownload(selectedItem)} variant="outline" size="sm" className="w-full text-xs h-8 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <Download className="w-3 h-3 mr-1.5" /> Download
                    </Button>
                    <Button onClick={() => setItemToDelete(selectedItem)} variant="outline" size="sm" className="w-full text-xs h-8 text-red-600 dark:text-red-400 border-zinc-200 dark:border-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/30">
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

        </div>

      </div>

      {/* Rename Folder Dialog */}
      <Dialog open={!!folderToRename} onOpenChange={(open) => !open && setFolderToRename(null)}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Rename folder <strong>{folderToRename?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="New folder name"
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameFolder()}
              className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
            />
          </div>
          <DialogFooter>
            <Button 
              onClick={handleRenameFolder} 
              disabled={!renameFolderName.trim() || isRenamingFolder}
              className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isRenamingFolder ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isRenamingFolder ? "Renaming..." : "Rename Folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Password Dialog */}
      <Dialog open={!!folderToPassword} onOpenChange={(open) => !open && setFolderToPassword(null)}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle>{folderToPassword?.locked ? "Change" : "Set"} Folder Password</DialogTitle>
            <DialogDescription>
              Protect <strong>{folderToPassword?.name}</strong> with a password. You will need to enter it to open this folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              placeholder="Password"
              value={folderPassword}
              onChange={(e) => setFolderPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetFolderPassword()}
              className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
            />
          </div>
          <DialogFooter>
            <Button 
              onClick={handleSetFolderPassword} 
              disabled={!folderPassword || isSettingPassword}
              className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isSettingPassword ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isSettingPassword ? "Setting..." : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Folder Dialog */}
      <Dialog open={!!folderToUnlock} onOpenChange={(open) => { if (!open) { setFolderToUnlock(null); setUnlockPassword(""); setUnlockError("") } }}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-500" /> Locked Folder
            </DialogTitle>
            <DialogDescription>
              Enter the password to open <strong>{folderToUnlock?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              placeholder="Password"
              value={unlockPassword}
              onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError("") }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlockFolder()}
              className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
            />
            {unlockError && (
              <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 dark:bg-red-950/30 p-2 rounded">
                <AlertTriangle className="w-3 h-3" /> {unlockError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              onClick={handleUnlockFolder} 
              disabled={!unlockPassword || isUnlocking}
              className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isUnlocking ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isUnlocking ? "Unlocking..." : "Unlock Folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-4 h-4" /> Delete {itemToDelete?.type === "folder" ? "Folder" : "File"}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{itemToDelete?.name}</strong>? {itemToDelete?.type === "folder" && "This will delete all files and subfolders inside it."} This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemToDelete(null)} className="border-zinc-200 dark:border-zinc-800">
              Cancel
            </Button>
            <Button 
              onClick={() => itemToDelete && handleDelete(itemToDelete)} 
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Rename Dialog */}
      <Dialog open={!!fileToRename} onOpenChange={(open) => !open && setFileToRename(null)}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Rename file <strong>{fileToRename?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="New file name"
              value={renameFileName}
              onChange={(e) => setRenameFileName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameFile()}
              className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
            />
          </div>
          <DialogFooter>
            <Button 
              onClick={handleRenameFile} 
              disabled={!renameFileName.trim() || isRenamingFile}
              className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isRenamingFile ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isRenamingFile ? "Renaming..." : "Rename File"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move / Copy Destination Dialog */}
      <Dialog open={isMoveDialogOpen} onOpenChange={(open) => { if (!open) { setIsMoveDialogOpen(false); setMoveItems([]); setMoveTargetPath("") } }}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderInput className="w-4 h-4" /> Move or Copy Items
            </DialogTitle>
            <DialogDescription>
              {moveItems.length} item{moveItems.length === 1 ? "" : "s"} selected. Choose a destination folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 max-h-[300px] overflow-hidden">
              <ScrollArea className="h-[260px]">
                <div className="space-y-1">
                  <Button
                    variant={moveTargetPath === "" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setMoveTargetPath("")}
                    className="w-full justify-start text-xs h-8"
                  >
                    <Home className="w-3.5 h-3.5 mr-2" /> Root
                  </Button>
                  {renderFolderTree(folderTree, "")}
                </div>
              </ScrollArea>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Destination: <strong>{moveTargetPath === "" ? "Root" : moveTargetPath}</strong>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2">
            <Button 
              onClick={confirmMove} 
              disabled={isMoving || moveItems.some(i => i.path === moveTargetPath || (i.type === "folder" && moveTargetPath.startsWith(i.path + "/")))}
              className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {isMoving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FolderInput className="w-4 h-4 mr-2" />}
              {isMoving ? "Moving..." : "Move Here"}
            </Button>
            <Button 
              onClick={confirmCopyTo} 
              disabled={isCopying || moveItems.some(i => i.path === moveTargetPath)}
              variant="outline"
              className="w-full border-zinc-200 dark:border-zinc-800"
            >
              {isCopying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {isCopying ? "Copying..." : "Copy Here"}
            </Button>
            <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)} className="w-full border-zinc-200 dark:border-zinc-800">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 min-w-[180px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg p-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={closeContextMenu}
        >
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 px-2 py-1 truncate max-w-[220px]">
            {contextMenu.item.name}
          </div>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1" />
          {contextMenu.item.type === "folder" && (
            <button onClick={() => { navigateToFolder(contextMenu.item); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
              <FolderOpen className="w-3.5 h-3.5" /> Open
            </button>
          )}
          <button onClick={() => { openMoveDialog([contextMenu.item]); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <FolderInput className="w-3.5 h-3.5" /> Move to...
          </button>
          <button onClick={() => { handleCopyToClipboard([contextMenu.item], "copy"); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button onClick={() => { handleCopyToClipboard([contextMenu.item], "cut"); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <Scissors className="w-3.5 h-3.5" /> Cut
          </button>
          <button onClick={() => { handleDuplicate(contextMenu.item); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <RefreshCw className="w-3.5 h-3.5" /> Duplicate
          </button>
          <button onClick={() => { 
            if (contextMenu.item.type === "folder") { setFolderToRename(contextMenu.item); setRenameFolderName(contextMenu.item.name); }
            else { setFileToRename(contextMenu.item); setRenameFileName(contextMenu.item.name); }
            closeContextMenu(); 
          }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <Edit3 className="w-3.5 h-3.5" /> Rename
          </button>
          <button onClick={() => { handleDownload(contextMenu.item); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1" />
          <button onClick={() => { setItemToDelete(contextMenu.item); closeContextMenu(); }} className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-red-600 dark:text-red-400">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
     </div>
  )
}
