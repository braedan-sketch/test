import {
  BackSide,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
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

/** v13 seams are the hot texels. Intensity near 3 lets the gaps bloom; the shader leaves the faces alone. */
const EMISSIVE_INTENSITY = 2.85

export type LabelAnchor = {
  position: Vector3
  text: string
  offsetX: number
  offsetY: number
  bent: boolean
  constellation?: boolean
}

export type WireStats = {
  bricks: number
  hulls: number
  min: number
  max: number
  mean: number
}

export type Igloo = {
  group: Group
  uniforms: BlockUniforms
  update: (burst: number, solid: number, dissolve: number, time: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
  readout: (burst: number, solid: number) => string
  wireStats: WireStats
}

type Block = {
  node: Object3D
  mesh: Mesh
  wire: LineSegments2
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
  const wireCounts: number[] = []
  let hulls = 0
  const seen = new Set<Object3D>()
  const shared = new Map<string, MeshStandardMaterial>()
  const solidUniforms: Array<{ value: number }> = []
  const burstUniforms: Array<{ value: number }> = []
  const wireMaterial = new LineMaterial({
    color: '#f7fbfe',
    linewidth: 1.6,
    worldUnits: false,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
  wireMaterial.toneMapped = false
  wireMaterial.resolution.set(window.innerWidth, window.innerHeight)

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
    const outline = brickEdges(object.geometry)
    wireCounts.push(outline.count)
    if (outline.hull) hulls += 1
    const wire = new LineSegments2(outline.geometry, wireMaterial)
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
      color: new Color().setRGB(7.2, 7.8, 8.6),
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
    wireStats: summarizeWires(wireCounts, hulls),
    update(burst, solid, dissolve, time) {
      uniforms.uBurst.value = burst
      uniforms.uSolid.value = solid
      uniforms.uDissolve.value = dissolve
      for (const slot of solidUniforms) slot.value = solid
      for (const slot of burstUniforms) slot.value = burst
      group.visible = dissolve < 0.985
      const present = smoother(clamp(solid * 1.15, 0, 1)) * (1 - smoother(dissolve))
      const flood = present * (1 - smoother(clamp(burst / 0.3, 0, 1)))
      gapLight.intensity = flood * 4.2
      const gains = [7.6, 4.8, 3.1]
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
      wireMaterial.resolution.set(window.innerWidth, window.innerHeight)
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
  // v13 block tones, a little under the baked white so the gaps can be the brightest thing.
  entry.color.multiplyScalar(0.85)
  entry.emissive.setRGB(1, 1, 1)
  entry.emissiveIntensity = EMISSIVE_INTENSITY
  entry.normalScale.set(0.62, 0.62)
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
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float seam = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
        float gap = smoothstep(0.85, 1.55, seam);
        totalEmissiveRadiance *= mix(0.82, 1.7, gap);
        float hot = smoothstep(3.05, 4.3, seam * mix(0.82, 1.7, gap));
        totalEmissiveRadiance *= mix(1.0, 0.74, hot);
        totalEmissiveRadiance *= 1.0 - smoothstep(0.0, 0.28, uBurst);
        totalEmissiveRadiance *= smoothstep(0.15, 0.7, uSolid);`,
      )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-igloo-v14`
  solidUniforms.push(uniforms.uSolid)
  burstUniforms.push(uniforms.uBurst)
  shared.set('snow', entry)
  return entry
}

type OutlineEdge = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; len: number }

/**
 * Outline of a coarse convex proxy, in the mesh's own space.
 * A few spread vertices make a block, not the cracked surface.
 * EdgesGeometry at 40° then drops the short fragments.
 */
function brickEdges(geometry: BufferGeometry) {
  const hull = convexProxy(geometry)
  const source = hull ?? geometry
  let edges = collectEdges(source, hull ? 40 : 62, 0.05)
  if (hull && (edges.length < 8 || edges.length > 22)) {
    const tighter = collectEdges(source, edges.length > 22 ? 58 : 26, 0.04)
    if (tighter.length >= 8 && tighter.length <= 22) edges = tighter
  }
  if (edges.length > 20) edges = edges.slice(0, 20)
  hull?.dispose()
  const data = new Float32Array(Math.max(1, edges.length) * 6)
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]
    if (!edge) continue
    data[i * 6] = edge.ax
    data[i * 6 + 1] = edge.ay
    data[i * 6 + 2] = edge.az
    data[i * 6 + 3] = edge.bx
    data[i * 6 + 4] = edge.by
    data[i * 6 + 5] = edge.bz
  }
  const lines = new LineSegmentsGeometry()
  lines.setPositions(data)
  return { geometry: lines, count: edges.length, hull: hull != null }
}

function convexProxy(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  if (!position || position.count < 4) return null
  const points = proxyPoints(position)
  if (points.length < 4) return null
  try {
    const hull = new ConvexGeometry(points)
    const built = hull.getAttribute('position')
    if (!built || built.count < 9) {
      hull.dispose()
      return null
    }
    return hull
  } catch {
    return null
  }
}

/** Farthest-point sample so the hull is a block, not a wrinkled copy of the cracks. */
function proxyPoints(position: BufferGeometry['attributes']['position']) {
  const pool: Vector3[] = []
  const stride = Math.max(1, Math.floor(position.count / 320))
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (i % stride === 0) pool.push(new Vector3(x, y, z))
    if (x < minX) {
      minX = x
      corners[0]?.set(x, y, z)
    }
    if (x > maxX) {
      maxX = x
      corners[1]?.set(x, y, z)
    }
    if (y < minY) {
      minY = y
      corners[2]?.set(x, y, z)
    }
    if (y > maxY) {
      maxY = y
      corners[3]?.set(x, y, z)
    }
    if (z < minZ) {
      minZ = z
      corners[4]?.set(x, y, z)
    }
    if (z > maxZ) {
      maxZ = z
      corners[5]?.set(x, y, z)
    }
  }
  for (const corner of corners) pool.push(corner.clone())
  const first = pool[0]
  if (!first) return []
  const target = Math.min(12, pool.length)
  const chosen: Vector3[] = [first]
  const nearest = new Float64Array(pool.length).fill(Infinity)
  while (chosen.length < target) {
    const last = chosen[chosen.length - 1]
    if (!last) break
    let best = 0
    let bestD = -1
    for (let i = 0; i < pool.length; i += 1) {
      const point = pool[i]
      if (!point) continue
      const dist = point.distanceToSquared(last)
      const prev = nearest[i] ?? Infinity
      if (dist < prev) nearest[i] = dist
      const score = nearest[i] ?? 0
      if (score > bestD) {
        bestD = score
        best = i
      }
    }
    if (bestD <= 1e-8) break
    const next = pool[best]
    if (!next) break
    chosen.push(next)
  }
  return chosen
}

function collectEdges(geometry: BufferGeometry, angle: number, minLen: number) {
  const edges = new EdgesGeometry(geometry, angle)
  const src = edges.getAttribute('position')
  const picked: OutlineEdge[] = []
  if (src) {
    for (let i = 0; i + 1 < src.count; i += 2) {
      const ax = src.getX(i)
      const ay = src.getY(i)
      const az = src.getZ(i)
      const bx = src.getX(i + 1)
      const by = src.getY(i + 1)
      const bz = src.getZ(i + 1)
      const len = Math.hypot(ax - bx, ay - by, az - bz)
      if (len >= minLen) picked.push({ ax, ay, az, bx, by, bz, len })
    }
  }
  edges.dispose()
  picked.sort((a, b) => b.len - a.len)
  return picked
}

function summarizeWires(counts: number[], hulls: number): WireStats {
  let min = counts[0] ?? 0
  let max = min
  let sum = 0
  for (const count of counts) {
    min = Math.min(min, count)
    max = Math.max(max, count)
    sum += count
  }
  return {
    bricks: counts.length,
    hulls,
    min,
    max,
    mean: counts.length ? Math.round((sum / counts.length) * 10) / 10 : 0,
  }
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
