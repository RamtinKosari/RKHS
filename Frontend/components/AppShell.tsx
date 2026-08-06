"use client"

import { useState } from "react"
import { HardDrive, Music, LayoutDashboard } from "lucide-react"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import FileManagerContent from "./FileManagerContent"
import MusicPlayerContent from "./MusicPlayerContent"

type AppTab = "storage" | "music" | "dashboard"

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("storage")

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-zinc-900 to-zinc-700 dark:from-zinc-100 dark:to-zinc-400 flex items-center justify-center shadow-sm">
              <span className="text-xs font-bold text-white dark:text-zinc-900">RK</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">RKHS Home Server</h1>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Local network services</p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AppTab)} className="w-fit">
            <TabsList variant="line" className="h-9 bg-transparent">
              <TabsTrigger value="storage" className="gap-2 px-3 text-xs">
                <HardDrive className="w-4 h-4" />
                <span className="hidden sm:inline">Storage</span>
              </TabsTrigger>
              <TabsTrigger value="music" className="gap-2 px-3 text-xs">
                <Music className="w-4 h-4" />
                <span className="hidden sm:inline">Music</span>
              </TabsTrigger>
              <TabsTrigger value="dashboard" className="gap-2 px-3 text-xs" disabled>
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="storage" className="mt-0 hidden" />
            <TabsContent value="music" className="mt-0 hidden" />
            <TabsContent value="dashboard" className="mt-0 hidden" />
          </Tabs>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="p-6 md:p-10">
        {activeTab === "storage" && <FileManagerContent />}
        {activeTab === "music" && <MusicPlayerContent />}
        {activeTab === "dashboard" && (
          <div className="max-w-7xl mx-auto flex items-center justify-center h-[60vh] text-zinc-500 text-sm">
            Dashboard coming soon.
          </div>
        )}
      </main>
    </div>
  )
}
