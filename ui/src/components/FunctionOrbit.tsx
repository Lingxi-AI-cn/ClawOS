import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { ArrowUpCircle, LayoutGrid, Package, MessageSquare } from 'lucide-react'

interface FunctionOrbitProps {
  onUpdateClick: () => void
  onAppsClick: () => void
  onSkillClick: () => void
  onIMClick: () => void
}

export default function FunctionOrbit({
  onUpdateClick,
  onAppsClick,
  onSkillClick,
  onIMClick
}: FunctionOrbitProps) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const radius = isMobile ? 100 : 120
  const iconSize = isMobile ? 36 : 42

  const getPosition = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    return {
      x: Math.cos(rad) * radius,
      y: Math.sin(rad) * radius
    }
  }

  const icons = [
    { angle: 160, Icon: MessageSquare, onClick: onIMClick, label: 'IM 通道', color: '#10b981' },
    { angle: 200, Icon: Package, onClick: onSkillClick, label: 'Skill 市场', color: '#f59e0b' },
    { angle: 340, Icon: ArrowUpCircle, onClick: onUpdateClick, label: '在线升级', color: '#3b82f6' },
    { angle: 20, Icon: LayoutGrid, onClick: onAppsClick, label: '应用抽屉', color: '#8b5cf6' }
  ]

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 2
    }}>
      {icons.map(({ angle, Icon, onClick, label, color }) => {
        const pos = getPosition(angle)
        return (
          <motion.button
            key={angle}
            onClick={onClick}
            initial={{ x: pos.x, y: pos.y }}
            animate={{ x: pos.x, y: pos.y }}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: iconSize,
              height: iconSize,
              marginLeft: -iconSize / 2,
              marginTop: -iconSize / 2,
              borderRadius: '50%',
              border: 'none',
              background: `linear-gradient(135deg, ${color}40, ${color}20)`,
              backdropFilter: 'blur(10px)',
              color: color,
              cursor: 'pointer',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 12px ${color}40`
            }}
            aria-label={label}
          >
            <Icon size={iconSize * 0.55} strokeWidth={2.5} />
          </motion.button>
        )
      })}
    </div>
  )
}
