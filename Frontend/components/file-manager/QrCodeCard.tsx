"use client"

import { QRCodeSVG } from "qrcode.react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface QrCodeCardProps {
  text: string
}

export default function QrCodeCard({ text }: QrCodeCardProps) {
  return (
    <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col items-center justify-between p-6">
      <CardHeader className="p-0 pb-3 w-full">
        <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400 text-center">
          Instant QR Code
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex flex-col items-center justify-center flex-1">
        {text ? (
          <div className="bg-white p-3.5 rounded-lg border border-zinc-200 shadow-xs">
            <QRCodeSVG value={text} size={140} level="M" />
          </div>
        ) : (
          <div className="w-[140px] h-[140px] bg-zinc-50 dark:bg-zinc-950 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg flex items-center justify-center text-[10px] text-zinc-400 text-center p-2">
            Type text to generate QR
          </div>
        )}
        <span className="text-[10px] text-zinc-400 mt-2.5 text-center">
          Scan with phone camera
        </span>
      </CardContent>
    </Card>
  )
}
