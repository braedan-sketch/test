import {
  Color,
  MeshPhysicalMaterial,
  Vector3,
  type MeshPhysicalMaterialParameters,
} from 'three'
import type { Quality } from './quality'

const NOISE = /* glsl */ `
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
  uDissolve: { value: number }
  uCenter: { value: Vector3 }
}

export function createBlockMaterial(quality: Quality) {
  const uniforms: BlockUniforms = {
    uBurst: { value: 0 },
    uDissolve: { value: 0 },
    uCenter: { value: new Vector3() },
  }

  const material = new MeshPhysicalMaterial({
    color: new Color('#8fa0ad'),
    roughness: 0.58,
    metalness: 0,
    transmission: quality.blockTransmission ? 0.14 : 0,
    thickness: quality.blockTransmission ? 0.7 : 0,
    ior: 1.31,
    attenuationColor: new Color('#93a8b8'),
    attenuationDistance: 0.32,
    clearcoat: 0.28,
    clearcoatRoughness: 0.4,
    sheen: 0.12,
    sheenColor: new Color('#f4f7fa'),
    sheenRoughness: 0.8,
    envMapIntensity: 0.38,
    emissive: new Color('#000000'),
    emissiveIntensity: 1,
  })

  material.customProgramCacheKey = () => 'blendy-block-v1'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurst = uniforms.uBurst
    shader.uniforms.uDissolve = uniforms.uDissolve
    shader.uniforms.uCenter = uniforms.uCenter

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
          vec3 np = position * 3.2 + vec3(aSeed * 5.0);
          float h0 = blNoise(np);
          float hx = blNoise(np + vec3(0.16, 0.0, 0.0));
          float hy = blNoise(np + vec3(0.0, 0.16, 0.0));
          float hz = blNoise(np + vec3(0.0, 0.0, 0.16));
          objectNormal = normalize(objectNormal + vec3(h0 - hx, h0 - hy, h0 - hz) * 1.15);
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
        uniform float uDissolve;
        uniform vec3 uCenter;
        ${NOISE}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uDissolve > 0.001) {
          float dn = blNoise(vWPos * 1.55 + vec3(0.0, uDissolve * 2.4, 0.0));
          if (dn < uDissolve) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float crown = smoothstep(3.15, 5.0, vRow);
        diffuseColor.rgb *= mix(vec3(0.9, 0.93, 0.96), vec3(1.03, 1.04, 1.05), vSeed);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0), crown * 0.82);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float nR = blNoise(vWPos * 2.6 + vSeed * 6.0);
        roughnessFactor = clamp(roughnessFactor * (0.72 + nR * 0.58) + (vSeed - 0.5) * 0.16, 0.14, 0.92);
        roughnessFactor = mix(roughnessFactor, 0.18, crown);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 N = normalize(normal);
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.35);
        float crease = smoothstep(0.02, 0.28, length(fwidth(N)));
        float crack = smoothstep(0.055, 0.0, abs(blNoise(vWPos * 6.0) - 0.52));
        float inner = smoothstep(2.5, 0.25, length(vWPos - uCenter));
        vec3 ice = vec3(0.78, 0.88, 1.0);
        totalEmissiveRadiance += ice * fres * (0.42 + crown * 1.15);
        totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * crease * 0.85;
        totalEmissiveRadiance += ice * crack * 0.22;
        totalEmissiveRadiance += vec3(1.15) * crown * (0.22 + uBurst * 0.85);
        totalEmissiveRadiance += ice * inner * (0.02 + uBurst * 0.28);`,
      )
  }

  return { material, uniforms }
}

export type LatticeUniforms = {
  uReveal: { value: number }
}

function latticeParameters(kind: 'ring' | 'crystal'): MeshPhysicalMaterialParameters {
  if (kind === 'crystal') {
    return {
      color: new Color('#e7eef4'),
      roughness: 0.07,
      metalness: 0,
      transmission: 0.94,
      thickness: 1.7,
      ior: 1.49,
      dispersion: 0.22,
      attenuationColor: new Color('#c5d5e2'),
      attenuationDistance: 2.4,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.15,
      emissive: new Color('#000000'),
      emissiveIntensity: 1,
    }
  }
  return {
    color: new Color('#d7e0e7'),
    roughness: 0.3,
    metalness: 0,
    transmission: 0.48,
    thickness: 0.35,
    ior: 1.31,
    attenuationColor: new Color('#b7c8d4'),
    attenuationDistance: 0.8,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.8,
    emissive: new Color('#000000'),
    emissiveIntensity: 1,
  }
}

export function createLatticeMaterial(kind: 'ring' | 'crystal', uniforms: LatticeUniforms) {
  const material = new MeshPhysicalMaterial(latticeParameters(kind))
  material.customProgramCacheKey = () => `blendy-${kind}-v1`
  const rim = kind === 'crystal' ? 0.45 : 0.7
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.uReveal
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        ${NOISE}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          vec3 np = position * 2.4;
          float h0 = blNoise(np);
          float hx = blNoise(np + vec3(0.2, 0.0, 0.0));
          float hy = blNoise(np + vec3(0.0, 0.2, 0.0));
          objectNormal = normalize(objectNormal + vec3(h0 - hx, h0 - hy, 0.0) * 0.45);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        uniform float uReveal;
        ${NOISE}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uReveal < 0.999) {
          float rn = blNoise(vWPos * 1.45);
          if (rn > uReveal) discard;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (blNoise(vWPos * 3.0) - 0.5) * 0.22, 0.04, 0.9);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 N = normalize(normal);
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += vec3(0.8, 0.9, 1.0) * fres * ${rim.toFixed(2)};`,
      )
  }
  return material
}
