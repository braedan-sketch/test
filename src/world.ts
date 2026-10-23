import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DataTexture,
  FogExp2,
  Float32BufferAttribute,
  Group,
  LineSegments,
  WireframeGeometry,
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

const FIELD = new Color('#7d868e')
const VOID = new Color('#2c343c')
const RINGS = new Color('#161b20')
const FIGURE = new Color('#8e979f')

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
  return height * (1 - pad * 0.97)
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number, wire?: number) => void
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
  terrainMat.customProgramCacheKey = () => 'blendy-snow-v6'
  let terrainMood: { value: number } | null = null
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail }
    shader.uniforms.uMood = { value: 0 }
    terrainMood = shader.uniforms.uMood as { value: number }
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
        vec3 rockCol = vec3(0.008, 0.009, 0.011);
        vec3 snowCol = vec3(0.055, 0.060, 0.066);
        float cover = macro * 0.55 + broad * 0.35 + (grit - 0.5) * 1.35 + grain * fade * 0.7 + pebble * pebbleFade * 0.45;
        diffuseColor.rgb = mix(rockCol, snowCol, smoothstep(-0.25, 0.45, cover));
        diffuseColor.rgb *= 0.62 + grit * 0.85 + abs(grain) * fade * 0.45;
        float voidMix = smoothstep(0.4, 1.0, uMood) * (1.0 - smoothstep(1.15, 1.55, uMood));
        float ringsMix = smoothstep(1.35, 1.9, uMood) * (1.0 - smoothstep(2.05, 2.55, uMood));
        vec2 cell = abs(fract(xz * 0.55) - 0.5);
        float line = 1.0 - smoothstep(0.012, 0.035, min(cell.x, cell.y));
        vec3 floorCol = mix(vec3(0.58, 0.59, 0.61), vec3(0.32, 0.33, 0.35), line);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.033, 0.038), voidMix);
        diffuseColor.rgb = mix(diffuseColor.rgb, floorCol, ringsMix);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, floorCol, ringsMix);`,
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

  const sky = scene.children.find((child) => child.name === 'sky')
  const skyMat = sky instanceof Mesh ? (sky.material as ShaderMaterial) : null

  return {
    fog,
    update(time, mood, wire = 0) {
      const color = fogColor(mood)
      fog.color.copy(color)
      fog.density = wire > 0.5 ? 0.001 : fogDensity(mood)
      if (wire > 0.5) fog.color.set('#c5c8cc')
      if (skyMat) {
        skyMat.uniforms.uMood!.value = mood
        skyMat.uniforms.uWire!.value = wire
      }
      if (terrainMood) terrainMood.value = mood
      // The snow field is the igloo ground. Rings and the crystal sit on the sky instead, so the mesh cannot cover them.
      terrain.visible = mood < 0.45 && wire < 0.45
      groundWire.root.visible = wire > 0.15
      groundWire.setOpacity(Math.min(1, Math.max(0, (wire - 0.15) / 0.5)))
      snow.points.visible = mood < 0.85 && wire < 0.4
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
        float ridge = sin(ang * 1.7 + 0.4) * 0.62 + sin(ang * 3.4 + 1.1) * 0.34 + sin(ang * 6.6 + 0.3) * 0.16;
        vec3 haze = vec3(0.26, 0.29, 0.32);
        vec3 zenith = vec3(0.12, 0.14, 0.18);
        vec3 field = mix(haze, zenith, smoothstep(0.0, 0.55, h));
        float crest = 0.16 + ridge * 0.24;
        float peaks = smoothstep(crest + 0.06, crest - 0.06, h);
        float ridgeShade = 0.35 + 0.65 * sin(ang * 3.1 + 0.8);
        vec3 ridgeCol = mix(vec3(0.20, 0.23, 0.26), vec3(0.08, 0.09, 0.11), ridgeShade);
        field = mix(field, ridgeCol, peaks * (1.0 - smoothstep(0.12, 1.15, uMood)));
        vec3 voidCol = vec3(0.58, 0.59, 0.61);
        float grid = 0.0;
        float dots = 0.0;
        if (uMood > 0.45 && uMood < 1.7) {
          vec2 gv = vec2(atan(d.z, d.x) * 18.0, h * 26.0);
          vec2 cell = abs(fract(gv) - 0.5);
          dots = 1.0 - smoothstep(0.06, 0.14, length(cell));
          voidCol = mix(voidCol, vec3(0.28, 0.30, 0.33), dots * 0.85);
        }
        if (uMood > 1.15 && uMood < 2.4) {
          vec2 cell = abs(fract(vec2(atan(d.z, d.x) * 10.0, h * 18.0)) - 0.5);
          grid = 1.0 - smoothstep(0.015, 0.04, min(cell.x, cell.y));
        }
        float down = smoothstep(0.35, -0.9, h);
        vec3 rings = mix(vec3(0.62, 0.63, 0.65), vec3(0.50, 0.51, 0.53), down);
        rings = mix(rings, vec3(0.34, 0.35, 0.37), grid * 0.65);
        vec3 figure = vec3(0.20, 0.205, 0.215);
        vec3 color = field;
        float m = clamp(uMood, 0.0, 3.0);
        color = mix(color, voidCol, clamp(m, 0.0, 1.0));
        color = mix(color, rings, clamp(m - 1.0, 0.0, 1.0));
        color = mix(color, figure, clamp(m - 2.0, 0.0, 1.0));
        vec3 paper = vec3(0.36, 0.37, 0.39);
        color = mix(color, paper, clamp(uWire, 0.0, 1.0));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(180, 32, 20), material)
  sky.name = 'sky'
  sky.frustumCulled = false
  return sky
}

function terrainHeight(x: number, z: number) {
  return (
    Math.sin(x * 0.18 + 0.4) * Math.cos(z * 0.15) * 0.62 +
    Math.sin(x * 0.07 - z * 0.05) * 0.38 +
    Math.cos(z * 0.31 + x * 0.04) * 0.2
  )
}

function edgeFade(x: number, z: number) {
  const d = Math.hypot(x - 0.4, z - 1.1) / 11
  const t = Math.min(1, Math.max(0, (d - 0.28) / 0.5))
  return 1 - t * t * (3 - 2 * t)
}

function buildGroundWire() {
  const root = new Group()
  const size = 22
  const plane = new PlaneGeometry(size, size, 22, 22)
  plane.rotateX(-Math.PI / 2)
  const pos = plane.attributes.position
  if (!pos) throw new Error('Terrain is missing positions')
  const origin = terrainHeight(0, 0)
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, terrainHeight(x, z) - origin)
  }
  const wire = new WireframeGeometry(plane)
  const wpos = wire.attributes.position
  const fade = new Float32Array(wpos.count)
  for (let i = 0; i < wpos.count; i += 1) fade[i] = edgeFade(wpos.getX(i), wpos.getZ(i))
  wire.setAttribute('aFade', new Float32BufferAttribute(fade, 1))
  const lineMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: { uOpacity: { value: 0.78 } },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      uniform float uOpacity;
      void main() {
        if (vFade < 0.02) discard;
        gl_FragColor = vec4(vec3(0.95, 0.97, 0.98), vFade * uOpacity);
      }
    `,
  })
  root.add(new LineSegments(wire, lineMat))
  plane.dispose()

  const dots: number[] = []
  const dotFade: number[] = []
  for (let x = -12; x <= 12; x += 2.2) {
    for (let z = -12; z <= 12; z += 2.2) {
      const amount = edgeFade(x, z)
      if (amount < 0.2) continue
      dots.push(x, terrainHeight(x, z) - origin + 0.04, z)
      dotFade.push(amount)
    }
  }
  const dotGeo = new BufferGeometry()
  dotGeo.setAttribute('position', new Float32BufferAttribute(dots, 3))
  dotGeo.setAttribute('aFade', new Float32BufferAttribute(dotFade, 1))
  const dotMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: { uOpacity: { value: 0.9 } },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.2;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(vec3(1.0), vFade * uOpacity);
      }
    `,
  })
  root.add(new Points(dotGeo, dotMat))

  const air: number[] = []
  const posts: Array<[number, number]> = [
    [-3.2, 2.4],
    [2.6, -1.8],
    [4.4, 3.1],
    [-1.5, -3.6],
    [0.8, 4.8],
    [-4.6, -0.6],
  ]
  for (const [x, z] of posts) {
    const y = terrainHeight(x, z) - origin
    air.push(x, y + 0.4, z, x, y + 3.4, z)
  }
  air.push(-2.2, 3.6, -1.4, 2.4, 4.1, 1.6, 1.2, 4.8, -2.2, 3.6, 5.2, 0.4)
  const airGeo = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(air, 3))
  const airFade = new Float32Array(air.length / 3).fill(0.55)
  airGeo.setAttribute('aFade', new Float32BufferAttribute(airFade, 1))
  const airMat = lineMat.clone()
  airMat.uniforms = { uOpacity: { value: 0.35 } }
  root.add(new LineSegments(airGeo, airMat))

  const motes: number[] = []
  for (let i = 0; i < 18; i += 1) {
    const x = Math.sin(i * 2.3) * 5.5
    const z = Math.cos(i * 1.7) * 4.8
    const y = 2.2 + (i % 5) * 0.7
    motes.push(x, y, z)
  }
  const moteGeo = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(motes, 3))
  moteGeo.setAttribute('aFade', new Float32BufferAttribute(new Float32Array(18).fill(0.8), 1))
  const moteMat = dotMat.clone()
  moteMat.uniforms = { uOpacity: { value: 0.7 } }
  root.add(new Points(moteGeo, moteMat))

  root.visible = false
  return {
    root,
    setOpacity(amount: number) {
      lineMat.uniforms.uOpacity!.value = 0.78 * amount
      dotMat.uniforms.uOpacity!.value = 0.9 * amount
      airMat.uniforms.uOpacity!.value = 0.35 * amount
      moteMat.uniforms.uOpacity!.value = 0.7 * amount
    },
  }
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
  if (mood <= 1) return lerp(0.004, 0.006, mood)
  if (mood <= 2) return lerp(0.006, 0.003, mood - 1)
  return lerp(0.003, 0.001, Math.min(1, mood - 2))
}
