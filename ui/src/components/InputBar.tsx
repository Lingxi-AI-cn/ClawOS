import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Mic, MicOff, Send, Square } from 'lucide-react'
import { useChatStore } from '../store/chat.ts'
import { voiceService } from '../voice/index.ts'
import { isAndroid } from '../gateway/bridge.ts'

interface InputBarProps {
  onSend: (message: string) => void
  onAbort: () => void
  disabled?: boolean
  disabledHint?: string
}

export default function InputBar({ onSend, onAbort, disabled, disabledHint }: InputBarProps) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isGenerating = useChatStore((s) => s.isGenerating)

  // Voice state - always enable on Android, check availability in background
  const [voiceAvailable, setVoiceAvailable] = useState(isAndroid)
  const [isListening, setIsListening] = useState(false)
  const [partialText, setPartialText] = useState('')
  const [voiceError, setVoiceError] = useState('')

  useEffect(() => {
    if (isAndroid) {
      voiceService.checkAvailability().then((a) => {
        setVoiceAvailable(a.stt)
        if (a.stt) setTimeout(() => voiceService.warmup(), 3000)
      }).catch(() => {
        setVoiceAvailable(true)
        setTimeout(() => voiceService.warmup(), 3000)
      })
    }
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating || disabled) return
    onSend(trimmed)
    setText('')
    setPartialText('')
  }, [text, isGenerating, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // Prevent page scroll when keyboard opens (container resizes via useViewportHeight)
  useEffect(() => {
    if (!focused) return
    const resetScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
    }
    window.addEventListener('keyboardchange', resetScroll)
    return () => window.removeEventListener('keyboardchange', resetScroll)
  }, [focused])

  // Clear voice error after 3 seconds
  useEffect(() => {
    if (voiceError) {
      const timer = setTimeout(() => setVoiceError(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [voiceError])

  // ── Voice toggle ─────────────────────────────────────────────
  const togglePendingRef = useRef(false)
  const listeningRef = useRef(false)
  const toggleVoice = useCallback(async () => {
    if (togglePendingRef.current) return
    togglePendingRef.current = true
    setVoiceError('')
    try {
      if (isListening) {
        listeningRef.current = false
        await voiceService.stopListening()
        setIsListening(false)
        setPartialText('')
      } else {
        listeningRef.current = true
        setIsListening(true)
        setPartialText('')
        await voiceService.startListening(
          (partial) => {
            if (!listeningRef.current) return
            setPartialText(partial)
          },
          (final) => {
            if (!listeningRef.current) return
            setText((prev) => {
              const combined = prev ? prev + final : final
              return combined
            })
            setPartialText('')
          }
        )
      }
    } catch (err: any) {
      const msg = err?.message || ''
      if (/already recording/i.test(msg)) {
        listeningRef.current = true
        setIsListening(true)
      } else {
        setVoiceError(msg || '语音功能暂不可用')
        listeningRef.current = false
        setIsListening(false)
      }
    } finally {
      togglePendingRef.current = false
    }
  }, [isListening])

  useEffect(() => {
    if (isGenerating && isListening) {
      listeningRef.current = false
      voiceService.stopListening()
      setIsListening(false)
      setPartialText('')
    }
  }, [isGenerating, isListening])

  const canSend = (text.trim().length > 0 || partialText.length > 0) && !isGenerating

  // Combine text + partial for display
  const displayText = partialText
    ? text + (text ? ' ' : '') + partialText
    : text

  return (
    <div style={{ position: 'relative', padding: '8px', flexShrink: 0 }}>
      {/* Focus glow */}
      <motion.div
        className="absolute inset-x-4 inset-y-3 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-cyan-500/10 blur-xl"
        initial={false}
        animate={{ opacity: focused || isListening ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />

      {/* Voice error indicator */}
      <AnimatePresence>
        {voiceError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 12px',
              marginBottom: '4px',
              fontSize: '12px',
              color: 'rgba(239,68,68,0.9)',
            }}
          >
            <span>{voiceError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Listening indicator */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '4px 12px',
              marginBottom: '4px',
              fontSize: '12px',
              color: 'rgba(34,211,238,0.9)',
            }}
          >
            {/* Pulse dots */}
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#22d3ee',
                  display: 'inline-block',
                }}
              />
            ))}
            <span style={{ marginLeft: '4px' }}>正在听...</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderRadius: '16px',
          border: isListening
            ? '1.5px solid rgba(34,211,238,0.5)'
            : focused
              ? '1px solid rgba(255,255,255,0.25)'
              : '1px solid rgba(255,255,255,0.15)',
          backdropFilter: 'blur(20px)',
          padding: '8px 12px',
          transition: 'all 0.3s',
          background: isListening
            ? 'rgba(34,211,238,0.1)'
            : focused
              ? 'rgba(255,255,255,0.09)'
              : 'rgba(255,255,255,0.07)',
          boxShadow: isListening
            ? '0 0 20px rgba(34,211,238,0.15)'
            : 'none',
        }}
      >
        {/* Mic button */}
        {voiceAvailable && (
          <motion.button
            onClick={toggleVoice}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            style={{
              padding: '8px',
              borderRadius: '12px',
              border: isListening
                ? '1px solid rgba(34,211,238,0.3)'
                : '1px solid transparent',
              background: isListening
                ? 'rgba(34,211,238,0.15)'
                : 'transparent',
              color: isListening ? '#22d3ee' : 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            title={isListening ? '停止语音' : '语音输入'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </motion.button>
        )}

        {/* Fallback mic icon for non-Android (disabled) */}
        {!voiceAvailable && (
          <button
            style={{
              padding: '8px',
              borderRadius: '12px',
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.15)',
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            disabled
            title="语音输入不可用"
          >
            <Mic size={18} />
          </button>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={isListening ? displayText : text}
          onChange={(e) => {
            if (!isListening) setText(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={disabled ? (disabledHint ?? '请先配置模型') : isListening ? '正在识别语音...' : 'Ask ClawOS anything...'}
          readOnly={isListening || disabled}
          style={{
            flex: '1 1 0%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'rgba(255,255,255,0.92)',
            fontWeight: 300,
            fontSize: '14px',
          }}
          className="placeholder-white/35"
        />

        {/* Send / Abort button */}
        {isGenerating ? (
          <motion.button
            onClick={onAbort}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            style={{
              padding: '8px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: '#f87171',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            title="Stop"
          >
            <Square size={16} fill="currentColor" />
          </motion.button>
        ) : (
          <motion.button
            onClick={() => {
              if (isListening) {
                listeningRef.current = false
                voiceService.stopListening()
                setIsListening(false)
                const finalText = partialText
                  ? (text ? text + partialText : partialText)
                  : text
                setPartialText('')
                if (finalText.trim()) {
                  onSend(finalText.trim())
                  setText('')
                }
              } else {
                handleSend()
              }
            }}
            disabled={!canSend}
            whileHover={canSend ? { scale: 1.1 } : {}}
            whileTap={canSend ? { scale: 0.9 } : {}}
            style={{
              padding: '8px',
              borderRadius: '12px',
              border: canSend
                ? '1px solid rgba(34,211,238,0.2)'
                : '1px solid transparent',
              background: canSend
                ? 'rgba(34,211,238,0.15)'
                : 'rgba(255,255,255,0.04)',
              color: canSend ? '#22d3ee' : 'rgba(255,255,255,0.15)',
              cursor: canSend ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              boxShadow: canSend ? '0 4px 12px rgba(34,211,238,0.1)' : 'none',
            }}
            title="Send"
          >
            <Send size={16} />
          </motion.button>
        )}
      </div>
    </div>
  )
}
