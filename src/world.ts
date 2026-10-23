import {
  BufferGeometry,
  Color,
  DataTexture,
  FogExp2,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  UnsignedByteType,
  type Scene,
} from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { fitHero, loadHero } from './heroModel'
import type { Quality } from './quality'

const HAZE = new Color('#1a222a')

// Camera looks from +Z, so the snow in front of the entrance is positive Z.
const CRATERS: Array<[number, number, number, number]> = [
  [3.6, 6.4, 2.1, 0.32],
  [-3.2, 7.2, 1.7, 0.24],
  [1.1, 11.6, 2.5, 0.38],
  [-6.4, 12.4, 2.3, 0.34],
  [8.2, 14.2, 2.8, 0.46],
  [-1.4, 5.4, 1.35, 0.16],
  [0.9, 3.8, 1.9, 0.62],
  [-2.2, 6.8, 1.6, 0.48],
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
  [1.6, 4.6, 1.7, 0.55],
  [-1.4, 5.8, 1.5, 0.42],
  [3.0, 7.4, 1.9, 0.6],
  [-2.8, 8.2, 1.6, 0.46],
  [0.2, 9.6, 2.1, 0.64],
]

// Small stones in the foreground snow, in front of the entrance (+Z).
const PEBBLES: Array<[number, number, number, number]> = [
  [0.7, 3.4, 0.32, 0.11],
  [-0.9, 3.1, 0.24, 0.08],
  [1.8, 4.2, 0.38, 0.13],
  [-1.6, 4.6, 0.28, 0.09],
  [0.2, 5.2, 0.22, 0.07],
  [2.6, 5.8, 0.3, 0.1],
  [-2.4, 6.2, 0.34, 0.11],
  [1.1, 6.8, 0.2, 0.06],
  [-0.4, 2.6, 0.26, 0.08],
  [3.1, 3.6, 0.36, 0.12],
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
    const bowl = Math.exp(-((d / rad) ** 2) * 1.8) * depth * 1.85
    const rim = Math.exp(-(((d - rad * 0.85) / (rad * 0.28)) ** 2)) * depth * 0.7
    height += rim - bowl
  }
  for (const [cx, cz, rad, heightRock] of ROCKS) {
    const d = Math.hypot(x - cx, z - cz)
    height += Math.exp(-((d / rad) ** 2) * 1.35) * heightRock * 1.3
  }
  for (const [cx, cz, rad, heightRock] of PEBBLES) {
    const d = Math.hypot(x - cx, z - cz)
    height += Math.exp(-((d / rad) ** 2) * 1.6) * heightRock
  }
  // Screen-right is +X from this camera, so the snow rises that way.
  height += x * 0.06 + Math.max(0, -z) * 0.015
  const pad = Math.exp(-radius * radius * 0.2)
  return height * 1.65 * (1 - pad * 0.97)
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number, wire?: number, field?: boolean) => void
}

export function createWorld(scene: Scene, quality: Quality): World {
  const fog = new FogExp2(HAZE.clone(), 0.0032)
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
  terrainMat.customProgramCacheKey = () => 'blendy-snow-v9'
  let terrainMood: { value: number } | null = null
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail }
    shader.uniforms.uMood = { value: 0 }
    terrainMood = shader.uniforms.uMood as { value: number }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRock;\nvarying vec3 vWorldN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRock = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldN = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRock;
        varying vec3 vWorldN;
        uniform sampler2D uDetail;
        uniform float uMood;`,
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
          vec4 c = texture2D(uDetail, xz * 2.6 + vec2(3.2, 8.7));
          float fw = max(fwidth(xz.x), fwidth(xz.y));
          float fade = 1.0 - smoothstep(0.4, 2.4, fw * 8.0);
          float pebbleFade = 1.0 - smoothstep(0.12, 0.85, fw * 8.0);
          vec2 grad = (s.gb - 0.5) * fade * 1.2 + (c.gb - 0.5) * pebbleFade * 0.95;
          normal = normalize(normal + vec3(-grad.x, 0.5, -grad.y));
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
        float pebble = texture2D(uDetail, xz * 2.6 + vec2(3.2, 8.7)).r - 0.5;
        float grit = texture2D(uDetail, xz * 0.2 + vec2(1.4, 2.7)).r;
        float fw = max(fwidth(xz.x), fwidth(xz.y));
        float fade = 1.0 - smoothstep(0.4, 2.4, fw * 8.0);
        float pebbleFade = 1.0 - smoothstep(0.12, 0.85, fw * 8.0);
        float macro = sin(xz.x * 0.085 + 0.7) * sin(xz.y * 0.063 - 0.4);
        float broad = sin(xz.x * 0.027 + xz.y * 0.021 + 1.4);
        vec3 rockCol = vec3(0.07, 0.08, 0.09);
        vec3 snowCol = vec3(0.78, 0.82, 0.86);
        float cover = macro * 0.55 + broad * 0.35 + (grit - 0.5) * 1.35 + grain * fade * 0.7 + pebble * pebbleFade * 0.45;
        float slope = 1.0 - clamp(vWorldN.y, 0.0, 1.0);
        float drift = smoothstep(0.15, 0.72, cover) * (1.0 - smoothstep(0.28, 0.72, slope));
        diffuseColor.rgb = mix(rockCol, snowCol, drift);
        diffuseColor.rgb *= 0.55 + grit * 0.28 + abs(grain) * fade * 0.16;
        float sun = clamp(dot(normalize(vWorldN), normalize(vec3(0.32, 0.88, 0.28))), 0.0, 1.0);
        diffuseColor.rgb *= mix(0.18, 1.05, sun);
        diffuseColor.rgb += vec3(0.95) * pow(sun, 28.0) * drift * 0.55;`,
      )
  }
  const terrain = new Mesh(geometry, terrainMat)
  terrain.receiveShadow = quality.shadows
  terrain.frustumCulled = false
  scene.add(terrain)

  const groundWire = buildGroundWire()
  scene.add(groundWire.root)

  const snow = buildSnow(quality.snow)
  scene.add(snow.points)
  const ranges = new Group()
  ranges.name = 'ranges'
  scene.add(ranges)
  mountRanges(ranges)

  const sky = scene.children.find((child) => child.name === 'sky')
  const skyMat = sky instanceof Mesh ? (sky.material as ShaderMaterial) : null

  return {
    fog,
    update(time, mood, wire = 0, field = true) {
      const color = fogColor(mood)
      fog.color.copy(color)
      fog.density = wire > 0.5 ? 0.0004 : fogDensity(mood)
      if (wire > 0.5) fog.color.set('#9aa6b0')
      if (skyMat) {
        skyMat.uniforms.uMood!.value = mood
        skyMat.uniforms.uWire!.value = wire
      }
      if (terrainMood) terrainMood.value = mood
      // The displaced sheet is the Field only. In the rift it folds into a white blade.
      terrain.visible = field && wire < 0.45
      groundWire.root.visible = field && wire > 0.15
      groundWire.setOpacity(Math.min(1, Math.max(0, (wire - 0.15) / 0.5)))
      snow.points.visible = field && wire < 0.4
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
    uniforms: { uMood: { value: 0 }, uWire: { value: 0 } },
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
      uniform float uWire;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float ang = atan(d.z, d.x);
        vec3 haze = vec3(0.58, 0.64, 0.70);
        vec3 zenith = vec3(0.20, 0.26, 0.34);
        vec3 color = mix(haze, zenith, smoothstep(-0.04, 0.55, h));
        float n1 = sin(ang * 2.1 + 0.4) * 0.55 + sin(ang * 4.6 + 1.2) * 0.28 + sin(ang * 9.0 + 0.3) * 0.14;
        float n2 = sin(ang * 3.3 + 2.0) * 0.48 + sin(ang * 7.1 + 0.6) * 0.24 + sin(ang * 13.0 + 1.4) * 0.12;
        float n3 = sin(ang * 5.2 + 0.8) * 0.42 + sin(ang * 11.4 + 2.2) * 0.2;
        float crestFar = -0.02 + n1 * 0.11;
        float crestMid = 0.045 + n2 * 0.09;
        float crestNear = 0.11 + n3 * 0.07;
        float farM = smoothstep(crestFar + 0.02, crestFar - 0.012, h);
        float midM = smoothstep(crestMid + 0.016, crestMid - 0.01, h);
        float nearM = smoothstep(crestNear + 0.014, crestNear - 0.008, h);
        float shade = 0.35 + 0.65 * sin(ang * 3.1 + 0.8);
        vec3 snowCap = vec3(0.72, 0.76, 0.80);
        vec3 rock = vec3(0.10, 0.12, 0.15);
        vec3 farCol = mix(rock, snowCap, smoothstep(crestFar - 0.03, crestFar + 0.01, h) * 0.35);
        farCol = mix(vec3(0.28, 0.33, 0.40), farCol, shade);
        vec3 midCol = mix(rock * 0.7, snowCap, smoothstep(crestMid - 0.025, crestMid, h));
        midCol *= 0.55 + shade * 0.5;
        vec3 nearCol = mix(vec3(0.05, 0.06, 0.07), snowCap, smoothstep(crestNear - 0.02, crestNear, h));
        nearCol *= 0.45 + shade * 0.55;
        color = mix(color, farCol, farM * 0.72);
        color = mix(color, midCol, midM * 0.88);
        color = mix(color, nearCol, nearM * 0.95);
        float mist = smoothstep(0.08, -0.25, h);
        color = mix(color, haze, mist * 0.55);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(180, 32, 20), material)
  sky.name = 'sky'
  sky.frustumCulled = false
  return sky
}

function gridHeight(x: number, z: number) {
  const radius = Math.hypot(x, z)
  let height = Math.sin(x * 0.16 + 0.4) * Math.sin(z * 0.13 + 1.1) * 0.55
  height += Math.sin(x * 0.045 + 0.8) * Math.cos(z * 0.038 - 0.3) * 0.7
  height += Math.sin(x * 0.28 - z * 0.09) * Math.cos(x * 0.07 + z * 0.19) * 0.08
  // The snow rises to screen-right. Ease it so the far grid does not kink.
  height += Math.tanh(x * 0.09) * 0.35 + Math.max(0, -z) * 0.01
  const pad = Math.exp(-radius * radius * 0.2)
  return height * (1 - pad * 0.97)
}

function edgeFade(x: number, z: number) {
  const d = Math.hypot(x, z)
  const t = Math.min(1, Math.max(0, (d - 5) / 18))
  const s = t * t * (3 - 2 * t)
  return 1 - s
}

function buildGroundWire() {
  const root = new Group()
  // Even XZ courses, sampled onto the snow. No triangle diagonals.
  const step = 0.85
  const extent = 26
  const positions: number[] = []
  const colors: number[] = []
  // Broad snow only. Rock and pebble spikes turn the grid into sliver triangles.
  const yAt = (x: number, z: number) => gridHeight(x, z) + 0.045
  const push = (x0: number, z0: number, x1: number, z1: number) => {
    const fade = edgeFade((x0 + x1) * 0.5, (z0 + z1) * 0.5)
    if (fade < 0.04) return
    positions.push(x0, yAt(x0, z0), z0, x1, yAt(x1, z1), z1)
    colors.push(fade, fade, fade, fade, fade, fade)
  }
  for (let x = -extent; x <= extent + 1e-4; x += step) {
    for (let z = -extent; z < extent - 1e-4; z += step) push(x, z, x, Math.min(extent, z + step))
  }
  for (let z = -extent; z <= extent + 1e-4; z += step) {
    for (let x = -extent; x < extent - 1e-4; x += step) push(x, z, Math.min(extent, x + step), z)
  }
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(positions)
  geometry.setColors(colors)
  const lineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 1.15,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    fog: false,
    worldUnits: false,
  })
  lineMat.toneMapped = false
  const lines = new LineSegments2(geometry, lineMat)
  lines.frustumCulled = false
  root.add(lines)

  root.visible = false
  return {
    root,
    setOpacity(amount: number) {
      lineMat.opacity = amount
    },
  }
}

function mountRanges(ranges: Group) {
  // Empty until Blender delivers the mesh. The sky shader is the shared range until then.
  void loadHero('/models/mountains.glb').then((hero) => {
    if (!hero) return
    fitHero(hero, 86, 'floor')
    ranges.clear()
    ranges.add(hero)
  })
}

function buildSnow(count: number) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
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
    sizes[i] = 0.65 + Math.random() * 1.1
    x.push(px)
    z.push(pz)
    base.push(py * 8)
    speed.push(0.12 + Math.random() * 0.35)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
  const points = new Points(
    geometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: true,
      depthTest: true,
      fog: false,
      uniforms: { uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uPixel;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(0.4, -mv.z);
          gl_PointSize = clamp(uPixel * aSize * (160.0 / dist), 8.0, 26.0);
        }
      `,
      fragmentShader: /* glsl */ `
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          float soft = exp(-r * r * 14.0) * smoothstep(0.5, 0.28, r);
          if (soft < 0.02) discard;
          gl_FragColor = vec4(vec3(0.94, 0.97, 1.0), soft * 0.7);
        }
      `,
    }),
  )
  points.frustumCulled = false
  return { points, count, base, speed, x, z }
}

const moodColor = new Color()
const FAR_HAZE = new Color('#10161c')

function fogColor(mood: number) {
  return moodColor.copy(HAZE).lerp(FAR_HAZE, mood > 1.15 ? 0.35 : 0)
}

function fogDensity(mood: number) {
  return mood > 1.2 ? 0.004 : 0.0032
}
