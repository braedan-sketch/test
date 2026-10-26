import {
  Box3,
  CanvasTexture,
  Color,
  FogExp2,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  BackSide,
  Vector3,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three'
import { loadHero } from './heroModel'
import type { Quality } from './quality'

const HAZE = new Color('#d5dee6')

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

  void loadHero('/models/mountains.glb', renderer, { eager: true }).then((hero) => {
    if (!hero) return
    hero.name = 'mountains'
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      for (const entry of materialsOf(mesh)) gradeSurface(entry, 'range')
    })
    ranges.add(hero)
  })

  void loadHero('/models/terrain.glb', renderer, { eager: true }).then((hero) => {
    if (!hero) return
    hero.name = 'terrain-mesh'
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      mesh.receiveShadow = quality.shadows
      for (const entry of materialsOf(mesh)) gradeSurface(entry, 'terrain')
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
      const color = fogColor()
      fog.color.copy(color)
      fog.density = fogDensity(mood)
      skyMat.uniforms.uMood!.value = mood
      skyMat.uniforms.uWire!.value = wire
      // The mound and skirt stay under every scene so the ranges meet snow.
      terrainRoot.visible = true
      const showSnow = field && wire < 0.4
      if (showSnow) {
        if (!snow.group.parent) scene.add(snow.group)
        for (let i = 0; i < snow.flakes.length; i += 1) {
          const flake = snow.flakes[i]
          if (!flake) continue
          let y = (snow.base[i] ?? 0) + time * (snow.speed[i] ?? 0.2)
          const span = 7
          y = ((y % span) + span) % span
          flake.position.y = y * 0.7 + 0.35
          flake.position.x = (snow.x[i] ?? 0) + Math.sin(time * 0.15 + i) * 0.08
        }
      } else if (snow.group.parent) {
        snow.group.removeFromParent()
      }
    },
  }
}

function materialsOf(mesh: Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function gradeSurface(entry: Mesh['material'], kind: 'terrain' | 'range') {
  if (Array.isArray(entry) || !(entry instanceof MeshStandardMaterial)) return
  entry.fog = true
  if (kind === 'terrain') {
    // v8 snow is pale. A moderate grade keeps shadow in the mound.
    entry.color.multiplyScalar(0.44)
    entry.roughness = 1
    entry.metalness = 0
    entry.roughnessMap = null
    entry.metalnessMap = null
    entry.envMapIntensity = 0
    entry.normalScale.set(0.35, 0.35)
  }
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  const curve = kind === 'terrain' ? '1.42' : '1.08'
  const gain = kind === 'terrain' ? '0.86' : '1.0'
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <fog_fragment>',
        `gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(${curve})) * ${gain};
       #include <fog_fragment>`,
      )
      .replace(
        '#include <lights_fragment_end>',
        kind === 'terrain'
          ? `#include <lights_fragment_end>
       reflectedLight.directSpecular *= 0.04;
       reflectedLight.indirectSpecular *= 0.04;`
          : '#include <lights_fragment_end>',
      )
    if (kind === 'terrain') {
      // v8 builds the mound and its flank rocks inside about 11 m. Flatten only
      // the mid-distance spikes past that, and leave the pad and the far ranges.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 spikeWorld = modelMatrix * vec4(transformed, 1.0);
         float spikeR = length(spikeWorld.xz);
         float spikeBand = smoothstep(14.0, 20.0, spikeR) * (1.0 - smoothstep(48.0, 72.0, spikeR));
         float mound = -0.25 - smoothstep(14.0, 40.0, spikeR) * 0.4;
         transformed.y = mix(transformed.y, min(transformed.y, mound), spikeBand);`,
      )
    }
  }
  entry.customProgramCacheKey = () => `${priorKey()}-${kind}-v9`
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
        vec3 zenith = vec3(0.58, 0.66, 0.74);
        vec3 haze = vec3(0.74, 0.79, 0.84);
        vec3 snow = vec3(0.70, 0.74, 0.78);
        float above = smoothstep(-0.04, 0.55, h);
        vec3 color = mix(haze, zenith, above);
        float ground = smoothstep(0.12, -0.28, h);
        color = mix(color, snow, ground);
        color = mix(color, haze, clamp(uMood, 0.0, 1.0) * 0.08);
        color = mix(color, haze, uWire * 0.12);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(520, 32, 20), material)
  sky.name = 'sky'
  sky.frustumCulled = false
  return sky
}

function discTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.28, 'rgba(236,244,252,0.45)')
  gradient.addColorStop(0.62, 'rgba(220,230,240,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function buildSnow(count: number) {
  const map = discTexture()
  const material = new SpriteMaterial({
    map: map ?? undefined,
    color: '#f7fbff',
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })
  const group = new Group()
  group.name = 'snow-discs'
  const flakes: Sprite[] = []
  const base: number[] = []
  const speed: number[] = []
  const x: number[] = []
  for (let i = 0; i < count; i += 1) {
    const flake = new Sprite(material)
    const size = 0.07 + Math.random() * 0.11
    const px = (Math.random() - 0.5) * 26
    flake.scale.setScalar(size)
    flake.position.set(px, Math.random() * 6, (Math.random() - 0.5) * 26)
    flake.renderOrder = 2
    group.add(flake)
    flakes.push(flake)
    x.push(px)
    base.push(Math.random() * 7)
    speed.push(0.12 + Math.random() * 0.35)
  }
  return { group, flakes, base, speed, x }
}

function fogColor() {
  return HAZE
}

function fogDensity(mood: number) {
  return mood > 1.2 ? 0.0034 : 0.0022
}
