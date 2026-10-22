import 'lenis/dist/lenis.css'
import './style.css'
import { brand } from './brand'
import { startExperience } from './experience'
import { mountOverlay } from './overlay'

const overlay = mountOverlay()

startExperience(overlay).catch((error: unknown) => {
  console.error(error)
  overlay.fail(brand.loader.error)
})
