"use client"

import { useState, useMemo, useEffect } from "react"
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
  CheckCircle2,
  Laptop,
  Wifi,
  Loader2
} from "lucide-react"
import { Label, Pie, PieChart, Sector } from "recharts"

import { PieSectorDataItem } from "recharts/types/polar/Pie"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
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

// Configure PDF.js worker safely using local package import URL to prevent mismatch and fetch failures
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface FileItem {
  id: string
  name: string
  size: string
  sizeBytes?: number
  type: "pdf" | "code" | "spreadsheet" | "image"
  uploader: string
  updatedAt: string
}

// Dynamically use the current host so it works seamlessly on local network (e.g. phones/other laptops)
const API_BASE = typeof window !== "undefined" 
  ? `http://${window.location.hostname}:5000/api` 
  : "http://localhost:5000/api"

const chartConfig = {
  value: {
    label: "Metric",
  },
  pdf: {
    label: "Documents",
    color: "#71717a",
  },
  code: {
    label: "Code",
    color: "#27272a",
  },
  spreadsheet: {
    label: "Spreadsheets",
    color: "#a1a1aa",
  },
  image: {
    label: "Images",
    color: "#d4d4d8",
  },
} satisfies ChartConfig

export default function FileManagerContent() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  
  // Aspect ratio state for dynamic preview box sizing (width / height)
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9)

  // Interactive Pie Chart State
  const id = "pie-interactive-file-types"
  const types = ["pdf", "code", "spreadsheet", "image"]
  const [activeType, setActiveType] = useState<string>("pdf")

  // Helper to parse bytes safely from backend response
  const getFileSizeBytes = (f: FileItem) => {
    if (f.sizeBytes && f.sizeBytes > 0) return f.sizeBytes
    if (!f.size) return 0
    const parts = f.size.split(" ")
    const val = parseFloat(parts[0]) || 0
    const unit = (parts[1] || "").toUpperCase()
    if (unit.includes("GB")) return val * 1024 * 1024 * 1024
    if (unit.includes("MB")) return val * 1024 * 1024
    if (unit.includes("KB")) return val * 1024
    return val // bytes
  }

  // Fetch files from Flask backend on load
  const fetchFiles = async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API_BASE}/files`)
      const data = await res.json()
      setFiles(data)
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0])
      }
    } catch (err) {
      console.error("Failed to connect to Flask backend:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  // Reset or adjust aspect ratio when selected file changes
  useEffect(() => {
    if (selectedFile?.type === "code" || selectedFile?.type === "spreadsheet") {
      setAspectRatio(4 / 3) // Standard default box for non-visual files
    }
  }, [selectedFile])

  // Calculate dynamic count data for Pie Chart 1
  const countData = useMemo(() => {
    const counts: Record<string, number> = { pdf: 0, code: 0, spreadsheet: 0, image: 0 }
    files.forEach(f => {
      if (counts[f.type] !== undefined) counts[f.type]++
    })
    return types.map(t => ({
      type: t,
      value: counts[t],
      fill: `var(--color-${t})`
    }))
  }, [files])

  // Calculate dynamic size data (in MB) for Pie Chart 2
  const sizeData = useMemo(() => {
    const sizes: Record<string, number> = { pdf: 0, code: 0, spreadsheet: 0, image: 0 }
    files.forEach(f => {
      if (sizes[f.type] !== undefined) {
        sizes[f.type] += getFileSizeBytes(f) / (1024 * 1024)
      }
    })
    return types.map(t => ({
      type: t,
      value: Number(sizes[t].toFixed(2)),
      fill: `var(--color-${t})`
    }))
  }, [files])

  const activeIndex = useMemo(
    () => countData.findIndex((item) => item.type === activeType),
    [activeType, countData]
  )

  // Upload Dialog States
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)

  const handleRealUpload = async () => {
    if (!selectedUploadFile) return
    setIsUploading(true)

    const formData = new FormData()
    formData.append("file", selectedUploadFile)

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        setUploadComplete(true)
        setSelectedUploadFile(null)
        await fetchFiles()
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

  const handleDelete = async (filename: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch(`${API_BASE}/files/${filename}`, {
        method: "DELETE",
      })
      if (res.ok) {
        await fetchFiles()
        if (selectedFile?.name === filename) {
          setSelectedFile(null)
        }
      }
    } catch (err) {
      console.error("Delete failed:", err)
    }
  }

  const handleDownload = (filename: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    window.open(`${API_BASE}/download/${filename}`, "_blank")
  }

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf": return <FileText className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "code": return <FileCode className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "spreadsheet": return <FileSpreadsheet className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      case "image": return <FileImage className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
      default: return <File className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
    }
  }

  // Total server storage calculation
  const totalSizeBytes = files.reduce((acc, f) => acc + getFileSizeBytes(f), 0)
  const totalSizeMB = Number((totalSizeBytes / (1024 * 1024)).toFixed(1))
  const limitGB = 100
  const limitMB = limitGB * 1024
  const usagePercentage = Math.min((totalSizeMB / limitMB) * 100, 100)

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ubuntu Local Storage</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Connected live to your Flask backend server (`/uploads`).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger asChild>
                <Button className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                  <Upload className="w-4 h-4 mr-2" /> Upload File
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Upload File to Flask Server</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <label className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center flex flex-col items-center justify-center cursor-pointer hover:border-zinc-400 transition-colors">
                    <Upload className="w-8 h-8 text-zinc-400 mb-2" />
                    <span className="text-sm font-medium">
                      {selectedUploadFile ? selectedUploadFile.name : "Click to select a file"}
                    </span>
                    <span className="text-xs text-zinc-500 mt-1">Stored directly on server filesystem</span>
                    <input 
                      type="file" 
                      className="hidden" 
                      onChange={(e) => e.target.files && setSelectedUploadFile(e.target.files[0])} 
                    />
                  </label>

                  {uploadComplete && (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-md">
                      <CheckCircle2 className="w-4 h-4" /> Uploaded successfully!
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button 
                    onClick={handleRealUpload} 
                    disabled={!selectedUploadFile || isUploading || uploadComplete}
                    className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {isUploading ? "Uploading to Server..." : uploadComplete ? "Done" : "Upload File"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Separator className="bg-zinc-200 dark:bg-zinc-800" />

        {/* Top 3-Card Grid Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Storage Meter */}
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
                <p className="text-xs text-zinc-500 mt-1">Active files: {files.length}</p>
              </div>
              <Progress value={usagePercentage} className="h-2 bg-zinc-100 dark:bg-zinc-800" />
            </CardContent>
          </Card>

          {/* Card 2: Connected Devices */}
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

          {/* Card 3: Dual Pie Charts (Count & Size) */}
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
              
              {/* Left Chart: File Count */}
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

              {/* Separator Line */}
              <div className="h-20 w-[1px] bg-zinc-100 dark:bg-zinc-800 my-auto" />

              {/* Right Chart: File Size */}
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

        {/* Main Section: Table on Left & Preview Card on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left: Files Table (Spans 2 columns) */}
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-lg font-semibold">Files Directory</CardTitle>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <Input
                  type="search"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-xs h-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-200 dark:border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-[40%]">Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploader</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-zinc-500">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Connecting to Flask server...
                      </TableCell>
                    </TableRow>
                  ) : filteredFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-zinc-500">
                        No files found in server directory.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFiles.map((file) => (
                      <TableRow 
                        key={file.id} 
                        onClick={() => setSelectedFile(file)}
                        className={`border-zinc-200 dark:border-zinc-800 cursor-pointer transition-colors ${selectedFile?.id === file.id ? 'bg-zinc-100/80 dark:bg-zinc-800/60' : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30'}`}
                      >
                        <TableCell className="font-medium flex items-center gap-3">
                          {getFileIcon(file.type)}
                          <span className="truncate max-w-[180px]">{file.name}</span>
                        </TableCell>
                        <TableCell className="text-zinc-500 dark:text-zinc-400 text-xs">{file.size}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                            {file.uploader}
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
                              <DropdownMenuItem onClick={() => handleDownload(file.name)} className="cursor-pointer gap-2">
                                <Download className="w-4 h-4" /> Download
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(file.name)} className="cursor-pointer gap-2 text-red-600 dark:text-red-400">
                                <Trash2 className="w-4 h-4" /> Delete
                              </DropdownMenuItem>
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
              {selectedFile ? (
                <>
                  <div 
                    className="w-full bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center overflow-hidden relative transition-all duration-300"
                    style={{ aspectRatio: `${aspectRatio}` }}
                  >
                    {selectedFile.type === "image" ? (
                      <img 
                        src={`${API_BASE}/download/${selectedFile.name}`} 
                        alt={selectedFile.name} 
                        className="w-full h-full object-contain"
                        onLoad={(e) => {
                          const img = e.currentTarget
                          if (img.naturalWidth && img.naturalHeight) {
                            setAspectRatio(img.naturalWidth / img.naturalHeight)
                          }
                        }}
                      />
                    ) : selectedFile.type === "pdf" ? (
                      <div className="w-full h-full flex items-center justify-center bg-white dark:bg-zinc-900 overflow-hidden [&_canvas]:max-w-full [&_canvas]:max-h-full [&_canvas]:w-full [&_canvas]:h-auto">
                        <Document
                          file={`${API_BASE}/download/${selectedFile.name}`}
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
                      <div className="flex flex-col items-center justify-center p-4 text-center">
                        <div className="p-3 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-full mb-2">
                          {getFileIcon(selectedFile.type)}
                        </div>
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
                          {selectedFile.name}
                        </span>
                        <span className="text-[10px] text-zinc-400 mt-0.5 uppercase tracking-wider">
                          {selectedFile.type} format
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">File Name:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[180px]">{selectedFile.name}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">File Size:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedFile.size}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">Uploader:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedFile.uploader}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/60">
                      <span className="text-zinc-400">Last Modified:</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {new Date(Number(selectedFile.updatedAt) * 1000).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-400 block mb-1">Server Path:</span>
                      <code className="text-[10px] bg-zinc-100 dark:bg-zinc-950 p-1.5 rounded block font-mono text-zinc-500 truncate">
                        ./uploads/{selectedFile.name}
                      </code>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={() => handleDownload(selectedFile.name)} variant="outline" size="sm" className="w-full text-xs h-8 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <Download className="w-3 h-3 mr-1.5" /> Download
                    </Button>
                    <Button onClick={() => handleDelete(selectedFile.name)} variant="outline" size="sm" className="w-full text-xs h-8 text-red-600 dark:text-red-400 border-zinc-200 dark:border-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/30">
                      <Trash2 className="w-3 h-3 mr-1.5" /> Delete
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-zinc-400 text-xs">
                  Select a file from the table to inspect details.
                </div>
              )}
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}