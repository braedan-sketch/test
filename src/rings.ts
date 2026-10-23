import {
  AdditiveBlending,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  ShaderMaterial,
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
    { radius: 1.85, tube: 0.42, segments: 5, gap: 0.22, speed: 0.16 },
    { radius: 1.15, tube: 0.32, segments: 4, gap: 0.26, speed: -0.28 },
    { radius: 0.58, tube: 0.22, segments: 3, gap: 0.32, speed: 0.42 },
  ]

  const radial = quality.low ? 8 : 12
  const tubular = quality.low ? 20 : 32
  const bands: Array<{ group: Group; speed: number }> = []
  const root = new Group()

  for (const spec of specs) {
    const spinner = new Group()
    const flat = new Group()
    flat.rotation.x = Math.PI / 2
    spinner.add(flat)
    const arc = (Math.PI * 2) / spec.segments - spec.gap
    for (let i = 0; i < spec.segments; i += 1) {
      const geometry = new TorusGeometry(spec.radius, spec.tube, radial, tubular, Math.max(0.35, arc))
      const mesh = new Mesh(geometry, stone)
      mesh.rotation.z = (i * Math.PI * 2) / spec.segments
      flat.add(mesh)
    }
    root.add(spinner)
    bands.push({ group: spinner, speed: spec.speed })
  }

  const field = new Mesh(new CircleGeometry(2.45, 72), ringFieldMaterial())
  field.name = 'ring-field'
  field.rotation.x = -Math.PI / 2
  field.position.y = -0.42
  field.frustumCulled = false
  field.renderOrder = -1
  root.add(field)

  const coreMaterial = new MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
  })
  coreMaterial.color.setRGB(3.2, 3.4, 3.6)
  const core = new Mesh(new SphereGeometry(0.32, 28, 18), coreMaterial)
  core.position.y = 0.12
  root.add(core)

  const outer = new Mesh(new TorusGeometry(2.2, 0.11, 16, 96), glass)
  outer.rotation.x = Math.PI / 2
  outer.position.y = 0.08
  root.add(outer)

  const haloRing = new Mesh(
    new TorusGeometry(2.42, 0.07, 12, 96),
    new MeshBasicMaterial({
      color: '#f7fbff',
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  haloRing.rotation.x = Math.PI / 2
  haloRing.position.y = 0.08
  root.add(haloRing)

  const light = new PointLight('#ffffff', 6, 12, 1.2)
  root.add(light)

  let halo: Sprite | null = null
  if (quality.sprites) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(128, 128, 6, 128, 128, 122)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.28, 'rgba(236,244,255,0.7)')
      gradient.addColorStop(0.62, 'rgba(210,224,238,0.22)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 256, 256)
      const map = new CanvasTexture(canvas)
      map.colorSpace = SRGBColorSpace
      halo = new Sprite(
        new SpriteMaterial({
          map,
          transparent: true,
          opacity: 0.9,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      halo.scale.setScalar(2.8)
      halo.position.y = 0.16
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
      light.intensity = 10 + shown * 16
      if (halo) halo.material.opacity = 0.62 + shown * 0.34
    },
  }
}

function ringFieldMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float spokes = abs(sin(atan(vP.y, vP.x) * 10.0));
        float rings = abs(sin(r * 16.0));
        float line = 1.0 - smoothstep(0.02, 0.16, min(spokes, rings));
        float fade = 1.0 - smoothstep(1.35, 2.4, r);
        float glow = line * fade;
        if (glow < 0.2) discard;
        gl_FragColor = vec4(vec3(0.72, 0.86, 1.0), glow * 0.55);
      }
    `,
  })
}
