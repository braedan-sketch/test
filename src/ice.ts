import { Color, MeshStandardMaterial, ShaderMaterial, Vector3 } from 'three'
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

  const material = new MeshStandardMaterial({
    color: new Color('#d5dee6'),
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.22,
    emissive: new Color('#000000'),
    emissiveIntensity: 1,
  })
  void quality

  material.customProgramCacheKey = () => 'blendy-block-v14'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurst = uniforms.uBurst
    shader.uniforms.uSolid = uniforms.uSolid
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
        varying vec3 vGeoN;
        ${NOISE}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vGeoN = normalize(mat3(modelMatrix) * objectNormal);
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
          objectNormal = normalize(objectNormal + grain * 0.16);
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
        varying vec3 vGeoN;
        uniform float uBurst;
        uniform float uSolid;
        uniform float uDissolve;
        uniform vec3 uCenter;
        ${NOISE}`,
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
        float chip = blNoise(vWPos * 8.0 + vSeed * 4.0);
        float pit = smoothstep(0.58, 0.16, chip);
        diffuseColor.rgb *= mix(vec3(0.9, 0.93, 0.96), vec3(1.04, 1.05, 1.06), chip);
        diffuseColor.rgb *= mix(1.0, 0.9, pit);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = 0.74;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += vec3(0.45, 0.55, 0.65) * rim * (0.55 + uBurst * 0.25);`,
      )
      .replace(
        'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
        'vec3 totalSpecular = vec3(0.0);',
      )
  }

  return { material, uniforms }
}

/** Milky ice for the tunnel slabs. Opaque, so it sorts with the bricks. */
export function createIceSlabMaterial(uniforms: BlockUniforms) {
  return new ShaderMaterial({
    fog: false,
    toneMapped: true,
    uniforms: {
      uSolid: uniforms.uSolid,
      uDissolve: uniforms.uDissolve,
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying float vSeed;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vSeed = aSeed;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      uniform float uSolid;
      uniform float uDissolve;
      void main() {
        if (uSolid < 0.04 && uDissolve < 0.2) discard;
        if (uSolid < 0.999 && vSeed > uSolid) discard;
        if (uDissolve > 0.001 && vSeed < uDissolve) discard;
        vec3 n = normalize(vNormalW);
        vec3 viewDir = cameraPosition - vWorld;
        float vLen = length(viewDir);
        vec3 v = vLen > 1e-5 ? viewDir / vLen : vec3(0.0, 0.0, 1.0);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 2.4);
        float grit = fract(sin(dot(vWorld.xyz, vec3(17.1, 39.4, 9.2))) * 43758.5);
        float vein = smoothstep(0.42, 0.7, fract(sin(dot(floor(vWorld * 6.5), vec3(12.9, 78.2, 45.1))) * 12543.2));
        vec3 deep = vec3(0.5, 0.58, 0.66);
        vec3 milk = vec3(0.78, 0.84, 0.89);
        vec3 color = mix(deep, milk, pow(ndv, 0.4));
        color *= 0.92 + grit * 0.1;
        color = mix(color, vec3(0.86, 0.92, 0.97), vein * 0.22);
        color += vec3(0.75, 0.88, 1.0) * rim * 0.5;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
}
