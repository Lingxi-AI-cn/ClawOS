import { create } from 'zustand'

export interface SystemInfo {
  hostname: string
  platform: string
  kernel: string
  arch: string
  cpuUsage: number
  cpuModel: string
  cpuCores: number
  memTotal: number
  memUsed: number
  uptime: number
  ip: string
  netRxBytes: number
  netTxBytes: number
}

interface SystemStore extends SystemInfo {
  loaded: boolean
  // Calculated network speed (bytes/sec)
  netRxSpeed: number
  netTxSpeed: number
  _lastRxBytes: number
  _lastTxBytes: number
  _lastTimestamp: number
  update: (info: Partial<SystemInfo>) => void
}

export const useSystemStore = create<SystemStore>((set) => ({
  hostname: '',
  platform: '',
  kernel: '',
  arch: '',
  cpuUsage: 0,
  cpuModel: '',
  cpuCores: 0,
  memTotal: 0,
  memUsed: 0,
  uptime: 0,
  ip: '',
  netRxBytes: 0,
  netTxBytes: 0,
  loaded: false,
  netRxSpeed: 0,
  netTxSpeed: 0,
  _lastRxBytes: 0,
  _lastTxBytes: 0,
  _lastTimestamp: 0,
  update: (info) =>
    set((s) => {
      const now = Date.now()
      const elapsed = s._lastTimestamp > 0 ? (now - s._lastTimestamp) / 1000 : 0
      const rxBytes = info.netRxBytes ?? s.netRxBytes
      const txBytes = info.netTxBytes ?? s.netTxBytes

      let netRxSpeed = s.netRxSpeed
      let netTxSpeed = s.netTxSpeed

      if (elapsed > 0 && s._lastRxBytes > 0) {
        const rxDelta = rxBytes - s._lastRxBytes
        const txDelta = txBytes - s._lastTxBytes
        // Only update if delta is non-negative (counter reset check)
        if (rxDelta >= 0) netRxSpeed = rxDelta / elapsed
        if (txDelta >= 0) netTxSpeed = txDelta / elapsed
      }

      return {
        ...s,
        ...info,
        loaded: true,
        netRxSpeed,
        netTxSpeed,
        _lastRxBytes: rxBytes,
        _lastTxBytes: txBytes,
        _lastTimestamp: now,
      }
    }),
}))
