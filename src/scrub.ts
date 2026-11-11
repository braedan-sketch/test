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

type Job = { frame: number; chunk: Chunk; time: number; token: number }

type Buffer = {
  el: HTMLVideoElement
  chunk: Chunk | null
  gen: number
  landedTime: number | null
  want: Job | null
  running: boolean
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

  const buffers = [makeBuffer(videoA), makeBuffer(videoB)]
  let front = buffers[0]!
  let back = buffers[1]!
  let targetFrame = 0
  let display = 0
  let loop = total * PX_PER_FRAME
  let serial = 0
  let chasing: number | null = null
  let retryAt = 0
  let progressHold = 0
  let progressSpike: { progress: number; at: number } | null = null

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

  const prime = () => {
    const hidden = back.el
    hidden.muted = true
    const pending = hidden.play()
    if (pending) pending.then(() => hidden.pause()).catch(() => undefined)
  }
  window.addEventListener('pointerdown', prime, { once: true })
  window.addEventListener('wheel', prime, { passive: true, once: true })
  window.addEventListener('touchstart', prime, { passive: true, once: true })
  window.addEventListener('keydown', prime, { once: true })

  const shownFrame = () => {
    if (!front.chunk || front.landedTime == null || !front.el.classList.contains('is-live')) return null
    return front.chunk.start_frame + Math.round(front.landedTime * fps)
  }

  const showing = (frame: number) => {
    const got = shownFrame()
    if (got == null || !front.chunk) return false
    if (front.chunk.id !== chunkAt(frame).id) return false
    return Math.abs(got - frame) <= 1
  }

  const reveal = (buf: Buffer) => {
    if (buf === front && buf.el.classList.contains('is-live')) return
    buf.el.classList.add('is-live')
    const other = buf === buffers[0] ? buffers[1]! : buffers[0]!
    other.el.classList.remove('is-live')
    other.el.pause()
    front = buf
    back = other
    poster.classList.add('is-hidden')
    loader.classList.add('is-done')
  }

  // Seek only the hidden element. Safari paints the first decoded frame of a file
  // while a seek is in flight, so seeking the visible video (or crossfading in
  // the preloaded neighbour) flashes another scene. Swap after the presented
  // time matches, and otherwise keep the last correct frame.
  const chase = (frame: number) => {
    if (performance.now() < retryAt) return
    if (showing(frame)) {
      chasing = null
      return
    }
    if (chasing != null && Math.abs(frame - chasing) <= 2 && chunkAt(frame).id === chunkAt(chasing).id) return
    chasing = frame
    const chunk = chunkAt(frame)
    const time = (frame - chunk.start_frame) / fps
    back.want = { frame, chunk, time, token: ++serial }
    void runBuffer(back)
  }

  async function runBuffer(buf: Buffer) {
    if (buf.running) return
    buf.running = true
    try {
      while (buf.want && buf === back) {
        const job = buf.want
        buf.want = null
        const gen = ++buf.gen
        const ok = await land(buf, job, gen)
        if (gen !== buf.gen || job.token !== serial) continue
        if (!ok) {
          chasing = null
          retryAt = performance.now() + 40
          continue
        }
        const landed = job.chunk.start_frame + Math.round((buf.landedTime ?? job.time) * fps)
        const want = modFrame(display, total)
        const span = Math.abs(landed - want) % total
        const nearWant = job.chunk.id === chunkAt(want).id && Math.min(span, total - span) <= 3
        if (buf.want) continue
        if (!nearWant || showing(want)) {
          chasing = null
          continue
        }
        reveal(buf)
        chasing = null
      }
    } finally {
      buf.running = false
      if (buf.want && buf === back) void runBuffer(buf)
    }
  }

  const paint = (scrollFrame: number) => {
    const pictured = shownFrame()
    const frame = pictured ?? scrollFrame
    const scene = manifest.scenes.find((item) => frame >= item.start_frame && frame <= item.end_frame)
    readout.textContent = `${scene?.id ?? ''}  ${String(frame).padStart(4, '0')}  /  ${total}`
    bar.style.width = `${(scrollFrame / Math.max(1, total - 1)) * 100}%`
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
    hint.classList.toggle('is-gone', scrollFrame > 48)
  }

  const readProgress = (now: number) => {
    const progress = lenis.progress
    if (!Number.isFinite(progress)) return progressHold
    const jump = progress - progressHold
    const wrap = (progressHold > 0.92 && progress < 0.08) || (progressHold < 0.08 && progress > 0.92)
    if (!wrap && Math.abs(jump) > 0.35) {
      if (!progressSpike || Math.abs(progress - progressSpike.progress) > 0.02) progressSpike = { progress, at: now }
      else if (now - progressSpike.at > 80) {
        progressHold = progress
        progressSpike = null
      }
      return progressHold
    }
    progressSpike = null
    progressHold = progress
    return progress
  }

  let last = performance.now()
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    lenis.raf(now)
    if (!front.el.paused) front.el.pause()
    const progress = readProgress(now)
    targetFrame = Math.round(progress * total) % total
    const tau = reduced ? 0.02 : 0.09
    const gain = 1 - Math.exp(-dt / tau)
    let from = display
    const delta = targetFrame - from
    if (delta > total / 2) from += total
    else if (delta < -total / 2) from -= total
    display = from + (targetFrame - from) * gain
    const frame = modFrame(display, total)
    chase(frame)
    paint(frame)
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', () => {
    layout()
    const next = chooseTier()
    if (next === tier) return
    tier = next
    chunks = manifest[tier].chunks
    for (const buf of buffers) {
      buf.chunk = null
      buf.landedTime = null
      buf.want = null
      buf.gen += 1
      buf.el.classList.remove('is-live')
      buf.el.removeAttribute('src')
      buf.el.load()
    }
    front = buffers[0]!
    back = buffers[1]!
    chasing = null
    poster.classList.remove('is-hidden')
  })

  const scrollToFrame = (frame: number) => {
    const clamped = ((frame % total) + total) % total
    progressHold = clamped / total
    progressSpike = null
    lenis.scrollTo((clamped / total) * loop, { immediate: true, force: true })
    targetFrame = clamped
    display = clamped
  }

  window.__scrub = {
    frame: () => modFrame(display, total),
    shown: () => shownFrame(),
    target: () => targetFrame,
    tier: () => tier,
    chunk: () => (front.el.classList.contains('is-live') ? (front.chunk?.id ?? null) : null),
    src: () => (front.el.classList.contains('is-live') ? front.el.currentSrc : ''),
    time: () => (front.el.classList.contains('is-live') ? front.el.currentTime : null),
    scrollToFrame,
  }

  chase(0)
  paint(0)
  requestAnimationFrame(tick)

  async function land(buf: Buffer, job: Job, gen: number) {
    const stale = () => gen !== buf.gen || (buf.want != null && buf.want.token !== job.token)
    const ready = await ensureSource(buf, job.chunk, gen)
    if (!ready || stale()) return false
    const duration = buf.el.duration
    const limit = Number.isFinite(duration) ? Math.max(0, duration - 0.5 / fps) : job.time
    const safe = Math.min(Math.max(job.time, 0), limit)
    const sought = await seekTo(buf, safe, gen, fps)
    if (!sought || stale()) return false
    if (Math.abs(buf.el.currentTime - safe) > 1.25 / fps) return false
    const presented = await presentedAt(buf.el, safe, fps)
    if (!presented || stale()) return false
    buf.landedTime = buf.el.currentTime
    buf.el.pause()
    return true
  }
}

function makeBuffer(el: HTMLVideoElement): Buffer {
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.disablePictureInPicture = true
  return { el, chunk: null, gen: 0, landedTime: null, want: null, running: false }
}

function ensureSource(buf: Buffer, chunk: Chunk, gen: number) {
  const file = chunk.file.split('/').pop() ?? chunk.file
  if (buf.chunk?.id === chunk.id && buf.el.readyState >= 1 && buf.el.currentSrc.endsWith(file)) {
    return Promise.resolve(gen === buf.gen)
  }
  buf.landedTime = null
  buf.chunk = null
  buf.el.pause()
  buf.el.src = mediaUrl(chunk.file)
  buf.el.load()
  return once(buf.el, 'loadeddata', 20000).then((ok) => {
    if (!ok || gen !== buf.gen || !buf.el.currentSrc.endsWith(file)) return false
    buf.chunk = chunk
    return true
  })
}

function seekTo(buf: Buffer, safe: number, gen: number, fps: number) {
  if (gen !== buf.gen) return Promise.resolve(false)
  if (buf.el.readyState >= 2 && Math.abs(buf.el.currentTime - safe) <= 0.45 / fps) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      buf.el.removeEventListener('seeked', onSeeked)
      window.clearTimeout(timer)
      resolve(ok && gen === buf.gen && Math.abs(buf.el.currentTime - safe) <= 1.25 / fps)
    }
    const onSeeked = () => finish(true)
    const timer = window.setTimeout(() => finish(false), 1500)
    buf.el.addEventListener('seeked', onSeeked)
    try {
      buf.el.currentTime = safe
    } catch {
      finish(false)
    }
  })
}

function presentedAt(el: HTMLVideoElement, safe: number, fps: number) {
  const rvfc = el.requestVideoFrameCallback?.bind(el)
  if (!rvfc) return Promise.resolve(Math.abs(el.currentTime - safe) <= 1.25 / fps)
  return new Promise<boolean>((resolve) => {
    let tries = 0
    let settled = false
    let saw = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(ok)
    }
    const timer = window.setTimeout(() => {
      if (!saw) finish(Math.abs(el.currentTime - safe) <= 1.25 / fps)
    }, 500)
    const arm = () => {
      rvfc((_now, meta) => {
        if (settled) return
        saw = true
        const media = typeof meta.mediaTime === 'number' ? meta.mediaTime : el.currentTime
        if (Math.abs(media - safe) <= 1.25 / fps) finish(true)
        else if (++tries < 6) arm()
        else finish(false)
      })
    }
    arm()
  })
}

function once(el: HTMLVideoElement, name: 'loadeddata', ms: number) {
  if (el.readyState >= 2) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      el.removeEventListener(name, onHit)
      window.clearTimeout(timer)
      resolve(ok)
    }
    const onHit = () => finish(true)
    const timer = window.setTimeout(() => finish(false), ms)
    el.addEventListener(name, onHit)
  })
}

declare global {
  interface Window {
    __scrub?: {
      frame: () => number
      shown: () => number | null
      target: () => number
      tier: () => Tier
      chunk: () => string | null
      src: () => string
      time: () => number | null
      scrollToFrame: (frame: number) => void
    }
  }
}
