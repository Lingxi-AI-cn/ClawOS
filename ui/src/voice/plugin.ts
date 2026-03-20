/**
 * ClawOSVoice Capacitor plugin registration and wrapper.
 *
 * On non-Android platforms, all methods are no-ops / stubs.
 */
import { registerPlugin } from '@capacitor/core'
import { isAndroid } from '../gateway/bridge.ts'
import type {
  VoiceAvailability,
  StartListeningResult,
  StopListeningResult,
  SpeakResult,
  StopSpeakingResult,
  SpeakOptions,
  SpeechResultEvent,
  SpeakEndEvent,
} from './types.ts'

// ── Native plugin interface ────────────────────────────────────
interface ClawOSVoicePlugin {
  isAvailable(): Promise<VoiceAvailability>
  startListening(): Promise<StartListeningResult>
  stopListening(): Promise<StopListeningResult>
  speak(options: SpeakOptions): Promise<SpeakResult>
  stopSpeaking(): Promise<StopSpeakingResult>

  addListener(
    eventName: 'partialResult',
    listener: (event: SpeechResultEvent) => void
  ): Promise<{ remove: () => Promise<void> }>

  addListener(
    eventName: 'finalResult',
    listener: (event: SpeechResultEvent) => void
  ): Promise<{ remove: () => Promise<void> }>

  addListener(
    eventName: 'speakEnd',
    listener: (event: SpeakEndEvent) => void
  ): Promise<{ remove: () => Promise<void> }>
}

// ── Registration ───────────────────────────────────────────────
const ClawOSVoice = isAndroid
  ? registerPlugin<ClawOSVoicePlugin>('ClawOSVoice')
  : null

export { ClawOSVoice }
export type { ClawOSVoicePlugin }
