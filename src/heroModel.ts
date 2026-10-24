import { Box3, Group, LoadingManager, Vector3, type WebGLRenderer } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url'
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url'

let basisLoader: KTX2Loader | null = null

const heroManager = new LoadingManager()
const heroBytes = new Map<string, { loaded: number; total: number }>()
let heroProgressListener: ((value: number) => void) | null = null
let heroProgressHigh = 0
let heroItemsLoaded = 0
let heroItemsTotal = 0

function emitHeroProgress() {
  let loaded = 0
  let total = 0
  for (const slot of heroBytes.values()) {
    if (slot.total <= 0) continue
    loaded += slot.loaded
    total += slot.total
  }
  const bytes = total > 0 ? loaded / total : 0
  const items = heroItemsTotal > 0 ? heroItemsLoaded / heroItemsTotal : 0
  const value = Math.max(bytes, items)
  heroProgressHigh = Math.max(heroProgressHigh, value)
  heroProgressListener?.(heroProgressHigh)
}

heroManager.onProgress = (_url, loaded, total) => {
  heroItemsLoaded = loaded
  heroItemsTotal = total
  emitHeroProgress()
}
heroManager.onLoad = () => emitHeroProgress()

/** Download fraction across hero GLBs, from file bytes when the length is known. */
export function bindHeroProgress(listener: (value: number) => void) {
  heroProgressListener = listener
  listener(heroProgressHigh)
}

function ktx2Loader(renderer: WebGLRenderer) {
  if (!basisLoader) {
    basisLoader = new KTX2Loader()
    basisLoader.detectSupport(renderer)
  }
  return basisLoader
}

/** Asset URL that follows Vite's base, including `./` for a folder-relative build. */
export function publicUrl(path: string) {
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\//, '')}`
}

type HeroLoadOptions = {
  /** Skip the HEAD probe and start the body download immediately. */
  eager?: boolean
  onProgress?: (value: number) => void
}

/**
 * Load a hero GLB when the file exists. A missing file, or a file that fails
 * to parse, returns null so the scene can keep its procedural stand-in.
 */
export async function loadHero(
  url: string,
  renderer?: WebGLRenderer,
  options?: HeroLoadOptions,
): Promise<Group | null> {
  url = publicUrl(url)
  if (!options?.eager) {
    try {
      const head = await fetch(url, { method: 'HEAD' })
      const type = head.headers.get('content-type') ?? ''
      if (!head.ok || type.includes('text/html')) return null
    } catch {
      return null
    }
  }

  const draco = new DRACOLoader()
  draco.setDecoderPath({ js: dracoWrapper, wasm: dracoWasm })
  const loader = new GLTFLoader(heroManager)
  loader.setDRACOLoader(draco)
  if (renderer) loader.setKTX2Loader(ktx2Loader(renderer))
  heroBytes.set(url, { loaded: 0, total: 0 })
  try {
    const gltf = await loader.loadAsync(url, (event) => {
      const total = event.total > 0 ? event.total : (heroBytes.get(url)?.total ?? 0)
      heroBytes.set(url, { loaded: event.loaded, total })
      emitHeroProgress()
      if (options?.onProgress && total > 0) options.onProgress(event.loaded / total)
    })
    const scene = gltf.scene
    scene.name = url
    return scene
  } catch (error) {
    console.warn(`Hero model ${url} failed to load`, error)
    return null
  } finally {
    draco.dispose()
  }
}

/**
 * Uniformly scale a loaded hero.
 * `center` fits the longest axis and recenters on the origin.
 * `floor` fits the height and sits the base on y = 0.
 */
export function fitHero(root: Group, size: number, anchor: 'center' | 'floor' = 'center') {
  root.updateMatrixWorld(true)
  const box = new Box3().setFromObject(root)
  const dims = box.getSize(new Vector3())
  const longest = anchor === 'floor' ? Math.max(dims.y, 0.001) : Math.max(dims.x, dims.y, dims.z, 0.001)
  root.scale.multiplyScalar(size / longest)
  root.updateMatrixWorld(true)
  const fitted = new Box3().setFromObject(root)
  const center = fitted.getCenter(new Vector3())
  if (anchor === 'floor') {
    root.position.x -= center.x
    root.position.z -= center.z
    root.position.y -= fitted.min.y
  } else {
    root.position.sub(center)
  }
  root.updateMatrixWorld(true)
}
