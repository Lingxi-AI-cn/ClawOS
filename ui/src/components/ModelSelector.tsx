// ModelSelector — bottom-sheet with two-level navigation:
//   Level 1: Provider list (select a provider)
//   Level 2: Model list (select a model within that provider)
//
// Flow: tap ModelSwitcher → providers list → pick provider → models list → pick model

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
    X, Plus, Check, Cpu, Brain, Loader2, ChevronRight, ChevronLeft,
    Server, Cloud, Zap, Globe, Sparkles, Bot
} from 'lucide-react'
import { useModelConfigStore, type AvailableModel } from '../store/modelConfig.ts'

interface ModelSelectorProps {
    onSelectModel: (modelRef: string) => Promise<{ resolvedProvider?: string; resolvedModel?: string }>
    onAddProvider: (providerId?: string) => void
}

// ── Provider metadata ───────────────────────────────────────────

interface ProviderMeta {
    label: string
    description: string
    icon: typeof Cloud
    color: string
    bgColor: string
}

const PROVIDER_META: Record<string, ProviderMeta> = {
    'anthropic': {
        label: 'Anthropic',
        description: 'Claude Sonnet / Opus',
        icon: Brain,
        color: '#d97757',
        bgColor: 'rgba(217,119,87,0.12)',
    },
    'openai': {
        label: 'OpenAI',
        description: 'GPT-4o / o1 / o3',
        icon: Bot,
        color: '#10a37f',
        bgColor: 'rgba(16,163,127,0.12)',
    },
    'amazon-bedrock': {
        label: 'Amazon Bedrock',
        description: 'AWS 模型托管平台',
        icon: Cloud,
        color: '#ff9900',
        bgColor: 'rgba(255,153,0,0.12)',
    },
    'openrouter': {
        label: 'OpenRouter',
        description: '聚合平台 — 一个 Key 用所有模型',
        icon: Globe,
        color: '#8b5cf6',
        bgColor: 'rgba(139,92,246,0.12)',
    },
    'moonshot': {
        label: 'Moonshot (Kimi)',
        description: 'Kimi K2 / K1.5',
        icon: Zap,
        color: '#7c3aed',
        bgColor: 'rgba(124,58,237,0.12)',
    },
    'deepseek': {
        label: 'DeepSeek',
        description: 'DeepSeek-V3 / R1',
        icon: Brain,
        color: '#2563eb',
        bgColor: 'rgba(37,99,235,0.12)',
    },
    'ollama': {
        label: 'Ollama (本地)',
        description: '本地运行开源模型',
        icon: Server,
        color: '#22d3ee',
        bgColor: 'rgba(34,211,238,0.12)',
    },
}

function getProviderMeta(id: string): ProviderMeta {
    return PROVIDER_META[id] ?? {
        label: id,
        description: '',
        icon: Cloud,
        color: '#94a3b8',
        bgColor: 'rgba(148,163,184,0.12)',
    }
}

// ── Component ───────────────────────────────────────────────────

export default function ModelSelector({ onSelectModel, onAddProvider }: ModelSelectorProps) {
    const isOpen = useModelConfigStore((s) => s.isSelectorOpen)
    const availableModels = useModelConfigStore((s) => s.availableModels)
    const activeModelRef = useModelConfigStore((s) => s.activeModelRef)
    const closeSelector = useModelConfigStore((s) => s.closeSelector)
    const setActiveModel = useModelConfigStore((s) => s.setActiveModel)

    // Two-level navigation state
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
    const [switching, setSwitching] = useState<string | null>(null)
    const [error, setError] = useState('')

    // Animate entrance
    const [visible, setVisible] = useState(false)
    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => setVisible(true))
        } else {
            setVisible(false)
            // Reset to provider list when closing
            setTimeout(() => setSelectedProvider(null), 300)
        }
    }, [isOpen])

    const userProviderIds = useModelConfigStore((s) => s.userProviderIds)

    // Group models by provider, filtered to user-configured providers only
    const groups = new Map<string, AvailableModel[]>()
    for (const m of availableModels) {
        if (userProviderIds.length > 0 && !userProviderIds.includes(m.provider)) continue
        const list = groups.get(m.provider) ?? []
        list.push(m)
        groups.set(m.provider, list)
    }

    // Ensure all user-configured providers appear even if they have 0 models yet
    for (const pid of userProviderIds) {
        if (!groups.has(pid)) groups.set(pid, [])
    }

    const providerIds = Array.from(groups.keys())
    const hasProviders = providerIds.length > 0
    const gatewayLoading = userProviderIds.length > 0 && availableModels.length === 0

    // Count active models per provider
    const activeProvider = activeModelRef?.split('/')[0] ?? null

    const handleSelectModel = useCallback(async (model: AvailableModel) => {
        const ref = `${model.provider}/${model.id}`
        if (ref === activeModelRef) {
            closeSelector()
            return
        }
        setSwitching(ref)
        setError('')
        try {
            await onSelectModel(ref)
            setActiveModel(ref, model.name)
            closeSelector()
        } catch (err: any) {
            setError(err?.message || '切换失败')
            setTimeout(() => setError(''), 3000)
        } finally {
            setSwitching(null)
        }
    }, [activeModelRef, onSelectModel, setActiveModel, closeSelector])

    const handleBackdropClick = useCallback(() => {
        if (selectedProvider) {
            setSelectedProvider(null)
        } else {
            closeSelector()
        }
    }, [closeSelector, selectedProvider])

    const handleBack = useCallback(() => {
        setSelectedProvider(null)
        setError('')
    }, [])

    if (!isOpen) return null

    const currentModels = selectedProvider ? (groups.get(selectedProvider) ?? []) : []
    const currentMeta = selectedProvider ? getProviderMeta(selectedProvider) : null

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={handleBackdropClick}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 900,
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                    opacity: visible ? 1 : 0,
                    transition: 'opacity 0.25s ease',
                }}
            />

            {/* Sheet */}
            <div
                style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: 901,
                    maxHeight: '75vh',
                    borderRadius: '20px 20px 0 0',
                    background: 'linear-gradient(180deg, #1a1d2e 0%, #12141f 100%)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderBottom: 'none',
                    transform: visible ? 'translateY(0)' : 'translateY(100%)',
                    transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Handle bar + header */}
                <div style={{ padding: '12px 20px 8px', flexShrink: 0 }}>
                    {/* Drag handle */}
                    <div style={{
                        width: 36, height: 4, borderRadius: 2,
                        background: 'rgba(255,255,255,0.2)',
                        margin: '0 auto 12px',
                    }} />

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {/* Back button (level 2 only) */}
                            {selectedProvider && (
                                <div onClick={handleBack} style={{ ...iconBtn, marginRight: 4 }}>
                                    <ChevronLeft size={18} />
                                </div>
                            )}
                            <h2 style={{
                                fontSize: 18, fontWeight: 600, color: '#fff',
                                margin: 0, display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                {selectedProvider ? (
                                    <>
                                        {currentMeta && (() => {
                                            const Icon = currentMeta.icon
                                            return <Icon size={20} style={{ color: currentMeta.color }} />
                                        })()}
                                        {currentMeta?.label ?? selectedProvider}
                                    </>
                                ) : (
                                    <>
                                        <Brain size={20} style={{ color: '#22d3ee' }} />
                                        模型选择
                                    </>
                                )}
                            </h2>
                        </div>
                        <div onClick={closeSelector} style={iconBtn}>
                            <X size={18} />
                        </div>
                    </div>

                    {/* Subtitle for level 2 */}
                    {selectedProvider && currentMeta?.description && (
                        <div style={{
                            fontSize: 12, color: 'rgba(255,255,255,0.35)',
                            marginTop: 4, paddingLeft: selectedProvider ? 44 : 0,
                        }}>
                            {currentModels.length} 个可用模型
                        </div>
                    )}
                </div>

                {/* Scrollable content */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '4px 16px 24px',
                    WebkitOverflowScrolling: 'touch',
                }}>

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '8px 12px', borderRadius: 10, margin: '0 0 12px',
                            background: 'rgba(239,68,68,0.15)', color: '#f87171',
                            fontSize: 13,
                        }}>
                            {error}
                        </div>
                    )}

                    {/* ===== LEVEL 1: Provider list ===== */}
                    {!selectedProvider && (
                        <>
                            {/* Gateway restarting */}
                            {gatewayLoading && (
                                <div style={{
                                    textAlign: 'center', padding: '24px 16px 16px',
                                    color: 'rgba(255,255,255,0.5)', fontSize: 13,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                }}>
                                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: '#22d3ee' }} />
                                    网关重启中，正在加载模型列表...
                                </div>
                            )}

                            {/* Empty state — no providers configured at all */}
                            {!hasProviders && !gatewayLoading && (
                                <div style={{
                                    textAlign: 'center', padding: '32px 16px',
                                    color: 'rgba(255,255,255,0.4)', fontSize: 14,
                                }}>
                                    <Cpu size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    <p style={{ margin: '0 0 4px' }}>尚未配置任何模型</p>
                                    <p style={{ fontSize: 12, margin: 0 }}>添加一个模型服务开始对话</p>
                                </div>
                            )}

                            {/* Provider cards */}
                            {providerIds.map((providerId) => {
                                const meta = getProviderMeta(providerId)
                                const models = groups.get(providerId) ?? []
                                const isActive = providerId === activeProvider
                                const Icon = meta.icon
                                const modelCount = models.length
                                // Find the active model name in this provider
                                const activeInProvider = models.find(m => `${m.provider}/${m.id}` === activeModelRef)

                                return (
                                    <div
                                        key={providerId}
                                        onClick={() => setSelectedProvider(providerId)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 14,
                                            padding: '14px 16px',
                                            borderRadius: 14,
                                            background: isActive
                                                ? `linear-gradient(135deg, ${meta.bgColor}, rgba(255,255,255,0.02))`
                                                : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${isActive ? `${meta.color}40` : 'rgba(255,255,255,0.06)'}`,
                                            marginBottom: 8,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}
                                    >
                                        {/* Provider icon badge */}
                                        <div style={{
                                            width: 44, height: 44, borderRadius: 12,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: meta.bgColor,
                                            flexShrink: 0,
                                        }}>
                                            <Icon size={22} style={{ color: meta.color }} />
                                        </div>

                                        {/* Provider info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: 15, fontWeight: 600,
                                                color: isActive ? meta.color : '#fff',
                                                display: 'flex', alignItems: 'center', gap: 6,
                                            }}>
                                                {meta.label}
                                                {isActive && (
                                                    <span style={{
                                                        fontSize: 10, padding: '1px 6px',
                                                        borderRadius: 6,
                                                        background: `${meta.color}20`,
                                                        color: meta.color,
                                                        fontWeight: 500,
                                                    }}>
                                                        使用中
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: 12, color: 'rgba(255,255,255,0.35)',
                                                marginTop: 2,
                                            }}>
                                                {activeInProvider
                                                    ? `当前: ${activeInProvider.name || activeInProvider.id}`
                                                    : meta.description
                                                }
                                            </div>
                                            <div style={{
                                                fontSize: 11, color: 'rgba(255,255,255,0.25)',
                                                marginTop: 2, display: 'flex', alignItems: 'center', gap: 4,
                                            }}>
                                                {modelCount > 0
                                                    ? `${modelCount} 个模型`
                                                    : <>
                                                        <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                                                        模型加载中...
                                                      </>
                                                }
                                            </div>
                                        </div>

                                        {/* Chevron */}
                                        <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                                    </div>
                                )
                            })}


                            {/* Add provider button */}
                            <div
                                onClick={() => onAddProvider()}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    gap: 8, padding: '14px 16px',
                                    borderRadius: 14,
                                    border: '1px dashed rgba(34,211,238,0.25)',
                                    background: 'rgba(34,211,238,0.03)',
                                    color: '#22d3ee',
                                    fontSize: 14, fontWeight: 500,
                                    cursor: 'pointer',
                                    marginTop: 4,
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                <Plus size={18} />
                                添加模型服务
                            </div>
                        </>
                    )}

                    {/* ===== LEVEL 2: Model list (within a specific provider) ===== */}
                    {selectedProvider && (
                        <>
                            {currentModels.map((model) => {
                                const ref = `${model.provider}/${model.id}`
                                const isActive = ref === activeModelRef
                                const isSwitching = ref === switching
                                return (
                                    <div
                                        key={ref}
                                        onClick={() => !isSwitching && handleSelectModel(model)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '12px 14px',
                                            borderRadius: 14,
                                            background: isActive
                                                ? `${currentMeta?.bgColor ?? 'rgba(34,211,238,0.1)'}`
                                                : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${isActive ? `${currentMeta?.color ?? '#22d3ee'}40` : 'rgba(255,255,255,0.06)'}`,
                                            marginBottom: 6,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                            WebkitTapHighlightColor: 'transparent',
                                            opacity: isSwitching ? 0.6 : 1,
                                        }}
                                    >
                                        {/* Model icon */}
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 10,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: isActive
                                                ? `${currentMeta?.color ?? '#22d3ee'}20`
                                                : 'rgba(255,255,255,0.05)',
                                            flexShrink: 0,
                                        }}>
                                            {model.reasoning
                                                ? <Zap size={18} style={{ color: isActive ? (currentMeta?.color ?? '#22d3ee') : 'rgba(255,255,255,0.4)' }} />
                                                : <Cpu size={18} style={{ color: isActive ? (currentMeta?.color ?? '#22d3ee') : 'rgba(255,255,255,0.4)' }} />
                                            }
                                        </div>

                                        {/* Model info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: 14, fontWeight: 500,
                                                color: isActive ? (currentMeta?.color ?? '#22d3ee') : '#fff',
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>
                                                {model.name || model.id}
                                            </div>
                                            <div style={{
                                                fontSize: 11, color: 'rgba(255,255,255,0.3)',
                                                marginTop: 2,
                                            }}>
                                                {model.contextWindow ? formatContextWindow(model.contextWindow) + ' context' : ''}
                                                {model.contextWindow && model.reasoning ? ' · ' : ''}
                                                {model.reasoning ? 'reasoning' : ''}
                                            </div>
                                        </div>

                                        {/* Status indicator */}
                                        <div style={{ flexShrink: 0 }}>
                                            {isSwitching ? (
                                                <Loader2 size={18} style={{ color: currentMeta?.color ?? '#22d3ee', animation: 'spin 1s linear infinite' }} />
                                            ) : isActive ? (
                                                <Check size={18} style={{ color: currentMeta?.color ?? '#22d3ee' }} />
                                            ) : (
                                                <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.2)' }} />
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </>
                    )}
                </div>
            </div>

            {/* Spin animation */}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </>
    )
}

// ── Helpers ─────────────────────────────────────────────────────

const iconBtn: CSSProperties = {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
}

function formatContextWindow(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
    return String(tokens)
}
