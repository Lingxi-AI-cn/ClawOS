import { useRef, useCallback, useEffect, useState } from 'react'
import { Search, X, RefreshCw, Power, RotateCw } from 'lucide-react'
import { useAppsStore, type AppInfo } from '../store/apps.ts'
import { ClawOSBridge, isAndroid } from '../gateway/bridge.ts'

const GRID_COLS = 4
const ICON_SIZE = 56

function AppIcon({ app, onLaunch }: { app: AppInfo; onLaunch: (pkg: string) => void }) {
  return (
    <div
      onClick={() => onLaunch(app.packageName)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 4px',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onPointerDown={(e) => {
        const el = e.currentTarget
        el.style.background = 'rgba(255,255,255,0.1)'
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {app.icon ? (
        <img
          src={app.icon}
          alt={app.label}
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: '14px',
            objectFit: 'cover',
          }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: '14px',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
          }}
        >
          {app.label.charAt(0)}
        </div>
      )}
      <span
        style={{
          fontSize: '11px',
          color: 'rgba(255,255,255,0.85)',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '72px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {app.label}
      </span>
    </div>
  )
}

export default function AppDrawer() {
  const { apps, isLoading, isOpen, searchQuery, close, setSearchQuery, fetchApps, launchApp } = useAppsStore()
  const [drawerHeight, setDrawerHeight] = useState(60) // percentage
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const filteredApps = searchQuery.trim()
    ? apps.filter((a) =>
        a.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.packageName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : apps

  const systemApps = filteredApps.filter((a) => a.isSystem)
  const userApps = filteredApps.filter((a) => !a.isSystem)

  const handleLaunch = useCallback((pkg: string) => {
    launchApp(pkg)
    close()
  }, [launchApp, close])

  useEffect(() => {
    if (isOpen) {
      setDrawerHeight(60)
    }
  }, [isOpen])

  // Handle drag on the handle bar to resize / close
  const onHandleTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, startHeight: drawerHeight }
  }, [drawerHeight])

  const onHandleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return
    const dy = dragRef.current.startY - e.touches[0].clientY
    const windowH = window.innerHeight
    const deltaPercent = (dy / windowH) * 100
    const newHeight = Math.max(20, Math.min(95, dragRef.current.startHeight + deltaPercent))
    setDrawerHeight(newHeight)
  }, [])

  const onHandleTouchEnd = useCallback(() => {
    if (!dragRef.current) return
    if (drawerHeight < 30) {
      close()
    } else if (drawerHeight > 80) {
      setDrawerHeight(95)
    } else {
      setDrawerHeight(60)
    }
    dragRef.current = null
  }, [drawerHeight, close])

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) close() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          height: `${drawerHeight}%`,
          background: 'rgba(12,14,28,0.96)',
          backdropFilter: 'blur(24px)',
          borderTop: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '20px 20px 0 0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: dragRef.current ? 'none' : 'height 0.25s ease-out',
        }}
      >
        {/* Drag Handle */}
        <div
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 0 6px',
            cursor: 'grab',
            touchAction: 'none',
          }}
        >
          <div style={{
            width: '36px',
            height: '4px',
            borderRadius: '2px',
            background: 'rgba(255,255,255,0.3)',
          }} />
        </div>

        {/* Header: Title + Actions */}
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px 8px',
        }}>
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.9)',
          }}>
            应用列表
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => fetchApps()}
              disabled={isLoading}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                borderRadius: '8px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
            </button>
            <button
              onClick={close}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                borderRadius: '8px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ flexShrink: 0, padding: '0 16px 10px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '10px',
            padding: '8px 12px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <Search size={16} color="rgba(255,255,255,0.4)" />
            <input
              type="text"
              placeholder="搜索应用..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: '14px',
              }}
            />
            {searchQuery && (
              <X
                size={14}
                color="rgba(255,255,255,0.5)"
                onClick={() => setSearchQuery('')}
                style={{ cursor: 'pointer' }}
              />
            )}
          </div>
        </div>

        {/* App Grid */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 12px 16px',
          WebkitOverflowScrolling: 'touch',
        }}>
          {isLoading && apps.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '120px',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '14px',
            }}>
              加载应用列表...
            </div>
          ) : filteredApps.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '120px',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '14px',
            }}>
              {searchQuery ? '未找到匹配的应用' : '暂无已安装应用'}
            </div>
          ) : (
            <>
              {/* User apps */}
              {userApps.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                  gap: '4px',
                }}>
                  {userApps.map((app) => (
                    <AppIcon key={app.packageName} app={app} onLaunch={handleLaunch} />
                  ))}
                </div>
              )}

              {/* System apps section */}
              {systemApps.length > 0 && (
                <>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '14px 8px 6px',
                  }}>
                    <span style={{
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.4)',
                      fontWeight: 500,
                    }}>
                      系统应用
                    </span>
                    <div style={{
                      flex: 1,
                      height: '1px',
                      background: 'rgba(255,255,255,0.08)',
                    }} />
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                    gap: '4px',
                  }}>
                    {systemApps.map((app) => (
                      <AppIcon key={app.packageName} app={app} onLaunch={handleLaunch} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Power controls */}
        <PowerControls onDone={close} />
      </div>

      {/* Spin animation for refresh icon */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export function PowerControls({ onDone }: { onDone?: () => void }) {
  const [confirming, setConfirming] = useState<'reboot' | 'shutdown' | null>(null)

  const handleAction = useCallback(async (action: 'reboot' | 'shutdown') => {
    if (!isAndroid || !ClawOSBridge) return
    if (confirming !== action) {
      setConfirming(action)
      return
    }
    try {
      if (action === 'reboot') {
        await ClawOSBridge.rebootDevice()
      } else {
        await ClawOSBridge.shutdownDevice()
      }
    } catch (e) {
      console.error(`[PowerControls] ${action} failed:`, e)
    }
    onDone?.()
  }, [confirming, onDone])

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(null), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  if (!isAndroid) return null

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '12px 16px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      flexShrink: 0,
    }}>
      <button
        onClick={() => handleAction('reboot')}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '10px',
          borderRadius: '10px',
          border: confirming === 'reboot' ? '1px solid rgba(34,211,238,0.5)' : '1px solid rgba(255,255,255,0.1)',
          background: confirming === 'reboot' ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.06)',
          color: confirming === 'reboot' ? '#22d3ee' : 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          fontSize: '13px',
          transition: 'all 0.2s',
        }}
      >
        <RotateCw size={14} />
        {confirming === 'reboot' ? '确认重启？' : '重启'}
      </button>
      <button
        onClick={() => handleAction('shutdown')}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '10px',
          borderRadius: '10px',
          border: confirming === 'shutdown' ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.1)',
          background: confirming === 'shutdown' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
          color: confirming === 'shutdown' ? '#ef4444' : 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          fontSize: '13px',
          transition: 'all 0.2s',
        }}
      >
        <Power size={14} />
        {confirming === 'shutdown' ? '确认关机？' : '关机'}
      </button>
    </div>
  )
}
