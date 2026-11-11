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

type Entry = {
  promise: Promise<string>
  url: string | null
  resolve: (url: string) => void
  reject: (error: unknown) => void
  started: boolean
  controller: AbortController | null
}

type Buffer = {
  el: HTMLVideoElement
  chunk: Chunk | null
  gen: number
  landedTime: number | null
  confirmedTime: number | null
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
  const wait = document.querySelector('#wait')
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
    !(wait instanceof HTMLElement) ||
    !(word instanceof HTMLElement) ||
    !(videoA instanceof HTMLVideoElement) ||
    !(videoB instanceof HTMLVideoElement)
  ) {
    throw new Error('Missing scrub shell')
  }

  word.textContent = brand.name
  const requested = new URLSearchParams(window.location.search).get('manifest')
  const manifestFile = requested && /^[A-Za-z0-9._-]+$/.test(requested) ? requested : 'manifest.json'
  const response = await fetch(mediaUrl(manifestFile))
  if (!response.ok) throw new Error('Missing video manifest')
  const manifest = (await response.json()) as Manifest
  const total = manifest.source.total_frames
  const fps = manifest.source.fps

  let tier = chooseTier()
  let chunks = manifest[tier].chunks
  const cache = new Map<string, Entry>()
  const pending: Chunk[] = []
  const retries = new Map<string, number>()
  let inFlight = 0
  let epoch = 0
  let direction = 1
  let onCached: () => void = () => {}

  const readyUrl = (chunk: Chunk) => cache.get(chunk.id)?.url ?? null

  // Two full-file downloads, never aborted. Aborting a 4 s chunk every time a
  // fling crosses a boundary threw the bytes away, so Chromium held one frame
  // until the destination finally finished. Finished chunks stay cached.
  const pumpDownloads = () => {
    while (inFlight < 2 && pending.length > 0) {
      const chunk = pending.shift()
      if (!chunk || !beginDownload(chunk)) continue
    }
  }

  const beginDownload = (chunk: Chunk) => {
    const entry = cache.get(chunk.id)
    if (!entry || entry.url || entry.started) return false
    entry.started = true
    inFlight += 1
    const ticket = epoch
    const controller = new AbortController()
    entry.controller = controller
    fetch(mediaUrl(chunk.file), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(chunk.file)
        return res.blob()
      })
      .then((blob) => {
        if (ticket !== epoch || cache.get(chunk.id) !== entry) return
        const url = URL.createObjectURL(blob)
        entry.url = url
        entry.resolve(url)
        onCached()
      })
      .catch((error: unknown) => {
        if (ticket !== epoch || cache.get(chunk.id) !== entry) return
        cache.delete(chunk.id)
        entry.reject(error)
        const attempt = (retries.get(chunk.id) ?? 0) + 1
        retries.set(chunk.id, attempt)
        if (attempt <= 2) void enqueue(chunk).catch(() => undefined)
      })
      .finally(() => {
        if (ticket !== epoch) return
        inFlight = Math.max(0, inFlight - 1)
        if (cache.get(chunk.id) === entry) entry.controller = null
        pumpDownloads()
      })
    return true
  }

  const enqueue = (chunk: Chunk) => {
    const hit = cache.get(chunk.id)
    if (hit) return hit.promise
    let resolve!: (url: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    void promise.catch(() => undefined)
    cache.set(chunk.id, { promise, url: null, resolve, reject, started: false, controller: null })
    pending.push(chunk)
    pumpDownloads()
    return promise
  }

  const focusQueue = (focus: Chunk) => {
    const origin = Math.max(0, chunks.findIndex((item) => item.id === focus.id))
    const next: Chunk[] = []
    for (let step = 0; step < chunks.length; step += 1) {
      const chunk = chunks[(origin + direction * step + chunks.length * 8) % chunks.length]
      const entry = chunk ? cache.get(chunk.id) : undefined
      if (!chunk || !entry || entry.url || entry.started) continue
      next.push(chunk)
    }
    pending.length = 0
    pending.push(...next)
    pumpDownloads()
  }

  const resetDownloads = () => {
    epoch += 1
    for (const entry of cache.values()) entry.controller?.abort()
    for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url)
    cache.clear()
    pending.length = 0
    retries.clear()
    inFlight = 0
  }

  const loopDist = (a: number, b: number) => {
    const span = Math.abs(a - b) % total
    return Math.min(span, total - span)
  }

  const nearestReady = (frame: number) => {
    let best: number | null = null
    let bestDist = Infinity
    for (const chunk of chunks) {
      if (!readyUrl(chunk)) continue
      const point =
        frame >= chunk.start_frame && frame <= chunk.end_frame
          ? frame
          : loopDist(frame, chunk.start_frame) <= loopDist(frame, chunk.end_frame)
            ? chunk.start_frame
            : chunk.end_frame
      const dist = loopDist(frame, point)
      if (dist < bestDist) {
        bestDist = dist
        best = point
      }
    }
    return best
  }

  const queueTier = (startIndex: number) => {
    for (let step = 0; step < chunks.length; step += 1) {
      const chunk = chunks[(startIndex + step) % chunks.length]
      if (chunk) enqueue(chunk)
    }
    const first = chunks[startIndex]
    if (first) focusQueue(first)
  }
  queueTier(0)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const buffers = [makeBuffer(videoA), makeBuffer(videoB)]
  let front = buffers[0]!
  let back = buffers[1]!
  let targetFrame = 0
  let display = 0
  let loop = total * PX_PER_FRAME
  let serial = 0
  let chasing: number | null = null
  let flinging = false
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
    // A hard fling retargets every few frames. Replacing the hidden seek each
    // time means it never presents, so the picture holds. Let it land unless a
    // much closer cached frame is ready.
    if (flinging && back.running && chasing != null) {
      const here = modFrame(display, total)
      if (loopDist(frame, here) + 48 >= loopDist(chasing, here)) return
    }
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
          if (readyUrl(job.chunk)) retryAt = performance.now() + 80
          continue
        }
        const landed = job.chunk.start_frame + Math.round((buf.landedTime ?? job.time) * fps)
        const want = modFrame(display, total)
        if (buf.want) continue
        const exact = job.chunk.id === chunkAt(want).id && loopDist(landed, want) <= 3
        const near = nearestReady(want)
        const targetReady = readyUrl(chunkAt(want))
        const standIn = near != null && !targetReady && loopDist(landed, near) <= 1
        const shown = shownFrame()
        const improves = shown == null || (near != null && loopDist(near, want) + 1 < loopDist(shown, want))
        if (exact && !showing(want)) reveal(buf)
        else if (standIn && improves) reveal(buf)
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
    const exact = chunkAt(scrollFrame)
    wait.classList.toggle('is-on', poster.classList.contains('is-hidden') && !readyUrl(exact))
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

  const showNearest = (frame: number) => {
    const near = nearestReady(frame)
    if (near == null) return
    const shown = shownFrame()
    if (shown != null && loopDist(shown, frame) <= loopDist(near, frame) + 1) return
    chase(near)
  }

  onCached = () => {
    const frame = modFrame(display, total)
    const chunk = chunkAt(frame)
    if (readyUrl(chunk)) chase(frame)
    else showNearest(frame)
  }

  let prevAim = 0
  let prevAimAt = performance.now()
  let settleTimer = 0
  let lastChaseAt = 0
  const aim = (frame: number, now: number) => {
    const dt = Math.max(0.016, (now - prevAimAt) / 1000)
    const speed = loopDist(frame, prevAim) / dt
    let delta = frame - prevAim
    if (delta > total / 2) delta -= total
    if (delta < -total / 2) delta += total
    if (Math.abs(delta) > 2) direction = delta > 0 ? 1 : -1
    prevAim = frame
    prevAimAt = now
    const chunk = chunkAt(frame)
    focusQueue(chunk)
    const go = () => {
      if (readyUrl(chunk)) chase(frame)
      else showNearest(frame)
    }
    flinging = speed > 120
    if (speed > 120) {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const settled = modFrame(display, total)
        const next = chunkAt(settled)
        void enqueue(next).catch(() => undefined)
        if (readyUrl(next)) chase(settled)
        else showNearest(settled)
      }, 160)
      if (now - lastChaseAt < 90) return
      lastChaseAt = now
      go()
      return
    }
    window.clearTimeout(settleTimer)
    void enqueue(chunk).catch(() => undefined)
    go()
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
    aim(frame, now)
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
    }
    resetDownloads()
    queueTier(0)
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
    ready: () => chunks.filter((chunk) => readyUrl(chunk)).map((chunk) => chunk.id),
    waiting: () => wait.classList.contains('is-on'),
    mode: () => 'blob' as const,
    scrollToFrame,
  }

  chase(0)
  paint(0)
  requestAnimationFrame(tick)

  async function land(buf: Buffer, job: Job, gen: number) {
    const stale = () => gen !== buf.gen || (buf.want != null && buf.want.token !== job.token) || job.token !== serial
    const url = readyUrl(job.chunk)
    if (!url) {
      void enqueue(job.chunk).catch(() => undefined)
      return false
    }
    if (stale()) return false
    const ready = await attachBlob(buf, job.chunk, url, gen)
    if (!ready || stale()) return false
    if (job.time > 1 / fps && buf.el.seekable.length === 0) {
      const opened = await waitSeekable(buf.el, 1200)
      if (!opened || stale()) return false
    }
    const duration = buf.el.duration
    const safe =
      Number.isFinite(duration) && duration > 0.05
        ? Math.min(Math.max(job.time, 0), Math.max(0, duration - 0.5 / fps))
        : job.time
    const presented = await seekPresented(buf, safe, gen, fps)
    if (stale() || !presented) return false
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
  return { el, chunk: null, gen: 0, landedTime: null, confirmedTime: null, want: null, running: false }
}

function sameSource(el: HTMLVideoElement, url: string) {
  if (el.readyState < 2 || el.error || !el.currentSrc) return false
  if (el.currentSrc === url) return true
  try {
    return el.currentSrc === new URL(url, window.location.href).href
  } catch {
    return false
  }
}

function attachBlob(buf: Buffer, chunk: Chunk, url: string, gen: number) {
  if (buf.chunk?.id === chunk.id && sameSource(buf.el, url)) return Promise.resolve(gen === buf.gen)
  buf.landedTime = null
  buf.confirmedTime = null
  buf.chunk = null
  buf.el.pause()
  // Setting src starts the load. Calling load() immediately after a blob URL
  // makes WebKit cancel it. A network URL still needs load() so Safari
  // replaces the previous resource.
  buf.el.src = url
  if (!url.startsWith('blob:')) buf.el.load()
  return once(buf.el, url, 12000).then((ok) => {
    if (!ok || gen !== buf.gen) return false
    buf.chunk = chunk
    return true
  })
}

function waitSeekable(el: HTMLVideoElement, ms: number) {
  if (el.seekable.length > 0) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let timer = 0
    const finish = () => {
      window.clearTimeout(timer)
      el.removeEventListener('progress', finish)
      el.removeEventListener('loadedmetadata', finish)
      resolve(el.seekable.length > 0)
    }
    timer = window.setTimeout(finish, ms)
    el.addEventListener('progress', finish)
    el.addEventListener('loadedmetadata', finish)
  })
}

function seekPresented(buf: Buffer, safe: number, gen: number, fps: number) {
  const el = buf.el
  const tol = 1.25 / fps
  if (gen !== buf.gen) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let settled = false
    let samples = 0
    let matched = false
    let handle = 0
    let watch = 0
    let hard = 0
    const timeOk = () => Math.abs(el.currentTime - safe) <= tol
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      el.removeEventListener('seeked', onSeeked)
      window.clearTimeout(watch)
      window.clearTimeout(hard)
      if (gen !== buf.gen) {
        resolve(false)
        return
      }
      if (handle && el.cancelVideoFrameCallback) el.cancelVideoFrameCallback(handle)
      const accepted = ok && timeOk()
      if (accepted) buf.confirmedTime = el.currentTime
      el.pause()
      resolve(accepted)
    }
    const rvfc = el.requestVideoFrameCallback?.bind(el)
    const onFrame = (_now: number, meta: { mediaTime?: number }) => {
      if (settled || gen !== buf.gen) return
      samples += 1
      const media = typeof meta.mediaTime === 'number' ? meta.mediaTime : el.currentTime
      // mediaTime can update before currentTime. Remember the match and reveal
      // once seeked has caught up, so a single callback is not thrown away.
      if (Math.abs(media - safe) <= tol) {
        matched = true
        if (timeOk()) finish(true)
        return
      }
      if (rvfc) handle = rvfc(onFrame)
    }
    const arm = () => {
      if (rvfc) handle = rvfc(onFrame)
    }
    const decide = () => {
      if (settled) return
      if (matched && timeOk()) {
        finish(true)
        return
      }
      if (!timeOk()) {
        finish(false)
        return
      }
      // A callback that names a different time is the frame still on screen.
      // Keep the last good frame and retry the same blob. Silence after
      // currentTime has landed is a slow 1080p decode, not a reason to open
      // the file over the network.
      if (samples > 0 && !matched) finish(false)
      else finish(true)
    }
    const onSeeked = () => {
      if (gen !== buf.gen) {
        finish(false)
        return
      }
      if (!timeOk()) {
        finish(false)
        return
      }
      if (matched) {
        finish(true)
        return
      }
      watch = window.setTimeout(decide, 450)
    }
    hard = window.setTimeout(() => finish(false), 4000)
    const already = el.readyState >= 2 && Math.abs(el.currentTime - safe) <= 0.45 / fps
    // Register before the seek. Safari drops the frame callback when it is
    // attached only after `seeked`, and a paused blob then never paints again.
    arm()
    if (already) {
      watch = window.setTimeout(decide, 280)
      return
    }
    el.addEventListener('seeked', onSeeked)
    try {
      el.currentTime = safe
    } catch {
      finish(false)
    }
  })
}

function once(el: HTMLVideoElement, url: string, ms: number) {
  if (sameSource(el, url)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      el.removeEventListener('loadeddata', onHit)
      el.removeEventListener('error', onErr)
      window.clearInterval(poll)
      window.clearTimeout(timer)
      resolve(ok && sameSource(el, url))
    }
    const onHit = () => {
      if (sameSource(el, url)) finish(true)
    }
    const onErr = () => {
      if (el.currentSrc === url || el.src === url) finish(false)
    }
    const poll = window.setInterval(() => {
      if (sameSource(el, url)) finish(true)
    }, 40)
    const timer = window.setTimeout(() => finish(false), ms)
    el.addEventListener('loadeddata', onHit)
    el.addEventListener('error', onErr)
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
      ready: () => string[]
      waiting: () => boolean
      mode: () => 'blob' | 'direct'
      scrollToFrame: (frame: number) => void
    }
  }
}
