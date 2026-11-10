import Lenis from 'lenis'
import { brand } from './brand'

type Chunk = {
  file: string
  id: string
  scene: string
  start_frame: number
  end_frame: number
  frame_count: number
}

type Tier = 'desktop' | 'mobile'

type Manifest = {
  source: { total_frames: number; fps: number }
  desktop: { chunks: Chunk[] }
  mobile: { chunks: Chunk[] }
  scenes: Array<{ id: string; name: string; start_frame: number; end_frame: number }>
}

type Job = { chunk: Chunk; time: number; serial: number; onReady: () => void }

type Player = {
  el: HTMLVideoElement
  chunkId: string | null
  busy: boolean
  want: Job | null
  serial: number
}

const PX_PER_FRAME = 12

const beats = [
  { start: 0, end: 144, kicker: '01  Field', title: brand.hero.title, body: 'A shelter is a pause in the weather.' },
  { start: 262, end: 402, kicker: '03  Mass', title: 'First stone.', body: 'A faceted rock rising through the haze.' },
  { start: 403, end: 543, kicker: '03  Mass', title: 'Second stone.', body: 'Another course, still loose.' },
  { start: 1100, end: 1157, kicker: '04  Core', title: 'The core.', body: 'The last ring settles on the disc.' },
  { start: 1307, end: 1447, kicker: '05  Witness', title: brand.figure.title, body: 'A figure held in points, low against the halo.' },
  { start: 1918, end: 2013, kicker: '01  Field', title: brand.hero.title, body: 'A shelter is a pause in the weather.' },
]

function mediaUrl(file: string) {
  const base = import.meta.env.BASE_URL || './'
  return `${base}video/${file.replace(/^\//, '')}`
}

export function chooseTier(): Tier {
  const narrow = window.matchMedia('(max-width: 900px)').matches
  const lowDpr = window.devicePixelRatio <= 1.25 && window.innerWidth < 1280
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  const slow =
    !!connection &&
    (connection.saveData === true ||
      connection.effectiveType === 'slow-2g' ||
      connection.effectiveType === '2g' ||
      connection.effectiveType === '3g')
  return narrow || lowDpr || slow ? 'mobile' : 'desktop'
}

function modFrame(value: number, total: number) {
  return ((Math.round(value) % total) + total) % total
}

export async function startScrub() {
  const poster = document.querySelector('#poster')
  const stage = document.querySelector('#stage')
  const track = document.querySelector('#track')
  const readout = document.querySelector('#readout')
  const copy = document.querySelector('#copy')
  const kicker = copy?.querySelector('.kicker')
  const title = copy?.querySelector('h1')
  const body = copy?.querySelector('.body')
  const hint = document.querySelector('#hint')
  const bar = document.querySelector('#bar span')
  const loader = document.querySelector('#loader')
  const word = document.querySelector('.wordmark')
  const videoA = document.querySelector('#vid-a')
  const videoB = document.querySelector('#vid-b')
  if (
    !(poster instanceof HTMLImageElement) ||
    !(stage instanceof HTMLElement) ||
    !(track instanceof HTMLElement) ||
    !(readout instanceof HTMLElement) ||
    !(copy instanceof HTMLElement) ||
    !(kicker instanceof HTMLElement) ||
    !(title instanceof HTMLElement) ||
    !(body instanceof HTMLElement) ||
    !(hint instanceof HTMLElement) ||
    !(bar instanceof HTMLElement) ||
    !(loader instanceof HTMLElement) ||
    !(word instanceof HTMLElement) ||
    !(videoA instanceof HTMLVideoElement) ||
    !(videoB instanceof HTMLVideoElement)
  ) {
    throw new Error('Missing scrub shell')
  }

  word.textContent = brand.name
  const response = await fetch(mediaUrl('manifest.json'))
  if (!response.ok) throw new Error('Missing video manifest')
  const manifest = (await response.json()) as Manifest
  const total = manifest.source.total_frames
  const fps = manifest.source.fps

  let tier = chooseTier()
  let chunks = manifest[tier].chunks
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const players = [makePlayer(videoA), makePlayer(videoB)]
  let shown: Player | null = null
  let targetFrame = 0
  let display = 0
  let loop = total * PX_PER_FRAME

  const lenis = new Lenis({
    lerp: reduced ? 1 : 0.075,
    smoothWheel: !reduced,
    syncTouch: true,
    infinite: true,
    autoRaf: false,
  })

  const layout = () => {
    loop = total * PX_PER_FRAME
    track.style.height = `${loop + window.innerHeight}px`
    lenis.resize()
  }
  layout()

  const chunkAt = (frame: number) => chunks.find((chunk) => frame >= chunk.start_frame && frame <= chunk.end_frame) ?? chunks[0]!

  const neighbor = (chunk: Chunk) => {
    const index = chunks.findIndex((item) => item.id === chunk.id)
    const step = lenis.direction < 0 ? -1 : 1
    return chunks[(index + step + chunks.length) % chunks.length] ?? chunk
  }

  const prime = () => {
    for (const player of players) {
      player.el.muted = true
      const pending = player.el.play()
      if (pending) pending.then(() => player.el.pause()).catch(() => undefined)
    }
  }
  window.addEventListener('pointerdown', prime, { once: true })
  window.addEventListener('wheel', prime, { passive: true, once: true })
  window.addEventListener('touchstart', prime, { passive: true, once: true })
  window.addEventListener('keydown', prime, { once: true })

  const reveal = (player: Player) => {
    const previous = shown?.chunkId ?? ''
    const next = player.chunkId ?? ''
    const loopJoin =
      shown !== null &&
      shown !== player &&
      ((previous.endsWith('s06') && next.endsWith('s01')) || (previous.endsWith('s01') && next.endsWith('s06')))
    stage.classList.toggle('no-fade', loopJoin || shown === null)
    if (shown !== player) {
      player.el.classList.add('is-live')
      shown?.el.classList.remove('is-live')
      shown = player
    }
    poster.classList.add('is-hidden')
    loader.classList.add('is-done')
  }

  let painted = -1
  const present = (frame: number) => {
    const chunk = chunkAt(frame)
    if (frame === painted) return
    painted = frame
    const time = (frame - chunk.start_frame) / fps
    const visible = players.find((player) => player.chunkId === chunk.id) ?? players.find((player) => player !== shown) ?? players[0]!
    requestSeek(visible, chunk, time, () => {
      if (chunkAt(modFrame(display, total)).id === chunk.id) reveal(visible)
    })
    const other = players.find((player) => player !== visible)
    if (!other) return
    const ahead = neighbor(chunk)
    if (other.chunkId === ahead.id) return
    const edge = lenis.direction < 0 ? (ahead.frame_count - 1) / fps : 0
    requestSeek(other, ahead, edge, () => undefined)
  }

  const paint = (frame: number) => {
    const scene = manifest.scenes.find((item) => frame >= item.start_frame && frame <= item.end_frame)
    readout.textContent = `${scene?.id ?? 's01'}  ${String(frame).padStart(4, '0')}  /  ${total}`
    bar.style.width = `${(frame / Math.max(1, total - 1)) * 100}%`
    let best = 0
    let beat = beats[0]
    for (const item of beats) {
      const fade = 14
      if (frame < item.start || frame > item.end) continue
      const opacity = Math.min((frame - item.start) / fade, (item.end - frame) / fade, 1)
      if (opacity >= best) {
        best = opacity
        beat = item
      }
    }
    copy.classList.toggle('is-on', best > 0.04)
    copy.style.opacity = best.toFixed(3)
    if (beat && best > 0) {
      kicker.textContent = beat.kicker
      title.textContent = beat.title
      body.textContent = beat.body
    }
    hint.classList.toggle('is-gone', frame > 48)
  }

  let last = performance.now()
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis.raf(now)
    const progress = lenis.progress
    targetFrame = Math.round(progress * total) % total
    const tau = reduced ? 0.02 : 0.09
    const gain = 1 - Math.exp(-dt / tau)
    let from = display
    const delta = targetFrame - from
    if (delta > total / 2) from += total
    else if (delta < -total / 2) from -= total
    display = from + (targetFrame - from) * gain
    const frame = modFrame(display, total)
    present(frame)
    paint(frame)
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', () => {
    layout()
    const next = chooseTier()
    if (next === tier) return
    tier = next
    chunks = manifest[tier].chunks
    for (const player of players) player.chunkId = null
  })

  const scrollToFrame = (frame: number) => {
    const clamped = ((frame % total) + total) % total
    lenis.scrollTo((clamped / total) * loop, { immediate: true, force: true })
    targetFrame = clamped
    display = clamped
  }

  window.__scrub = {
    frame: () => modFrame(display, total),
    target: () => targetFrame,
    tier: () => tier,
    chunk: () => shown?.chunkId ?? null,
    src: () => shown?.el.currentSrc ?? '',
    scrollToFrame,
  }

  present(0)
  paint(0)
  requestAnimationFrame(tick)
}

function makePlayer(el: HTMLVideoElement): Player {
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.disablePictureInPicture = true
  return { el, chunkId: null, busy: false, want: null, serial: 0 }
}

function requestSeek(player: Player, chunk: Chunk, time: number, onReady: () => void) {
  const job: Job = { chunk, time, serial: ++player.serial, onReady }
  player.want = job
  if (player.chunkId !== chunk.id) {
    player.chunkId = chunk.id
    player.el.pause()
    player.el.src = mediaUrl(chunk.file)
    player.el.load()
  }
  void pump(player)
}

async function pump(player: Player) {
  if (player.busy) return
  player.busy = true
  try {
    while (player.want) {
      const job = player.want
      player.want = null
      const ok = await perform(player, job)
      if (ok && job.serial === player.serial) job.onReady()
    }
  } finally {
    player.busy = false
    if (player.want) void pump(player)
  }
}

function perform(player: Player, job: Job) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const go = () => {
      if (player.chunkId !== job.chunk.id) return finish(false)
      const duration = player.el.duration
      const limit = Number.isFinite(duration) ? Math.max(0, duration - 1 / 24) : job.time
      const safe = Math.min(Math.max(job.time, 0), limit)
      if (player.el.readyState >= 2 && Math.abs(player.el.currentTime - safe) < 0.45 / 24) return finish(true)
      const timer = window.setTimeout(() => finish(true), 200)
      player.el.addEventListener(
        'seeked',
        () => {
          window.clearTimeout(timer)
          const presented = player.el.requestVideoFrameCallback?.bind(player.el)
          if (presented) {
            const late = window.setTimeout(() => finish(true), 48)
            presented(() => {
              window.clearTimeout(late)
              finish(true)
            })
          } else finish(true)
        },
        { once: true },
      )
      try {
        player.el.currentTime = safe
      } catch {
        window.clearTimeout(timer)
        finish(false)
      }
    }
    if (player.el.readyState >= 1 && player.chunkId === job.chunk.id) go()
    else player.el.addEventListener('loadeddata', () => go(), { once: true })
  })
}

declare global {
  interface Window {
    __scrub?: {
      frame: () => number
      target: () => number
      tier: () => Tier
      chunk: () => string | null
      src: () => string
      scrollToFrame: (frame: number) => void
    }
  }
}
