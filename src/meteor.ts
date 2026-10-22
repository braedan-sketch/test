import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { brand } from './brand'
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
  update: (reveal: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
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

export function createMeteor(quality: Quality): Meteor {
  const geometry = new IcosahedronGeometry(1, quality.low ? 3 : 4)
  const position = geometry.attributes.position
  if (!position) throw new Error('Crystal is missing positions')
  const vertex = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).normalize()
    const n = fbm(vertex.x * 1.4, vertex.y * 1.2, vertex.z * 1.5)
    const spike = Math.abs(fbm(vertex.x * 2.4 + 2.2, vertex.y * 2.2, vertex.z * 1.8)) ** 3
    const radius = 1.05 + n * 0.48 + spike * 1.15
    vertex.multiplyScalar(radius)
    vertex.x *= 1.38
    vertex.y *= 0.78
    vertex.z *= 1.12
    if (vertex.x > 0.15) vertex.x += spike * 0.55
    if (vertex.z < -0.2) vertex.z -= spike * 0.25
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  geometry.computeVertexNormals()
  geometry.scale(1.15, 1.15, 1.15)

  const crystal = new Mesh(
    geometry,
    new MeshPhysicalMaterial({
      color: new Color('#e4eef4'),
      roughness: quality.crystalTransmission ? 0.05 : 0.12,
      metalness: 0,
      transmission: quality.crystalTransmission ? 0.96 : 0,
      thickness: quality.crystalTransmission ? 2.3 : 0,
      ior: 1.46,
      dispersion: quality.low ? 0 : 0.16,
      attenuationColor: new Color('#d5e4f0'),
      attenuationDistance: 1.7,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: quality.crystalTransmission ? 1.25 : 1.45,
      transparent: !quality.crystalTransmission,
      opacity: quality.crystalTransmission ? 1 : 0.88,
    }),
  )

  const group = new Group()
  group.position.copy(CENTER)
  group.add(crystal)

  const core = new Mesh(
    new SphereGeometry(0.22, 24, 16),
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
    sprite.scale.setScalar(1.8)
    group.add(sprite)
  }

  const light = new PointLight('#fff4ea', 2.4, 7, 1.6)
  group.add(light)

  const anchors = pickAnchors(position)

  return {
    group,
    labelCount: anchors.length,
    update(reveal) {
      const shown = Math.max(0, Math.min(1, reveal))
      group.visible = shown > 0.02
      group.scale.setScalar(0.62 + shown * 0.38)
      light.intensity = 1.2 + shown * 3.4
      if (sprite) sprite.material.opacity = 0.25 + shown * 0.45
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
