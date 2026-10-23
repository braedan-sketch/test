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
    __blendyScrollTo?: (fraction: number) => void
  }
}

// Dome center. Direction is about 6° down so the camera sits low and close.
const EYE_TARGET: readonly [number, number, number] = [0.02, 3.05, 0.04]
const EYE_DIR: readonly [number, number, number] = [0.42, 0.17, 1.5]
const CRYSTAL_DIR: readonly [number, number, number] = [0.22, 0.04, 1]
// Upright bust, base on the ring at y 0, ears near y 2. Look slightly up at the chest.
const FOX_TARGET: readonly [number, number, number] = [0.0, 1.02, 0.0]
const FOX_DIR: readonly [number, number, number] = [0.32, -0.12, 1.05]
const scratchA = new Vector3()
const scratchB = new Vector3()
const poseA = new Vector3()
const poseB = new Vector3()
const poseC = new Vector3()
const poseD = new Vector3()

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
  renderer.transmissionResolutionScale = quality.low ? 0.35 : 1
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

  const scrollToFraction = (fraction: number) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    lenis.scrollTo(max * clamp(fraction, 0, 1), { immediate: true, force: true })
  }
  window.__blendy = {
    scrollTo(y) {
      lenis.scrollTo(y, { immediate: true, force: true })
    },
    scrollProgress(progress) {
      shotLocks = 0
      scrollToFraction(progress)
    },
  }
  window.__blendyScrollTo = (fraction) => {
    shotLocks = 0
    scrollToFraction(fraction)
  }
  const shotQuery = new URLSearchParams(window.location.search).get('shot')
  const shot = shotQuery == null || shotQuery === '' || !Number.isFinite(Number(shotQuery)) ? null : clamp(Number(shotQuery), 0, 1)
  let shotLocks = shot == null ? 0 : 90

  let figureGroup: Object3D | null = null
  const [meteor, rings, figure] = await Promise.all([
    createMeteor(quality, renderer),
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
    overlay.setActive(screen)
    lenis.resize()
    lenis.start()
    if (shot != null) {
      scrollToFraction(shot)
      shotLocks = 48
    }
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
    if (shotLocks > 0 && shot != null) {
      scrollToFraction(shot)
      shotLocks -= 1
    }
    if (!document.hidden) {
      shown = lerp(shown, targetProgress, 0.08)
      if (!revealed) overlay.setProgress(shown)
      if (ready && shown > 0.985 && now - started > 550) reveal()

      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const global = clamp(lenis.scroll / maxScroll, 0, 1)
      const marks = readMarks(maxScroll)
      const phase = readPhase(global, marks)

      const wire = phase.screen === 'field' ? 1 - smoother(phase.solid) : 0
      world.update(now / 1000, phase.mood, wire)
      clear.copy(world.fog.color)
      renderer.setClearColor(clear, 1)
      scene.environmentIntensity =
        phase.screen === 'field' || phase.screen === 'rift' ? 0.28 : phase.screen === 'meteor' ? 1.15 : 0.85

      igloo?.update(phase.burst, phase.solid, phase.dissolve, reducedMotion ? 0 : now / 1000)
      meteor.update(phase.meteorReveal, reducedMotion ? 0 : now / 1000)
      const clock = reducedMotion ? 0 : now / 1000
      rings.update(phase.ringsT + clock * 0.04, phase.ringsShown)
      figure.update(phase.figureAppear, phase.figureBlow, clock, dpr)

      applyCamera(phase, pos, target, up, camera, clock)
      applyGrade(phase, bloom, chromatic, warp, tone, vignette, camera.aspect)
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
  handoff: number
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

  const solid = inField ? smoother(clamp((fieldT - 0.36) / 0.12, 0, 1)) : 1
  const burst = inField ? clamp((fieldT - 0.58) / 0.42, 0, 1) : 1
  const dissolve = inField ? 0 : inRift ? smoother(clamp((riftT - 0.22) / 0.56, 0, 1)) : 1
  // Subjects overlap at the edges so a scroll stop never lands on an empty frame.
  const meteorReveal = inField
    ? 0
    : inRift
      ? smoother(clamp((riftT - 0.25) / 0.4, 0, 1))
      : inMeteor
        ? 1 - smoother(clamp((meteorT - 0.9) / 0.1, 0, 1))
        : 0
  // The last fifth of the rings scroll swings the camera onto the fox.
  // Rings fade as that swing finishes, so the frame always has a subject.
  const handoff = inRings ? smoother(clamp((ringsT - 0.78) / 0.22, 0, 1)) : inFigure ? 1 : 0
  const ringsShown = inMeteor
    ? smoother(clamp((meteorT - 0.84) / 0.16, 0, 1))
    : inRings
      ? 1 - smoother(clamp((handoff - 0.45) / 0.55, 0, 1))
      : 0
  const figureAppear = inRings ? smoother(clamp(handoff / 0.55, 0, 1)) : inFigure ? 1 : 0
  const wipe = inFigure
    ? smoother(clamp((figureT - 0.7) / 0.045, 0, 1)) * (1 - smoother(clamp((figureT - 0.8) / 0.045, 0, 1)))
    : 0
  // The stream is part of the fox hold. The glitch is a separate short tear.
  const figureBlow = inFigure ? smoother(clamp((figureT - 0.16) / 0.22, 0, 1)) * 0.42 : 0

  const ripple = 0
  const white = 0
  const glitch = wipe * 0.16
  const blur = 0
  const chroma = 0

  let screen: ScreenId = 'field'
  if (inFigure) screen = 'figure'
  else if (inRings) screen = 'rings'
  else if (inMeteor) screen = 'meteor'
  else if (inRift) screen = 'rift'

  let mood = 0
  if (inFigure) mood = 2 + smoother(clamp(figureT / 0.16, 0, 1))
  else if (inRings) mood = 2
  else if (inMeteor) mood = 1
  else if (inRift) mood = riftT

  const labelOpacity =
    inField && solid > 0.45 ? 1 : inRift ? 1 - smoother(clamp(riftT / 0.35, 0, 1)) : inMeteor && meteorT < 0.72 && meteorT > 0.04 ? 1 : 0

  const cycle = inFigure ? smoother(clamp(figureT / 0.1, 0, 1)) * (1 - wipe) : 0

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
    handoff,
    mood,
    ripple,
    blur,
    glitch,
    white,
    flash: 0,
    chroma,
    labelOpacity,
    cycle,
  }
}

function applyCamera(phase: Phase, pos: Vector3, target: Vector3, up: Vector3, camera: PerspectiveCamera, time: number) {
  up.set(0, 1, 0)
  const aspect = Math.max(0.2, camera.aspect)
  let fov = 40
  if (phase.screen === 'field' || (phase.screen === 'rift' && phase.riftT < 0.02)) {
    fov = 40
    // Wire and solid share this 3/4 eye pose, so the lines dissolve into the ice in place.
    target.set(EYE_TARGET[0], EYE_TARGET[1], EYE_TARGET[2])
    up.set(0, 1, 0)
    const span = phase.burst
    const eyeWidth = lerp(4.15, 4.75, span)
    const eyeHeight = lerp(2.07, 2.7, span)
    const dEye =
      aspect >= 1
        ? desktopEyeDistance(eyeWidth, eyeHeight, aspect, fov)
        : fitBox(eyeWidth, eyeHeight, 0.83, 0.5, aspect, fov)
    placeAlong(pos, EYE_TARGET, EYE_DIR, dEye)
    // Look beside the dome so it sits in the centre-right third. Portrait is unchanged.
    if (aspect >= 1) aimSubjectRight(target, pos, 0.16, aspect, fov)
  } else if (phase.screen === 'rift') {
    fov = 36
    const crystalTarget: [number, number, number] = [meteorCenter.x, meteorCenter.y, meteorCenter.z]
    const riftEye =
      aspect >= 1 ? desktopEyeDistance(4.75, 2.7, aspect, 40) : fitBox(4.75, 2.7, 0.83, 0.5, aspect, 40)
    placeAlong(scratchA, EYE_TARGET, EYE_DIR, riftEye)
    placeAlong(scratchB, crystalTarget, CRYSTAL_DIR, fitBox(1.9, 2.55, 0.54, 0.46, aspect, fov))
    const riftBlend = smoother(phase.riftT)
    mix3(target, EYE_TARGET, crystalTarget, riftBlend)
    pos.copy(scratchA).lerp(scratchB, riftBlend)
    if (aspect >= 1) aimSubjectRight(target, pos, 0.16 * (1 - riftBlend), aspect, 40)
  } else if (phase.screen === 'meteor') {
    fov = 34
    const hold = fitBox(1.9, 2.55, 0.54, 0.46, aspect, fov)
    target.set(meteorCenter.x, meteorCenter.y, meteorCenter.z)
    placeAlong(pos, [target.x, target.y, target.z], CRYSTAL_DIR, hold)
    const leave = smoother(clamp((phase.meteorT - 0.9) / 0.1, 0, 1))
    if (leave > 0) {
      poseA.copy(pos)
      poseB.copy(target)
      const framed = fitBox(4.6, 4.6, 0.7, 0.85, aspect, 36)
      poseC.set(0, framed * 1.25, 0)
      poseD.set(0, 0.15, 0)
      pos.lerpVectors(poseA, poseC, leave)
      target.lerpVectors(poseB, poseD, leave)
      fov = lerp(34, 36, leave)
    }
  } else if (phase.screen === 'rings') {
    fov = 36
    placeRings(phase.ringsT, aspect, pos, target, up)
    if (phase.handoff > 0) blendTowardFox(phase, aspect, pos, target, up, phase.handoff)
  } else {
    fov = 34
    placeFox(phase, aspect, pos, target, up)
  }

  holdDrift(pos, target, time)
  guardUp(pos, target, up)
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  camera.up.copy(up)
  camera.position.copy(pos)
  camera.lookAt(target)
}

function placeRings(ringsT: number, aspect: number, pos: Vector3, target: Vector3, up: Vector3) {
  const framed = fitBox(4.6, 4.6, 0.7, 0.85, aspect, 36)
  const far = framed * 1.25
  const near = framed * 0.6
  // The last part of the old dive looked straight down into the glass and
  // came back fully black on Metal. Hold the height once the rings fill the frame.
  const y = Math.max(framed * 0.9, lerp(far, near, smoother(ringsT)))
  const roll = Math.min(1, ringsT) * 0.55
  pos.set(0, y, 0)
  target.set(0, 0.15, 0)
  up.set(Math.sin(roll), 0, Math.cos(roll))
}

function blendTowardFox(phase: Phase, aspect: number, pos: Vector3, target: Vector3, up: Vector3, amount: number) {
  poseA.copy(pos)
  poseB.copy(target)
  const saved = poseD.copy(up)
  placeFox(phase, aspect, poseC, target, up)
  pos.lerpVectors(poseA, poseC, amount)
  target.lerpVectors(poseB, target, amount)
  up.lerpVectors(saved, up, amount)
  if (up.lengthSq() < 1e-6) up.set(0, 1, 0)
  else up.normalize()
}

function placeFox(phase: Phase, aspect: number, pos: Vector3, target: Vector3, up: Vector3) {
  const orbit = clamp(phase.figureT / 0.7, 0, 1)
  const fillH = 0.66
  const fillW = aspect < 1 ? 0.92 : 0.55
  const dist = fitBox(1.18, 2.08, fillW, fillH, aspect, 34)
  const yaw = lerp(-0.02, 0.05, orbit)
  const dir: [number, number, number] = [
    FOX_DIR[0] * Math.cos(yaw) - FOX_DIR[2] * Math.sin(yaw),
    FOX_DIR[1] + orbit * 0.04,
    FOX_DIR[0] * Math.sin(yaw) + FOX_DIR[2] * Math.cos(yaw),
  ]
  target.set(FOX_TARGET[0], FOX_TARGET[1], FOX_TARGET[2])
  placeAlong(pos, FOX_TARGET, dir, dist + phase.figureBlow * 0.35)
  up.set(0, 1, 0)
}

function holdDrift(pos: Vector3, target: Vector3, time: number) {
  if (reducedMotion) return
  const sway = Math.sin(time * 0.23)
  const nod = Math.cos(time * 0.19)
  pos.x += sway * 0.4
  pos.y += nod * 0.16
  pos.z += Math.sin(time * 0.17 + 1.2) * 0.32
  target.x += nod * 0.08
  target.y += sway * 0.04
}

function guardUp(pos: Vector3, target: Vector3, up: Vector3) {
  const vx = target.x - pos.x
  const vy = target.y - pos.y
  const vz = target.z - pos.z
  const vlen = Math.hypot(vx, vy, vz) || 1
  const ulen = Math.hypot(up.x, up.y, up.z) || 1
  const dot = Math.abs((vx * up.x + vy * up.y + vz * up.z) / (vlen * ulen))
  if (dot > 0.98) {
    if (Math.abs(vy / vlen) > 0.9) up.set(0, 0, 1)
    else up.set(0, 1, 0)
  }
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

function desktopEyeDistance(width: number, height: number, aspect: number, fovDeg: number) {
  const portraitAspect = 390 / 844
  const portrait = fitBox(width, height, 0.83, 0.5, portraitAspect, fovDeg)
  const vHalf = (fovDeg * Math.PI) / 360
  const tanPortrait = Math.tan(vHalf) * portraitAspect
  const tanDesktop = Math.tan(vHalf) * aspect
  return portrait * (tanPortrait / tanDesktop) * (0.83 / 0.375)
}

function aimSubjectRight(look: Vector3, pos: Vector3, fraction: number, aspect: number, fovDeg: number) {
  if (fraction <= 0) return
  const vHalf = (fovDeg * Math.PI) / 360
  const tanH = Math.tan(vHalf) * aspect
  const dx = look.x - pos.x
  const dz = look.z - pos.z
  const len = Math.hypot(dx, dz) || 1
  const shift = len * tanH * 2 * fraction
  // Screen-right. Sliding the aim the other way parks the subject on the right.
  const rx = -dz / len
  const rz = dx / len
  look.x -= rx * shift
  look.z -= rz * shift
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
  vignette: VignetteEffect,
  aspect: number,
) {
  const burst = phase.screen === 'field' ? phase.burst : 0
  let intensity = 0.08 + burst * 0.28
  let threshold = 0.97
  if (phase.screen === 'field') {
    intensity = 0.1 + phase.solid * 0.62 + burst * 0.4
    threshold = 0.7
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
  const figure = phase.screen === 'figure'
  const lightPaper = phase.screen === 'meteor' || phase.screen === 'rings' || (phase.screen === 'field' && phase.solid < 0.25)
  vignette.darkness = figure ? 0.5 : lightPaper ? 0.05 : 0.22
  vignette.offset = figure ? 0.4 : lightPaper ? 0.6 : 0.42
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
      constellation: slot.constellation === true,
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
