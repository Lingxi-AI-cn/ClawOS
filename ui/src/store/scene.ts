import { create } from 'zustand'

export type SceneState = 'idle' | 'thinking' | 'toolCall' | 'responding' | 'error'

interface SceneStore {
  state: SceneState
  toolCallCount: number
  particleIntensity: number
  accentColor: [number, number, number]

  setState: (state: SceneState) => void
  setToolCallCount: (count: number) => void
  incrementToolCall: () => void
  decrementToolCall: () => void
}

// Color mappings for different states
const STATE_COLORS: Record<SceneState, [number, number, number]> = {
  idle: [0.22, 0.74, 0.97],       // cyan #38bdf8
  thinking: [0.56, 0.49, 0.96],    // purple #8f7df5
  toolCall: [0.98, 0.76, 0.22],    // amber #fac238
  responding: [0.20, 0.83, 0.60],  // emerald #34d399
  error: [0.97, 0.44, 0.44],       // red #f87171
}

const STATE_INTENSITY: Record<SceneState, number> = {
  idle: 0.3,
  thinking: 0.8,
  toolCall: 1.0,
  responding: 0.6,
  error: 0.9,
}

export const useSceneStore = create<SceneStore>((set) => ({
  state: 'idle',
  toolCallCount: 0,
  particleIntensity: STATE_INTENSITY.idle,
  accentColor: STATE_COLORS.idle,

  setState: (state) =>
    set({
      state,
      particleIntensity: STATE_INTENSITY[state],
      accentColor: STATE_COLORS[state],
    }),

  setToolCallCount: (count) => set({ toolCallCount: count }),
  incrementToolCall: () =>
    set((s) => ({ toolCallCount: s.toolCallCount + 1 })),
  decrementToolCall: () =>
    set((s) => ({ toolCallCount: Math.max(0, s.toolCallCount - 1) })),
}))
