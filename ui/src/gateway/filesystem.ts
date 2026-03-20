import './types.ts'
import { isAndroid, isElectron, ClawOSBridge } from './bridge.ts'
import type { FileEntry } from '../store/files.ts'
import type { SystemInfo } from '../store/system.ts'

// --- System Info ---

export async function fetchSystemInfo(): Promise<SystemInfo> {
  // Electron: synchronous native API
  if (isElectron && window.clawos?.getSystemInfo) {
    return window.clawos.getSystemInfo()
  }

  // Android: Capacitor plugin
  if (isAndroid && ClawOSBridge) {
    return await ClawOSBridge.getSystemInfo()
  }

  // Fallback: Vite dev server API
  const res = await fetch('/api/system-info')
  if (!res.ok) throw new Error(`Failed to fetch system info: ${res.status}`)
  return res.json()
}

// --- File Listing ---

export async function fetchDirectoryListing(
  dirPath: string,
): Promise<{ path: string; entries: FileEntry[] }> {
  // Electron: synchronous native API
  if (isElectron && window.clawos?.listDirectory) {
    return window.clawos.listDirectory(dirPath)
  }

  // Android: Capacitor plugin
  if (isAndroid && ClawOSBridge) {
    return await ClawOSBridge.listDirectory({ path: dirPath })
  }

  // Fallback: Vite dev server API
  const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`)
  if (!res.ok) throw new Error(`Failed to list directory: ${res.status}`)
  return res.json()
}
