import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  type WebGLRenderer,
} from 'three'
import { createGlassMaterial } from './glass'
import { loadHero } from './heroModel'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (spin: number, shown: number) => void
}

/**
 * Two worn stone courses. A later Blender file at /models/rings_courses.glb
 * replaces them; the old rings.glb jumble stays unused.
 */
export async function createRings(quality: Quality, renderer?: WebGLRenderer): Promise<Rings> {
  const asset = renderer ? await loadHero('/models/rings_courses.glb', renderer) : null
  if (asset) {
    asset.name = 'rings'
    return {
      group: asset,
      update(spin, shown) {
        asset.visible = shown > 0.02
        asset.rotation.y = spin * 0.2
      },
    }
  }

  const stone = createGlassMaterial({ normalMap: null, roughnessMap: null, kind: 'rings' })
  const specs = [
    { radius: 1.72, tube: 0.48, segments: 3, gap: 0.34, speed: 0.1 },
    { radius: 0.96, tube: 0.36, segments: 2, gap: 0.55, speed: -0.16 },
  ]
  const radial = quality.low ? 10 : 16
  const tubular = quality.low ? 28 : 48
  const bands: Array<{ group: Group; speed: number }> = []
  const root = new Group()
  root.name = 'rings'
  root.position.y = 0.62

  for (const spec of specs) {
    const spinner = new Group()
    const flat = new Group()
    flat.rotation.x = Math.PI / 2
    spinner.add(flat)
    const arc = (Math.PI * 2) / spec.segments - spec.gap
    for (let i = 0; i < spec.segments; i += 1) {
      const geometry = new TorusGeometry(spec.radius, spec.tube, radial, tubular, Math.max(0.5, arc))
      const mesh = new Mesh(geometry, stone)
      mesh.rotation.z = (i * Math.PI * 2) / spec.segments + spec.gap * 0.5
      flat.add(mesh)
    }
    root.add(spinner)
    bands.push({ group: spinner, speed: spec.speed })
  }

  const coreMaterial = new MeshBasicMaterial({ color: '#fff6ea', toneMapped: false })
  coreMaterial.color.setRGB(3.4, 3.15, 2.7)
  const core = new Mesh(new SphereGeometry(0.34, 28, 18), coreMaterial)
  core.position.y = 0.08
  root.add(core)

  const frostMat = new MeshBasicMaterial({
    color: '#f4f8ff',
    transparent: true,
    opacity: 0.28,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
  const frost = new Mesh(new TorusGeometry(2.05, 0.62, 20, 72), frostMat)
  frost.rotation.x = Math.PI / 2
  frost.position.y = 0.04
  root.add(frost)

  const light = new PointLight('#fff4e6', 6, 14, 1.4)
  light.position.y = 0.2
  root.add(light)

  let halo: Sprite | null = null
  if (quality.sprites) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 124)
      gradient.addColorStop(0, 'rgba(255,250,242,0.95)')
      gradient.addColorStop(0.22, 'rgba(244,248,255,0.55)')
      gradient.addColorStop(0.5, 'rgba(214,226,238,0.16)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 256, 256)
      const map = new CanvasTexture(canvas)
      map.colorSpace = SRGBColorSpace
      halo = new Sprite(
        new SpriteMaterial({
          map,
          transparent: true,
          opacity: 0.85,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      halo.scale.set(6.4, 3.2, 1)
      halo.position.y = 0.12
      root.add(halo)
    }
  }

  return {
    group: root,
    update(spin, shown) {
      root.visible = shown > 0.02
      root.scale.setScalar(0.94 + shown * 0.06)
      for (const band of bands) band.group.rotation.y = spin * Math.PI * 2 * band.speed
      light.intensity = 8 + shown * 14
      frostMat.opacity = 0.16 + shown * 0.18
      if (halo) halo.material.opacity = 0.45 + shown * 0.4
    },
  }
}
