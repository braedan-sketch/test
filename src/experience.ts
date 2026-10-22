import Lenis from 'lenis'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
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
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  HalfFloatType,
  BackSide,
  Color,
} from 'three'
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
    }
  }
}

const HIGH: readonly [number, number, number] = [0.15, 10.6, 6.2]
const HIGH_TARGET: readonly [number, number, number] = [0.05, 0.85, 0.1]
const EYE: readonly [number, number, number] = [0.7, 2.25, 10.6]
const EYE_TARGET: readonly [number, number, number] = [0.05, 1.4, 0.05]
const WIDE: readonly [number, number, number] = [1.05, 3.15, 15.2]
const WIDE_TARGET: readonly [number, number, number] = [0.0, 1.75, 0.0]

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
  renderer.transmissionResolutionScale = quality.low ? 0.35 : 0.5
  renderer.setClearColor('#c5c8cc', 1)
  if (quality.shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
  }

  const scene = new Scene()
  const camera = new PerspectiveCamera(36, 1, 0.05, 220)
  const world = createWorld(scene, quality)
  scene.environment = createEnvironment(renderer)
  scene.environmentIntensity = 0.36
  addLights(scene, quality.shadows)

  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: 0,
  })
  const bloom = new BloomEffect({
    intensity: 0.4,
    luminanceThreshold: 0.72,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    radius: 0.68,
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
  noise.blendMode.setOpacity(0.14)
  const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.28 })
  const smaa = quality.smaa ? new SMAAEffect({ preset: SMAAPreset.MEDIUM }) : null
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new EffectPass(camera, bloom))
  composer.addPass(new EffectPass(camera, warp))
  composer.addPass(new EffectPass(camera, chromatic))
  if (smaa) composer.addPass(new EffectPass(camera, smaa))
  composer.addPass(
    new EffectPass(camera, noise, vignette, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })),
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

  const meteor = createMeteor(quality)
  const rings = createRings(quality)
  const figure = createFigure(quality)
  scene.add(meteor.group, rings.group, figure.group)
  meteor.group.visible = false
  rings.group.visible = false
  figure.group.visible = false

  const pos = new Vector3()
  const target = new Vector3()
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
      scene.environmentIntensity = phase.screen === 'meteor' || phase.screen === 'rift' ? 0.85 : 0.36

      igloo?.update(phase.burst, phase.solid, phase.dissolve)
      meteor.update(phase.meteorReveal)
      rings.update(phase.ringsT, phase.ringsShown)
      figure.update(phase.figureAppear, phase.figureBlow, reducedMotion ? 0 : now / 1000, dpr)

      applyCamera(phase, pos, target, up, camera)
      applyGrade(phase, bloom, chromatic, warp, camera.aspect)
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

  const solid = inField ? smoother(clamp((fieldT - 0.12) / 0.28, 0, 1)) : 1
  const burst = inField ? clamp((fieldT - 0.42) / 0.58, 0, 1) : 1
  const dissolve = inField ? 0 : inRift ? smoother(clamp((riftT - 0.22) / 0.56, 0, 1)) : 1
  const meteorReveal = inField ? 0 : inRift ? smoother(clamp((riftT - 0.34) / 0.5, 0, 1)) : inMeteor ? 1 - smoother(clamp((meteorT - 0.8) / 0.2, 0, 1)) : 0
  const ringsShown = inRings ? 1 : 0
  const figureAppear = inFigure ? smoother(clamp(figureT / 0.14, 0, 1)) : 0
  const figureBlow = inFigure ? smoother(clamp((figureT - 0.68) / 0.16, 0, 1)) : 0

  const ripple = inRift ? Math.sin(riftT * Math.PI) : 0
  const meteorWhite = inMeteor ? smoother(clamp((meteorT - 0.7) / 0.26, 0, 1)) : 0
  const ringsIn = inRings ? 1 - smoother(clamp(ringsT / 0.12, 0, 1)) : 0
  const ringsOut = inRings ? smoother(clamp((ringsT - 0.8) / 0.2, 0, 1)) : 0
  const figureIn = inFigure ? 1 - smoother(clamp(figureT / 0.1, 0, 1)) : 0
  const white = clamp(meteorWhite * 0.15 + ringsIn + ringsOut + figureIn * 0.75, 0, 1)
  const glitch = inFigure ? smoother(clamp((figureT - 0.78) / 0.2, 0, 1)) : 0
  const blur = clamp(ripple * 0.95 + meteorWhite * 0.85 + ringsOut * 0.35, 0, 1)
  const chroma = clamp(ripple + (inField && burst > 0.84 ? (burst - 0.84) / 0.16 : 0) * 0.22 + glitch * 0.45, 0, 1)

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
  if (phase.screen === 'field' || (phase.screen === 'rift' && phase.riftT < 0.02)) {
    const dolly = clamp(phase.fieldT / 0.42, 0, 1)
    const boom = clamp((phase.fieldT - 0.42) / 0.58, 0, 1)
    if (phase.fieldT < 0.42) {
      mix3(pos, HIGH, EYE, smoother(dolly))
      mix3(target, HIGH_TARGET, EYE_TARGET, smoother(dolly))
    } else {
      mix3(pos, EYE, WIDE, smoother(boom))
      mix3(target, EYE_TARGET, WIDE_TARGET, smoother(boom))
    }
  } else if (phase.screen === 'rift') {
    const meteorPos: [number, number, number] = [meteorCenter.x + 1.15, meteorCenter.y + 0.35, meteorCenter.z + 8.2]
    const meteorTarget: [number, number, number] = [meteorCenter.x, meteorCenter.y, meteorCenter.z]
    mix3(pos, WIDE, meteorPos, smoother(phase.riftT))
    mix3(target, WIDE_TARGET, meteorTarget, smoother(phase.riftT))
  } else if (phase.screen === 'meteor') {
    const t = phase.meteorT
    pos.set(
      lerp(meteorCenter.x + 1.15, meteorCenter.x - 0.05, t),
      lerp(meteorCenter.y + 0.35, meteorCenter.y + 0.02, t),
      lerp(meteorCenter.z + 8.2, meteorCenter.z - 3.1, t),
    )
    target.set(meteorCenter.x, meteorCenter.y, pos.z - 1.4)
  } else if (phase.screen === 'rings') {
    const y = lerp(5.4, 0.16, phase.ringsT)
    const roll = phase.ringsT * 0.62
    pos.set(0, y, 0)
    target.set(0, 0, 0)
    up.set(Math.sin(roll), 0, Math.cos(roll))
  } else {
    const orbit = clamp(phase.figureT / 0.7, 0, 1)
    const ang = lerp(1.15, 2.45, orbit)
    const radius = lerp(5.15, 4.35, orbit)
    pos.set(Math.sin(ang) * radius, lerp(1.35, 1.7, orbit) + phase.figureBlow * 0.35, Math.cos(ang) * radius)
    target.set(0.15, 0.95, 0.05)
  }

  camera.up.copy(up)
  camera.position.copy(pos)
  camera.lookAt(target)
}

function mix3(out: Vector3, a: readonly [number, number, number], b: readonly [number, number, number], t: number) {
  out.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))
}

function applyGrade(
  phase: Phase,
  bloom: BloomEffect,
  chromatic: ChromaticAberrationEffect,
  warp: WarpEffect,
  aspect: number,
) {
  const burst = phase.screen === 'field' ? phase.burst : phase.screen === 'rift' ? 1 : 0
  let intensity = 0.34 + burst * 0.95
  let threshold = lerp(0.78, 0.5, burst)
  if (phase.screen === 'field' && phase.solid < 0.35) {
    intensity = 0.72
    threshold = 0.62
  }
  if (phase.screen === 'rings') {
    intensity = 1.25
    threshold = 0.8
  }
  if (phase.screen === 'meteor') intensity = 0.55 + phase.meteorT * 0.35
  if (phase.white > 0.4) intensity += 0.3
  bloom.intensity = intensity
  bloom.luminanceMaterial.threshold = threshold
  const fringe = 0.00035 + phase.chroma * 0.012
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
  scene.add(new HemisphereLight('#d7e0e6', '#6a7378', 0.58))
  const key = new DirectionalLight('#f4f7fa', 0.72)
  key.position.set(-7.2, 12, 8)
  key.target.position.set(0.1, 1.2, 0)
  scene.add(key, key.target)
  if (shadows) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const shadow = key.shadow.camera
    shadow.near = 2
    shadow.far = 36
    shadow.left = -10
    shadow.right = 10
    shadow.top = 10
    shadow.bottom = -10
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.03
  }
  const fill = new DirectionalLight('#e7eef4', 0.22)
  fill.position.set(6.2, 4.2, 7)
  scene.add(fill)
}

function createEnvironment(renderer: WebGLRenderer) {
  const envScene = new Scene()
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 direction = normalize(vDir);
        float height = direction.y;
        vec3 ground = vec3(0.55, 0.58, 0.6);
        vec3 horizon = vec3(0.8, 0.83, 0.86);
        vec3 zenith = vec3(0.62, 0.68, 0.74);
        vec3 color = mix(ground, horizon, smoothstep(-0.35, 0.08, height));
        color = mix(color, zenith, smoothstep(0.0, 0.65, height));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  envScene.add(new Mesh(new SphereGeometry(8, 32, 16), material))
  const pmrem = new PMREMGenerator(renderer)
  const texture = pmrem.fromScene(envScene, 0.04).texture
  pmrem.dispose()
  material.dispose()
  return texture
}
