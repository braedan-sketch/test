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
const RINGS = new Color('#8e9499')
const FIGURE = new Color('#3e484e')

const CRATERS: Array<[number, number, number, number]> = [
  [7.5, 3.2, 3.4, 0.62],
  [-5.5, 6.4, 2.6, 0.42],
  [2.4, -7.2, 4.2, 0.78],
  [-12, -2.5, 3.1, 0.5],
  [15, 1.5, 3.8, 0.55],
  [-1.5, 13.5, 5.2, 0.9],
  [18, -11, 4.4, 0.66],
  [-15, 11, 3.6, 0.48],
  [9, -14, 2.8, 0.4],
  [-8, -12, 3.3, 0.52],
]

export function sampleHeight(x: number, z: number) {
  const radius = Math.hypot(x, z)
  let height =
    Math.sin(x * 0.09 + 0.4) * Math.cos(z * 0.07) * 1.45 +
    Math.sin(x * 0.28 + z * 0.19) * 0.62 +
    Math.sin(x * 0.72 - z * 0.55) * 0.28
  for (const [cx, cz, rad, depth] of CRATERS) {
    const d = Math.hypot(x - cx, z - cz)
    const bowl = Math.exp(-((d / rad) ** 2) * 2.1) * depth * 1.35
    const rim = Math.exp(-(((d - rad * 0.82) / (rad * 0.22)) ** 2)) * depth * 0.55
    height += rim - bowl
  }
  const ridge = smoothRidge(radius) * (2.2 + Math.sin(x * 0.11) * 0.8 + Math.cos(z * 0.09) * 0.7)
  const pad = Math.exp(-radius * radius * 0.2)
  const slope = (x * 0.055 - z * 0.028) * (1 - pad * 0.4)
  return (height + ridge) * (1 - pad * 0.8) + slope
}

function smoothRidge(radius: number) {
  const t = Math.min(1, Math.max(0, (radius - 18) / 22))
  return t * t * (3 - 2 * t)
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number) => void
}

export function createWorld(scene: Scene, quality: Quality): World {
  const fog = new FogExp2(FIELD.clone(), 0.034)
  scene.fog = fog
  scene.add(buildSky())

  const segments = quality.terrainSeg
  const geometry = new PlaneGeometry(130, 130, segments, segments)
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
          float e = 0.22;
          float h0 = sin(vRock.x * 4.2) * cos(vRock.z * 3.7);
          float hx = sin((vRock.x + e) * 4.2) * cos(vRock.z * 3.7);
          float hz = sin(vRock.x * 4.2) * cos((vRock.z + e) * 3.7);
          normal = normalize(normal + vec3(h0 - hx, 0.15, h0 - hz) * 1.15);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float rock = sin(vRock.x * 0.31) * cos(vRock.z * 0.27);
        float grit = sin(vRock.x * 1.7 + vRock.z * 1.3) * sin(vRock.z * 2.1 - vRock.x * 0.8);
        float snow = smoothstep(0.15, 1.6, vRock.y + rock * 0.4);
        diffuseColor.rgb = mix(vec3(0.09, 0.1, 0.105), vec3(0.16, 0.175, 0.19), 0.4 + rock * 0.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.33, 0.36), snow * 0.78);
        diffuseColor.rgb *= 0.78 + grit * 0.28;
        float pit = smoothstep(0.35, -0.35, vRock.y);
        diffuseColor.rgb *= mix(1.0, 0.42, pit);`,
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
        vec3 voidCol = vec3(0.55, 0.58, 0.62);
        float grid = 0.0;
        if (uMood > 0.45 && uMood < 1.6) {
          vec2 cell = abs(fract(vec2(atan(d.z, d.x) * 8.0, h * 18.0)) - 0.5);
          grid = 1.0 - smoothstep(0.04, 0.09, min(cell.x, cell.y));
          voidCol += vec3(0.08) * grid;
        }
        float down = smoothstep(0.35, -0.9, h);
        vec3 rings = mix(vec3(0.62, 0.65, 0.68), vec3(0.50, 0.53, 0.56), down);
        vec3 figure = vec3(0.1, 0.11, 0.12);
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
