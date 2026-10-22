import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
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
  PCFSoftShadowMap,
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
} from 'three'
import { screens, type ScreenId } from './brand'
import { burstAmount, loadIgloo, makeLabelSlots, type Igloo, type LabelAnchor } from './igloo'
import { clamp, lerp, sectionProgress, smoother } from './math'
import type { Overlay, ProjectedLabel } from './overlay'
import { detectQuality, reducedMotion } from './quality'
import { Ambience } from './sound'
import { createWorld, sampleHeight } from './world'

gsap.registerPlugin(ScrollTrigger)

type Keyframe = { at: number; pos: [number, number, number]; target: [number, number, number] }

declare global {
  interface Window {
    __blendy?: {
      scrollTo: (y: number) => void
      scrollProgress: (progress: number) => void
    }
  }
}

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
  renderer.setClearColor('#c5ced4', 1)
  if (quality.shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
  }

  const scene = new Scene()
  const camera = new PerspectiveCamera(33, 1, 0.08, 180)
  const world = createWorld(scene, quality)
  scene.environment = createEnvironment(renderer)
  scene.environmentIntensity = 0.42
  addLights(scene, quality.shadows)

  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: 0,
  })
  const bloom = new BloomEffect({
    intensity: 0.32,
    luminanceThreshold: 0.9,
    luminanceSmoothing: 0.18,
    mipmapBlur: true,
    radius: 0.62,
  })
  const chromatic = new ChromaticAberrationEffect({
    offset: new Vector2(0.00035, 0.0002),
    radialModulation: true,
    modulationOffset: 0.18,
  })
  const noise = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,
  })
  noise.blendMode.setOpacity(0.16)
  const vignette = new VignetteEffect({ darkness: 0.28, offset: 0.3 })
  const effects = [
    bloom,
    chromatic,
    ...(quality.smaa ? [new SMAAEffect({ preset: SMAAPreset.MEDIUM })] : []),
    noise,
    vignette,
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
  ]
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new EffectPass(camera, ...effects))

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
  })
  lenis.on('scroll', ScrollTrigger.update)
  lenis.stop()
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  overlay.onNavigate((id) => {
    lenis.scrollTo(`#${id}`, { offset: 0 })
  })

  for (const section of screens) {
    ScrollTrigger.create({
      trigger: overlay.sections[section.id],
      start: 'top 68%',
      end: 'bottom 42%',
      onToggle: (self) => {
        if (self.isActive) overlay.setActive(section.id)
      },
    })
  }

  window.__blendy = {
    scrollTo(y) {
      lenis.scrollTo(y, { immediate: true })
    },
    scrollProgress(progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight
      lenis.scrollTo(Math.max(0, max) * clamp(progress, 0, 1), { immediate: true })
    },
  }

  const pos = new Vector3()
  const target = new Vector3()
  const ndc = new Vector3()
  let igloo: Igloo | null = null
  let slots: LabelAnchor[] = []
  let shown = 0
  let targetProgress = 0.04
  let ready = false
  let revealed = false
  let samples = 0
  let accum = 0
  let adapted = false
  let revealedAt = 0
  const started = performance.now()

  const reveal = () => {
    if (revealed) return
    revealed = true
    overlay.hideLoader()
    overlay.setActive('field')
    lenis.resize()
    lenis.start()
    ScrollTrigger.refresh()
    revealedAt = performance.now()
  }

  void loadIgloo(quality, sampleHeight, (value) => {
    targetProgress = Math.max(targetProgress, value)
  })
    .then((loaded) => {
      igloo = loaded
      scene.add(loaded.group)
      const core = new Vector3()
      loaded.copyCore(core)
      world.placeLattice(core.x, sampleHeight(core.x, core.z), core.z)
      slots = makeLabelSlots(loaded.labelCount)
      targetProgress = 1
      ready = true
    })
    .catch((error: unknown) => {
      console.error(error)
      overlay.fail('The field failed to load.')
    })

  gsap.ticker.lagSmoothing(0)
  gsap.ticker.add((time, deltaMs) => {
    const dt = Math.min(0.05, deltaMs / 1000)
    lenis.raf(time * 1000)
    if (document.hidden) return

    shown = lerp(shown, targetProgress, 0.08)
    if (!revealed) overlay.setProgress(shown)
    if (ready && shown > 0.985 && performance.now() - started > 550) reveal()

    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const global = clamp(lenis.scroll / maxScroll, 0, 1)
    const releaseT = sectionProgress(overlay.sections.release)
    const latticeT = sectionProgress(overlay.sections.lattice)
    const anim = burstAmount(releaseT)
    const dissolve = smoothstepRelease(latticeT)

    world.update(time, latticeT)
    world.setReveal(smoothstepRelease(latticeT, 0.05, 0.42))
    igloo?.update(anim, dissolve, latticeT)
    const intro = cameraIntro(revealed, revealedAt, global)
    applyCamera(global, time, anim, pos, target, camera, intro)

    const spike = Math.exp(-((latticeT - 0.16) ** 2) / 0.0035)
    bloom.intensity = 0.28 + anim * 0.62 + spike * 0.25
    chromatic.offset.set(0.00035 + spike * 0.005, 0.00018 + spike * 0.0026)
    overlay.setFlash(spike * 0.42)
    overlay.setUiDim(1 - anim * 0.22)
    overlay.setScrollProgress(global)
    projectLabels(overlay, igloo, slots, camera, ndc, anim, latticeT, intro)
    overlay.setTelemetry(
      igloo ? igloo.readout(anim) : 'HOLD',
      `${camera.position.x.toFixed(2)}   ${camera.position.y.toFixed(2)}   ${camera.position.z.toFixed(2)}`,
    )

    composer.render(dt)
    adaptFrame(dt)
  })

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

function cameraIntro(revealed: boolean, revealedAt: number, global: number) {
  if (!revealed || reducedMotion || global > 0.004) return 1
  return clamp((performance.now() - revealedAt) / 2100, 0, 1)
}

function smoothstepRelease(value: number, edge0 = 0.08, edge1 = 0.4) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function applyCamera(
  global: number,
  time: number,
  anim: number,
  pos: Vector3,
  target: Vector3,
  camera: PerspectiveCamera,
  intro: number,
) {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  const range = (id: ScreenId) => {
    const el = document.getElementById(id)
    const top = el?.offsetTop ?? 0
    const height = el?.offsetHeight ?? window.innerHeight
    return {
      start: top / maxScroll,
      end: Math.max(top / maxScroll + 0.0001, (top + height - window.innerHeight) / maxScroll),
    }
  }
  const field = range('field')
  const release = range('release')
  const lattice = range('lattice')
  const note = range('note')
  const releaseSpan = release.end - release.start
  const latticeSpan = lattice.end - lattice.start

  const keys: Keyframe[] = [
    { at: field.start, pos: [0.25, 2.2, 7.7], target: [0.12, 1.42, 0.08] },
    { at: field.end, pos: [0.4, 1.92, 6.55], target: [0.18, 1.55, 0.06] },
    { at: release.start + releaseSpan * 0.48, pos: [0.85, 2.55, 8.1], target: [0.12, 1.9, 0.02] },
    { at: release.end, pos: [0.1, 2.7, 9.8], target: [0.16, 1.72, 0.02] },
    { at: lattice.start + latticeSpan * 0.42, pos: [2.7, 2.4, 6.5], target: [0.08, 1.42, 0] },
    { at: Math.max(lattice.end, note.start), pos: [-0.35, 2.45, 8.3], target: [0.4, 1.45, 0] },
    { at: 1, pos: [-2.55, 1.95, 8.9], target: [0.75, 1.32, 0] },
  ]

  let cursor = 0
  while (cursor < keys.length - 2 && (keys[cursor + 1]?.at ?? 1) < global) cursor += 1
  const from = keys[cursor] ?? keys[0]
  const to = keys[Math.min(cursor + 1, keys.length - 1)] ?? from
  if (!from || !to) return
  const span = Math.max(0.0001, to.at - from.at)
  const blend = smoother(clamp((global - from.at) / span, 0, 1))
  pos.set(
    lerp(from.pos[0], to.pos[0], blend),
    lerp(from.pos[1], to.pos[1], blend),
    lerp(from.pos[2], to.pos[2], blend),
  )
  target.set(
    lerp(from.target[0], to.target[0], blend),
    lerp(from.target[1], to.target[1], blend),
    lerp(from.target[2], to.target[2], blend),
  )

  if (!reducedMotion && intro < 1) {
    const k = 1 - smoother(intro)
    pos.x += (pos.x - target.x) * 0.36 * k
    pos.y += (pos.y - target.y) * 0.36 * k + 0.4 * k
    pos.z += (pos.z - target.z) * 0.36 * k
  }

  if (!reducedMotion && (anim < 0.012 || anim > 0.992)) {
    pos.x += Math.sin(time * 0.13) * 0.16
    pos.y += Math.sin(time * 0.1 + 0.6) * 0.055
  }

  camera.position.copy(pos)
  camera.lookAt(target)
}

function projectLabels(
  overlay: Overlay,
  igloo: Igloo | null,
  slots: LabelAnchor[],
  camera: PerspectiveCamera,
  ndc: Vector3,
  anim: number,
  latticeT: number,
  intro: number,
) {
  if (!igloo) return
  igloo.fillLabels(slots)
  const width = window.innerWidth
  const height = window.innerHeight
  const scale = Math.min(1, width / 1100)
  const fade =
    (1 - smoothstepRelease(anim, 0.04, 0.48)) *
    (1 - smoothstepRelease(latticeT, 0, 0.16)) *
    smoother(Math.max(intro, 0.001))
  const views: ProjectedLabel[] = slots.map((slot) => {
    ndc.copy(slot.position).project(camera)
    const anchorX = (ndc.x * 0.5 + 0.5) * width
    const anchorY = (-ndc.y * 0.5 + 0.5) * height
    const labelX = clamp(anchorX + slot.offsetX * scale, 18, width - 18)
    const labelY = clamp(anchorY + slot.offsetY * scale, 18, height - 18)
    const behind = ndc.z > 1
    const off =
      anchorX < -180 || anchorX > width + 180 || anchorY < -180 || anchorY > height + 180
    return {
      anchorX,
      anchorY,
      labelX,
      labelY,
      opacity: behind || off ? 0 : fade,
      text: slot.text,
      visible: !behind && !off,
    }
  })
  overlay.updateLabels(views)
}

function addLights(scene: Scene, shadows: boolean) {
  scene.add(new HemisphereLight('#d5dee6', '#6e787e', 0.62))
  const key = new DirectionalLight('#f3f6fa', 0.78)
  key.position.set(-7.5, 11, 8)
  key.target.position.set(0.2, 1.2, 0)
  scene.add(key, key.target)
  if (shadows) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const shadow = key.shadow.camera
    shadow.near = 2
    shadow.far = 32
    shadow.left = -8
    shadow.right = 8
    shadow.top = 8
    shadow.bottom = -8
    key.shadow.bias = -0.00045
    key.shadow.normalBias = 0.025
  }
  const fill = new DirectionalLight('#e6eef6', 0.24)
  fill.position.set(6.5, 4.5, 7)
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
        vec3 ground = vec3(0.52, 0.55, 0.58);
        vec3 horizon = vec3(0.78, 0.81, 0.84);
        vec3 zenith = vec3(0.6, 0.66, 0.72);
        vec3 color = mix(ground, horizon, smoothstep(-0.35, 0.08, height));
        color = mix(color, zenith, smoothstep(0.0, 0.65, height));
        float sun = pow(max(dot(direction, normalize(vec3(-0.35, 0.55, 0.28))), 0.0), 14.0);
        color += vec3(1.0) * sun * 0.4;
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
