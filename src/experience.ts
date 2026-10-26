import Lenis from 'lenis'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
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
import { FrostEffect } from './frost'
import { bindHeroProgress } from './heroModel'
import { loadIgloo, makeLabelSlots, type Igloo, type LabelAnchor } from './igloo'
import { clamp, lerp, smoother } from './math'
import { createMeteor, meteorCenter, type Meteor } from './meteor'
import type { Overlay, ProjectedLabel } from './overlay'
import { detectQuality, reducedMotion } from './quality'
import { createRings } from './rings'
import { Ambience } from './sound'
import { WarpEffect } from './warp'
import { createWorld } from './world'

type Marks = { rift: number; meteor: number; rings: number; figure: number }

declare global {
  interface Window {
    __blendy?: {
      scrollTo: (y: number) => void
      scrollProgress: (progress: number) => void
      debug?: () => Record<string, unknown>
      frame?: { ms: number; p50: number; p95: number; fps: number; n: number }
    }
    __blendyScrollTo?: (fraction: number) => void
  }
}

// v12 dome top is 2.37.
const EYE_TARGET: readonly [number, number, number] = [0.08, 1.2, 0.02]
const EYE_DIR: readonly [number, number, number] = [0.42, 0.18, 1.55]
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
  renderer.toneMappingExposure = 0.96
  renderer.transmissionResolutionScale = quality.low ? 0.35 : 1
  renderer.setClearColor('#c5c8cc', 1)
  if (quality.shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
  }

  const scene = new Scene()
  const camera = new PerspectiveCamera(40, 1, 0.08, 1600)
  // Layer 1 is the crystal's inner glow. It stays out of the opaque
  // transmission pre-pass and is drawn with the transparent objects.
  camera.layers.enable(1)
  let targetProgress = 0
  let shown = 0
  bindHeroProgress((value) => {
    const next = Math.min(0.92, value)
    targetProgress = Math.max(targetProgress, next)
    // Paint during the download. The frame loop starts only after the other heroes parse.
    if (targetProgress > shown) {
      shown = targetProgress
      overlay.setProgress(shown)
    }
  })
  const iglooPromise = loadIgloo(quality, renderer, () => {})
  const world = createWorld(scene, quality, renderer)
  scene.environment = createEnvironment(renderer)
  scene.environmentIntensity = 0.35
  addLights(scene, quality.shadows)

  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    // MSAA on the real GPU softens the ring fringe. SwiftShader stalls on it,
    // and the loader never finishes, so that path keeps SMAA only.
    // MSAA softens brick edges. SMAA at the low preset keeps the fringe without that blur.
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
    offset: new Vector2(0.0011, 0.0006),
    radialModulation: false,
    modulationOffset: 0,
  })
  const softGpu = softwareGpu(renderer)
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 8,
    focusRange: 14,
    // The half-resolution bokeh was the hero sharpness drop. The field stays sharp.
    bokehScale: 0,
    resolutionScale: 1,
  })
  const warp = new WarpEffect()
  const noise = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,
  })
  noise.blendMode.setOpacity(0.12)
  const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.38 })
  const frost = new FrostEffect()
  const smaa = quality.smaa ? new SMAAEffect({ preset: SMAAPreset.LOW }) : null
  const normalPass = quality.low || softGpu ? null : new NormalPass(scene, camera, { resolutionScale: 0.75 })
  const ssao = normalPass
    ? new SSAOEffect(camera, normalPass.texture, {
        samples: 10,
        rings: 5,
        radius: 0.055,
        intensity: 0.85,
        bias: 0.05,
        fade: 0.012,
        luminanceInfluence: 0.35,
        resolutionScale: 0.5,
      })
    : null
  composer.addPass(new RenderPass(scene, camera))
  const ssaoPass = normalPass && ssao ? new EffectPass(camera, ssao) : null
  if (normalPass && ssaoPass) {
    composer.addPass(normalPass)
    composer.addPass(ssaoPass)
  }
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX })
  composer.addPass(new EffectPass(camera, bloom))
  // SwiftShader spends seconds inside the DoF pass. Keep it off until the
  // igloo has decoded, or the loader never reaches the reveal threshold.
  const dofPass = new EffectPass(camera, dof)
  dofPass.enabled = false
  composer.addPass(dofPass)
  composer.addPass(new EffectPass(camera, warp))
  composer.addPass(new EffectPass(camera, chromatic))
  if (smaa) composer.addPass(new EffectPass(camera, smaa))
  composer.addPass(
    new EffectPass(camera, noise, frost, vignette, tone),
  )

  let fieldDpr = Math.min(window.devicePixelRatio || 1, quality.dprCap)
  let crystalDpr = Math.min(fieldDpr, 1.5)
  let dpr = fieldDpr
  let crystalSlow = 0
  const resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setPixelRatio(dpr)
    composer.setSize(width, height, false)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
  }
  const setDpr = (next: number) => {
    if (Math.abs(next - dpr) < 0.02) return
    dpr = next
    resize()
  }
  resize()
  window.addEventListener('resize', resize)
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    console.warn('WebGL context lost')
  })

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
  const frameStats = { ms: 0, p50: 0, p95: 0, fps: 0, n: 0 }
  const frameTimes: number[] = []
  window.__blendy = {
    scrollTo(y) {
      lenis.scrollTo(y, { immediate: true, force: true })
    },
    scrollProgress(progress) {
      shotLocks = 0
      scrollToFraction(progress)
    },
    frame: frameStats,
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
    createRings(quality, renderer),
    createFigure(quality),
  ])
  scene.add(meteor.group, rings.group, figure.group)
  figureGroup = figure.group
  meteor.group.visible = false
  rings.group.visible = false
  figure.group.visible = false

  const pos = new Vector3()
  const target = new Vector3()
  const focusPoint = new Vector3(0.08, 1.2, 0)
  // Field focus stays on the dome. Other scenes follow the look target.
  dof.target = focusPoint
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
        wire: igloo?.wireStats ?? null,
      }
    }
  }
  const up = new Vector3(0, 1, 0)
  const ndc = new Vector3()
  const clear = new Color('#c5c8cc')
  let igloo: Igloo | null = null
  let slots: LabelAnchor[] = []
  const meteorSlots: LabelAnchor[] = makeLabelSlots(meteor.labelCount)
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
    dofPass.enabled = true
    if (shot != null) {
      scrollToFraction(shot)
      shotLocks = 48
    }
  }

  void iglooPromise
    .then(async (loaded) => {
      igloo = loaded
      scene.add(loaded.group)
      slots = makeLabelSlots(loaded.labelCount)
      targetProgress = 0.98
      try {
        await renderer.compileAsync(loaded.group, camera, scene)
      } catch (error) {
        console.warn(error)
      }
      targetProgress = 1
      ready = true
    })
    .catch((error: unknown) => {
      console.error(error)
      overlay.fail(brand.loader.error)
    })

  let last = performance.now()
  const frame = (now: number) => {
    const rawDt = Math.max(0, (now - last) / 1000)
    const dt = Math.min(0.05, rawDt)
    last = now
    lenis.raf(now)
    if (shotLocks > 0 && shot != null) {
      scrollToFraction(shot)
      shotLocks -= 1
    }
    if (!document.hidden) {
      shown = Math.max(shown, lerp(shown, targetProgress, 0.35))
      if (!revealed) overlay.setProgress(shown)
      if (ready && shown > 0.985 && now - started > 550) reveal()
      // A multisampled frame blocks the Draco worker messages, so the igloo
      // decode never completes. The loader is up; draw once the mesh is in.
      if (!ready) {
        requestAnimationFrame(frame)
        return
      }

      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const global = clamp(lenis.scroll / maxScroll, 0, 1)
      const marks = readMarks(maxScroll)
      const phase = readPhase(global, marks)

      const wire = phase.screen === 'field' ? 1 - smoother(phase.solid) : 0
      const crystalView = phase.screen === 'rift' || phase.screen === 'meteor'
      if (crystalView) {
        if (rawDt > 1 / 45) crystalSlow += rawDt
        else crystalSlow = Math.max(0, crystalSlow - rawDt)
        if (crystalSlow >= 1 && crystalDpr > 1.05) {
          crystalDpr = Math.max(1, +(crystalDpr - 0.25).toFixed(2))
          crystalSlow = 0
        }
        setDpr(crystalDpr)
      } else {
        crystalSlow = 0
        setDpr(fieldDpr)
      }
      world.update(now / 1000, phase.mood, wire, phase.screen === 'field', phase.screen === 'rings', phase.screen === 'figure')
      clear.copy(world.fog.color)
      renderer.setClearColor(clear, 1)
      scene.environmentIntensity =
        phase.screen === 'field' || phase.screen === 'rift'
          ? 0.1
          : phase.screen === 'meteor'
            ? 0.26
            : phase.screen === 'rings'
              ? 0.22
              : 0.22

      const heroSharp = phase.screen === 'field' || phase.screen === 'rift'
      if (normalPass) normalPass.enabled = !heroSharp
      if (ssaoPass) ssaoPass.enabled = !heroSharp
      igloo?.update(phase.burst, phase.solid, phase.dissolve, reducedMotion ? 0 : now / 1000)
      meteor.update(phase.meteorReveal, reducedMotion ? 0 : now / 1000)
      const clock = reducedMotion ? 0 : now / 1000
      rings.update(phase.ringsT, phase.ringsShown)
      figure.update(phase.figureAppear, phase.figureBlow, clock, dpr)

      applyCamera(phase, pos, target, up, camera, clock)
      dof.target = phase.screen === 'field' ? focusPoint : target
      dof.bokehScale = phase.screen === 'field' || phase.screen === 'rift' ? 0 : softGpu ? 0.08 : 0.12
      applyGrade(phase, bloom, chromatic, warp, tone, vignette, frost, camera.aspect)
      overlay.setFlash(phase.flash * 0.35)
      overlay.setUiDim(phase.screen === 'rings' ? 1 : 1 - phase.burst * 0.04)
      overlay.setScrollProgress(global)

      let nav: ScreenId = phase.screen
      if (phase.screen === 'rift' && massCopyVisible()) nav = 'meteor'
      if (phase.screen === 'meteor' && phase.meteorT > 0.88) nav = 'rings'
      if (nav !== screen) {
        screen = nav
        overlay.setActive(screen)
      }
      // The rings frames stay chrome-free. The arrival (stop 08) does not.
      delete document.body.dataset.quiet
      fadeMeteorCopy(phase)
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
        igloo && nav === 'field'
          ? igloo.readout(phase.burst, phase.solid)
          : nav === 'rift'
            ? 'RIFT'
            : nav === 'meteor'
              ? 'MASS'
              : nav === 'rings'
                ? 'RINGS'
                : 'WITNESS',
        `${camera.position.x.toFixed(2)}   ${camera.position.y.toFixed(2)}   ${camera.position.z.toFixed(2)}`,
      )

      composer.render(dt)
      noteFrame(rawDt)
      adaptFrame(dt)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  function noteFrame(dt: number) {
    const ms = dt * 1000
    frameTimes.push(ms)
    if (frameTimes.length > 24) frameTimes.shift()
    let sum = 0
    for (const sample of frameTimes) sum += sample
    const sorted = [...frameTimes].sort((a, b) => a - b)
    const last = sorted.length - 1
    frameStats.ms = ms
    frameStats.n = frameTimes.length
    frameStats.p50 = sorted[Math.floor(sorted.length * 0.5)] ?? ms
    frameStats.p95 = sorted[Math.min(last, Math.floor(sorted.length * 0.95))] ?? ms
    frameStats.fps = sum > 0 ? (frameTimes.length * 1000) / sum : 0
  }

  function adaptFrame(dt: number) {
    if (!revealed || adapted) return
    accum += dt
    samples += 1
    if (accum < 1) return
    if (samples / accum < 48 && fieldDpr > 1.05) {
      const onField = Math.abs(dpr - fieldDpr) < 0.02
      fieldDpr = Math.max(1, +(fieldDpr - 0.3).toFixed(2))
      crystalDpr = Math.min(crystalDpr, fieldDpr)
      if (onField) setDpr(fieldDpr)
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
  const meteorReveal = inMeteor ? 1 : inRift ? smoother(clamp((riftT - 0.62) / 0.38, 0, 1)) : 0
  const handoff = 0
  const ringsShown = inRings ? 1 : 0
  const figureAppear = inFigure ? 1 : 0
  const wipe = inFigure
    ? smoother(clamp((figureT - 0.7) / 0.045, 0, 1)) * (1 - smoother(clamp((figureT - 0.8) / 0.045, 0, 1)))
    : 0
  // The stream is part of the fox hold. The glitch is a separate short tear.
  const figureBlow = 0

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
    const eyeWidth = lerp(4.4, 5.05, span)
    const eyeHeight = lerp(2.75, 3.2, span)
    const dEye =
      aspect >= 1
        ? desktopEyeDistance(eyeWidth, eyeHeight, aspect, fov) * 0.72
        : fitBox(eyeWidth, eyeHeight, 0.78, 0.58, aspect, fov)
    placeAlong(pos, EYE_TARGET, EYE_DIR, dEye)
    // Look beside the dome so it sits in the centre-right third. Portrait is unchanged.
    if (aspect >= 1) aimSubjectRight(target, pos, 0.16, aspect, fov)
  } else if (phase.screen === 'rift') {
    fov = 36
    const hold = crystalHold(aspect)
    const crystalLook: [number, number, number] = [meteorCenter.x, crystalAimY(aspect, hold), meteorCenter.z]
    const crystalPos: [number, number, number] = [meteorCenter.x, meteorCenter.y, meteorCenter.z]
    const riftEye =
      aspect >= 1
        ? desktopEyeDistance(5.05, 3.2, aspect, 40) * 0.72
        : fitBox(5.05, 3.2, 0.78, 0.58, aspect, 40)
    placeAlong(scratchA, EYE_TARGET, EYE_DIR, riftEye)
    placeAlong(scratchB, crystalPos, CRYSTAL_DIR, hold)
    const riftBlend = smoother(phase.riftT)
    mix3(target, EYE_TARGET, crystalLook, riftBlend)
    pos.copy(scratchA).lerp(scratchB, riftBlend)
    if (aspect >= 1) aimSubjectRight(target, pos, 0.16 * (1 - riftBlend), aspect, 40)
  } else if (phase.screen === 'meteor') {
    fov = 34
    const hold = crystalHold(aspect)
    target.set(meteorCenter.x, crystalAimY(aspect, hold), meteorCenter.z)
    placeAlong(pos, [meteorCenter.x, meteorCenter.y, meteorCenter.z], CRYSTAL_DIR, hold)
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
    fov = 32
    placeRings(phase.ringsT, aspect, pos, target, up)
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
  const portrait = aspect < 1
  const fillW = portrait ? 0.88 : 0.9
  const fillH = portrait ? 0.8 : 0.8
  const dist = fitBox(3.35, 3.35, fillW, fillH, aspect, 32)
  // A few degrees off the portal axis so the stone's depth reads.
  const yaw = 0.34 + ringsT * 0.08
  const centerY = 2.25
  pos.set(Math.sin(yaw) * dist, centerY + dist * 0.1, Math.cos(yaw) * dist)
  target.set(ringsT * 0.06, centerY, 0)
  up.set(0, 1, 0)
}

function placeFox(phase: Phase, aspect: number, pos: Vector3, target: Vector3, up: Vector3) {
  const orbit = clamp(phase.figureT / 0.7, 0, 1)
  const fillH = aspect < 1 ? 0.46 : 0.66
  const fillW = aspect < 1 ? 0.58 : 0.55
  const dist = fitBox(1.18, 2.08, fillW, fillH, aspect, 34)
  const yaw = lerp(-0.02, 0.05, orbit)
  const dir: [number, number, number] = [
    FOX_DIR[0] * Math.cos(yaw) - FOX_DIR[2] * Math.sin(yaw),
    FOX_DIR[1] + orbit * 0.04,
    FOX_DIR[0] * Math.sin(yaw) + FOX_DIR[2] * Math.cos(yaw),
  ]
  target.set(FOX_TARGET[0], FOX_TARGET[1], FOX_TARGET[2])
  placeAlong(pos, FOX_TARGET, dir, dist)
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
    if (!object.name.startsWith('igloo_')) return
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

/** Fitted crystal_v2 is 2.15 tall and about 1.5 wide. Height sets the frame. */
function crystalHold(aspect: number) {
  const fillH = aspect >= 1 ? 0.42 : 0.26
  const fillW = aspect >= 1 ? 0.72 : 0.5
  return fitBox(1.05, 1.45, fillW, fillH, aspect, 34)
}

/** Portrait only: drop the aim so the shard centre sits at 35% from the top. */
function crystalAimY(aspect: number, distance: number) {
  if (aspect >= 1) return meteorCenter.y
  const vHalf = (34 * Math.PI) / 360
  const ndcY = 1 - 2 * 0.35
  return meteorCenter.y - ndcY * distance * Math.tan(vHalf)
}

function fadeMeteorCopy(phase: Phase) {
  const node = document.querySelector(".stage[data-screen='meteor'] .copy")
  if (!(node instanceof HTMLElement)) return
  const fade =
    phase.screen === 'meteor'
      ? 1 - smoother(clamp((phase.meteorT - 0.7) / 0.16, 0, 1))
      : phase.screen === 'rift'
        ? 1
        : 0
  node.style.opacity = fade.toFixed(3)
}

function massCopyVisible() {
  const title = document.querySelector(".stage[data-screen='meteor'] h2")
  if (!(title instanceof HTMLElement)) return false
  const rect = title.getBoundingClientRect()
  return rect.top < window.innerHeight * 0.86 && rect.bottom > window.innerHeight * 0.05
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
  frost: FrostEffect,
  aspect: number,
) {
  // Gap light blooms on the hero. Crystal highlights stay under the threshold.
  if (tone.blendMode.blendFunction !== BlendFunction.SRC) tone.blendMode.blendFunction = BlendFunction.SRC
  const figure = phase.screen === 'figure'
  const rings = phase.screen === 'rings'
  const heroGlow = phase.screen === 'field' || phase.screen === 'rift'
  frost.setGrade(phase.screen === 'meteor' || figure ? 1 : 0)
  // v14 faces were already bright at 1.34. A smaller lift keeps the seam highlights.
  frost.setExposure(phase.screen === 'field' ? 1.1 : 1)
  // The frost edge resample softens the hero, which sits in the right third. The fox does not get it.
  frost.setEdge(phase.screen === 'field' ? 0 : 1)
  if (rings) {
    bloom.intensity = 0.62
    bloom.luminanceMaterial.threshold = 0.68
    bloom.mipmapBlurPass.radius = 0.46
  } else if (figure) {
    bloom.intensity = 0.06
    bloom.luminanceMaterial.threshold = 0.96
    bloom.mipmapBlurPass.radius = 0.08
  } else if (heroGlow) {
    // Fox stays sharp with almost no bloom. The hero mip radius was the scene-specific blur.
    bloom.intensity = 0.5
    bloom.luminanceMaterial.threshold = 0.72
    bloom.luminanceMaterial.smoothing = 0.04
    bloom.mipmapBlurPass.radius = 0.03
  } else {
    bloom.intensity = 0.08
    bloom.luminanceMaterial.threshold = 0.96
    bloom.mipmapBlurPass.radius = 0.3
  }
  vignette.darkness = 0.55
  vignette.offset = 0.35
  const wireIntro = phase.screen === 'field' && phase.solid < 0.45
  const fringe = wireIntro || rings || figure ? 0 : 0.0011 + (phase.chroma > 0.02 ? phase.chroma * 0.001 : 0)
  chromatic.offset.set(fringe, fringe * 0.45)
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
    let labelX = clamp(anchorX + slot.offsetX * scale, 24, width - 24)
    let labelY = clamp(anchorY + slot.offsetY * scale, 24, height - 24)
    let drop = false
    if (slot.bent && height > width) {
      // Stay inside the column: below the header, above the copy, clear of the rail.
      if (slot.text.trim().startsWith('FACE')) drop = true
      const side = slot.offsetX <= 0 ? -1 : 1
      labelX = clamp(anchorX + side * 46, width * 0.16, width * 0.78)
      const yNudge = slot.offsetY > 50 ? 32 : slot.offsetY < -40 ? -26 : side < 0 ? -14 : 16
      labelY = clamp(anchorY + yNudge, height * 0.22, height * 0.52)
    }
    const behind = ndc.z > 1
    const off = anchorX < -200 || anchorX > width + 200 || anchorY < -200 || anchorY > height + 200
    const visible = !drop && !behind && !off && opacity > 0.02
    return {
      anchorX,
      anchorY,
      labelX,
      labelY,
      opacity: visible ? opacity : 0,
      text: slot.text,
      visible,
      bent: slot.bent && height <= width,
      constellation: slot.constellation === true,
    }
  })
  overlay.updateLabels(views)
}

function softwareGpu(renderer: WebGLRenderer) {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  if (!info) return false
  const name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '')
  return /swiftshader|llvmpipe|softpipe|software/i.test(name)
}

function addLights(scene: Scene, shadows: boolean) {
  scene.add(new HemisphereLight('#d5dee6', '#6d7882', 0.32))
  const key = new DirectionalLight('#f7f4ee', 2.7)
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
  const fill = new DirectionalLight('#9aa8b4', 0.08)
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
