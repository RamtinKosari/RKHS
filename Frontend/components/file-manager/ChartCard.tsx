"use client"

import { useMemo } from "react"
import { Label, Pie as RechartsPie, PieChart, Sector } from "recharts"

// Recharts v3 removed activeIndex/activeShape from the TypeScript typings,
// but the runtime still supports them. Cast so the build passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Pie = RechartsPie as any

import { PieSectorDataItem } from "recharts/types/polar/Pie"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

const chartConfig = {
  value: { label: "Metric" },
  pdf: { label: "Documents", color: "#71717a" },
  code: { label: "Code", color: "#27272a" },
  spreadsheet: { label: "Spreadsheets", color: "#a1a1aa" },
  image: { label: "Images", color: "#d4d4d8" },
  video: { label: "Videos", color: "#52525b" },
  audio: { label: "Audio", color: "#3f3f46" },
} satisfies ChartConfig

const types = ["pdf", "code", "spreadsheet", "image", "video", "audio"] as const

interface ChartCardProps {
  id: string
  activeType: string
  onActiveTypeChange: (type: string) => void
  counts: Record<string, number>
  sizes: Record<string, number>
}

export default function ChartCard({
  id,
  activeType,
  onActiveTypeChange,
  counts,
  sizes,
}: ChartCardProps) {
  const countData = useMemo(
    () =>
      types.map((t) => ({
        type: t,
        value: counts[t] || 0,
        fill: `var(--color-${t})`,
      })),
    [counts],
  )

  const sizeData = useMemo(
    () =>
      types.map((t) => ({
        type: t,
        value: Number((sizes[t] || 0).toFixed(2)),
        fill: `var(--color-${t})`,
      })),
    [sizes],
  )

  const activeIndex = useMemo(
    () => countData.findIndex((item) => item.type === activeType),
    [activeType, countData],
  )

  return (
    <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
      <ChartStyle id={id} config={chartConfig} />
      <CardHeader className="flex flex-row items-center space-y-0 pb-1 justify-between">
        <div>
          <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Files Count &amp; Size
          </CardTitle>
        </div>
        <Select value={activeType} onValueChange={onActiveTypeChange}>
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
                    <span
                      className="flex h-2 w-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: `var(--color-${key})` }}
                    />
                    {config.label}
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex flex-1 justify-between items-center pb-2 pt-0 gap-2">
        <div className="flex-1 text-center flex flex-col items-center">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
            Count
          </span>
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
                      if (
                        viewBox &&
                        "cx" in viewBox &&
                        "cy" in viewBox &&
                        countData[activeIndex]
                      ) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy}
                              className="text-xs font-bold fill-zinc-900 dark:fill-zinc-50"
                            >
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

        <div className="h-20 w-[1px] bg-zinc-100 dark:bg-zinc-800 my-auto" />

        <div className="flex-1 text-center flex flex-col items-center">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
            Size (MB)
          </span>
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
                      if (
                        viewBox &&
                        "cx" in viewBox &&
                        "cy" in viewBox &&
                        sizeData[activeIndex]
                      ) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy}
                              className="text-xs font-bold fill-zinc-900 dark:fill-zinc-50"
                            >
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
  )
}
