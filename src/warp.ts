import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

/**
 * Scroll-driven screen warp: water ripple, blur, a bottom-to-top pixel glitch,
 * and a white mix. Every uniform is set from scroll position.
 */
const fragment = /* glsl */ `
uniform float uRipple;
uniform float uBlur;
uniform float uGlitch;
uniform float uWhite;
uniform float uPhase;
uniform float uAspect;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 centered = uv - 0.5;
  centered.x *= uAspect;
  float dist = length(centered);
  vec2 dir = dist > 0.0001 ? centered / dist : vec2(0.0);
  float wave = sin(dist * 34.0 - uPhase * 16.0);
  float ridge = sin(dist * 18.0 - uPhase * 9.0 + 1.4);
  vec2 warp = dir * (wave * 0.7 + ridge * 0.3) * uRipple * 0.05;
  warp.x /= max(uAspect, 0.001);
  vec2 baseUv = uv + warp;

  vec4 color = texture(inputBuffer, baseUv);
  if (uBlur > 0.001) {
    vec2 px = vec2(uBlur * 0.014, uBlur * 0.014);
    color += texture(inputBuffer, baseUv + vec2(px.x, 0.0));
    color += texture(inputBuffer, baseUv - vec2(px.x, 0.0));
    color += texture(inputBuffer, baseUv + vec2(0.0, px.y));
    color += texture(inputBuffer, baseUv - vec2(0.0, px.y));
    color += texture(inputBuffer, baseUv + px);
    color += texture(inputBuffer, baseUv - px);
    color += texture(inputBuffer, baseUv + vec2(px.x, -px.y));
    color += texture(inputBuffer, baseUv + vec2(-px.x, px.y));
    color /= 9.0;
  }

  if (uGlitch > 0.001 && uv.y < uGlitch) {
    float depth = clamp((uGlitch - uv.y) / 0.22, 0.0, 1.0);
    float cells = mix(48.0, 7.0, depth);
    float band = floor(uv.y * 28.0);
    float shift = sin(band * 17.3 + uPhase * 8.0) * 0.08 * depth;
    vec2 count = vec2(cells * max(uAspect, 0.001), cells);
    vec2 grid = (floor((uv + vec2(shift, 0.0)) * count) + 0.5) / count;
    float split = mix(0.01, 0.06, depth);
    float r = texture(inputBuffer, grid + vec2(split, 0.0)).r;
    float g = texture(inputBuffer, grid).g;
    float b = texture(inputBuffer, grid - vec2(split, 0.012)).b;
    float stripe = step(0.5, fract(band * 0.37));
    vec3 torn = vec3(r, g, b) + vec3(0.45, -0.08, 0.32) * stripe * depth;
    float edge = smoothstep(uGlitch - 0.028, uGlitch, uv.y);
    color.rgb = mix(torn, color.rgb, edge);
  }

  color.rgb = mix(color.rgb, vec3(1.0), clamp(uWhite, 0.0, 1.0));
  outputColor = vec4(color.rgb, 1.0);
}
`

export class WarpEffect extends Effect {
  constructor() {
    super('WarpEffect', fragment, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uRipple', new Uniform(0)],
        ['uBlur', new Uniform(0)],
        ['uGlitch', new Uniform(0)],
        ['uWhite', new Uniform(0)],
        ['uPhase', new Uniform(0)],
        ['uAspect', new Uniform(1)],
      ]),
    })
  }

  setWarp(ripple: number, blur: number, glitch: number, white: number, phase: number, aspect: number) {
    this.uniforms.get('uRipple')!.value = ripple
    this.uniforms.get('uBlur')!.value = blur
    this.uniforms.get('uGlitch')!.value = glitch
    this.uniforms.get('uWhite')!.value = white
    this.uniforms.get('uPhase')!.value = phase
    this.uniforms.get('uAspect')!.value = aspect
  }
}
