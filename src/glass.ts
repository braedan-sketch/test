import {
  Color,
  CubeTexture,
  FrontSide,
  LinearFilter,
  NoColorSpace,
  ShaderMaterial,
  type Texture,
} from 'three'

let studio: CubeTexture | null = null

/**
 * Cool studio cube: dark walls and a few hard softboxes.
 * Facets that face a box go bright; the rest stay dark, which is what
 * makes the shard read as cut glass on SwiftShader.
 */
export function studioCubemap() {
  if (studio) return studio
  const size = 128
  const faces = [
    paintFace(size, '#1c2430', [
      [0.08, 0.12, 0.34, 0.22, '#f4f7ff'],
      [0.62, 0.55, 0.22, 0.16, '#9eb4c8'],
    ]),
    paintFace(size, '#121820', [[0.55, 0.18, 0.28, 0.2, '#d5e2ee']]),
    paintFace(size, '#dfe6ee', [[0.18, 0.14, 0.64, 0.46, '#ffffff']]),
    paintFace(size, '#0c1016', []),
    paintFace(size, '#24303c', [[0.2, 0.22, 0.42, 0.28, '#f7fbff']]),
    paintFace(size, '#182028', [[0.48, 0.58, 0.3, 0.18, '#c5d4e2']]),
  ]
  studio = new CubeTexture(faces)
  studio.colorSpace = NoColorSpace
  studio.magFilter = LinearFilter
  studio.minFilter = LinearFilter
  studio.needsUpdate = true
  return studio
}

function paintFace(size: number, wall: string, boxes: Array<[number, number, number, number, string]>) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, size, size)
  for (const [x, y, w, h, color] of boxes) {
    ctx.fillStyle = color
    ctx.fillRect(x * size, y * size, w * size, h * size)
  }
  return canvas
}

export type GlassKind = 'crystal' | 'rings'

/**
 * Reflection plus fake refraction. No transmission pass, so SwiftShader
 * still shows facets, dispersion, and a fresnel rim.
 */
export function createGlassMaterial(options: {
  normalMap: Texture | null
  roughnessMap: Texture | null
  kind: GlassKind
}) {
  const crystal = options.kind === 'crystal'
  const normalMap = options.normalMap
  const roughnessMap = options.roughnessMap
  if (normalMap) {
    normalMap.colorSpace = NoColorSpace
    normalMap.needsUpdate = true
  }
  if (roughnessMap) {
    roughnessMap.colorSpace = NoColorSpace
    roughnessMap.needsUpdate = true
  }
  const shared = {
    uEnv: { value: studioCubemap() },
    uNormalMap: { value: normalMap },
    uRoughnessMap: { value: roughnessMap },
    uHasNormal: { value: normalMap ? 1 : 0 },
    uHasRough: { value: roughnessMap ? 1 : 0 },
  }
  if (!crystal) {
    return new ShaderMaterial({
      name: 'ring-glass',
      side: FrontSide,
      fog: false,
      toneMapped: false,
      uniforms: {
        ...shared,
        uNormalScale: { value: 0.85 },
        uAbsorb: { value: new Color('#1a2836') },
        uCore: { value: new Color('#d7e6f2') },
        uFilm: { value: 0.9 },
        uIor: { value: 1.4 },
      },
      vertexShader: ringsVertex,
      fragmentShader: ringsFragment,
    })
  }
  return new ShaderMaterial({
    name: 'crystal-glass',
    side: FrontSide,
    fog: false,
    toneMapped: false,
    uniforms: {
      ...shared,
      // Tangent-space scale. Strong enough to chip a face, not to flip it.
      uNormalScale: { value: 0.72 },
      uAbsorb: { value: new Color().setRGB(0.02, 0.024, 0.03) },
      uCore: { value: new Color().setRGB(0.26, 0.3, 0.34) },
      uIor: { value: 1.31 },
    },
    vertexShader: crystalVertex,
    fragmentShader: crystalFragment,
  })
}

const ringsVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const ringsFragment = /* glsl */ `
      uniform samplerCube uEnv;
      uniform sampler2D uNormalMap;
      uniform sampler2D uRoughnessMap;
      uniform float uHasNormal;
      uniform float uHasRough;
      uniform float uNormalScale;
      uniform vec3 uAbsorb;
      uniform vec3 uCore;
      uniform float uFilm;
      uniform float uIor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;

      vec3 toLinear(vec3 c) {
        return pow(max(c, vec3(0.0)), vec3(2.2));
      }

      vec3 envSample(vec3 dir) {
        return toLinear(textureCube(uEnv, normalize(dir)).rgb);
      }

      vec3 perturb(vec3 n) {
        if (uHasNormal < 0.5) return n;
        vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
        mapN.xy *= uNormalScale;
        vec3 q0 = dFdx(vWorld);
        vec3 q1 = dFdy(vWorld);
        vec2 st0 = dFdx(vUv);
        vec2 st1 = dFdy(vUv);
        float det = st0.x * st1.y - st1.x * st0.y;
        vec3 t = normalize(q0 * st1.y - q1 * st0.y);
        if (det < 0.0) t = -t;
        vec3 b = normalize(cross(n, t));
        return normalize(mat3(t, b, n) * mapN);
      }

      void main() {
        vec3 n = perturb(normalize(vNormal));
        vec3 v = normalize(cameraPosition - vWorld);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 2.4);
        vec3 reflectDir = reflect(-v, n);

        float eta = 1.0 / uIor;
        vec3 refrR = refract(-v, n, eta * 1.04);
        vec3 refrG = refract(-v, n, eta);
        vec3 refrB = refract(-v, n, eta * 0.94);
        if (dot(refrR, refrR) < 0.001) refrR = reflectDir;
        if (dot(refrG, refrG) < 0.001) refrG = reflectDir;
        if (dot(refrB, refrB) < 0.001) refrB = reflectDir;
        vec3 refracted = vec3(envSample(refrR).r, envSample(refrG).g, envSample(refrB).b);
        vec3 reflected = envSample(reflectDir);

        float rough = 0.22;
        if (uHasRough > 0.5) rough = texture2D(uRoughnessMap, vUv).g;

        vec3 key = normalize(vec3(0.42, 0.86, 0.28));
        vec3 rimLight = normalize(vec3(-0.55, 0.25, 0.75));
        float gloss = mix(28.0, 140.0, 1.0 - rough);
        float spec = pow(max(dot(reflect(-key, n), v), 0.0), gloss);
        float spec2 = pow(max(dot(reflect(-rimLight, n), v), 0.0), 48.0);

        float film = ndv * 6.5 + n.y * 2.2 + n.x * 1.4;
        vec3 rainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.09, 4.18) + film);
        vec3 fringe = mix(vec3(1.0), rainbow, uFilm);

        vec3 body = mix(uAbsorb, uAbsorb * 2.4 + uCore * 0.18, ndv);
        vec3 color = body;
        color += refracted * mix(0.22, 0.55, ndv) * fringe;
        color = mix(color, reflected * (0.55 + 0.45 * fringe), fresnel * 0.92);
        color += uCore * (0.08 + ndv * 0.12) * uFilm;
        color += spec * vec3(1.15, 1.12, 1.05);
        color += spec2 * vec3(0.45, 0.62, 0.85) * (0.35 + fresnel);
        color += rainbow * fresnel * uFilm * 0.55;
        gl_FragColor = vec4(color, 1.0);
      }
`

// Smoky ice. The normal map is sampled raw (NoColorSpace) in the glTF tangent frame.
// Rainbow is a grazing fringe only — it never multiplies the body colour.
const crystalVertex = /* glsl */ `
  attribute vec4 tangent;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vHand;
  varying vec2 vUv;
  void main() {
    vObj = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vTangent = normalize(mat3(modelMatrix) * tangent.xyz);
    vHand = tangent.w;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const crystalFragment = /* glsl */ `
  uniform samplerCube uEnv;
  uniform sampler2D uNormalMap;
  uniform sampler2D uRoughnessMap;
  uniform float uHasNormal;
  uniform float uHasRough;
  uniform float uNormalScale;
  uniform vec3 uAbsorb;
  uniform vec3 uCore;
  uniform float uIor;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vHand;
  varying vec2 vUv;

  vec3 toLinear(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(2.2));
  }

  vec3 envGrey(vec3 dir) {
    vec3 c = toLinear(textureCube(uEnv, normalize(dir)).rgb);
    float l = dot(c, vec3(0.28, 0.54, 0.18));
    return vec3(l * 0.42, l * 0.46, l * 0.52);
  }

  float hash13(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  vec3 shadeNormal(vec3 n) {
    vec3 base = n;
    if (uHasNormal > 0.5) {
      vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
      mapN.xy *= uNormalScale;
      vec3 t = normalize(vTangent);
      vec3 b = normalize(cross(n, t) * vHand);
      base = normalize(mat3(t, b, n) * mapN);
    }
    // Extra planar chips so a face is not one flat shade.
    vec3 cell = floor(vObj * 8.0);
    float h1 = hash13(cell) - 0.5;
    float h2 = hash13(cell + vec3(19.0, 3.0, 7.0)) - 0.5;
    vec3 side = normalize(cross(base, abs(base.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 lift = cross(side, base);
    return normalize(base + side * h1 * 0.95 + lift * h2 * 0.95);
  }

  void main() {
    vec3 n = shadeNormal(normalize(vNormal));
    vec3 v = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 3.4);
    vec3 reflectDir = reflect(-v, n);

    float eta = 1.0 / uIor;
    vec3 refrR = refract(-v, n, eta * 1.004);
    vec3 refrG = refract(-v, n, eta);
    vec3 refrB = refract(-v, n, eta * 0.996);
    if (dot(refrR, refrR) < 0.001) refrR = reflectDir;
    if (dot(refrG, refrG) < 0.001) refrG = reflectDir;
    if (dot(refrB, refrB) < 0.001) refrB = reflectDir;
    vec3 split = vec3(envGrey(refrR).r, envGrey(refrG).g, envGrey(refrB).b);
    float splitL = dot(split, vec3(0.3, 0.5, 0.2));
    vec3 refracted = mix(vec3(splitL), split, 0.18);
    vec3 reflected = envGrey(reflectDir);

    float rough = 0.55;
    if (uHasRough > 0.5) rough = clamp(texture2D(uRoughnessMap, vUv).g, 0.0, 1.0);
    vec3 key = normalize(vec3(0.32, 0.9, 0.24));
    float gloss = mix(24.0, 120.0, 1.0 - rough * 0.55);
    float spec = pow(max(dot(reflect(-key, n), v), 0.0), gloss);

    float film = ndv * 11.0 + n.y * 2.4;
    vec3 rainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.189) + film);
    vec3 fringe = mix(vec3(dot(rainbow, vec3(0.333))), rainbow, 0.22);
    float grazing = smoothstep(0.55, 0.95, fresnel);

    float keyNd = clamp(dot(n, key), 0.0, 1.0);
    vec3 body = mix(uAbsorb, uCore, pow(keyNd, 0.6));
    vec3 color = body;
    color += refracted * keyNd * 0.05;
    color += reflected * fresnel * 0.2;
    color += spec * vec3(1.05, 1.1, 1.16);
    color += fringe * grazing * 0.06;
    float mx = max(color.r, max(color.g, color.b));
    float mn = min(color.r, min(color.g, color.b));
    float sat = (mx - mn) / max(mx, 0.0001);
    if (sat > 0.2) {
      float l = dot(color, vec3(0.3, 0.5, 0.2));
      color = mix(vec3(l), color, 0.2 / sat);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`
