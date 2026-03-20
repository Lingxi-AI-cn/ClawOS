import { useConnectionStore, type ConnectionStatus } from '../store/connection.ts'

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; pulse: boolean }> = {
  disconnected: { label: '未连接', color: 'bg-gray-500', pulse: false },
  connecting: { label: '连接中...', color: 'bg-yellow-400', pulse: true },
  connected: { label: '已连接', color: 'bg-claw-success', pulse: true },
  error: { label: '连接错误', color: 'bg-claw-error', pulse: false },
}

export default function StatusIndicator() {
  const status = useConnectionStore((s) => s.status)
  const config = STATUS_CONFIG[status]

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center justify-center w-3 h-3">
        <div className={`w-2 h-2 rounded-full ${config.color}`} />
        {config.pulse && (
          <div className={`absolute w-3 h-3 rounded-full ${config.color} opacity-40 animate-ping`} />
        )}
      </div>
      <span className="text-xs text-claw-text-dim">{config.label}</span>
    </div>
  )
}
