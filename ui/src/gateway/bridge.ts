// ClawOS Native Bridge - Capacitor plugin interface
//
// Provides a unified interface to the ClawOSBridge native plugin.
// On non-Android platforms, methods return null/fallback values.

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { SystemInfo } from '../store/system.ts'
import type { FileEntry } from '../store/files.ts'

// ── Plugin interface ────────────────────────────────────────────
interface ClawOSBridgePlugin {
  getPlatform(): Promise<{ platform: string; isElectron: boolean; isAndroid: boolean }>
  getSystemInfo(): Promise<SystemInfo>
  getStatusBarInfo(): Promise<{
    batteryLevel: number
    batteryCharging: boolean
    wifiConnected: boolean
    wifiStrength: number
    carrier: string
    signalBars: number
  }>
  listDirectory(options: { path: string }): Promise<{ path: string; entries: FileEntry[] }>
  readGatewayConfig(): Promise<{
    config: string | null
    source: string
    defaultWsUrl: string
    error?: string
  }>
  /** Read a text file from the filesystem */
  readTextFile(options: { path: string }): Promise<{ content: string }>
  /** Write a text file to the filesystem */
  writeTextFile(options: { path: string; content: string }): Promise<{ ok: boolean }>
  /** Patch a JSON file: read → set value at jsonPath → write back */
  patchJsonFile(options: { path: string; jsonPath: string; value: string }): Promise<{ ok: boolean }>
  /** Add model IDs to the Gateway's agents.defaults.models allow list */
  addModelsToAllowList(options: { path: string; modelIds: string[] }): Promise<{ ok: boolean; added: number }>
  /** Get all launchable apps installed on the device */
  getInstalledApps(): Promise<{ apps: AppInfo[] }>
  /** Launch an app by its package name */
  launchApp(options: { packageName: string }): Promise<{ ok: boolean }>
  /** Open Android system settings; action defaults to general settings */
  openSettings(options?: { action?: string }): Promise<{ ok: boolean }>
  /** Open a URL in the system browser */
  openUrl(options: { url: string }): Promise<{ ok: boolean }>
  /** Install a plugin from ROM-bundled path to Gateway extensions dir */
  installPlugin(options: { pluginId: string }): Promise<{ ok: boolean; pluginId: string; path: string }>
  /** Restart the ClawOS Gateway service to reload config */
  restartGateway(): Promise<{ ok: boolean }>
  /** Check npm registry for Gateway updates */
  checkGatewayUpdate(): Promise<{
    installed: string
    latest: string | null
    updateAvailable: boolean
    error?: string
    exitCode: number
  }>
  /** Download and stage a Gateway update (requires restart to apply) */
  applyGatewayUpdate(): Promise<{
    success: boolean
    oldVersion?: string
    newVersion?: string
    message?: string
    error?: string
    exitCode: number
  }>
  /** Roll back to the previous Gateway version */
  rollbackGateway(): Promise<{
    success: boolean
    oldVersion?: string
    restoredVersion?: string
    error?: string
    exitCode: number
  }>
  /** Get current Gateway version info */
  getGatewayVersion(): Promise<{
    installed: string
    rom: string
    backup: string | null
    pending: string | null
    exitCode: number
  }>
  /** Get the skills directory path */
  getSkillsDirectory(): Promise<{ path: string }>
  /** List installed skills */
  listInstalledSkills(): Promise<{ skills: string[] }>
  /** Write a file to the filesystem */
  writeFile(options: { path: string; content: string }): Promise<{ ok: boolean }>
  /** Delete a skill */
  deleteSkill(options: { slug: string }): Promise<{ ok: boolean }>
  /** Reboot the device */
  rebootDevice(): Promise<{ ok: boolean }>
  /** Shutdown the device */
  shutdownDevice(): Promise<{ ok: boolean }>
  /** Start OAuth authorization flow (opens browser, returns tokens) */
  startOAuthFlow(options: {
    provider: string
    email: string
    authUrl: string
    scopes: string[]
    clientId: string
    clientSecret: string
    tokenUrl: string
  }): Promise<{
    success: boolean
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    projectId?: string
    error?: string
  }>
}

// ── Platform detection ──────────────────────────────────────────
export const isAndroid = Capacitor.getPlatform() === 'android'
export const isElectron = !!window.clawos?.isElectron
export const isWeb = !isAndroid && !isElectron

// ── Plugin registration ─────────────────────────────────────────
// Only register on Android to avoid errors on web/electron
const ClawOSBridge = isAndroid
  ? registerPlugin<ClawOSBridgePlugin>('ClawOSBridge')
  : null

export { ClawOSBridge }
export type { ClawOSBridgePlugin }

export interface AppInfo {
  packageName: string
  label: string
  icon: string
  isSystem: boolean
}
