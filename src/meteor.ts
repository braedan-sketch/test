import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { brand } from './brand'
import { hash01 } from './math'
import { createGlassMaterial, studioCubemap } from './glass'
import { fitHero, loadHero } from './heroModel'
import type { LabelAnchor } from './igloo'
import type { Quality } from './quality'

const CENTER = new Vector3(0, 1.25, 0)

const METEOR_OFFSETS: Array<[number, number]> = [
  [-168, -24],
  [156, 18],
  [-46, 96],
  [132, -88],
]

export const meteorCenter = CENTER

export type Meteor = {
  group: Group
  update: (reveal: number, time: number) => void
  fillLabels: (target: LabelAnchor[]) => void
  labelCount: number
}

/**
 * Opaque dotted card behind the shard. Transmission only refracts opaque
 * scene geometry, so a DOM or discarded-dot backdrop stays flat.
 * The card is far larger than the frame and its colour feathers into the
 * meteor sky, so no hard quad edge can sit beside the crystal.
 */
function buildDotField() {
  const mesh = new Mesh(
    new PlaneGeometry(160, 110),
    new ShaderMaterial({
      depthWrite: true,
      fog: false,
      toneMapped: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vec2 cell = abs(fract(vUv * vec2(340.0, 234.0)) - 0.5);
          float dot = 1.0 - smoothstep(0.08, 0.16, length(cell));
          vec3 paper = vec3(0.58, 0.59, 0.61);
          vec3 ink = vec3(0.28, 0.30, 0.33);
          // Wide and smooth, so the darker field sits behind the shard
          // without a knee the glass can focus into a line.
          float behind = smoothstep(0.58, 0.02, length(vUv - 0.5));
          paper = mix(paper, paper * 0.40, behind);
          ink = mix(ink, ink * 0.28, behind);
          vec3 color = mix(paper, ink, dot * 0.9);
          vec2 q = abs(vUv - 0.5) * 2.0;
          float edge = smoothstep(0.62, 1.0, max(q.x, q.y));
          color = mix(color, paper, edge);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  )
  mesh.name = 'dot-backdrop'
  // Camera sits on +CRYSTAL_DIR. Park the card well behind the shard, facing it.
  const away = new Vector3(0.22, 0.04, 1).normalize()
  mesh.position.copy(away).multiplyScalar(-9)
  mesh.lookAt(away.x * 40, away.y * 40, away.z * 40)
  mesh.frustumCulled = false
  mesh.visible = false
  return mesh
}

function buildStreaks() {
  const positions: number[] = []
  for (let i = 0; i < 22; i += 1) {
    const x = (hash01(i * 1.7) - 0.5) * 7.5
    const y = (hash01(i * 2.9) - 0.35) * 6.2
    const z = (hash01(i * 4.1) - 0.5) * 3.4
    const len = 0.35 + hash01(i * 5.3) * 1.35
    const dx = (hash01(i * 6.7) - 0.15) * len
    const dy = (hash01(i * 8.1) - 0.55) * len
    positions.push(x, y, z, x + dx, y + dy, z + (hash01(i * 9.4) - 0.5) * 0.25)
  }
  return new LineSegments(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
    new LineBasicMaterial({
      color: '#8e98a1',
      transparent: true,
      opacity: 0.55,
      fog: false,
      toneMapped: false,
    }),
  )
}

function fbm(x: number, y: number, z: number) {
  const n = Math.sin(x * 1.7 + y * 2.3 + z * 1.1) * 0.5
  const m = Math.sin(x * 3.1 - y * 1.8 + z * 2.7 + 4.2) * 0.3
  const k = Math.sin(x * 5.4 + y * 4.1 - z * 3.3) * 0.2
  return n + m + k
}

function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  return map
}

export async function createMeteor(quality: Quality): Promise<Meteor> {
  const geometry = new IcosahedronGeometry(1, quality.low ? 2 : 3)
  const position = geometry.attributes.position
  if (!position) throw new Error('Crystal is missing positions')
  const vertex = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).normalize()
    const n = fbm(vertex.x * 2.1, vertex.y * 1.8, vertex.z * 2.4)
    const chip = Math.abs(fbm(vertex.x * 4.2 + 1.2, vertex.y * 3.6, vertex.z * 3.1))
    const radius = 0.84 + n * 0.2 + chip * chip * 0.42
    vertex.multiplyScalar(radius)
    vertex.x *= 0.86
    vertex.y *= 1.24
    vertex.z *= 0.74
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  geometry.computeVertexNormals()
  geometry.scale(1.08, 1.08, 1.08)

  const crystal = new Mesh(
    geometry,
    new MeshPhysicalMaterial({
      color: new Color('#1a2228'),
      roughness: 0.58,
      metalness: 0,
      transmission: quality.crystalTransmission ? 0.55 : 0,
      thickness: quality.crystalTransmission ? 1.6 : 0,
      ior: 1.5,
      iridescence: quality.low ? 0 : 1,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [180, 520],
      dispersion: quality.low ? 0 : 0.12,
      attenuationColor: new Color('#0c1216'),
      attenuationDistance: 0.65,
      clearcoat: 0.15,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.85,
      flatShading: true,
      transparent: !quality.crystalTransmission,
      opacity: quality.crystalTransmission ? 1 : 0.94,
      emissive: new Color('#101820'),
      emissiveIntensity: 0.06,
    }),
  )

  const group = new Group()
  group.position.copy(CENTER)
  const dots = buildDotField()
  const streaks = buildStreaks()
  group.add(crystal, dots, streaks)

  const core = new Mesh(
    new SphereGeometry(0.05, 16, 12),
    new MeshBasicMaterial({
      color: '#fffaf6',
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  group.add(core)

  const map = quality.sprites ? glowTexture() : null
  let sprite: Sprite | null = null
  if (map) {
    const material = new SpriteMaterial({
      map,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    sprite = new Sprite(material)
    sprite.scale.setScalar(1.35)
    group.add(sprite)
  }

  const light = new PointLight('#ffffff', 28, 18, 2)
  light.position.set(1.35, 2.15, 3.15)
  group.add(light)
  // One tight key, in front of a main facet. The broad light above stays.
  const facet = new PointLight('#ffffff', 0, 4.2, 2)
  facet.name = 'facet-key'
  facet.position.set(0.85, 1.72, 1.55)
  group.add(facet)

  let anchors = pickAnchors(position)
  const hero = await loadHero('/models/crystal.glb')
  if (hero) {
    crystal.visible = false
    core.visible = false
    if (sprite) sprite.visible = false
    const envMap = quality.physicalCrystal ? studioCubemap() : null
    const crystalMeshes: Mesh[] = []
    hero.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh) crystalMeshes.push(mesh)
    })
    for (const mesh of crystalMeshes) {
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const maps = source as {
        normalMap?: Texture | null
        roughnessMap?: Texture | null
        normalScale?: Vector2
      }
      const normalMap = maps.normalMap ?? null
      if (envMap) {
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.material = cloudyCrystalMaterial(envMap)
      } else {
        mesh.material = createGlassMaterial({
          normalMap,
          roughnessMap: null,
          kind: 'crystal',
        })
      }
      if (source && source !== mesh.material && 'dispose' in source) {
        const previous = source as MeshPhysicalMaterial
        previous.normalMap = null
        previous.roughnessMap = null
        previous.map = null
        previous.dispose()
      }
    }
    fitHero(hero, 2.15)
    let glowRadius = 1
    for (const mesh of crystalMeshes) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      glowRadius = Math.max(glowRadius, mesh.geometry.boundingSphere?.radius ?? 1)
    }
    // Transparent, so three.js keeps it out of the opaque transmission pass
    // and draws it after the glass. Layer 1 is that same exclusion, made explicit.
    const glowMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
      toneMapped: false,
      uniforms: { uRadius: { value: glowRadius } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec3 vLocal;
        uniform float uRadius;
        void main() {
          float d = length(vLocal) / max(uRadius, 0.001);
          float radial = pow(1.0 - smoothstep(0.0, 0.85, d), 1.8);
          vec3 n = normalize(vNormal);
          vec3 toView = cameraPosition - vWorld;
          float vLen = length(toView);
          vec3 v = vLen > 1e-5 ? toView / vLen : vec3(0.0, 0.0, 1.0);
          float facing = smoothstep(0.12, 0.7, clamp(dot(n, v), 0.0, 1.0));
          float glow = radial * facing;
          gl_FragColor = vec4(vec3(0.72, 0.84, 1.0), glow * 0.22);
        }
      `,
    })
    for (const mesh of crystalMeshes) {
      const inner = new Mesh(mesh.geometry, glowMat)
      inner.name = 'crystal-core'
      // Inner 40% only. The outer 60% is the glass, with no glow mesh on it.
      inner.scale.setScalar(0.52)
      inner.renderOrder = 3
      inner.layers.set(1)
      inner.frustumCulled = false
      mesh.add(inner)
    }
    streaks.removeFromParent()
    hero.rotation.y = 0.55
    group.add(hero)
    anchors = boxAnchors(hero)
  }

  return {
    group,
    labelCount: anchors.length,
    update(reveal, time) {
      const shown = Math.max(0, Math.min(1, reveal))
      group.visible = shown > 0.02
      group.scale.setScalar(0.62 + shown * 0.38)
      if (hero) {
        hero.rotation.y = 0.55 + time * 0.22
        hero.rotation.z = Math.sin(time * 0.17) * 0.08
      }
      light.intensity = 28 + shown * 78
      facet.intensity = shown * 96
      dots.visible = false
      if (sprite && sprite.visible) sprite.material.opacity = 0.16 + shown * 0.2
    },
    fillLabels(target) {
      group.updateWorldMatrix(true, true)
      for (let i = 0; i < anchors.length; i += 1) {
        const anchor = anchors[i]
        const slot = target[i]
        if (!anchor || !slot) continue
        slot.position.copy(anchor).applyMatrix4(group.matrixWorld)
        slot.text = brand.meteorHud[i] ?? 'MASS'
        slot.bent = true
        slot.offsetX = METEOR_OFFSETS[i]?.[0] ?? 80
        slot.offsetY = METEOR_OFFSETS[i]?.[1] ?? -20
      }
    },
  }
}

/** Thick cloudy crystal. Fake refraction, no transmission pass, a soft inclusion. */
function cloudyCrystalMaterial(envMap: Texture) {
  return new ShaderMaterial({
    fog: false,
    toneMapped: true,
    uniforms: { uEnv: { value: envMap } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform samplerCube uEnv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vObj;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 viewDelta = cameraPosition - vWorld;
        float vLen = length(viewDelta);
        vec3 v = vLen > 1e-5 ? viewDelta / vLen : vec3(0.0, 0.0, 1.0);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 3.0);
        vec3 refr = refract(-v, n, 1.0 / 1.48);
        if (dot(refr, refr) < 0.001) refr = reflect(-v, n);
        vec3 env = textureCube(uEnv, refr).rgb;
        float envL = dot(env, vec3(0.3, 0.5, 0.2));
        vec3 through = mix(vec3(0.46, 0.52, 0.58), vec3(envL), 0.2);
        float inclusion = smoothstep(0.62, 0.08, length(vObj));
        through = mix(through, vec3(0.7, 0.78, 0.86), inclusion * 0.5);
        vec3 reflected = textureCube(uEnv, reflect(-v, n)).rgb;
        float refL = dot(reflected, vec3(0.3, 0.5, 0.2));
        vec3 color = mix(through, vec3(refL * 0.65 + 0.18), fresnel * 0.5);
        color += vec3(0.82, 0.88, 0.94) * pow(fresnel, 2.6) * 0.28;
        vec3 key = normalize(vec3(0.35, 0.86, 0.32));
        float spec = pow(max(dot(reflect(-key, n), v), 0.0), 42.0);
        color += spec * 0.45;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
}

function boxAnchors(root: Group) {
  const box = new Box3().setFromObject(root)
  const center = box.getCenter(new Vector3())
  return [
    new Vector3(box.max.x, center.y, center.z),
    new Vector3(center.x, box.min.y, center.z),
    new Vector3(center.x, center.y, box.max.z),
    new Vector3(box.max.x, box.max.y, box.max.z),
  ]
}

function pickAnchors(position: {
  count: number
  getX: (index: number) => number
  getY: (index: number) => number
  getZ: (index: number) => number
}) {
  let maxX = -Infinity
  let minY = Infinity
  let maxZ = -Infinity
  let maxR = -Infinity
  const picks = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  const cursor = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    cursor.set(position.getX(i), position.getY(i), position.getZ(i))
    const slot0 = picks[0]
    const slot1 = picks[1]
    const slot2 = picks[2]
    const slot3 = picks[3]
    if (slot0 && cursor.x > maxX) {
      maxX = cursor.x
      slot0.copy(cursor)
    }
    if (slot1 && cursor.y < minY) {
      minY = cursor.y
      slot1.copy(cursor)
    }
    if (slot2 && cursor.z > maxZ) {
      maxZ = cursor.z
      slot2.copy(cursor)
    }
    if (slot3 && cursor.lengthSq() > maxR) {
      maxR = cursor.lengthSq()
      slot3.copy(cursor)
    }
  }
  return picks
}
