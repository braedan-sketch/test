import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  FogExp2,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  type Scene,
} from 'three'
import { lerp } from './math'
import type { Quality } from './quality'

const FIELD = new Color('#9aabB6')
const VOID = new Color('#6d757b')
const RINGS = new Color('#5c656c')
const FIGURE = new Color('#3e484e')

// Small foreground craters and rocks. Camera looks from +Z, so the near slope is positive Z.
const CRATERS: Array<[number, number, number, number]> = [
  [1.6, 4.8, 1.35, 0.28],
  [-2.4, 3.8, 0.95, 0.18],
  [4.6, 7.2, 1.55, 0.32],
  [-0.4, 8.6, 0.8, 0.14],
  [3.2, 2.8, 0.7, 0.12],
  [-5.4, 6.8, 1.25, 0.22],
  [7.1, 5.4, 1.7, 0.26],
  [-3.6, 10.4, 1.4, 0.2],
  [0.6, 12.2, 1.9, 0.24],
  [-7.2, 4.2, 1.1, 0.16],
]

const ROCKS: Array<[number, number, number, number]> = [
  [-1.4, 3.4, 1.15, 0.38],
  [2.6, 4.6, 0.9, 0.28],
  [0.4, 6.4, 1.35, 0.34],
  [-4.4, 5.2, 1.05, 0.26],
  [5.4, 3.8, 1.25, 0.32],
  [-2.4, 8.4, 1.15, 0.3],
  [3.6, 9.2, 0.85, 0.22],
  [1.1, 2.4, 0.75, 0.2],
  [-6.2, 7.6, 1.4, 0.28],
  [7.2, 8.4, 1.1, 0.24],
  [-0.6, 5.4, 0.7, 0.18],
  [4.4, 6.6, 0.8, 0.2],
]

export function sampleHeight(x: number, z: number) {
  const radius = Math.hypot(x, z)
  let height = Math.sin(x * 0.23 + 0.4) * Math.cos(z * 0.19) * 0.03
  for (const [cx, cz, rad, depth] of CRATERS) {
    const d = Math.hypot(x - cx, z - cz)
    const bowl = Math.exp(-((d / rad) ** 2) * 1.8) * depth
    const rim = Math.exp(-(((d - rad * 0.85) / (rad * 0.28)) ** 2)) * depth * 0.35
    height += rim - bowl
  }
  for (const [cx, cz, rad, heightRock] of ROCKS) {
    const d = Math.hypot(x - cx, z - cz)
    height += Math.exp(-((d / rad) ** 2) * 1.4) * heightRock
  }
  const pad = Math.exp(-radius * radius * 0.28)
  const slope = -z * 0.02 + x * 0.006
  return height * (1 - pad * 0.55) + slope * (1 - pad * 0.35)
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number) => void
}

export function createWorld(scene: Scene, quality: Quality): World {
  const fog = new FogExp2(FIELD.clone(), 0.034)
  scene.fog = fog
  scene.add(buildSky())

  const segments = quality.low ? 64 : 180
  const geometry = new PlaneGeometry(72, 72, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  if (!position) throw new Error('Terrain is missing positions')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, sampleHeight(x, z))
  }
  geometry.computeVertexNormals()
  const terrainMat = new MeshStandardMaterial({
    color: '#9aa3a8',
    roughness: 0.96,
    metalness: 0,
  })
  terrainMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRock;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRock = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRock;')
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          float e = 0.045;
          float h0 = sin(vRock.x * 19.0) * cos(vRock.z * 17.0) + sin(vRock.x * 47.0 + vRock.z * 41.0) * 0.45;
          float hx = sin((vRock.x + e) * 19.0) * cos(vRock.z * 17.0) + sin((vRock.x + e) * 47.0 + vRock.z * 41.0) * 0.45;
          float hz = sin(vRock.x * 19.0) * cos((vRock.z + e) * 17.0) + sin(vRock.x * 47.0 + (vRock.z + e) * 41.0) * 0.45;
          normal = normalize(normal + vec3(h0 - hx, 0.35, h0 - hz) * 0.72);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float near = smoothstep(-6.0, 16.0, vRock.z);
        vec3 farCol = vec3(0.20, 0.22, 0.24);
        vec3 nearCol = vec3(0.07, 0.074, 0.08);
        float grit = sin(vRock.x * 23.0) * sin(vRock.z * 19.0);
        float chip = sin(vRock.x * 61.0 + vRock.z * 47.0);
        diffuseColor.rgb = mix(farCol, nearCol, near * 0.82);
        diffuseColor.rgb *= 0.84 + grit * 0.1 + chip * 0.05;`,
      )
  }
  const terrain = new Mesh(geometry, terrainMat)
  terrain.receiveShadow = quality.shadows
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
        float ridge = sin(ang * 2.1) * 0.55 + sin(ang * 4.3 + 0.6) * 0.28 + sin(ang * 8.5 + 1.4) * 0.08;
        vec3 haze = vec3(0.46, 0.51, 0.56);
        vec3 zenith = vec3(0.30, 0.36, 0.42);
        vec3 field = mix(haze, zenith, smoothstep(0.04, 0.55, h));
        float peaks = smoothstep(0.20 + ridge * 0.10, 0.015, h);
        float ridgeShade = 0.55 + 0.45 * sin(ang * 4.3 + 0.6);
        field = mix(field, vec3(0.30, 0.34, 0.38) * ridgeShade, peaks * (1.0 - smoothstep(0.15, 1.2, uMood)) * 0.72);
        vec3 voidCol = vec3(0.40, 0.43, 0.46);
        float grid = 0.0;
        if (uMood > 0.45 && uMood < 1.6) {
          vec2 cell = abs(fract(vec2(atan(d.z, d.x) * 8.0, h * 18.0)) - 0.5);
          grid = 1.0 - smoothstep(0.04, 0.09, min(cell.x, cell.y));
          voidCol += vec3(0.08) * grid;
        }
        float down = smoothstep(0.35, -0.9, h);
        vec3 rings = mix(vec3(0.34, 0.37, 0.40), vec3(0.22, 0.24, 0.27), down);
        vec3 figure = vec3(0.045, 0.05, 0.055);
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
  if (mood <= 1) return lerp(0.02, 0.012, mood)
  if (mood <= 2) return lerp(0.012, 0.004, mood - 1)
  return lerp(0.004, 0.026, Math.min(1, mood - 2))
}
