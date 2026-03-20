import { create } from 'zustand'
import { ClawOSBridge, isAndroid, type AppInfo } from '../gateway/bridge.ts'

interface AppsStore {
  apps: AppInfo[]
  isLoading: boolean
  isOpen: boolean
  searchQuery: string
  hasFetched: boolean

  open: () => void
  close: () => void
  setSearchQuery: (q: string) => void
  fetchApps: () => Promise<void>
  launchApp: (packageName: string) => Promise<void>
}

export const useAppsStore = create<AppsStore>((set, get) => ({
  apps: [],
  isLoading: false,
  isOpen: false,
  searchQuery: '',
  hasFetched: false,

  open: () => {
    set({ isOpen: true })
    if (!get().hasFetched) {
      get().fetchApps()
    }
  },

  close: () => set({ isOpen: false, searchQuery: '' }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchApps: async () => {
    if (!isAndroid || !ClawOSBridge) return
    set({ isLoading: true })
    try {
      const result = await ClawOSBridge.getInstalledApps()
      const sorted = (result.apps || []).sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
        return a.label.localeCompare(b.label, 'zh-CN')
      })
      set({ apps: sorted, hasFetched: true })
    } catch (err) {
      console.error('[AppsStore] Failed to fetch apps:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  launchApp: async (packageName) => {
    if (!isAndroid || !ClawOSBridge) return
    try {
      await ClawOSBridge.launchApp({ packageName })
    } catch (err) {
      console.error('[AppsStore] Failed to launch app:', err)
    }
  },
}))

export type { AppInfo }
