import { useEffect } from 'react'
import { Download, RefreshCw, RotateCcw, CheckCircle, AlertTriangle, Loader2, X, ArrowUpCircle } from 'lucide-react'
import { useGatewayUpdateStore } from '../store/gatewayUpdate.ts'
import { isAndroid } from '../gateway/bridge.ts'

interface Props {
  onClose: () => void
}

export default function GatewayUpdate({ onClose }: Props) {
  const { phase, version, update, error, fetchVersion, checkForUpdate, applyUpdate, rollback, restartGateway } =
    useGatewayUpdateStore()

  useEffect(() => {
    useGatewayUpdateStore.setState({ error: null })
    fetchVersion()
    checkForUpdate()
  }, [fetchVersion, checkForUpdate])

  if (!isAndroid) {
    return (
      <Panel onClose={onClose}>
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '24px 0' }}>
          Gateway OTA 更新仅在 Android 设备上可用
        </p>
      </Panel>
    )
  }

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'restarting' || phase === 'rolling-back'

  return (
    <Panel onClose={onClose}>
      {/* Version info */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle>当前版本</SectionTitle>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <VersionBadge label="已安装" value={version?.installed} accent />
          <VersionBadge label="ROM" value={version?.rom} />
          {version?.backup && <VersionBadge label="备份" value={version.backup} />}
          {version?.pending && <VersionBadge label="待应用" value={version.pending} highlight />}
        </div>
      </div>

      {/* Update check result */}
      {update && (
        <div style={{ marginBottom: 16 }}>
          <SectionTitle>更新状态</SectionTitle>
          {update.updateAvailable ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'rgba(34,211,238,0.1)', borderRadius: 8, border: '1px solid rgba(34,211,238,0.25)',
            }}>
              <ArrowUpCircle size={18} style={{ color: '#22d3ee', flexShrink: 0 }} />
              <span style={{ color: '#22d3ee', fontSize: 13 }}>
                新版本可用: <strong>{update.latest}</strong> (当前: {update.installed})
              </span>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'rgba(52,211,153,0.08)', borderRadius: 8, border: '1px solid rgba(52,211,153,0.2)',
            }}>
              <CheckCircle size={18} style={{ color: '#34d399', flexShrink: 0 }} />
              <span style={{ color: '#34d399', fontSize: 13 }}>
                已是最新版本 ({update.installed})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Staged notice */}
      {phase === 'staged' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
          background: 'rgba(251,191,36,0.1)', borderRadius: 8, border: '1px solid rgba(251,191,36,0.25)',
        }}>
          <AlertTriangle size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <span style={{ color: '#fbbf24', fontSize: 13 }}>
            更新已暂存，重启 Gateway 后生效
          </span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
          background: 'rgba(248,113,113,0.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.25)',
        }}>
          <AlertTriangle size={18} style={{ color: '#f87171', flexShrink: 0 }} />
          <span style={{ color: '#f87171', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ActionButton
          onClick={checkForUpdate}
          disabled={busy}
          icon={busy && phase === 'checking' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          label={phase === 'checking' ? '正在检查...' : '检查更新'}
        />

        {update?.updateAvailable && phase !== 'staged' && (
          <ActionButton
            onClick={applyUpdate}
            disabled={busy}
            primary
            icon={busy && phase === 'downloading' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            label={phase === 'downloading' ? '正在下载...' : `更新到 ${update.latest}`}
          />
        )}

        {(phase === 'staged' || version?.pending) && (
          <ActionButton
            onClick={restartGateway}
            disabled={busy}
            primary
            icon={phase === 'restarting' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            label={phase === 'restarting' ? '正在重启...' : '重启 Gateway 以应用更新'}
          />
        )}

        {version?.backup && (
          <ActionButton
            onClick={rollback}
            disabled={busy}
            icon={phase === 'rolling-back' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            label={phase === 'rolling-back' ? '正在回滚...' : `回滚到 ${version.backup}`}
            danger
          />
        )}
      </div>
    </Panel>
  )
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: '90%', maxWidth: 420, maxHeight: '80vh', overflow: 'auto',
        background: 'rgba(15,15,30,0.95)', borderRadius: 16,
        border: '1px solid rgba(34,211,238,0.15)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 60px rgba(34,211,238,0.05)',
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>
            Gateway 更新
          </h2>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4 }}>
            <X size={18} />
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontFamily: 'monospace',
    }}>
      {children}
    </div>
  )
}

function VersionBadge({ label, value, accent, highlight }: {
  label: string; value?: string | null; accent?: boolean; highlight?: boolean
}) {
  if (!value) return null
  const bg = highlight
    ? 'rgba(251,191,36,0.12)'
    : accent
      ? 'rgba(34,211,238,0.12)'
      : 'rgba(255,255,255,0.06)'
  const color = highlight ? '#fbbf24' : accent ? '#22d3ee' : 'rgba(255,255,255,0.7)'
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 8, background: bg,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ fontSize: 13, color, fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function ActionButton({ onClick, disabled, icon, label, primary, danger }: {
  onClick: () => void; disabled?: boolean; icon: React.ReactNode; label: string
  primary?: boolean; danger?: boolean
}) {
  const bg = disabled
    ? 'rgba(255,255,255,0.04)'
    : danger
      ? 'rgba(248,113,113,0.12)'
      : primary
        ? 'rgba(34,211,238,0.15)'
        : 'rgba(255,255,255,0.06)'
  const border = danger
    ? 'rgba(248,113,113,0.25)'
    : primary
      ? 'rgba(34,211,238,0.3)'
      : 'rgba(255,255,255,0.1)'
  const color = disabled
    ? 'rgba(255,255,255,0.25)'
    : danger
      ? '#f87171'
      : primary
        ? '#22d3ee'
        : 'rgba(255,255,255,0.7)'

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
        background: bg, border: `1px solid ${border}`, color,
        fontSize: 13, fontWeight: 600, fontFamily: 'monospace',
        transition: 'all 0.15s ease',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      {label}
    </div>
  )
}
