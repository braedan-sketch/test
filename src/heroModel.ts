import { Box3, Group, LoadingManager, Vector3, type Texture, type WebGLRenderer } from 'three'
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

function emitHeroProgress() {
  let loaded = 0
  let total = 0
  for (const slot of heroBytes.values()) {
    if (slot.total <= 0) continue
    loaded += slot.loaded
    total += slot.total
  }
  const bytes = total > 0 ? Math.min(1, loaded / total) : 0
  heroProgressHigh = Math.max(heroProgressHigh, bytes)
  heroProgressListener?.(heroProgressHigh)
}

heroManager.onProgress = () => {
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

const ktx2Loads = new Map<string, Promise<Texture | null>>()

/**
 * One GET per KTX2. A HEAD probe in front of the body was a second request,
 * and the first of the pair was aborted. A missing file returns null.
 */
export function loadKtx2(url: string, renderer: WebGLRenderer): Promise<Texture | null> {
  const resolved = publicUrl(url)
  const pending = ktx2Loads.get(resolved)
  if (pending) return pending
  const load = ktx2Loader(renderer)
    .loadAsync(resolved)
    .catch((error: unknown) => {
      console.warn(`KTX2 ${url} failed to load`, error)
      return null
    })
  ktx2Loads.set(resolved, load)
  return load
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
    const buffer = await readWithProgress(url, (loaded, total) => {
      const slot = heroBytes.get(url) ?? { loaded: 0, total: 0 }
      slot.loaded = Math.max(slot.loaded, loaded)
      if (total > 0) slot.total = Math.max(slot.total, total)
      heroBytes.set(url, slot)
      emitHeroProgress()
      if (options?.onProgress && slot.total > 0) options.onProgress(slot.loaded / slot.total)
    })
    const base = url.slice(0, url.lastIndexOf('/') + 1)
    const gltf = await loader.parseAsync(buffer, base)
    const slot = heroBytes.get(url)
    if (slot && slot.total <= 0) {
      slot.total = slot.loaded
      heroBytes.set(url, slot)
      emitHeroProgress()
    }
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

/** Stream the file so the loader sees bytes as they arrive, including embedded KTX2. */
async function readWithProgress(url: string, onBytes: (loaded: number, total: number) => void) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  let total = Number(response.headers.get('content-length')) || 0
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = await response.arrayBuffer()
    onBytes(buffer.byteLength, buffer.byteLength)
    return buffer
  }
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    if (!step.value) continue
    chunks.push(step.value)
    loaded += step.value.byteLength
    onBytes(loaded, total)
  }
  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  onBytes(loaded, total > 0 ? total : loaded)
  return buffer.buffer
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
