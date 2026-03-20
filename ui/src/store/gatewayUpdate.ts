import { create } from 'zustand'
import { ClawOSBridge, isAndroid } from '../gateway/bridge.ts'

interface VersionInfo {
  installed: string
  rom: string
  backup: string | null
  pending: string | null
}

interface UpdateInfo {
  installed: string
  latest: string | null
  updateAvailable: boolean
}

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'staged' | 'restarting' | 'rolling-back' | 'error'

interface GatewayUpdateStore {
  phase: UpdatePhase
  version: VersionInfo | null
  update: UpdateInfo | null
  error: string | null

  fetchVersion: () => Promise<void>
  checkForUpdate: () => Promise<void>
  applyUpdate: () => Promise<void>
  rollback: () => Promise<void>
  restartGateway: () => Promise<void>
}

export const useGatewayUpdateStore = create<GatewayUpdateStore>((set, get) => ({
  phase: 'idle',
  version: null,
  update: null,
  error: null,

  fetchVersion: async () => {
    if (!isAndroid || !ClawOSBridge) return
    try {
      const res = await ClawOSBridge.getGatewayVersion()
      set({
        version: {
          installed: res.installed,
          rom: res.rom,
          backup: res.backup,
          pending: res.pending,
        },
      })
    } catch (e: any) {
      set({ error: e?.message || 'Failed to get version' })
    }
  },

  checkForUpdate: async () => {
    if (!isAndroid || !ClawOSBridge) return
    set({ phase: 'checking', error: null })
    try {
      const res = await ClawOSBridge.checkGatewayUpdate()
      if (res.error) {
        set({ phase: 'error', error: res.error })
        return
      }
      set({
        phase: 'idle',
        update: {
          installed: res.installed,
          latest: res.latest,
          updateAvailable: res.updateAvailable,
        },
      })
    } catch (e: any) {
      set({ phase: 'error', error: e?.message || 'Check failed' })
    }
  },

  applyUpdate: async () => {
    if (!isAndroid || !ClawOSBridge) return
    set({ phase: 'downloading', error: null })
    try {
      const res = await ClawOSBridge.applyGatewayUpdate()
      if (!res.success) {
        set({ phase: 'error', error: res.error || res.message || 'Apply failed' })
        return
      }
      if (res.message === 'already_up_to_date') {
        set({ phase: 'idle', update: null })
        await get().fetchVersion()
        return
      }
      // Auto-restart Gateway after staging
      set({ phase: 'staged' })
      await get().fetchVersion()
      await get().restartGateway()
    } catch (e: any) {
      set({ phase: 'error', error: e?.message || 'Apply failed' })
    }
  },

  rollback: async () => {
    if (!isAndroid || !ClawOSBridge) return
    set({ phase: 'rolling-back', error: null })
    try {
      const res = await ClawOSBridge.rollbackGateway()
      if (!res.success) {
        set({ phase: 'error', error: res.error || 'Rollback failed' })
        return
      }
      set({ phase: 'staged' })
      await get().fetchVersion()
    } catch (e: any) {
      set({ phase: 'error', error: e?.message || 'Rollback failed' })
    }
  },

  restartGateway: async () => {
    if (!isAndroid || !ClawOSBridge) return
    set({ phase: 'restarting', error: null })
    try {
      await ClawOSBridge.restartGateway()
      // Gateway restart takes time: OTA extraction + Node.js startup
      // Poll version every 3s until pending is cleared or timeout
      let attempts = 0
      const poll = async () => {
        attempts++
        await get().fetchVersion()
        const v = get().version
        if (v?.pending && attempts < 10) {
          setTimeout(poll, 3000)
        } else {
          set({ phase: 'idle', update: null })
        }
      }
      setTimeout(poll, 5000)
    } catch (e: any) {
      set({ phase: 'error', error: e?.message || 'Restart failed' })
    }
  },
}))
