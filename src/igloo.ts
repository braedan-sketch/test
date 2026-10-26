import {
  BackSide,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
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

/** v13 bakes a brighter, whiter glow. Keep the intensity under the frame so the white texels don't blow out. */
const EMISSIVE_INTENSITY = 1.35

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
  const burstUniforms: Array<{ value: number }> = []
  const wireMaterial = new LineBasicMaterial({
    color: '#f4f8fb',
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
    object.material = dressSnow(object.material, shared, solidUniforms, burstUniforms)

    if (seen.has(node)) return
    seen.add(node)
    const wire = new LineSegments(brickEdges(object.geometry), wireMaterial)
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
  const gapLight = new PointLight('#f4f7fb', 0, 3.2, 2)
  gapLight.position.set(0, 0.85, 0.05)
  group.add(gapLight)
  const innerLights = [
    new PointLight('#f7fbff', 0, 3.4, 2),
    new PointLight('#f3f7ff', 0, 2.6, 2),
    new PointLight('#eef4ff', 0, 2.4, 2),
  ]
  innerLights[0]?.position.set(0, 0.7, 0)
  innerLights[1]?.position.set(0.28, 1.2, 0.12)
  innerLights[2]?.position.set(-0.22, 0.42, -0.08)
  for (const light of innerLights) group.add(light)
  const cavity = new Mesh(
    new SphereGeometry(1.05, 28, 18),
    new MeshBasicMaterial({
      color: new Color().setRGB(3.4, 3.7, 4.2),
      toneMapped: false,
      fog: false,
      side: BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
    }),
  )
  cavity.name = 'igloo-core'
  // About 0.85 of the inner cavity, so the shell stays inside the bricks.
  cavity.position.set(0, 1.02, 0.02)
  cavity.scale.set(1.02, 0.78, 0.98)
  group.add(cavity)
  const cavityMaterial = cavity.material
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
      for (const slot of burstUniforms) slot.value = burst
      group.visible = dissolve < 0.985
      const present = smoother(clamp(solid * 1.15, 0, 1)) * (1 - smoother(dissolve))
      const flood = present * (1 - smoother(clamp(burst / 0.3, 0, 1)))
      gapLight.intensity = flood * 2.4
      const gains = [4.5, 2.8, 1.8]
      innerLights.forEach((light, index) => {
        light.intensity = flood * (gains[index] ?? 2)
      })
      cavity.visible = flood > 0.02
      if (cavityMaterial instanceof MeshBasicMaterial) cavityMaterial.opacity = flood
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
  burstUniforms: Array<{ value: number }>,
) {
  const source = Array.isArray(material) ? material[0] : material
  if (!(source instanceof MeshStandardMaterial)) return material
  const existing = shared.get('snow')
  if (existing) return existing
  const entry = source.clone()
  // v13 already runs from near-black to bright ice. A light scale keeps that range under white.
  entry.color.multiplyScalar(0.72)
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
  const uniforms = { uSolid: { value: 0 }, uBurst: { value: 0 } }
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    shader.uniforms.uSolid = uniforms.uSolid
    shader.uniforms.uBurst = uniforms.uBurst
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSolid;
        uniform float uBurst;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float rim = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          diffuseColor.rgb *= mix(1.0, 0.78, smoothstep(0.84, 0.98, rim));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float seam = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
        float band = smoothstep(1.05, 1.4, seam);
        float body = smoothstep(0.05, 0.45, seam) * (1.0 - band);
        totalEmissiveRadiance *= mix(0.62, 0.08, band);
        float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float fres = pow(1.0 - facing, 2.6);
        totalEmissiveRadiance += vec3(0.42, 0.5, 0.62) * fres * (0.18 + body) * 0.55;
        totalEmissiveRadiance *= 1.0 - smoothstep(0.0, 0.28, uBurst);
        totalEmissiveRadiance *= smoothstep(0.15, 0.7, uSolid);`,
      )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-igloo-v13`
  solidUniforms.push(uniforms.uSolid)
  burstUniforms.push(uniforms.uBurst)
  shared.set('snow', entry)
  return entry
}

/**
 * Real edges of the brick mesh, in the mesh's own space.
 * The line is parented to the brick, so it follows that brick's world matrix.
 * Node rotation is identity, so an axis-aligned box is world scaffolding.
 */
function brickEdges(geometry: BufferGeometry) {
  return new EdgesGeometry(geometry, 30)
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
