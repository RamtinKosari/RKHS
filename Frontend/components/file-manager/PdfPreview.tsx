"use client"

import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"

import { Loader2, FileText } from "lucide-react"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

interface PdfPreviewProps {
  url: string
  width?: number
  onLoadSuccess?: (page: { width: number; height: number }) => void
}

export default function PdfPreview({
  url,
  width = 400,
  onLoadSuccess,
}: PdfPreviewProps) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-white dark:bg-zinc-900 overflow-hidden [&_canvas]:max-w-full [&_canvas]:max-h-full [&_canvas]:w-full [&_canvas]:h-auto">
      <Document
        file={url}
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
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          onLoadSuccess={onLoadSuccess}
        />
      </Document>
    </div>
  )
}
