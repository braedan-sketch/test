import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
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
import { createBlockMaterial, type BlockUniforms } from './ice'
import { clamp, hash01, hashString, smoother } from './math'
import type { Quality } from './quality'

/** Crown (highest row) leaves first. Index is the glTF `row` extra. */
const ROW_START = [0.64, 0.5, 0.36, 0.22, 0.1, 0]
const ROW_DURATION = 0.3
const YAW = -0.42

const LABEL_OFFSETS: Array<[number, number]> = [
  [-78, -46],
  [16, -72],
  [86, -30],
  [-98, 8],
  [70, 24],
  [112, 46],
]

export function burstAmount(sectionT: number) {
  if (sectionT <= 0.1) return 0
  return clamp((sectionT - 0.1) / 0.9, 0, 1)
}

type Piece = {
  mesh: Mesh
  row: number
  tunnel: boolean
  basePos: Vector3
  baseQuat: Quaternion
  localCenter: Vector3
  worldCenter: Vector3
  radial: Vector3
  tangent: Vector3
  axis: Vector3
  delay: number
  outDist: number
  lift: number
  arc: number
  side: number
  spin: number
}

export type LabelAnchor = {
  position: Vector3
  text: string
  offsetX: number
  offsetY: number
}

export type Igloo = {
  group: Group
  uniforms: BlockUniforms
  update: (anim: number, dissolve: number, abstractT: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
  copyCore: (target: Vector3) => void
  readout: (anim: number) => string
}

function radialTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 124)
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
  const group = gltf.scene
  group.rotation.y = YAW

  const pieces: Piece[] = []
  const up = new Vector3(0, 1, 0)
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
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(count).fill(hash), 1))
    geometry.setAttribute('aRow', new BufferAttribute(new Float32Array(count).fill(row), 1))

    mesh.material = material
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
      worldCenter: new Vector3(),
      radial: new Vector3(),
      tangent: new Vector3(),
      axis: new Vector3(
        hash01(hash * 3.1) * 2 - 1,
        hash01(hash * 5.7) * 2 - 1,
        hash01(hash * 8.2) * 2 - 1,
      ).normalize(),
      delay: hash * 0.055,
      outDist: 1.45 + row * 0.42 + hash * 0.9,
      lift: 0.4 + row * 0.24 + hash01(hash * 2.2) * 0.2,
      arc: 0.16 + row * 0.06,
      side: (hash - 0.5) * 1.15,
      spin: (0.75 + hash01(hash * 4.4) * 1.65) * (hash > 0.5 ? 1 : -1),
    })
  })

  const shell = pieces.filter((piece) => !piece.tunnel)
  const core = new Vector3()
  for (const piece of shell) core.add(piece.localCenter)
  if (shell.length > 0) core.multiplyScalar(1 / shell.length)

  for (const piece of pieces) {
    piece.radial.copy(piece.localCenter).sub(core)
    piece.radial.y *= 0.38
    if (piece.radial.lengthSq() < 0.04) piece.radial.set(0, 1, 0)
    else piece.radial.normalize()
    piece.tangent.crossVectors(piece.radial, up)
    if (piece.tangent.lengthSq() < 0.2) piece.tangent.set(1, 0, 0)
    else piece.tangent.normalize()
  }

  group.updateMatrixWorld(true)
  const worldBox = new Box3().setFromObject(group)
  const ground = sampleHeight(0, 0)
  group.position.y += ground - worldBox.min.y + 0.03
  group.updateMatrixWorld(true)

  for (const piece of pieces) {
    piece.worldCenter.copy(piece.localCenter).applyMatrix4(piece.mesh.matrixWorld)
  }

  const shadowMap = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')
  const glowMap = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)')
  const contact = new Mesh(
    new PlaneGeometry(7.2, 6.2),
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

  const coreMat = new MeshBasicMaterial({
    color: '#f4f8ff',
    transparent: true,
    opacity: 0.18,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  coreMat.color.setRGB(2.4, 2.5, 2.7)
  const coreMesh = new Mesh(new SphereGeometry(0.42, 28, 20), coreMat)
  coreMesh.position.copy(core)
  coreMesh.renderOrder = 3
  group.add(coreMesh)

  const spriteMat = new SpriteMaterial({
    map: glowMap ?? undefined,
    color: '#f7fbff',
    transparent: true,
    opacity: 0.08,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  })
  spriteMat.color.setRGB(1.15, 1.2, 1.3)
  const glow = new Sprite(spriteMat)
  glow.position.copy(core)
  glow.scale.set(1.6, 1.6, 1)
  glow.renderOrder = 4
  group.add(glow)

  const light = new PointLight('#d7e7ff', 1.4, 7, 2)
  light.position.copy(core)
  group.add(light)

  const labelPieces = pickLabels(pieces)
  const spin = new Quaternion()
  const coreWorld = new Vector3()

  return {
    group,
    uniforms,
    labelCount: labelPieces.length,
    update(anim, dissolve, abstractT) {
      coreWorld.copy(core).applyMatrix4(group.matrixWorld)
      uniforms.uCenter.value.copy(coreWorld)
      uniforms.uBurst.value = anim
      uniforms.uDissolve.value = dissolve
      group.visible = dissolve < 0.985

      const fadeOut = 1 - clamp((abstractT - 0.12) / 0.22, 0, 1)
      coreMat.opacity = (0.05 + anim * 0.55) * fadeOut
      coreMesh.scale.setScalar(0.42 + anim * 1.05)
      spriteMat.opacity = (0.02 + anim * 0.28) * fadeOut
      glow.scale.setScalar(1.1 + anim * 2.4)
      light.intensity = (0.35 + anim * 5.5) * fadeOut
      light.distance = 5 + anim * 6
      ;(contact.material as MeshBasicMaterial).opacity = (1 - smoother(anim)) * fadeOut

      for (const piece of pieces) {
        const start = (ROW_START[piece.row] ?? 0.64) + piece.delay
        const t = smoother(clamp((anim - start) / ROW_DURATION, 0, 1))
        piece.mesh.position.copy(piece.basePos)
        piece.mesh.position.addScaledVector(piece.radial, t ** 1.55 * piece.outDist)
        piece.mesh.position.y += Math.sin(t * Math.PI) * piece.arc + t ** 0.8 * piece.lift
        piece.mesh.position.addScaledVector(piece.tangent, t ** 1.3 * piece.side)
        spin.setFromAxisAngle(piece.axis, t ** 1.2 * piece.spin)
        piece.mesh.quaternion.copy(spin).multiply(piece.baseQuat)
      }
    },
    fillLabels(target) {
      group.updateWorldMatrix(true, true)
      for (let i = 0; i < labelPieces.length; i += 1) {
        const piece = labelPieces[i]
        const slot = target[i]
        if (!piece || !slot) continue
        slot.position.copy(piece.localCenter).applyMatrix4(piece.mesh.matrixWorld)
      }
    },
    copyCore(target) {
      target.copy(core).applyMatrix4(group.matrixWorld)
    },
    readout(anim) {
      if (anim <= 0.001) return 'HOLD'
      if (anim >= 0.995) return 'OPEN'
      for (let row = 5; row >= 0; row -= 1) {
        const start = ROW_START[row] ?? 1
        if (anim >= start && anim < start + ROW_DURATION + 0.06) {
          return row >= 4 ? `ROW 0${row}  CROWN` : `ROW 0${row}`
        }
      }
      return 'LIFT'
    },
  }
}

function pickLabels(pieces: Piece[]) {
  const chosen: Piece[] = []
  for (const row of [5, 4, 3, 2, 1]) {
    const pool = pieces.filter((piece) => !piece.tunnel && piece.row === row)
    pool.sort((a, b) => b.worldCenter.z - a.worldCenter.z)
    const piece = pool[0]
    if (piece) chosen.push(piece)
  }
  const walls = pieces.filter((piece) => piece.tunnel && /wall/i.test(piece.mesh.name))
  walls.sort((a, b) => {
    const da = a.worldCenter.distanceToSquared(new Vector3())
    const db = b.worldCenter.distanceToSquared(new Vector3())
    return db - da
  })
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
  }))
}
