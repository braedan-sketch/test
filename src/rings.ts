import {
  AdditiveBlending,
  CircleGeometry,
  type Blending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PointLight,
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
  dressPortal(root, quality)
  const core = new PointLight('#efece6', 0.35, 2.6, 2)
  core.position.set(0, 0, 0.2)
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
      core.intensity = 0.28 + open * 0.18
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

function dressPortal(root: Group, quality: Quality) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (object.name === 'halo') {
      object.material = fxMaterial(object.material, 5.2, new Color(1, 1, 1), AdditiveBlending, false)
      object.renderOrder = 5
      object.frustumCulled = false
      return
    }
    if (object.name === 'lattice') {
      // Soft and faint. The frosted disc in front of it is what should read.
      object.material = fxMaterial(object.material, 1, new Color(0.62, 0.68, 0.74), NormalBlending, true)
      const mat = object.material
      if (mat instanceof MeshBasicMaterial) mat.opacity = 0.18
      object.renderOrder = 1
      object.frustumCulled = false
      return
    }
    const material = object.material
    if (!(material instanceof MeshStandardMaterial)) return
    material.emissiveIntensity = 1.2
    material.metalness = 0
    material.envMapIntensity = 0.35
    material.fog = true
    material.toneMapped = true
    object.castShadow = quality.shadows
    object.receiveShadow = quality.shadows
  })
  root.add(frostDisc(quality.low))
}

function frostDisc(low: boolean) {
  const disc = new Mesh(
    new CircleGeometry(1.38, 72),
    low
      ? new MeshStandardMaterial({
          color: '#d5e2ee',
          roughness: 0.78,
          metalness: 0,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          side: DoubleSide,
          fog: true,
        })
      : new MeshPhysicalMaterial({
          color: '#d5dee6',
          roughness: 0.72,
          metalness: 0,
          transmission: 1,
          thickness: 0.16,
          ior: 1.45,
          attenuationColor: new Color('#d7e4f0'),
          attenuationDistance: 0.9,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          side: DoubleSide,
          fog: true,
          envMapIntensity: 0.16,
        }),
  )
  disc.name = 'frost-disc'
  disc.position.z = -0.12
  disc.renderOrder = 2
  disc.frustumCulled = false
  return disc
}

function fxMaterial(
  source: Material | Material[],
  gain: number,
  tint: Color,
  blending: Blending,
  toneMapped: boolean,
) {
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
    blending,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped,
    side: DoubleSide,
    fog: false,
  })
}

