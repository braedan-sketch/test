import {
  AdditiveBlending,
  type Blending,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PointLight,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { loadHero } from './heroModel'
import { clamp, smoother } from './math'
import type { Quality } from './quality'

export type Rings = {
  group: Group
  update: (progress: number, shown: number) => void
}

type Piece = {
  node: Object3D
  base: Vector3
  dir: Vector3
  depth: number
  loose: boolean
  outer: boolean
}

/**
 * The Blender portal. Pieces keep their node translation, so scroll can
 * ease them apart along the ring and along their existing depth offset.
 */
export async function createRings(quality: Quality, renderer?: WebGLRenderer): Promise<Rings> {
  const asset = renderer ? await loadHero('/models/rings.glb', renderer, { eager: true }) : null
  const root = asset ?? new Group()
  root.name = 'rings'
  // The portal is centred on its own origin and about 4.1 m across. Lift it
  // so the lower segments clear the snow mound.
  root.position.y = 2.25

  const pieces = collectPieces(root)
  dressPortal(root, quality)
  const core = new PointLight('#efece6', 0.35, 2.6, 2)
  core.position.set(0, 0, 0.2)
  root.add(core)

  return {
    group: root,
    update(progress, shown) {
      root.visible = shown > 0.02
      const open = smoother(clamp(progress, 0, 1))
      for (const piece of pieces) {
        const reach = piece.loose ? 0.26 : piece.outer ? 0.09 : 0.16
        piece.node.position.copy(piece.base)
        piece.node.position.addScaledVector(piece.dir, open * reach)
        piece.node.position.z += piece.depth * open * 0.2
      }
      core.intensity = 0.28 + open * 0.18
    },
  }
}

function collectPieces(root: Group) {
  const pieces: Piece[] = []
  root.traverse((object) => {
    const extras = object.userData as { group?: unknown; a0?: unknown; a1?: unknown; arc?: unknown }
    if (extras.group !== 'ring_outer' && extras.group !== 'ring_inner') return
    const a0 = Number(extras.a0)
    const a1 = Number(extras.a1)
    if (!Number.isFinite(a0) || !Number.isFinite(a1)) return
    const mid = (a0 + a1) * 0.5
    pieces.push({
      node: object,
      base: object.position.clone(),
      dir: new Vector3(Math.cos(mid), Math.sin(mid), 0),
      depth: object.position.z,
      loose: Number(extras.arc) === 9,
      outer: extras.group === 'ring_outer',
    })
  })
  return pieces
}

function dressPortal(root: Group, quality: Quality) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (object.name === 'halo') {
      // v6 bakes a thin blue core. Raise it so the flares read white-blue and broad.
      object.material = fxMaterial(object.material, 4.4, new Color(0.75, 0.86, 1), AdditiveBlending, false)
      object.renderOrder = 5
      object.frustumCulled = false
      return
    }
    if (object.name === 'lattice') {
      // The disc sits at z -0.25, behind the halo plane at z 0.4. Draw it after
      // the halo so the strokes composite over the grey centre.
      object.material = latticeDisc()
      object.renderOrder = 6
      object.frustumCulled = false
      return
    }
    const material = object.material
    if (!(material instanceof MeshStandardMaterial)) return
    material.emissiveIntensity = 0.55
    material.metalness = 0
    material.envMapIntensity = 0.16
    material.normalScale.set(0.72, 0.72)
    material.fog = true
    material.toneMapped = true
    // v8 is 65k tris. Skip the shadow map so the portal can stay at DPR 2.
    object.castShadow = false
    object.receiveShadow = quality.shadows
  })
}

/**
 * One texture sample instead of 110 scratches per pixel. That loop was the
 * rings frame drop. The stroke look is unchanged on purpose.
 */
function latticeDisc() {
  const material = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
  const frostMap = bakeFrost()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.frostMap = { value: frostMap }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLattice;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLattice = transformed;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D frostMap;\nvarying vec3 vLattice;')
      .replace(
        '#include <colorspace_fragment>',
        `#include <colorspace_fragment>
        {
          vec2 frostUv = clamp(vLattice.xy / 2.92 + 0.5, 0.0, 1.0);
          vec4 frost = texture2D(frostMap, frostUv);
          float disc = 1.0 - smoothstep(1.28, 1.48, length(vLattice.xy));
          gl_FragColor.rgb = frost.rgb;
          gl_FragColor.a = frost.a * disc;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'lattice-disc-v11'
  return material
}

/** Dark cool strokes, several texels wide, so the frost reads at 1x. */
function bakeFrost() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new CanvasTexture(canvas)
  const px = size / 2.92
  const rand = mulberry32(0x5a17c0de)
  const wash = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.46)
  wash.addColorStop(0, 'rgba(176, 190, 204, 0.14)')
  wash.addColorStop(1, 'rgba(176, 190, 204, 0)')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, size, size)
  ctx.lineCap = 'round'
  for (let i = 0; i < 140; i += 1) {
    const ang = rand() * Math.PI * 2
    const dist = Math.sqrt(rand()) * 1.22 * px
    const originX = size / 2 + Math.cos(ang) * dist
    const originY = size / 2 + Math.sin(ang) * dist
    const dir = rand() * Math.PI
    const length = (0.08 + rand() * 0.4) * px
    ctx.strokeStyle = `rgba(48, 64, 84, ${(0.5 + rand() * 0.28).toFixed(3)})`
    ctx.lineWidth = 5 + rand() * 6
    ctx.beginPath()
    ctx.moveTo(originX - Math.cos(dir) * length * 0.5, originY - Math.sin(dir) * length * 0.5)
    ctx.lineTo(originX + Math.cos(dir) * length * 0.5, originY + Math.sin(dir) * length * 0.5)
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = NoColorSpace
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fxMaterial(
  source: Material | Material[],
  gain: number,
  tint: Color,
  blending: Blending,
  toneMapped: boolean,
) {
  const entry = Array.isArray(source) ? source[0] : source
  const map =
    entry instanceof MeshStandardMaterial ? (entry.map ?? entry.emissiveMap) : entry instanceof MeshBasicMaterial ? entry.map : null
  if (map) {
    map.colorSpace = SRGBColorSpace
    map.needsUpdate = true
  }
  const color = tint.clone().multiplyScalar(gain)
  return new MeshBasicMaterial({
    map: map ?? undefined,
    color,
    blending,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped,
    side: DoubleSide,
    fog: false,
  })
}

