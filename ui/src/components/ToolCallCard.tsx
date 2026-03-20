import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Wrench, ChevronDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ToolCall } from '../store/chat.ts'

interface ToolCallCardProps {
  toolCall: ToolCall
}

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusConfig = {
    running: {
      icon: <Loader2 size={12} className="animate-spin" />,
      color: 'text-yellow-400',
      bg: 'bg-yellow-400/8',
      border: 'border-yellow-400/20',
      glow: 'shadow-yellow-400/5',
      label: 'Running',
    },
    completed: {
      icon: <CheckCircle2 size={12} />,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/8',
      border: 'border-emerald-400/20',
      glow: 'shadow-emerald-400/5',
      label: 'Done',
    },
    error: {
      icon: <XCircle size={12} />,
      color: 'text-red-400',
      bg: 'bg-red-400/8',
      border: 'border-red-400/20',
      glow: 'shadow-red-400/5',
      label: 'Error',
    },
  }

  const config = statusConfig[toolCall.status]

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`rounded-xl border ${config.border} ${config.bg} backdrop-blur-sm overflow-hidden shadow-lg ${config.glow}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-all duration-200"
      >
        {/* Tool icon */}
        <div className={`p-1 rounded-md ${config.bg} ${config.color}`}>
          <Wrench size={10} />
        </div>

        {/* Tool name */}
        <span className="text-white/70 font-mono text-[11px] truncate flex-1 text-left">
          {toolCall.name}
        </span>

        {/* Status */}
        <span className={`flex items-center gap-1 ${config.color}`}>
          {config.icon}
          <span className="text-[10px] opacity-70">{config.label}</span>
        </span>

        {/* Expand arrow */}
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={12} className="text-white/30" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 space-y-2">
              {toolCall.input && (
                <div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-1">
                    Input
                  </div>
                  <pre className="text-[11px] text-white/50 bg-black/30 rounded-lg p-2.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap font-mono border border-white/5">
                    {toolCall.input}
                  </pre>
                </div>
              )}
              {toolCall.output && (
                <div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-1">
                    Output
                  </div>
                  <pre className="text-[11px] text-white/50 bg-black/30 rounded-lg p-2.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap font-mono border border-white/5">
                    {toolCall.output}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
