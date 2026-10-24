import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PMREMGenerator,
  PointLight,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { brand } from './brand'
import { loadHero } from './heroModel'
import type { LabelAnchor } from './igloo'
import type { Quality } from './quality'

const CENTER = new Vector3(0, 1.5, 0)

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

export async function createMeteor(quality: Quality, renderer: WebGLRenderer): Promise<Meteor> {
  const group = new Group()
  group.position.copy(CENTER)

  const light = new PointLight('#ffffff', 3.2, 9, 2)
  light.position.set(1.35, 2.15, 3.15)
  group.add(light)
  const facet = new PointLight('#ffffff', 0, 3.4, 2)
  facet.name = 'facet-key'
  facet.position.set(0.85, 1.72, 1.55)
  group.add(facet)

  const hero = await loadHero('/models/crystal.glb', renderer, { eager: true })
  if (!hero) throw new Error('crystal.glb missing')
  const envMap = studioRoom(renderer)
  hero.traverse((object) => {
    if (!(object instanceof Mesh)) return
    dressCrystal(object, envMap, quality.low)
  })
  hero.rotation.y = 0.55
  group.add(hero)
  const anchors = boxAnchors(hero)

  return {
    group,
    labelCount: anchors.length,
    update(reveal, time) {
      const shown = Math.max(0, Math.min(1, reveal))
      group.visible = shown > 0.02
      group.scale.setScalar(0.62 + shown * 0.38)
      hero.rotation.y = 0.55 + time * 0.22
      hero.rotation.z = Math.sin(time * 0.17) * 0.08
      light.intensity = 3.2 + shown * 4.5
      facet.intensity = shown * 6
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

function dressCrystal(mesh: Mesh, envMap: Texture, low: boolean) {
  const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  if (!(source instanceof MeshStandardMaterial)) return
  const cloud = mesh.name === 'crystal_core' || source.name === 'crystal_cloud'
  if (cloud) {
    // Alpha-tested and opaque so the transmission pass refracts the image cards.
    source.transparent = false
    source.opacity = 1
    source.alphaTest = 0.2
    source.depthWrite = true
    source.depthTest = true
    source.side = DoubleSide
    source.fog = false
    source.metalness = 0
    source.emissiveIntensity = Math.min(source.emissiveIntensity, 0.4)
    mesh.renderOrder = 0
    return
  }
  if (!(source instanceof MeshPhysicalMaterial)) return
  source.transmission = 1
  source.ior = 1.5
  source.thickness = 0.887
  source.attenuationColor.setRGB(0.78, 0.86, 0.92, LinearSRGBColorSpace)
  source.attenuationDistance = 1.67
  source.iridescence = 0.4
  source.iridescenceIOR = 1.4
  source.iridescenceThicknessRange = [220, 300]
  source.dispersion = low ? 0 : 0.04
  source.specularIntensity = 0.5
  if (!source.roughnessMap) source.roughness = Math.max(source.roughness, 0.06)
  source.envMap = envMap
  source.envMapIntensity = 0.18
  source.fog = false
  source.transparent = false
  if (source.thicknessMap) {
    source.thicknessMap.colorSpace = NoColorSpace
    source.thicknessMap.needsUpdate = true
  }
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 1
}

function studioRoom(renderer: WebGLRenderer) {
  const room = new RoomEnvironment()
  const strips: Array<[number, number, number, number, number, number, number]> = [
    [7.2, 15.5, 9.4, 0.45, 6.4, 0.35, 4],
    [-5.4, 19.2, 4.6, 9.5, 0.32, 0.28, 2],
    [1.4, 7.2, 13.6, 4.2, 0.4, 0.22, 5],
  ]
  for (const [x, y, z, sx, sy, sz, intensity] of strips) {
    const material = new MeshBasicMaterial({ toneMapped: false })
    material.color.setRGB(intensity, intensity, intensity)
    const strip = new Mesh(new BoxGeometry(sx, sy, sz), material)
    strip.position.set(x, y, z)
    room.add(strip)
  }
  const pmrem = new PMREMGenerator(renderer)
  const texture = pmrem.fromScene(room, 0.28).texture
  pmrem.dispose()
  room.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material.dispose()
  })
  return texture
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
