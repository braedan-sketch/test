import { Effect } from 'postprocessing'

/**
 * Edge frost, a few dirty-lens specks, and a blue-noise-ish dither.
 * The centre of the frame stays clean.
 */
const fragment = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = uv * 2.0 - 1.0;
  float r = length(p);
  float edge = smoothstep(0.42, 1.05, r);
  vec2 offset = p * edge * 0.008;
  vec3 color = texture2D(inputBuffer, uv + offset).rgb;
  vec3 cool = color * vec3(0.86, 0.92, 0.98) + vec3(0.05, 0.07, 0.09);
  color = mix(color, cool, edge * 0.42);
  float speck = fract(sin(dot(floor(uv * vec2(220.0, 160.0)), vec2(12.9898, 78.233))) * 43758.5453);
  float dirt = smoothstep(0.986, 0.998, speck) * edge;
  color += dirt * vec3(0.55, 0.6, 0.66);
  float n1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float n2 = fract(sin(dot(gl_FragCoord.xy + vec2(19.0, 7.0), vec2(93.989, 67.345))) * 24634.6345);
  float dither = (n1 + n2) - 1.0;
  color += dither / 180.0;
  outputColor = vec4(color, inputColor.a);
}
`

export class FrostEffect extends Effect {
  constructor() {
    super('FrostEffect', fragment)
  }
}
