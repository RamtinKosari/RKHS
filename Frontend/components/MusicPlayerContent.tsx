"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { flushSync } from "react-dom"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  Music,
  Loader2,
  ListMusic,
  Clock,
  FileAudio,
  Trash2,
  Download
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"

const API_BASE = typeof window !== "undefined"
  ? `http://${window.location.hostname}:5000/api`
  : "http://localhost:5000/api"

interface AudioFile {
  id: string
  name: string
  size: string
  sizeBytes?: number
  type: "audio"
  uploader: string
  updatedAt: string
}

function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export default function MusicPlayerContent() {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isShuffle, setIsShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<"none" | "all" | "one">("none")
  const [volume, setVolume] = useState(0.8)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const visualizerInitializedRef = useRef(false)
  const drawFrameRef = useRef<(() => void) | null>(null)
  const currentTimeRef = useRef(currentTime)
  const durationRef = useRef(duration)

  const currentTrack = currentIndex >= 0 ? files[currentIndex] : null

  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { durationRef.current = duration }, [duration])

  // Load audio files on mount
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setIsLoading(true)
        const res = await fetch(`${API_BASE}/files`)
        const data = await res.json()
        if (cancelled) return
        const audioFiles = data.filter((f: AudioFile) => f.type === "audio")
        setFiles((prev) => (prev.length === 0 ? audioFiles : prev))
        if (audioFiles.length > 0) {
          setCurrentIndex((prev) => (prev === -1 ? 0 : prev))
        } else {
          setCurrentIndex(-1)
        }
      } catch (err) {
        console.error("Failed to load audio files:", err)
        setAudioError("Failed to connect to the music server.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const audioUrl = useMemo(() => {
    if (!currentTrack) return undefined
    return `${API_BASE}/download/${encodeURIComponent(currentTrack.name)}`
  }, [currentTrack])

  // Ensure CORS is set on the audio element before the new source loads
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.crossOrigin = "anonymous"
    }
  }, [audioUrl])

  // Initialize Web Audio API visualizer
  const initAudioContext = useCallback(() => {
    if (!audioRef.current || visualizerInitializedRef.current) return

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return

      const audioCtx = new AudioContextClass()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85

      const source = audioCtx.createMediaElementSource(audioRef.current)
      source.connect(analyser)
      analyser.connect(audioCtx.destination)

      audioContextRef.current = audioCtx
      analyserRef.current = analyser
      sourceRef.current = source
      visualizerInitializedRef.current = true
    } catch (err) {
      console.error("Failed to initialize audio context:", err)
    }
  }, [])

  const resumeAudioContext = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume()
    }
  }, [])

  // Circular live audio spectrum render loop
  const drawVisualizer = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      animationRef.current = requestAnimationFrame(() => drawFrameRef.current?.())
      return
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      animationRef.current = requestAnimationFrame(() => drawFrameRef.current?.())
      return
    }

    const width = canvas.width
    const height = canvas.height
    const centerX = width / 2
    const centerY = height / 2
    const maxRadius = Math.min(width, height) / 2
    const ringRadius = maxRadius * 0.36

    ctx.clearRect(0, 0, width, height)

    const analyser = analyserRef.current
    if (!analyser) {
      // Idle circular placeholder before playback starts
      ctx.beginPath()
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
      ctx.lineWidth = 3
      ctx.stroke()

      const progress = durationRef.current > 0 ? currentTimeRef.current / durationRef.current : 0
      const progressAngle = -Math.PI / 2 + progress * Math.PI * 2
      ctx.beginPath()
      ctx.arc(centerX, centerY, ringRadius * 0.82, -Math.PI / 2, progressAngle)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)"
      ctx.lineWidth = 3
      ctx.stroke()

      animationRef.current = requestAnimationFrame(() => drawFrameRef.current?.())
      return
    }

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteFrequencyData(dataArray)

    // Energy analysis
    let bassEnergy = 0
    let midEnergy = 0
    let trebleEnergy = 0
    for (let i = 0; i < bufferLength; i++) {
      const t = i / bufferLength
      if (t < 0.15) bassEnergy += dataArray[i]
      else if (t < 0.5) midEnergy += dataArray[i]
      else trebleEnergy += dataArray[i]
    }
    const bassCount = Math.max(1, Math.floor(bufferLength * 0.15))
    const midCount = Math.max(1, Math.floor(bufferLength * 0.35))
    const bassNormalized = bassEnergy / (255 * bassCount)
    const midNormalized = midEnergy / (255 * midCount)
    const energyNormalized = (bassEnergy + midEnergy + trebleEnergy) / (255 * bufferLength)

    // Ambient background glow reacting to bass/mids
    const bgGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius)
    bgGlow.addColorStop(0, `hsla(${175 + bassNormalized * 25}, 85%, 55%, ${0.12 + bassNormalized * 0.18})`)
    bgGlow.addColorStop(0.45, `hsla(${185 + midNormalized * 25}, 80%, 50%, ${0.05 + midNormalized * 0.08})`)
    bgGlow.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = bgGlow
    ctx.fillRect(0, 0, width, height)

    // Rotating subtle grid ring
    const gridTime = performance.now() / 2000
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(gridTime * 0.15)
    ctx.translate(-centerX, -centerY)
    ctx.beginPath()
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      ctx.moveTo(centerX + Math.cos(angle) * ringRadius * 0.6, centerY + Math.sin(angle) * ringRadius * 0.6)
      ctx.lineTo(centerX + Math.cos(angle) * ringRadius * 1.35, centerY + Math.sin(angle) * ringRadius * 1.35)
    }
    ctx.strokeStyle = `hsla(${180 + energyNormalized * 40}, 60%, 55%, ${0.04 + energyNormalized * 0.08})`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    // Draw mirrored circular spectrum bars
    const barCount = 180
    const step = (Math.PI * 2) / barCount
    const innerRadius = ringRadius
    const maxBarLength = maxRadius * 0.48

    // Focus on the mid-range frequencies where the melody lives
    const freqStart = 4
    const freqEnd = 52
    const freqRange = Math.max(1, freqEnd - freqStart)
    const repeats = 3

    for (let i = 0; i < barCount; i++) {
      // Tile the same frequency range 3 times around the circle
      const sectorT = (i / barCount) * repeats
      const local = sectorT - Math.floor(sectorT)
      // Mirror each sector so it is centered/symmetric
      const symT = 1 - Math.abs(local * 2 - 1)
      const dataIndex = Math.min(freqStart + Math.floor(symT * freqRange), freqEnd - 1)
      const value = dataArray[dataIndex] || 0
      const normalized = value / 255
      const barHeight = normalized * maxBarLength
      const angle = i * step - Math.PI / 2

      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      const outerR = innerRadius + barHeight
      const mirrorR = Math.max(innerRadius - barHeight * 0.45, innerRadius * 0.55)

      const xInner = centerX + cos * innerRadius
      const yInner = centerY + sin * innerRadius
      const xOuter = centerX + cos * outerR
      const yOuter = centerY + sin * outerR
      const xMirror = centerX + cos * mirrorR
      const yMirror = centerY + sin * mirrorR

      // Cyan/teal palette
      const hue = (170 + symT * 50 + normalized * 30) % 360
      const alpha = 0.4 + normalized * 0.6
      const glowAlpha = 0.12 + normalized * 0.35

      // Outer glow
      ctx.beginPath()
      ctx.moveTo(xInner, yInner)
      ctx.lineTo(xOuter, yOuter)
      ctx.strokeStyle = `hsla(${hue}, 95%, 55%, ${glowAlpha})`
      ctx.lineWidth = 10 + normalized * 8
      ctx.lineCap = "round"
      ctx.stroke()

      // Main outer bar
      ctx.beginPath()
      ctx.moveTo(xInner, yInner)
      ctx.lineTo(xOuter, yOuter)
      ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${alpha})`
      ctx.lineWidth = 3.5 + normalized * 2
      ctx.lineCap = "round"
      ctx.stroke()

      // Inner mirrored bar (shorter)
      ctx.beginPath()
      ctx.moveTo(xInner, yInner)
      ctx.lineTo(xMirror, yMirror)
      ctx.strokeStyle = `hsla(${hue}, 90%, 60%, ${0.25 + normalized * 0.35})`
      ctx.lineWidth = 2 + normalized * 1.5
      ctx.lineCap = "round"
      ctx.stroke()

      // Bright tip dot
      if (normalized > 0.2) {
        ctx.beginPath()
        ctx.arc(xOuter, yOuter, 2 + normalized * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${0.85 + normalized * 0.15})`
        ctx.fill()
      }
    }

    // Draw ring base
    ctx.beginPath()
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${180 + energyNormalized * 40}, 70%, 55%, ${0.25 + energyNormalized * 0.25})`
    ctx.lineWidth = 3
    ctx.stroke()

    // Bass shockwave rings
    const shockCount = 3
    for (let i = 0; i < shockCount; i++) {
      const r = innerRadius * (0.4 + i * 0.35) + bassNormalized * (i + 1) * 15
      ctx.beginPath()
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${180 + bassNormalized * 40}, 90%, 60%, ${0.08 + bassNormalized * 0.12})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Draw central bass-reactive core
    const coreRadius = innerRadius * 0.28 + bassNormalized * innerRadius * 0.22
    const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius)
    coreGradient.addColorStop(0, `hsla(${180 + bassNormalized * 40}, 95%, 80%, 0.95)`)
    coreGradient.addColorStop(0.5, `hsla(${180 + bassNormalized * 40}, 90%, 55%, 0.5)`)
    coreGradient.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.beginPath()
    ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2)
    ctx.fillStyle = coreGradient
    ctx.fill()

    // Draw playback progress ring
    const progress = durationRef.current > 0 ? currentTimeRef.current / durationRef.current : 0
    const progressAngle = -Math.PI / 2 + progress * Math.PI * 2

    ctx.beginPath()
    ctx.arc(centerX, centerY, innerRadius * 0.82, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)"
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(centerX, centerY, innerRadius * 0.82, -Math.PI / 2, progressAngle)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"
    ctx.lineWidth = 3
    ctx.stroke()

    animationRef.current = requestAnimationFrame(() => drawFrameRef.current?.())
  }, [])

  useEffect(() => {
    drawFrameRef.current = drawVisualizer
  }, [drawVisualizer])

  useEffect(() => {
    animationRef.current = requestAnimationFrame(() => drawFrameRef.current?.())
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  const startPlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    try {
      audio.crossOrigin = "anonymous"
      initAudioContext()
      await resumeAudioContext()
      await audio.play()
      setIsPlaying(true)
      setAudioError(null)
    } catch (err) {
      console.error("Play failed:", err)
      setAudioError("Browser blocked autoplay. Click play again.")
      setIsPlaying(false)
    }
  }, [initAudioContext, resumeAudioContext])

  const handlePause = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
  }, [])

  const playTrack = useCallback((index: number) => {
    const track = files[index]
    if (!track) return

    flushSync(() => {
      setCurrentIndex(index)
    })

    const audio = audioRef.current
    if (!audio) return

    audio.crossOrigin = "anonymous"
    audio.currentTime = 0
    startPlayback()
  }, [files, startPlayback])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      handlePause()
    } else if (currentTrack) {
      startPlayback()
    } else if (files.length > 0) {
      playTrack(0)
    }
  }, [isPlaying, currentTrack, files.length, startPlayback, handlePause, playTrack])

  const handleNext = useCallback(() => {
    if (files.length === 0) return
    let nextIndex
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * files.length)
    } else {
      nextIndex = (currentIndex + 1) % files.length
    }
    playTrack(nextIndex)
  }, [currentIndex, files.length, isShuffle, playTrack])

  const handlePrevious = useCallback(() => {
    if (files.length === 0) return
    let prevIndex
    if (isShuffle) {
      prevIndex = Math.floor(Math.random() * files.length)
    } else {
      prevIndex = currentIndex <= 0 ? files.length - 1 : currentIndex - 1
    }
    playTrack(prevIndex)
  }, [currentIndex, files.length, isShuffle, playTrack])

  const handleEnded = useCallback(() => {
    if (repeatMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0
        audioRef.current.play().catch(() => {})
      }
    } else if (repeatMode === "all" || isShuffle) {
      handleNext()
    } else {
      if (currentIndex < files.length - 1) {
        handleNext()
      } else {
        setIsPlaying(false)
      }
    }
  }, [currentIndex, files.length, handleNext, isShuffle, repeatMode])

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0] / 100
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
    if (newVolume > 0) setIsMuted(false)
  }

  const toggleMute = () => {
    if (!audioRef.current) return
    if (isMuted) {
      audioRef.current.volume = volume
      setIsMuted(false)
    } else {
      audioRef.current.volume = 0
      setIsMuted(true)
    }
  }

  const handleSeek = (value: number[]) => {
    if (!audioRef.current || !duration) return
    const newTime = (value[0] / 100) * duration
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handleDelete = async (filename: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch(`${API_BASE}/files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        const newFiles = files.filter((f) => f.name !== filename)
        setFiles(newFiles)
        if (currentTrack?.name === filename) {
          if (newFiles.length > 0) {
            setCurrentIndex(Math.min(currentIndex, newFiles.length - 1))
            setIsPlaying(true)
          } else {
            setCurrentIndex(-1)
            setIsPlaying(false)
          }
        }
      }
    } catch (err) {
      console.error("Delete failed:", err)
    }
  }

  const handleDownload = (filename: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    window.open(`${API_BASE}/download/${encodeURIComponent(filename)}`, "_blank")
  }

  const toggleRepeat = () => {
    setRepeatMode((prev) => {
      if (prev === "none") return "all"
      if (prev === "all") return "one"
      return "none"
    })
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={() => setAudioError("Audio source failed to load. Ensure the file is a valid audio format.")}
        preload="metadata"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Music Player</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Stream audio files from your server. {files.length} track{files.length === 1 ? "" : "s"} available.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected to server
          </span>
        </div>
      </div>

      <Separator className="bg-zinc-200 dark:bg-zinc-800" />

      {isLoading ? (
        <div className="flex items-center justify-center h-[60vh] text-zinc-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading music library...
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[60vh] text-zinc-500 text-sm gap-4">
          <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
            <Music className="w-8 h-8 text-zinc-400" />
          </div>
          <div className="text-center">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">No audio files found</p>
            <p className="text-xs mt-1">Upload MP3, WAV, M4A, or AAC files to the server to get started.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Player Card */}
          <Card className="lg:col-span-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <CardContent className="p-6 sm:p-8 flex flex-col items-center">
              {/* Visualizer Canvas */}
              <div className="relative w-full max-w-[420px] aspect-square mb-6">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={600}
                  className="w-full h-full rounded-full"
                />

                {/* Center album art / placeholder */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[34%] h-[34%] rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 border-4 border-white/5 dark:border-white/5 shadow-2xl flex items-center justify-center overflow-hidden">
                    {currentTrack ? (
                      <div className="text-center p-4">
                        <FileAudio className="w-10 h-10 text-zinc-400 mx-auto mb-2" />
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-tight">
                          {currentTrack.name}
                        </span>
                      </div>
                    ) : (
                      <Music className="w-12 h-12 text-zinc-400" />
                    )}
                  </div>
                </div>

                {/* Playing indicator */}
                {isPlaying && (
                  <div className="absolute top-4 right-4 flex items-center gap-1">
                    <span className="w-1 h-3 bg-emerald-500 rounded-full animate-[bounce_1s_infinite]" />
                    <span className="w-1 h-4 bg-emerald-500 rounded-full animate-[bounce_1.2s_infinite]" />
                    <span className="w-1 h-2 bg-emerald-500 rounded-full animate-[bounce_0.8s_infinite]" />
                  </div>
                )}
              </div>

              {/* Track Info */}
              <div className="text-center mb-6 w-full">
                <h3 className="text-lg font-semibold truncate">
                  {currentTrack ? currentTrack.name.replace(/\.[^/.]+$/, "") : "No track selected"}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {currentTrack ? `${currentTrack.size} · ${currentTrack.uploader}` : "Select a track from the playlist"}
                </p>
                {audioError && (
                  <p className="text-xs text-red-500 mt-2">{audioError}</p>
                )}
              </div>

              {/* Progress */}
              <div className="w-full mb-5 space-y-2">
                <Slider
                  value={[progressPercent]}
                  max={100}
                  step={0.1}
                  onValueChange={handleSeek}
                  className="cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsShuffle((s) => !s)}
                      className={isShuffle ? "text-emerald-500" : "text-zinc-500"}
                    >
                      <Shuffle className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Shuffle</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handlePrevious} className="text-zinc-700 dark:text-zinc-200">
                      <SkipBack className="w-5 h-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Previous</TooltipContent>
                </Tooltip>

                <Button
                  onClick={togglePlay}
                  disabled={!currentTrack}
                  className="w-14 h-14 rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-lg"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                </Button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handleNext} className="text-zinc-700 dark:text-zinc-200">
                      <SkipForward className="w-5 h-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Next</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleRepeat}
                      className={repeatMode !== "none" ? "text-emerald-500" : "text-zinc-500"}
                    >
                      {repeatMode === "one" ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {repeatMode === "none" ? "Repeat off" : repeatMode === "all" ? "Repeat all" : "Repeat one"}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-3 w-full max-w-xs">
                <Button variant="ghost" size="icon" onClick={toggleMute} className="text-zinc-500 h-8 w-8">
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume * 100]}
                  max={100}
                  step={1}
                  onValueChange={handleVolumeChange}
                  className="flex-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* Playlist Card */}
          <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 h-[calc(100vh-220px)] min-h-[480px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ListMusic className="w-4 h-4" />
                Playlist
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-6 pb-6">
                <div className="space-y-1">
                  {files.map((file, index) => {
                    const isActive = index === currentIndex
                    return (
                      <div
                        key={file.id}
                        onClick={() => playTrack(index)}
                        className={`group flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                          isActive
                            ? "bg-zinc-100 dark:bg-zinc-800"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                          isActive ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500"
                        }`}>
                          {isActive && isPlaying ? (
                            <div className="flex items-end gap-[2px] h-3">
                              <span className="w-[2px] h-1 bg-current rounded-full animate-[bounce_0.6s_infinite]" />
                              <span className="w-[2px] h-2 bg-current rounded-full animate-[bounce_0.8s_infinite]" />
                              <span className="w-[2px] h-1.5 bg-current rounded-full animate-[bounce_0.7s_infinite]" />
                            </div>
                          ) : (
                            <Music className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}>
                            {file.name.replace(/\.[^/.]+$/, "")}
                          </p>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {file.size}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-zinc-500"
                                onClick={(e) => handleDownload(file.name, e)}
                              >
                                <Download className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-red-500"
                                onClick={(e) => handleDelete(file.name, e)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
