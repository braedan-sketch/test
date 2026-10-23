import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
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
  PMREMGenerator,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { brand } from './brand'
import { hash01 } from './math'
import { createGlassMaterial } from './glass'
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
          float behind = smoothstep(0.42, 0.0, length(vUv - 0.5));
          paper = mix(paper, paper * 0.62, behind);
          ink = mix(ink, ink * 0.45, behind);
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

export async function createMeteor(quality: Quality, renderer: WebGLRenderer): Promise<Meteor> {
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

  let anchors = pickAnchors(position)
  const hero = await loadHero('/models/crystal.glb')
  if (hero) {
    crystal.visible = false
    core.visible = false
    if (sprite) sprite.visible = false
    const envMap = quality.physicalCrystal ? studioRoom(renderer) : null
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
        const physical = new MeshPhysicalMaterial({
          color: new Color('#ffffff'),
          roughness: 0,
          metalness: 0,
          transmission: 1,
          thickness: 1.2,
          ior: 1.55,
          dispersion: 1.25,
          iridescence: 0,
          attenuationColor: new Color('#ffffff'),
          attenuationDistance: 40,
          specularIntensity: 1.9,
          envMap,
          envMapIntensity: 0.32,
          normalMap,
        })
        // A heavy normal scatters the dot grid into dark specks.
        physical.normalScale.set(0.04, 0.04)
        mesh.material = physical
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
          vec3 n = normalize(vNormal);
          vec3 toView = cameraPosition - vWorld;
          float vLen = length(toView);
          vec3 v = vLen > 1e-5 ? toView / vLen : vec3(0.0, 0.0, 1.0);
          float facing = smoothstep(0.0, 0.7, clamp(dot(n, v), 0.0, 1.0));
          float radial = 1.0 - smoothstep(0.0, uRadius, length(vLocal));
          float glow = facing * facing * (0.22 + 0.78 * radial);
          gl_FragColor = vec4(vec3(0.92), glow);
        }
      `,
    })
    for (const mesh of crystalMeshes) {
      const inner = new Mesh(mesh.geometry, glowMat)
      inner.name = 'crystal-core'
      inner.scale.setScalar(0.98)
      inner.renderOrder = 2
      mesh.add(inner)
    }
    streaks.visible = false
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
      dots.visible = shown > 0.8
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

function studioRoom(renderer: WebGLRenderer) {
  const room = new RoomEnvironment()
  // Hard rect lights so the ice catches a few white edges, not a flat studio wash.
  const strips: Array<[number, number, number, number, number, number, number]> = [
    [7.2, 15.5, 9.4, 0.45, 6.4, 0.35, 4],
    [-5.4, 19.2, 4.6, 9.5, 0.32, 0.28, 2],
    [1.4, 7.2, 13.6, 4.2, 0.4, 0.22, 5],
  ]
  for (const [x, y, z, sx, sy, sz, intensity] of strips) {
    const material = new MeshBasicMaterial({ toneMapped: false })
    material.color.setRGB(intensity, intensity, intensity)
    const strip = new Mesh(new BoxGeometry(sx, sy, sz), material)
    strip.position.set(x, y, z)
    room.add(strip)
  }
  const pmrem = new PMREMGenerator(renderer)
  const texture = pmrem.fromScene(room, 0.28).texture
  pmrem.dispose()
  room.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material.dispose()
  })
  return texture
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
