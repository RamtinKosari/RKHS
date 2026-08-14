"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LoadingWithTimeoutProps {
  message?: string
  timeoutMs?: number
}

export function LoadingWithTimeout({
  message = "Loading Home Server...",
  timeoutMs = 15000,
}: LoadingWithTimeoutProps) {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), timeoutMs)
    return () => window.clearTimeout(t)
  }, [timeoutMs])

  if (timedOut) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full flex flex-col items-center gap-3 text-center">
          <div className="text-zinc-900 dark:text-zinc-100 text-sm font-medium">
            Taking too long to load.
          </div>
          <div className="text-zinc-500 dark:text-zinc-400 text-xs">
            Your browser or device may not fully support this app. You can try reloading,
            or open this page in a modern browser like Chrome, Firefox, or Safari.
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload()
            }}
            className="mt-1"
          >
            Reload
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin" /> {message}
      </div>
    </div>
  )
}
