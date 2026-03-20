import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { useSceneStore } from '../store/scene.ts'
import { useConnectionStore } from '../store/connection.ts'

export default function AIBrain() {
  const sceneState = useSceneStore((s) => s.state)
  const status = useConnectionStore((s) => s.status)
  const active = status === 'connected'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const isResponding = sceneState === 'responding' || sceneState === 'toolCall'
  const isError = sceneState === 'error'

  // Colors for different states
  const glowColor = isError ? '255,60,60' : isResponding ? '168,85,247' : '34,211,238'
  const coreSize = isMobile ? 'w-16 h-16' : 'w-28 h-28 md:w-40 md:h-40'

  return (
    <div className={`relative flex items-center justify-center ${isMobile ? 'w-36 h-36' : 'w-64 h-64 md:w-96 md:h-96'}`}>
      {/* Outer Glow - using box-shadow instead of blur (WebView compatible) */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: '70%',
          height: '70%',
          boxShadow: `0 0 ${isMobile ? '40px' : '80px'} ${isMobile ? '20px' : '40px'} rgba(${glowColor}, 0.3)`,
        }}
        animate={{
          scale: [1, 1.15, 1],
          opacity: active ? [0.6, 1, 0.6] : [0.3, 0.5, 0.3],
        }}
        transition={{ duration: isResponding ? 2 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Rotating Ring 1 */}
      <motion.div
        className="absolute w-full h-full rounded-full"
        style={{ border: `1px solid rgba(${glowColor}, 0.4)` }}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      />

      {/* Rotating Ring 2 */}
      <motion.div
        className="absolute w-[80%] h-[80%] rounded-full"
        style={{ border: `1px dashed rgba(${isError ? '255,60,60' : '168,85,247'}, 0.35)` }}
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
      />

      {/* Inner Core - solid gradient with box-shadow glow (no blur/blend needed) */}
      <motion.div
        className={`absolute ${coreSize} rounded-full`}
        style={{
          background: isError
            ? 'radial-gradient(circle, rgba(255,100,100,0.5) 0%, rgba(200,50,50,0.2) 60%, transparent 100%)'
            : isResponding
              ? 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(34,211,238,0.2) 60%, transparent 100%)'
              : 'radial-gradient(circle, rgba(34,211,238,0.5) 0%, rgba(139,92,246,0.2) 60%, transparent 100%)',
          boxShadow: `0 0 ${isMobile ? '30px' : '60px'} rgba(${glowColor}, 0.4)`,
        }}
        animate={{ scale: active ? [1, 1.1, 1] : [0.95, 1, 0.95] }}
        transition={{ duration: isResponding ? 1 : 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Digital Particles */}
      {[...Array(isMobile ? 4 : 6)].map((_, i) => {
        const angle = isMobile ? i * 90 : i * 60
        const dist = isMobile ? 55 : 140
        return (
          <motion.div
            key={i}
            className={`absolute ${isMobile ? 'w-1 h-1' : 'w-2 h-2'} rounded-full`}
            style={{ top: '50%', left: '50%', backgroundColor: `rgba(${glowColor}, 0.8)` }}
            animate={{
              x: [0, Math.cos(angle * (Math.PI / 180)) * dist],
              y: [0, Math.sin(angle * (Math.PI / 180)) * dist],
              opacity: [1, 0],
              scale: [1, 0],
            }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.25, ease: 'easeOut' }}
          />
        )
      })}

      {/* Center Text/Logo */}
      <div className="relative z-10 text-center">
        <h1
          className={`${isMobile ? 'text-2xl' : 'text-4xl md:text-6xl'} font-bold text-white tracking-tighter`}
          style={{ textShadow: `0 0 20px rgba(${glowColor}, 0.6), 0 0 40px rgba(${glowColor}, 0.3)` }}
        >
          CLAW<span className="text-cyan-300">OS</span>
        </h1>
        <p className={`${isMobile ? 'text-[10px] mt-1' : 'text-xs md:text-sm mt-2'} tracking-[0.2em] uppercase ${
          isError ? 'text-red-300' : isResponding ? 'text-purple-200' : 'text-cyan-200'
        }`}>
          {isError ? 'Error' : !active ? (status === 'connecting' ? 'Connecting...' : 'Standby') : isResponding ? 'Processing' : 'System Online'}
        </p>
      </div>
    </div>
  )
}
