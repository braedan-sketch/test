import Lenis from 'lenis'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SSAOEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing'
import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  HalfFloatType,
  Box3,
  Color,
  type Object3D,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { brand, type ScreenId } from './brand'
import { createFigure } from './figure'
import { loadIgloo, makeLabelSlots, type Igloo, type LabelAnchor } from './igloo'
import { clamp, lerp, smoother } from './math'
import { createMeteor, meteorCenter, type Meteor } from './meteor'
import type { Overlay, ProjectedLabel } from './overlay'
import { detectQuality, reducedMotion } from './quality'
import { createRings } from './rings'
import { Ambience } from './sound'
import { WarpEffect } from './warp'
import { createWorld, sampleHeight } from './world'

type Marks = { rift: number; meteor: number; rings: number; figure: number }

declare global {
  interface Window {
    __blendy?: {
      scrollTo: (y: number) => void
      scrollProgress: (progress: number) => void
      debug?: () => Record<string, unknown>
    }
  }
}

// Dome center after the group yaw and the ground lift. Overhead shot uses the footprint.
const DOME_TARGET: readonly [number, number, number] = [0.05, 2.15, 0.12]
const DOME_DIR: readonly [number, number, number] = [0.1, 1, 0.26]
// Eye-level aim sits a little above the dome center so the mass reads lower-middle,
// with the tunnel and a strip of foreground snow still inside the frame.
const EYE_TARGET: readonly [number, number, number] = [0.06, 1.9, 0.05]
const EYE_DIR: readonly [number, number, number] = [0.48, 0.34, 1.55]
const CRYSTAL_DIR: readonly [number, number, number] = [0.22, 0.04, 1]
// Upright bust, base on the ring at y 0, ears near y 2. Look slightly up at the chest.
const FOX_TARGET: readonly [number, number, number] = [0.0, 1.02, 0.0]
const FOX_DIR: readonly [number, number, number] = [0.32, -0.12, 1.05]
const scratchA = new Vector3()
const scratchB = new Vector3()

export async function startExperience(overlay: Overlay) {
  const canvas = document.querySelector('#view')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')

  const quality = detectQuality()
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    depth: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  })
  if (!renderer.getContext()) throw new Error('WebGL unavailable')

  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NoToneMapping
  renderer.toneMappingExposure = 0.9
  renderer.transmissionResolutionScale = quality.low ? 0.35 : 0.5
  renderer.setClearColor('#c5c8cc', 1)
  if (quality.shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
  }

  const scene = new Scene()
  const camera = new PerspectiveCamera(40, 1, 0.08, 420)
  const world = createWorld(scene, quality)
  scene.environment = createEnvironment(renderer)
  scene.environmentIntensity = 0.35
  addLights(scene, quality.shadows)

  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: 0,
  })
  const bloom = new BloomEffect({
    intensity: 0.15,
    luminanceThreshold: 0.92,
    luminanceSmoothing: 0.25,
    mipmapBlur: true,
    radius: 0.45,
  })
  const chromatic = new ChromaticAberrationEffect({
    offset: new Vector2(0.0004, 0.0002),
    radialModulation: true,
    modulationOffset: 0.12,
  })
  const warp = new WarpEffect()
  const noise = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,
  })
  noise.blendMode.setOpacity(0.045)
  const vignette = new VignetteEffect({ darkness: 0.22, offset: 0.42 })
  const smaa = quality.smaa ? new SMAAEffect({ preset: SMAAPreset.MEDIUM }) : null
  const normalPass = quality.low ? null : new NormalPass(scene, camera, { resolutionScale: 0.75 })
  const ssao = normalPass
    ? new SSAOEffect(camera, normalPass.texture, {
        samples: 16,
        rings: 7,
        radius: 0.055,
        intensity: 0.85,
        bias: 0.05,
        fade: 0.012,
        luminanceInfluence: 0.35,
        resolutionScale: 0.75,
      })
    : null
  composer.addPass(new RenderPass(scene, camera))
  if (normalPass && ssao) {
    composer.addPass(normalPass)
    composer.addPass(new EffectPass(camera, ssao))
  }
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
  composer.addPass(new EffectPass(camera, bloom))
  composer.addPass(new EffectPass(camera, warp))
  composer.addPass(new EffectPass(camera, chromatic))
  if (smaa) composer.addPass(new EffectPass(camera, smaa))
  composer.addPass(
    new EffectPass(camera, noise, vignette, tone),
  )

  let dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap)
  const resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setPixelRatio(dpr)
    composer.setSize(width, height, false)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const ambience = new Ambience()
  overlay.onSound(() => {
    ambience.toggle()
    return ambience.on
  })

  const lenis = new Lenis({
    lerp: 0.085,
    smoothWheel: true,
    syncTouch: false,
    autoRaf: false,
  })
  lenis.stop()
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  overlay.onNavigate((id) => {
    lenis.scrollTo(`#${id}`, { offset: 0 })
  })

  window.__blendy = {
    scrollTo(y) {
      lenis.scrollTo(y, { immediate: true })
    },
    scrollProgress(progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight
      lenis.scrollTo(Math.max(0, max) * clamp(progress, 0, 1), { immediate: true })
    },
  }

  let figureGroup: Object3D | null = null
  const [meteor, rings, figure] = await Promise.all([
    createMeteor(quality),
    createRings(quality),
    createFigure(quality),
  ])
  scene.add(meteor.group, rings.group, figure.group)
  figureGroup = figure.group
  meteor.group.visible = false
  rings.group.visible = false
  figure.group.visible = false

  const pos = new Vector3()
  const target = new Vector3()
  if (window.__blendy) {
    const probe = new Vector3()
    window.__blendy.debug = () => {
      const project = (x: number, y: number, z: number) => {
        probe.set(x, y, z).project(camera)
        return [Math.round(probe.x * 1000) / 1000, Math.round(probe.y * 1000) / 1000]
      }
      return {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        fov: camera.fov,
        aspect: camera.aspect,
        origin: project(0, 1.6, 0),
        core: project(0.3, 1.8, 0.55),
        plusX: project(2, 1.8, 0.55),
        minusX: project(-2, 1.8, 0.55),
        plusZ: project(0.3, 1.8, 2.5),
        minusZ: project(0.3, 1.8, -1.5),
        bounds: brickScreenBounds(igloo, camera, probe),
        fox: objectScreenBounds(figureGroup, camera, probe),
      }
    }
  }
  const up = new Vector3(0, 1, 0)
  const ndc = new Vector3()
  const clear = new Color('#c5c8cc')
  let igloo: Igloo | null = null
  let slots: LabelAnchor[] = []
  const meteorSlots: LabelAnchor[] = makeLabelSlots(meteor.labelCount)
  let shown = 0
  let targetProgress = 0.04
  let ready = false
  let revealed = false
  let samples = 0
  let accum = 0
  let adapted = false
  const started = performance.now()
  let screen: ScreenId = 'field'
  let cornerPulsed = false

  const reveal = () => {
    if (revealed) return
    revealed = true
    overlay.hideLoader()
    overlay.revealChrome()
    overlay.setActive('field')
    lenis.resize()
    lenis.start()
  }

  void loadIgloo(quality, sampleHeight, (value) => {
    targetProgress = Math.max(targetProgress, value)
  })
    .then((loaded) => {
      igloo = loaded
      scene.add(loaded.group)
      slots = makeLabelSlots(loaded.labelCount)
      targetProgress = 1
      ready = true
    })
    .catch((error: unknown) => {
      console.error(error)
      overlay.fail(brand.loader.error)
    })

  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis.raf(now)
    if (!document.hidden) {
      shown = lerp(shown, targetProgress, 0.08)
      if (!revealed) overlay.setProgress(shown)
      if (ready && shown > 0.985 && now - started > 550) reveal()

      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const global = clamp(lenis.scroll / maxScroll, 0, 1)
      const marks = readMarks(maxScroll)
      const phase = readPhase(global, marks)

      world.update(now / 1000, phase.mood)
      clear.copy(world.fog.color)
      renderer.setClearColor(clear, 1)
      scene.environmentIntensity =
        phase.screen === 'field' || phase.screen === 'rift' ? 0.28 : phase.screen === 'meteor' ? 1.15 : 0.85

      igloo?.update(phase.burst, phase.solid, phase.dissolve, reducedMotion ? 0 : now / 1000)
      meteor.update(phase.meteorReveal)
      rings.update(phase.ringsT, phase.ringsShown)
      figure.update(phase.figureAppear, phase.figureBlow, reducedMotion ? 0 : now / 1000, dpr)

      applyCamera(phase, pos, target, up, camera)
      applyGrade(phase, bloom, chromatic, warp, tone, camera.aspect)
      overlay.setFlash(phase.flash * 0.35)
      overlay.setUiDim(phase.screen === 'rings' ? 1 : 1 - phase.burst * 0.04)
      overlay.setScrollProgress(global)

      if (phase.screen !== screen) {
        screen = phase.screen
        overlay.setActive(screen)
      }
      if (!cornerPulsed && phase.burst > 0.04 && phase.screen === 'field') {
        cornerPulsed = true
        overlay.scrambleCorner()
      }
      if (phase.burst < 0.01) cornerPulsed = false

      projectLabels(overlay, activeAnchors(phase, igloo, slots, meteor, meteorSlots), camera, ndc, phase.labelOpacity)
      const linkIndex = Math.min(
        brand.links.length - 1,
        Math.max(0, Math.floor(clamp((phase.figureT - 0.12) / 0.62, 0, 0.999) * brand.links.length)),
      )
      const link = brand.links[linkIndex] ?? brand.links[0]
      overlay.setCycle(link.label, link.value, phase.cycle)
      overlay.setTelemetry(
        igloo && phase.screen === 'field'
          ? igloo.readout(phase.burst, phase.solid)
          : phase.screen === 'rift'
            ? 'RIFT'
            : phase.screen === 'meteor'
              ? 'MASS'
              : phase.screen === 'rings'
                ? 'RINGS'
                : 'WITNESS',
        `${camera.position.x.toFixed(2)}   ${camera.position.y.toFixed(2)}   ${camera.position.z.toFixed(2)}`,
      )

      composer.render(dt)
      adaptFrame(dt)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  function adaptFrame(dt: number) {
    if (!revealed || adapted) return
    accum += dt
    samples += 1
    if (accum < 2.4) return
    if (samples / accum < 48 && dpr > 1.05) {
      dpr = Math.max(1, +(dpr - 0.3).toFixed(2))
      resize()
    }
    adapted = true
  }
}

type Phase = {
  screen: ScreenId
  fieldT: number
  riftT: number
  meteorT: number
  ringsT: number
  figureT: number
  burst: number
  solid: number
  dissolve: number
  meteorReveal: number
  ringsShown: number
  figureAppear: number
  figureBlow: number
  mood: number
  ripple: number
  blur: number
  glitch: number
  white: number
  flash: number
  chroma: number
  labelOpacity: number
  cycle: number
}

function readMarks(maxScroll: number): Marks {
  const at = (id: string) => (document.getElementById(id)?.offsetTop ?? 0) / maxScroll
  return {
    rift: at('rift'),
    meteor: at('meteor'),
    rings: at('rings'),
    figure: at('figure'),
  }
}

function span(global: number, start: number, end: number) {
  return clamp((global - start) / Math.max(0.0001, end - start), 0, 1)
}

function readPhase(global: number, marks: Marks): Phase {
  const fieldT = span(global, 0, marks.rift)
  const riftT = span(global, marks.rift, marks.meteor)
  const meteorT = span(global, marks.meteor, marks.rings)
  const ringsT = span(global, marks.rings, marks.figure)
  const figureT = span(global, marks.figure, 1)

  const inField = global < marks.rift
  const inRift = global >= marks.rift && global < marks.meteor
  const inMeteor = global >= marks.meteor && global < marks.rings
  const inRings = global >= marks.rings && global < marks.figure
  const inFigure = global >= marks.figure

  const solid = inField ? smoother(clamp((fieldT - 0.15) / 0.16, 0, 1)) : 1
  const burst = inField ? clamp((fieldT - 0.4) / 0.6, 0, 1) : 1
  const dissolve = inField ? 0 : inRift ? smoother(clamp((riftT - 0.22) / 0.56, 0, 1)) : 1
  const meteorReveal = inField ? 0 : inRift ? smoother(clamp((riftT - 0.34) / 0.5, 0, 1)) : inMeteor ? 1 - smoother(clamp((meteorT - 0.8) / 0.2, 0, 1)) : 0
  const ringsShown = inRings ? 1 : 0
  const figureAppear = inFigure ? smoother(clamp(figureT / 0.14, 0, 1)) : 0
  const figureBlow = inFigure ? smoother(clamp((figureT - 0.68) / 0.16, 0, 1)) : 0

  const ripple = inRift ? Math.sin(riftT * Math.PI) : 0
  const meteorWhite = inMeteor ? smoother(clamp((meteorT - 0.58) / 0.32, 0, 1)) : 0
  const ringsIn = inRings ? 1 - smoother(clamp(ringsT / 0.12, 0, 1)) : 0
  const ringsOut = inRings ? smoother(clamp((ringsT - 0.8) / 0.2, 0, 1)) : 0
  const figureIn = inFigure ? 1 - smoother(clamp(figureT / 0.1, 0, 1)) : 0
  const white = clamp(meteorWhite * 0.92 + ringsIn + ringsOut + figureIn * 0.75, 0, 1)
  const glitch = inFigure ? smoother(clamp((figureT - 0.78) / 0.2, 0, 1)) : 0
  const blur = clamp(ripple * 0.95 + meteorWhite * 0.85 + ringsOut * 0.35, 0, 1)
  const chroma = clamp(ripple * 0.85 + meteorWhite * 0.28 + glitch * 0.65, 0, 1)

  let screen: ScreenId = 'field'
  if (inFigure) screen = 'figure'
  else if (inRings) screen = 'rings'
  else if (inMeteor) screen = 'meteor'
  else if (inRift) screen = 'rift'

  let mood = 0
  if (inFigure) mood = 3
  else if (inRings) mood = 2
  else if (inMeteor) mood = 1
  else if (inRift) mood = riftT

  const labelOpacity =
    inField && solid > 0.45 ? 1 : inRift ? 1 - smoother(clamp(riftT / 0.35, 0, 1)) : inMeteor && meteorT < 0.72 && meteorT > 0.04 ? 1 : 0

  const cycle = inFigure ? smoother(clamp((figureT - 0.12) / 0.1, 0, 1)) * (1 - smoother(clamp((figureT - 0.78) / 0.08, 0, 1))) : 0

  return {
    screen,
    fieldT,
    riftT,
    meteorT,
    ringsT,
    figureT,
    burst,
    solid,
    dissolve,
    meteorReveal,
    ringsShown,
    figureAppear,
    figureBlow,
    mood,
    ripple,
    blur,
    glitch,
    white,
    flash: clamp(ringsOut + meteorWhite * 0.35, 0, 1),
    chroma,
    labelOpacity,
    cycle,
  }
}

function applyCamera(phase: Phase, pos: Vector3, target: Vector3, up: Vector3, camera: PerspectiveCamera) {
  up.set(0, 1, 0)
  const aspect = Math.max(0.2, camera.aspect)
  let fov = 40
  if (phase.screen === 'field' || (phase.screen === 'rift' && phase.riftT < 0.02)) {
    fov = 40
    const dolly = smoother(clamp(phase.fieldT / 0.18, 0, 1))
    mix3(target, DOME_TARGET, EYE_TARGET, dolly)
    // Looking down the Y axis: world up is parallel to the view, which throws the dome into a corner.
    up.set(0, dolly, -(1 - dolly))
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0)
    else up.normalize()
    // Overhead dome is the ~5.1 footprint. fillH stays loose so width (35%) wins on both aspects.
    const dHigh = fitBox(5.15, 4.55, 0.34, 0.72, aspect, fov)
    // Desktop is height-limited (~37% of the frame for the whole igloo). Portrait is width-limited (~75%).
    const span = phase.burst
    const dEye = fitBox(lerp(5.3, 6.5, span), lerp(3.75, 5.15, span), 0.62, 0.28, aspect, fov)
    placeAlong(scratchA, DOME_TARGET, DOME_DIR, dHigh)
    placeAlong(scratchB, EYE_TARGET, EYE_DIR, dEye)
    pos.copy(scratchA).lerp(scratchB, dolly)
  } else if (phase.screen === 'rift') {
    fov = 36
    const crystalTarget: [number, number, number] = [meteorCenter.x, meteorCenter.y, meteorCenter.z]
    placeAlong(scratchA, EYE_TARGET, EYE_DIR, fitBox(6.5, 5.15, 0.62, 0.28, aspect, 40))
    placeAlong(scratchB, crystalTarget, CRYSTAL_DIR, fitBox(1.9, 2.55, 0.78, 0.7, aspect, fov))
    mix3(target, EYE_TARGET, crystalTarget, smoother(phase.riftT))
    pos.copy(scratchA).lerp(scratchB, smoother(phase.riftT))
  } else if (phase.screen === 'meteor') {
    fov = 34
    const hold = fitBox(1.9, 2.55, 0.78, 0.7, aspect, fov)
    const push = smoother(clamp((phase.meteorT - 0.62) / 0.38, 0, 1))
    const dist = lerp(hold, -0.35, push)
    target.set(meteorCenter.x, meteorCenter.y, meteorCenter.z)
    placeAlong(pos, [target.x, target.y, target.z], CRYSTAL_DIR, Math.max(0.35, dist))
    if (push > 0.2) {
      pos.set(meteorCenter.x + 0.04, meteorCenter.y, meteorCenter.z + lerp(hold, -1.1, push))
      target.set(meteorCenter.x, meteorCenter.y, pos.z - 0.8)
    }
  } else if (phase.screen === 'rings') {
    fov = 36
    const far = fitBox(4.6, 4.6, 0.72, 0.62, aspect, fov)
    const near = fitBox(4.6, 4.6, 1.15, 0.92, aspect, fov)
    const y = lerp(far, near, smoother(phase.ringsT))
    const roll = phase.ringsT * 0.55
    pos.set(0, y, 0)
    target.set(0, 0, 0)
    up.set(Math.sin(roll), 0, Math.cos(roll))
  } else {
    fov = 34
    const orbit = clamp(phase.figureT / 0.7, 0, 1)
    // Bust is ~1.2 wide and 2.0 tall. Portrait height fill is 70%; width stays inside the frame.
    const dist = fitBox(1.35, 2.08, 0.95, 0.58, aspect, fov)
    const yaw = lerp(-0.02, 0.05, orbit)
    const dir: [number, number, number] = [
      FOX_DIR[0] * Math.cos(yaw) - FOX_DIR[2] * Math.sin(yaw),
      FOX_DIR[1] + orbit * 0.04,
      FOX_DIR[0] * Math.sin(yaw) + FOX_DIR[2] * Math.cos(yaw),
    ]
    target.set(FOX_TARGET[0], FOX_TARGET[1], FOX_TARGET[2])
    placeAlong(pos, FOX_TARGET, dir, dist + phase.figureBlow * 0.35)
  }

  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  camera.up.copy(up)
  camera.position.copy(pos)
  camera.lookAt(target)
}

function objectScreenBounds(object: Object3D | null, camera: PerspectiveCamera, probe: Vector3) {
  if (!object) return null
  object.updateWorldMatrix(true, true)
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) return null
  let minX = 1
  let maxX = -1
  let minY = 1
  let maxY = -1
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        probe.set(x, y, z).project(camera)
        minX = Math.min(minX, probe.x)
        maxX = Math.max(maxX, probe.x)
        minY = Math.min(minY, probe.y)
        maxY = Math.max(maxY, probe.y)
      }
    }
  }
  return {
    width: Math.round(((maxX - minX) / 2) * 1000) / 1000,
    height: Math.round(((maxY - minY) / 2) * 1000) / 1000,
    left: Math.round(((minX + 1) / 2) * 1000) / 1000,
    right: Math.round(((maxX + 1) / 2) * 1000) / 1000,
    bottom: Math.round(((minY + 1) / 2) * 1000) / 1000,
    top: Math.round(((maxY + 1) / 2) * 1000) / 1000,
  }
}

function brickScreenBounds(igloo: Igloo | null, camera: PerspectiveCamera, probe: Vector3) {
  if (!igloo) return null
  const box = new Box3()
  const piece = new Box3()
  let any = false
  igloo.group.updateWorldMatrix(true, true)
  igloo.group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (!object.geometry.getAttribute('aSeed')) return
    piece.setFromObject(object)
    if (!any) {
      box.copy(piece)
      any = true
    } else box.union(piece)
  })
  if (!any) return null
  let minX = 1
  let maxX = -1
  let minY = 1
  let maxY = -1
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        probe.set(x, y, z).project(camera)
        minX = Math.min(minX, probe.x)
        maxX = Math.max(maxX, probe.x)
        minY = Math.min(minY, probe.y)
        maxY = Math.max(maxY, probe.y)
      }
    }
  }
  return {
    width: Math.round(((maxX - minX) / 2) * 1000) / 1000,
    height: Math.round(((maxY - minY) / 2) * 1000) / 1000,
    left: Math.round(((minX + 1) / 2) * 1000) / 1000,
    right: Math.round(((maxX + 1) / 2) * 1000) / 1000,
    bottom: Math.round(((minY + 1) / 2) * 1000) / 1000,
    top: Math.round(((maxY + 1) / 2) * 1000) / 1000,
  }
}

function fitBox(width: number, height: number, fillW: number, fillH: number, aspect: number, fovDeg: number) {
  const vHalf = (fovDeg * Math.PI) / 360
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const distH = height / (2 * Math.tan(vHalf) * fillH)
  const distW = width / (2 * Math.tan(hHalf) * fillW)
  return Math.max(distH, distW)
}

function placeAlong(out: Vector3, target: readonly [number, number, number], dir: readonly [number, number, number], distance: number) {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
  out.set(target[0] + (dir[0] / len) * distance, target[1] + (dir[1] / len) * distance, target[2] + (dir[2] / len) * distance)
}

function mix3(out: Vector3, a: readonly [number, number, number], b: readonly [number, number, number], t: number) {
  out.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))
}

function applyGrade(
  phase: Phase,
  bloom: BloomEffect,
  chromatic: ChromaticAberrationEffect,
  warp: WarpEffect,
  tone: ToneMappingEffect,
  aspect: number,
) {
  const burst = phase.screen === 'field' ? phase.burst : 0
  let intensity = 0.08 + burst * 0.28
  let threshold = 0.97
  if (phase.screen === 'field') {
    // The baked crown is already bright. Keep bloom on the entrance spill, not the slabs.
    intensity = 0.04 + phase.solid * 0.16 + burst * 0.34
    threshold = 0.84
  }
  const toneBlend = phase.screen === 'field' ? BlendFunction.SKIP : BlendFunction.SRC
  if (tone.blendMode.blendFunction !== toneBlend) tone.blendMode.blendFunction = toneBlend
  if (phase.screen === 'rings') {
    intensity = 0.55
    threshold = 0.88
  }
  if (phase.screen === 'meteor') {
    intensity = 0.28 + phase.meteorT * 0.2
    threshold = 0.9
  }
  if (phase.white > 0.4) intensity += 0.22
  bloom.intensity = intensity
  bloom.luminanceMaterial.threshold = threshold
  const fringe = phase.chroma > 0.02 ? phase.chroma * 0.011 : 0
  chromatic.offset.set(fringe, fringe * 0.62)
  warp.setWarp(phase.ripple, phase.blur, phase.glitch, phase.white, phase.riftT + phase.figureT, aspect)
}

function activeAnchors(phase: Phase, igloo: Igloo | null, slots: LabelAnchor[], meteor: Meteor, meteorSlots: LabelAnchor[]) {
  if ((phase.screen === 'field' || phase.screen === 'rift') && igloo) {
    igloo.fillLabels(slots)
    return slots
  }
  if (phase.screen === 'meteor') {
    meteor.fillLabels(meteorSlots)
    return meteorSlots
  }
  return []
}

function projectLabels(
  overlay: Overlay,
  anchors: LabelAnchor[],
  camera: PerspectiveCamera,
  ndc: Vector3,
  opacity: number,
) {
  const width = window.innerWidth
  const height = window.innerHeight
  const scale = Math.min(1, width / 1100)
  const views: ProjectedLabel[] = anchors.map((slot) => {
    ndc.copy(slot.position).project(camera)
    const anchorX = (ndc.x * 0.5 + 0.5) * width
    const anchorY = (-ndc.y * 0.5 + 0.5) * height
    const labelX = clamp(anchorX + slot.offsetX * scale, 24, width - 24)
    const labelY = clamp(anchorY + slot.offsetY * scale, 24, height - 24)
    const behind = ndc.z > 1
    const off = anchorX < -200 || anchorX > width + 200 || anchorY < -200 || anchorY > height + 200
    const visible = !behind && !off && opacity > 0.02
    return {
      anchorX,
      anchorY,
      labelX,
      labelY,
      opacity: visible ? opacity : 0,
      text: slot.text,
      visible,
      bent: slot.bent,
    }
  })
  overlay.updateLabels(views)
}

function addLights(scene: Scene, shadows: boolean) {
  scene.add(new HemisphereLight('#d5dee6', '#6d777f', 0.38))
  const key = new DirectionalLight('#f4f7f8', 2.75)
  key.position.set(-6.5, 12.5, 9.5)
  key.target.position.set(0.1, 1.2, 0)
  scene.add(key, key.target)
  if (shadows) {
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.radius = 4
    const shadow = key.shadow.camera
    shadow.near = 0.5
    shadow.far = 42
    shadow.left = -16
    shadow.right = 16
    shadow.top = 16
    shadow.bottom = -16
    shadow.updateProjectionMatrix()
    // Grazing snow was picking up acne as horizontal bands. Bias lifts the receiver off the occluder.
    key.shadow.bias = -0.0016
    key.shadow.normalBias = 0.085
  }
  const fill = new DirectionalLight('#c5d0da', 0.16)
  fill.position.set(7.5, 3.2, 6)
  scene.add(fill)
}

function createEnvironment(renderer: WebGLRenderer) {
  const room = new RoomEnvironment()
  room.traverse((object) => {
    if (!(object instanceof Mesh) || !object.material) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if ('color' in material && material.color instanceof Color) material.color.lerp(new Color('#c9d7e6'), 0.4)
    }
  })
  const pmrem = new PMREMGenerator(renderer)
  const texture = pmrem.fromScene(room, 0.04).texture
  pmrem.dispose()
  room.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    }
  })
  return texture
}
