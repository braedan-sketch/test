import {
  Box3,
  BufferGeometry,
  Color,
  FogExp2,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  Points,
  Vector3,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three'
import { loadHero } from './heroModel'
import type { Quality } from './quality'

const HAZE = new Color('#101820')
const FAR_HAZE = new Color('#070b10')

let groundY = 0

/** Height the igloo sits on. Updated once terrain.glb has loaded. */
export function sampleHeight(_x: number, _z: number) {
  return groundY
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number, wire?: number, field?: boolean) => void
  adoptGround: (object: Object3D | null) => void
}

export function createWorld(scene: Scene, quality: Quality, renderer: WebGLRenderer): World {
  const fog = new FogExp2(HAZE.clone(), 0.0014)
  scene.fog = fog
  const sky = buildSky()
  scene.add(sky)
  const skyMat = sky.material as ShaderMaterial

  const ranges = new Group()
  ranges.name = 'ranges'
  scene.add(ranges)

  const terrainRoot = new Group()
  terrainRoot.name = 'terrain'
  scene.add(terrainRoot)

  const terrainMeshes: Mesh[] = []
  const raycaster = new Raycaster()
  const rayOrigin = new Vector3(0, 80, 0)
  const rayDown = new Vector3(0, -1, 0)
  let seated = false

  void loadHero('/models/mountains.glb', renderer).then((hero) => {
    if (!hero) return
    hero.name = 'mountains'
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      for (const entry of materialsOf(mesh)) gradeSurface(entry)
    })
    ranges.add(hero)
  })

  void loadHero('/models/terrain.glb', renderer).then((hero) => {
    if (!hero) return
    hero.name = 'terrain-mesh'
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      mesh.receiveShadow = quality.shadows
      for (const entry of materialsOf(mesh)) gradeSurface(entry)
      terrainMeshes.push(mesh)
    })
    terrainRoot.add(hero)
    raycaster.set(rayOrigin, rayDown)
    raycaster.far = 200
    const hit = raycaster.intersectObjects(terrainMeshes, false)[0]
    if (hit) groundY = hit.point.y
  })

  const snow = buildSnow(quality.snow)

  return {
    fog,
    adoptGround(object) {
      if (seated || !object || terrainMeshes.length === 0) return
      object.updateWorldMatrix(true, true)
      const box = new Box3().setFromObject(object)
      if (box.isEmpty()) return
      object.position.y += groundY + 0.06 - box.min.y
      seated = true
    },
    update(time, mood, wire = 0, field = true) {
      const color = fogColor(mood)
      fog.color.copy(color)
      fog.density = wire > 0.5 ? 0.00035 : fogDensity(mood)
      if (wire > 0.5) fog.color.set('#8ea0ae')
      skyMat.uniforms.uMood!.value = mood
      skyMat.uniforms.uWire!.value = wire
      // The hero sheet is the Field only. Past the rift it folds into a white blade.
      terrainRoot.visible = field
      const showSnow = field && wire < 0.4
      if (showSnow) {
        if (!snow.points.parent) scene.add(snow.points)
        const attr = snow.points.geometry.getAttribute('position')
        if (attr) {
          for (let i = 0; i < snow.count; i += 1) {
            let y = snow.base[i] ?? 0
            y += time * (0.15 + (snow.speed[i] ?? 0.2))
            const span = 8
            y = ((y % span) + span) % span
            attr.setY(i, y * 0.45 + 0.6)
            attr.setX(i, (snow.x[i] ?? 0) + Math.sin(time * 0.15 + i) * 0.08)
          }
          attr.needsUpdate = true
        }
      } else if (snow.points.parent) {
        snow.points.removeFromParent()
      }
    },
  }
}

function materialsOf(mesh: Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function gradeSurface(entry: Mesh['material']) {
  if (Array.isArray(entry) || !(entry instanceof MeshStandardMaterial)) return
  entry.fog = true
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(1.55)) * 1.7;`,
    )
  }
  entry.customProgramCacheKey = () => `${priorKey()}-range`
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
        vec3 zenith = vec3(0.004, 0.005, 0.008);
        vec3 haze = vec3(0.03, 0.034, 0.042);
        vec3 color = mix(haze, zenith, smoothstep(0.0, 0.48, h));
        float ground = smoothstep(0.02, -0.35, h);
        color = mix(color, vec3(0.008, 0.01, 0.013), ground);
        color = mix(color, zenith, clamp(uMood, 0.0, 1.0) * 0.18);
        color = mix(color, haze, uWire * 0.22);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(520, 32, 20), material)
  sky.name = 'sky'
  sky.frustumCulled = false
  return sky
}

function buildSnow(count: number) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const base: number[] = []
  const speed: number[] = []
  const x: number[] = []
  for (let i = 0; i < count; i += 1) {
    const px = (Math.random() - 0.5) * 28
    const py = Math.random()
    const pz = (Math.random() - 0.5) * 28
    positions[i * 3] = px
    positions[i * 3 + 1] = py * 3
    positions[i * 3 + 2] = pz
    sizes[i] = 0.75 + Math.random() * 1.15
    x.push(px)
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
          gl_PointSize = clamp(uPixel * aSize * (220.0 / dist), 16.0, 48.0);
        }
      `,
      fragmentShader: /* glsl */ `
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          float soft = exp(-r * r * 6.5);
          soft *= smoothstep(0.5, 0.18, r);
          if (soft < 0.03) discard;
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), soft * 0.62);
        }
      `,
    }),
  )
  points.frustumCulled = false
  points.renderOrder = 2
  return { points, count, base, speed, x }
}

const moodColor = new Color()

function fogColor(mood: number) {
  return moodColor.copy(HAZE).lerp(FAR_HAZE, mood > 1.15 ? 0.55 : 0)
}

function fogDensity(mood: number) {
  return mood > 1.2 ? 0.0018 : 0.0009
}
