import { useEffect } from 'react'
import { useSystemStore } from '../store/system.ts'
import { fetchSystemInfo } from '../gateway/filesystem.ts'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-claw-text-dim text-xs">{label}</span>
      <span className="text-claw-text text-xs font-mono">{value}</span>
    </div>
  )
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full h-1.5 bg-claw-bg/60 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

export default function SystemInfo() {
  const sys = useSystemStore()

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const info = await fetchSystemInfo()
        if (!cancelled) {
          useSystemStore.getState().update(info)
        }
      } catch (err) {
        console.warn('[SystemInfo] Failed to fetch:', err)
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (!sys.loaded) {
    return (
      <div className="p-3">
        <div className="text-xs text-claw-text-dim animate-pulse">Loading system info...</div>
      </div>
    )
  }

  const memPct = sys.memTotal > 0 ? ((sys.memUsed / sys.memTotal) * 100).toFixed(0) : '0'

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-claw-accent tracking-wide uppercase mb-2">
        System
      </div>

      <InfoRow label="Host" value={sys.hostname} />
      <InfoRow label="OS" value={sys.platform} />
      <InfoRow label="Kernel" value={sys.kernel} />
      <InfoRow label="Arch" value={sys.arch} />
      <InfoRow label="IP" value={sys.ip} />
      <InfoRow label="Uptime" value={formatUptime(sys.uptime)} />

      {/* CPU */}
      <div className="pt-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-claw-text-dim text-xs">CPU</span>
          <span className="text-claw-text text-xs font-mono">{sys.cpuUsage.toFixed(0)}%</span>
        </div>
        <ProgressBar value={sys.cpuUsage} max={100} color="#38bdf8" />
        <div className="text-[10px] text-claw-text-dim/50 mt-0.5">
          {sys.cpuCores} cores
        </div>
      </div>

      {/* Memory */}
      <div className="pt-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-claw-text-dim text-xs">Memory</span>
          <span className="text-claw-text text-xs font-mono">{memPct}%</span>
        </div>
        <ProgressBar value={sys.memUsed} max={sys.memTotal} color="#a78bfa" />
        <div className="text-[10px] text-claw-text-dim/50 mt-0.5">
          {formatBytes(sys.memUsed)} / {formatBytes(sys.memTotal)}
        </div>
      </div>
    </div>
  )
}
