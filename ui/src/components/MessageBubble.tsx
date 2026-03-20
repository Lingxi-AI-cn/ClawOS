import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Bot, User, Sparkles, Volume2, Square } from 'lucide-react'
import type { ChatMessage } from '../store/chat.ts'
import { renderMarkdown } from '../lib/markdown.ts'
import ToolCallCard from './ToolCallCard.tsx'
import { voiceService } from '../voice/index.ts'
import { isAndroid } from '../gateway/bridge.ts'

interface MessageBubbleProps {
  message: ChatMessage
  index: number
}

/*
 * Chat bubble with inline styles for Android AOSP 12 WebView compatibility.
 * Tailwind backdrop-blur and gradient-with-opacity don't render reliably
 * in Capacitor WebView, so we use solid rgba() backgrounds instead.
 */

// User (cyan) theme colors
const USER = {
  bubbleBg: 'rgba(8, 145, 178, 0.35)',       // strong cyan tint
  bubbleBorder: 'rgba(34, 211, 238, 0.5)',    // visible cyan border
  textColor: '#a5f3fc',                        // cyan-200: clearly cyan
  labelColor: 'rgba(34, 211, 238, 0.7)',       // cyan-400/70
  avatarBg: 'rgba(8, 145, 178, 0.3)',
  avatarBorder: 'rgba(34, 211, 238, 0.4)',
}

// AI (purple) theme colors
const AI = {
  bubbleBg: 'rgba(107, 33, 168, 0.35)',       // strong purple tint
  bubbleBorder: 'rgba(168, 85, 247, 0.5)',     // visible purple border
  textColor: '#e9d5ff',                         // purple-200: clearly purple
  labelColor: 'rgba(168, 85, 247, 0.7)',        // purple-400/70
  avatarBg: 'rgba(107, 33, 168, 0.3)',
  avatarBorder: 'rgba(168, 85, 247, 0.4)',
}

/**
 * Strip LLM thinking/reasoning blocks (<think>...</think>) from display text.
 * For streaming messages with unclosed <think>, shows a thinking indicator.
 * For final messages, only strips complete blocks.
 */
function stripThinking(text: string, isStreaming?: boolean): string {
  // Remove complete <think>...</think> blocks (multiline, lazy match)
  let result = text.replace(/<think[\s>][\s\S]*?<\/think>/gi, '')

  // During streaming: if there's still an unclosed <think> tag, hide it
  if (isStreaming && /<think[\s>]/i.test(result)) {
    result = result.replace(/<think[\s>][\s\S]*$/gi, '')
    if (!result.trim()) {
      return '*AI 正在思考...*'
    }
  }

  return result.trimStart()
}

export default function MessageBubble({ message, index }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false)
  const [ttsAvailable, setTtsAvailable] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const theme = isUser ? USER : AI

  // Check TTS availability once
  useEffect(() => {
    if (isAndroid && !isUser && !isSystem) {
      voiceService.checkAvailability().then((a) => setTtsAvailable(a.tts))
    }
  }, [isUser, isSystem])

  const handleSpeak = async () => {
    if (isSpeaking) {
      await voiceService.stopSpeaking()
      setIsSpeaking(false)
      return
    }
    // Strip thinking blocks, markdown, and HTML to get plain text
    const plainText = stripThinking(message.content)
      .replace(/[#*_~`>\[\]()!|]/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!plainText) return

    setIsSpeaking(true)
    await voiceService.speak(plainText, () => {
      setIsSpeaking(false)
    })
  }

  // System message - centered pill
  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}
      >
        <div style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.5)',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '9999px',
          padding: '6px 20px',
          border: '1px solid rgba(255,255,255,0.15)',
        }}>
          {message.content}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, x: isUser ? 30 : -30 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 24,
        delay: Math.min(index * 0.03, 0.3),
      }}
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: '10px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.1 }}
        style={{
          flexShrink: 0,
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.avatarBg,
          border: `1.5px solid ${theme.avatarBorder}`,
        }}
      >
        {isUser ? (
          <User size={14} style={{ color: '#22d3ee' }} />
        ) : (
          <Bot size={14} style={{ color: '#a855f7' }} />
        )}
      </motion.div>

      {/* Bubble */}
      <div style={{ maxWidth: '80%', position: 'relative' }}>
        {/* Streaming glow pulse */}
        {message.isStreaming && (
          <div style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '16px',
            background: isUser ? 'rgba(34,211,238,0.15)' : 'rgba(168,85,247,0.15)',
            filter: 'blur(12px)',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
        )}

        <div style={{
          position: 'relative',
          borderRadius: isUser ? '16px 16px 6px 16px' : '16px 16px 16px 6px',
          padding: '12px 16px',
          background: theme.bubbleBg,
          border: `1.5px solid ${theme.bubbleBorder}`,
          boxShadow: `0 2px 12px ${isUser ? 'rgba(34,211,238,0.1)' : 'rgba(168,85,247,0.1)'}`,
        }}>
          {/* Role indicator */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '6px',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
          }}>
            {isUser ? (
              <>
                <span style={{ fontSize: '10px', fontWeight: 500, color: theme.labelColor, textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                  You
                </span>
                <User size={11} style={{ color: theme.labelColor }} />
              </>
            ) : (
              <>
                <Sparkles size={11} style={{ color: theme.labelColor }} />
                <span style={{ fontSize: '10px', fontWeight: 500, color: theme.labelColor, textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                  ClawOS
                </span>
              </>
            )}
          </div>

          {/* Message content */}
          <div
            className="chat-content"
            style={{
              fontSize: '14px',
              lineHeight: 1.6,
              wordBreak: 'break-word',
              color: theme.textColor,
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(stripThinking(message.content, message.isStreaming)) }}
          />

          {/* Streaming cursor */}
          {message.isStreaming && (
            <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '4px', verticalAlign: 'middle' }}>
              <span style={{
                width: '3px',
                height: '16px',
                background: 'rgba(168,85,247,0.8)',
                borderRadius: '2px',
                animation: 'pulse 1s ease-in-out infinite',
              }} />
            </span>
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {message.toolCalls.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Timestamp + TTS button - visible on hover, or always visible when speaking */}
          <motion.div
            initial={false}
            animate={{ opacity: (hovered || isSpeaking) ? 1 : 0, height: (hovered || isSpeaking) ? 'auto' : 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: isUser ? 'flex-end' : 'space-between',
              gap: '8px',
              fontSize: '10px',
              marginTop: '6px',
              color: theme.labelColor,
            }}
          >
            <span>
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            {/* TTS read-aloud / stop button (AI messages only) */}
            {ttsAvailable && !isUser && !message.isStreaming && (
              <button
                onClick={handleSpeak}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isSpeaking ? '4px 10px' : '2px 6px',
                  borderRadius: isSpeaking ? '8px' : '6px',
                  border: isSpeaking
                    ? '1.5px solid rgba(239, 68, 68, 0.5)'
                    : '1px solid rgba(168,85,247,0.3)',
                  background: isSpeaking
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(168,85,247,0.1)',
                  color: isSpeaking ? '#fca5a5' : 'rgba(168,85,247,0.7)',
                  fontSize: isSpeaking ? '11px' : '10px',
                  fontWeight: isSpeaking ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  animation: isSpeaking ? 'tts-stop-pulse 2s ease-in-out infinite' : 'none',
                }}
                title={isSpeaking ? '停止朗读' : '朗读'}
              >
                {isSpeaking ? <Square size={10} fill="currentColor" /> : <Volume2 size={10} />}
                <span>{isSpeaking ? '停止朗读' : '朗读'}</span>
              </button>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
