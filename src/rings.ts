import {
  AdditiveBlending,
  type Blending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
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
  const asset = renderer ? await loadHero('/models/rings.glb', renderer, { eager: true }) : null
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
      // v5 already bakes a hot core and blue flares. A large gain turns the halo white.
      object.material = fxMaterial(object.material, 1.25, new Color(0.92, 0.96, 1), AdditiveBlending, false)
      object.renderOrder = 5
      object.frustumCulled = false
      return
    }
    if (object.name === 'lattice') {
      object.material = latticeDisc(object.material)
      object.renderOrder = 2
      object.frustumCulled = false
      return
    }
    const material = object.material
    if (!(material instanceof MeshStandardMaterial)) return
    material.emissiveIntensity = 0.55
    material.metalness = 0
    material.envMapIntensity = 0.2
    material.normalScale.set(0.22, 0.22)
    material.fog = true
    material.toneMapped = true
    object.castShadow = quality.shadows
    object.receiveShadow = quality.shadows
  })
}

/** v5's lattice is a milky bake. Draw it unlit so the frost is not lost in the stone lighting. */
function latticeDisc(source: Material | Material[]) {
  const entry = Array.isArray(source) ? source[0] : source
  const map =
    entry instanceof MeshStandardMaterial ? (entry.map ?? entry.emissiveMap) : entry instanceof MeshBasicMaterial ? entry.map : null
  if (map) {
    map.colorSpace = SRGBColorSpace
    map.needsUpdate = true
  }
  const material = new MeshBasicMaterial({
    map: map ?? undefined,
    color: '#e7eef3',
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    toneMapped: true,
  })
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       diffuseColor.a = clamp(diffuseColor.a * 1.2 + 0.08, 0.0, 0.88);`,
    )
  }
  material.customProgramCacheKey = () => 'lattice-disc-v5'
  return material
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

