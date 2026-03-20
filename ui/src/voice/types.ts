/** ClawOSVoice plugin – TypeScript interfaces */

export interface VoiceAvailability {
  stt: boolean
  tts: boolean
  vad: boolean
  modelPath: string
}

export interface PartialResultEvent {
  text: string
  isFinal: false
}

export interface FinalResultEvent {
  text: string
  isFinal: true
}

export type SpeechResultEvent = PartialResultEvent | FinalResultEvent

export interface SpeakEndEvent {
  status: 'ended' | 'error'
  error?: string
}

export interface StartListeningResult {
  status: 'listening'
}

export interface StopListeningResult {
  status: 'stopped'
}

export interface SpeakResult {
  status: 'speaking'
}

export interface StopSpeakingResult {
  status: 'stopped'
}

export interface SpeakOptions {
  text: string
  sid?: number
  speed?: number
}
