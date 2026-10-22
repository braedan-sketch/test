const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#+'
const timers = new WeakMap<HTMLElement, number>()

export function scramble(el: HTMLElement) {
  const finalText = el.dataset.text ?? el.textContent ?? ''
  el.dataset.text = finalText
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const previous = timers.get(el)
  if (previous) window.clearInterval(previous)

  if (reduce) {
    el.textContent = finalText
    el.classList.remove('is-glitching')
    return
  }

  el.classList.add('is-glitching')
  let frame = 0
  const settleAt = 7
  const total = settleAt + finalText.length
  const id = window.setInterval(() => {
    el.textContent = Array.from(finalText)
      .map((ch, index) => {
        if (ch === ' ' || ch === '.' || ch === ',') return ch
        if (frame > settleAt + index) return ch
        return glyphs[(Math.random() * glyphs.length) | 0]
      })
      .join('')
    frame += 1
    if (frame > total + 1) {
      el.textContent = finalText
      el.classList.remove('is-glitching')
      window.clearInterval(id)
      timers.delete(el)
    }
  }, 30)
  timers.set(el, id)
}
