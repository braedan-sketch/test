import { Color, MeshPhysicalMaterial, Vector3 } from 'three'
import type { Quality } from './quality'

export const NOISE = /* glsl */ `
float blHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float blNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = blHash(i);
  float n100 = blHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = blHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = blHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = blHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = blHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = blHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = blHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`

export type BlockUniforms = {
  uBurst: { value: number }
  uSolid: { value: number }
  uDissolve: { value: number }
  uCenter: { value: Vector3 }
}

export function createBlockMaterial(quality: Quality) {
  const uniforms: BlockUniforms = {
    uBurst: { value: 0 },
    uSolid: { value: 0 },
    uDissolve: { value: 0 },
    uCenter: { value: new Vector3() },
  }

  const frost = { value: quality.blockTransmission ? 0.07 : 0.26 }
  const material = new MeshPhysicalMaterial({
    color: new Color('#d2dee8'),
    roughness: 0.36,
    metalness: 0,
    transmission: quality.blockTransmission ? 0.46 : 0,
    thickness: quality.blockTransmission ? 1.15 : 0,
    ior: 1.31,
    attenuationColor: new Color('#c5d8ea'),
    attenuationDistance: 1.35,
    clearcoat: 0.42,
    clearcoatRoughness: 0.16,
    sheen: 0.62,
    sheenColor: new Color('#f4f9fc'),
    sheenRoughness: 0.38,
    envMapIntensity: 0.72,
    emissive: new Color('#000000'),
    emissiveIntensity: 1,
  })

  material.customProgramCacheKey = () => 'blendy-block-v4'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurst = uniforms.uBurst
    shader.uniforms.uSolid = uniforms.uSolid
    shader.uniforms.uDissolve = uniforms.uDissolve
    shader.uniforms.uCenter = uniforms.uCenter
    shader.uniforms.uFrost = frost

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSeed;
        attribute float aRow;
        varying float vSeed;
        varying float vRow;
        varying vec3 vWPos;
        ${NOISE}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          vec3 np = position * 42.0 + vec3(aSeed * 19.0);
          float e = 0.7;
          float h0 = blNoise(np);
          float hx = blNoise(np + vec3(e, 0.0, 0.0));
          float hy = blNoise(np + vec3(0.0, e, 0.0));
          float hz = blNoise(np + vec3(0.0, 0.0, e));
          vec3 grain = vec3(h0 - hx, h0 - hy, h0 - hz);
          vec3 fineP = np * 2.4;
          float f0 = blNoise(fineP);
          float fx = blNoise(fineP + vec3(e, 0.0, 0.0));
          float fy = blNoise(fineP + vec3(0.0, e, 0.0));
          float fz = blNoise(fineP + vec3(0.0, 0.0, e));
          grain += vec3(f0 - fx, f0 - fy, f0 - fz) * 0.45;
          objectNormal = normalize(objectNormal + grain * 0.07);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSeed = aSeed;
        vRow = aRow;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vSeed;
        varying float vRow;
        varying vec3 vWPos;
        uniform float uBurst;
        uniform float uSolid;
        uniform float uDissolve;
        uniform vec3 uCenter;
        uniform float uFrost;
        ${NOISE}
        float blRim(vec3 N, vec3 V) {
          return pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.8);
        }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uSolid < 0.999) {
          float sn = blNoise(vWPos * 2.35);
          if (sn > uSolid) discard;
        }
        if (uDissolve > 0.001) {
          float dn = blNoise(vWPos * 3.1 + vec3(0.0, uDissolve * 1.4, 0.0));
          if (dn < uDissolve) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float crown = smoothstep(3.55, 4.85, vRow);
        diffuseColor.rgb *= mix(vec3(0.94, 0.96, 0.98), vec3(1.03, 1.04, 1.05), vSeed);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.08, 1.09, 1.1), crown);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float grain = blNoise(vWPos * 24.0 + vSeed * 8.0);
        float crownRough = smoothstep(3.55, 4.85, vRow);
        roughnessFactor = clamp(0.34 + (grain - 0.5) * 0.08 + (vSeed - 0.5) * 0.03, 0.22, 0.58);
        roughnessFactor = mix(roughnessFactor, 0.14, crownRough);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 N = normalize(normal);
        vec3 V = normalize(vViewPosition);
        float rimE = blRim(N, V);
        float seam = pow(clamp(length(fwidth(N)) * 2.4, 0.0, 1.0), 3.2);
        vec3 Nw = inverseTransformDirection(N, viewMatrix);
        vec3 toCore = uCenter - vWPos;
        float coreDist = length(toCore);
        float inward = max(dot(Nw, toCore / max(coreDist, 0.001)), 0.0);
        float proximity = smoothstep(3.4, 0.35, coreDist);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.99, 1.0), rimE * 0.28 + seam * 0.45);
        roughnessFactor = mix(roughnessFactor, 0.16, clamp(rimE * 0.35 + seam, 0.0, 1.0));
        totalEmissiveRadiance += vec3(0.62, 0.74, 0.84) * uFrost * (0.4 + rimE * 0.8);
        totalEmissiveRadiance += vec3(1.2, 1.26, 1.32) * seam * (0.85 + uBurst * 0.2);
        totalEmissiveRadiance += vec3(0.72, 0.8, 0.9) * crown * 0.22;
        totalEmissiveRadiance += vec3(1.15, 1.2, 1.28) * inward * proximity * uBurst * 0.42;`,
      )
  }

  return { material, uniforms }
}
