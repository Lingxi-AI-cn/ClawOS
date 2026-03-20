// OpenClaw Gateway WebSocket Protocol Types (Protocol v3)

// --- Frame Types ---

export interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: Record<string, unknown>
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface EventFrame {
  type: 'event'
  event: string
  payload: Record<string, unknown>
  seq?: number
}

export type Frame = RequestFrame | ResponseFrame | EventFrame

// --- Connect Handshake ---

export interface ConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: string
    displayName: string
    version: string
    platform: string
    mode: string
  }
  role: string
  scopes: string[]
  caps: string[]
  auth: { token: string }
  locale: string
  userAgent: string
}

export interface HelloOkPayload {
  type: 'hello-ok'
  protocol: number
  server: {
    version: string
    host: string
    connId: string
  }
  features: {
    methods: string[]
    events: string[]
  }
}

// --- Chat Types ---

export interface ChatSendParams {
  sessionKey: string
  message: string
  idempotencyKey: string
  timeoutMs?: number
}

export interface ChatHistoryParams {
  sessionKey: string
  limit?: number
}

export interface ChatAbortParams {
  sessionKey: string
  runId?: string
}

export interface ChatEventPayload {
  runId: string
  sessionKey: string
  seq: number
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: {
    role: string
    content: Array<{ type: string; text?: string }>
    timestamp: number
  }
  errorMessage?: string
}

export interface AgentEventPayload {
  runId: string
  sessionKey: string
  stream: 'assistant' | 'tool' | 'lifecycle'
  seq: number
  data: {
    text?: string
    phase?: string
    name?: string
    toolCallId?: string
    input?: string
    output?: string
    error?: string
  }
}
