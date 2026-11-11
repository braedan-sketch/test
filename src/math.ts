export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function smoother(t: number) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

export function hashString(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function sectionProgress(el: HTMLElement) {
  const scrollable = el.offsetHeight - window.innerHeight
  if (scrollable <= 1) return el.getBoundingClientRect().top <= 0 ? 1 : 0
  return clamp(-el.getBoundingClientRect().top / scrollable, 0, 1)
}
