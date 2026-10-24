import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { loadHero } from './heroModel'
import { clamp, smoother } from './math'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (progress: number, shown: number) => void
}

type Piece = {
  node: Object3D
  base: Vector3
  dir: Vector3
  depth: number
  loose: boolean
  outer: boolean
}

/**
 * The Blender portal. Pieces keep their node translation, so scroll can
 * ease them apart along the ring and along their existing depth offset.
 */
export async function createRings(quality: Quality, renderer?: WebGLRenderer): Promise<Rings> {
  const asset = renderer ? await loadHero('/models/rings.glb', renderer) : null
  const root = asset ?? new Group()
  root.name = 'rings'
  // The portal is centred on its own origin and about 4.1 m across. Lift it
  // so the lower segments clear the snow mound.
  root.position.y = 2.25

  const pieces = collectPieces(root)
  dressPortal(root)
  const spill = quality.sprites ? addSpill(root) : []
  const core = new PointLight('#b7d0ff', 6, 8, 2)
  core.position.set(0, 0, 0.35)
  root.add(core)

  return {
    group: root,
    update(progress, shown) {
      root.visible = shown > 0.02
      const open = smoother(clamp(progress, 0, 1))
      for (const piece of pieces) {
        const reach = piece.loose ? 0.26 : piece.outer ? 0.09 : 0.16
        piece.node.position.copy(piece.base)
        piece.node.position.addScaledVector(piece.dir, open * reach)
        piece.node.position.z += piece.depth * open * 0.2
      }
      core.intensity = 7 + open * 4
      for (const sprite of spill) sprite.material.opacity = (sprite.userData.baseOpacity as number) + open * 0.06
    },
  }
}

function collectPieces(root: Group) {
  const pieces: Piece[] = []
  root.traverse((object) => {
    const extras = object.userData as { group?: unknown; a0?: unknown; a1?: unknown; arc?: unknown }
    if (extras.group !== 'ring_outer' && extras.group !== 'ring_inner') return
    const a0 = Number(extras.a0)
    const a1 = Number(extras.a1)
    if (!Number.isFinite(a0) || !Number.isFinite(a1)) return
    const mid = (a0 + a1) * 0.5
    pieces.push({
      node: object,
      base: object.position.clone(),
      dir: new Vector3(Math.cos(mid), Math.sin(mid), 0),
      depth: object.position.z,
      loose: Number(extras.arc) === 9,
      outer: extras.group === 'ring_outer',
    })
  })
  return pieces
}

function dressPortal(root: Group) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (object.name === 'halo') {
      object.material = fxMaterial(object.material, 5.4, new Color(0.45, 0.68, 1))
      object.renderOrder = 3
      object.frustumCulled = false
      return
    }
    if (object.name === 'lattice') {
      object.material = fxMaterial(object.material, 1.35, new Color(0.72, 0.86, 1))
      object.renderOrder = 2
      object.frustumCulled = false
      return
    }
    const material = object.material
    if (!(material instanceof MeshStandardMaterial)) return
    material.emissiveIntensity = 1.15
    material.metalness = 0
    material.envMapIntensity = 0.4
    material.fog = true
    material.toneMapped = true
  })
}

function fxMaterial(source: Material | Material[], gain: number, tint: Color) {
  const entry = Array.isArray(source) ? source[0] : source
  const map =
    entry instanceof MeshStandardMaterial ? (entry.map ?? entry.emissiveMap) : entry instanceof MeshBasicMaterial ? entry.map : null
  if (map) {
    map.colorSpace = SRGBColorSpace
    map.needsUpdate = true
  }
  const color = tint.clone().multiplyScalar(gain)
  return new MeshBasicMaterial({
    map: map ?? undefined,
    color,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
    fog: false,
  })
}

function addSpill(root: Group) {
  const specs = [
    {
      stops: [
        [0, 'rgba(190,220,255,0.15)'],
        [0.22, 'rgba(150,196,255,0.95)'],
        [0.46, 'rgba(110,168,245,0.55)'],
        [0.72, 'rgba(80,140,220,0.22)'],
        [1, 'rgba(70,120,200,0)'],
      ] as Array<[number, string]>,
      scale: 6.2,
      opacity: 0.95,
      color: new Color().setRGB(0.55, 0.82, 1.7),
      z: 0.36,
    },
    {
      stops: [
        [0, 'rgba(170,205,255,0.0)'],
        [0.3, 'rgba(130,180,245,0.7)'],
        [0.62, 'rgba(90,150,230,0.28)'],
        [1, 'rgba(70,120,210,0)'],
      ] as Array<[number, string]>,
      scale: 12.5,
      opacity: 0.72,
      color: new Color().setRGB(0.4, 0.62, 1.35),
      z: 0.2,
    },
  ]
  const sprites: Sprite[] = []
  for (const spec of specs) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 126)
    for (const [offset, color] of spec.stops) gradient.addColorStop(offset, color)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 256, 256)
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    const sprite = new Sprite(
      new SpriteMaterial({
        map,
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    )
    sprite.userData.baseOpacity = spec.opacity
    sprite.scale.set(spec.scale, spec.scale, 1)
    sprite.position.set(0, 0, spec.z)
    sprite.renderOrder = 1
    root.add(sprite)
    sprites.push(sprite)
  }
  return sprites
}
