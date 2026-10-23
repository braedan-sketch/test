import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DataTexture,
  FogExp2,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  UnsignedByteType,
  type Scene,
} from 'three'
import { lerp } from './math'
import type { Quality } from './quality'

const FIELD = new Color('#b8bfc5')
const VOID = new Color('#6d757b')
const RINGS = new Color('#5c656c')
const FIGURE = new Color('#d4dbe1')

// Camera looks from +Z, so the snow in front of the entrance is positive Z.
const CRATERS: Array<[number, number, number, number]> = [
  [3.6, 6.4, 2.1, 0.32],
  [-3.2, 7.2, 1.7, 0.24],
  [1.1, 11.6, 2.5, 0.38],
  [-6.4, 12.4, 2.3, 0.34],
  [8.2, 14.2, 2.8, 0.46],
  [-1.4, 5.4, 1.35, 0.16],
  [12.5, 9.4, 2.4, 0.3],
  [-11.2, 16.5, 3.2, 0.42],
]

const ROCKS: Array<[number, number, number, number]> = [
  [2.4, 5.6, 2.1, 0.62],
  [-2.8, 5.1, 1.7, 0.48],
  [0.6, 8.6, 2.4, 0.72],
  [-5.6, 8.8, 2.5, 0.78],
  [6.4, 7.4, 2.2, 0.58],
  [3.2, 12.4, 2.8, 0.86],
  [-1.8, 13.6, 2.1, 0.54],
  [9.4, 13.2, 3.0, 0.92],
  [-8.6, 11.8, 2.6, 0.7],
  [4.6, 16.6, 3.1, 0.84],
  [-4.8, 17.4, 2.8, 0.74],
  [13.2, 7.2, 2.6, 0.66],
  [-12.4, 7.8, 2.3, 0.58],
  [0.4, 19.2, 3.4, 0.9],
  [7.8, 4.6, 1.8, 0.46],
  [-6.8, 4.4, 1.9, 0.5],
]

function smooth(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function sampleHeight(x: number, z: number) {
  const radius = Math.hypot(x, z)
  // Mounds, not view-aligned ridges. A z-only wave turns into horizontal bands at this camera.
  let height = Math.sin(x * 0.16 + 0.4) * Math.sin(z * 0.13 + 1.1) * 0.72
  height += Math.sin(x * 0.045 + 0.8) * Math.cos(z * 0.038 - 0.3) * 1.05
  height += Math.sin(x * 0.28 - z * 0.09) * Math.cos(x * 0.07 + z * 0.19) * 0.26
  const ang = Math.atan2(z, x)
  const far = smooth(26, 58, radius)
  const ridge = Math.max(0, Math.sin(ang * 2.2 + 0.6) * 0.7 + Math.sin(ang * 4.6 + 1.3) * 0.38)
  height += ridge * far * (5.5 + Math.sin(ang * 1.15 + 0.4) * 2.4)
  for (const [cx, cz, rad, depth] of CRATERS) {
    const d = Math.hypot(x - cx, z - cz)
    const bowl = Math.exp(-((d / rad) ** 2) * 1.8) * depth
    const rim = Math.exp(-(((d - rad * 0.85) / (rad * 0.28)) ** 2)) * depth * 0.35
    height += rim - bowl
  }
  for (const [cx, cz, rad, heightRock] of ROCKS) {
    const d = Math.hypot(x - cx, z - cz)
    height += Math.exp(-((d / rad) ** 2) * 1.35) * heightRock
  }
  const pad = Math.exp(-radius * radius * 0.2)
  return height * (1 - pad * 0.97)
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number) => void
}

export function createWorld(scene: Scene, quality: Quality): World {
  const fog = new FogExp2(FIELD.clone(), 0.034)
  scene.fog = fog
  scene.add(buildSky())

  const segments = quality.low ? 120 : 400
  const geometry = new PlaneGeometry(340, 340, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  if (!position) throw new Error('Terrain is missing positions')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, sampleHeight(x, z))
  }
  geometry.computeVertexNormals()
  const detail = createDetailTexture()
  const terrainMat = new MeshStandardMaterial({
    color: '#c5ccd1',
    roughness: 1,
    metalness: 0,
  })
  terrainMat.customProgramCacheKey = () => 'blendy-snow-v3'
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRock;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRock = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRock;
        uniform sampler2D uDetail;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          vec2 xz = vRock.xz;
          vec4 a = texture2D(uDetail, xz * 0.55 + vec2(0.2, 0.5));
          vec4 b = texture2D(uDetail, xz * vec2(0.89, 0.81) + vec2(13.1, 4.4));
          float mask = texture2D(uDetail, xz * vec2(0.013, 0.017) + vec2(2.0, 6.0)).a;
          vec4 s = mix(a, b, smoothstep(0.25, 0.75, mask));
          float fw = max(fwidth(xz.x), fwidth(xz.y));
          float fade = 1.0 - smoothstep(0.4, 2.4, fw * 8.0);
          vec2 grad = (s.gb - 0.5) * fade;
          normal = normalize(normal + vec3(-grad.x, 1.25, -grad.y) * 0.32);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 xz = vRock.xz;
        vec4 a = texture2D(uDetail, xz * 0.55 + vec2(0.2, 0.5));
        vec4 b = texture2D(uDetail, xz * vec2(0.89, 0.81) + vec2(13.1, 4.4));
        float mask = texture2D(uDetail, xz * vec2(0.013, 0.017) + vec2(2.0, 6.0)).a;
        float grain = mix(a.r, b.r, smoothstep(0.25, 0.75, mask)) - 0.5;
        float fw = max(fwidth(xz.x), fwidth(xz.y));
        float fade = 1.0 - smoothstep(0.4, 2.4, fw * 8.0);
        float macro = sin(xz.x * 0.085 + 0.7) * sin(xz.y * 0.063 - 0.4);
        float broad = sin(xz.x * 0.027 + xz.y * 0.021 + 1.4);
        float cover = macro * 0.55 + broad * 0.45;
        vec3 snowCol = vec3(0.40, 0.43, 0.46);
        vec3 rockCol = vec3(0.23, 0.25, 0.27);
        diffuseColor.rgb = mix(snowCol, rockCol, smoothstep(-0.08, 0.66, cover));
        diffuseColor.rgb *= 1.0 + grain * 0.08 * fade;`,
      )
  }
  const terrain = new Mesh(geometry, terrainMat)
  terrain.receiveShadow = quality.shadows
  terrain.frustumCulled = false
  scene.add(terrain)

  const snow = buildSnow(quality.snow)
  scene.add(snow.points)

  const sky = scene.children.find((child) => child.name === 'sky')
  const skyMat = sky instanceof Mesh ? (sky.material as ShaderMaterial) : null

  return {
    fog,
    update(time, mood) {
      const color = fogColor(mood)
      fog.color.copy(color)
      fog.density = fogDensity(mood)
      if (skyMat) skyMat.uniforms.uMood!.value = mood
      terrain.visible = mood < 0.45
      snow.points.visible = mood < 0.85
      const attr = snow.points.geometry.getAttribute('position')
      if (attr && snow.points.visible) {
        for (let i = 0; i < snow.count; i += 1) {
          let y = snow.base[i] ?? 0
          y += time * (0.15 + (snow.speed[i] ?? 0.2))
          const span = 8
          y = ((y % span) + span) % span
          attr.setY(i, y * 0.35 + 0.4)
          attr.setX(i, (snow.x[i] ?? 0) + Math.sin(time * 0.15 + i) * 0.08)
        }
        attr.needsUpdate = true
      }
    },
  }
}

function createDetailTexture() {
  const size = 256
  const cellsFor = (octave: number) => 16 * 2 ** octave
  const hash = (ix: number, iy: number) => {
    const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453
    return n - Math.floor(n)
  }
  const noise = (u: number, v: number, cells: number) => {
    const x = u * cells
    const y = v * cells
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = x - x0
    const ty = y - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const wrap = (n: number) => ((n % cells) + cells) % cells
    const sample = (ox: number, oy: number) => hash(wrap(x0 + ox), wrap(y0 + oy))
    return (
      sample(0, 0) * (1 - sx) * (1 - sy) +
      sample(1, 0) * sx * (1 - sy) +
      sample(0, 1) * (1 - sx) * sy +
      sample(1, 1) * sx * sy
    )
  }
  const fbm = (u: number, v: number) => {
    let sum = 0
    let amp = 0.5
    let norm = 0
    for (let octave = 0; octave < 5; octave += 1) {
      sum += noise(u, v, cellsFor(octave)) * amp
      norm += amp
      amp *= 0.5
    }
    return sum / norm
  }
  const heights = new Float32Array(size * size)
  const low = new Float32Array(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      heights[i] = fbm(u, v)
      low[i] = noise(u, v, 4)
    }
  }
  const data = new Uint8Array(size * size * 4)
  const wrap = (n: number) => (n + size) % size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x
      const hL = heights[y * size + wrap(x - 1)] ?? 0
      const hR = heights[y * size + wrap(x + 1)] ?? 0
      const hD = heights[wrap(y - 1) * size + x] ?? 0
      const hU = heights[wrap(y + 1) * size + x] ?? 0
      const gx = (hR - hL) * 4.2
      const gy = (hU - hD) * 4.2
      const o = i * 4
      data[o] = Math.round(Math.min(1, Math.max(0, heights[i] ?? 0)) * 255)
      data[o + 1] = Math.round(Math.min(1, Math.max(0, gx * 0.5 + 0.5)) * 255)
      data[o + 2] = Math.round(Math.min(1, Math.max(0, gy * 0.5 + 0.5)) * 255)
      data[o + 3] = Math.round(Math.min(1, Math.max(0, low[i] ?? 0)) * 255)
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

function buildSky() {
  const material = new ShaderMaterial({
    name: 'sky',
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uMood: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uMood;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float ang = atan(d.z, d.x);
        float ridge = sin(ang * 1.7 + 0.4) * 0.62 + sin(ang * 3.4 + 1.1) * 0.34 + sin(ang * 6.6 + 0.3) * 0.16;
        vec3 haze = vec3(0.48, 0.52, 0.56);
        vec3 zenith = vec3(0.30, 0.36, 0.42);
        vec3 field = mix(haze, zenith, smoothstep(0.02, 0.62, h));
        float crest = 0.13 + ridge * 0.22;
        float peaks = smoothstep(crest + 0.07, crest - 0.05, h);
        float ridgeShade = 0.7 + 0.3 * sin(ang * 3.1 + 0.8);
        vec3 ridgeCol = mix(haze, vec3(0.24, 0.28, 0.32), 0.7 * ridgeShade);
        field = mix(field, ridgeCol, peaks * (1.0 - smoothstep(0.12, 1.15, uMood)));
        vec3 voidCol = vec3(0.40, 0.43, 0.46);
        float grid = 0.0;
        if (uMood > 0.45 && uMood < 1.6) {
          vec2 cell = abs(fract(vec2(atan(d.z, d.x) * 8.0, h * 18.0)) - 0.5);
          grid = 1.0 - smoothstep(0.04, 0.09, min(cell.x, cell.y));
          voidCol += vec3(0.08) * grid;
        }
        float down = smoothstep(0.35, -0.9, h);
        vec3 rings = mix(vec3(0.34, 0.37, 0.40), vec3(0.22, 0.24, 0.27), down);
        vec3 figure = vec3(0.66, 0.70, 0.75);
        vec3 color = field;
        float m = clamp(uMood, 0.0, 3.0);
        color = mix(color, voidCol, clamp(m, 0.0, 1.0));
        color = mix(color, rings, clamp(m - 1.0, 0.0, 1.0));
        color = mix(color, figure, clamp(m - 2.0, 0.0, 1.0));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(180, 32, 20), material)
  sky.name = 'sky'
  sky.frustumCulled = false
  return sky
}

function buildSnow(count: number) {
  const positions = new Float32Array(count * 3)
  const base: number[] = []
  const speed: number[] = []
  const x: number[] = []
  const z: number[] = []
  for (let i = 0; i < count; i += 1) {
    const px = (Math.random() - 0.5) * 36
    const py = Math.random()
    const pz = (Math.random() - 0.5) * 36
    positions[i * 3] = px
    positions[i * 3 + 1] = py * 3
    positions[i * 3 + 2] = pz
    x.push(px)
    z.push(pz)
    base.push(py * 8)
    speed.push(0.12 + Math.random() * 0.35)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const points = new Points(
    geometry,
    new PointsMaterial({
      color: '#f4f7f8',
      size: 0.035,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  return { points, count, base, speed, x, z }
}

const moodColor = new Color()

function fogColor(mood: number) {
  if (mood <= 1) return moodColor.copy(FIELD).lerp(VOID, mood)
  if (mood <= 2) return moodColor.copy(VOID).lerp(RINGS, mood - 1)
  return moodColor.copy(RINGS).lerp(FIGURE, Math.min(1, mood - 2))
}

function fogDensity(mood: number) {
  if (mood <= 1) return lerp(0.014, 0.012, mood)
  if (mood <= 2) return lerp(0.012, 0.004, mood - 1)
  return lerp(0.004, 0.026, Math.min(1, mood - 2))
}
