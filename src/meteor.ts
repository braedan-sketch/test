import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PMREMGenerator,
  PointLight,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { brand } from './brand'
import { loadHero } from './heroModel'
import type { LabelAnchor } from './igloo'
import type { Quality } from './quality'

const CENTER = new Vector3(0, 1.5, 0)

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

export async function createMeteor(quality: Quality, renderer: WebGLRenderer): Promise<Meteor> {
  const group = new Group()
  group.position.copy(CENTER)

  const light = new PointLight('#c5d6e6', 1.5, 9, 2)
  light.position.set(2.4, 1.2, 3.6)
  group.add(light)
  const facet = new PointLight('#9eb6cc', 0, 4.2, 2)
  facet.name = 'facet-key'
  facet.position.set(-1.8, 0.7, 2.4)
  group.add(facet)

  const hero = await loadHero('/models/crystal.glb', renderer, { eager: true })
  if (!hero) throw new Error('crystal.glb missing')
  const envMap = studioRoom(renderer)
  hero.traverse((object) => {
    if (!(object instanceof Mesh)) return
    dressCrystal(object, envMap, quality.low)
  })
  hero.rotation.y = 0.55
  group.add(hero)
  const anchors = boxAnchors(hero)

  return {
    group,
    labelCount: anchors.length,
    update(reveal, time) {
      const shown = Math.max(0, Math.min(1, reveal))
      group.visible = shown > 0.02
      group.scale.setScalar(0.62 + shown * 0.38)
      hero.rotation.y = 0.55 + time * 0.22
      hero.rotation.z = Math.sin(time * 0.17) * 0.08
      light.intensity = 1.4 + shown * 2.2
      facet.intensity = shown * 2.6
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

function dressCrystal(mesh: Mesh, envMap: Texture, low: boolean) {
  const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  if (!(source instanceof MeshStandardMaterial)) return
  const cloud = mesh.name === 'crystal_core' || source.name === 'crystal_cloud'
  if (cloud) {
    // Opaque figure card so the transmission pass can refract it. Haze below the cutoff is discarded.
    source.transparent = false
    source.opacity = 1
    source.alphaTest = 0.18
    source.depthWrite = true
    source.depthTest = true
    source.side = DoubleSide
    source.fog = false
    source.metalness = 0
    source.roughness = 0.85
    source.emissiveIntensity = 0.42
    source.color.set('#e4eaee')
    source.emissive.set('#d5dee6')
    muteSmoke(source)
    mesh.renderOrder = 0
    return
  }
  if (!(source instanceof MeshPhysicalMaterial)) return
  // Bright glass. A dark base and a short attenuation distance turned the shell black on the M2.
  source.transmission = 1
  source.ior = 1.45
  source.thickness = shellThickness(mesh, source.thickness)
  source.attenuationColor.setRGB(0.82, 0.89, 0.97, LinearSRGBColorSpace)
  source.attenuationDistance = 2
  source.color.set('#f4f7f8')
  source.roughness = 0.9
  source.metalness = 0
  source.normalScale.set(1.55, 1.55)
  source.iridescence = 0
  source.dispersion = 0
  source.clearcoat = 0
  source.specularIntensity = 0.4
  source.envMap = envMap
  source.envMapIntensity = low ? 0.08 : 0.14
  source.fog = false
  source.transparent = false
  source.depthWrite = true
  if (source.thicknessMap) {
    source.thicknessMap.colorSpace = NoColorSpace
    source.thicknessMap.needsUpdate = true
  }
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 1
}

/**
 * The baked penguins are hard black cut-outs. Blur the card a couple of pixels,
 * then composite it at about 0.42 over the glass tint. The card stays opaque:
 * a transparent card is dropped from the transmission pass and the shell hides it.
 */
function muteSmoke(source: MeshStandardMaterial) {
  const prior = source.onBeforeCompile
  const priorKey = source.customProgramCacheKey.bind(source)
  source.onBeforeCompile = (shader, renderer) => {
    prior.call(source, shader, renderer)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 smokeDx = dFdx(vMapUv);
          vec2 smokeDy = dFdy(vMapUv);
          vec4 smokeTex = texture2D(map, vMapUv);
          smokeTex += texture2D(map, vMapUv + smokeDx * 2.2);
          smokeTex += texture2D(map, vMapUv - smokeDx * 2.2);
          smokeTex += texture2D(map, vMapUv + smokeDy * 2.2);
          smokeTex += texture2D(map, vMapUv - smokeDy * 2.2);
          smokeTex /= 5.0;
          #ifdef DECODE_VIDEO_TEXTURE
            smokeTex = sRGBTransferEOTF(smokeTex);
          #endif
          diffuseColor *= smokeTex;
        #endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          vec3 glass = vec3(0.64, 0.70, 0.76);
          vec3 smoked = mix(glass, gl_FragColor.rgb, 0.42);
          float y = dot(smoked, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = mix(smoked, vec3(y * 0.94, y, y * 1.05), 0.45);
        }`,
      )
  }
  source.customProgramCacheKey = () => `${priorKey()}-crystal-smoke-v6`
}

/** v5 publishes thickness on the shell. Fall back to the measured 1.4996 m. */
function shellThickness(mesh: Mesh, loaded: number) {
  const own = Number((mesh.userData as { thickness_max_m?: unknown }).thickness_max_m)
  const parent = Number((mesh.parent?.userData as { thickness_max_m?: unknown } | undefined)?.thickness_max_m)
  const published = Number.isFinite(own) && own > 0.2 ? own : parent
  if (Number.isFinite(published) && published > 0.2) return published
  if (loaded > 0.2) return loaded
  return 1.4996
}

function studioRoom(renderer: WebGLRenderer) {
  const room = new RoomEnvironment()
  const strips: Array<[number, number, number, number, number, number, number]> = [
    [7.2, 15.5, 9.4, 0.45, 6.4, 0.35, 1.15],
    [-5.4, 19.2, 4.6, 9.5, 0.32, 0.28, 0.7],
    [1.4, 7.2, 13.6, 4.2, 0.4, 0.22, 1.3],
  ]
  for (const [x, y, z, sx, sy, sz, intensity] of strips) {
    const material = new MeshBasicMaterial({ toneMapped: false })
    material.color.setRGB(intensity * 0.82, intensity * 0.9, intensity)
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
