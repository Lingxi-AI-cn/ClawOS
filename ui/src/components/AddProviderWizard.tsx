// AddProviderWizard — step-by-step provider configuration for ClawOS
//
// For API Key providers (Google, OpenAI, Anthropic, OpenRouter):
//   Step 1: pick provider → Step 2: enter API key → Step 3: verify & save
//
// For Ollama (base_url):
//   Step 1: pick provider → Step 2: enter URL → Step 3: connect & list models
//   → Step 4: select models → Step 5: save

import { useCallback, useState, type CSSProperties } from 'react'
import {
    ArrowLeft, Check, Loader2, AlertTriangle,
    Key, Link, Shield, ChevronRight, RefreshCw,
    Server, Cpu, Zap, CheckCircle2, Circle,
} from 'lucide-react'
import { KNOWN_PROVIDERS, useModelConfigStore, type ProviderInfo } from '../store/modelConfig.ts'
import { ClawOSBridge, isAndroid } from '../gateway/bridge.ts'
import type { GatewayClient } from '../gateway/client.ts'

// Provider icons as colored-letter badges
const providerIcons: Record<string, { letter: string; color: string }> = {
    'anthropic': { letter: 'A', color: '#d97757' },
    'openai': { letter: 'O', color: '#10a37f' },
    'moonshot': { letter: 'K', color: '#7c3aed' },
    'deepseek': { letter: 'D', color: '#2563eb' },
    'openrouter': { letter: 'R', color: '#6366f1' },
    'ollama': { letter: '🏠', color: 'rgba(255,255,255,0.1)' },
}

// Ollama model fetched from /v1/models
interface OllamaModelInfo {
    id: string
    name?: string
    owned_by?: string
    selected: boolean
}

type WizardStep = 'pick' | 'auth' | 'oauth-creds' | 'oauth' | 'oauth-paste' | 'ollama-connect' | 'ollama-models' | 'verify'

interface AddProviderWizardProps {
    onComplete: () => void
    onCancel: () => void
    initialProvider?: string
    gatewayClient?: GatewayClient
}

export default function AddProviderWizard({ onComplete, onCancel, initialProvider, gatewayClient }: AddProviderWizardProps) {
    const initProvider = initialProvider ? KNOWN_PROVIDERS.find(p => p.id === initialProvider) ?? null : null
    const [step, setStep] = useState<WizardStep>(() => {
        if (!initProvider) return 'pick'
        return initProvider.authType === 'oauth' ? 'oauth-creds' : 'auth'
    })
    const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(initProvider)
    const [apiKey, setApiKey] = useState('')
    const [baseUrl, setBaseUrl] = useState(initProvider?.defaultBaseUrl ?? '')
    const [verifying, setVerifying] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)

    // Ollama-specific state
    const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
    const [ollamaConnecting, setOllamaConnecting] = useState(false)

    // OAuth-specific state
    const [oauthEmail, setOauthEmail] = useState('')
    const [oauthInProgress, setOauthInProgress] = useState(false)
    const [oauthClientId, setOauthClientId] = useState('')
    const [oauthClientSecret, setOauthClientSecret] = useState('')
    const [oauthSessionId, setOauthSessionId] = useState('')
    const [oauthRedirectUrl, setOauthRedirectUrl] = useState('')

    // Step 1: pick provider
    const handlePickProvider = useCallback((p: ProviderInfo) => {
        setSelectedProvider(p)
        setApiKey('')
        setBaseUrl(p.defaultBaseUrl ?? '')
        setError('')
        setOllamaModels([])
        setOauthEmail('')
        setOauthClientId('')
        setOauthClientSecret('')

        if (p.authType === 'oauth') {
            setStep('oauth-creds')
        } else if (p.authType === 'base_url') {
            setStep('auth')
        } else {
            setStep('auth')
        }
    }, [])

    // Ollama: connect to URL and fetch model list
    const handleOllamaConnect = useCallback(async () => {
        if (!baseUrl.trim()) {
            setError('请输入 Ollama 服务地址')
            return
        }

        setOllamaConnecting(true)
        setError('')

        try {
            // Normalize URL: strip trailing /v1 for the models endpoint
            let url = baseUrl.trim().replace(/\/+$/, '')
            // If user entered something like http://host:11434/v1, use it directly
            // If they entered http://host:11434, append /v1/models
            const modelsUrl = url.endsWith('/v1')
                ? `${url}/models`
                : url.endsWith('/v1/models')
                    ? url
                    : `${url}/v1/models`

            // AbortSignal.timeout() not supported on Android 12 WebView
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 8000)

            let response: Response
            try {
                response = await fetch(modelsUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal,
                })
            } finally {
                clearTimeout(timeoutId)
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const data = await response.json()
            const models: OllamaModelInfo[] = (data.data || data.models || []).map((m: any) => ({
                id: m.id || m.name || m.model,
                name: m.id || m.name || m.model,
                owned_by: m.owned_by || 'local',
                selected: true,  // pre-select all
            }))

            if (models.length === 0) {
                setError('Ollama 服务运行正常，但尚未下载任何模型。请先运行 ollama pull <model>')
                setOllamaConnecting(false)
                return
            }

            setOllamaModels(models)
            setStep('ollama-models')
        } catch (err: any) {
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
                setError('连接超时 — 请检查 Ollama 是否运行以及地址是否正确')
            } else if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
                setError('无法连接到 Ollama — 请检查地址和端口')
            } else {
                setError(`连接失败: ${err?.message || '未知错误'}`)
            }
        } finally {
            setOllamaConnecting(false)
        }
    }, [baseUrl])

    // Toggle Ollama model selection
    const toggleOllamaModel = useCallback((id: string) => {
        setOllamaModels(prev => prev.map(m =>
            m.id === id ? { ...m, selected: !m.selected } : m
        ))
    }, [])

    const selectAllOllama = useCallback(() => {
        const allSelected = ollamaModels.every(m => m.selected)
        setOllamaModels(prev => prev.map(m => ({ ...m, selected: !allSelected })))
    }, [ollamaModels])

    // OAuth: start authorization flow
    const handleOAuthStart = useCallback(async () => {
        if (!selectedProvider || !oauthEmail.trim()) {
            setError('请输入账号邮箱')
            return
        }

        setOauthInProgress(true)
        setError('')

        try {
            // OAuth providers: use native bridge
            if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
                setError('请先填写 OAuth 应用凭据')
                setOauthInProgress(false)
                return
            }
            if (isAndroid && ClawOSBridge) {
                const result = await ClawOSBridge.startOAuthFlow({
                    provider: selectedProvider.id,
                    email: oauthEmail.trim(),
                    authUrl: selectedProvider.oauthUrl ?? '',
                    scopes: selectedProvider.oauthScopes ?? [],
                    clientId: oauthClientId.trim(),
                    clientSecret: oauthClientSecret.trim(),
                    tokenUrl: selectedProvider.oauthTokenUrl ?? 'https://oauth2.googleapis.com/token',
                })
                if (result.success) {
                    setStep('verify')
                    await handleSaveOAuth(
                        result.accessToken ?? '',
                        result.refreshToken ?? '',
                        result.expiresAt ?? Date.now() + 3600000,
                        result.projectId
                    )
                } else {
                    setError(result.error || 'OAuth 授权失败')
                    setOauthInProgress(false)
                }
            } else {
                setError('OAuth 授权仅在 Android 平台支持')
                setOauthInProgress(false)
            }
        } catch (err: any) {
            setError(err?.message || 'OAuth 授权失败')
            setOauthInProgress(false)
        }
    }, [selectedProvider, oauthEmail, oauthClientId, oauthClientSecret, gatewayClient])

    // Exchange pasted redirect URL for tokens
    const handleOAuthExchange = useCallback(async () => {
        if (!oauthRedirectUrl.trim()) {
            setError('请粘贴授权回调地址')
            return
        }
        if (!gatewayClient) return
        setVerifying(true)
        setError('')
        setStep('verify')
        try {
            const creds = await gatewayClient.antigravityExchange(oauthSessionId, oauthRedirectUrl.trim())
            await handleSaveOAuth(creds.access, creds.refresh, creds.expires, creds.projectId)
        } catch (err: any) {
            setError(err?.message || '授权失败')
            setStep('oauth-paste')
        } finally {
            setVerifying(false)
        }
    }, [oauthRedirectUrl, oauthSessionId, gatewayClient])

    // Verify API Key before saving
    const verifyApiKey = useCallback(async (provider: ProviderInfo, key: string): Promise<boolean> => {
        try {
            let testUrl = ''
            let headers: Record<string, string> = {}

            switch (provider.id) {
                case 'openai':
                    testUrl = 'https://api.openai.com/v1/models'
                    headers = { 'Authorization': `Bearer ${key}` }
                    break
                case 'anthropic':
                    return true  // Skip WebView verification (CORS blocks proxy); Gateway validates on first use
                case 'openrouter':
                    testUrl = 'https://openrouter.ai/api/v1/models'
                    headers = { 'Authorization': `Bearer ${key}` }
                    break
                default:
                    return true  // Skip verification for unknown providers
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000)

            try {
                const response = await fetch(testUrl, {
                    method: 'GET',
                    headers,
                    signal: controller.signal,
                })
                return response.ok
            } finally {
                clearTimeout(timeoutId)
            }
        } catch (err) {
            console.error('[verifyApiKey] Error:', err)
            return false
        }
    }, [])

    // Save OAuth credentials
    const handleSaveOAuth = useCallback(async (
        accessToken: string,
        refreshToken: string,
        expiresAt: number,
        projectId?: string,
    ) => {
        if (!selectedProvider) return

        setVerifying(true)
        setError('')

        try {
            const profileId = `${selectedProvider.id}:${oauthEmail.trim()}`
            const authPatch = {
                profileId,
                credential: {
                    type: 'oauth',
                    provider: selectedProvider.id,
                    access: accessToken,
                    refresh: refreshToken,
                    expires: expiresAt,
                    email: oauthEmail.trim(),
                    ...(oauthClientId.trim() && { clientId: oauthClientId.trim() }),
                    ...(projectId && { projectId }),
                },
            }

            await writeConfigFiles(
                { providerId: selectedProvider.id, config: { api: selectedProvider.api } },
                authPatch,
            )
            useModelConfigStore.getState().addUserProvider(selectedProvider.id)

            setSuccess(true)
            setTimeout(() => {
                onComplete()
            }, 1200)
        } catch (err: any) {
            setError(err?.message || '配置保存失败')
            setStep('oauth')
        } finally {
            setVerifying(false)
        }
    }, [selectedProvider, oauthEmail, onComplete])

    // Save (for both API key and Ollama providers)
    const handleSave = useCallback(async () => {
        if (!selectedProvider) return
        const provider = selectedProvider

        // Validate
        if (provider.authType === 'api_key' && !apiKey.trim()) {
            setError('请输入 API Key')
            return
        }
        if (provider.authType === 'base_url' && !baseUrl.trim()) {
            setError('请输入服务地址')
            return
        }

        // For Ollama: check that at least one model is selected
        if (provider.id === 'ollama') {
            const selectedModels = ollamaModels.filter(m => m.selected)
            if (selectedModels.length === 0) {
                setError('请至少选择一个模型')
                return
            }
        }

        setVerifying(true)
        setError('')
        setStep('verify')

        try {
            // Verify API Key before saving
            if (provider.authType === 'api_key') {
                const isValid = await verifyApiKey(provider, apiKey.trim())
                if (!isValid) {
                    setError('API Key 验证失败 — 请检查密钥是否正确')
                    setStep('auth')
                    setVerifying(false)
                    return
                }
            }

            const selectedModels = ollamaModels.filter(m => m.selected)
            const configPatch = buildConfigPatch(provider, apiKey.trim(), baseUrl.trim(), selectedModels)
            const authPatch = buildAuthPatch(provider, apiKey.trim())
            const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase()
            const isProxy = Boolean(baseUrl.trim()) && norm(baseUrl.trim()) !== norm(provider.defaultBaseUrl ?? '')
            const modelIds = selectedModels.length > 0
                ? selectedModels.map(m => m.id)
                : isProxy
                    ? []
                    : (PROVIDER_DEFAULT_MODELS[provider.id] ?? []).map(m => m.id)

            await writeConfigFiles(configPatch, authPatch, modelIds)
            useModelConfigStore.getState().addUserProvider(provider.id)

            setSuccess(true)
            setTimeout(() => {
                onComplete()
            }, 1200)
        } catch (err: any) {
            setError(err?.message || '配置保存失败')
            setStep(provider.id === 'ollama' ? 'ollama-models' : 'auth')
        } finally {
            setVerifying(false)
        }
    }, [selectedProvider, apiKey, baseUrl, ollamaModels, onComplete, verifyApiKey])

    // Back navigation
    const handleBack = useCallback(() => {
        setError('')
        switch (step) {
            case 'pick': onCancel(); break
            case 'auth': setStep('pick'); break
            case 'oauth-creds': setStep('pick'); break
            case 'oauth': setStep('oauth-creds'); break
            case 'oauth-paste': setStep('oauth'); break
            case 'ollama-connect': setStep('auth'); break
            case 'ollama-models': setStep('auth'); break
            case 'verify':
                if (selectedProvider?.authType === 'oauth') setStep('oauth')
                else if (selectedProvider?.id === 'ollama') setStep('ollama-models')
                else setStep('auth')
                break
        }
    }, [step, onCancel, selectedProvider])

    const stepTitle = (): string => {
        switch (step) {
            case 'pick': return '添加模型服务'
            case 'auth': return selectedProvider?.label ?? '配置'
            case 'oauth-creds': return 'OAuth 应用配置'
            case 'oauth': return 'OAuth 授权'
            case 'oauth-paste': return '粘贴回调地址'
            case 'ollama-connect': return '连接 Ollama'
            case 'ollama-models': return '选择模型'
            case 'verify': return '验证中'
        }
    }

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 910,
            background: 'linear-gradient(180deg, #1a1d2e 0%, #12141f 100%)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '16px 16px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
            }}>
                <div onClick={handleBack} style={backBtn}>
                    <ArrowLeft size={18} />
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 600, color: '#fff', margin: 0 }}>
                    {stepTitle()}
                </h2>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', WebkitOverflowScrolling: 'touch' }}>

                {/* ── Step 1: Provider list ── */}
                {step === 'pick' && (
                    <div>
                        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px' }}>
                            选择一个模型提供商来开始配置
                        </p>
                        {KNOWN_PROVIDERS.map((p) => {
                            const icon = providerIcons[p.id]
                            const authBadge = p.authType === 'oauth'
                                ? { label: 'OAuth', color: '#a855f7' }
                                : p.authType === 'base_url'
                                    ? { label: '本地', color: '#22d3ee' }
                                    : { label: 'API Key', color: '#34d399' }
                            return (
                                <div
                                    key={p.id}
                                    onClick={() => handlePickProvider(p)}
                                    style={providerRow}
                                >
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 12,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: icon?.color ?? 'rgba(255,255,255,0.08)',
                                        fontSize: icon?.letter?.length === 1 ? 18 : 20,
                                        fontWeight: 700, color: '#fff',
                                        flexShrink: 0,
                                    }}>
                                        {icon?.letter ?? p.label[0]}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 15, fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {p.label}
                                            <span style={{
                                                fontSize: 10, padding: '1px 6px', borderRadius: 6,
                                                background: `${authBadge.color}18`,
                                                color: authBadge.color, fontWeight: 500,
                                            }}>
                                                {authBadge.label}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                                            {p.description}
                                        </div>
                                    </div>
                                    <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* ── Step 2: Auth input ── */}
                {step === 'auth' && selectedProvider && (
                    <div>
                        {/* Security note */}
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '12px 14px', borderRadius: 12,
                            background: 'rgba(34,211,238,0.06)',
                            border: '1px solid rgba(34,211,238,0.12)',
                            marginBottom: 20,
                        }}>
                            <Shield size={16} style={{ color: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                                认证信息仅保存在本设备上, 不会上传到任何服务器
                            </span>
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                                background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
                            }}>
                                <AlertTriangle size={14} />
                                {error}
                            </div>
                        )}

                        {/* API Key input */}
                        {selectedProvider.authType === 'api_key' && (
                            <div style={{ marginBottom: 20 }}>
                                <label style={labelStyle}>
                                    <Key size={14} style={{ marginRight: 6 }} />
                                    API Key
                                </label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={selectedProvider.keyPlaceholder ?? 'sk-...'}
                                    autoComplete="off"
                                    style={inputStyle}
                                    autoFocus
                                />
                                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>
                                    从 {selectedProvider.label} 开发者控制台获取
                                </p>
                            </div>
                        )}

                        {/* Base URL input for API key providers with defaultBaseUrl */}
                        {selectedProvider.authType === 'api_key' && selectedProvider.defaultBaseUrl && (
                            <div style={{ marginBottom: 20 }}>
                                <label style={labelStyle}>
                                    <Link size={14} style={{ marginRight: 6 }} />
                                    API 地址
                                </label>
                                <input
                                    type="url"
                                    value={baseUrl}
                                    onChange={(e) => setBaseUrl(e.target.value)}
                                    placeholder={selectedProvider.defaultBaseUrl}
                                    autoComplete="off"
                                    style={inputStyle}
                                />
                                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>
                                    可自定义代理地址，留空则使用默认: {selectedProvider.defaultBaseUrl}
                                </p>
                            </div>
                        )}

                        {/* Base URL input (Ollama / custom) */}
                        {selectedProvider.authType === 'base_url' && (
                            <div style={{ marginBottom: 20 }}>
                                <label style={labelStyle}>
                                    <Link size={14} style={{ marginRight: 6 }} />
                                    服务地址
                                </label>
                                <input
                                    type="url"
                                    value={baseUrl}
                                    onChange={(e) => setBaseUrl(e.target.value)}
                                    placeholder="http://10.0.2.2:11434/v1"
                                    autoComplete="off"
                                    style={inputStyle}
                                    autoFocus
                                />
                                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>
                                    {selectedProvider.id === 'ollama'
                                        ? '模拟器: 10.0.2.2 / 实机: 电脑局域网 IP (需同一网络)'
                                        : '输入 OpenAI 兼容的 API 地址'
                                    }
                                </p>
                            </div>
                        )}

                        {/* Save / Connect button */}
                        {selectedProvider.authType === 'api_key' ? (
                            <div
                                onClick={handleSave}
                                style={{
                                    ...primaryBtn,
                                    opacity: apiKey.trim().length > 0 ? 1 : 0.4,
                                    pointerEvents: apiKey.trim().length > 0 ? 'auto' : 'none',
                                }}
                            >
                                验证并保存
                            </div>
                        ) : (
                            <div
                                onClick={ollamaConnecting ? undefined : handleOllamaConnect}
                                style={{
                                    ...primaryBtn,
                                    opacity: baseUrl.trim().length > 0 && !ollamaConnecting ? 1 : 0.4,
                                    pointerEvents: baseUrl.trim().length > 0 && !ollamaConnecting ? 'auto' : 'none',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                }}
                            >
                                {ollamaConnecting ? (
                                    <>
                                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                        正在连接...
                                    </>
                                ) : (
                                    <>
                                        <Server size={16} />
                                        连接并获取模型列表
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Step: OAuth app credentials ── */}
                {step === 'oauth-creds' && selectedProvider && (
                    <div>
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '12px 14px', borderRadius: 12,
                            background: 'rgba(168,85,247,0.06)',
                            border: '1px solid rgba(168,85,247,0.12)',
                            marginBottom: 20,
                        }}>
                            <Shield size={16} style={{ color: '#a855f7', flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>需要您自己的 OAuth 应用</div>
                                <div>请在 {selectedProvider.label} 开发者控制台创建 OAuth 2.0 客户端，将 <code style={{ color: '#a855f7' }}>clawos://oauth-callback</code> 添加为授权重定向 URI，然后填入凭据。</div>
                                {selectedProvider.oauthSetupGuide && (
                                    <div style={{ marginTop: 6 }}>
                                        <span style={{ color: '#7c3aed' }}>→ </span>
                                        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{selectedProvider.oauthSetupGuide}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                                background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
                            }}>
                                <AlertTriangle size={14} />{error}
                            </div>
                        )}

                        <div style={{ marginBottom: 16 }}>
                            <label style={labelStyle}>Client ID</label>
                            <input
                                value={oauthClientId}
                                onChange={e => setOauthClientId(e.target.value)}
                                placeholder="xxxxxxxx.apps.googleusercontent.com"
                                style={inputStyle}
                                autoFocus
                            />
                        </div>
                        <div style={{ marginBottom: 24 }}>
                            <label style={labelStyle}>Client Secret</label>
                            <input
                                type="password"
                                value={oauthClientSecret}
                                onChange={e => setOauthClientSecret(e.target.value)}
                                placeholder="GOCSPX-..."
                                style={inputStyle}
                            />
                        </div>

                        <div
                            onClick={() => {
                                if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
                                    setError('请填写 Client ID 和 Client Secret')
                                    return
                                }
                                setError('')
                                setStep('oauth')
                            }}
                            style={{
                                ...primaryBtn,
                                opacity: oauthClientId.trim() && oauthClientSecret.trim() ? 1 : 0.4,
                                pointerEvents: oauthClientId.trim() && oauthClientSecret.trim() ? 'auto' : 'none',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}
                        >
                            <ChevronRight size={16} />
                            下一步：授权
                        </div>
                    </div>
                )}

                {/* ── Step 2b: OAuth flow ── */}
                {step === 'oauth' && selectedProvider && (
                    <div>
                        {/* OAuth explanation */}
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '12px 14px', borderRadius: 12,
                            background: 'rgba(168,85,247,0.06)',
                            border: '1px solid rgba(168,85,247,0.12)',
                            marginBottom: 20,
                        }}>
                            <Shield size={16} style={{ color: '#a855f7', flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>OAuth 安全授权</div>
                                <div>使用 Google 账号登录，无需 API Key。授权后可使用 Gemini 全系列模型。</div>
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                                background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
                            }}>
                                <AlertTriangle size={14} />
                                {error}
                            </div>
                        )}

                        {/* Email input */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>
                                <Key size={14} style={{ marginRight: 6 }} />
                                Google 账号
                            </label>
                            <input
                                type="email"
                                value={oauthEmail}
                                onChange={(e) => setOauthEmail(e.target.value)}
                                placeholder="your.email@gmail.com"
                                autoComplete="email"
                                style={inputStyle}
                                autoFocus
                            />
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>
                                用于标识此授权配置
                            </p>
                        </div>

                        {/* Start OAuth button */}
                        <div
                            onClick={oauthInProgress ? undefined : handleOAuthStart}
                            style={{
                                ...primaryBtn,
                                opacity: oauthEmail.trim().length > 0 && !oauthInProgress ? 1 : 0.4,
                                pointerEvents: oauthEmail.trim().length > 0 && !oauthInProgress ? 'auto' : 'none',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}
                        >
                            {oauthInProgress ? (
                                <>
                                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                    正在授权...
                                </>
                            ) : (
                                <>
                                    <Shield size={16} />
                                    开始 OAuth 授权
                                </>
                            )}
                        </div>

                        {/* OAuth flow steps */}
                        <div style={{ marginTop: 24, padding: '16px', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                                授权流程：
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {['打开 Google 登录页面', '选择账号并授权', '自动返回 ClawOS'].map((text, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{
                                            width: 24, height: 24, borderRadius: '50%',
                                            background: 'rgba(168,85,247,0.15)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 12, fontWeight: 600, color: '#a855f7',
                                        }}>
                                            {i + 1}
                                        </div>
                                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Step: OAuth paste redirect URL ── */}
                {step === 'oauth-paste' && (
                    <div>
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '12px 14px', borderRadius: 12,
                            background: 'rgba(168,85,247,0.06)',
                            border: '1px solid rgba(168,85,247,0.12)',
                            marginBottom: 20,
                        }}>
                            <Shield size={16} style={{ color: '#a855f7', flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>完成授权</div>
                                <div>在浏览器中完成 Google 授权后，将页面跳转到的完整地址（以 <code style={{ color: '#a855f7' }}>clawos://</code> 开头）粘贴到下方。</div>
                            </div>
                        </div>

                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                                background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
                            }}>
                                <AlertTriangle size={14} />{error}
                            </div>
                        )}

                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>
                                <Link size={14} style={{ marginRight: 6 }} />
                                回调地址
                            </label>
                            <input
                                value={oauthRedirectUrl}
                                onChange={e => setOauthRedirectUrl(e.target.value)}
                                placeholder="clawos://oauth-callback?code=..."
                                style={inputStyle}
                                autoFocus
                            />
                        </div>

                        <div
                            onClick={oauthRedirectUrl.trim() ? handleOAuthExchange : undefined}
                            style={{
                                ...primaryBtn,
                                opacity: oauthRedirectUrl.trim() ? 1 : 0.4,
                                pointerEvents: oauthRedirectUrl.trim() ? 'auto' : 'none',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}
                        >
                            <Check size={16} />
                            完成授权
                        </div>
                    </div>
                )}

                {/* ── Step 3 (Ollama): Model selection ── */}
                {step === 'ollama-models' && selectedProvider?.id === 'ollama' && (
                    <div>
                        {/* Connection info */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.15)',
                        }}>
                            <CheckCircle2 size={14} style={{ color: '#34d399' }} />
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                                已连接到 {baseUrl.replace(/\/v1\/?$/, '')}
                            </span>
                            <div
                                onClick={handleOllamaConnect}
                                style={{
                                    marginLeft: 'auto', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center',
                                }}
                            >
                                <RefreshCw size={12} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                                background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
                            }}>
                                <AlertTriangle size={14} />
                                {error}
                            </div>
                        )}

                        {/* Select all toggle */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            marginBottom: 12,
                        }}>
                            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                                发现 {ollamaModels.length} 个已下载模型
                            </span>
                            <div
                                onClick={selectAllOllama}
                                style={{
                                    fontSize: 12, color: '#22d3ee', cursor: 'pointer',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                {ollamaModels.every(m => m.selected) ? '取消全选' : '全选'}
                            </div>
                        </div>

                        {/* Model list */}
                        {ollamaModels.map((model) => (
                            <div
                                key={model.id}
                                onClick={() => toggleOllamaModel(model.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '12px 14px',
                                    borderRadius: 14,
                                    background: model.selected
                                        ? 'rgba(34,211,238,0.08)'
                                        : 'rgba(255,255,255,0.03)',
                                    border: `1px solid ${model.selected ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.06)'}`,
                                    marginBottom: 6,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                {/* Checkbox */}
                                <div style={{ flexShrink: 0 }}>
                                    {model.selected ? (
                                        <CheckCircle2 size={20} style={{ color: '#22d3ee' }} />
                                    ) : (
                                        <Circle size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
                                    )}
                                </div>

                                {/* Model icon */}
                                <div style={{
                                    width: 36, height: 36, borderRadius: 10,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: model.selected ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.05)',
                                    flexShrink: 0,
                                }}>
                                    {model.id.includes('deepseek') || model.id.includes('qwen')
                                        ? <Zap size={18} style={{ color: model.selected ? '#22d3ee' : 'rgba(255,255,255,0.4)' }} />
                                        : <Cpu size={18} style={{ color: model.selected ? '#22d3ee' : 'rgba(255,255,255,0.4)' }} />
                                    }
                                </div>

                                {/* Model info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: 14, fontWeight: 500,
                                        color: model.selected ? '#22d3ee' : '#fff',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {model.name || model.id}
                                    </div>
                                    {model.owned_by && (
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                                            {model.owned_by}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Save button */}
                        <div
                            onClick={handleSave}
                            style={{
                                ...primaryBtn,
                                marginTop: 16,
                                opacity: ollamaModels.some(m => m.selected) ? 1 : 0.4,
                                pointerEvents: ollamaModels.some(m => m.selected) ? 'auto' : 'none',
                            }}
                        >
                            保存 {ollamaModels.filter(m => m.selected).length} 个模型
                        </div>
                    </div>
                )}

                {/* ── Verify step ── */}
                {step === 'verify' && (
                    <div style={{ textAlign: 'center', paddingTop: 60 }}>
                        {verifying && (
                            <>
                                <Loader2 size={40} style={{ color: '#22d3ee', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)' }}>正在验证配置...</p>
                            </>
                        )}
                        {success && (
                            <>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%',
                                    background: 'rgba(34,197,94,0.15)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    margin: '0 auto 16px',
                                }}>
                                    <Check size={28} style={{ color: '#34d399' }} />
                                </div>
                                <p style={{ fontSize: 16, fontWeight: 500, color: '#34d399' }}>配置成功</p>
                                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                                    正在刷新模型列表...
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    )
}

// ── Styles ──────────────────────────────────────────────────────

const backBtn: CSSProperties = {
    width: 48, height: 48, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    flexShrink: 0,
}

const providerRow: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px', borderRadius: 14,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 8,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
}

const labelStyle: CSSProperties = {
    display: 'flex', alignItems: 'center',
    fontSize: 13, fontWeight: 500,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
}

const inputStyle: CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    fontSize: 15,
    fontFamily: 'monospace',
    outline: 'none',
    boxSizing: 'border-box',
    WebkitAppearance: 'none',
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
    WebkitTapHighlightColor: 'transparent',
}

// ── Config Helpers ──────────────────────────────────────────────

// Static baseUrls for known API key providers
const PROVIDER_BASE_URLS: Record<string, string> = {
    'openai': 'https://api.openai.com/v1',
    'openrouter': 'https://openrouter.ai/api/v1',
}

interface DefaultModel {
    id: string
    name: string
    reasoning?: boolean
    contextWindow?: number
    maxTokens?: number
}

const PROVIDER_DEFAULT_MODELS: Record<string, DefaultModel[]> = {
    anthropic: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 8192 },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', reasoning: true, contextWindow: 200000, maxTokens: 8192 },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000, maxTokens: 8192 },
    ],
    openai: [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 4096 },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000, maxTokens: 4096 },
        { id: 'o3-mini', name: 'o3-mini', reasoning: true, contextWindow: 200000, maxTokens: 65536 },
    ],
    moonshot: [
        { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', contextWindow: 131072, maxTokens: 8192 },
        { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', contextWindow: 32768, maxTokens: 8192 },
    ],
    deepseek: [
        { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 65536, maxTokens: 8192 },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', reasoning: true, contextWindow: 65536, maxTokens: 8192 },
    ],
}

/** Build an OpenClaw config patch to add/update a provider */
function buildConfigPatch(
    provider: ProviderInfo,
    key: string,
    url: string,
    ollamaModels: OllamaModelInfo[] = [],
) {
    const entry: Record<string, unknown> = { api: provider.api }

    if (provider.authType === 'api_key') {
        entry.apiKey = key
        const userUrl = url.trim()
        entry.baseUrl = userUrl || (PROVIDER_BASE_URLS[provider.id] ?? provider.defaultBaseUrl)
        const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase()
        const isProxy = Boolean(userUrl) && norm(userUrl) !== norm(provider.defaultBaseUrl ?? '')
        if (isProxy) {
            entry.models = []
        } else {
            const defaults = PROVIDER_DEFAULT_MODELS[provider.id]
            entry.models = defaults
                ? defaults.map(m => ({
                    id: m.id,
                    name: m.name,
                    reasoning: m.reasoning ?? false,
                    input: ['text'],
                    contextWindow: m.contextWindow ?? 128000,
                    maxTokens: m.maxTokens ?? 8192,
                }))
                : []
        }
    } else if (provider.authType === 'base_url') {
        let normalizedUrl = url.replace(/\/+$/, '')
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
            normalizedUrl = `http://${normalizedUrl}`
        }
        if (!normalizedUrl.endsWith('/v1')) {
            normalizedUrl = `${normalizedUrl}/v1`
        }
        entry.baseUrl = normalizedUrl
        entry.apiKey = 'ollama-local'
        if (ollamaModels.length > 0) {
            entry.models = ollamaModels.map(m => ({
                id: m.id,
                name: m.name || m.id,
                reasoning: false,
                input: ['text'],
                contextWindow: 32768,
                maxTokens: 8192,
            }))
        }
    }

    return { providerId: provider.id, config: entry }
}

/** Build an auth-profiles patch */
function buildAuthPatch(provider: ProviderInfo, key: string) {
    if (provider.authType !== 'api_key' || !key) return null
    return {
        profileId: `${provider.id}:manual`,
        credential: {
            type: 'api_key' as const,
            provider: provider.id,
            key,
        },
    }
}

/** Write config and auth to OpenClaw's config files on the device */
async function writeConfigFiles(
    configPatch: { providerId: string; config: Record<string, unknown> },
    authPatch: { profileId: string; credential: Record<string, unknown> } | null,
    modelIds: string[] = [],
) {
    const configPath = '/data/local/tmp/clawos/openclaw.json'
    const authPath = '/data/local/tmp/clawos/state/agents/main/agent/auth-profiles.json'

    if (isAndroid && ClawOSBridge) {
        await ClawOSBridge.patchJsonFile({
            path: configPath,
            jsonPath: `models.providers.${configPatch.providerId}`,
            value: JSON.stringify(configPatch.config),
        })

        // Add models to the agents.defaults.models allow list.
        // Uses a dedicated method because model IDs may contain dots
        // (e.g., "qwen2.5:7b") which break dot-separated path navigation.
        if (modelIds.length > 0) {
            const fullIds = modelIds.map(id => `${configPatch.providerId}/${id}`)
            await ClawOSBridge.addModelsToAllowList({
                path: configPath,
                modelIds: fullIds,
            })
        }

        if (authPatch) {
            await ClawOSBridge.patchJsonFile({
                path: authPath,
                jsonPath: `profiles.${authPatch.profileId}`,
                value: JSON.stringify(authPatch.credential),
            })
        }
    } else {
        console.log('[AddProviderWizard] Config patch:', configPatch)
        console.log('[AddProviderWizard] Auth patch:', authPatch)
        console.log('[AddProviderWizard] Model IDs:', modelIds)
    }
}
