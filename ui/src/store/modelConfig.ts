import { create } from 'zustand'

// ── Types ───────────────────────────────────────────────────────

export interface ProviderInfo {
    id: string
    label: string
    description: string
    authType: 'api_key' | 'base_url' | 'oauth' | 'none'
    keyPlaceholder?: string
    defaultBaseUrl?: string
    api: string
    oauthUrl?: string
    oauthScopes?: string[]
    /** Token exchange endpoint for OAuth providers */
    oauthTokenUrl?: string
    /** Link to guide users to create their own OAuth app credentials */
    oauthSetupGuide?: string
}

export interface ConfiguredProvider {
    id: string
    label: string
    apiKey?: string
    baseUrl?: string
    authenticated: boolean
}

export interface AvailableModel {
    id: string
    name: string
    provider: string
    contextWindow?: number
    reasoning?: boolean
}

// ── Known Providers ─────────────────────────────────────────────

export const KNOWN_PROVIDERS: ProviderInfo[] = [
    {
        id: 'anthropic',
        label: 'Anthropic',
        description: 'Claude Sonnet / Opus',
        authType: 'api_key',
        keyPlaceholder: 'sk-...',
        api: 'anthropic-messages',
        defaultBaseUrl: 'https://api.anthropic.com',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        description: 'GPT-4o / o1 / o3',
        authType: 'api_key',
        keyPlaceholder: 'sk-...',
        api: 'openai-completions',
    },
    {
        id: 'moonshot',
        label: 'Moonshot (Kimi)',
        description: 'Kimi K2 / K1.5 — 超长上下文',
        authType: 'api_key',
        keyPlaceholder: 'sk-...',
        api: 'openai-completions',
        defaultBaseUrl: 'https://api.moonshot.ai/v1',
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        description: 'DeepSeek-V3 / R1 — 高性价比',
        authType: 'api_key',
        keyPlaceholder: 'sk-...',
        api: 'openai-completions',
        defaultBaseUrl: 'https://api.deepseek.com/v1',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        description: '聚合平台 — 一个 Key 用所有模型',
        authType: 'api_key',
        keyPlaceholder: 'sk-or-...',
        api: 'openai-completions',
    },
    {
        id: 'ollama',
        label: 'Ollama (本地)',
        description: '本地运行开源模型',
        authType: 'base_url',
        defaultBaseUrl: 'http://10.0.2.2:11434/v1',
        api: 'openai-completions',
    },
]

// ── Store ───────────────────────────────────────────────────────

interface ModelConfigStore {
    isConfigured: boolean
    isSelectorOpen: boolean
    isWizardOpen: boolean
    activeModelRef: string | null
    activeModelName: string | null
    availableModels: AvailableModel[]
    /** Provider IDs explicitly configured by the user (persisted in localStorage) */
    userProviderIds: string[]
    loading: boolean

    setConfigured: (configured: boolean) => void
    openSelector: () => void
    closeSelector: () => void
    openWizard: () => void
    closeWizard: () => void
    setActiveModel: (ref: string, name: string) => void
    clearActiveModel: () => void
    setAvailableModels: (models: AvailableModel[]) => void
    addUserProvider: (providerId: string) => void
    removeUserProvider: (providerId: string) => void
    setLoading: (loading: boolean) => void
}

const STORAGE_KEY = 'clawos-user-providers'
const ACTIVE_MODEL_KEY = 'clawos-active-model'

function loadUserProviders(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : []
    } catch { return [] }
}

function saveUserProviders(ids: string[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch {}
}

function loadActiveModel(): { ref: string; name: string } | null {
    try {
        const raw = localStorage.getItem(ACTIVE_MODEL_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed?.ref) return parsed
        return null
    } catch { return null }
}

function saveActiveModel(ref: string | null, name: string | null) {
    try {
        if (ref) {
            localStorage.setItem(ACTIVE_MODEL_KEY, JSON.stringify({ ref, name }))
        } else {
            localStorage.removeItem(ACTIVE_MODEL_KEY)
        }
    } catch {}
}

const savedModel = loadActiveModel()

export const useModelConfigStore = create<ModelConfigStore>((set) => ({
    isConfigured: !!savedModel,
    isSelectorOpen: false,
    isWizardOpen: false,
    activeModelRef: savedModel?.ref ?? null,
    activeModelName: savedModel?.name ?? null,
    availableModels: [],
    userProviderIds: loadUserProviders(),
    loading: false,

    setConfigured: (configured) => set({ isConfigured: configured }),
    openSelector: () => set((state) =>
        state.isConfigured
            ? { isSelectorOpen: true }
            : { isSelectorOpen: true, isWizardOpen: true }
    ),
    closeSelector: () => set({ isSelectorOpen: false, isWizardOpen: false }),
    openWizard: () => set({ isWizardOpen: true }),
    closeWizard: () => set({ isWizardOpen: false }),
    setActiveModel: (ref, name) => {
        saveActiveModel(ref, name)
        set({
            activeModelRef: ref,
            activeModelName: name,
            isConfigured: true,
        })
    },
    setAvailableModels: (models) => set({
        availableModels: models,
    }),
    clearActiveModel: () => {
        saveActiveModel(null, null)
        set({ activeModelRef: null, activeModelName: null, isConfigured: false })
    },
    addUserProvider: (providerId) => set((state) => {
        if (state.userProviderIds.includes(providerId)) return state
        const updated = [...state.userProviderIds, providerId]
        saveUserProviders(updated)
        return { userProviderIds: updated }
    }),
    removeUserProvider: (providerId) => set((state) => {
        const updated = state.userProviderIds.filter(id => id !== providerId)
        saveUserProviders(updated)
        const models = state.availableModels.filter(m => m.provider !== providerId)
        const activeCleared = state.activeModelRef?.startsWith(providerId + '/')
        if (activeCleared) saveActiveModel(null, null)
        return {
            userProviderIds: updated,
            availableModels: models,
            ...(activeCleared ? { activeModelRef: null, activeModelName: null, isConfigured: updated.length > 0 } : {}),
        }
    }),
    setLoading: (loading) => set({ loading }),
}))
