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
import { createBlockMaterial, type BlockUniforms } from './ice'
import { clamp, hash01, hashString, smoother } from './math'
import type { Quality } from './quality'

const YAW = -0.42

const LABEL_OFFSETS: Array<[number, number]> = [
  [-78, -46],
  [16, -72],
  [86, -30],
  [-98, 8],
  [70, 24],
  [112, 46],
]

/** Linear scrub across most of the release section. Scroll back reverses it. */
export function burstAmount(sectionT: number) {
  if (sectionT <= 0.06) return 0
  return clamp((sectionT - 0.06) / 0.82, 0, 1)
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
  axis: Vector3
  delay: number
  outDist: number
  lift: number
  spin: number
  phase: number
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
  update: (anim: number, dissolve: number, abstractT: number, time: number) => void
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
      axis: new Vector3(
        hash01(hash * 3.1) * 2 - 1,
        hash01(hash * 5.7) * 2 - 1,
        hash01(hash * 8.2) * 2 - 1,
      ).normalize(),
      delay: 0,
      outDist: 0,
      lift: 0,
      spin: (0.045 + hash01(hash * 4.4) * 0.07) * (hash > 0.5 ? 1 : -1),
      phase: hash * Math.PI * 2,
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
    const spread = (lead ? 0.58 : 0.34) + hash01(hashString(piece.mesh.name || 'piece') * 1.7) * 0.28
    piece.outDist = radius * Math.min(0.95, spread)
    piece.lift = (lead ? 0.1 : 0.045) + hash01(hashString(piece.mesh.uuid) * 2.1) * 0.03
    piece.delay = lead ? 0 : 0.06 + (4 - Math.min(piece.row, 4)) * 0.015
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
        float hot = exp(-r * r * 10.0);
        float body = exp(-r * r * 2.6);
        float haze = exp(-r * r * 0.9);
        float alpha = (hot * 0.85 + body * 0.4 + haze * 0.16) * uGlow;
        vec3 warm = vec3(1.15, 0.78, 0.42);
        vec3 color = warm * (hot * 1.8 + body * 0.55 + haze * 0.14) * uGlow;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
  const coreMesh = new Mesh(new SphereGeometry(1, 28, 20), coreMat)
  coreMesh.position.copy(core)
  coreMesh.scale.setScalar(0.35)
  coreMesh.renderOrder = 3
  group.add(coreMesh)

  const glowLayers = [0.55, 1.35, 2.7].map((scale, index) => {
    const material = new SpriteMaterial({
      map: glowMap ?? undefined,
      color: '#ffd2b0',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })
    material.color.setRGB(1.35 - index * 0.12, 0.95 - index * 0.1, 0.62)
    const sprite = new Sprite(material)
    sprite.position.copy(core)
    sprite.scale.setScalar(scale)
    sprite.renderOrder = 4
    group.add(sprite)
    return { sprite, material, scale }
  })

  const light = new PointLight('#ffc9a4', 0.2, 7, 2)
  light.position.copy(core)
  group.add(light)

  const labelPieces = pickLabels(pieces)
  const spin = new Quaternion()
  const coreWorld = new Vector3()

  return {
    group,
    uniforms,
    labelCount: labelPieces.length,
    update(anim, dissolve, abstractT, time) {
      coreWorld.copy(core).applyMatrix4(group.matrixWorld)
      uniforms.uCenter.value.copy(coreWorld)
      uniforms.uBurst.value = anim
      uniforms.uDissolve.value = dissolve
      group.visible = dissolve < 0.985

      const fadeOut = 1 - clamp((abstractT - 0.12) / 0.22, 0, 1)
      const glow = anim * fadeOut
      coreMat.uniforms.uGlow.value = glow
      coreMesh.scale.setScalar(0.48 + glow * 0.85)
      glowLayers.forEach((layer, index) => {
        const weight = index === 0 ? 0.32 : index === 1 ? 0.16 : 0.07
        layer.material.opacity = glow * weight
        layer.sprite.scale.setScalar(layer.scale * (0.8 + glow * 0.35))
      })
      light.intensity = (0.08 + glow * 2.4) * fadeOut
      light.distance = 3.5 + glow * 3.5
      ;(contact.material as MeshBasicMaterial).opacity = (1 - smoother(anim)) * fadeOut

      for (const piece of pieces) {
        const t = clamp((anim - piece.delay) / Math.max(0.001, 1 - piece.delay), 0, 1)
        piece.mesh.position.copy(piece.basePos)
        piece.mesh.position.addScaledVector(piece.radial, t * piece.outDist)
        piece.mesh.position.y += t * piece.lift
        piece.mesh.position.x += Math.sin(time * 0.31 + piece.phase) * 0.018 * t
        piece.mesh.position.y += Math.sin(time * 0.42 + piece.phase * 1.3) * 0.028 * t
        piece.mesh.position.z += Math.cos(time * 0.27 + piece.phase) * 0.016 * t
        spin.setFromAxisAngle(piece.axis, t * piece.spin)
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
      if (anim <= 0.02) return 'HOLD'
      if (anim >= 0.98) return 'OPEN'
      return 'APART'
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
