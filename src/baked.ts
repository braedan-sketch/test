import {
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { loadKtx2, publicUrl } from './heroModel'

/**
 * handoff_hero_v1, in public/models/hero/. Baked is the default hero.
 * ?baked=0 keeps the realtime igloo and terrain. File names stay put so a
 * darker albedo drop can replace the KTX2s without a code change.
 *
 * hero.json is the manifest. Without it, the loader uses the names below.
 * Lightmaps and the seam mask are sRGB. AO is linear. Light and AO are on
 * glTF TEXCOORD_1 (three.js channel 1). Seam and albedo are on UV0.
 */
const HERO_ROOT = '/models/hero/'

const DEFAULT_IGLOO = {
  glb: 'igloo.glb',
  lightMap: 'igloo_lightmap.ktx2',
  aoMap: 'igloo_ao.ktx2',
  seamMask: 'igloo_seam_mask.ktx2',
  albedo: 'igloo_albedo.ktx2',
  lightMapIntensity: 55.832,
  aoMapIntensity: 0.25,
  emissiveIntensity: 2.8,
  emissive: [0.93, 0.96, 1],
}

const DEFAULT_TERRAIN = {
  glb: 'terrain.glb',
  lightMap: 'ground_lightmap.ktx2',
  aoMap: 'ground_ao.ktx2',
  lightMapIntensity: 38.625,
  aoMapIntensity: 0.25,
}

export type BakedSlot = {
  model: string | null
  light: Texture | null
  ao: Texture | null
  seam: Texture | null
  albedo: Texture | null
  lightIntensity: number
  aoIntensity: number
  emissive: [number, number, number] | null
  emissiveIntensity: number | null
}

export type BakedHandoff = {
  igloo: BakedSlot
  terrain: BakedSlot
  ready: boolean
}

type ManifestEntry = {
  model?: unknown
  glb?: unknown
  light?: unknown
  lightMap?: unknown
  ao?: unknown
  aoMap?: unknown
  seam?: unknown
  seamMask?: unknown
  albedo?: unknown
  lightChannel?: unknown
  lightMapChannel?: unknown
  aoChannel?: unknown
  aoMapChannel?: unknown
  seamChannel?: unknown
  albedoChannel?: unknown
  lightIntensity?: unknown
  lightMapIntensity?: unknown
  aoIntensity?: unknown
  aoMapIntensity?: unknown
  emissive?: unknown
  emissiveIntensity?: unknown
}

export function emptyBakedSlot(): BakedSlot {
  return {
    model: null,
    light: null,
    ao: null,
    seam: null,
    albedo: null,
    lightIntensity: 1,
    aoIntensity: 1,
    emissive: null,
    emissiveIntensity: null,
  }
}

/** Lightmap or a finished albedo stands in for the sun and the environment. */
export function bakedLights(slot: BakedSlot | null): boolean {
  return !!slot && (!!slot.light || !!slot.albedo)
}

export function describeBaked(handoff: BakedHandoff | null) {
  if (!handoff) return { enabled: false, ready: false, igloo: [], terrain: [] }
  const names = (slot: BakedSlot) =>
    (['model', 'light', 'ao', 'seam', 'albedo'] as const).filter((key) => slot[key])
  return {
    enabled: true,
    ready: handoff.ready,
    igloo: names(handoff.igloo),
    terrain: names(handoff.terrain),
  }
}

/**
 * The lightmap already holds the sun, sky and GI. Drop the live lights so
 * they are not added again. The emissive seam is a separate term.
 */
export function bakeLightShader(fragment: string) {
  return fragment
    .replace(
      '#include <lights_fragment_maps>',
      `#if defined( RE_IndirectDiffuse )
        irradiance = vec3(0.0);
      #endif
      #include <lights_fragment_maps>`,
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      reflectedLight.directDiffuse *= 0.0;
      reflectedLight.directSpecular *= 0.0;
      reflectedLight.indirectSpecular *= 0.0;`,
    )
}

export function assignBakedMaps(material: MeshStandardMaterial, slot: BakedSlot | null, renderer: WebGLRenderer) {
  if (!slot) return false
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  const bind = (texture: Texture | null, color: 'srgb' | 'linear') => {
    if (!texture) return
    texture.flipY = false
    texture.anisotropy = anisotropy
    texture.colorSpace = color === 'srgb' ? SRGBColorSpace : NoColorSpace
    texture.needsUpdate = true
  }
  bind(slot.light, 'srgb')
  bind(slot.ao, 'linear')
  bind(slot.seam, 'srgb')
  bind(slot.albedo, 'srgb')
  if (slot.light) {
    material.lightMap = slot.light
    material.lightMapIntensity = slot.lightIntensity
  }
  if (slot.ao) {
    material.aoMap = slot.ao
    material.aoMapIntensity = slot.aoIntensity
  }
  if (slot.seam) material.emissiveMap = slot.seam
  if (slot.albedo) {
    material.map = slot.albedo
    material.color.set('#ffffff')
  }
  if (bakedLights(slot)) material.envMapIntensity = 0
  return !!(slot.light || slot.ao || slot.seam || slot.albedo)
}

export type BakedPlan = {
  ready: Promise<BakedHandoff>
  igloo: Promise<BakedSlot>
  terrain: Promise<BakedSlot>
  iglooModel: Promise<string | null>
  terrainModel: Promise<string | null>
}

/**
 * The manifest resolves before the KTX2 files, so the glb download runs
 * alongside the maps. A missing handoff leaves the realtime materials.
 */
export function startBakedPlan(renderer: WebGLRenderer): BakedPlan {
  const manifestP = readManifest()
  const iglooEntry = manifestP.then((manifest) => (manifest ? (manifest.igloo ?? {}) : DEFAULT_IGLOO))
  const terrainEntry = manifestP.then((manifest) => (manifest ? (manifest.terrain ?? {}) : DEFAULT_TERRAIN))
  const igloo = iglooEntry.then((entry) => loadSlot(entry, renderer))
  const terrain = terrainEntry.then((entry) => loadSlot(entry, renderer))
  const ready = Promise.all([igloo, terrain]).then(([iglooSlot, terrainSlot]) => {
    const handoff = { igloo: iglooSlot, terrain: terrainSlot, ready: slotReady(iglooSlot) || slotReady(terrainSlot) }
    if (!handoff.ready) {
      console.info('[baked] handoff_hero_v1 is not in /models/hero yet. Realtime hero stays.')
    } else {
      console.info('[baked]', describeBaked(handoff))
    }
    return handoff
  })
  return {
    ready,
    igloo,
    terrain,
    iglooModel: iglooEntry.then((entry) => namedModel(entry)),
    terrainModel: terrainEntry.then((entry) => namedModel(entry)),
  }
}

function namedModel(entry: ManifestEntry) {
  const file = fileOf(entry.glb ?? entry.model)
  return file ? heroFile(file) : null
}

function slotReady(slot: BakedSlot) {
  return !!(slot.model || slot.light || slot.ao || slot.seam || slot.albedo)
}

async function readManifest(): Promise<{ igloo?: ManifestEntry; terrain?: ManifestEntry } | null> {
  try {
    const response = await fetch(publicUrl(`${HERO_ROOT}hero.json`))
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || type.includes('text/html')) return null
    const data = (await response.json()) as { igloo?: ManifestEntry; terrain?: ManifestEntry }
    if (!data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

async function loadSlot(entry: ManifestEntry, renderer: WebGLRenderer): Promise<BakedSlot> {
  const slot = emptyBakedSlot()
  slot.lightIntensity = numberOr(entry.lightMapIntensity ?? entry.lightIntensity, 1)
  slot.aoIntensity = numberOr(entry.aoMapIntensity ?? entry.aoIntensity, 1)
  slot.emissive = rgbOf(entry.emissive)
  slot.emissiveIntensity = entry.emissiveIntensity == null ? null : numberOr(entry.emissiveIntensity, 2.8)
  const model = fileOf(entry.glb ?? entry.model)
  slot.model = model ? heroFile(model) : null
  const [light, ao, seam, albedo] = await Promise.all([
    loadMap(entry.lightMap ?? entry.light, renderer),
    loadMap(entry.aoMap ?? entry.ao, renderer),
    loadMap(entry.seamMask ?? entry.seam, renderer),
    loadMap(entry.albedo, renderer),
  ])
  slot.light = light
  slot.ao = ao
  slot.seam = seam
  slot.albedo = albedo
  applyChannel(slot.light, entry.lightMapChannel ?? entry.lightChannel, 1)
  applyChannel(slot.ao, entry.aoMapChannel ?? entry.aoChannel, 1)
  applyChannel(slot.seam, entry.seamChannel, 0)
  applyChannel(slot.albedo, entry.albedoChannel, 0)
  return slot
}

async function loadMap(value: unknown, renderer: WebGLRenderer) {
  const file = fileOf(value)
  if (!file) return null
  return loadKtx2(heroFile(file), renderer)
}

function applyChannel(texture: Texture | null, value: unknown, fallback: number) {
  if (!texture) return
  const channel = numberOr(value, fallback)
  texture.channel = channel === 0 || channel === 1 || channel === 2 ? channel : fallback
}

function heroFile(file: string) {
  if (file.startsWith('/')) return file
  return `${HERO_ROOT}${file.replace(/^\.\//, '')}`
}

function fileOf(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberOr(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function rgbOf(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const rgb = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (rgb.some((channel) => !Number.isFinite(channel))) return null
  return [rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1]
}
