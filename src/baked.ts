import {
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { loadKtx2, publicUrl } from './heroModel'

/**
 * handoff_hero_v1, dropped in public/models/hero/.
 *
 * Optional hero.json lists the files. Without it, the loader probes the
 * default names below. Paths are relative to /models/hero/ unless they
 * start with /. Maps are KTX2.
 *
 *   igloo_light.ktx2     UV2 illuminance (glTF TEXCOORD_1, texture.channel 1)
 *   igloo_ao.ktx2        UV2 ambient occlusion, red channel, linear
 *   igloo_seam.ktx2      emissive seam mask, UV0, linear. The realtime seam
 *                        curve and bloom stay on top of this mask.
 *   igloo_albedo.ktx2    optional base color, UV0, sRGB. Not a beauty pass
 *                        when a lightmap is also present.
 *   terrain_light.ktx2 / terrain_ao.ktx2 / terrain_albedo.ktx2
 *
 * Optional "model" replaces /models/igloo.glb or /models/terrain.glb. The
 * igloo file still needs one mesh per brick, translation only, extras
 * row/t/kind/bidx, so separation can keep moving nodes. Put the lightmap
 * on UV2. ?baked=1 with none of these files keeps the realtime hero.
 */
const HERO_ROOT = '/models/hero/'

const DEFAULT_IGLOO = {
  light: 'igloo_light.ktx2',
  ao: 'igloo_ao.ktx2',
  seam: 'igloo_seam.ktx2',
  albedo: 'igloo_albedo.ktx2',
}

const DEFAULT_TERRAIN = {
  light: 'terrain_light.ktx2',
  ao: 'terrain_ao.ktx2',
  albedo: 'terrain_albedo.ktx2',
}

export type BakedSlot = {
  model: string | null
  light: Texture | null
  ao: Texture | null
  seam: Texture | null
  albedo: Texture | null
  lightIntensity: number
  aoIntensity: number
}

export type BakedHandoff = {
  igloo: BakedSlot
  terrain: BakedSlot
  ready: boolean
}

type ManifestEntry = {
  model?: unknown
  light?: unknown
  ao?: unknown
  seam?: unknown
  albedo?: unknown
  lightChannel?: unknown
  aoChannel?: unknown
  seamChannel?: unknown
  albedoChannel?: unknown
  lightIntensity?: unknown
  aoIntensity?: unknown
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
 * Drop hemisphere and direct light so a UV2 lightmap is not added on top of
 * the live sun. The emissive seam is a different term and stays.
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
      reflectedLight.directDiffuse *= 0.05;
      reflectedLight.directSpecular *= 0.02;
      reflectedLight.indirectSpecular *= 0.04;`,
    )
}

export function assignBakedMaps(material: MeshStandardMaterial, slot: BakedSlot | null, renderer: WebGLRenderer) {
  if (!slot) return false
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  const bind = (texture: Texture | null, color: 'albedo' | 'light' | 'data') => {
    if (!texture) return
    texture.flipY = false
    texture.anisotropy = anisotropy
    if (color === 'albedo' && texture.colorSpace === NoColorSpace) texture.colorSpace = SRGBColorSpace
    if (color === 'light' && texture.colorSpace === NoColorSpace) texture.colorSpace = LinearSRGBColorSpace
    if (color === 'data') texture.colorSpace = NoColorSpace
    texture.needsUpdate = true
  }
  bind(slot.light, 'light')
  bind(slot.ao, 'data')
  bind(slot.seam, 'data')
  bind(slot.albedo, 'albedo')
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
 * ?baked=1. The manifest (or its absence) resolves before the KTX2 files,
 * so the glb download can run alongside the maps. Missing files leave the
 * realtime materials in place.
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
  const file = fileOf(entry.model)
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
  slot.lightIntensity = numberOr(entry.lightIntensity, 1)
  slot.aoIntensity = numberOr(entry.aoIntensity, 1)
  const model = fileOf(entry.model)
  slot.model = model ? heroFile(model) : null
  const [light, ao, seam, albedo] = await Promise.all([
    loadMap(entry.light, renderer),
    loadMap(entry.ao, renderer),
    loadMap(entry.seam, renderer),
    loadMap(entry.albedo, renderer),
  ])
  slot.light = light
  slot.ao = ao
  slot.seam = seam
  slot.albedo = albedo
  applyChannel(slot.light, entry.lightChannel, 1)
  applyChannel(slot.ao, entry.aoChannel, 1)
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
