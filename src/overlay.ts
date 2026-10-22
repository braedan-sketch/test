import { brand, screens, type ScreenId } from './brand'
import { scramble } from './glitch'

export type ProjectedLabel = {
  anchorX: number
  anchorY: number
  labelX: number
  labelY: number
  opacity: number
  text: string
  visible: boolean
}

export type Overlay = {
  sections: Record<ScreenId, HTMLElement>
  setProgress: (value: number) => void
  fail: (message: string) => void
  hideLoader: () => void
  setActive: (id: ScreenId) => void
  setTelemetry: (course: string, camera: string) => void
  setScrollProgress: (value: number) => void
  updateLabels: (labels: ProjectedLabel[]) => void
  setFlash: (amount: number) => void
  setUiDim: (amount: number) => void
  onNavigate: (handler: (id: string) => void) => void
  onSound: (handler: () => boolean) => void
}

const svgNs = 'http://www.w3.org/2000/svg'

export function mountOverlay(): Overlay {
  const loader = document.querySelector('#loader')
  const loaderName = loader?.querySelector('.loader-name')
  const loaderStatus = loader?.querySelector('.loader-status')
  const loaderBar = loader?.querySelector('.loader-bar span')
  const loaderPct = loader?.querySelector('.loader-pct')
  const ui = document.querySelector('#ui')
  const story = document.querySelector('#story')
  if (
    !(loader instanceof HTMLElement) ||
    !(loaderName instanceof HTMLElement) ||
    !(loaderStatus instanceof HTMLElement) ||
    !(loaderBar instanceof HTMLElement) ||
    !(loaderPct instanceof HTMLElement) ||
    !(ui instanceof HTMLElement) ||
    !(story instanceof HTMLElement)
  ) {
    throw new Error('Missing page shell')
  }

  document.title = brand.name
  document.querySelector('meta[name="description"]')?.setAttribute('content', `${brand.name} — ${brand.description}`)
  loaderName.textContent = brand.name
  loaderStatus.textContent = brand.loader.status

  ui.innerHTML = `
    <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="progress" aria-hidden="true"><span></span></div>
    <header>
      <div class="brand-block">
        <p class="wordmark" data-text="${brand.name}">${brand.name}</p>
        <p class="legal">© ${brand.year} ${brand.legal}<br />${brand.study}</p>
      </div>
      <div class="corner">
        <p class="kicker">${brand.corner.kicker}</p>
        <p>${brand.corner.body}</p>
      </div>
    </header>
    <nav class="rail" aria-label="Sections"></nav>
    <button type="button" class="sound" aria-pressed="false">${brand.soundOff}</button>
    <div class="telemetry" aria-hidden="true">
      <span>// Live</span>
      <strong data-course>HOLD</strong>
      <span data-cam>0.00  0.00  0.00</span>
    </div>
    <svg class="leaders" aria-hidden="true"></svg>
    <div class="tags"></div>
    <div class="flash" aria-hidden="true"></div>
  `

  const rail = ui.querySelector('.rail')
  const progress = ui.querySelector('.progress span')
  const sound = ui.querySelector('.sound')
  const course = ui.querySelector('[data-course]')
  const cam = ui.querySelector('[data-cam]')
  const leaders = ui.querySelector('.leaders')
  const tags = ui.querySelector('.tags')
  const flash = ui.querySelector('.flash')
  if (
    !(rail instanceof HTMLElement) ||
    !(progress instanceof HTMLElement) ||
    !(sound instanceof HTMLButtonElement) ||
    !(course instanceof HTMLElement) ||
    !(cam instanceof HTMLElement) ||
    !(leaders instanceof SVGSVGElement) ||
    !(tags instanceof HTMLElement) ||
    !(flash instanceof HTMLElement)
  ) {
    throw new Error('Missing overlay nodes')
  }

  const sections = {} as Record<ScreenId, HTMLElement>
  for (const section of screens) {
    const el = document.createElement('section')
    el.id = section.id
    el.className = 'stage'
    el.dataset.screen = section.id
    const contact =
      section.id === 'note'
        ? `<a class="contact" href="mailto:${brand.email}">${brand.note.contact}<span>${brand.email}</span></a>`
        : ''
    const hint = section.id === 'field' ? `<p class="hint">${brand.hero.hint}</p>` : ''
    el.innerHTML = `
      <div class="sticky">
        <div class="copy">
          <p class="kicker">${section.kicker}</p>
          <h2 class="title" data-text="${section.title}">${section.title}</h2>
          <p class="body">${section.body}</p>
          ${contact}
          ${hint}
        </div>
      </div>
    `
    story.append(el)
    sections[section.id] = el

    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.screen = section.id
    button.innerHTML = `<span>${section.index}</span><em>${section.label}</em>`
    rail.append(button)
  }

  const tagNodes: HTMLElement[] = []
  const lineNodes: SVGLineElement[] = []
  const dotNodes: SVGCircleElement[] = []
  for (let i = 0; i < brand.hud.length; i += 1) {
    const tag = document.createElement('div')
    tag.className = 'tag'
    tag.textContent = brand.hud[i] ?? ''
    tags.append(tag)
    tagNodes.push(tag)

    const line = document.createElementNS(svgNs, 'line')
    const dot = document.createElementNS(svgNs, 'circle')
    dot.setAttribute('r', '2.2')
    leaders.append(line, dot)
    lineNodes.push(line)
    dotNodes.push(dot)
  }

  let navigate: (id: string) => void = () => {}
  let toggleSound: () => boolean = () => false
  let active: ScreenId | '' = ''

  rail.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    const id = button?.dataset.screen
    if (id) navigate(id)
  })

  sound.addEventListener('click', () => {
    const on = toggleSound()
    sound.textContent = on ? brand.soundOn : brand.soundOff
    sound.setAttribute('aria-pressed', on ? 'true' : 'false')
  })

  return {
    sections,
    setProgress(value) {
      const clamped = Math.max(0, Math.min(1, value))
      loaderBar.style.transform = `scaleX(${clamped})`
      loaderPct.textContent = String(Math.round(clamped * 100)).padStart(2, '0')
    },
    fail(message) {
      loaderStatus.textContent = message
      loader.classList.add('is-failed')
    },
    hideLoader() {
      loader.classList.add('is-done')
      loader.setAttribute('aria-busy', 'false')
      document.body.classList.remove('is-loading')
    },
    setActive(id) {
      if (id === active) return
      active = id
      document.body.dataset.screen = id
      for (const button of rail.querySelectorAll('button')) {
        button.classList.toggle('is-active', button.dataset.screen === id)
      }
      const title = sections[id].querySelector('h2')
      if (title instanceof HTMLElement) scramble(title)
      if (id === 'field') {
        const word = ui.querySelector('.wordmark')
        if (word instanceof HTMLElement) scramble(word)
      }
    },
    setTelemetry(courseText, cameraText) {
      course.textContent = courseText
      cam.textContent = cameraText
    },
    setScrollProgress(value) {
      progress.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`
    },
    updateLabels(labels) {
      for (let i = 0; i < tagNodes.length; i += 1) {
        const label = labels[i]
        const tag = tagNodes[i]
        const line = lineNodes[i]
        const dot = dotNodes[i]
        if (!tag || !line || !dot) continue
        if (!label || !label.visible || label.opacity <= 0.02) {
          tag.style.opacity = '0'
          line.style.opacity = '0'
          dot.style.opacity = '0'
          continue
        }
        tag.textContent = label.text
        tag.style.opacity = label.opacity.toFixed(3)
        tag.style.transform = `translate(${label.labelX}px, ${label.labelY}px) translate(-50%, -50%)`
        line.style.opacity = String(label.opacity * 0.9)
        dot.style.opacity = String(label.opacity)
        line.setAttribute('x1', label.anchorX.toFixed(1))
        line.setAttribute('y1', label.anchorY.toFixed(1))
        line.setAttribute('x2', label.labelX.toFixed(1))
        line.setAttribute('y2', label.labelY.toFixed(1))
        dot.setAttribute('cx', label.anchorX.toFixed(1))
        dot.setAttribute('cy', label.anchorY.toFixed(1))
      }
    },
    setFlash(amount) {
      flash.style.opacity = String(Math.max(0, Math.min(1, amount)))
    },
    setUiDim(amount) {
      ui.style.setProperty('--ui', amount.toFixed(3))
    },
    onNavigate(handler) {
      navigate = handler
    },
    onSound(handler) {
      toggleSound = handler
    },
  }
}
