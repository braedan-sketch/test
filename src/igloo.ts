import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url'
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url'
import { brand } from './brand'
import { publicUrl } from './heroModel'
import { createBlockMaterial, type BlockUniforms } from './ice'
import { clamp, hash01, hashString, smoother } from './math'
import type { Quality } from './quality'

const YAW = -0.42

const LABEL_OFFSETS: Array<[number, number]> = [
  [-14, -12],
  [13, -14],
  [15, 6],
  [-16, 8],
  [12, 14],
  [-13, 2],
]

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

type Piece = {
  mesh: Mesh
  row: number
  tunnel: boolean
  basePos: Vector3
  baseQuat: Quaternion
  localCenter: Vector3
  radial: Vector3
  axis: Vector3
  delay: number
  outDist: number
  lift: number
  spin: number
  phase: number
  tag: string
}

function radialTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 124)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(1, outer)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function buildGuides(center: Vector3) {
  const root = new Group()
  const positions: number[] = []
  const y = 0.02
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.4
    const x = Math.cos(a) * 4.2
    const z = Math.sin(a) * 3.6
    positions.push(center.x, y, center.z, center.x + x, y, center.z + z)
  }
  const lines = new LineSegments(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
    new LineBasicMaterial({
      color: '#eef3f6',
      transparent: true,
      opacity: 0.2,
      fog: false,
      toneMapped: false,
    }),
  )
  const dots = new Float32Array(18 * 3)
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2
    const rad = 2.4 + (i % 3) * 0.7
    dots[i * 3] = center.x + Math.cos(a) * rad
    dots[i * 3 + 1] = y + 0.04
    dots[i * 3 + 2] = center.z + Math.sin(a) * rad * 0.86
  }
  const points = new Points(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(dots, 3)),
    new PointsMaterial({
      color: '#f4f7f8',
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.4,
      fog: false,
      toneMapped: false,
    }),
  )
  root.add(lines, points)
  return root
}

function buildSilhouette(center: Vector3, radius: number) {
  const root = new Group()
  const material = new LineBasicMaterial({
    color: '#eef3f6',
    transparent: true,
    opacity: 0.5,
    fog: false,
    toneMapped: false,
  })
  const rings = [0.18, 0.42, 0.66, 0.84, 0.96]
  for (const height of rings) {
    const y = center.y - radius * 0.42 + height * radius * 1.25
    const ring = Math.sqrt(Math.max(0.04, 1 - height * height)) * radius * 1.02
    const points: Vector3[] = []
    const steps = 72
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2
      points.push(new Vector3(center.x + Math.cos(angle) * ring, y, center.z + Math.sin(angle) * ring * 0.9))
    }
    root.add(new Line(new BufferGeometry().setFromPoints(points), material))
  }
  for (const yaw of [0.35, 1.55, 2.7, 4.1]) {
    const points: Vector3[] = []
    const steps = 28
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * Math.PI
      const ring = Math.sin(t) * radius * 1.02
      const y = center.y - radius * 0.42 + (1 - Math.cos(t)) * radius * 0.62
      points.push(new Vector3(center.x + Math.cos(yaw) * ring, y, center.z + Math.sin(yaw) * ring * 0.9))
    }
    root.add(new Line(new BufferGeometry().setFromPoints(points), material))
  }
  return root
}

function asMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true
}

async function isGlb(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    const type = head.headers.get('content-type') ?? ''
    return head.ok && !type.includes('text/html')
  } catch {
    return false
  }
}

function prepareBakedMaterial(root: Object3D, uniforms: BlockUniforms) {
  let source: MeshBasicMaterial | null = null
  root.traverse((object) => {
    if (!asMesh(object) || source) return
    const current = object.material
    if (current instanceof MeshBasicMaterial) source = current
  })
  const material = source ?? new MeshBasicMaterial({ color: '#c5ced6' })
  material.toneMapped = false
  if (material.map) material.map.colorSpace = SRGBColorSpace
  material.fog = true
  material.customProgramCacheKey = () => 'blendy-baked-igloo-v4'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSolid = uniforms.uSolid
    shader.uniforms.uDissolve = uniforms.uDissolve
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSeed;
        varying float vSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSeed = aSeed;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vSeed;
        uniform float uSolid;
        uniform float uDissolve;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uSolid < 0.999 && vSeed > uSolid) discard;
        if (uDissolve > 0.001 && vSeed < uDissolve) discard;
        float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // Faces stay moody ice. Only the seam cracks climb past the bloom threshold.
        diffuseColor.rgb *= mix(0.62, 0.92, smoothstep(0.12, 0.62, luma));
        if (luma > 0.78) {
          float hot = min(1.55, 0.78 + (luma - 0.78) * 3.4);
          diffuseColor.rgb *= hot / max(luma, 0.001);
        }`,
      )
  }
  return material
}

export async function loadIgloo(
  quality: Quality,
  sampleHeight: (x: number, z: number) => number,
  onProgress: (value: number) => void,
): Promise<Igloo> {
  const draco = new DRACOLoader()
  draco.setDecoderPath({ js: dracoWrapper, wasm: dracoWasm })
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)

  const bakedUrl = publicUrl('/models/igloo_bricks_baked.glb')
  const brickUrl = publicUrl('/models/igloo_bricks.glb')
  const baked = await isGlb(bakedUrl)
  const gltf = await loader.loadAsync(baked ? bakedUrl : brickUrl, (event) => {
    if (event.total > 0) onProgress(0.08 + (event.loaded / event.total) * 0.84)
  })
  draco.dispose()
  onProgress(0.96)

  const procedural = baked ? null : createBlockMaterial(quality)
  const uniforms: BlockUniforms = procedural
    ? procedural.uniforms
    : {
        uBurst: { value: 0 },
        uSolid: { value: 0 },
        uDissolve: { value: 0 },
        uCenter: { value: new Vector3() },
      }
  const bakedMaterial = baked ? prepareBakedMaterial(gltf.scene, uniforms) : null
  const group = gltf.scene
  group.rotation.y = YAW

  const pieces: Piece[] = []
  const box = new Box3()

  group.traverse((object) => {
    if (!asMesh(object)) return
    const mesh = object
    const rowRaw = Number((mesh.userData as { row?: number }).row ?? 0)
    const row = clamp(Number.isFinite(rowRaw) ? Math.round(rowRaw) : 0, 0, 5)
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    if (!(position instanceof BufferAttribute)) return

    const hash = hashString(mesh.name || `piece-${pieces.length}`)
    const count = position.count
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(count).fill(hash01(hash)), 1))
    geometry.setAttribute('aRow', new BufferAttribute(new Float32Array(count).fill(row), 1))

    mesh.material = bakedMaterial ?? procedural!.material
    mesh.castShadow = quality.shadows
    mesh.receiveShadow = quality.shadows
    mesh.updateMatrix()

    box.setFromBufferAttribute(position)
    const localCenter = box.getCenter(new Vector3()).applyMatrix4(mesh.matrix)
    pieces.push({
      mesh,
      row,
      tunnel: mesh.name.startsWith('Tunnel'),
      basePos: mesh.position.clone(),
      baseQuat: mesh.quaternion.clone(),
      localCenter,
      radial: new Vector3(),
      axis: new Vector3(
        hash01(hash * 3.1) * 2 - 1,
        hash01(hash * 5.7) * 2 - 1,
        hash01(hash * 8.2) * 2 - 1,
      ).normalize(),
      delay: 0,
      outDist: 0,
      lift: 0,
      spin: ((1.2 + hash01(hash * 4.4) * 2.4) * Math.PI) / 180 * (hash > 0.5 ? 1 : -1),
      phase: hash01(hash * 9.1) * Math.PI * 2,
      tag: '',
    })
  })

  const shell = pieces.filter((piece) => !piece.tunnel)
  const core = new Vector3()
  for (const piece of shell) core.add(piece.localCenter)
  if (shell.length > 0) core.multiplyScalar(1 / shell.length)

  let radius = 1
  for (const piece of shell) radius = Math.max(radius, piece.localCenter.distanceTo(core))

  for (const piece of pieces) {
    piece.radial.copy(piece.localCenter).sub(core)
    if (piece.radial.lengthSq() < 0.04) piece.radial.set(0, 1, 0)
    else piece.radial.normalize()
    const lead = piece.row >= 4 || piece.tunnel
    const rowSpan = lead ? 0.22 : 0.1 + piece.row * 0.028
    const jitter = hash01(hashString(piece.mesh.name || 'piece') * 1.7) * 0.04
    piece.outDist = radius * Math.min(0.3, Math.max(0.1, rowSpan + jitter))
    piece.lift = radius * (0.004 + Math.min(piece.row, 4) * 0.003)
    const rowLag = lead ? hash01(hashString(piece.mesh.name) * 3.3) * 0.05 : 0.05 + (4 - Math.min(piece.row, 4)) * 0.035
    piece.delay = Math.min(0.22, rowLag)
  }

  group.updateMatrixWorld(true)
  const worldBox = new Box3().setFromObject(group)
  const ground = sampleHeight(0, 0)
  group.position.y += ground - worldBox.min.y + 0.04
  group.updateMatrixWorld(true)

  const shadowMap = radialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)')
  const glowMap = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)')
  const contact = new Mesh(
    new PlaneGeometry(7.4, 6.4),
    new MeshBasicMaterial({
      map: shadowMap ?? undefined,
      transparent: true,
      depthWrite: false,
      color: '#1a2228',
    }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.set(core.x, worldBox.min.y + 0.02, core.z)
  contact.renderOrder = 2
  group.add(contact)

  const guides = buildGuides(core)
  const silhouette = buildSilhouette(core, radius)
  guides.add(silhouette)
  group.add(guides)
  guides.visible = false

  const edgeMat = new LineBasicMaterial({
    color: '#f4f7f8',
    transparent: true,
    opacity: 0.92,
    fog: false,
    toneMapped: false,
  })
  for (const piece of pieces) {
    const edges = new LineSegments(new EdgesGeometry(piece.mesh.geometry, 16), edgeMat)
    edges.name = 'brick-edge'
    piece.mesh.add(edges)
  }

  const coreMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      uniform float uGlow;
      void main() {
        float r = clamp(length(vLocal), 0.0, 1.0);
        float hot = exp(-r * r * 9.0);
        float body = exp(-r * r * 2.2);
        float haze = exp(-r * r * 0.75);
        float alpha = (hot * 0.95 + body * 0.45 + haze * 0.18) * uGlow;
        vec3 color = vec3(0.75, 0.86, 1.0) * (hot * 1.15 + body * 0.35) * uGlow;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
  const coreMesh = new Mesh(new SphereGeometry(1, 28, 20), coreMat)
  coreMesh.position.copy(core)
  coreMesh.scale.setScalar(0.2)
  coreMesh.renderOrder = 3
  group.add(coreMesh)

  const glowLayers = (quality.sprites ? [0.45, 0.9] : [0.55]).map((scale) => {
    const spriteMat = new SpriteMaterial({
      map: glowMap ?? undefined,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
    })
    spriteMat.color.setRGB(0.75, 0.84, 0.95)
    const sprite = new Sprite(spriteMat)
    sprite.position.copy(core)
    sprite.scale.setScalar(scale)
    sprite.renderOrder = 4
    group.add(sprite)
    return { sprite, material: spriteMat, scale }
  })

  const light = new PointLight('#d5e6ff', 1.1, 6.5, 1.4)
  light.position.copy(core)
  group.add(light)

  const tunnels = pieces.filter((piece) => piece.tunnel)
  // Camera sits in +Z. Pick the tunnel piece that faces it, then step outside the mouth.
  const towardCam = new Vector3(-0.12, 0, 1).normalize()
  const mouth = new Vector3(0.2, 0.25, 1.8)
  if (tunnels.length > 0) {
    let best = -Infinity
    for (const piece of tunnels) {
      const score = piece.localCenter.dot(towardCam)
      if (score > best) {
        best = score
        mouth.copy(piece.localCenter)
      }
    }
  }
  mouth.addScaledVector(towardCam, 1.05)
  mouth.y = 0.16
  const spill = new PointLight('#d5e4f4', 1.1, 2.4, 2)
  spill.position.set(mouth.x, 0.08, mouth.z)
  spill.castShadow = false
  group.add(spill)
  const spillSprite = new Sprite(
    new SpriteMaterial({
      map: glowMap ?? undefined,
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      color: '#d7e4ee',
    }),
  )
  spillSprite.position.set(mouth.x, 0.03, mouth.z)
  spillSprite.scale.set(0.85, 0.32, 1)
  spillSprite.renderOrder = 2
  group.add(spillSprite)

  const labelPieces = pickLabels(pieces)
  labelPieces.forEach((piece, index) => {
    piece.tag = brand.hud[index] ?? 'BLK'
  })
  const spin = new Quaternion()
  const coreWorld = new Vector3()

  return {
    group,
    uniforms,
    labelCount: labelPieces.length,
    update(burst, solid, dissolve, time) {
      coreWorld.copy(core).applyMatrix4(group.matrixWorld)
      uniforms.uCenter.value.copy(coreWorld)
      uniforms.uBurst.value = burst
      uniforms.uSolid.value = solid
      uniforms.uDissolve.value = dissolve
      group.visible = dissolve < 0.985
      guides.visible = false
      edgeMat.opacity = (1 - smoother(Math.min(1, solid * 1.4))) * (1 - smoother(dissolve)) * 0.92

      const open = burst * (1 - smoother(dissolve))
      const presence = (1 - smoother(dissolve)) * solid
      coreMat.uniforms.uGlow.value = (0.16 + open * 0.9) * presence
      coreMesh.scale.setScalar(0.22 + open * 0.55)
      glowLayers.forEach((layer, index) => {
        const weight = index === 0 ? 0.16 : index === 1 ? 0.07 : 0.03
        layer.material.opacity = (0.08 + open * 0.9) * weight * presence
        layer.material.toneMapped = false
        layer.sprite.scale.setScalar(layer.scale * (0.42 + open * 0.7))
      })
      light.intensity = (0.35 + open * 7.5) * presence
      light.distance = 3.2 + open * 2.4
      spill.intensity = (0.55 + open * 4.5) * presence
      spill.distance = 1.6 + open * 1.8
      ;(spillSprite.material as SpriteMaterial).opacity = (0.07 + open * 0.16) * presence
      ;(contact.material as MeshBasicMaterial).opacity = 0.78 * (1 - smoother(burst) * 0.45) * solid * (1 - dissolve)

      for (const piece of pieces) {
        const span = Math.max(0.001, 1 - piece.delay)
        const u = clamp((burst - piece.delay) / span, 0, 1)
        const t = u * u * u * (u * (u * 6 - 15) + 10)
        const bob = Math.sin(time * 0.62 + piece.phase) * 0.03 * t
        const sway = Math.cos(time * 0.41 + piece.phase * 1.7) * 0.016 * t
        piece.mesh.position.copy(piece.basePos)
        piece.mesh.position.addScaledVector(piece.radial, t * piece.outDist)
        piece.mesh.position.y += t * piece.lift + bob
        piece.mesh.position.x += sway
        spin.setFromAxisAngle(piece.axis, t * piece.spin)
        piece.mesh.quaternion.copy(piece.baseQuat).multiply(spin)
      }
    },
    fillLabels(target) {
      group.updateWorldMatrix(true, true)
      for (let i = 0; i < labelPieces.length; i += 1) {
        const piece = labelPieces[i]
        const slot = target[i]
        if (!piece || !slot) continue
        slot.position.copy(piece.localCenter).applyMatrix4(piece.mesh.matrixWorld)
        slot.text = piece.tag
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

function pickLabels(pieces: Piece[]) {
  const toward = new Vector3(-0.12, 0, 1)
  const front = pieces.filter((piece) => !piece.tunnel && piece.row >= 1 && piece.row <= 4)
  front.sort((a, b) => b.localCenter.dot(toward) - a.localCenter.dot(toward))
  const facing = front.slice(0, Math.min(front.length, 16))
  facing.sort((a, b) => a.localCenter.x - b.localCenter.x)
  const chosen: Piece[] = []
  const count = Math.min(6, facing.length)
  for (let i = 0; i < count; i += 1) {
    const index = Math.round(((i + 0.5) * facing.length) / count - 0.5)
    const piece = facing[Math.max(0, Math.min(facing.length - 1, index))]
    if (piece && !chosen.includes(piece)) chosen.push(piece)
  }
  return chosen
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
