// OpenClaw Gateway WebSocket Client

// Polyfill for Android WebView (no crypto.randomUUID in non-secure context)
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = () =>
    '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
    ) as `${string}-${string}-${string}-${string}-${string}`
}

import type {
  RequestFrame,
  ResponseFrame,
  EventFrame,
  Frame,
  ConnectParams,
  HelloOkPayload,
  ChatSendParams,
  ChatHistoryParams,
  ChatAbortParams,
  ChatEventPayload,
  AgentEventPayload,
} from './protocol.ts'
import type { GatewayConfig } from './config.ts'

type EventHandler = (payload: Record<string, unknown>) => void

export class GatewayClient {
  private ws: WebSocket | null = null
  private config: GatewayConfig
  private pendingRequests = new Map<string, {
    resolve: (payload: Record<string, unknown>) => void
    reject: (error: Error) => void
  }>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 50
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private handshakeSent = false

  // Callbacks
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void
  onConnected?: (payload: HelloOkPayload) => void

  constructor(config: GatewayConfig) {
    this.config = config
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.disposed) return

    this.onStatusChange?.('connecting')
    this.handshakeSent = false
    this.ws = new WebSocket(this.config.wsUrl)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      // Don't send handshake immediately - wait for connect.challenge event
      // Set a fallback timer in case challenge doesn't arrive
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN && !this.handshakeSent) {
          this.sendHandshake()
        }
      }, 1500)
    }

    this.ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data as string) as Frame
        this.handleFrame(frame)
      } catch (e) {
        console.error('[GatewayClient] Failed to parse frame:', e)
      }
    }

    this.ws.onclose = (event) => {
      console.log('[GatewayClient] Connection closed:', event.code, event.reason)
      this.ws = null
      this.rejectAllPending('Connection closed')
      // During reconnection, keep showing "connecting" instead of "disconnected"
      // to avoid confusing status flicker (disconnected → connecting → disconnected...)
      if (!this.disposed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.onStatusChange?.('connecting')
        this.scheduleReconnect()
      } else if (this.disposed) {
        this.onStatusChange?.('disconnected')
      } else {
        this.onStatusChange?.('error')
      }
    }

    this.ws.onerror = (event) => {
      console.error('[GatewayClient] WebSocket error:', event)
      // Don't immediately show "error" during initial connection / reconnection.
      // The onclose handler will fire next and manage the status properly.
      // Only show error if we're past max reconnects.
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.onStatusChange?.('error')
      }
    }
  }

  disconnect() {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
    this.rejectAllPending('Client disconnected')
  }

  // --- RPC Methods ---

  async chatSend(message: string, sessionKey = 'main'): Promise<Record<string, unknown>> {
    const params = {
      sessionKey,
      message,
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 120000,
    } satisfies ChatSendParams
    return this.request('chat.send', params as unknown as Record<string, unknown>)
  }

  async chatHistory(sessionKey = 'main', limit = 200): Promise<Record<string, unknown>> {
    const params = { sessionKey, limit } satisfies ChatHistoryParams
    return this.request('chat.history', params as unknown as Record<string, unknown>)
  }

  async chatAbort(sessionKey = 'main', runId?: string): Promise<Record<string, unknown>> {
    const params = { sessionKey, runId } satisfies ChatAbortParams
    return this.request('chat.abort', params as unknown as Record<string, unknown>)
  }

  async setModelOverride(modelRef: string, sessionKey = 'main'): Promise<Record<string, unknown>> {
    return this.request('sessions.patch', { key: sessionKey, model: modelRef })
  }

  async listModels(): Promise<Record<string, unknown>> {
    return this.request('models.list', {})
  }

  async antigravityStart(): Promise<{ authUrl: string; sessionId: string }> {
    return this.request('auth.antigravity.start', {}) as Promise<{ authUrl: string; sessionId: string }>
  }

  async antigravityExchange(sessionId: string, redirectUrl: string): Promise<{ access: string; refresh: string; expires: number; projectId: string; email?: string }> {
    return this.request('auth.antigravity.exchange', { sessionId, redirectUrl }) as Promise<{ access: string; refresh: string; expires: number; projectId: string; email?: string }>
  }

  // --- Event Subscriptions ---

  on(event: string, handler: EventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: EventHandler) {
    this.eventHandlers.get(event)?.delete(handler)
  }

  onChat(handler: (payload: ChatEventPayload) => void) {
    return this.on('chat', handler as unknown as EventHandler)
  }

  onAgent(handler: (payload: AgentEventPayload) => void) {
    return this.on('agent', handler as unknown as EventHandler)
  }

  // --- Internal ---

  private sendHandshake() {
    if (this.handshakeSent) return
    this.handshakeSent = true

    console.log('[GatewayClient] Sending connect handshake, token prefix:', this.config.token.substring(0, 8) + '...')

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        displayName: 'ClawOS',
        version: '0.1.0',
        platform: navigator.platform || 'web',
        mode: 'webchat',
      },
      caps: [],
      auth: { token: this.config.token },
      scopes: ['operator.admin'],
      locale: navigator.language || 'zh-CN',
      userAgent: navigator.userAgent,
    }
    this.request('connect', params as unknown as Record<string, unknown>)
      .then((payload) => {
        const hello = payload as unknown as HelloOkPayload
        this.onStatusChange?.('connected')
        this.onConnected?.(hello)
      })
      .catch((err) => {
        console.error('[GatewayClient] Handshake failed:', err)
        this.onStatusChange?.('error')
        this.ws?.close()
      })
  }

  private request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestLong(method, params, 30000)
  }

  private requestLong(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }
      const id = crypto.randomUUID()
      const frame: RequestFrame = { type: 'req', id, method, params }
      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(frame))

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request ${method} timed out`))
        }
      }, timeoutMs)
    })
  }

  private handleFrame(frame: Frame) {
    if (frame.type === 'res') {
      this.handleResponse(frame as ResponseFrame)
    } else if (frame.type === 'event') {
      this.handleEvent(frame as EventFrame)
    }
  }

  private handleResponse(frame: ResponseFrame) {
    const pending = this.pendingRequests.get(frame.id)
    if (!pending) return
    this.pendingRequests.delete(frame.id)

    if (frame.ok) {
      pending.resolve(frame.payload ?? {})
    } else {
      pending.reject(new Error(frame.error?.message ?? 'Unknown error'))
    }
  }

  private handleEvent(frame: EventFrame) {
    const handlers = this.eventHandlers.get(frame.event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(frame.payload)
        } catch (e) {
          console.error(`[GatewayClient] Event handler error for ${frame.event}:`, e)
        }
      }
    }

    // Handle connect.challenge - trigger handshake
    if (frame.event === 'connect.challenge') {
      console.log('[GatewayClient] Received connect.challenge')
      this.sendHandshake()
      return
    }

    // Handle tick (keepalive)
    if (frame.event === 'tick') {
      // No action needed, just confirms connection is alive
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[GatewayClient] Max reconnect attempts reached')
      this.onStatusChange?.('error')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`[GatewayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private rejectAllPending(reason: string) {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(reason))
    }
    this.pendingRequests.clear()
  }
}
