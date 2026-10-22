import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createLatticeMaterial, type LatticeUniforms } from './ice'
import { lerp, smoothstep } from './math'
import type { Quality } from './quality'

const FOG = new Color('#c5ced4')
const SNOW = new Color('#d5dee4')
const ROCK = new Color('#6f7a80')
const SLOPE = new Color('#9aa6ae')

export function sampleHeight(x: number, z: number) {
  const radius = Math.hypot(x, z)
  const rolling =
    Math.sin(x * 0.085 + 0.6) * Math.cos(z * 0.07) * 2.4 +
    Math.sin(x * 0.23 - 1.4) * Math.cos(z * 0.21 + 0.4) * 0.85 +
    Math.sin((x + z * 0.6) * 0.55) * 0.28
  const ridgeMask = smoothstep(12, 34, radius)
  const ridge =
    ridgeMask *
    (4.2 + Math.sin(x * 0.17 + 2) * 1.6 + Math.cos(z * 0.15) * 1.4) *
    (0.55 + 0.45 * Math.sin(x * 0.31) * Math.cos(z * 0.27))
  const pad = Math.exp(-radius * radius * 0.02)
  return (rolling + ridge) * (1 - pad) + 0.05 * pad
}

function mulberry32(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function textSprite(label: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, 128, 64)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '500 28px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 64, 34)
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.35,
  })
  const sprite = new Sprite(material)
  sprite.scale.set(0.85, 0.42, 1)
  return sprite
}

type Arc = {
  mesh: Mesh
  phase: number
  radius: number
  height: number
  spinX: number
  spinY: number
}

export type World = {
  fogColor: Color
  update: (time: number, abstractT: number) => void
  setReveal: (value: number) => void
  placeLattice: (x: number, y: number, z: number) => void
}

export function createWorld(scene: Scene, quality: Quality): World {
  scene.fog = new FogExp2(FOG, quality.low ? 0.04 : 0.032)
  scene.background = FOG

  const terrain = buildTerrain(quality.terrainSeg)
  terrain.receiveShadow = quality.shadows
  scene.add(terrain)

  const snow = buildSnow(quality.snow)
  scene.add(snow.points)

  const wires = buildWires(quality.wires, quality.sprites)
  scene.add(wires.lines)
  for (const sprite of wires.sprites) scene.add(sprite)

  const reveal: LatticeUniforms = { uReveal: { value: 0 } }
  const ringMaterial = createLatticeMaterial('ring', reveal)
  const crystalMaterial = createLatticeMaterial('crystal', reveal)
  const lattice = new Group()
  lattice.visible = false
  scene.add(lattice)

  const well = new Mesh(
    new CircleGeometry(2.6, 48),
    new MeshBasicMaterial({
      color: '#f4f7fb',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  )
  well.rotation.x = -Math.PI / 2
  well.position.y = 0.02
  lattice.add(well)

  const rings: Mesh[] = []
  for (let i = 0; i < 5; i += 1) {
    const arc = Math.PI * 2 * (i % 2 === 0 ? 1 : 0.78)
    const geometry = new TorusGeometry(0.78 + i * 0.46, i === 0 ? 0.042 : 0.028, 8, 72, arc)
    geometry.rotateX(Math.PI / 2)
    const mesh = new Mesh(geometry, ringMaterial)
    mesh.position.y = 0.05 + i * 0.01
    lattice.add(mesh)
    rings.push(mesh)
  }

  const halo = new Mesh(new TorusGeometry(1.2, 0.03, 8, 64), ringMaterial)
  halo.rotation.x = 0.35
  halo.position.y = 1.45
  lattice.add(halo)

  const crystal = new Mesh(new RoundedBoxGeometry(1.05, 1.05, 1.05, 3, 0.12), crystalMaterial)
  crystal.position.y = 1.42
  lattice.add(crystal)

  const arcs: Arc[] = []
  const rand = mulberry32(19)
  for (let i = 0; i < quality.arcs; i += 1) {
    const geometry = new TorusGeometry(0.34 + rand() * 0.45, 0.045 + rand() * 0.02, 8, 28, Math.PI * (0.7 + rand() * 0.7))
    const mesh = new Mesh(geometry, ringMaterial)
    lattice.add(mesh)
    arcs.push({
      mesh,
      phase: rand() * Math.PI * 2,
      radius: 1.8 + rand() * 1.6,
      height: 0.8 + rand() * 1.8,
      spinX: 0.15 + rand() * 0.35,
      spinY: 0.1 + rand() * 0.3,
    })
  }

  return {
    fogColor: FOG,
    setReveal(value) {
      reveal.uReveal.value = value
      lattice.visible = value > 0.01
    },
    placeLattice(x, y, z) {
      lattice.position.set(x, y, z)
    },
    update(time, abstractT) {
      const snowTime = snow.material.uniforms.uTime
      if (snowTime) snowTime.value = time

      const wireOpacity = 0.07 + smoothstep(0.05, 0.7, abstractT) * 0.22
      wires.material.opacity = wireOpacity
      for (const sprite of wires.sprites) {
        const material = sprite.material as SpriteMaterial
        material.opacity = 0.15 + abstractT * 0.4
      }

      lattice.rotation.y = abstractT * 0.45 + time * 0.03
      for (let i = 0; i < rings.length; i += 1) {
        const ring = rings[i]
        if (!ring) continue
        ring.rotation.y = time * (0.05 + i * 0.012) * (i % 2 === 0 ? 1 : -1)
      }
      halo.rotation.z = time * 0.08
      crystal.rotation.y = time * 0.22 + abstractT * 0.4
      crystal.rotation.z = Math.sin(time * 0.15) * 0.1
      crystal.position.y = 1.42 + Math.sin(time * 0.35) * 0.05

      const settle = smoothstep(0.22, 0.78, abstractT)
      for (let i = 0; i < arcs.length; i += 1) {
        const arc = arcs[i]
        if (!arc) continue
        const orbit = lerp(arc.radius, 1.15 + (i % 3) * 0.38, settle)
        const angle = time * 0.18 + arc.phase + abstractT * 0.7
        arc.mesh.position.set(
          Math.cos(angle) * orbit,
          lerp(arc.height, 1.15 + (i % 4) * 0.16, settle) + Math.sin(time * 0.4 + arc.phase) * 0.1,
          Math.sin(angle) * orbit * 0.72,
        )
        arc.mesh.rotation.x += arc.spinX * 0.016
        arc.mesh.rotation.y += arc.spinY * 0.016
      }
    },
  }
}

function buildTerrain(segments: number) {
  const geometry = new PlaneGeometry(130, 130, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, sampleHeight(x, z))
  }
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(position.count * 3)
  const color = new Color()
  for (let i = 0; i < position.count; i += 1) {
    const snow = smoothstep(0.55, 0.95, normals.getY(i))
    const heightFade = 1 - smoothstep(3.5, 8, position.getY(i))
    color.copy(ROCK).lerp(SLOPE, 0.45).lerp(SNOW, snow * (0.45 + heightFade * 0.55))
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return new Mesh(
    geometry,
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.22,
    }),
  )
}

function buildSnow(count: number) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const rand = mulberry32(7)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rand() - 0.5) * 54
    positions[i * 3 + 1] = rand() * 16
    positions[i * 3 + 2] = (rand() - 0.5) * 54
    sizes[i] = 0.45 + rand() * 1.5
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSize;
      varying float vFog;
      void main() {
        vec3 p = position;
        float fall = mod(uTime * (0.22 + aSize * 0.12) + position.y, 16.0);
        p.y = position.y - fall;
        p.x += sin(uTime * 0.15 + position.z * 0.2) * 0.35;
        p.z += cos(uTime * 0.12 + position.x * 0.15) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (80.0 / max(1.2, -mv.z));
        vFog = exp(-max(0.0, -mv.z) * 0.028);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFog;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.08, d) * 0.55 * vFog;
        gl_FragColor = vec4(vec3(0.96, 0.98, 1.0), alpha);
      }
    `,
  })
  return { points: new Points(geometry, material), material }
}

function buildWires(count: number, sprites: boolean) {
  const rand = mulberry32(42)
  const positions: number[] = []
  const spriteList: Sprite[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2
    const radius = 8 + rand() * 20
    const y = 0.4 + rand() * 6.5
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const size = 0.7 + rand() * 1.5
    const points = [
      new Vector3(x, y, z),
      new Vector3(x + size, y + rand() * size, z + size * 0.35),
      new Vector3(x + (rand() - 0.5) * size, y + size * 0.7, z - size),
    ]
    for (let edge = 0; edge < 3; edge += 1) {
      const a = points[edge]
      const b = points[(edge + 1) % 3]
      if (!a || !b) continue
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    if (sprites && i % 2 === 0) {
      const sprite = textSprite(String(7 + i * 3).padStart(2, '0'))
      const origin = points[0]
      if (sprite && origin) {
        sprite.position.copy(origin)
        spriteList.push(sprite)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new LineBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    fog: true,
  })
  return { lines: new LineSegments(geometry, material), material, sprites: spriteList }
}
