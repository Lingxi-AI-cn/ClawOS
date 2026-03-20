import { useState, useCallback, useEffect, type CSSProperties } from 'react'
import {
  ArrowLeft, Plus, Trash2, Power, PowerOff,
  CheckCircle2, XCircle, Loader2, AlertTriangle,
} from 'lucide-react'
import { IM_PLATFORMS } from '../store/imChannels.ts'
import { ClawOSBridge, isAndroid } from '../gateway/bridge.ts'

const CONFIG_PATH = '/data/local/tmp/clawos/openclaw.json'

interface ConfiguredChannel {
  id: string
  label: string
  color: string
  enabled: boolean
}

interface IMChannelListProps {
  onClose: () => void
  onAddNew: () => void
}

export default function IMChannelList({ onClose, onAddNew }: IMChannelListProps) {
  const [channels, setChannels] = useState<ConfiguredChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  const loadChannels = useCallback(async () => {
    setLoading(true)
    try {
      if (isAndroid && ClawOSBridge) {
        const result = await ClawOSBridge.readTextFile({ path: CONFIG_PATH })
        const config = JSON.parse(result.content)
        const ch = config.channels ?? {}
        const list: ConfiguredChannel[] = []
        for (const [id, val] of Object.entries(ch)) {
          const info = IM_PLATFORMS.find(p => p.id === id)
          if (info && val && typeof val === 'object') {
            list.push({
              id,
              label: info.label,
              color: info.color,
              enabled: (val as any).enabled !== false,
            })
          }
        }
        setChannels(list)
      } else {
        setChannels([])
      }
    } catch {
      setChannels([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setActionId(id)
    try {
      if (isAndroid && ClawOSBridge) {
        await ClawOSBridge.patchJsonFile({
          path: CONFIG_PATH,
          jsonPath: `channels.${id}.enabled`,
          value: JSON.stringify(!enabled),
        })
        await ClawOSBridge.restartGateway()
      }
      setChannels(prev => prev.map(c => c.id === id ? { ...c, enabled: !enabled } : c))
    } catch (err) {
      console.error('[IMChannelList] toggle failed:', err)
    } finally {
      setActionId(null)
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setActionId(id)
    try {
      if (isAndroid && ClawOSBridge) {
        await ClawOSBridge.patchJsonFile({
          path: CONFIG_PATH,
          jsonPath: `channels.${id}`,
          value: 'null',
        })
        await ClawOSBridge.restartGateway()
      }
      setChannels(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      console.error('[IMChannelList] delete failed:', err)
    } finally {
      setActionId(null)
    }
  }, [])

  return (
    <div style={overlayStyle}>
      <div style={headerStyle}>
        <div onClick={onClose} style={backBtn}>
          <ArrowLeft size={18} />
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: '#fff', margin: 0, flex: 1 }}>
          IM 通道管理
        </h2>
        <div onClick={onAddNew} style={{ ...backBtn, background: 'rgba(34,211,238,0.12)' }}>
          <Plus size={18} style={{ color: '#22d3ee' }} />
        </div>
      </div>

      <div style={contentStyle}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block' }} />
            加载中...
          </div>
        ) : channels.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', margin: '0 0 20px' }}>
              尚未配置任何 IM 通道
            </p>
            <div onClick={onAddNew} style={{
              ...primaryBtn,
              maxWidth: 240, margin: '0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Plus size={16} />
              添加通道
            </div>
          </div>
        ) : (
          <>
            {channels.map(ch => {
              const busy = actionId === ch.id
              return (
                <div key={ch.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', borderRadius: 14,
                  background: 'rgba(255,255,255,0.03)',
                  marginBottom: 8,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: `${ch.color}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {ch.enabled
                      ? <CheckCircle2 size={18} style={{ color: ch.color }} />
                      : <XCircle size={18} style={{ color: 'rgba(255,255,255,0.25)' }} />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>{ch.label}</div>
                    <div style={{ fontSize: 11, color: ch.enabled ? '#34d399' : 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {ch.enabled ? '已启用' : '已禁用'}
                    </div>
                  </div>
                  {busy ? (
                    <Loader2 size={16} style={{ color: 'rgba(255,255,255,0.3)', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div
                        onClick={() => handleToggle(ch.id, ch.enabled)}
                        style={iconBtn}
                        title={ch.enabled ? '禁用' : '启用'}
                      >
                        {ch.enabled
                          ? <PowerOff size={14} style={{ color: '#fbbf24' }} />
                          : <Power size={14} style={{ color: '#34d399' }} />
                        }
                      </div>
                      <div
                        onClick={() => handleDelete(ch.id)}
                        style={iconBtn}
                        title="删除"
                      >
                        <Trash2 size={14} style={{ color: '#f87171' }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <div
              onClick={onAddNew}
              style={{
                ...secondaryBtn,
                marginTop: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Plus size={16} />
              添加更多通道
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 920,
  background: 'linear-gradient(180deg, #1a1d2e 0%, #12141f 100%)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '16px 16px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  flexShrink: 0,
}

const contentStyle: CSSProperties = {
  flex: 1, overflowY: 'auto', padding: 16,
}

const backBtn: CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

const iconBtn: CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.04)',
  cursor: 'pointer',
}

const primaryBtn: CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #22d3ee, #6366f1)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  textAlign: 'center',
  cursor: 'pointer',
}

const secondaryBtn: CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 14,
  fontWeight: 500,
  textAlign: 'center',
  cursor: 'pointer',
}
