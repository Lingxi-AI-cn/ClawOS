// ModelSwitcher — model status indicator + tap to open ModelSelector
//
// States:
//   - Unconfigured: amber call-to-action, "点击配置模型 →"
//   - Configured: shows active model name, tap opens selector
//   - Switching: shows spinner

import { Cpu, Sparkles, ChevronDown } from 'lucide-react'
import { useModelConfigStore } from '../store/modelConfig.ts'
import { useConnectionStore } from '../store/connection.ts'

export default function ModelSwitcher() {
  const isConfigured = useModelConfigStore((s) => s.isConfigured)
  const activeModelName = useModelConfigStore((s) => s.activeModelName)
  const openSelector = useModelConfigStore((s) => s.openSelector)
  const status = useConnectionStore((s) => s.status)
  const connected = status === 'connected'

  // Colors based on state
  const unconfigured = !isConfigured
  const accentColor = unconfigured ? '#f59e0b' : '#22d3ee'
  const borderColor = unconfigured ? 'rgba(245,158,11,0.35)' : 'rgba(34,211,238,0.3)'
  const bgColor = unconfigured ? 'rgba(245,158,11,0.1)' : 'rgba(34,211,238,0.08)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 8px 2px', gap: '2px' }}>
      <div
        onClick={() => connected && openSelector()}
        onTouchEnd={(e) => { e.preventDefault(); connected && openSelector(); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: unconfigured ? '7px 18px' : '5px 14px',
          borderRadius: '20px',
          border: `1px solid ${borderColor}`,
          background: bgColor,
          color: accentColor,
          cursor: connected ? 'pointer' : 'default',
          opacity: connected ? 1 : 0.4,
          fontSize: unconfigured ? '12px' : '11px',
          fontFamily: 'monospace',
          fontWeight: unconfigured ? 600 : 500,
          letterSpacing: '0.3px',
          transition: 'all 0.3s ease',
          boxShadow: `0 0 ${unconfigured ? '16px' : '10px'} ${unconfigured ? 'rgba(245,158,11,0.12)' : 'rgba(34,211,238,0.08)'}`,
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          animation: unconfigured && connected ? 'modelPulse 2s ease-in-out infinite' : 'none',
        }}
      >
        {/* Icon */}
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {unconfigured ? <Sparkles size={14} /> : <Cpu size={13} />}
        </span>

        {/* Label */}
        <span style={{ whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {unconfigured ? '点击配置模型 →' : (activeModelName ?? '选择模型')}
        </span>

        {/* Dropdown indicator (configured only) */}
        {!unconfigured && (
          <span style={{
            display: 'flex', alignItems: 'center',
            opacity: 0.5, marginLeft: '2px',
          }}>
            <ChevronDown size={10} />
          </span>
        )}

        {/* Status dot */}
        <span style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: accentColor,
          boxShadow: `0 0 6px ${accentColor}`,
          flexShrink: 0,
        }} />
      </div>

      {/* Hint text (configured state only) */}
      {connected && !unconfigured && (
        <span style={{
          fontSize: '9px',
          color: 'rgba(255,255,255,0.25)',
          fontFamily: 'monospace',
        }}>
          点击切换模型
        </span>
      )}

      {/* Pulse animation for unconfigured state */}
      {unconfigured && (
        <style>{`@keyframes modelPulse {
          0%, 100% { box-shadow: 0 0 16px rgba(245,158,11,0.12); }
          50% { box-shadow: 0 0 24px rgba(245,158,11,0.25); }
        }`}</style>
      )}
    </div>
  )
}

