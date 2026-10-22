import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  CanvasTexture,
  SRGBColorSpace,
} from 'three'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (spin: number, shown: number) => void
}

export function createRings(quality: Quality): Rings {
  const material = new MeshPhysicalMaterial({
    color: new Color('#c5d0da'),
    roughness: 0.42,
    metalness: 0,
    transmission: quality.blockTransmission ? 0.28 : 0,
    thickness: quality.blockTransmission ? 0.45 : 0,
    ior: 1.31,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.7,
    emissive: new Color('#f7fbff'),
    emissiveIntensity: 0.18,
  })

  const specs = [
    { radius: 1.82, tube: 0.3, segments: 5, gap: 0.26, speed: 0.9 },
    { radius: 1.18, tube: 0.24, segments: 4, gap: 0.32, speed: -1.35 },
    { radius: 0.64, tube: 0.18, segments: 3, gap: 0.38, speed: 1.8 },
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
      const mesh = new Mesh(geometry, material)
      mesh.rotation.z = (i * Math.PI * 2) / spec.segments
      flat.add(mesh)
    }
    root.add(spinner)
    bands.push({ group: spinner, speed: spec.speed })
  }

  const core = new Mesh(
    new SphereGeometry(0.28, 24, 16),
    new MeshBasicMaterial({
      color: '#ffffff',
      toneMapped: false,
    }),
  )
  root.add(core)

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
      halo.scale.setScalar(3.4)
      root.add(halo)
    }
  }

  return {
    group: root,
    update(spin, shown) {
      const visible = shown > 0.02
      root.visible = visible
      root.scale.setScalar(0.92 + shown * 0.08)
      for (const band of bands) {
        band.group.rotation.y = spin * Math.PI * 2 * band.speed
      }
      light.intensity = 4 + shown * 7
      if (halo) halo.material.opacity = 0.45 + shown * 0.5
    },
  }
}
