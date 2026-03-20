// Shared platform type declarations

import type { FileEntry } from '../store/files.ts'
import type { SystemInfo } from '../store/system.ts'

declare global {
  interface Window {
    clawos?: {
      readConfig: () => string | null
      quit?: () => void
      getSystemInfo?: () => SystemInfo
      listDirectory?: (path: string) => { path: string; entries: FileEntry[] }
      platform: string
      isElectron: boolean
    }
  }
}
