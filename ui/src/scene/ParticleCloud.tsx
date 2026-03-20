import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSceneStore } from '../store/scene.ts'
import { isMobileScene } from './NexusScene.tsx'

import particlesVert from './shaders/particles.vert?raw'
import particlesFrag from './shaders/particles.frag?raw'

// Reduced particle count on mobile for performance
const PARTICLE_COUNT = isMobileScene ? 500 : 3000

const STATE_MAP: Record<string, number> = {
  idle: 0,
  thinking: 1,
  toolCall: 2,
  responding: 3,
  error: 4,
}

export default function ParticleCloud() {
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Smooth transitions
  const smoothState = useRef(0)
  const smoothIntensity = useRef(0.3)
  const smoothColor = useRef(new THREE.Vector3(0.22, 0.74, 0.97))

  const { positions, sizes, phases, velocities } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const sizes = new Float32Array(PARTICLE_COUNT)
    const phases = new Float32Array(PARTICLE_COUNT)
    const velocities = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Spherical distribution
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.random() * 8 + 2

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)

      sizes[i] = Math.random() * 2.5 + 0.8
      phases[i] = Math.random()

      velocities[i * 3] = (Math.random() - 0.5) * 0.5
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.5
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5
    }

    return { positions, sizes, phases, velocities }
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 0.3 },
      uAccentColor: { value: new THREE.Vector3(0.22, 0.74, 0.97) },
      uState: { value: 0 },
    }),
    []
  )

  useFrame((_, delta) => {
    if (!materialRef.current) return

    const { state, particleIntensity, accentColor } = useSceneStore.getState()

    // Smooth interpolation
    const lerpSpeed = 2.0 * delta
    const targetState = STATE_MAP[state] ?? 0
    smoothState.current += (targetState - smoothState.current) * lerpSpeed
    smoothIntensity.current += (particleIntensity - smoothIntensity.current) * lerpSpeed
    smoothColor.current.lerp(
      new THREE.Vector3(accentColor[0], accentColor[1], accentColor[2]),
      lerpSpeed
    )

    const u = materialRef.current.uniforms
    u.uTime.value += delta
    u.uState.value = smoothState.current
    u.uIntensity.value = smoothIntensity.current
    u.uAccentColor.value.copy(smoothColor.current)
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-aSize"
          args={[sizes, 1]}
        />
        <bufferAttribute
          attach="attributes-aPhase"
          args={[phases, 1]}
        />
        <bufferAttribute
          attach="attributes-aVelocity"
          args={[velocities, 3]}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particlesVert}
        fragmentShader={particlesFrag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
