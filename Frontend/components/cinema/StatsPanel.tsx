"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Clock,
  Film,
  Flame,
  Heart,
  ListChecks,
  Star,
  Tv,
  Trophy,
  TrendingUp,
  Sparkles,
  Calendar,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

import type { MediaItem, MediaState } from "@/lib/cinema-types"

function formatHours(seconds: number) {
  const h = seconds / 3600
  if (h < 1) return `${Math.round(seconds / 60)}m`
  if (h < 10) return `${h.toFixed(1)}h`
  return `${Math.round(h)}h`
}

function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const DAY_MS = 86_400_000

function computeStreak(state: Record<string, MediaState>): number {
  const days = new Set<number>()
  for (const s of Object.values(state)) {
    const ts = s.lastWatchedAt || s.updatedAt
    if (!ts) continue
    days.add(startOfDay(ts))
  }
  if (days.size === 0) return 0
  let streak = 0
  let cursor = startOfDay(Date.now())
  // Allow today to be missing; start counting from yesterday if so.
  if (!days.has(cursor)) {
    cursor -= DAY_MS
  }
  while (days.has(cursor)) {
    streak += 1
    cursor -= DAY_MS
  }
  return streak
}

function topGenres(media: MediaItem[], state: Record<string, MediaState>) {
  const counts = new Map<string, number>()
  for (const m of media) {
    const s = state[m.id]
    if (!s || s.status !== "completed") continue
    for (const g of m.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }))
}

function topRated(media: MediaItem[], state: Record<string, MediaState>) {
  const out: { media: MediaItem; rating: number }[] = []
  for (const m of media) {
    const r = state[m.id]?.rating
    if (typeof r === "number" && r > 0) out.push({ media: m, rating: r })
  }
  out.sort((a, b) => b.rating - a.rating)
  return out.slice(0, 5)
}

function monthlyActivity(media: MediaItem[], state: Record<string, MediaState>) {
  const now = new Date()
  const months: { label: string; ts: number; count: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleString("en", { month: "short" }),
      ts: d.getTime(),
      count: 0,
    })
  }
  const indexByStart = new Map<number, number>()
  for (let i = 0; i < months.length; i++) {
    const next = i + 1 < months.length ? months[i + 1].ts : now.getTime() + DAY_MS
    indexByStart.set(months[i].ts, i)
    // attach "end" implicitly via the next month boundary
    void next
  }
  for (const s of Object.values(state)) {
    const ts = s.lastWatchedAt || s.updatedAt
    if (!ts) continue
    const day = startOfDay(ts)
    // Find the month bucket this day belongs to.
    const d = new Date(day)
    const bucket = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const idx = indexByStart.get(bucket)
    if (idx != null) months[idx].count += 1
  }
  return months.map((m) => ({ label: m.label, count: m.count }))
}

function watchedTime(media: MediaItem[], state: Record<string, MediaState>) {
  let total = 0
  for (const m of media) {
    const s = state[m.id]
    if (!s) continue
    if (s.status === "completed") {
      total += s.duration || 0
    } else {
      total += Math.min(s.progress || 0, s.duration || 0)
    }
  }
  return total
}

export interface StatsPanelProps {
  media: MediaItem[]
  state: Record<string, MediaState>
}

export default function StatsPanel({ media, state }: StatsPanelProps) {
  const totalItems = media.length
  const completedCount = useMemo(
    () => Object.values(state).filter((s) => s.status === "completed").length,
    [state]
  )
  const watchingCount = useMemo(
    () => Object.values(state).filter((s) => s.status === "watching").length,
    [state]
  )
  const planCount = useMemo(
    () => Object.values(state).filter((s) => s.status === "plan").length,
    [state]
  )
  const favoriteCount = useMemo(
    () => Object.values(state).filter((s) => s.favorite).length,
    [state]
  )
  const droppedCount = useMemo(
    () => Object.values(state).filter((s) => s.status === "dropped").length,
    [state]
  )
  const totalWatched = useMemo(() => watchedTime(media, state), [media, state])
  const streak = useMemo(() => computeStreak(state), [state])
  const topG = useMemo(() => topGenres(media, state), [media, state])
  const topR = useMemo(() => topRated(media, state), [media, state])
  const monthly = useMemo(() => monthlyActivity(media, state), [media, state])

  const monthMax = Math.max(1, ...monthly.map((m) => m.count))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={ListChecks}
          label="In library"
          value={String(totalItems)}
          accent="text-zinc-900 dark:text-zinc-100"
        />
        <StatCard
          icon={Trophy}
          label="Completed"
          value={String(completedCount)}
          accent="text-blue-500"
        />
        <StatCard
          icon={Tv}
          label="Watching"
          value={String(watchingCount)}
          accent="text-emerald-500"
        />
        <StatCard
          icon={Calendar}
          label="Plan"
          value={String(planCount)}
          accent="text-amber-500"
        />
        <StatCard
          icon={Heart}
          label="Favorites"
          value={String(favoriteCount)}
          accent="text-rose-500"
        />
        <StatCard
          icon={Clock}
          label="Total watched"
          value={formatHours(totalWatched)}
          accent="text-violet-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2 bg-white/60 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              Monthly activity
              <span className="ml-auto text-[10px] font-normal text-zinc-500">
                last 12 months
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                count: { label: "Sessions", color: "var(--chart-1, #6366f1)" },
              }}
              className="h-44 w-full"
            >
              <BarChart data={monthly} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="var(--border, #e4e4e7)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--muted-foreground, #71717a)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground, #71717a)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  domain={[0, Math.max(1, Math.ceil(monthMax * 1.2))]}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted, rgba(0,0,0,0.05))" }}
                  content={<ChartTooltipContent />}
                />
                <Bar
                  dataKey="count"
                  fill="var(--color-count, #6366f1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="bg-white/60 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-500" />
              Current streak
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-semibold tabular-nums">
              {streak}
              <span className="text-sm font-normal text-zinc-500 ml-1">
                day{streak === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {streak === 0
                ? "Watch something today to start a new streak."
                : `Keep it going — ${streak} day${streak === 1 ? "" : "s"} in a row.`}
            </p>
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 space-y-1.5">
              <Row label="Dropped" value={droppedCount} icon={Sparkles} />
              <Row label="Hours watched" value={formatHours(totalWatched)} icon={Clock} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="bg-white/60 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Film className="w-4 h-4" />
              Most-watched genres
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topG.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Mark items as completed to build this list.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {topG.map(({ genre, count }) => {
                  const max = topG[0]?.count || 1
                  const pct = Math.round((count / max) * 100)
                  return (
                    <li key={genre} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate">{genre}</span>
                        <span className="text-zinc-500 tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white/60 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-500" />
              Your top-rated
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topR.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Rate what you watch to see your favorites here.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {topR.map(({ media: m, rating }, i) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-5 text-zinc-400 tabular-nums">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{m.title}</p>
                      {m.year ? (
                        <p className="text-[10px] text-zinc-500">{m.year}</p>
                      ) : null}
                    </div>
                    <span className="inline-flex items-center gap-0.5 text-amber-500 tabular-nums">
                      <Star className="w-3 h-3 fill-current" />
                      {rating.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className={cn("w-3.5 h-3.5", accent)} />
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  )
}

function Row({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="inline-flex items-center gap-1.5 text-zinc-500">
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
