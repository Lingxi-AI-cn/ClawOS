/**
 * ClawOS Voice module – public API
 *
 * Usage:
 *   import { voiceService } from '../voice'
 *   await voiceService.startListening()
 */

export { ClawOSVoice } from './plugin.ts'
export type * from './types.ts'

import { ClawOSVoice } from './plugin.ts'
import type {
  VoiceAvailability,
  SpeechResultEvent,
  SpeakEndEvent,
} from './types.ts'

type Unsubscribe = () => void

class VoiceService {
  private _available: VoiceAvailability | null = null
  private _listening = false
  private _speaking = false
  private _listeners: Array<{ remove: () => Promise<void> }> = []

  /** Check if voice models are available on this device. */
  async checkAvailability(): Promise<VoiceAvailability> {
    if (!ClawOSVoice) {
      return { stt: false, tts: false, vad: false, modelPath: '' }
    }
    this._available = await ClawOSVoice.isAvailable()
    return this._available
  }

  /** Pre-initialize STT engine in background to avoid cold-start delay. */
  async warmup(): Promise<void> {
    if (!ClawOSVoice) return
    try {
      await (ClawOSVoice as any).warmup()
    } catch {
      // warmup is best-effort
    }
  }

  get isAvailable(): boolean {
    return this._available?.stt === true
  }

  get isTtsAvailable(): boolean {
    return this._available?.tts === true
  }

  get isListening(): boolean {
    return this._listening
  }

  get isSpeaking(): boolean {
    return this._speaking
  }

  /**
   * Start speech recognition.
   * @param onPartial  Called with partial (intermediate) recognition results.
   * @param onFinal    Called with final (endpoint-detected) recognition results.
   */
  async startListening(
    onPartial: (text: string) => void,
    onFinal: (text: string) => void
  ): Promise<void> {
    if (!ClawOSVoice || this._listening) return

    // Register event listeners before starting
    const partialHandle = await ClawOSVoice.addListener(
      'partialResult',
      (event: SpeechResultEvent) => {
        onPartial(event.text)
      }
    )
    const finalHandle = await ClawOSVoice.addListener(
      'finalResult',
      (event: SpeechResultEvent) => {
        onFinal(event.text)
      }
    )
    this._listeners.push(partialHandle, finalHandle)

    await ClawOSVoice.startListening()
    this._listening = true
  }

  /** Stop speech recognition. */
  async stopListening(): Promise<void> {
    if (!ClawOSVoice || !this._listening) return
    await ClawOSVoice.stopListening()
    this._listening = false

    // Wait for the native recognition loop to finish and deliver final result.
    // The native side fires finalResult after loop exit, so we need a small delay.
    await new Promise(resolve => setTimeout(resolve, 500))

    // Clean up listeners
    for (const handle of this._listeners) {
      await handle.remove()
    }
    this._listeners = []
  }

  /**
   * Speak text using TTS.
   * @returns Promise that resolves when speech starts. Listen for speakEnd event for completion.
   */
  async speak(
    text: string,
    onEnd?: (event: SpeakEndEvent) => void
  ): Promise<void> {
    if (!ClawOSVoice) return

    if (this._speaking) {
      await this.stopSpeaking()
    }

    if (onEnd) {
      const handle = await ClawOSVoice.addListener('speakEnd', (event) => {
        this._speaking = false
        onEnd(event)
        handle.remove()
      })
    }

    await ClawOSVoice.speak({ text })
    this._speaking = true
  }

  /** Stop TTS playback. */
  async stopSpeaking(): Promise<void> {
    if (!ClawOSVoice || !this._speaking) return
    await ClawOSVoice.stopSpeaking()
    this._speaking = false
  }
}

/** Singleton voice service instance. */
export const voiceService = new VoiceService()
