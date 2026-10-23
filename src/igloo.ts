import { Group, Mesh, MeshStandardMaterial, Vector3, type Object3D, type WebGLRenderer } from 'three'
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

/** Baked rim map. Bloom (threshold 0.8) turns this into the white-hot seam. */
const EMISSIVE_INTENSITY = 4

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
  onProgress(0.12)
  const loaded = await loadHero('/models/igloo.glb', renderer)
  if (!loaded) throw new Error('igloo.glb missing')
  onProgress(0.96)

  const group = loaded
  group.name = 'igloo'
  group.position.set(0, 0, 0)
  group.rotation.set(0, 0, 0)
  group.scale.set(1, 1, 1)

  const blocks: Block[] = []
  const seen = new Set<Object3D>()
  const lit = new Set<MeshStandardMaterial>()

  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = quality.shadows
    object.receiveShadow = quality.shadows
    object.frustumCulled = true
    for (const entry of materialsOf(object)) warmSeams(entry, lit)

    const node = blockCarrier(object)
    if (seen.has(node)) return
    seen.add(node)
    const extras = readExtras(node.userData)
    const base = node.position.clone()
    blocks.push({
      node,
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

  return {
    group,
    uniforms,
    labelCount: labels.length,
    update(burst, solid, dissolve, time) {
      uniforms.uBurst.value = burst
      uniforms.uSolid.value = solid
      uniforms.uDissolve.value = dissolve
      group.visible = dissolve < 0.985
      const open = burst * (1 - smoother(dissolve))
      for (const block of blocks) {
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

function materialsOf(mesh: Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function warmSeams(entry: Mesh['material'], lit: Set<MeshStandardMaterial>) {
  if (Array.isArray(entry) || !(entry instanceof MeshStandardMaterial) || lit.has(entry)) return
  lit.add(entry)
  entry.emissive.setRGB(1, 1, 1)
  entry.emissiveIntensity = EMISSIVE_INTENSITY
  entry.toneMapped = true
  entry.fog = true
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
  if (block.order < 0) return 0.55 + block.row * 0.15
  return 0.7 + block.row * 0.22
}

function blockDelay(block: Block) {
  if (block.order < 0) return 0.04 + block.row * 0.05
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
