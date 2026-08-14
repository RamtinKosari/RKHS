// Shared types for the file manager

export type ItemType =
  | "pdf"
  | "code"
  | "spreadsheet"
  | "image"
  | "video"
  | "audio"
  | "folder"

export interface StorageItem {
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

export interface StatsData {
  counts: Record<string, number>
  sizes: Record<string, number>
}

export interface FolderTreeNode {
  name: string
  path: string
  children: FolderTreeNode[]
}

export interface ClipboardItem {
  items: StorageItem[]
  mode: "copy" | "cut"
}
