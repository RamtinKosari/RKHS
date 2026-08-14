"use client"

import { memo, useCallback, useMemo } from "react"
import {
  MoreVertical,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  Music,
  File,
  Folder,
  FolderOpen,
  Lock,
  Edit3,
  FolderInput,
  Copy,
  Scissors,
  RefreshCw,
  KeyRound,
  Unlock,
  Download,
  Trash2,
  GripVertical,
  Loader2,
} from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import type { StorageItem } from "@/lib/types"

interface FileTableProps {
  items: StorageItem[]
  searchQuery: string
  isLoading: boolean
  selectedItemId: string | null
  selectedIds: Set<string>
  unlockedFolders: Set<string>
  onSelectItem: (item: StorageItem) => void
  onToggleSelection: (item: StorageItem, shiftKey: boolean) => void
  onSelectAll: () => void
  onDownload: (item: StorageItem) => void
  onDelete: (item: StorageItem) => void
  onNavigateToFolder: (item: StorageItem) => void
  onRenameFile: (item: StorageItem) => void
  onRenameFolder: (item: StorageItem) => void
  onMoveDialog: (items: StorageItem[]) => void
  onCopyToClipboard: (items: StorageItem[], mode: "copy" | "cut") => void
  onDuplicate: (item: StorageItem) => void
  onSetPassword: (item: StorageItem) => void
  onRemovePassword: (item: StorageItem) => void
  onDragStart: (e: React.DragEvent, item: StorageItem) => void
  onContextMenu: (e: React.MouseEvent, item: StorageItem) => void
  onDropOnFolder: (e: React.DragEvent, folder: StorageItem) => void
  onDragOver: (e: React.DragEvent) => void
}

function getItemIcon(item: StorageItem, isUnlocked: boolean) {
  if (item.type === "folder") {
    if (item.locked && !isUnlocked) {
      return <Folder className="w-4 h-4 text-amber-500" />
    }
    return <FolderOpen className="w-4 h-4 text-blue-500" />
  }
  switch (item.type) {
    case "pdf":
      return <FileText className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "code":
      return <FileCode className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    case "spreadsheet":
      return (
        <FileSpreadsheet className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      )
    case "image":
      return (
        <FileImage className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      )
    case "video":
      return (
        <FileVideo className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      )
    case "audio":
      return <Music className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    default:
      return <File className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
  }
}

// Each row is its own memoized component. When `selectedItem` changes in the
// parent, only the two rows whose `isHighlighted` prop actually flips will
// re-render — the rest are skipped by React.memo. This is the main reason
// the table stays snappy on mobile with hundreds of files.
interface FileRowProps {
  item: StorageItem
  isHighlighted: boolean
  isChecked: boolean
  isUnlocked: boolean
  onSelect: (item: StorageItem) => void
  onToggle: (item: StorageItem, shiftKey: boolean) => void
  onDownload: (item: StorageItem) => void
  onDelete: (item: StorageItem) => void
  onNavigate: (item: StorageItem) => void
  onRenameFile: (item: StorageItem) => void
  onRenameFolder: (item: StorageItem) => void
  onMoveDialog: (items: StorageItem[]) => void
  onCopy: (items: StorageItem[], mode: "copy" | "cut") => void
  onDuplicate: (item: StorageItem) => void
  onSetPassword: (item: StorageItem) => void
  onRemovePassword: (item: StorageItem) => void
  onDragStart: (e: React.DragEvent, item: StorageItem) => void
  onContextMenu: (e: React.MouseEvent, item: StorageItem) => void
  onDropOnFolder: (e: React.DragEvent, folder: StorageItem) => void
  onDragOver: (e: React.DragEvent) => void
}

const FileRow = memo(function FileRow({
  item,
  isHighlighted,
  isChecked,
  isUnlocked,
  onSelect,
  onToggle,
  onDownload,
  onDelete,
  onNavigate,
  onRenameFile,
  onRenameFolder,
  onMoveDialog,
  onCopy,
  onDuplicate,
  onSetPassword,
  onRemovePassword,
  onDragStart,
  onContextMenu,
  onDropOnFolder,
  onDragOver,
}: FileRowProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        onToggle(item, false)
        return
      }
      if (e.shiftKey) {
        e.preventDefault()
        onToggle(item, true)
        return
      }
      if (item.type === "folder") {
        onNavigate(item)
      } else {
        onSelect(item)
      }
    },
    [item, onSelect, onToggle, onNavigate],
  )

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
    },
    [],
  )

  const handleDropdownClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleRowDragStart = useCallback(
    (e: React.DragEvent) => onDragStart(e, item),
    [item, onDragStart],
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, item),
    [item, onContextMenu],
  )

  const handleRowDrop = useCallback(
    (e: React.DragEvent) => onDropOnFolder(e, item),
    [item, onDropOnFolder],
  )

  const rowClassName =
    `border-zinc-200 dark:border-zinc-800 cursor-pointer transition-colors ` +
    (isHighlighted
      ? "bg-zinc-100/80 dark:bg-zinc-800/60 "
      : "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 ") +
    (item.type === "folder" ? "droppable-folder" : "")

  return (
    <TableRow
      draggable
      onDragStart={handleRowDragStart}
      onContextMenu={handleRowContextMenu}
      onClick={handleClick}
      onDrop={item.type === "folder" ? handleRowDrop : undefined}
      onDragOver={item.type === "folder" ? onDragOver : undefined}
      className={rowClassName}
    >
      <TableCell className="w-10" onClick={handleCheckboxClick}>
        <Checkbox
          checked={isChecked}
          onCheckedChange={() => onToggle(item, false)}
          aria-label={`Select ${item.name}`}
        />
      </TableCell>
      <TableCell className="font-medium flex items-center gap-3">
        <GripVertical className="w-3 h-3 text-zinc-400 cursor-grab active:cursor-grabbing" />
        {getItemIcon(item, isUnlocked)}
        <span className="truncate max-w-[180px]">{item.name}</span>
        {item.type === "folder" && item.locked && !isUnlocked && (
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
          <DropdownMenuTrigger asChild onClick={handleDropdownClick}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-zinc-200 dark:border-zinc-800"
          >
            {item.type === "folder" ? (
              <>
                <DropdownMenuItem
                  onClick={() => onNavigate(item)}
                  className="cursor-pointer gap-2"
                >
                  <FolderOpen className="w-4 h-4" /> Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onRenameFolder(item)}
                  className="cursor-pointer gap-2"
                >
                  <Edit3 className="w-4 h-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onMoveDialog([item])}
                  className="cursor-pointer gap-2"
                >
                  <FolderInput className="w-4 h-4" /> Move to...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCopy([item], "copy")}
                  className="cursor-pointer gap-2"
                >
                  <Copy className="w-4 h-4" /> Copy
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDuplicate(item)}
                  className="cursor-pointer gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onSetPassword(item)}
                  className="cursor-pointer gap-2"
                >
                  <KeyRound className="w-4 h-4" />{" "}
                  {item.locked ? "Change Password" : "Set Password"}
                </DropdownMenuItem>
                {item.locked && (
                  <DropdownMenuItem
                    onClick={() => onRemovePassword(item)}
                    className="cursor-pointer gap-2"
                  >
                    <Unlock className="w-4 h-4" /> Remove Password
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(item)}
                  className="cursor-pointer gap-2 text-red-600 dark:text-red-400"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => onDownload(item)}
                  className="cursor-pointer gap-2"
                >
                  <Download className="w-4 h-4" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onRenameFile(item)}
                  className="cursor-pointer gap-2"
                >
                  <Edit3 className="w-4 h-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onMoveDialog([item])}
                  className="cursor-pointer gap-2"
                >
                  <FolderInput className="w-4 h-4" /> Move to...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCopy([item], "copy")}
                  className="cursor-pointer gap-2"
                >
                  <Copy className="w-4 h-4" /> Copy
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCopy([item], "cut")}
                  className="cursor-pointer gap-2"
                >
                  <Scissors className="w-4 h-4" /> Cut
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDuplicate(item)}
                  className="cursor-pointer gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(item)}
                  className="cursor-pointer gap-2 text-red-600 dark:text-red-400"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
})

function FileRowEmpty({ colSpan, isLoading, isEmpty }: { colSpan: number; isLoading: boolean; isEmpty: boolean }) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="text-center py-12 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Connecting to Flask server...
        </TableCell>
      </TableRow>
    )
  }
  if (isEmpty) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="text-center py-8 text-zinc-500">
          No files or folders found in this directory.
        </TableCell>
      </TableRow>
    )
  }
  return null
}

export default function FileTable({
  items,
  searchQuery,
  isLoading,
  selectedItemId,
  selectedIds,
  unlockedFolders,
  onSelectItem,
  onToggleSelection,
  onSelectAll,
  onDownload,
  onDelete,
  onNavigateToFolder,
  onRenameFile,
  onRenameFolder,
  onMoveDialog,
  onCopyToClipboard,
  onDuplicate,
  onSetPassword,
  onRemovePassword,
  onDragStart,
  onContextMenu,
  onDropOnFolder,
  onDragOver,
}: FileTableProps) {
  const filteredItems = useMemo(
    () =>
      items.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [items, searchQuery],
  )

  const allSelected =
    filteredItems.length > 0 && selectedIds.size === filteredItems.length

  const handleSelectAllChecked = useCallback(() => {
    // The parent owns the toggle logic — we just trigger it.
    onSelectAll()
  }, [onSelectAll])

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900 shadow-[0_1px_0_0_rgb(228_228_231)] dark:shadow-[0_1px_0_0_rgb(39_39_42)]">
        <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-transparent">
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              onCheckedChange={handleSelectAllChecked}
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
        {isLoading || filteredItems.length === 0 ? (
          <FileRowEmpty
            colSpan={5}
            isLoading={isLoading}
            isEmpty={!isLoading && filteredItems.length === 0}
          />
        ) : (
          filteredItems.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              isHighlighted={selectedItemId === item.id}
              isChecked={selectedIds.has(item.id)}
              isUnlocked={
                item.type !== "folder" || !item.locked || unlockedFolders.has(item.path)
              }
              onSelect={onSelectItem}
              onToggle={onToggleSelection}
              onDownload={onDownload}
              onDelete={onDelete}
              onNavigate={onNavigateToFolder}
              onRenameFile={onRenameFile}
              onRenameFolder={onRenameFolder}
              onMoveDialog={onMoveDialog}
              onCopy={onCopyToClipboard}
              onDuplicate={onDuplicate}
              onSetPassword={onSetPassword}
              onRemovePassword={onRemovePassword}
              onDragStart={onDragStart}
              onContextMenu={onContextMenu}
              onDropOnFolder={onDropOnFolder}
              onDragOver={onDragOver}
            />
          ))
        )}
      </TableBody>
    </Table>
  )
}
