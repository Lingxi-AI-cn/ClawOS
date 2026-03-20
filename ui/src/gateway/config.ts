// Gateway configuration

import './types.ts'
import { isAndroid, isElectron, ClawOSBridge } from './bridge.ts'

export interface GatewayConfig {
  wsUrl: string
  token: string
}

function getConfigFromElectron(): GatewayConfig | null {
  if (!isElectron) return null
  try {
    const raw = window.clawos!.readConfig()
    if (!raw) return null
    const config = JSON.parse(raw)
    const token = config?.gateway?.auth?.token
    const port = config?.gateway?.port ?? 18789
    if (!token) return null
    return { wsUrl: `ws://localhost:${port}`, token }
  } catch {
    return null
  }
}

async function getConfigFromAndroid(): Promise<GatewayConfig | null> {
  if (!isAndroid || !ClawOSBridge) return null
  try {
    const result = await ClawOSBridge.readGatewayConfig()
    if (result.config) {
      const config = JSON.parse(result.config)
      const token = config?.gateway?.auth?.token
      const port = config?.gateway?.port ?? 18789
      if (token) {
        return { wsUrl: `ws://localhost:${port}`, token }
      }
    }
    // If no config file, try URL hash (might have token from AOSP setup)
    return null
  } catch {
    return null
  }
}

function getConfigFromUrl(): GatewayConfig | null {
  // Support #token=xxx in URL (like OpenClaw Control UI)
  const hash = window.location.hash
  const tokenMatch = hash.match(/token=([a-f0-9]+)/)
  if (tokenMatch) {
    const host = window.location.hostname || 'localhost'
    const port = new URLSearchParams(window.location.search).get('port') || '18789'
    return { wsUrl: `ws://${host}:${port}`, token: tokenMatch[1] }
  }
  return null
}

function getConfigFromViteEnv(): GatewayConfig | null {
  // Vite injects token at build/dev time from ~/.openclaw/openclaw.json
  const token = import.meta.env.VITE_GATEWAY_TOKEN
  if (token) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = import.meta.env.DEV
      ? `${protocol}//${host}/gateway-ws`
      : `ws://localhost:${import.meta.env.VITE_GATEWAY_PORT || '18789'}`
    return { wsUrl, token }
  }
  return null
}

let cachedConfig: GatewayConfig | null = null

export function getGatewayConfig(): GatewayConfig | null {
  if (cachedConfig) return cachedConfig
  // Synchronous sources (Electron, URL, Vite env)
  cachedConfig = getConfigFromElectron() ?? getConfigFromUrl() ?? getConfigFromViteEnv()
  return cachedConfig
}

/**
 * Async config getter - tries Android bridge if sync sources fail.
 * Call this on app initialization.
 */
export async function getGatewayConfigAsync(): Promise<GatewayConfig | null> {
  if (cachedConfig) return cachedConfig

  // Try sync sources first
  cachedConfig = getConfigFromElectron() ?? getConfigFromUrl() ?? getConfigFromViteEnv()
  if (cachedConfig) return cachedConfig

  // Try Android async source
  cachedConfig = await getConfigFromAndroid()
  return cachedConfig
}

export function setGatewayConfig(config: GatewayConfig) {
  cachedConfig = config
}
