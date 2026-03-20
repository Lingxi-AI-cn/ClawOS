import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { Signal, SignalLow, SignalMedium, SignalHigh, Wifi, WifiOff, Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, MessageSquare, ArrowUpCircle, Settings, Bluetooth, Sun, Volume2, Smartphone, LayoutGrid, Package } from 'lucide-react'
import { useConnectionStore } from '../store/connection.ts'
import { useIMChannelStore } from '../store/imChannels.ts'
import { useGatewayUpdateStore } from '../store/gatewayUpdate.ts'
import { useAppsStore } from '../store/apps.ts'
import { isAndroid, ClawOSBridge } from '../gateway/bridge.ts'

const GatewayUpdate = lazy(() => import('./GatewayUpdate.tsx'))

/* ───────────────────────────────────────────
 * Mobile-style Status Bar HUD
 * Shows: Carrier | Time | Signal | WiFi | Battery
 *
 * Uses inline styles for layout to ensure compatibility
 * with Android AOSP 12 WebView (Tailwind flex sometimes
 * doesn't apply properly in Capacitor WebView).
 * ─────────────────────────────────────────── */

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function BatteryIcon({ level, charging }: { level: number; charging: boolean }) {
  const size = 14
  if (charging) return <BatteryCharging size={size} />
  if (level >= 90) return <BatteryFull size={size} />
  if (level >= 60) return <Battery size={size} />
  if (level >= 30) return <BatteryMedium size={size} />
  if (level >= 15) return <BatteryLow size={size} />
  return <BatteryWarning size={size} />
}

function SignalIcon({ bars }: { bars: number }) {
  const size = 14
  if (bars >= 3) return <SignalHigh size={size} />
  if (bars >= 2) return <SignalMedium size={size} />
  if (bars >= 1) return <SignalLow size={size} />
  return <Signal size={size} />
}

function WifiIcon({ connected }: { connected: boolean }) {
  const size = 14
  return connected ? <Wifi size={size} /> : <WifiOff size={size} />
}

interface MobileStatus {
  carrier: string
  signalBars: number
  wifiConnected: boolean
  wifiStrength: number
  batteryLevel: number
  batteryCharging: boolean
}

async function fetchNativeStatus(): Promise<Partial<MobileStatus> | null> {
  if (!isAndroid || !ClawOSBridge) return null
  try {
    const info = await ClawOSBridge.getStatusBarInfo()
    return {
      carrier: info.carrier || 'ClawOS',
      signalBars: info.signalBars ?? 0,
      wifiConnected: info.wifiConnected ?? false,
      wifiStrength: info.wifiStrength ?? 0,
      batteryLevel: info.batteryLevel >= 0 ? info.batteryLevel : 85,
      batteryCharging: info.batteryCharging ?? false,
    }
  } catch {
    return null
  }
}

interface HUDProps {
  onIMClick?: () => void
  onSkillMarketClick?: () => void
}

function QuickSettingsPanel({ onClose }: { onClose: () => void }) {
  const items = [
    { label: 'WiFi', icon: Wifi, action: 'android.settings.WIFI_SETTINGS', color: '#22d3ee' },
    { label: '蓝牙', icon: Bluetooth, action: 'android.settings.BLUETOOTH_SETTINGS', color: '#60a5fa' },
    { label: '显示', icon: Sun, action: 'android.settings.DISPLAY_SETTINGS', color: '#fbbf24' },
    { label: '声音', icon: Volume2, action: 'android.settings.SOUND_SETTINGS', color: '#a78bfa' },
    { label: '关于', icon: Smartphone, action: 'android.settings.DEVICE_INFO_SETTINGS', color: '#34d399' },
    { label: '全部设置', icon: Settings, action: 'android.settings.SETTINGS', color: 'rgba(255,255,255,0.7)' },
  ]

  const handleOpen = async (action: string) => {
    if (ClawOSBridge) {
      try { await ClawOSBridge.openSettings({ action }) } catch { /* ignore */ }
    }
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: '32px', right: '8px',
          background: 'rgba(15,15,25,0.95)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '12px',
          padding: '8px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '4px',
          minWidth: '220px',
          backdropFilter: 'blur(20px)',
        }}
      >
        {items.map(({ label, icon: Icon, action, color }) => (
          <div
            key={action}
            onClick={() => handleOpen(action)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '6px', padding: '12px 8px', borderRadius: '10px',
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.05)',
            }}
          >
            <Icon size={22} color={color} />
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HUD({ onIMClick, onSkillMarketClick }: HUDProps = {}) {
  const status = useConnectionStore((s) => s.status)
  const openIMWizard = useIMChannelStore((s) => s.openWizard)
  const update = useGatewayUpdateStore((s) => s.update)
  const fetchVersion = useGatewayUpdateStore((s) => s.fetchVersion)
  const checkForUpdate = useGatewayUpdateStore((s) => s.checkForUpdate)
  const openAppDrawer = useAppsStore((s) => s.open)
  const [showUpdatePanel, setShowUpdatePanel] = useState(false)
  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const [time, setTime] = useState(() => formatTime(new Date()))
  const [mobileStatus, setMobileStatus] = useState<MobileStatus>({
    carrier: 'ClawOS',
    signalBars: 4,
    wifiConnected: true,
    wifiStrength: 80,
    batteryLevel: 85,
    batteryCharging: false,
  })

  useEffect(() => {
    const tick = () => setTime(formatTime(new Date()))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  const pollNativeStatus = useCallback(async () => {
    const native = await fetchNativeStatus()
    if (native) {
      setMobileStatus((prev) => ({ ...prev, ...native }))
    }
  }, [])

  useEffect(() => {
    pollNativeStatus()
    const interval = setInterval(pollNativeStatus, 10000)
    return () => clearInterval(interval)
  }, [pollNativeStatus])

  useEffect(() => {
    if (!isAndroid) return
    fetchVersion()
    const timer = setTimeout(checkForUpdate, 30000)
    const interval = setInterval(checkForUpdate, 6 * 60 * 60 * 1000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [fetchVersion, checkForUpdate])

  const wifiConnected = mobileStatus.wifiConnected && status !== 'disconnected'

  const batteryColor = mobileStatus.batteryCharging
    ? '#34d399'
    : mobileStatus.batteryLevel <= 15
      ? '#f87171'
      : mobileStatus.batteryLevel <= 30
        ? '#fbbf24'
        : '#34d399'

  const signalColor = mobileStatus.signalBars >= 2 ? 'rgba(255,255,255,0.8)' : '#fbbf24'
  const wifiColor = wifiConnected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)'

  // All layout uses inline styles for Android WebView compatibility
  return (
    <>
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '4px 8px',
      fontFamily: 'monospace',
      fontSize: '11px',
      lineHeight: 1,
      userSelect: 'none',
    }}>
      {/* Left: Carrier + Time */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: '0.5px' }}>
          {mobileStatus.carrier}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </span>
      </div>

      {/* Right: Settings + Signal + WiFi + Battery */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
        {isAndroid && (
          <span
            onClick={() => setShowQuickSettings(true)}
            style={{
              color: 'rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', cursor: 'pointer',
              padding: '4px 6px', borderRadius: '6px',
              background: 'rgba(255,255,255,0.08)',
            }}
          >
            <Settings size={14} />
          </span>
        )}
        <span style={{ color: signalColor, display: 'flex', alignItems: 'center' }}>
          <SignalIcon bars={mobileStatus.signalBars} />
        </span>
        <span style={{ color: wifiColor, display: 'flex', alignItems: 'center' }}>
          <WifiIcon connected={wifiConnected} />
        </span>
        <span style={{ color: batteryColor, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2px' }}>
          <BatteryIcon level={mobileStatus.batteryLevel} charging={mobileStatus.batteryCharging} />
          <span style={{ fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>
            {mobileStatus.batteryLevel}%
          </span>
        </span>
      </div>
    </div>
    {showUpdatePanel && (
      <Suspense fallback={null}>
        <GatewayUpdate onClose={() => setShowUpdatePanel(false)} />
      </Suspense>
    )}
    {showQuickSettings && (
      <QuickSettingsPanel onClose={() => setShowQuickSettings(false)} />
    )}
    </>
  )
}
