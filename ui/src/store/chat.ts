import { create } from 'zustand'
import { useSceneStore } from './scene.ts'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  status: 'running' | 'completed' | 'error'
  input?: string
  output?: string
}

interface ChatStore {
  messages: ChatMessage[]
  isGenerating: boolean
  currentRunId: string | null
  sessionKey: string

  addMessage: (msg: ChatMessage) => void
  updateMessage: (id: string, update: Partial<ChatMessage>) => void
  appendToMessage: (id: string, text: string) => void
  setGenerating: (generating: boolean, runId?: string | null) => void
  addToolCall: (messageId: string, toolCall: ToolCall) => void
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCall>) => void
  setMessages: (messages: ChatMessage[]) => void
  clear: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isGenerating: false,
  currentRunId: null,
  sessionKey: 'main',

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateMessage: (id, update) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...update } : m)),
    })),

  appendToMessage: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m
      ),
    })),

  setGenerating: (generating, runId = null) => {
    set({ isGenerating: generating, currentRunId: runId })
    const sceneStore = useSceneStore.getState()
    if (generating) {
      sceneStore.setState('thinking')
    } else {
      sceneStore.setState('idle')
    }
  },

  addToolCall: (messageId, toolCall) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id === messageId) {
          return { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
        }
        return m
      }),
    })),

  updateToolCall: (messageId, toolCallId, update) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            toolCalls: m.toolCalls?.map((tc) =>
              tc.id === toolCallId ? { ...tc, ...update } : tc
            ),
          }
        }
        return m
      }),
    })),

  setMessages: (messages) => set({ messages }),

  clear: () => {
    set({ messages: [], isGenerating: false, currentRunId: null })
    useSceneStore.getState().setState('idle')
  },
}))
