import { Group, Mesh, MeshStandardMaterial, PointLight, Vector3, type Object3D, type WebGLRenderer } from 'three'
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

/** Cool gap light. Faces stay the baked grey; bloom stays under the cap. */
const EMISSIVE_INTENSITY = 2

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

  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = quality.shadows
    object.receiveShadow = quality.shadows
    object.frustumCulled = true
    const node = blockCarrier(object)
    const extras = readExtras(node.userData)
    object.material = dressSnow(object.material, shared, solidUniforms)

    if (seen.has(node)) return
    seen.add(node)
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
  const gapLight = new PointLight('#d5e4f4', 0, 4.8, 2)
  gapLight.position.set(0, 0.9, 0)
  group.add(gapLight)

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
      gapLight.intensity = present * 5
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
  entry.emissive.setRGB(0.86, 0.93, 1)
  entry.emissiveIntensity = EMISSIVE_INTENSITY
  entry.metalness = 0
  entry.envMapIntensity = 0.1
  entry.toneMapped = true
  entry.fog = true
  const uniforms = { uSolid: { value: 1 } }
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    shader.uniforms.uSolid = uniforms.uSolid
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSnowWorld;
        varying vec3 vSnowNormal;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vSnowNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSnowWorld = (modelMatrix * vec4(position, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSnowWorld;
        varying vec3 vSnowNormal;
        uniform float uSolid;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= vec3(0.82, 0.91, 1.0) * smoothstep(0.25, 0.8, uSolid);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float draw = smoothstep(0.04, 0.82, uSolid);
        vec3 nrm = normalize(vSnowNormal);
        float crease = length(fwidth(nrm));
        float edge = smoothstep(0.012, 0.16, crease);
        float ndv = clamp(abs(dot(nrm, normalize(cameraPosition - vSnowWorld))), 0.0, 1.0);
        edge = max(edge, smoothstep(0.2, 0.72, pow(1.0 - ndv, 1.8)));
        if (draw < 0.98 && edge < mix(0.34, 0.0, draw)) discard;
        gl_FragColor.rgb = mix(vec3(0.20, 0.24, 0.30), gl_FragColor.rgb, draw);`,
      )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-igloo-v7`
  solidUniforms.push(uniforms.uSolid)
  shared.set('snow', entry)
  return entry
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
