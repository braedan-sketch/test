import {
  AdditiveBlending,
  type Blending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
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
 * Many short frost scratches on a cool, nearly clear disc. A handful of strokes
 * disappeared at DPR 1.
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
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLattice;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLattice = transformed;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLattice;
        float hash11(float n) {
          return fract(sin(n * 127.1) * 43758.5453);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          vec2 p = vLattice.xy;
          float radius = length(p);
          float disc = 1.0 - smoothstep(1.2, 1.46, radius);
          float scratch = 0.0;
          for (int i = 0; i < 110; i++) {
            float seed = float(i) + 1.7;
            float ang = hash11(seed * 1.7) * 6.28318;
            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 origin = vec2(hash11(seed * 4.1), hash11(seed * 9.3)) * 2.3 - 1.15;
            vec2 rel = p - origin;
            float along = dot(rel, dir);
            float across = abs(dot(rel, vec2(-dir.y, dir.x)));
            float halfLen = 0.05 + hash11(seed * 2.9) * 0.22;
            float alongMask = 1.0 - smoothstep(halfLen * 0.55, halfLen, abs(along));
            float width = 0.0016 + hash11(seed * 6.1) * 0.0028;
            float acrossMask = 1.0 - smoothstep(width, width * 2.1, across);
            scratch = max(scratch, alongMask * acrossMask * (0.55 + hash11(seed * 8.8) * 0.45));
          }
          gl_FragColor.rgb = vec3(0.70, 0.76, 0.84);
          gl_FragColor.a = disc * max(scratch * 0.92, 0.075);
        }`,
      )
  }
  material.customProgramCacheKey = () => 'lattice-disc-v10'
  return material
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

