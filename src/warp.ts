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
    float depth = clamp((uGlitch - uv.y) / 0.45, 0.0, 1.0);
    float band = floor(uv.y * 96.0);
    float shift = sin(band * 12.7 + uPhase * 5.0) * 0.008 * depth;
    vec3 torn = texture(inputBuffer, vec2(uv.x + shift, uv.y)).rgb;
    float l = dot(torn, vec3(0.299, 0.587, 0.114));
    torn = vec3(l);
    float stripe = step(0.82, fract(band * 0.41));
    torn *= 1.0 - stripe * depth * 0.28;
    float edge = smoothstep(uGlitch - 0.03, uGlitch, uv.y);
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
