import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  TorusGeometry,
} from 'three'
import type { Quality } from './quality'

export type Figure = {
  group: Group
  update: (appear: number, blow: number, time: number, pixelRatio: number) => void
}

type Surf = { pos: number[]; idx: number[] }

/**
 * Point cloud sampled from an original low-poly arctic fox.
 * The mesh is a lofted surface (body, neck, skull, snout, tail, legs, ears)
 * so the silhouette stays a fox instead of a stack of blobs.
 */
export function createFigure(quality: Quality): Figure {
  const count = quality.points
  const rand = mulberry(11)
  const surf = buildFox()
  const { positions, seeds, shades } = sampleSurface(surf, count, rand)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
  geometry.setAttribute('aShade', new Float32BufferAttribute(shades, 1))

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uBlow: { value: 0 },
      uAppear: { value: 0 },
      uPixel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aShade;
      uniform float uTime;
      uniform float uBlow;
      uniform float uAppear;
      uniform float uPixel;
      varying float vSeed;
      varying float vShade;
      varying float vAlpha;
      void main() {
        vSeed = aSeed;
        vShade = aShade;
        float gate = smoothstep(aSeed * 0.55, aSeed * 0.55 + 0.28, uAppear);
        vec3 p = position;
        float s = sin(uTime * 1.35 + aSeed * 40.0);
        float c = cos(uTime * 1.1 + aSeed * 23.0);
        p.x += s * 0.0035;
        p.y += c * 0.004;
        p.z += sin(uTime * 0.9 + aSeed * 15.0) * 0.003;
        float lift = uBlow * uBlow;
        p.y += lift * (0.15 + aSeed * 2.8);
        p.x += lift * (aSeed - 0.5) * 0.55;
        p.z += lift * (fract(aSeed * 13.7) - 0.5) * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.28 + aSeed * 0.32) * uPixel * (26.0 / max(1.0, -mv.z)), 0.45, 1.35);
        vAlpha = gate * (1.0 - smoothstep(0.35, 0.96, uBlow)) * (0.78 + 0.22 * (0.5 + 0.5 * s));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vShade;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if (r > 0.5) discard;
        float falloff = smoothstep(0.5, 0.08, r);
        vec3 color = mix(vec3(0.20, 0.23, 0.26), vec3(0.96, 0.98, 1.0), vShade);
        gl_FragColor = vec4(color, falloff * vAlpha * 0.9);
      }
    `,
  })

  const points = new Points(geometry, material)
  const root = new Group()
  root.add(points)
  root.rotation.y = 0.28
  root.scale.setScalar(1)

  const disc = new Mesh(
    new TorusGeometry(0.58, 0.009, 10, 96),
    new MeshBasicMaterial({ color: '#f7fbff', toneMapped: false }),
  )
  disc.rotation.x = Math.PI / 2
  disc.position.y = 0.015
  const inner = new Mesh(
    new TorusGeometry(0.38, 0.005, 8, 80),
    new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  )
  inner.rotation.x = Math.PI / 2
  inner.position.y = 0.02
  const glow = new Mesh(
    new TorusGeometry(0.58, 0.02, 8, 80),
    new MeshBasicMaterial({
      color: '#d5e6f0',
      transparent: true,
      opacity: 0.28,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  glow.rotation.x = Math.PI / 2
  glow.position.y = 0.01
  root.add(disc, inner, glow)

  return {
    group: root,
    update(appear, blow, time, pixelRatio) {
      root.visible = appear > 0.01 && blow < 0.995
      material.uniforms.uAppear!.value = appear
      material.uniforms.uBlow!.value = blow
      material.uniforms.uTime!.value = time
      material.uniforms.uPixel!.value = pixelRatio
      const shown = appear * (1 - Math.min(1, blow * 1.4))
      disc.visible = shown > 0.05
      inner.visible = shown > 0.05
      glow.visible = shown > 0.05
    },
  }
}

function buildFox(): Surf {
  const surf: Surf = { pos: [], idx: [] }
  const segs = 14
  // Wide seated bust: the chest and skull carry the silhouette, the tail stays inside it.
  loft(surf, [
    ring(-0.08, 0.36, 0.52, 0.24, 0.22, segs),
    ring(0.1, 0.55, 0.48, 0.32, 0.22, segs),
    ring(0.18, 0.82, 0.4, 0.3, 0.18, segs),
    ring(0.14, 1.02, 0.2, 0.16, 0.14, segs),
    ring(0.08, 1.26, 0.44, 0.34, 0.28, segs),
    ring(0.36, 1.16, 0.16, 0.11, 0.1, segs),
    ring(0.5, 1.1, 0.05, 0.04, 0.032, segs),
  ])
  loft(surf, [
    ring(0.0, 0.46, 0.12, 0.1, 0.11, 8, 0.32),
    ring(0.08, 0.7, 0.1, 0.09, 0.1, 8, 0.5),
    ring(0.16, 0.92, 0.06, 0.05, 0.05, 8, 0.4),
  ])
  leg(surf, -0.22, 0.08)
  leg(surf, 0.2, 0.1)
  leg(surf, -0.16, -0.12)
  leg(surf, 0.16, -0.1)
  ear(surf, -0.2, 0.06)
  ear(surf, 0.2, 0.08)
  return surf
}

function ring(z: number, cy: number, rx: number, ryTop: number, ryBot: number, segs: number, cx = 0) {
  const pts: number[][] = []
  for (let i = 0; i < segs; i += 1) {
    const a = (i / segs) * Math.PI * 2
    const x = cx + Math.cos(a) * rx
    const s = Math.sin(a)
    const y = cy + (s >= 0 ? s * ryTop : s * ryBot)
    pts.push([x, y, z])
  }
  return pts
}

function loft(surf: Surf, rings: number[][][]) {
  const segs = rings[0]?.length ?? 0
  if (segs < 3) return
  const base = surf.pos.length / 3
  for (const loop of rings) {
    for (const p of loop) surf.pos.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < segs; i += 1) {
      const i2 = (i + 1) % segs
      const a = base + r * segs + i
      const b = base + r * segs + i2
      const c = base + (r + 1) * segs + i2
      const d = base + (r + 1) * segs + i
      surf.idx.push(a, b, c, a, c, d)
    }
  }
}

function leg(surf: Surf, x: number, z: number) {
  const segs = 7
  loft(surf, [
    ring(z, 0.42, 0.055, 0.05, 0.05, segs, x),
    ring(z + 0.04, 0.2, 0.04, 0.04, 0.04, segs, x),
    ring(z + 0.06, 0.04, 0.05, 0.03, 0.03, segs, x),
  ])
}

function ear(surf: Surf, x: number, z: number) {
  const s = x < 0 ? -1 : 1
  loft(surf, [
    ring(z, 1.4, 0.06, 0.045, 0.05, 6, x),
    ring(z - 0.02, 1.56, 0.04, 0.07, 0.03, 6, x + 0.035 * s),
    ring(z - 0.02, 1.7, 0.014, 0.022, 0.012, 6, x + 0.05 * s),
  ])
}

function sampleSurface(surf: Surf, count: number, rand: () => number) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const shades = new Float32Array(count)
  const { pos, idx } = surf
  const areas: number[] = []
  let total = 0
  for (let i = 0; i < idx.length; i += 3) {
    const a = (idx[i] ?? 0) * 3
    const b = (idx[i + 1] ?? 0) * 3
    const c = (idx[i + 2] ?? 0) * 3
    const abx = (pos[b] ?? 0) - (pos[a] ?? 0)
    const aby = (pos[b + 1] ?? 0) - (pos[a + 1] ?? 0)
    const abz = (pos[b + 2] ?? 0) - (pos[a + 2] ?? 0)
    const acx = (pos[c] ?? 0) - (pos[a] ?? 0)
    const acy = (pos[c + 1] ?? 0) - (pos[a + 1] ?? 0)
    const acz = (pos[c + 2] ?? 0) - (pos[a + 2] ?? 0)
    const area = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) * 0.5
    areas.push(area)
    total += area
  }
  const cumulative: number[] = []
  let acc = 0
  for (const area of areas) {
    acc += area
    cumulative.push(acc)
  }
  const tris = Math.max(1, cumulative.length)
  for (let n = 0; n < count; n += 1) {
    const target = rand() * total
    let lo = 0
    let hi = tris - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((cumulative[mid] ?? 0) < target) lo = mid + 1
      else hi = mid
    }
    const tri = lo
    const ia = (idx[tri * 3] ?? 0) * 3
    const ib = (idx[tri * 3 + 1] ?? 0) * 3
    const ic = (idx[tri * 3 + 2] ?? 0) * 3
    let u = rand()
    let v = rand()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    const w = 1 - u - v
    const ax = pos[ia] ?? 0
    const ay = pos[ia + 1] ?? 0
    const az = pos[ia + 2] ?? 0
    const bx = pos[ib] ?? 0
    const by = pos[ib + 1] ?? 0
    const bz = pos[ib + 2] ?? 0
    const cx = pos[ic] ?? 0
    const cy = pos[ic + 1] ?? 0
    const cz = pos[ic + 2] ?? 0
    let x = ax * w + bx * u + cx * v
    let y = ay * w + by * u + cy * v
    let z = az * w + bz * u + cz * v
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const acx = cx - ax
    const acy = cy - ay
    const acz = cz - az
    let nx = aby * acz - abz * acy
    let ny = abz * acx - abx * acz
    let nz = abx * acy - aby * acx
    const nl = Math.hypot(nx, ny, nz) || 1
    const thick = rand() * 0.045
    x -= (nx / nl) * thick
    y -= (ny / nl) * thick
    z -= (nz / nl) * thick
    const light = Math.max(0, (nx / nl) * -0.25 + (ny / nl) * 0.82 + (nz / nl) * 0.45)
    positions[n * 3] = x
    positions[n * 3 + 1] = y
    positions[n * 3 + 2] = z
    seeds[n] = rand()
    shades[n] = 0.08 + light * 0.92
  }
  return { positions, seeds, shades }
}

function mulberry(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
