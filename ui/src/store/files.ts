import { create } from 'zustand'

export interface FileEntry {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  mtime: number
  permissions: string
}

interface FilesStore {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  // Internal: the fetch function is injected from filesystem.ts
  _fetchFn: ((path: string) => Promise<{ path: string; entries: FileEntry[] }>) | null
  setFetchFn: (fn: (path: string) => Promise<{ path: string; entries: FileEntry[] }>) => void
  navigateTo: (path: string) => Promise<void>
  refresh: () => Promise<void>
  goUp: () => Promise<void>
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  currentPath: '/home/clawos',
  entries: [],
  loading: false,
  error: null,
  _fetchFn: null,

  setFetchFn: (fn) => set({ _fetchFn: fn }),

  navigateTo: async (path: string) => {
    const { _fetchFn } = get()
    if (!_fetchFn) return
    set({ loading: true, error: null })
    try {
      const result = await _fetchFn(path)
      set({ currentPath: result.path, entries: result.entries, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  refresh: async () => {
    const { currentPath, _fetchFn } = get()
    if (!_fetchFn) return
    set({ loading: true, error: null })
    try {
      const result = await _fetchFn(currentPath)
      set({ entries: result.entries, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  goUp: async () => {
    const { currentPath } = get()
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/'
    return get().navigateTo(parent)
  },
}))
