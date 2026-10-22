export type Quality = {
  low: boolean
  dprCap: number
  snow: number
  terrainSeg: number
  blockTransmission: boolean
  crystalTransmission: boolean
  shadows: boolean
  smaa: boolean
  points: number
  sprites: boolean
}

export function detectQuality(): Quality {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('quality')
  const cores = navigator.hardwareConcurrency ?? 8
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const narrow = window.matchMedia('(max-width: 820px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const low = forced === 'low' || (forced !== 'high' && (narrow || coarse || cores <= 4 || memory <= 4))

  if (low) {
    return {
      low: true,
      dprCap: 1.15,
      snow: 70,
      terrainSeg: 48,
      blockTransmission: false,
      crystalTransmission: false,
      shadows: false,
      smaa: false,
      points: 9000,
      sprites: false,
    }
  }

  return {
    low: false,
    dprCap: 1.5,
    snow: 280,
    terrainSeg: 110,
    blockTransmission: true,
    crystalTransmission: true,
    shadows: true,
    smaa: true,
    points: 34000,
    sprites: true,
  }
}

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
