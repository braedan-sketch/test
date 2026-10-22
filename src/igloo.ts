import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  CanvasTexture,
  EdgesGeometry,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
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
import { createBlockMaterial, NOISE, type BlockUniforms } from './ice'
import { clamp, hash01, hashString, smoother } from './math'
import type { Quality } from './quality'

const YAW = -0.42

const LABEL_OFFSETS: Array<[number, number]> = [
  [-86, -52],
  [18, -78],
  [92, -28],
  [-104, 12],
  [74, 28],
  [118, 48],
]

export type LabelAnchor = {
  position: Vector3
  text: string
  offsetX: number
  offsetY: number
  bent: boolean
}

export type Igloo = {
  group: Group
  uniforms: BlockUniforms
  update: (burst: number, solid: number, dissolve: number) => void
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

function asMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true
}

function wireMaterial(solid: { value: number }) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    uniforms: { uSolid: solid },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      uniform float uSolid;
      ${NOISE}
      void main() {
        float n = blNoise(vWPos * 2.35);
        if (n < uSolid) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, 0.95);
      }
    `,
  })
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

  const gltf = await loader.loadAsync('/models/igloo_bricks.glb', (event) => {
    if (event.total > 0) onProgress(0.08 + (event.loaded / event.total) * 0.84)
  })
  draco.dispose()
  onProgress(0.96)

  const { material, uniforms } = createBlockMaterial(quality)
  const wires = wireMaterial(uniforms.uSolid)
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

    mesh.material = material
    mesh.castShadow = quality.shadows
    mesh.receiveShadow = quality.shadows
    mesh.updateMatrix()

    const edges = new EdgesGeometry(geometry, 22)
    const wire = new LineSegments(edges, wires)
    wire.frustumCulled = false
    mesh.add(wire)

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
      spin: (0.45 + hash01(hash * 4.4) * 0.7) * (hash > 0.5 ? 1 : -1),
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
    const spread = (lead ? 1.22 : 1.02) + hash01(hashString(piece.mesh.name || 'piece') * 1.7) * (lead ? 0.28 : 0.32)
    piece.outDist = radius * Math.min(1.5, spread)
    piece.lift = radius * ((lead ? 0.22 : 0.1) + hash01(hashString(piece.mesh.uuid) * 2.1) * 0.12)
    const rowLag = lead ? hash01(hashString(piece.mesh.name) * 3.3) * 0.05 : 0.16 + (4 - Math.min(piece.row, 4)) * 0.1
    piece.delay = Math.min(0.62, rowLag)
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
      color: '#ffffff',
    }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.set(core.x, worldBox.min.y + 0.02, core.z)
  contact.renderOrder = 2
  group.add(contact)

  const coreMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
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
        vec3 color = vec3(1.0) * (hot * 2.4 + body * 0.85 + haze * 0.2) * uGlow;
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

  const glowLayers = (quality.sprites ? [0.7, 1.6, 3.1] : [0.9]).map((scale, index) => {
    const spriteMat = new SpriteMaterial({
      map: glowMap ?? undefined,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })
    spriteMat.color.setRGB(1.4 - index * 0.08, 1.35 - index * 0.08, 1.3)
    const sprite = new Sprite(spriteMat)
    sprite.position.copy(core)
    sprite.scale.setScalar(scale)
    sprite.renderOrder = 4
    group.add(sprite)
    return { sprite, material: spriteMat, scale }
  })

  const light = new PointLight('#fff6ee', 0, 8, 1.4)
  light.position.copy(core)
  group.add(light)

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
    update(burst, solid, dissolve) {
      coreWorld.copy(core).applyMatrix4(group.matrixWorld)
      uniforms.uCenter.value.copy(coreWorld)
      uniforms.uBurst.value = burst
      uniforms.uSolid.value = solid
      uniforms.uDissolve.value = dissolve
      group.visible = dissolve < 0.985

      const glow = burst * (1 - smoother(dissolve))
      coreMat.uniforms.uGlow.value = glow
      coreMesh.scale.setScalar(0.35 + glow * 1.15)
      glowLayers.forEach((layer, index) => {
        const weight = index === 0 ? 0.55 : index === 1 ? 0.26 : 0.12
        layer.material.opacity = glow * weight
        layer.sprite.scale.setScalar(layer.scale * (0.75 + glow * 0.85))
      })
      light.intensity = glow * 7.5
      light.distance = 3.2 + glow * 6.5
      ;(contact.material as MeshBasicMaterial).opacity = (1 - smoother(burst)) * solid * (1 - dissolve)

      for (const piece of pieces) {
        const span = Math.max(0.001, 1 - piece.delay)
        const u = clamp((burst - piece.delay) / span, 0, 1)
        const t = u * u * (3 - 2 * u)
        piece.mesh.position.copy(piece.basePos)
        piece.mesh.position.addScaledVector(piece.radial, t * piece.outDist)
        piece.mesh.position.y += t * piece.lift
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
        const x = slot.position.x
        const y = slot.position.y
        slot.text = `${piece.tag}  ${signed(x)}  ${signed(y)}`
        slot.bent = false
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

function signed(value: number) {
  const text = Math.abs(value).toFixed(1)
  return value >= 0 ? `+${text}` : `-${text}`
}

function pickLabels(pieces: Piece[]) {
  const chosen: Piece[] = []
  for (const row of [5, 4, 3, 2, 1]) {
    const pool = pieces.filter((piece) => !piece.tunnel && piece.row === row)
    pool.sort((a, b) => b.localCenter.z - a.localCenter.z)
    const piece = pool[0]
    if (piece) chosen.push(piece)
  }
  const walls = pieces.filter((piece) => piece.tunnel && /wall/i.test(piece.mesh.name))
  walls.sort((a, b) => b.localCenter.lengthSq() - a.localCenter.lengthSq())
  const entry = walls[0]
  if (entry) chosen.push(entry)
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
