import {
  BackSide,
  BufferGeometry,
  Color,
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
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { brand } from './brand'
import { loadHero } from './heroModel'
import type { BlockUniforms } from './ice'
import { clamp, smoother } from './math'
import type { Quality } from './quality'

const LABEL_OFFSETS: Array<[number, number]> = [
  [-168, -72],
  [176, -84],
  [184, 28],
  [-160, 64],
  [150, 96],
  [-148, 6],
]

/**
 * Build 34's seam curve, on the calmer v14 bake. 2.85 was tuned for the hotter v13 map;
 * 3.6 puts that same curve back over 235. Faces are scaled separately, below.
 */
const EMISSIVE_INTENSITY = 3.6

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
  volMed: number
  volMax: number
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
  const fitted: FittedBox[] = []
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
  const grid = groundGrid()

  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = false
    object.receiveShadow = false
    object.frustumCulled = true
    const node = blockCarrier(object)
    const extras = readExtras(node.userData)
    object.material = dressSnow(object.material, shared, solidUniforms, burstUniforms, renderer)
    object.userData.iglooFace = true

    if (seen.has(node)) return
    seen.add(node)
    const base = node.position.clone()
    const outline = brickEdges(object.geometry, node.position)
    if (outline.box) fitted.push({ lines: outline.geometry, box: outline.box })
    wireCounts.push(outline.count)
    if (outline.hull) hulls += 1
    const wire = new LineSegments2(outline.geometry, wireMaterial)
    wire.name = 'igloo-wire'
    wire.renderOrder = 3
    wire.frustumCulled = false
    object.add(wire)
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
  capBrickVolumes(fitted)
  group.add(grid.lines)

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
    wireStats: summarizeWires(wireCounts, hulls, fitted.map((entry) => entry.box.volume)),
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
      grid.material.resolution.set(window.innerWidth, window.innerHeight)
      wireMaterial.opacity = 1 - smoother(clamp((solid - 0.1) / 0.38, 0, 1))
      grid.material.opacity = wireMaterial.opacity * 0.28
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
        slot.constellation = false
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
  renderer: WebGLRenderer,
) {
  const source = Array.isArray(material) ? material[0] : material
  if (!(source instanceof MeshStandardMaterial)) return material
  const existing = shared.get('snow')
  if (existing) return existing
  const entry = source.clone()
  // Faces only. The seam lives in the emissive map, so this does not dim the gaps.
  entry.color.multiplyScalar(0.66)
  entry.emissive.setRGB(1, 1, 1)
  entry.emissiveIntensity = EMISSIVE_INTENSITY
  entry.normalScale.set(1.35, 1.35)
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  for (const map of [entry.map, entry.normalMap, entry.roughnessMap, entry.aoMap, entry.emissiveMap, entry.metalnessMap]) {
    if (!map) continue
    map.anisotropy = anisotropy
    map.needsUpdate = true
  }
  entry.metalness = 0
  entry.envMapIntensity = 0.08
  entry.toneMapped = true
  // Field fog stays on the mountains. The igloo is the sharp subject in front of it.
  entry.fog = false
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
        #ifdef USE_EMISSIVEMAP
          vec2 seamDx = dFdx(vEmissiveMapUv) * 1.8;
          vec2 seamDy = dFdy(vEmissiveMapUv) * 1.8;
          vec3 seamWide = totalEmissiveRadiance;
          seamWide = max(seamWide, emissive * texture2D(emissiveMap, vEmissiveMapUv + seamDx).rgb);
          seamWide = max(seamWide, emissive * texture2D(emissiveMap, vEmissiveMapUv - seamDx).rgb);
          seamWide = max(seamWide, emissive * texture2D(emissiveMap, vEmissiveMapUv + seamDy).rgb);
          seamWide = max(seamWide, emissive * texture2D(emissiveMap, vEmissiveMapUv - seamDy).rgb);
          totalEmissiveRadiance = seamWide;
        #endif
        float seam = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
        float gap = smoothstep(0.85, 1.55, seam);
        totalEmissiveRadiance *= mix(0.82, 1.7, gap);
        float hot = smoothstep(3.05, 4.3, seam * mix(0.82, 1.7, gap));
        totalEmissiveRadiance *= mix(1.0, 0.74, hot);
        totalEmissiveRadiance *= 1.0 - smoothstep(0.0, 0.28, uBurst);
        totalEmissiveRadiance *= smoothstep(0.15, 0.7, uSolid);`,
      )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-igloo-v16`
  solidUniforms.push(uniforms.uSolid)
  burstUniforms.push(uniforms.uBurst)
  shared.set('snow', entry)
  return entry
}

/**
 * Twelve edges of one brick. Nodes carry translation only, so the course frame
 * is the brick's radial / up / tangent. PCA on crack vertices tipped the boxes.
 */
function brickEdges(geometry: BufferGeometry, base: Vector3) {
  const position = geometry.getAttribute('position')
  const lines = new LineSegmentsGeometry()
  if (!position || position.count < 4) {
    lines.setPositions(new Float32Array(6))
    return { geometry: lines, count: 0, hull: false, box: null }
  }
  const step = Math.max(1, Math.floor(position.count / 4000))
  let cx = 0
  let cy = 0
  let cz = 0
  let used = 0
  for (let i = 0; i < position.count; i += step) {
    cx += position.getX(i)
    cy += position.getY(i)
    cz += position.getZ(i)
    used += 1
  }
  cx /= used
  cy /= used
  cz /= used
  const axes = courseAxes(base)
  const samples: number[][] = [[], [], []]
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i) - cx
    const y = position.getY(i) - cy
    const z = position.getZ(i) - cz
    for (let k = 0; k < 3; k += 1) {
      const axis = axes[k]
      if (!axis) continue
      samples[k]?.push(x * axis.x + y * axis.y + z * axis.z)
    }
  }
  const min: number[] = []
  const max: number[] = []
  for (let k = 0; k < 3; k += 1) {
    const values = samples[k] ?? []
    const lo = quantile(values, 0.1)
    const hi = quantile(values, 0.9)
    const mid = (lo + hi) * 0.5
    // 0.8 keeps neighbouring courses from crossing. The volume cap catches the rest.
    const half = (hi - lo) * 0.5 * 0.8
    min[k] = mid - half
    max[k] = mid + half
  }
  const box: BrickBox = {
    cx,
    cy,
    cz,
    axes,
    min,
    max,
    volume: Math.abs((max[0] ?? 0) - (min[0] ?? 0)) * Math.abs((max[1] ?? 0) - (min[1] ?? 0)) * Math.abs((max[2] ?? 0) - (min[2] ?? 0)),
  }
  const corners: Vector3[] = []
  for (let mask = 0; mask < 8; mask += 1) {
    const point = new Vector3(cx, cy, cz)
    for (let k = 0; k < 3; k += 1) {
      const axis = axes[k]
      if (!axis) continue
      point.addScaledVector(axis, (mask & (1 << k)) !== 0 ? (max[k] ?? 0) : (min[k] ?? 0))
    }
    corners.push(point)
  }
  const data = new Float32Array(12 * 6)
  let edge = 0
  for (let a = 0; a < 8; a += 1) {
    for (let k = 0; k < 3; k += 1) {
      const b = a | (1 << k)
      if (b === a) continue
      const pa = corners[a]
      const pb = corners[b]
      if (!pa || !pb) continue
      data[edge * 6] = pa.x
      data[edge * 6 + 1] = pa.y
      data[edge * 6 + 2] = pa.z
      data[edge * 6 + 3] = pb.x
      data[edge * 6 + 4] = pb.y
      data[edge * 6 + 5] = pb.z
      edge += 1
    }
  }
  lines.setPositions(data)
  return { geometry: lines, count: edge, hull: true, box }
}

type BrickBox = {
  cx: number
  cy: number
  cz: number
  axes: Vector3[]
  min: number[]
  max: number[]
  volume: number
}

type FittedBox = {
  lines: LineSegmentsGeometry
  box: BrickBox
}

/** Crack vertices still inside the 4th–96th band. Shrink those boxes back to the median. */
function capBrickVolumes(fitted: FittedBox[]) {
  const volumes = fitted.map((entry) => entry.box.volume).filter((volume) => volume > 1e-6).sort((a, b) => a - b)
  const median = volumes[Math.floor(volumes.length / 2)] ?? 0
  const cap = median * 1.6
  if (cap <= 0) return
  for (const entry of fitted) {
    const box = entry.box
    if (box.volume <= cap) continue
    const scale = Math.cbrt(cap / box.volume)
    for (let k = 0; k < 3; k += 1) {
      const lo = box.min[k] ?? 0
      const hi = box.max[k] ?? 0
      const mid = (lo + hi) * 0.5
      const half = (hi - lo) * 0.5 * scale
      box.min[k] = mid - half
      box.max[k] = mid + half
    }
    box.volume = cap
    entry.lines.setPositions(boxPositions(box))
  }
}

function boxPositions(box: BrickBox) {
  const corners: Vector3[] = []
  for (let mask = 0; mask < 8; mask += 1) {
    const point = new Vector3(box.cx, box.cy, box.cz)
    for (let k = 0; k < 3; k += 1) {
      const axis = box.axes[k]
      if (!axis) continue
      point.addScaledVector(axis, (mask & (1 << k)) !== 0 ? (box.max[k] ?? 0) : (box.min[k] ?? 0))
    }
    corners.push(point)
  }
  const data = new Float32Array(12 * 6)
  let edge = 0
  for (let a = 0; a < 8; a += 1) {
    for (let k = 0; k < 3; k += 1) {
      const b = a | (1 << k)
      if (b === a) continue
      const pa = corners[a]
      const pb = corners[b]
      if (!pa || !pb) continue
      data[edge * 6] = pa.x
      data[edge * 6 + 1] = pa.y
      data[edge * 6 + 2] = pa.z
      data[edge * 6 + 3] = pb.x
      data[edge * 6 + 4] = pb.y
      data[edge * 6 + 5] = pb.z
      edge += 1
    }
  }
  return data
}

function quantile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index)
  const hi = Math.min(sorted.length - 1, lo + 1)
  const t = index - lo
  return (sorted[lo] ?? 0) * (1 - t) + (sorted[hi] ?? 0) * t
}

/** Horizontal course: tangent across the wall, up, and the outward radial. */
function courseAxes(base: Vector3) {
  const radial = new Vector3(base.x, 0, base.z)
  if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0)
  else radial.normalize()
  const up = new Vector3(0, 1, 0)
  const tangent = new Vector3().crossVectors(up, radial).normalize()
  return [tangent, up, radial]
}


/** Faint plan grid under the dome, the same idea as the build 23 ground guides. */
function groundGrid() {
  const positions: number[] = []
  const y = 0.035
  const extent = 6
  const step = 0.75
  for (let i = -extent; i <= extent + 1e-4; i += step) {
    positions.push(-extent, y, i, extent, y, i)
    positions.push(i, y, -extent, i, y, extent)
  }
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(new Float32Array(positions))
  const material = new LineMaterial({
    color: '#d7e2ea',
    linewidth: 1,
    worldUnits: false,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
  material.toneMapped = false
  material.resolution.set(window.innerWidth, window.innerHeight)
  const lines = new LineSegments2(geometry, material)
  lines.name = 'ground-grid'
  lines.renderOrder = 1
  lines.frustumCulled = false
  return { lines, material }
}

function summarizeWires(counts: number[], hulls: number, volumes: number[]): WireStats {
  let min = counts[0] ?? 0
  let max = min
  let sum = 0
  for (const count of counts) {
    min = Math.min(min, count)
    max = Math.max(max, count)
    sum += count
  }
  const sorted = volumes.filter((volume) => volume > 0).sort((a, b) => a - b)
  const volMed = sorted[Math.floor(sorted.length / 2)] ?? 0
  const volMax = sorted[sorted.length - 1] ?? 0
  return {
    bricks: counts.length,
    hulls,
    min,
    max,
    mean: counts.length ? Math.round((sum / counts.length) * 10) / 10 : 0,
    volMed: Math.round(volMed * 1000) / 1000,
    volMax: Math.round(volMax * 1000) / 1000,
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
