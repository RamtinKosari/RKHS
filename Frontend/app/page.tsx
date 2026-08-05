"use client"

import { useState, useMemo } from "react"
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
  Wifi
} from "lucide-react"
import { Label, Pie, PieChart, Sector } from "recharts"
import { PieSectorDataItem } from "recharts/types/polar/Pie"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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

interface FileItem {
  id: string
  name: string
  size: string
  type: "pdf" | "code" | "spreadsheet" | "image"
  uploader: string
  updatedAt: string
}

const initialFiles: FileItem[] = [
  { id: "1", name: "project_proposal.pdf", size: "2.4 MB", type: "pdf", uploader: "Ramtin", updatedAt: "2026-08-04 14:20" },
  { id: "2", name: "app.py", size: "4.1 KB", type: "code", uploader: "Ramtin", updatedAt: "2026-08-04 12:10" },
  { id: "3", name: "dataset_v1.csv", size: "45.2 MB", type: "spreadsheet", uploader: "Mahshid", updatedAt: "2026-08-03 19:45" },
  { id: "4", name: "architecture_diagram.png", size: "1.8 MB", type: "image", uploader: "Ramtin", updatedAt: "2026-08-01 09:15" },
]

// Data for File Count breakdown
const countData = [
  { type: "documents", value: 14, fill: "var(--color-documents)" },
  { type: "code", value: 8, fill: "var(--color-code)" },
  { type: "spreadsheets", value: 5, fill: "var(--color-spreadsheets)" },
  { type: "images", value: 10, fill: "var(--color-images)" },
]

// Data for File Size breakdown (in MB)
const sizeData = [
  { type: "documents", value: 18.5, fill: "var(--color-documents)" },
  { type: "code", value: 0.8, fill: "var(--color-code)" },
  { type: "spreadsheets", value: 45.2, fill: "var(--color-spreadsheets)" },
  { type: "images", value: 14.3, fill: "var(--color-images)" },
]

const chartConfig = {
  value: {
    label: "Metric",
  },
  documents: {
    label: "Documents",
    color: "#71717a",
  },
  code: {
    label: "Code",
    color: "#27272a",
  },
  spreadsheets: {
    label: "Spreadsheets",
    color: "#a1a1aa",
  },
  images: {
    label: "Images",
    color: "#d4d4d8",
  },
} satisfies ChartConfig

export default function FileManagerPage() {
  const [files, setFiles] = useState<FileItem[]>(initialFiles)
  const [searchQuery, setSearchQuery] = useState("")
  
  // Selected file for preview card
  const [selectedFile, setSelectedFile] = useState<FileItem>(initialFiles[0])

  // Interactive Pie Chart State
  const id = "pie-interactive-file-types"
  const [activeType, setActiveType] = useState(countData[0].type)

  const activeIndex = useMemo(
    () => countData.findIndex((item) => item.type === activeType),
    [activeType]
  )
  const types = useMemo(() => countData.map((item) => item.type), [])

  // Upload Dialog States
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)

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

  const handleSimulatedUpload = () => {
    setIsUploading(true)
    setUploadProgress(0)
    setUploadComplete(false)

    let progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval)
          setIsUploading(false)
          setUploadComplete(true)
          return 100
        }
        return prev + 20
      })
    }, 300)
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ubuntu Local Storage</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Manage, upload, and download files locally across your network.
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
                  <DialogTitle>Upload File to Server</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center cursor-pointer hover:border-zinc-400 transition-colors">
                    <Upload className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
                    <p className="text-sm font-medium">Click to select or drag files here</p>
                    <p className="text-xs text-zinc-500 mt-1">Any file type up to 2GB</p>
                  </div>

                  {isUploading && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-zinc-500">
                        <span>Uploading...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2 bg-zinc-100 dark:bg-zinc-800" />
                    </div>
                  )}

                  {uploadComplete && (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-md">
                      <CheckCircle2 className="w-4 h-4" /> File uploaded successfully!
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button 
                    onClick={handleSimulatedUpload} 
                    disabled={isUploading || uploadComplete}
                    className="w-full bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    {isUploading ? "Uploading..." : uploadComplete ? "Done" : "Start Upload"}
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
                <div className="text-2xl font-bold">49.4 MB / 500 GB</div>
                <p className="text-xs text-zinc-500 mt-1">Local path: /home/shared</p>
              </div>
              <Progress value={10} className="h-2 bg-zinc-100 dark:bg-zinc-800" />
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
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">Ubuntu Server (Host)</span>
                </div>
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">192.168.1.15</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-zinc-500" />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">MacBook Pro (Client)</span>
                </div>
                <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded">192.168.1.22</span>
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
            <CardContent className="flex flex-1 justify-between items-center pb-0 pt-0 gap-2">
              
              {/* Left Chart: File Count */}
              <div className="flex-1 text-center">
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block">Count</span>
                <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-h-[95px]">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={countData}
                      dataKey="value"
                      nameKey="type"
                      innerRadius={25}
                      strokeWidth={3}
                      activeIndex={activeIndex}
                      activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
                        <g>
                          <Sector {...props} outerRadius={outerRadius + 3} />
                          <Sector {...props} outerRadius={outerRadius + 8} innerRadius={outerRadius + 5} />
                        </g>
                      )}
                    >
                      <Label
                        content={({ viewBox }) => {
                          if (viewBox && "cx" in viewBox && "cy" in viewBox) {
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

              {/* Separator Line */}
              <div className="h-20 w-[1px] bg-zinc-100 dark:bg-zinc-800" />

              {/* Right Chart: File Size */}
              <div className="flex-1 text-center">
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block">Size (MB)</span>
                <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-h-[95px]">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={sizeData}
                      dataKey="value"
                      nameKey="type"
                      innerRadius={25}
                      strokeWidth={3}
                      activeIndex={activeIndex}
                      activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
                        <g>
                          <Sector {...props} outerRadius={outerRadius + 3} />
                          <Sector {...props} outerRadius={outerRadius + 8} innerRadius={outerRadius + 5} />
                        </g>
                      )}
                    >
                      <Label
                        content={({ viewBox }) => {
                          if (viewBox && "cx" in viewBox && "cy" in viewBox) {
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
                  {filteredFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-zinc-500">
                        No files found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFiles.map((file) => (
                      <TableRow 
                        key={file.id} 
                        onClick={() => setSelectedFile(file)}
                        className={`border-zinc-200 dark:border-zinc-800 cursor-pointer transition-colors ${selectedFile.id === file.id ? 'bg-zinc-100/80 dark:bg-zinc-800/60' : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30'}`}
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
                              <DropdownMenuItem className="cursor-pointer gap-2">
                                <Download className="w-4 h-4" /> Download
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer gap-2 text-red-600 dark:text-red-400">
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
              <div className="w-full h-36 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center p-4 text-center relative">
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

              <div className="space-y-2.5 text-xs">
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
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedFile.updatedAt}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block mb-1">Server Target Path:</span>
                  <code className="text-[10px] bg-zinc-100 dark:bg-zinc-950 p-1.5 rounded block font-mono text-zinc-500 truncate">
                    /home/shared/{selectedFile.name}
                  </code>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="w-full text-xs h-8 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <Download className="w-3 h-3 mr-1.5" /> Download
                </Button>
                <Button variant="outline" size="sm" className="w-full text-xs h-8 text-red-600 dark:text-red-400 border-zinc-200 dark:border-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/30">
                  <Trash2 className="w-3 h-3 mr-1.5" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}