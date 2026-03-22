import { useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react'
import { motion } from 'motion/react'
import AIBrain from './components/AIBrain.tsx'
import FunctionOrbit from './components/FunctionOrbit.tsx'
import HUD from './components/HUD.tsx'
import ChatPanel from './components/ChatPanel.tsx'
import DataVault from './components/DataVault.tsx'
import ModelSelector from './components/ModelSelector.tsx'
import AddProviderWizard from './components/AddProviderWizard.tsx'
import IMSetupWizard from './components/IMSetupWizard.tsx'
import IMChannelList from './components/IMChannelList.tsx'
import SkillMarketplace from './components/SkillMarketplace.tsx'
import GatewayUpdate from './components/GatewayUpdate.tsx'
import { GatewayClient } from './gateway/client.ts'
import { getGatewayConfig, getGatewayConfigAsync } from './gateway/config.ts'
import { ClawOSBridge, isAndroid } from './gateway/bridge.ts'
import { useConnectionStore } from './store/connection.ts'
import { useChatStore } from './store/chat.ts'
import { useSceneStore } from './store/scene.ts'
import { useFilesStore } from './store/files.ts'
import { useModelConfigStore, type AvailableModel } from './store/modelConfig.ts'
import { useIMChannelStore } from './store/imChannels.ts'
import { useAppsStore } from './store/apps.ts'
import { useGatewayUpdateStore } from './store/gatewayUpdate.ts'
import type { ChatEventPayload, AgentEventPayload } from './gateway/protocol.ts'

const AppDrawer = lazy(() => import('./components/AppDrawer.tsx'))

/** Check if viewport is mobile-sized */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return isMobile
}

/**
 * Track visible viewport height, accounting for the soft keyboard.
 *
 * On Android in fullscreen/immersive mode, CSS `100vh` and the
 * VisualViewport API both ignore the keyboard. The native
 * MainActivity detects the keyboard via ViewTreeObserver and
 * dispatches a 'keyboardchange' CustomEvent with the keyboard
 * height in CSS pixels (dp). We subtract that from innerHeight.
 *
 * On non-Android platforms, falls back to the VisualViewport API
 * (works when the browser is NOT in fullscreen).
 */
function useViewportHeight() {
  const [height, setHeight] = useState(
    () => window.visualViewport?.height ?? window.innerHeight
  )

  useEffect(() => {
    // Primary: native Android keyboard event (works in immersive mode)
    const onKeyboard = (e: Event) => {
      const kbHeight = (e as CustomEvent).detail?.height ?? 0
      setHeight(kbHeight > 0 ? window.innerHeight - kbHeight : window.innerHeight)
    }
    window.addEventListener('keyboardchange', onKeyboard)

    // Fallback: VisualViewport API (desktop / non-fullscreen)
    const vv = window.visualViewport
    const onVVResize = () => {
      // Skip if native keyboard event is active
      if ((window as any).__KEYBOARD_HEIGHT__ > 0) return
      setHeight(vv!.height)
    }
    if (vv) {
      vv.addEventListener('resize', onVVResize)
    }

    // Also track window resize (orientation changes, etc.)
    const onWindowResize = () => {
      if ((window as any).__KEYBOARD_HEIGHT__ > 0) return
      setHeight(window.visualViewport?.height ?? window.innerHeight)
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('keyboardchange', onKeyboard)
      window.removeEventListener('resize', onWindowResize)
      if (vv) vv.removeEventListener('resize', onVVResize)
    }
  }, [])

  return height
}

/** Fetch available models from Gateway and update model config store.
 *  Retries with back-off when the list is empty (gateway may still be
 *  discovering models from remote providers after a restart). */
async function fetchModels(client: GatewayClient, retries = 4, delayMs = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.listModels()
      const models = (res as Record<string, unknown>).models as AvailableModel[] | undefined
      if (models && Array.isArray(models) && models.length > 0) {
        useModelConfigStore.getState().setAvailableModels(models)
        console.log(`[App] Loaded ${models.length} model(s) from Gateway`)
        return
      }
      if (attempt < retries) {
        const wait = delayMs * Math.pow(1.5, attempt)
        console.log(`[App] No models yet, retrying in ${Math.round(wait)}ms (${attempt + 1}/${retries})`)
        await new Promise(r => setTimeout(r, wait))
      } else {
        useModelConfigStore.getState().setAvailableModels(models ?? [])
        console.log('[App] No models available from Gateway after retries')
      }
    } catch (err) {
      if (attempt < retries) {
        const wait = delayMs * Math.pow(1.5, attempt)
        console.log(`[App] fetchModels error, retrying in ${Math.round(wait)}ms:`, err)
        await new Promise(r => setTimeout(r, wait))
      } else {
        console.warn('[App] Failed to fetch models after retries:', err)
        useModelConfigStore.getState().setAvailableModels([])
      }
    }
  }
}
export default function App({ onReady }: { onReady?: () => void }) {
  const clientRef = useRef<GatewayClient | null>(null)
  const suppressedRunIds = useRef<Set<string>>(new Set())
  const isMobile = useIsMobile()
  const viewportHeight = useViewportHeight()

  // Ensure page is scrolled to top on mount (prevents focus-induced scroll)
  useEffect(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    onReady?.()
  }, [])


  // Initialize gateway client
  useEffect(() => {
    let cancelled = false

    async function initGateway() {
      // Try sync sources first, then async Android bridge
      const config = getGatewayConfig() ?? await getGatewayConfigAsync()
      if (!config || cancelled) {
        if (!cancelled) {
          console.log('[App] No gateway config found. Running in demo mode.')
          useConnectionStore.getState().setStatus('disconnected')
        }
        return
      }

      console.log('[App] Gateway config loaded:', { wsUrl: config.wsUrl, hasToken: !!config.token })
      const client = new GatewayClient(config)
      clientRef.current = client

      client.onStatusChange = (status) => {
        const connStore = useConnectionStore.getState()
        if (status === 'error') {
          connStore.setError('Connection error')
          useSceneStore.getState().setState('error')
        } else if (status === 'disconnected') {
          connStore.setStatus('disconnected')
        } else if (status === 'connecting') {
          connStore.setStatus('connecting')
        }
      }

      client.onConnected = (hello) => {
        useConnectionStore.getState().setConnected(
          hello.server.connId,
          hello.server.version
        )
        // Reset scene to idle when connected
        useSceneStore.getState().setState('idle')

        // Fetch available models from Gateway, then re-apply saved model selection
        fetchModels(client).then(() => {
          const savedRef = useModelConfigStore.getState().activeModelRef
          if (savedRef) {
            client.setModelOverride(savedRef).catch(() => {})
          }
        })

        // Auto-activate full elevated mode for maximum agent capability
        client.chatSend('/elevated full').then((res) => {
          const runId = (res as Record<string, unknown>).runId as string | undefined
          if (runId) suppressedRunIds.current.add(runId)
          console.log('[App] Elevated mode activated')
        }).catch((err) => {
          console.warn('[App] Failed to activate elevated mode:', err)
        })

        // Load chat history
        client.chatHistory().then((res) => {
          const messages = (res as Record<string, unknown>).messages as Array<{
            role: string
            content: Array<{ type: string; text?: string }>
            timestamp: number
          }> | undefined

          if (messages && Array.isArray(messages)) {
            const chatMessages = messages
              .map((m, i) => ({
                id: `history-${i}`,
                role: m.role as 'user' | 'assistant',
                content: m.content
                  ?.filter((c) => c.type === 'text')
                  .map((c) => c.text ?? '')
                  .join('') ?? '',
                timestamp: m.timestamp ?? Date.now(),
              }))
              .filter((m) => {
                const c = m.content.trim()
                if (!c) return false
                // Elevated mode commands and responses
                if (/^\/elevated\b/i.test(c)) return false
                if (/elevated\s*mode/i.test(c) && c.length < 200) return false
                // OpenClaw internal doc markers
                if (/^#\s*\w+\.md\s*[-–—]/im.test(c)) return false
                if (/(?:BOOTSTRAP\.md|SOUL\.md|AGENTS\.md|MEMORY\.md|USER\.md|CONTEXT\.md)/i.test(c)) return false
                // Persona / system prompt patterns
                if (/You're not a chatbot/i.test(c)) return false
                if (/你叫龙虾|你是.*AI助手|你的.*persona/i.test(c)) return false
                // Tool output messages
                if (/^Successfully wrote \d+ bytes/i.test(c)) return false
                if (/^\(no output\)$/i.test(c)) return false
                if (/^Command executed successfully/i.test(c)) return false
                // Package manager / system command raw output
                if (/^local\/\w+\s+[\d.]+/m.test(c)) return false
                if (/\[sudo\]\s*password\s+for/i.test(c)) return false
                if (/^checking dependencies/im.test(c)) return false
                if (/^removing\s+\w+/im.test(c)) return false
                if (/Total Removed Size/i.test(c)) return false
                if (/:: Do you want to remove/i.test(c)) return false
                if (/:: Processing package/i.test(c)) return false
                if (/:: Running post-transaction/i.test(c)) return false
                if (/^Packages?\s*\(\d+\)/m.test(c)) return false
                // Raw JSON tool output
                if (/^\s*\{\s*"status"\s*:\s*"(?:error|success|ok)"/m.test(c)) return false
                if (/^\s*\{\s*"tool"\s*:/m.test(c)) return false
                // OpenClaw debug/status blocks
                if (/^🦞\s*OpenClaw/m.test(c)) return false
                if (/^⏰\s*Time:/m.test(c)) return false
                // Very short tool acknowledgments
                if (c.length < 5 && /^[\s\S]*ok[\s\S]*$/i.test(c)) return false
                return true
              })
            useChatStore.getState().setMessages(chatMessages)
          }
        }).catch((err) => {
          console.error('[App] Failed to load history:', err)
        })
      }

      // Handle chat events
      client.onChat((payload: ChatEventPayload) => {
        // Silently consume responses to suppressed commands (e.g. /elevated full)
        if (payload.runId && suppressedRunIds.current.has(payload.runId)) {
          if (payload.state === 'final' || payload.state === 'error' || payload.state === 'aborted') {
            suppressedRunIds.current.delete(payload.runId)
          }
          return
        }

        const chatStore = useChatStore.getState()
        const sceneStore = useSceneStore.getState()

        if (payload.state === 'delta') {
          const existing = chatStore.messages.find(
            (m) => m.id === `run-${payload.runId}` && m.isStreaming
          )
          if (!existing) {
            const text = payload.message?.content
              ?.filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('') ?? ''
            chatStore.addMessage({
              id: `run-${payload.runId}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              isStreaming: true,
            })
            sceneStore.setState('responding')
          } else {
            const deltaText = payload.message?.content
              ?.filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('') ?? ''
            if (deltaText) {
              chatStore.appendToMessage(`run-${payload.runId}`, deltaText)
            }
          }
        } else if (payload.state === 'final') {
          const finalText = payload.message?.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('') ?? ''

          const existing = chatStore.messages.find((m) => m.id === `run-${payload.runId}`)
          if (existing) {
            chatStore.updateMessage(`run-${payload.runId}`, {
              content: finalText || existing.content,
              isStreaming: false,
            })
          } else {
            chatStore.addMessage({
              id: `run-${payload.runId}`,
              role: 'assistant',
              content: finalText,
              timestamp: Date.now(),
              isStreaming: false,
            })
          }
          chatStore.setGenerating(false)
        } else if (payload.state === 'aborted') {
          chatStore.updateMessage(`run-${payload.runId}`, { isStreaming: false })
          chatStore.setGenerating(false)
        } else if (payload.state === 'error') {
          chatStore.updateMessage(`run-${payload.runId}`, {
            isStreaming: false,
            content: chatStore.messages.find((m) => m.id === `run-${payload.runId}`)?.content +
              `\n\n*Error: ${payload.errorMessage ?? 'Unknown error'}*`,
          })
          chatStore.setGenerating(false)
          sceneStore.setState('error')
          setTimeout(() => sceneStore.setState('idle'), 3000)
        }
      })

      // Handle agent events (tool calls)
      client.onAgent((payload: AgentEventPayload) => {
        const chatStore = useChatStore.getState()
        const sceneStore = useSceneStore.getState()
        const messageId = `run-${payload.runId}`

        if (payload.stream === 'tool') {
          sceneStore.setState('toolCall')
          if (payload.data.phase === 'start' || payload.data.name) {
            sceneStore.incrementToolCall()
            chatStore.addToolCall(messageId, {
              id: payload.data.toolCallId ?? crypto.randomUUID(),
              name: payload.data.name ?? 'unknown',
              status: 'running',
              input: payload.data.input,
            })
          } else if (payload.data.phase === 'end') {
            sceneStore.decrementToolCall()
            if (payload.data.toolCallId) {
              chatStore.updateToolCall(messageId, payload.data.toolCallId, {
                status: 'completed',
                output: payload.data.output,
              })
            }
            triggerFileRefresh(payload.data.name)
          } else if (payload.data.phase === 'error') {
            sceneStore.decrementToolCall()
            if (payload.data.toolCallId) {
              chatStore.updateToolCall(messageId, payload.data.toolCallId, {
                status: 'error',
                output: payload.data.error,
              })
            }
          }
        } else if (payload.stream === 'lifecycle') {
          if (payload.data.phase === 'end') {
            sceneStore.setState('idle')
            useFilesStore.getState().refresh()
          }
        }
      })

      client.connect()
    }

    initGateway()

    return () => {
      cancelled = true
      if (clientRef.current) {
        clientRef.current.disconnect()
        clientRef.current = null
      }
    }
  }, [])

  const handleSend = useCallback((message: string) => {
    const client = clientRef.current
    if (!client) return

    const chatStore = useChatStore.getState()

    chatStore.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    })

    chatStore.setGenerating(true)

    client.chatSend(message).then((res) => {
      const runId = (res as Record<string, unknown>).runId as string | undefined
      if (runId) {
        useChatStore.getState().setGenerating(true, runId)
      }
    }).catch((err) => {
      console.error('[App] chat.send failed:', err)
      chatStore.addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Failed to send: ${err.message}`,
        timestamp: Date.now(),
      })
      chatStore.setGenerating(false)
    })
  }, [])

  const handleAbort = useCallback(() => {
    const client = clientRef.current
    if (!client) return
    const runId = useChatStore.getState().currentRunId
    client.chatAbort('main', runId ?? undefined).catch(console.error)
  }, [])

  const handleNewChat = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    try {
      await client.sessionReset('main')
      useChatStore.getState().clear()
      const savedRef = useModelConfigStore.getState().activeModelRef
      if (savedRef) {
        await client.setModelOverride(savedRef).catch(() => {})
      }
    } catch (err) {
      console.error('[App] Failed to reset session:', err)
    }
  }, [])

  // Model selection handler (called from ModelSelector bottom sheet)
  const handleModelSelect = useCallback(async (modelRef: string) => {
    const client = clientRef.current
    if (!client) throw new Error('Not connected')
    const res = await client.setModelOverride(modelRef)
    const resolved = res.resolved as { modelProvider?: string; model?: string } | undefined
    return {
      resolvedProvider: resolved?.modelProvider,
      resolvedModel: resolved?.model,
    }
  }, [])

  const [wizardInitialProvider, setWizardInitialProvider] = useState<string | undefined>()

  // Handler for AddProviderWizard completion: restart Gateway and refresh models
  const handleProviderAdded = useCallback(async () => {
    useModelConfigStore.getState().closeWizard()
    const client = clientRef.current

    if (isAndroid && ClawOSBridge) {
      try {
        console.log('[App] Restarting Gateway to load new config...')
        await ClawOSBridge.restartGateway()
        console.log('[App] Gateway restarted successfully')
      } catch (err) {
        console.warn('[App] Failed to restart gateway:', err)
      }
    }

    if (client) {
      const pollModels = async (retries: number) => {
        for (let i = 0; i < retries; i++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            await fetchModels(client)
            const models = useModelConfigStore.getState().availableModels
            if (models.length > 0) {
              console.log(`[App] Models refreshed after ${i + 1} attempt(s)`)
              // Don't auto-open selector - let user stay on main page
              return
            }
          } catch { /* Gateway might not be ready yet */ }
        }
        console.warn('[App] Gave up polling for models after retries')
      }
      pollModels(5)
    }
  }, [])

  const handleWizardOpen = useCallback((providerId?: string) => {
    setWizardInitialProvider(providerId)
    useModelConfigStore.getState().openWizard()
  }, [])

  const handleWizardCancel = useCallback(() => {
    useModelConfigStore.getState().closeWizard()
  }, [])

  const isWizardOpen = useModelConfigStore((s) => s.isWizardOpen)

  // ── IM Channel Management ──
  const isIMWizardOpen = useIMChannelStore((s) => s.isWizardOpen)
  const [isIMListOpen, setIMListOpen] = useState(false)
  const [isSkillMarketOpen, setSkillMarketOpen] = useState(false)
  const [isUpdatePanelOpen, setUpdatePanelOpen] = useState(false)

  const handleIMEntryClick = useCallback(() => {
    setIMListOpen(true)
  }, [])

  const handleIMListClose = useCallback(() => {
    setIMListOpen(false)
  }, [])

  const handleIMAddNew = useCallback(() => {
    setIMListOpen(false)
    useIMChannelStore.getState().openWizard()
  }, [])

  const handleIMWizardCancel = useCallback(() => {
    useIMChannelStore.getState().closeWizard()
  }, [])

  const handleIMWizardComplete = useCallback(() => {
    useIMChannelStore.getState().closeWizard()
  }, [])

  const handleIMAutoSetup = useCallback((platformId: string, credsFile?: string) => {
    useIMChannelStore.getState().closeWizard()
    const platformNames: Record<string, string> = {
      telegram: 'Telegram', discord: 'Discord', slack: 'Slack', feishu: '飞书', dingtalk: '钉钉',
    }
    const name = platformNames[platformId] || platformId
    const credsNote = credsFile
      ? ` 用户的登录凭据已保存到 ${credsFile}，请用 exec 工具读取该文件获取邮箱和密码，完成后删除该文件。不要在聊天中要求用户提供密码。`
      : ''
    handleSend(`请帮我自动配置 ${name} Bot，包括安装应用、登录引导、创建 Bot、提取 Token 和写入 Gateway 配置。请读取 im-setup-automation skill 文件获取详细步骤。${credsNote}`)
  }, [handleSend])

  const handleSkillMarketOpen = useCallback(() => {
    setSkillMarketOpen(true)
  }, [])

  const handleSkillMarketClose = useCallback(() => {
    setSkillMarketOpen(false)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: `${viewportHeight}px`,
        overflow: 'hidden',
        color: '#fff',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif",
        background: 'linear-gradient(160deg, #0c1122 0%, #0f0d22 30%, #13162c 50%, #0f0d22 70%, #0c1122 100%)',
        transition: 'height 0.1s ease-out',
      }}
    >
      {/* Background color spots */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '60%', height: '40%', borderRadius: '50%', pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse, rgba(6,182,212,0.25) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: '60%', height: '40%', borderRadius: '50%', pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse, rgba(139,92,246,0.25) 0%, transparent 70%)', filter: 'blur(60px)' }} />

      {/* Scanline Effect */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 1,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.04) 1px, rgba(0,0,0,0.04) 2px)',
          backgroundSize: '100% 2px',
        }}
      />

      {/* Main Content Layout */}
      <main style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: isMobile ? '16px 12px 56px' : '48px 32px 32px',
      }}>

        {/* Top Header: Status HUD */}
        <header style={{ flexShrink: 0, marginBottom: isMobile ? '8px' : '24px', width: '100%' }}>
          <motion.div
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ width: '100%' }}
          >
            <HUD onIMClick={handleIMEntryClick} onSkillMarketClick={handleSkillMarketOpen} />
          </motion.div>
        </header>

        {/* Central Area: Brain & Workspace */}
        <div style={{
          flex: '1 1 0%',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? '12px' : '24px',
          alignItems: 'stretch',
          position: 'relative',
          minHeight: 0,
        }}>

          {/* Left/Center: AI Brain & Chat */}
          <div style={{
            flex: '1 1 0%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            maxWidth: '768px',
            margin: '0 auto',
            gap: isMobile ? '8px' : '16px',
            minHeight: 0,
          }}>
            {/* AI Brain: responsive size */}
            <div style={{ position: 'relative', width: isMobile ? 280 : 320, height: isMobile ? 280 : 320, flexShrink: 0 }}>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1,
                }}
              >
                <AIBrain />
              </motion.div>
              <FunctionOrbit
                onUpdateClick={() => setUpdatePanelOpen(true)}
                onAppsClick={() => useAppsStore.getState().open()}
                onSkillClick={handleSkillMarketOpen}
                onIMClick={handleIMEntryClick}
              />
            </div>

            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              style={{
                width: '100%',
                flex: '1 1 0%',
                minHeight: 0,
              }}
            >
              <ChatPanel onSend={handleSend} onAbort={handleAbort} onNewChat={handleNewChat} />
            </motion.div>
          </div>

          {/* Right: Data Vault Sidebar (Desktop only) */}
          {!isMobile && (
            <motion.aside
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.8 }}
              style={{ display: 'flex', width: '320px', height: '100%', flexDirection: 'column', justifyContent: 'center' }}
            >
              <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', padding: '4px', height: '80%', overflow: 'hidden' }}>
                <div style={{ height: '100%', overflowY: 'auto', padding: '8px' }}>
                  <div style={{ paddingTop: '16px', paddingLeft: '8px', paddingRight: '8px', fontSize: '20px', fontWeight: 300, color: '#cffafe', borderLeft: '2px solid #06b6d4', marginBottom: '16px' }}>Data Vault</div>
                  <DataVault />
                </div>
              </div>
            </motion.aside>
          )}

        </div>
      </main>

      {/* Electron close button (hidden on Android) */}
      {window.clawos?.isElectron && (
        <button
          onClick={() => window.clawos?.quit?.()}
          style={{ position: 'absolute', top: '8px', left: '12px', zIndex: 50, width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', border: 'none', cursor: 'pointer', fontSize: '12px' }}
          title="Exit"
        >
          ✕
        </button>
      )}

      {/* Decorative Corners */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: isMobile ? '80px' : '128px', height: isMobile ? '80px' : '128px', pointerEvents: 'none', zIndex: 20, borderLeft: '2px solid rgba(34,211,238,0.4)', borderTop: '2px solid rgba(34,211,238,0.4)', borderRadius: '12px 0 0 0' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: isMobile ? '80px' : '128px', height: isMobile ? '80px' : '128px', pointerEvents: 'none', zIndex: 20, borderRight: '2px solid rgba(139,92,246,0.4)', borderBottom: '2px solid rgba(139,92,246,0.4)', borderRadius: '0 0 12px 0' }} />

      {/* Model Selector bottom sheet */}
      <ModelSelector
        onSelectModel={handleModelSelect}
        onAddProvider={handleWizardOpen}
      />

      {/* Add Provider Wizard (full-screen overlay) */}
      {isWizardOpen && (
        <AddProviderWizard
          onComplete={handleProviderAdded}
          onCancel={handleWizardCancel}
          initialProvider={wizardInitialProvider}
          gatewayClient={clientRef.current ?? undefined}
        />
      )}

      {/* IM Channel List (full-screen overlay) */}
      {isIMListOpen && (
        <IMChannelList
          onClose={handleIMListClose}
          onAddNew={handleIMAddNew}
        />
      )}

      {/* IM Setup Wizard (full-screen overlay) */}
      {isIMWizardOpen && (
        <IMSetupWizard
          onComplete={handleIMWizardComplete}
          onCancel={handleIMWizardCancel}
          onAISetup={handleIMAutoSetup}
        />
      )}

      {/* Skill Marketplace (full-screen overlay) */}
      {isSkillMarketOpen && (
        <SkillMarketplace onClose={handleSkillMarketClose} />
      )}

      {/* Gateway Update Panel */}
      {isUpdatePanelOpen && (
        <GatewayUpdate onClose={() => setUpdatePanelOpen(false)} />
      )}

      {/* App Drawer (swipe up from bottom or HUD button) */}
      <Suspense fallback={null}>
        <AppDrawer />
      </Suspense>

      {/* Swipe-up hot zone at the bottom edge */}
      {isAndroid && <SwipeUpZone />}
    </div>
  )
}

function SwipeUpZone() {
  const touchRef = useRef<{ startY: number; startTime: number } | null>(null)
  const openDrawer = useAppsStore((s) => s.open)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { startY: e.touches[0].clientY, startTime: Date.now() }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return
    const dy = touchRef.current.startY - e.changedTouches[0].clientY
    const dt = Date.now() - touchRef.current.startTime
    touchRef.current = null
    // Swipe up: distance > 50px within 500ms
    if (dy > 50 && dt < 500) {
      openDrawer()
    }
  }, [openDrawer])

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '40px',
        zIndex: 9990,
        touchAction: 'none',
      }}
    >
      {/* Visual hint: small pill at the bottom center */}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '32px',
        height: '4px',
        borderRadius: '2px',
        background: 'rgba(255,255,255,0.2)',
      }} />
    </div>
  )
}

function triggerFileRefresh(toolName?: string) {
  const fileTools = ['exec', 'write', 'edit', 'apply_patch', 'read', 'bash', 'shell']
  if (!toolName || fileTools.includes(toolName)) {
    setTimeout(() => {
      useFilesStore.getState().refresh()
    }, 500)
  }
}
