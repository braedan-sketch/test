import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Vector3,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { brand } from './brand'
import { loadHero } from './heroModel'
import type { BlockUniforms } from './ice'
import { clamp, smoother } from './math'
import type { Quality } from './quality'

const LABEL_OFFSETS: Array<[number, number]> = [
  [-14, -12],
  [13, -14],
  [15, 6],
  [-16, 8],
  [12, 14],
  [-13, 2],
]

/** v11 bakes the seam light. Faces are darkened in the shader, not here. */
const EMISSIVE_INTENSITY = 3.4

export type LabelAnchor = {
  position: Vector3
  text: string
  offsetX: number
  offsetY: number
  bent: boolean
  constellation?: boolean
}

export type Igloo = {
  group: Group
  uniforms: BlockUniforms
  update: (burst: number, solid: number, dissolve: number, time: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
  readout: (burst: number, solid: number) => string
}

type Block = {
  node: Object3D
  mesh: Mesh
  wire: LineSegments
  kind: string
  row: number
  order: number
  base: Vector3
  dir: Vector3
  phase: number
}

/**
 * Loads /models/igloo.glb. A later igloo keeps the same node structure
 * (one mesh per block, extras row/t/kind/bidx), so nothing here is counted
 * or named beyond what the file itself contains.
 */
export async function loadIgloo(
  quality: Quality,
  renderer: WebGLRenderer,
  onProgress: (value: number) => void,
): Promise<Igloo> {
  onProgress(0.08)
  const loaded = await loadHero('/models/igloo.glb', renderer, {
    eager: true,
    onProgress: (value) => onProgress(0.08 + value * 0.84),
  })
  if (!loaded) throw new Error('igloo.glb missing')
  onProgress(0.94)

  const group = loaded
  group.name = 'igloo'
  group.position.set(0, 0, 0)
  group.rotation.set(0, 0, 0)
  group.scale.set(1, 1, 1)

  const blocks: Block[] = []
  const seen = new Set<Object3D>()
  const shared = new Map<string, MeshStandardMaterial>()
  const solidUniforms: Array<{ value: number }> = []
  const wireMaterial = new LineBasicMaterial({
    color: '#24303a',
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })

  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = false
    object.receiveShadow = false
    object.frustumCulled = true
    const node = blockCarrier(object)
    const extras = readExtras(node.userData)
    object.material = dressSnow(object.material, shared, solidUniforms)

    if (seen.has(node)) return
    seen.add(node)
    const wire = new LineSegments(slabEdges(object.geometry), wireMaterial)
    wire.name = 'igloo-wire'
    wire.renderOrder = 3
    wire.frustumCulled = false
    object.add(wire)
    const base = node.position.clone()
    blocks.push({
      node,
      mesh: object,
      wire,
      kind: extras.kind,
      row: extras.row,
      order: extras.order,
      base,
      dir: separationDir(base),
      phase: extras.bidx * 0.37,
    })
  })

  if (blocks.length === 0) throw new Error('igloo.glb has no blocks')

  const labels = pickLabels(blocks)
  const tags = labels.map((_, index) => brand.hud[index] ?? 'BLK')
  const uniforms: BlockUniforms = {
    uBurst: { value: 0 },
    uSolid: { value: 0 },
    uDissolve: { value: 0 },
    uCenter: { value: new Vector3() },
  }
  const worldPoint = new Vector3()
  const gapLight = new PointLight('#f3f6fb', 0, 4.6, 2)
  gapLight.position.set(0, 0.9, 0)
  group.add(gapLight)
  const snowMaterials = [...shared.values()]

  return {
    group,
    uniforms,
    labelCount: labels.length,
    update(burst, solid, dissolve, time) {
      uniforms.uBurst.value = burst
      uniforms.uSolid.value = solid
      uniforms.uDissolve.value = dissolve
      for (const slot of solidUniforms) slot.value = solid
      group.visible = dissolve < 0.985
      const present = smoother(clamp(solid * 1.15, 0, 1)) * (1 - smoother(dissolve))
      gapLight.intensity = present * 2.4
      // Stops 00–01 stay wire. The solid writes nothing and casts nothing, so it
      // cannot leave a black disc in the snow under the dome.
      const fade = smoother(clamp((solid - 0.04) / 0.26, 0, 1))
      const opaque = fade > 0.97
      const shadow = quality.shadows && fade > 0.6
      for (const material of snowMaterials) {
        material.opacity = fade
        material.transparent = !opaque
        material.colorWrite = fade > 0.02
        material.depthWrite = fade > 0.55
      }
      wireMaterial.opacity = 1 - smoother(clamp((solid - 0.1) / 0.38, 0, 1))
      const showWire = wireMaterial.opacity > 0.02
      const open = burst * (1 - smoother(dissolve))
      for (const block of blocks) {
        block.mesh.castShadow = shadow
        block.mesh.receiveShadow = shadow
        block.wire.visible = showWire
        const travel = blockTravel(block, open)
        const bob = Math.sin(time * 0.55 + block.phase) * 0.012 * travel
        block.node.position.copy(block.base)
        block.node.position.addScaledVector(block.dir, travel * blockReach(block))
        block.node.position.y += bob
      }
    },
    fillLabels(target) {
      group.updateWorldMatrix(true, true)
      for (let i = 0; i < labels.length; i += 1) {
        const block = labels[i]
        const slot = target[i]
        if (!block || !slot) continue
        block.node.getWorldPosition(worldPoint)
        slot.position.copy(worldPoint)
        slot.text = tags[i] ?? ''
        slot.bent = false
        slot.constellation = true
        slot.offsetX = LABEL_OFFSETS[i]?.[0] ?? 12
        slot.offsetY = LABEL_OFFSETS[i]?.[1] ?? -10
      }
    },
    readout(burst, solid) {
      if (solid < 0.08) return 'WIRE'
      if (burst < 0.02) return 'ICE'
      if (burst > 0.97) return 'OPEN'
      return 'BURST'
    },
  }
}

export function makeLabelSlots(count: number): LabelAnchor[] {
  return Array.from({ length: count }, (_, index) => ({
    position: new Vector3(),
    text: brand.hud[index] ?? '',
    offsetX: LABEL_OFFSETS[index]?.[0] ?? 40,
    offsetY: LABEL_OFFSETS[index]?.[1] ?? -30,
    bent: false,
  }))
}

function dressSnow(
  material: Mesh['material'],
  shared: Map<string, MeshStandardMaterial>,
  solidUniforms: Array<{ value: number }>,
) {
  const source = Array.isArray(material) ? material[0] : material
  if (!(source instanceof MeshStandardMaterial)) return material
  const existing = shared.get('snow')
  if (existing) return existing
  const entry = source.clone()
  // The v10 multiply of 0.85 still left the faces brighter than the seams.
  // Diffuse is scaled down in the shader. Emissive is left for the gaps.
  entry.color.multiplyScalar(0.62)
  entry.emissive.setRGB(1, 1, 1)
  entry.emissiveIntensity = EMISSIVE_INTENSITY
  entry.metalness = 0
  entry.envMapIntensity = 0.08
  entry.toneMapped = true
  entry.fog = true
  // Hidden until the solid fade. A visible mesh here casts the black disc
  // under the dome on the first frame after the loader.
  entry.transparent = true
  entry.opacity = 0
  entry.colorWrite = false
  entry.depthWrite = false
  const uniforms = { uSolid: { value: 0 } }
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    shader.uniforms.uSolid = uniforms.uSolid
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSolid;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 0.62;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float seam = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
        totalEmissiveRadiance *= mix(0.2, 2.6, smoothstep(0.18, 0.62, seam));
        totalEmissiveRadiance *= smoothstep(0.15, 0.7, uSolid);`,
      )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-igloo-v11`
  solidUniforms.push(uniforms.uSolid)
  shared.set('snow', entry)
  return entry
}

/**
 * Twelve edges of the brick's own oriented box. Node rotation is identity;
 * the dome orientation is in the vertices, so a world-axis box reads as scaffolding.
 */
function slabEdges(geometry: BufferGeometry) {
  const attr = geometry.getAttribute('position')
  const geo = new BufferGeometry()
  if (!attr || attr.count < 8) return geo
  const count = attr.count
  const step = Math.max(1, Math.floor(count / 480))
  let sx = 0
  let sy = 0
  let sz = 0
  let n = 0
  for (let i = 0; i < count; i += step) {
    sx += attr.getX(i)
    sy += attr.getY(i)
    sz += attr.getZ(i)
    n += 1
  }
  const mx = sx / n
  const my = sy / n
  const mz = sz / n
  let cxx = 0
  let cyy = 0
  let czz = 0
  let cxy = 0
  let cxz = 0
  let cyz = 0
  for (let i = 0; i < count; i += step) {
    const x = attr.getX(i) - mx
    const y = attr.getY(i) - my
    const z = attr.getZ(i) - mz
    cxx += x * x
    cyy += y * y
    czz += z * z
    cxy += x * y
    cxz += x * z
    cyz += y * z
  }
  const axes = jacobiAxes([
    [cxx, cxy, cxz],
    [cxy, cyy, cyz],
    [cxz, cyz, czz],
  ])
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i += step) {
    const x = attr.getX(i) - mx
    const y = attr.getY(i) - my
    const z = attr.getZ(i) - mz
    for (let axis = 0; axis < 3; axis += 1) {
      const basis = axes[axis]
      if (!basis) continue
      const projected = x * basis[0] + y * basis[1] + z * basis[2]
      if (projected < min[axis]) min[axis] = projected
      if (projected > max[axis]) max[axis] = projected
    }
  }
  const corners: number[][] = []
  for (let ix = 0; ix < 2; ix += 1) {
    for (let iy = 0; iy < 2; iy += 1) {
      for (let iz = 0; iz < 2; iz += 1) {
        const px = ix ? max[0] : min[0]
        const py = iy ? max[1] : min[1]
        const pz = iz ? max[2] : min[2]
        const ax = axes[0]
        const ay = axes[1]
        const az = axes[2]
        if (!ax || !ay || !az) continue
        corners.push([
          mx + ax[0] * px + ay[0] * py + az[0] * pz,
          my + ax[1] * px + ay[1] * py + az[1] * pz,
          mz + ax[2] * px + ay[2] * py + az[2] * pz,
        ])
      }
    }
  }
  const pairs = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]
  const positions: number[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    const a = corners[pairs[i] ?? 0]
    const b = corners[pairs[i + 1] ?? 0]
    if (!a || !b) continue
    positions.push(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0)
  }
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geo
}

/** Eigenvectors of a symmetric 3×3, one axis per row. */
function jacobiAxes(matrix: number[][]) {
  const a = matrix.map((row) => [...row])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 14; sweep += 1) {
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p]?.[q] ?? 0
        if (Math.abs(apq) < 1e-12) continue
        const app = a[p]?.[p] ?? 0
        const aqq = a[q]?.[q] ?? 0
        const tau = (aqq - app) / (2 * apq)
        const sign = tau >= 0 ? 1 : -1
        const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c
        if (a[p]) a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq
        if (a[q]) a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq
        if (a[p]) a[p][q] = 0
        if (a[q]) a[q][p] = 0
        for (let k = 0; k < 3; k += 1) {
          if (k === p || k === q) continue
          const akp = a[k]?.[p] ?? 0
          const akq = a[k]?.[q] ?? 0
          const rowP = c * akp - s * akq
          const rowQ = s * akp + c * akq
          if (a[k]) {
            a[k][p] = rowP
            a[k][q] = rowQ
          }
          if (a[p]) a[p][k] = rowP
          if (a[q]) a[q][k] = rowQ
        }
        for (let k = 0; k < 3; k += 1) {
          const vip = v[k]?.[p] ?? 0
          const viq = v[k]?.[q] ?? 0
          if (!v[k]) continue
          v[k][p] = c * vip - s * viq
          v[k][q] = s * vip + c * viq
        }
      }
    }
  }
  return [0, 1, 2].map((axis) => {
    const dir = [v[0]?.[axis] ?? 0, v[1]?.[axis] ?? 0, v[2]?.[axis] ?? 0]
    const len = Math.hypot(dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? 0) || 1
    return dir.map((value) => (value ?? 0) / len)
  })
}

function blockCarrier(mesh: Mesh) {
  if (readKind(mesh.userData)) return mesh
  const parent = mesh.parent
  if (parent && readKind(parent.userData)) return parent
  return mesh
}

function readKind(userData: object) {
  const kind = (userData as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : ''
}

function readExtras(userData: object) {
  const data = userData as { row?: unknown; t?: unknown; kind?: unknown; bidx?: unknown }
  const row = Number(data.row)
  const order = Number(data.t)
  const bidx = Number(data.bidx)
  return {
    kind: typeof data.kind === 'string' ? data.kind : 'brick',
    row: Number.isFinite(row) ? row : 0,
    order: Number.isFinite(order) ? order : 0,
    bidx: Number.isFinite(bidx) ? bidx : 0,
  }
}

/** dir = normalize(position - (0, y * 0.3, 0)). Upper courses lead the drift. */
function separationDir(base: Vector3) {
  const dir = new Vector3(base.x, base.y - base.y * 0.3, base.z)
  if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0)
  else dir.normalize()
  return dir
}

function blockReach(block: Block) {
  return 0.55 + block.row * 0.18
}

function blockDelay(block: Block) {
  return (1 - clamp(block.order, 0, 1)) * 0.28
}

function blockTravel(block: Block, burst: number) {
  const delay = blockDelay(block)
  const span = Math.max(0.001, 1 - delay)
  return smoother(clamp((burst - delay) / span, 0, 1))
}

function pickLabels(blocks: Block[]) {
  const front = blocks.filter((block) => block.kind === 'brick' || block.kind === 'key')
  front.sort((a, b) => b.base.z - a.base.z || a.base.x - b.base.x)
  const facing = front.slice(0, Math.min(12, front.length))
  facing.sort((a, b) => a.base.x - b.base.x)
  const chosen: Block[] = []
  const count = Math.min(brand.hud.length, facing.length)
  for (let i = 0; i < count; i += 1) {
    const index =
      count <= 1 ? 0 : Math.round((i * (facing.length - 1)) / Math.max(1, count - 1))
    const piece = facing[index]
    if (piece && !chosen.includes(piece)) chosen.push(piece)
  }
  return chosen
}
