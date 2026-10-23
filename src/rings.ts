import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  ShaderMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  CanvasTexture,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { createGlassMaterial } from './glass'
import { fitHero, loadHero } from './heroModel'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (spin: number, shown: number) => void
}

export async function createRings(quality: Quality): Promise<Rings> {
  const material = new MeshPhysicalMaterial({
    color: new Color('#c5d5e2'),
    roughness: 0.08,
    metalness: 0,
    transmission: quality.blockTransmission ? 0.62 : 0,
    thickness: quality.blockTransmission ? 1.4 : 0,
    ior: 1.45,
    attenuationColor: new Color('#c5d8ea'),
    attenuationDistance: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.35,
    emissive: new Color('#e7f3fa'),
    emissiveIntensity: quality.blockTransmission ? 0.22 : 0.45,
  })

  const specs = [
    { radius: 1.85, tube: 0.58, segments: 5, gap: 0.2, speed: 0.55 },
    { radius: 1.15, tube: 0.42, segments: 4, gap: 0.24, speed: -0.85 },
    { radius: 0.58, tube: 0.3, segments: 3, gap: 0.3, speed: 1.15 },
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
      halo.scale.setScalar(1.15)
      halo.position.y = 0.2
      root.add(halo)
    }
  }

  const hero = await loadHero('/models/rings.glb')
  const rigs: RingRig[] = []
  if (hero) {
    for (const band of bands) band.group.visible = false
    core.visible = false
    const ringMeshes: Mesh[] = []
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh) ringMeshes.push(mesh)
    })
    for (const mesh of ringMeshes) {
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const maps = source as { normalMap?: Texture | null; roughnessMap?: Texture | null }
      const normalMap = maps.normalMap ?? null
      const roughnessMap = maps.roughnessMap ?? null
      mesh.material = createGlassMaterial({
        normalMap: normalMap ?? null,
        roughnessMap: roughnessMap ?? null,
        kind: 'rings',
      })
    }
    fitHero(hero, 4.6)
    hero.position.y = 0.2
    root.add(hero)
    const field = new Mesh(new CircleGeometry(6.4, 72), ringFieldMaterial())
    field.name = 'ring-field'
    field.rotation.x = -Math.PI / 2
    field.position.y = -0.45
    field.frustumCulled = false
    field.renderOrder = -1
    root.add(field)
    const heart = new Mesh(
      new SphereGeometry(0.16, 24, 16),
      new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    )
    heart.position.y = 0.2
    root.add(heart)
    const specs = [
      { name: 'ring_outer', speed: 0.18 },
      { name: 'ring_mid', speed: -0.34 },
      { name: 'ring_inner', speed: 0.62 },
    ]
    for (const spec of specs) {
      const pivot = hero.getObjectByName(spec.name)
      if (!pivot) continue
      rigs.push({
        pivot,
        speed: spec.speed,
        segments: pivot.children.map((child) => {
          const dir = child.position.clone()
          dir.y = 0
          if (dir.lengthSq() > 1e-4) dir.normalize()
          return { object: child, base: child.position.clone(), dir }
        }),
      })
    }
  }

  return {
    group: root,
    update(spin, shown) {
      const visible = shown > 0.02
      root.visible = visible
      root.scale.setScalar(0.92 + shown * 0.08)
      const gap = 0.035 + shown * 0.045
      for (const rig of rigs) {
        rig.pivot.rotation.y = spin * Math.PI * 2 * rig.speed
        for (const segment of rig.segments) {
          segment.object.position.copy(segment.base)
          if (segment.dir.lengthSq() > 0.5) segment.object.position.addScaledVector(segment.dir, gap)
        }
      }
      for (const band of bands) {
        band.group.rotation.y = spin * Math.PI * 2 * band.speed
      }
      light.intensity = 2.2 + shown * 3.2
      if (halo) halo.material.opacity = 0.22 + shown * 0.28
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
        vec2 g = abs(fract(vP * 1.35) - 0.5);
        float line = 1.0 - smoothstep(0.02, 0.055, min(g.x, g.y));
        float fade = 1.0 - smoothstep(3.2, 6.1, length(vP));
        float glow = line * fade;
        if (glow < 0.25) discard;
        gl_FragColor = vec4(vec3(0.62, 0.8, 0.95), glow * 0.55);
      }
    `,
  })
}

type RingRig = {
  pivot: Object3D
  speed: number
  segments: Array<{ object: Object3D; base: Vector3; dir: Vector3 }>
}
