import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSceneStore } from '../store/scene.ts'

import gridFrag from './shaders/grid.frag?raw'

const gridVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export default function EnergyGrid() {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const meshRef = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 0.3 },
      uAccentColor: { value: new THREE.Vector3(0.22, 0.74, 0.97) },
    }),
    []
  )

  const smoothIntensity = useRef(0.3)
  const smoothColor = useRef(new THREE.Vector3(0.22, 0.74, 0.97))

  useFrame((_, delta) => {
    if (!materialRef.current || !meshRef.current) return

    const { particleIntensity, accentColor } = useSceneStore.getState()

    const lerpSpeed = 2.0 * delta
    smoothIntensity.current += (particleIntensity - smoothIntensity.current) * lerpSpeed
    smoothColor.current.lerp(
      new THREE.Vector3(accentColor[0], accentColor[1], accentColor[2]),
      lerpSpeed
    )

    const u = materialRef.current.uniforms
    u.uTime.value += delta
    u.uIntensity.value = smoothIntensity.current
    u.uAccentColor.value.copy(smoothColor.current)

    // Slow rotation
    meshRef.current.rotation.x += delta * 0.02
    meshRef.current.rotation.z += delta * 0.01
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -5]} rotation={[-Math.PI / 3, 0, 0]}>
      <planeGeometry args={[40, 40, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={gridVert}
        fragmentShader={gridFrag}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
