import { Box3, Group, Vector3 } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url'
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url'

/** Asset URL that follows Vite's base, including `./` for a folder-relative build. */
export function publicUrl(path: string) {
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\//, '')}`
}

/**
 * Load a hero GLB when the file exists. A missing file, or a file that fails
 * to parse, returns null so the scene can keep its procedural stand-in.
 */
export async function loadHero(url: string): Promise<Group | null> {
  url = publicUrl(url)
  try {
    const head = await fetch(url, { method: 'HEAD' })
    const type = head.headers.get('content-type') ?? ''
    if (!head.ok || type.includes('text/html')) return null
  } catch {
    return null
  }

  const draco = new DRACOLoader()
  draco.setDecoderPath({ js: dracoWrapper, wasm: dracoWasm })
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  try {
    const gltf = await loader.loadAsync(url)
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
