import { Suspense, Component, type ReactNode } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import ParticleCloud from './ParticleCloud.tsx'
import EnergyGrid from './EnergyGrid.tsx'
import ToolCallBeam from './ToolCallBeam.tsx'
import Effects from './Effects.tsx'
import { isAndroid } from '../gateway/bridge.ts'

// Error boundary for 3D components that may fail (e.g. shader compilation)
class SceneErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[NexusScene] 3D component error:', error.message)
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}

/** Mobile devices get reduced 3D quality for performance */
export const isMobileScene = isAndroid || window.innerWidth < 768

export default function NexusScene() {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 12]} fov={60} />
      <color attach="background" args={['#020617']} />
      <fog attach="fog" args={['#020617', 18, 40]} />

      <ambientLight intensity={0.15} />
      <pointLight position={[0, 0, 5]} intensity={0.3} color="#38bdf8" />

      <Suspense fallback={null}>
        <SceneErrorBoundary>
          <ParticleCloud />
        </SceneErrorBoundary>

        {/* Skip EnergyGrid on mobile for performance */}
        {!isMobileScene && (
          <SceneErrorBoundary>
            <EnergyGrid />
          </SceneErrorBoundary>
        )}

        <SceneErrorBoundary>
          <ToolCallBeam />
        </SceneErrorBoundary>

        {/* Skip post-processing effects on mobile */}
        {!isMobileScene && (
          <SceneErrorBoundary>
            <Effects />
          </SceneErrorBoundary>
        )}
      </Suspense>
    </>
  )
}
