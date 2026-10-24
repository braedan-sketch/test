import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  PointLight,
  Points,
  ShaderMaterial,
  TorusGeometry,
} from 'three'
import { loadHero } from './heroModel'
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
export async function createFigure(quality: Quality): Promise<Figure> {
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
    depthWrite: true,
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
      varying float vEye;
      void main() {
        vSeed = aSeed;
        vShade = aShade;
        float gate = smoothstep(aSeed * 0.55, aSeed * 0.55 + 0.28, uAppear);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vEye = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPixel * (22.0 / max(0.45, vEye)), 2.4, 7.0);
        vAlpha = gate * (1.0 - smoothstep(0.85, 1.0, uBlow));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vShade;
      varying float vAlpha;
      varying float vEye;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if (r > 0.46) discard;
        float bead = pow(clamp(1.0 - r * 2.15, 0.0, 1.0), 1.5);
        float depth = smoothstep(1.4, 7.5, vEye);
        float lit = clamp(vShade * (1.0 - depth * 0.35), 0.0, 1.0);
        vec3 color = mix(vec3(0.08, 0.09, 0.11), vec3(0.58, 0.62, 0.66), lit);
        color += vec3(0.08, 0.09, 0.1) * bead * lit;
        gl_FragColor = vec4(color, vAlpha);
      }
    `,
  })

  const points = new Points(geometry, material)
  const root = new Group()
  root.add(points)
  root.scale.setScalar(1)

  const normalMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: true,
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
      varying float vShade;
      varying float vRim;
      varying float vAlpha;
      varying float vEye;
      void main() {
        vSeed = aSeed;
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vec3 viewN = normalize(mat3(normalMatrix) * normal);
        float ndl = dot(n, normalize(vec3(0.72, 0.48, 0.5)));
        float under = smoothstep(0.15, -0.65, n.y);
        float lit = smoothstep(-0.2, 0.78, ndl);
        vShade = clamp(lit * (1.0 - under * 0.75), 0.0, 1.0);
        vRim = pow(1.0 - clamp(abs(viewN.z), 0.0, 1.0), 1.45);
        float gate = smoothstep(aSeed * 0.45, aSeed * 0.45 + 0.22, uAppear);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vEye = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPixel * (28.0 / max(0.4, vEye)), 3.2, 9.0);
        vAlpha = gate * (1.0 - smoothstep(0.85, 1.0, uBlow));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vShade;
      varying float vRim;
      varying float vAlpha;
      varying float vEye;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if (r > 0.46) discard;
        float bead = pow(clamp(1.0 - r * 2.1, 0.0, 1.0), 1.7);
        float depth = smoothstep(1.2, 8.0, vEye);
        float lit = clamp(vShade * (1.0 - depth * 0.12), 0.0, 1.0);
        vec3 color = mix(vec3(0.02, 0.025, 0.035), vec3(0.9, 0.93, 0.97), lit);
        color += vec3(1.0, 0.94, 0.84) * pow(lit, 2.2) * 0.42;
        color += vec3(0.45, 0.72, 1.0) * vRim * 0.95;
        color += vec3(0.12, 0.14, 0.16) * bead * lit;
        gl_FragColor = vec4(color, vAlpha);
      }
    `,
  })
  let active = material

  const plinth = new Group()
  plinth.name = 'plinth'
  const drum = new Mesh(
    new CylinderGeometry(0.34, 0.46, 0.16, 48),
    new MeshStandardMaterial({ color: '#242b32', roughness: 0.58, metalness: 0.08 }),
  )
  drum.position.y = -0.05
  drum.castShadow = true
  drum.receiveShadow = true
  const lip = new Mesh(
    new CylinderGeometry(0.5, 0.42, 0.045, 56),
    new MeshStandardMaterial({ color: '#3c4854', roughness: 0.36, metalness: 0.14 }),
  )
  lip.position.y = 0.03
  plinth.add(drum, lip)
  for (let i = 0; i < 5; i += 1) {
    const ring = new Mesh(
      new TorusGeometry(0.58 + i * 0.13, 0.007 + (i % 2) * 0.005, 8, 96),
      new MeshStandardMaterial({
        color: i % 2 === 0 ? '#d5e4f0' : '#667684',
        roughness: 0.28,
        metalness: 0.18,
        emissive: '#b7cfe2',
        emissiveIntensity: 0.28 - i * 0.04,
      }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.055 + i * 0.006
    plinth.add(ring)
  }
  const key = new PointLight('#fff1dc', 22, 11, 2)
  key.position.set(1.6, 2.8, 2.1)
  const rim = new PointLight('#7eb6e6', 16, 10, 2)
  rim.position.set(-1.8, 1.9, -1.4)
  root.add(plinth, key, rim)

  const turn = new Group()
  root.add(turn)
  const cloud = await loadHero('/models/fox_points.glb', undefined, { eager: true })
  const sampled = cloud?.getObjectByProperty('type', 'Points')
  if (sampled instanceof Points && sampled.geometry.getAttribute('normal')) {
    const source = quality.low ? thinPoints(sampled.geometry, quality.points) : sampled.geometry
    if (source !== sampled.geometry) sampled.geometry = source
    const count = source.getAttribute('position')?.count ?? 0
    const seeds = new Float32Array(count)
    for (let i = 0; i < count; i += 1) seeds[i] = hashUnit(i)
    source.setAttribute('aSeed', new BufferAttribute(seeds, 1))
    sampled.material = normalMaterial
    points.visible = false
    turn.add(sampled)
    turn.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(sampled)
    sampled.position.y += 0.01 - box.min.y
    active = normalMaterial
  }

  return {
    group: root,
    update(appear, blow, time, pixelRatio) {
      // A few degrees, slow. The ring stays put under the bust.
      turn.rotation.y = 0.62 + Math.sin(time * 0.28) * 0.06
      root.visible = appear > 0.01
      active.uniforms.uAppear!.value = appear
      active.uniforms.uBlow!.value = blow
      active.uniforms.uTime!.value = time
      active.uniforms.uPixel!.value = pixelRatio
      const shown = appear * (1 - Math.min(1, blow * 1.4))
      plinth.visible = shown > 0.05
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

function hashUnit(index: number) {
  const n = Math.sin(index * 127.1 + 311.7) * 43758.5453
  return n - Math.floor(n)
}

function thinPoints(geometry: BufferGeometry, keep: number) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return geometry
  const step = Math.max(1, Math.floor(position.count / Math.max(1, keep)))
  const count = Math.ceil(position.count / step)
  const nextPos = new Float32Array(count * 3)
  const nextNrm = new Float32Array(count * 3)
  let write = 0
  for (let i = 0; i < position.count; i += step) {
    nextPos[write * 3] = position.getX(i)
    nextPos[write * 3 + 1] = position.getY(i)
    nextPos[write * 3 + 2] = position.getZ(i)
    nextNrm[write * 3] = normal.getX(i)
    nextNrm[write * 3 + 1] = normal.getY(i)
    nextNrm[write * 3 + 2] = normal.getZ(i)
    write += 1
  }
  const thin = new BufferGeometry()
  thin.setAttribute('position', new Float32BufferAttribute(nextPos, 3))
  thin.setAttribute('normal', new Float32BufferAttribute(nextNrm, 3))
  return thin
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
