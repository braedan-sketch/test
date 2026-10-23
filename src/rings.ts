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
  Quaternion,
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

  const coreMaterial = new MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
  })
  coreMaterial.color.setRGB(3.2, 3.4, 3.6)
  const core = new Mesh(new SphereGeometry(0.28, 24, 16), coreMaterial)
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
      halo.scale.setScalar(2.6)
      halo.position.y = 0.2
      root.add(halo)
    }
  }

  const hero = await loadHero('/models/rings.glb')
  const rigs: RingRig[] = []
  if (hero) {
    for (const band of bands) band.group.visible = false
    core.position.y = 0.2
    core.scale.setScalar(1.45)
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
      const parentName = mesh.parent?.name ?? ''
      const outer = mesh.name.includes('outer') || parentName.includes('outer')
      mesh.material = createGlassMaterial({
        normalMap: normalMap ?? null,
        roughnessMap: roughnessMap ?? null,
        kind: 'rings',
        outer,
      })
    }
    fitHero(hero, 4.6)
    hero.position.y = 0.2
    root.add(hero)
    const field = new Mesh(new CircleGeometry(2.45, 72), ringFieldMaterial())
    field.name = 'ring-field'
    field.rotation.x = -Math.PI / 2
    field.position.y = -0.35
    field.frustumCulled = false
    field.renderOrder = -1
    root.add(field)
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
    balanceArcs(rigs)
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
      light.intensity = 8 + shown * 14
      if (halo) halo.material.opacity = 0.55 + shown * 0.4
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
        gl_FragColor = vec4(vec3(0.72, 0.86, 1.0), glow * 0.42);
      }
    `,
  })
}

function balanceArcs(rigs: RingRig[]) {
  const axis = new Vector3(0, 1, 0)
  const turn = new Quaternion()
  for (const rig of rigs) {
    if (rig.segments.length < 2) continue
    const ordered = [...rig.segments].sort(
      (a, b) => Math.atan2(a.base.z, a.base.x) - Math.atan2(b.base.z, b.base.x),
    )
    let radius = 0
    for (const segment of ordered) radius += Math.hypot(segment.base.x, segment.base.z)
    radius /= ordered.length
    const count = ordered.length
    for (let i = 0; i < count; i += 1) {
      const segment = ordered[i]
      if (!segment) continue
      const current = Math.atan2(segment.base.z, segment.base.x)
      const target = (i / count) * Math.PI * 2 - Math.PI / 2
      turn.setFromAxisAngle(axis, target - current)
      segment.object.quaternion.premultiply(turn)
      segment.base.set(Math.cos(target) * radius, segment.base.y, Math.sin(target) * radius)
      segment.dir.set(Math.cos(target), 0, Math.sin(target))
      segment.object.position.copy(segment.base)
    }
  }
}

type RingRig = {
  pivot: Object3D
  speed: number
  segments: Array<{ object: Object3D; base: Vector3; dir: Vector3 }>
}
