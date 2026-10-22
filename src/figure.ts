import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  TorusGeometry,
} from 'three'
import type { Quality } from './quality'

export type Figure = {
  group: Group
  update: (appear: number, blow: number, time: number, pixelRatio: number) => void
}

/** Original point-cloud arctic fox. Built from ellipsoids, not a borrowed character. */
export function createFigure(quality: Quality): Figure {
  const count = quality.points
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const rand = mulberry(11)
  let cursor = 0

  const push = (x: number, y: number, z: number) => {
    if (cursor >= count) return
    positions[cursor * 3] = x
    positions[cursor * 3 + 1] = y
    positions[cursor * 3 + 2] = z
    seeds[cursor] = rand()
    cursor += 1
  }

  const weights = [
    { n: 0.2, sample: () => ellipsoid(0, 0.58, -0.02, 0.32, 0.24, 0.62, rand) },
    { n: 0.07, sample: () => ellipsoid(0, 0.66, 0.38, 0.22, 0.18, 0.24, rand) },
    { n: 0.04, sample: () => ellipsoid(0, 0.86, 0.55, 0.13, 0.15, 0.16, rand) },
    { n: 0.12, sample: () => ellipsoid(0, 1.08, 0.78, 0.2, 0.18, 0.26, rand) },
    { n: 0.05, sample: () => ellipsoid(0, 1.0, 1.08, 0.08, 0.065, 0.22, rand) },
    { n: 0.015, sample: () => ellipsoid(0, 0.98, 1.26, 0.03, 0.028, 0.03, rand) },
    { n: 0.045, sample: () => cone(-0.09, 1.24, 0.68, 0.075, 0.34, rand) },
    { n: 0.045, sample: () => cone(0.09, 1.24, 0.68, 0.075, 0.34, rand) },
    { n: 0.035, sample: () => ellipsoid(-0.16, 0.28, 0.28, 0.055, 0.18, 0.055, rand) },
    { n: 0.035, sample: () => ellipsoid(0.16, 0.28, 0.28, 0.055, 0.18, 0.055, rand) },
    { n: 0.035, sample: () => ellipsoid(-0.16, 0.26, -0.2, 0.06, 0.17, 0.06, rand) },
    { n: 0.035, sample: () => ellipsoid(0.16, 0.26, -0.2, 0.06, 0.17, 0.06, rand) },
  ]

  const tailShare = 0.22
  const bodyShare = weights.reduce((sum, item) => sum + item.n, 0)
  const bodyBudget = Math.floor(count * (1 - tailShare))
  for (const item of weights) {
    const amount = Math.floor((bodyBudget * item.n) / bodyShare)
    for (let i = 0; i < amount; i += 1) {
      const point = item.sample()
      push(point[0], point[1], point[2])
    }
  }
  const tailCount = count - cursor
  for (let i = 0; i < tailCount; i += 1) {
    const t = rand()
    const y = 0.42 + Math.sin(t * 1.15) * 1.05
    const z = -0.62 + Math.sin(t * 0.8) * 0.12
    const x = 0.08 + t * 0.55
    const rad = 0.2 * (1 - t * 0.4)
    const point = ellipsoid(x, y, z, rad * 0.85, rad, rad * 0.9, rand)
    push(point[0], point[1], point[2])
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
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
        float gate = smoothstep(aSeed * 0.7, aSeed * 0.7 + 0.3, uAppear);
        vec3 p = position;
        float s = sin(uTime * 1.6 + aSeed * 28.0);
        float c = cos(uTime * 1.25 + aSeed * 17.0);
        p.x += s * 0.012;
        p.y += c * 0.015;
        p.z += sin(uTime * 1.05 + aSeed * 11.0) * 0.012;
        float lift = uBlow * uBlow;
        p.y += lift * (0.4 + aSeed * 4.4);
        p.x += lift * (aSeed - 0.5) * 2.4;
        p.z += lift * (fract(aSeed * 13.7) - 0.5) * 2.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((3.4 + aSeed * 3.2) * uPixel * (210.0 / max(1.0, -mv.z)), 1.6, 12.0);
        vAlpha = gate * (1.0 - smoothstep(0.42, 1.0, uBlow)) * (0.82 + 0.18 * (0.5 + 0.5 * s));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if (r > 0.5) discard;
        float falloff = smoothstep(0.5, 0.08, r);
        vec3 color = mix(vec3(0.78, 0.86, 0.92), vec3(1.0), falloff);
        gl_FragColor = vec4(color, falloff * vAlpha);
      }
    `,
  })

  const points = new Points(geometry, material)
  const root = new Group()
  root.add(points)
  root.scale.setScalar(1.18)

  const disc = new Mesh(
    new TorusGeometry(1.35, 0.012, 8, 64),
    new MeshBasicMaterial({ color: '#f4f7f8', toneMapped: false }),
  )
  disc.rotation.x = Math.PI / 2
  disc.position.y = 0.02
  const inner = new Mesh(
    new TorusGeometry(0.92, 0.008, 8, 48),
    new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  )
  inner.rotation.x = Math.PI / 2
  inner.position.y = 0.03
  root.add(disc, inner)

  return {
    group: root,
    update(appear, blow, time, pixelRatio) {
      root.visible = appear > 0.01 && blow < 0.995
      material.uniforms.uAppear!.value = appear
      material.uniforms.uBlow!.value = blow
      material.uniforms.uTime!.value = time
      material.uniforms.uPixel!.value = pixelRatio
      disc.visible = blow < 0.2
      inner.visible = blow < 0.35
    },
  }
}

function ellipsoid(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  rand: () => number,
): [number, number, number] {
  const z = rand() * 2 - 1
  const ring = Math.sqrt(Math.max(0, 1 - z * z))
  const phi = rand() * Math.PI * 2
  const shell = 0.82 + rand() * 0.18
  return [cx + Math.cos(phi) * ring * rx * shell, cy + z * ry * shell, cz + Math.sin(phi) * ring * rz * shell]
}

function cone(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  rand: () => number,
): [number, number, number] {
  const h = rand()
  const a = rand() * Math.PI * 2
  const rad = radius * (1 - h)
  return [cx + Math.cos(a) * rad, cy + h * height, cz + Math.sin(a) * rad]
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
