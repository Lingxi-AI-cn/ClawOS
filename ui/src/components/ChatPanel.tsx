import ChatArea from './ChatArea.tsx'
import InputBar from './InputBar.tsx'
import ModelSwitcher from './ModelSwitcher.tsx'
import { useModelConfigStore } from '../store/modelConfig.ts'

interface ChatPanelProps {
  onSend: (message: string) => void
  onAbort: () => void
}

export default function ChatPanel({ onSend, onAbort }: ChatPanelProps) {
  const isConfigured = useModelConfigStore((s) => s.isConfigured)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        maxWidth: '672px',
        margin: '0 auto',
        borderRadius: '16px',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, rgba(18,22,42,0.97) 0%, rgba(12,15,30,0.97) 100%)',
        border: '1px solid rgba(34,211,238,0.2)',
        boxShadow: '0 0 30px rgba(34,211,238,0.08), 0 4px 30px rgba(0,0,0,0.5)',
      }}
    >
      {/* Top accent line */}
      <div style={{ height: '2px', flexShrink: 0, background: 'linear-gradient(90deg, transparent 10%, rgba(34,211,238,0.4) 50%, transparent 90%)' }} />
      <ChatArea />
      {/* Subtle divider */}
      <div style={{ height: '1px', flexShrink: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }} />
      <ModelSwitcher />
      <InputBar
        onSend={onSend}
        onAbort={onAbort}
        disabled={!isConfigured}
        disabledHint="请先配置模型"
      />
    </div>
  )
}
