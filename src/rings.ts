import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  CanvasTexture,
  SRGBColorSpace,
} from 'three'
import { createGlassMaterial } from './glass'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (spin: number, shown: number) => void
}

export async function createRings(quality: Quality): Promise<Rings> {
  const stone = createGlassMaterial({ normalMap: null, roughnessMap: null, kind: 'rings' })
  const glass = createGlassMaterial({ normalMap: null, roughnessMap: null, kind: 'rings', outer: true })

  const specs = [
    { radius: 1.72, tube: 0.16, segments: 8, gap: 0.16, speed: 0.16 },
    { radius: 1.08, tube: 0.12, segments: 6, gap: 0.2, speed: -0.28 },
  ]

  const radial = quality.low ? 6 : 10
  const tubular = quality.low ? 18 : 28
  const bands: Array<{ group: Group; speed: number }> = []
  const root = new Group()

  for (const spec of specs) {
    const spinner = new Group()
    const flat = new Group()
    flat.rotation.x = Math.PI / 2
    spinner.add(flat)
    const arc = (Math.PI * 2) / spec.segments - spec.gap
    for (let i = 0; i < spec.segments; i += 1) {
      const geometry = new TorusGeometry(spec.radius, spec.tube, radial, tubular, Math.max(0.2, arc))
      const mesh = new Mesh(geometry, stone)
      mesh.rotation.z = (i * Math.PI * 2) / spec.segments
      flat.add(mesh)
    }
    root.add(spinner)
    bands.push({ group: spinner, speed: spec.speed })
  }

  const coreMaterial = new MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
  })
  coreMaterial.color.setRGB(2.1, 2.2, 2.3)
  const core = new Mesh(new SphereGeometry(0.22, 24, 16), coreMaterial)
  root.add(core)

  const outer = new Mesh(new TorusGeometry(2.15, 0.07, 16, 96), glass)
  outer.rotation.x = Math.PI / 2
  root.add(outer)
  const haloRing = new Mesh(
    new TorusGeometry(2.28, 0.035, 12, 96),
    new MeshBasicMaterial({
      color: '#f7fbff',
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  haloRing.rotation.x = Math.PI / 2
  root.add(haloRing)

  const light = new PointLight('#ffffff', 6, 10, 1.2)
  root.add(light)

  let halo: Sprite | null = null
  if (quality.sprites) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 120)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)')
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
      halo.scale.setScalar(1.05)
      halo.position.y = 0.2
      root.add(halo)
    }
  }

  core.position.y = 0.05
  outer.position.y = 0.05
  haloRing.position.y = 0.05

  return {
    group: root,
    update(spin, shown) {
      const visible = shown > 0.02
      root.visible = visible
      root.scale.setScalar(0.92 + shown * 0.08)
      for (const band of bands) {
        band.group.rotation.y = spin * Math.PI * 2 * band.speed
      }
      light.intensity = 8 + shown * 14
      if (halo) halo.material.opacity = 0.55 + shown * 0.4
    },
  }
}
