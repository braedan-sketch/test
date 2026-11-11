export type Quality = {
  low: boolean
  dprCap: number
  snow: number
  terrainSeg: number
  blockTransmission: boolean
  crystalTransmission: boolean
  /** Real transmission glass. Off for the low tier and when float targets are missing. */
  physicalCrystal: boolean
  shadows: boolean
  smaa: boolean
  points: number
  sprites: boolean
}

function hasFloatTargets() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    return Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
  } catch {
    return false
  }
}

export function detectQuality(): Quality {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('quality')
  const cores = navigator.hardwareConcurrency ?? 8
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const narrow = window.matchMedia('(max-width: 820px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const low = forced === 'low' || (forced !== 'high' && (narrow || coarse || cores <= 4 || memory <= 4))
  const physicalCrystal = !low && hasFloatTargets()

  if (low) {
    return {
      low: true,
      dprCap: 1.15,
      snow: 70,
      terrainSeg: 48,
      blockTransmission: false,
      crystalTransmission: false,
      physicalCrystal: false,
      shadows: false,
      smaa: false,
      points: 14000,
      sprites: false,
    }
  }

  return {
    low: false,
    dprCap: 2,
    snow: 280,
    terrainSeg: 110,
    blockTransmission: true,
    crystalTransmission: true,
    physicalCrystal,
    shadows: true,
    smaa: true,
    points: 64000,
    sprites: true,
  }
}

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
