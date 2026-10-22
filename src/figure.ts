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
  const { positions, seeds } = sampleSurface(surf, count, rand)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))

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
      uniform float uTime;
      uniform float uBlow;
      uniform float uAppear;
      uniform float uPixel;
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vSeed = aSeed;
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
        gl_PointSize = clamp((0.45 + aSeed * 0.55) * uPixel * (46.0 / max(1.0, -mv.z)), 0.65, 2.15);
        vAlpha = gate * (1.0 - smoothstep(0.35, 0.96, uBlow)) * (0.78 + 0.22 * (0.5 + 0.5 * s));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if (r > 0.5) discard;
        float falloff = smoothstep(0.5, 0.12, r);
        vec3 color = mix(vec3(0.86, 0.91, 0.95), vec3(1.0), falloff);
        gl_FragColor = vec4(color, falloff * vAlpha * 0.72);
      }
    `,
  })

  const points = new Points(geometry, material)
  const root = new Group()
  root.add(points)
  root.rotation.y = -0.35
  root.scale.setScalar(1.22)

  const disc = new Mesh(
    new TorusGeometry(0.95, 0.018, 10, 80),
    new MeshBasicMaterial({ color: '#f7fbff', toneMapped: false }),
  )
  disc.rotation.x = Math.PI / 2
  disc.position.y = 0.015
  const inner = new Mesh(
    new TorusGeometry(0.62, 0.01, 8, 64),
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
    new TorusGeometry(0.95, 0.08, 8, 64),
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
  const segs = 12
  loft(surf, [
    ring(-0.48, 0.5, 0.13, 0.11, 0.14, segs),
    ring(-0.22, 0.5, 0.145, 0.12, 0.15, segs),
    ring(0.05, 0.5, 0.13, 0.11, 0.14, segs),
    ring(0.28, 0.52, 0.14, 0.12, 0.15, segs),
    ring(0.44, 0.58, 0.09, 0.09, 0.1, segs),
    ring(0.54, 0.7, 0.06, 0.065, 0.07, segs),
    ring(0.66, 0.82, 0.11, 0.095, 0.1, segs),
    ring(0.82, 0.8, 0.085, 0.075, 0.08, segs),
    ring(1.02, 0.75, 0.038, 0.032, 0.034, segs),
    ring(1.22, 0.72, 0.012, 0.01, 0.011, segs),
  ])
  loft(surf, [
    ring(-0.55, 0.55, 0.08, 0.08, 0.09, 8),
    ring(-0.78, 0.78, 0.11, 0.1, 0.12, 8),
    ring(-0.9, 1.08, 0.09, 0.085, 0.1, 8),
    ring(-0.7, 1.32, 0.05, 0.045, 0.055, 8),
    ring(-0.48, 1.46, 0.015, 0.012, 0.014, 8),
  ])
  leg(surf, -1, 0.32)
  leg(surf, 1, 0.32)
  leg(surf, -1, -0.22)
  leg(surf, 1, -0.22)
  ear(surf, -0.07, 0.66)
  ear(surf, 0.07, 0.66)
  return surf
}

function ring(z: number, cy: number, rx: number, ryTop: number, ryBot: number, segs: number) {
  const pts: number[][] = []
  for (let i = 0; i < segs; i += 1) {
    const a = (i / segs) * Math.PI * 2
    const x = Math.cos(a) * rx
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

function leg(surf: Surf, side: number, z: number) {
  const x = 0.1 * side
  const segs = 7
  loft(surf, [
    ring(z, 0.4, 0.045, 0.045, 0.045, segs).map((p) => [p[0] + x, p[1], p[2]]),
    ring(z + 0.02 * side, 0.2, 0.032, 0.034, 0.034, segs).map((p) => [p[0] + x, p[1], p[2]]),
    ring(z + 0.05, 0.045, 0.04, 0.028, 0.03, segs).map((p) => [p[0] + x, p[1], p[2]]),
  ])
}

function ear(surf: Surf, x: number, z: number) {
  const base = surf.pos.length / 3
  const y = 0.9
  const s = x < 0 ? -1 : 1
  surf.pos.push(
    x - 0.035 * s, y, z - 0.03,
    x + 0.02 * s, y, z - 0.02,
    x + 0.015 * s, y, z + 0.045,
    x - 0.03 * s, y, z + 0.035,
    x + 0.01 * s, y + 0.55, z - 0.02,
  )
  surf.idx.push(
    base, base + 1, base + 4,
    base + 1, base + 2, base + 4,
    base + 2, base + 3, base + 4,
    base + 3, base, base + 4,
  )
}

function sampleSurface(surf: Surf, count: number, rand: () => number) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
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
    const thick = (rand() - 0.5) * 0.02
    x += (nx / nl) * thick
    y += (ny / nl) * thick
    z += (nz / nl) * thick
    positions[n * 3] = x
    positions[n * 3 + 1] = y
    positions[n * 3 + 2] = z
    seeds[n] = rand()
  }
  return { positions, seeds }
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
