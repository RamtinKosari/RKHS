// app/page.tsx
"use client"

import dynamic from "next/dynamic"
import { LoadingWithTimeout } from "@/components/LoadingWithTimeout"
import { ErrorBoundary } from "@/components/ErrorBoundary"

// Dynamically load the app shell with SSR completely disabled
const AppShell = dynamic(
  () => import("@/components/AppShell"),
  {
    ssr: false,
    loading: () => <LoadingWithTimeout />,
  }
)

export default function Page() {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
          <div className="max-w-sm w-full flex flex-col items-center gap-3 text-center">
            <div className="text-zinc-900 dark:text-zinc-100 text-sm font-medium">
              Something went wrong loading the app.
            </div>
            <div className="text-zinc-500 dark:text-zinc-400 text-xs">
              Your device or browser may not be fully supported. Try reloading,
              or open this page in a modern desktop browser.
            </div>
          </div>
        </div>
      }
    >
      <AppShell />
    </ErrorBoundary>
  )
}