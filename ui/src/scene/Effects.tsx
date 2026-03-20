import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { useSceneStore } from '../store/scene.ts'

export default function Effects() {
  const intensity = useSceneStore((s) => s.particleIntensity)

  try {
    return (
      <EffectComposer multisampling={0}>
        <Bloom
          intensity={0.15 + intensity * 0.2}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.3} darkness={0.85} />
      </EffectComposer>
    )
  } catch {
    return null
  }
}
