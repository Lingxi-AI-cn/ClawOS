import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSceneStore } from '../store/scene.ts'

const BEAM_COUNT = 8
const BEAM_SEGMENTS = 20

export default function ToolCallBeam() {
  const groupRef = useRef<THREE.Group>(null)
  const smoothActivity = useRef(0)
  const beamPhases = useRef<number[]>(
    Array.from({ length: BEAM_COUNT }, () => Math.random() * Math.PI * 2)
  )

  const beams = useMemo(() => {
    return Array.from({ length: BEAM_COUNT }, () => {
      const points = new Float32Array(BEAM_SEGMENTS * 3)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
      const material = new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      })
      return { geometry, material }
    })
  }, [])

  // Create THREE.Line objects imperatively
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const lines: THREE.Line[] = []
    beams.forEach(({ geometry, material }) => {
      const line = new THREE.Line(geometry, material)
      group.add(line)
      lines.push(line)
    })

    return () => {
      lines.forEach((line) => {
        group.remove(line)
      })
    }
  }, [beams])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const { state, accentColor, toolCallCount } = useSceneStore.getState()
    const isActive = state === 'toolCall'
    const targetActivity = isActive ? Math.min(toolCallCount, BEAM_COUNT) / BEAM_COUNT : 0
    smoothActivity.current += (targetActivity - smoothActivity.current) * 3.0 * delta

    if (smoothActivity.current < 0.01) {
      // Hide all beams when inactive
      group.children.forEach((child) => {
        if (child instanceof THREE.Line) {
          (child.material as THREE.LineBasicMaterial).opacity = 0
        }
      })
      return
    }

    const time = performance.now() * 0.001
    const color = new THREE.Color(accentColor[0], accentColor[1], accentColor[2])

    group.children.forEach((child, i) => {
      if (!(child instanceof THREE.Line)) return
      const geometry = child.geometry
      const posArr = geometry.attributes.position.array as Float32Array
      const phase = beamPhases.current[i]
      const beamActivity = smoothActivity.current * (i < toolCallCount ? 1 : 0.2)

      const angle = (i / BEAM_COUNT) * Math.PI * 2 + time * 0.3
      const dirX = Math.cos(angle + phase)
      const dirZ = Math.sin(angle + phase)
      const dirY = Math.sin(phase + time * 0.5) * 0.3

      for (let j = 0; j < BEAM_SEGMENTS; j++) {
        const t = j / (BEAM_SEGMENTS - 1)
        const r = t * 10 * beamActivity
        const wave = Math.sin(t * 4 + time * 3 + phase) * 0.2 * beamActivity
        posArr[j * 3] = dirX * r + wave
        posArr[j * 3 + 1] = dirY * r + wave * 0.5
        posArr[j * 3 + 2] = dirZ * r + wave
      }
      geometry.attributes.position.needsUpdate = true

      const mat = child.material as THREE.LineBasicMaterial
      mat.color.copy(color)
      mat.opacity = smoothActivity.current * 0.4
    })
  })

  return <group ref={groupRef} />
}
