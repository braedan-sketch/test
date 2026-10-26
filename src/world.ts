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
import { assignBakedMaps, bakedLights, bakeLightShader, type BakedSlot } from './baked'
import { loadHero } from './heroModel'
import type { Quality } from './quality'

const HAZE = new Color('#e6eef2')
const MIST = new Color('#e8eef3')

let groundY = 0

/** Height the igloo sits on. Updated once terrain.glb has loaded. */
export function sampleHeight(_x: number, _z: number) {
  return groundY
}

export type World = {
  fog: FogExp2
  update: (time: number, mood: number, wire?: number, field?: boolean, mist?: boolean, hideMound?: boolean) => void
  adoptGround: (object: Object3D | null) => void
}

export function createWorld(
  scene: Scene,
  quality: Quality,
  renderer: WebGLRenderer,
  bakedTerrain: Promise<BakedSlot | null> = Promise.resolve(null),
  terrainModel: Promise<string | null> = Promise.resolve(null),
): World {
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

  void terrainModel
    .then((model) => {
      const heroP = model
        ? loadHero(model, renderer, { eager: true }).then((override) => override ?? loadHero('/models/terrain.glb', renderer, { eager: true }))
        : loadHero('/models/terrain.glb', renderer, { eager: true })
      return Promise.all([heroP, bakedTerrain])
    })
    .then(([hero, baked]) => {
    if (!hero) return
    hero.name = 'terrain-mesh'
    let missingUv = false
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      mesh.receiveShadow = quality.shadows
      const skirt = mesh.name.toUpperCase() === 'SKIRT'
      if (!skirt && !missingUv && baked?.light && !mesh.geometry.getAttribute('uv1')) {
        missingUv = true
        console.warn('[baked] terrain lightmap expects UV2 (glTF TEXCOORD_1). This mesh has no uv1.')
      }
      for (const entry of materialsOf(mesh)) gradeSurface(entry, 'terrain', renderer, skirt ? null : baked)
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
    update(time, mood, wire = 0, field = true, mist = false, hideMound = false) {
      fog.color.copy(mist ? MIST : HAZE)
      fog.density = mist ? 0.011 : fogDensity(mood)
      skyMat.uniforms.uMood!.value = mood
      skyMat.uniforms.uWire!.value = wire
      skyMat.uniforms.uMist!.value = mist ? 1 : 0
      // The portal has its own backdrop. The fox shot hides the mound so the plinth stays clear.
      terrainRoot.visible = !mist && !hideMound
      ranges.visible = !mist
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

function gradeSurface(
  entry: Mesh['material'],
  kind: 'terrain' | 'range',
  renderer?: WebGLRenderer,
  baked: BakedSlot | null = null,
) {
  if (Array.isArray(entry) || !(entry instanceof MeshStandardMaterial)) return
  entry.fog = true
  if (kind === 'terrain') {
    // v10 is a crusted crag. Keep the baked rock instead of washing it out to snow.
    entry.roughness = 1
    entry.metalness = 0
    entry.envMapIntensity = 0
    entry.normalScale.set(1, 1)
    if (renderer) assignBakedMaps(entry, baked, renderer)
  }
  const prior = entry.onBeforeCompile
  const priorKey = entry.customProgramCacheKey.bind(entry)
  const lit = kind === 'terrain' && bakedLights(baked)
  const curve = lit ? '1.0' : kind === 'terrain' ? '1.02' : '0.96'
  const gain = kind === 'terrain' ? '1.0' : '1.04'
  entry.onBeforeCompile = (shader, renderer) => {
    prior.call(entry, shader, renderer)
    let fragment = shader.fragmentShader
    if (lit) fragment = bakeLightShader(fragment)
    fragment = fragment
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
    shader.fragmentShader = fragment
    if (kind === 'terrain') {
      // The mound is in the mesh. Flatten only the mid-distance past it.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 spikeWorld = modelMatrix * vec4(transformed, 1.0);
         float spikeR = length(spikeWorld.xz);
         // v12's mid-distance is rolling slopes and a ridge. Leave that mesh alone.
         // The hero camera sits on +Z. Knock down a rock that sticks above the slope into the bottom of that frame.
         float slope = -0.1 - smoothstep(2.4, 8.0, spikeR) * 3.4;
         float front = smoothstep(1.6, 4.5, spikeWorld.z);
         float extra = smoothstep(0.7, 1.35, spikeWorld.y - slope);
         transformed.y = mix(transformed.y, min(transformed.y, slope + 0.45), front * extra);`,
      )
    }
  }
  const bakedKey = lit ? '-baked' : ''
  entry.customProgramCacheKey = () => `${priorKey()}-${kind}-v13${bakedKey}`
}

function buildSky() {
  const material = new ShaderMaterial({
    name: 'sky',
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uMood: { value: 0 }, uWire: { value: 0 }, uMist: { value: 0 } },
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
      uniform float uMist;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.70, 0.77, 0.84);
        vec3 haze = vec3(0.86, 0.90, 0.93);
        vec3 snow = vec3(0.84, 0.88, 0.91);
        float above = smoothstep(-0.04, 0.55, h);
        vec3 color = mix(haze, zenith, above);
        float ground = smoothstep(0.12, -0.28, h);
        color = mix(color, snow, ground);
        color = mix(color, haze, clamp(uMood, 0.0, 1.0) * 0.06);
        color = mix(color, haze, uWire * 0.1);
        color = mix(color, vec3(0.91, 0.94, 0.96), uMist);
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

function fogDensity(mood: number) {
  // The field (mood 0) matches the v11 preview: exponential fog 0.016 so the background goes soft.
  if (mood < 0.15) return 0.016
  if (mood > 1.2) return 0.0022
  return 0.0035
}
