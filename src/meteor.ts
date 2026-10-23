import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { brand } from './brand'
import { hash01 } from './math'
import { createGlassMaterial } from './glass'
import { fitHero, loadHero } from './heroModel'
import type { LabelAnchor } from './igloo'
import type { Quality } from './quality'

const CENTER = new Vector3(0, 1.25, 0)

const METEOR_OFFSETS: Array<[number, number]> = [
  [-168, -24],
  [156, 18],
  [-46, 96],
  [132, -88],
]

export const meteorCenter = CENTER

export type Meteor = {
  group: Group
  update: (reveal: number, time: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
}

function buildDotField() {
  const mesh = new Mesh(
    new PlaneGeometry(42, 56),
    new ShaderMaterial({
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vec2 cell = abs(fract(vUv * vec2(36.0, 48.0)) - 0.5);
          float dot = 1.0 - smoothstep(0.07, 0.13, length(cell));
          if (dot < 0.25) discard;
          gl_FragColor = vec4(vec3(0.22, 0.24, 0.27), dot * 0.9);
        }
      `,
      transparent: true,
    }),
  )
  mesh.position.set(0, 0.2, -7.5)
  return mesh
}

function buildStreaks() {
  const positions: number[] = []
  for (let i = 0; i < 22; i += 1) {
    const x = (hash01(i * 1.7) - 0.5) * 7.5
    const y = (hash01(i * 2.9) - 0.35) * 6.2
    const z = (hash01(i * 4.1) - 0.5) * 3.4
    const len = 0.35 + hash01(i * 5.3) * 1.35
    const dx = (hash01(i * 6.7) - 0.15) * len
    const dy = (hash01(i * 8.1) - 0.55) * len
    positions.push(x, y, z, x + dx, y + dy, z + (hash01(i * 9.4) - 0.5) * 0.25)
  }
  return new LineSegments(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
    new LineBasicMaterial({
      color: '#8e98a1',
      transparent: true,
      opacity: 0.55,
      fog: false,
      toneMapped: false,
    }),
  )
}

function fbm(x: number, y: number, z: number) {
  const n = Math.sin(x * 1.7 + y * 2.3 + z * 1.1) * 0.5
  const m = Math.sin(x * 3.1 - y * 1.8 + z * 2.7 + 4.2) * 0.3
  const k = Math.sin(x * 5.4 + y * 4.1 - z * 3.3) * 0.2
  return n + m + k
}

function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  return map
}

export async function createMeteor(quality: Quality): Promise<Meteor> {
  const geometry = new IcosahedronGeometry(1, quality.low ? 2 : 3)
  const position = geometry.attributes.position
  if (!position) throw new Error('Crystal is missing positions')
  const vertex = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).normalize()
    const n = fbm(vertex.x * 2.1, vertex.y * 1.8, vertex.z * 2.4)
    const chip = Math.abs(fbm(vertex.x * 4.2 + 1.2, vertex.y * 3.6, vertex.z * 3.1))
    const radius = 0.84 + n * 0.2 + chip * chip * 0.42
    vertex.multiplyScalar(radius)
    vertex.x *= 0.86
    vertex.y *= 1.24
    vertex.z *= 0.74
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  geometry.computeVertexNormals()
  geometry.scale(1.08, 1.08, 1.08)

  const crystal = new Mesh(
    geometry,
    new MeshPhysicalMaterial({
      color: new Color('#1a2228'),
      roughness: 0.58,
      metalness: 0,
      transmission: quality.crystalTransmission ? 0.55 : 0,
      thickness: quality.crystalTransmission ? 1.6 : 0,
      ior: 1.5,
      iridescence: quality.low ? 0 : 1,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [180, 520],
      dispersion: quality.low ? 0 : 0.12,
      attenuationColor: new Color('#0c1216'),
      attenuationDistance: 0.65,
      clearcoat: 0.15,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.85,
      flatShading: true,
      transparent: !quality.crystalTransmission,
      opacity: quality.crystalTransmission ? 1 : 0.94,
      emissive: new Color('#101820'),
      emissiveIntensity: 0.06,
    }),
  )

  const group = new Group()
  group.position.copy(CENTER)
  group.add(crystal, buildDotField(), buildStreaks())

  const core = new Mesh(
    new SphereGeometry(0.05, 16, 12),
    new MeshBasicMaterial({
      color: '#fffaf6',
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  group.add(core)

  const map = quality.sprites ? glowTexture() : null
  let sprite: Sprite | null = null
  if (map) {
    const material = new SpriteMaterial({
      map,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    sprite = new Sprite(material)
    sprite.scale.setScalar(1.35)
    group.add(sprite)
  }

  const light = new PointLight('#fff6f0', 4.2, 8, 1.5)
  group.add(light)

  let anchors = pickAnchors(position)
  const hero = await loadHero('/models/crystal.glb')
  if (hero) {
    crystal.visible = false
    core.visible = false
    if (sprite) sprite.visible = false
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const maps = source as { normalMap?: Texture | null; roughnessMap?: Texture | null }
      const normalMap = maps.normalMap ?? null
      const roughnessMap = maps.roughnessMap ?? null
      chipShard(mesh.geometry)
      mesh.material = createGlassMaterial({
        normalMap: normalMap ?? null,
        roughnessMap: roughnessMap ?? null,
        kind: 'crystal',
      })
    })
    fitHero(hero, 2.15)
    hero.rotation.y = 0.55
    group.add(hero)
    anchors = boxAnchors(hero)
  }

  return {
    group,
    labelCount: anchors.length,
    update(reveal, time) {
      const shown = Math.max(0, Math.min(1, reveal))
      group.visible = shown > 0.02
      group.scale.setScalar(0.62 + shown * 0.38)
      if (hero) {
        hero.rotation.y = 0.55 + time * 0.22
        hero.rotation.z = Math.sin(time * 0.17) * 0.08
      }
      light.intensity = 1.4 + shown * 2.4
      if (sprite && sprite.visible) sprite.material.opacity = 0.16 + shown * 0.2
    },
    fillLabels(target) {
      group.updateWorldMatrix(true, true)
      for (let i = 0; i < anchors.length; i += 1) {
        const anchor = anchors[i]
        const slot = target[i]
        if (!anchor || !slot) continue
        slot.position.copy(anchor).applyMatrix4(group.matrixWorld)
        slot.text = brand.meteorHud[i] ?? 'MASS'
        slot.bent = true
        slot.offsetX = METEOR_OFFSETS[i]?.[0] ?? 80
        slot.offsetY = METEOR_OFFSETS[i]?.[1] ?? -20
      }
    },
  }
}

function cellHash(ix: number, iy: number, iz: number) {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453
  return n - Math.floor(n)
}

// Break the clean prism into a chunky shard. Cells move together so each chip stays planar.
function chipShard(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const ix = Math.floor(x * 7.5)
    const iy = Math.floor(y * 6.2)
    const iz = Math.floor(z * 7.5)
    const h = cellHash(ix, iy, iz)
    const h2 = cellHash(ix + 5, iy + 13, iz + 2)
    const h3 = cellHash(iy + 1, iz + 7, ix + 9)
    const bite = h > 0.82 ? 0.1 + (h - 0.82) * 0.45 : (h - 0.5) * 0.09
    const nx = normal.getX(i)
    const ny = normal.getY(i)
    const nz = normal.getZ(i)
    position.setXYZ(
      i,
      x + nx * bite + (h2 - 0.5) * 0.03,
      y + ny * bite + (h3 - 0.5) * 0.025,
      z + nz * bite + (h2 - h3) * 0.02,
    )
  }
  position.needsUpdate = true
}

function boxAnchors(root: Group) {
  const box = new Box3().setFromObject(root)
  const center = box.getCenter(new Vector3())
  return [
    new Vector3(box.max.x, center.y, center.z),
    new Vector3(center.x, box.min.y, center.z),
    new Vector3(center.x, center.y, box.max.z),
    new Vector3(box.max.x, box.max.y, box.max.z),
  ]
}

function pickAnchors(position: {
  count: number
  getX: (index: number) => number
  getY: (index: number) => number
  getZ: (index: number) => number
}) {
  let maxX = -Infinity
  let minY = Infinity
  let maxZ = -Infinity
  let maxR = -Infinity
  const picks = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  const cursor = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    cursor.set(position.getX(i), position.getY(i), position.getZ(i))
    const slot0 = picks[0]
    const slot1 = picks[1]
    const slot2 = picks[2]
    const slot3 = picks[3]
    if (slot0 && cursor.x > maxX) {
      maxX = cursor.x
      slot0.copy(cursor)
    }
    if (slot1 && cursor.y < minY) {
      minY = cursor.y
      slot1.copy(cursor)
    }
    if (slot2 && cursor.z > maxZ) {
      maxZ = cursor.z
      slot2.copy(cursor)
    }
    if (slot3 && cursor.lengthSq() > maxR) {
      maxR = cursor.lengthSq()
      slot3.copy(cursor)
    }
  }
  return picks
}
