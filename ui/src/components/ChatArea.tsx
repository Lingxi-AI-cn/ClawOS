import { useRef, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useChatStore } from '../store/chat.ts'
import MessageBubble from './MessageBubble.tsx'

export default function ChatArea() {
  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages / streaming updates
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Always scroll to bottom when content changes
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messages, isGenerating])

  if (messages.length === 0) {
    return (
      <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ textAlign: 'center' }}
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              width: '48px',
              height: '48px',
              margin: '0 auto 16px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(34,211,238,0.3))',
              border: '1px solid rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={20} style={{ color: 'rgba(168,85,247,0.6)' }} />
          </motion.div>
          <p style={{ color: '#6b7280', fontSize: '14px', letterSpacing: '1px', fontWeight: 300, marginBottom: '16px' }}>
            Ask ClawOS anything...
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            {['AI Chat', 'File Ops', 'System'].map((tag, i) => (
              <motion.span
                key={tag}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.15 }}
                style={{
                  fontSize: '10px',
                  color: 'rgba(255,255,255,0.4)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '9999px',
                  padding: '4px 12px',
                }}
              >
                {tag}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 8px',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <AnimatePresence mode="popLayout">
          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id} message={msg} index={idx} />
          ))}
        </AnimatePresence>

        {/* Thinking indicator */}
        {isGenerating && !messages.some((m) => m.isStreaming) && (
          <motion.div
            initial={{ opacity: 0, y: 15, x: -20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}
          >
            {/* Avatar */}
            <div style={{
              flexShrink: 0,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(107,33,168,0.3)',
              border: '1.5px solid rgba(168,85,247,0.4)',
            }}>
              <Sparkles size={14} style={{ color: '#a855f7', animation: 'spin 3s linear infinite' }} />
            </div>

            {/* Thinking bubble */}
            <div style={{
              position: 'relative',
              background: 'rgba(107,33,168,0.35)',
              border: '1.5px solid rgba(168,85,247,0.5)',
              borderRadius: '16px 16px 16px 6px',
              padding: '14px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '10px', fontWeight: 500, color: 'rgba(168,85,247,0.5)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                  Thinking
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#a855f7',
                      }}
                      animate={{
                        y: [0, -6, 0],
                        opacity: [0.4, 1, 0.4],
                      }}
                      transition={{
                        duration: 0.8,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
