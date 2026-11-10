import 'lenis/dist/lenis.css'
import './scrub.css'
import { startScrub } from './scrub'

startScrub().catch((error: unknown) => {
  console.error(error)
  const loader = document.querySelector('#loader')
  if (loader) loader.textContent = 'The reel failed to load.'
})
