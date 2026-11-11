const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const generation = new WeakMap<HTMLElement, number>()
const timers = new WeakMap<HTMLElement, number>()

function clearTimer(el: HTMLElement) {
  const pending = timers.get(el)
  if (pending) window.clearTimeout(pending)
  timers.delete(el)
}

function paint(el: HTMLElement, finalText: string, reveal: number) {
  let out = ''
  for (let i = 0; i < finalText.length; i += 1) {
    const ch = finalText[i] ?? ''
    if (!/[A-Za-z0-9]/.test(ch) || i < reveal) out += ch
    else out += glyphs[(Math.random() * glyphs.length) | 0]
  }
  el.textContent = out
}

/** Resolve to the string in `data-text` within about 0.6s. A second call while running does not restart it. */
export function scramble(el: HTMLElement) {
  const incoming = el.dataset.text && el.dataset.text.length > 0 ? el.dataset.text : el.textContent ?? ''
  if (!incoming) return
  if (!el.classList.contains('is-glitching')) el.dataset.text = incoming
  else if (!el.dataset.text) el.dataset.text = incoming

  if (el.classList.contains('is-glitching')) {
    if (performance.now() < Number(el.dataset.until || 0)) return
    el.textContent = el.dataset.text || incoming
    el.classList.remove('is-glitching')
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  clearTimer(el)
  const gen = (generation.get(el) ?? 0) + 1
  generation.set(el, gen)

  const finish = () => {
    if (generation.get(el) !== gen) return
    generation.set(el, gen + 1)
    el.textContent = el.dataset.text || incoming
    el.classList.remove('is-glitching')
    clearTimer(el)
  }

  if (reduce) {
    finish()
    return
  }

  el.classList.add('is-glitching')
  el.dataset.until = String(performance.now() + 700)
  const duration = 560
  const start = performance.now()
  const tick = () => {
    if (generation.get(el) !== gen) return
    const finalText = el.dataset.text || incoming
    const t = (performance.now() - start) / duration
    if (t >= 1) {
      finish()
      return
    }
    paint(el, finalText, Math.floor(t * (finalText.length + 1)))
    timers.set(el, window.setTimeout(tick, 32))
  }
  tick()
  window.setTimeout(finish, 760)
}
