// app/page.tsx
"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// Dynamically load the app shell with SSR completely disabled
const AppShell = dynamic(
  () => import("@/components/AppShell"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading Home Server...
        </div>
      </div>
    )
  }
)

export default function Page() {
  return <AppShell />
}