import { create } from 'zustand'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ModelMode = 'cloud' | 'local'

export interface ModelOption {
  ref: string
  label: string
  mode: ModelMode
}

export const MODEL_OPTIONS: ModelOption[] = [
  { ref: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', mode: 'cloud' },
  { ref: 'ollama/gpt-oss:20b', label: 'GPT-OSS 20B', mode: 'local' },
]

const MODEL_STORAGE_KEY = 'clawos-model-mode'

function loadSavedModelMode(): ModelMode {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY)
    if (saved === 'local' || saved === 'cloud') return saved
  } catch { /* ignore */ }
  return 'cloud'
}

interface ConnectionStore {
  status: ConnectionStatus
  error: string | null
  connId: string | null
  serverVersion: string | null
  modelMode: ModelMode
  modelSwitching: boolean

  setStatus: (status: ConnectionStatus) => void
  setConnected: (connId: string, serverVersion: string) => void
  setError: (error: string) => void
  reset: () => void
  setModelMode: (mode: ModelMode) => void
  setModelSwitching: (switching: boolean) => void
}

export function getModelOption(mode: ModelMode): ModelOption {
  return MODEL_OPTIONS.find((m) => m.mode === mode) ?? MODEL_OPTIONS[0]
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'connecting',
  error: null,
  connId: null,
  serverVersion: null,
  modelMode: loadSavedModelMode(),
  modelSwitching: false,

  setStatus: (status) => set({ status, error: status === 'error' ? undefined : null }),
  setConnected: (connId, serverVersion) =>
    set({ status: 'connected', connId, serverVersion, error: null }),
  setError: (error) => set({ status: 'error', error }),
  reset: () => set({ status: 'disconnected', error: null, connId: null, serverVersion: null }),
  setModelMode: (mode) => {
    try { localStorage.setItem(MODEL_STORAGE_KEY, mode) } catch { /* ignore */ }
    set({ modelMode: mode })
  },
  setModelSwitching: (switching) => set({ modelSwitching: switching }),
}))
