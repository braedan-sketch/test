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
  bent: boolean
  constellation?: boolean
}

export type Overlay = {
  sections: Record<ScreenId, HTMLElement>
  setProgress: (value: number) => void
  fail: (message: string) => void
  hideLoader: () => void
  revealChrome: () => void
  scrambleCorner: () => void
  setActive: (id: ScreenId) => void
  setTelemetry: (course: string, camera: string) => void
  setScrollProgress: (value: number) => void
  updateLabels: (labels: ProjectedLabel[]) => void
  setCycle: (kicker: string, value: string, opacity: number) => void
  setFlash: (amount: number) => void
  setUiDim: (amount: number) => void
  onNavigate: (handler: (id: string) => void) => void
  onSound: (handler: () => boolean) => void
}

const svgNs = 'http://www.w3.org/2000/svg'
const labelSlots = Math.max(brand.hud.length, brand.meteorHud.length)

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
        <p class="legal" data-text="© ${brand.year} ${brand.legal} ${brand.study}">© ${brand.year} ${brand.legal}<br />${brand.study}</p>
      </div>
      <div class="corner">
        <p class="kicker" data-text="${brand.corner.kicker}">${brand.corner.kicker}</p>
        <p class="corner-body" data-text="${brand.corner.body}">${brand.corner.body}</p>
      </div>
    </header>
    <nav class="rail" aria-label="Sections"></nav>
    <button type="button" class="sound" data-text="${brand.soundOff}" aria-pressed="false">${brand.soundOff}</button>
    <div class="telemetry" aria-hidden="true">
      <span>// Live</span>
      <strong data-course>WIRE</strong>
      <span data-cam>0.00  0.00  0.00</span>
    </div>
    <svg class="leaders" aria-hidden="true"></svg>
    <div class="tags"></div>
    <div class="cycle">
      <p class="cycle-kicker" data-text=""></p>
      <a class="cycle-link" data-text="" href="mailto:${brand.email}"></a>
    </div>
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
  const cycle = ui.querySelector('.cycle')
  const cycleKicker = ui.querySelector('.cycle-kicker')
  const cycleLink = ui.querySelector('.cycle-link')
  if (
    !(rail instanceof HTMLElement) ||
    !(progress instanceof HTMLElement) ||
    !(sound instanceof HTMLButtonElement) ||
    !(course instanceof HTMLElement) ||
    !(cam instanceof HTMLElement) ||
    !(leaders instanceof SVGSVGElement) ||
    !(tags instanceof HTMLElement) ||
    !(flash instanceof HTMLElement) ||
    !(cycle instanceof HTMLElement) ||
    !(cycleKicker instanceof HTMLElement) ||
    !(cycleLink instanceof HTMLElement)
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
      section.id === 'figure'
        ? `<a class="contact" href="mailto:${brand.email}"><span data-text="${brand.figure.contact}">${brand.figure.contact}</span><span data-text="${brand.email}">${brand.email}</span></a>`
        : ''
    const hint = section.id === 'field' ? `<p class="hint" data-text="${brand.hero.hint}">${brand.hero.hint}</p>` : ''
    el.innerHTML = `
      <div class="sticky">
        <div class="copy">
          <p class="kicker" data-text="${section.kicker}">${section.kicker}</p>
          <h2 class="title" data-text="${section.title}">${section.title}</h2>
          <p class="body" data-text="${section.body}">${section.body}</p>
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
    button.innerHTML = `<span>${section.index}</span><em data-text="${section.label}">${section.label}</em>`
    rail.append(button)
  }

  const tagNodes: HTMLElement[] = []
  const lineNodes: SVGPolylineElement[] = []
  const dotNodes: SVGCircleElement[] = []
  for (let i = 0; i < labelSlots; i += 1) {
    const tag = document.createElement('div')
    tag.className = 'tag'
    tags.append(tag)
    tagNodes.push(tag)

    const line = document.createElementNS(svgNs, 'polyline')
    const dot = document.createElementNS(svgNs, 'circle')
    dot.setAttribute('r', '2.2')
    leaders.append(line, dot)
    lineNodes.push(line)
    dotNodes.push(dot)
  }
  const constellation = document.createElementNS(svgNs, 'polyline')
  constellation.setAttribute('class', 'constellation')
  leaders.append(constellation)

  let navigate: (id: string) => void = () => {}
  let toggleSound: () => boolean = () => false
  let active: ScreenId | '' = ''
  let cycleKey = ''
  let courseKey = ''

  rail.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    const id = button?.dataset.screen
    if (id) navigate(id)
  })

  sound.addEventListener('click', () => {
    const on = toggleSound()
    const label = on ? brand.soundOn : brand.soundOff
    sound.dataset.text = label
    sound.textContent = label
    sound.setAttribute('aria-pressed', on ? 'true' : 'false')
  })

  const scrambleIn = (root: ParentNode, selector: string) => {
    root.querySelectorAll(selector).forEach((node) => {
      if (node instanceof HTMLElement) scramble(node)
    })
  }

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
    revealChrome() {
      scrambleIn(ui, '.wordmark, .corner .kicker, .corner-body, .sound')
      scrambleIn(rail, 'em')
      const title = sections.field.querySelector('h2')
      const kicker = sections.field.querySelector('.kicker')
      const body = sections.field.querySelector('.body')
      if (title instanceof HTMLElement) scramble(title)
      if (kicker instanceof HTMLElement) scramble(kicker)
      if (body instanceof HTMLElement) scramble(body)
    },
    scrambleCorner() {
      const kicker = ui.querySelector('.corner .kicker')
      const body = ui.querySelector('.corner-body')
      if (kicker instanceof HTMLElement) scramble(kicker)
      if (body instanceof HTMLElement) scramble(body)
    },
    setActive(id) {
      if (id === active) return
      active = id
      document.body.dataset.screen = id
      for (const button of rail.querySelectorAll('button')) {
        const on = button.dataset.screen === id
        button.classList.toggle('is-active', on)
        if (on) {
          const em = button.querySelector('em')
          if (em instanceof HTMLElement) scramble(em)
        }
      }
      const section = sections[id]
      const title = section.querySelector('h2')
      const kicker = section.querySelector('.kicker')
      const body = section.querySelector('.body')
      if (title instanceof HTMLElement) scramble(title)
      if (kicker instanceof HTMLElement) scramble(kicker)
      if (body instanceof HTMLElement) scramble(body)
    },
    setTelemetry(courseText, cameraText) {
      if (courseText !== courseKey) {
        courseKey = courseText
        course.dataset.text = courseText
        scramble(course)
      }
      cam.textContent = cameraText
    },
    setScrollProgress(value) {
      progress.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`
    },
    updateLabels(labels) {
      const stars: string[] = []
      let starOpacity = 0
      for (let i = 0; i < tagNodes.length; i += 1) {
        const label = labels[i]
        const tag = tagNodes[i]
        const line = lineNodes[i]
        const dot = dotNodes[i]
        if (!tag || !line || !dot) continue
        if (!label || !label.visible || label.opacity <= 0.02) {
          tag.style.opacity = '0'
          tag.dataset.on = '0'
          line.style.opacity = '0'
          dot.style.opacity = '0'
          continue
        }
        if (tag.dataset.on !== '1') {
          tag.dataset.on = '1'
          tag.dataset.text = label.text
          scramble(tag)
        } else if (!tag.classList.contains('is-glitching')) {
          tag.textContent = label.text
        }
        tag.style.opacity = label.opacity.toFixed(3)
        tag.style.transform = `translate(${label.labelX}px, ${label.labelY}px) translate(-50%, -50%)`
        line.style.opacity = String(label.opacity * 0.9)
        dot.style.opacity = String(label.opacity)
        const elbow = label.bent ? `${label.labelX.toFixed(1)},${label.anchorY.toFixed(1)} ` : ''
        line.setAttribute(
          'points',
          `${label.anchorX.toFixed(1)},${label.anchorY.toFixed(1)} ${elbow}${label.labelX.toFixed(1)},${label.labelY.toFixed(1)}`,
        )
        dot.setAttribute('cx', label.anchorX.toFixed(1))
        dot.setAttribute('cy', label.anchorY.toFixed(1))
        if (label.constellation) {
          stars.push(`${label.anchorX.toFixed(1)},${label.anchorY.toFixed(1)}`)
          starOpacity = Math.max(starOpacity, label.opacity)
        }
      }
      if (stars.length >= 2) {
        constellation.setAttribute('points', stars.join(' '))
        constellation.style.opacity = starOpacity.toFixed(3)
      } else {
        constellation.style.opacity = '0'
      }
    },
    setCycle(kicker, value, opacity) {
      cycle.style.opacity = String(Math.max(0, Math.min(1, opacity)))
      const key = `${kicker}|${value}`
      if (key === cycleKey) return
      cycleKey = key
      cycleKicker.dataset.text = kicker
      cycleLink.dataset.text = value
      if (opacity > 0.2) {
        scramble(cycleKicker)
        scramble(cycleLink)
      } else {
        cycleKicker.textContent = kicker
        cycleLink.textContent = value
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
