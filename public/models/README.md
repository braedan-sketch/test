# BLENDY web assets: igloo, terrain, mountains (v3, 2026-10-23)

These were built in Blender 5.2.2 on the M2 Pro. Source files are in `~/Desktop/blendy/web_assets_v2` on the Mac: the scripts are in `scripts/*5.py` / `*3.py`, the blends are `igloo_baked_v5.blend` and `terrain_baked_v3.blend`, and the raw PNG maps are in `tex/`.

| file | size | geometry | textures |
|---|---|---|---|
| igloo.glb | 5.6 MB | Draco (KHR_draco_mesh_compression), 61 nodes, ~79k tris | KTX2 (KHR_texture_basisu), 2048² |
| terrain.glb | 3.9 MB | Draco, 2 nodes, ~88k tris | KTX2, plus one WebP (ground normal) |
| mountains.glb | 4.1 MB | meshopt (EXT_meshopt_compression + KHR_mesh_quantization), 3 nodes | KTX2 |

Loader setup for three.js GLTFLoader:
```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
loader.setMeshoptDecoder(MeshoptDecoder);   // mountains.glb only
```

## Units, axes and shared world space
- 1 unit = 1 metre. glTF is **+Y up**, right-handed. Blender Z-up was converted on export, so Blender −Y becomes glTF **+Z**.
- All three files share one world origin. Load them with identity transforms and they line up.
- **Igloo:** the dome centre sits at the origin. The dome base ring is at y = 0. Outer radius is ≈2.2 m and the dome top is at y ≈ 2.15 m.
  - The entrance tunnel points toward **+Z** (glTF) and reaches z ≈ 3.6 m.
  - The lowest bricks reach y ≈ −0.16 m, so they are seated in the snow.
- **Terrain (GROUND):** a 60 × 60 m patch centred on the origin, x and z in [−30, 30].
  - It forms a natural snow mound under the igloo. Inside the dome and tunnel footprint the surface is flat at y ≈ +0.07 m, with snow banked against the walls.
  - Outside the footprint it falls away smoothly: ≈ −0.1 m at r = 3.5 m, ≈ −0.6 m at r = 6 m and ≈ −1.1 m at r = 8 m. Past 8 m it becomes the natural drift terrain.
  - The old raised crater ring and its cut wedge are gone.
- **SKIRT:** a ring from r = 28 m to 85 m. It uses the same height function as GROUND and is tucked 4 cm under the GROUND edge, so there is no visible seam.
- **Mountains:** three rings centred on the origin.

  | ring | radius |
  |---|---|
  | MOUNTAINS_NEAR | 48–96 m |
  | MOUNTAINS_MID | 98–182 m |
  | MOUNTAINS_FAR | 195–335 m |

  Peaks reach roughly 20, 50 and 110 m. Set the camera far plane to at least 1500.
- Mountain node transforms carry meshopt quantization scale and offset, so don't reset them. Igloo and terrain use Draco and have no quantization in their node transforms.

## Igloo structure (separation animation)
- The root node is `IGLOO` (an empty at the origin). It has 61 child mesh nodes, one per block.
  - `igloo_brick_000` … `igloo_brick_044`: dome bricks in 4 courses. kind = `brick`, rows 0–3.
  - `igloo_brick_045`: the cap/keystone. kind = `key`, row 4.
  - `igloo_tunnel_000` … `_009`: snow arch blocks of the entrance tunnel. kind = `tunnel`.
  - `igloo_ice_000` … `_004`: the outer arch ring, made of clear ice blocks. kind = `ice`. This is a good place for a transmission/clearcoat material.
- **Node translation = block centroid** in world metres. Each mesh is centred on its own node, so you can animate `node.position` and `node.rotation` directly.
  - Separation direction: `dir = normalize(node.position - vec3(0, node.position.y*0.3, 0))`. Use it as is, or add a little upward drift.
- **glTF extras** (three.js `object.userData`):
  - `row`: int. Course index from the ground up: 0–3 for bricks, 4 for the cap. Tunnel and ice blocks use 0 = lower arch and 1 = upper arch.
  - `t`: float in 0–1, the build order around and up the dome (bricks and key). It is −1 for tunnel and ice. Use it to stagger the drift.
  - `kind`: `brick` | `key` | `tunnel` | `ice`.
  - `bidx`: int, a stable block id.
- All blocks share one material, `igloo_snow`, and one UV atlas.

## Texture maps
- **igloo_snow** (all 2048², baked from an ~890k-tri high-poly sculpt):
  - baseColor: dark grey packed-snow body (sRGB, ETC1S).
  - normal: tangent space, OpenGL/glTF convention (UASTC + zstd).
  - ORM (occlusionTexture + metallicRoughnessTexture): R = AO, G = roughness, B = metallic (always 0). ETC1S.
  - emissive: the rim glow on brick edges plus the bright seam glow between bricks (sRGB, ETC1S). emissiveFactor is 1.
    - For an igloo.inc-style glow, set `material.emissiveIntensity` to 2.5–4 and use bloom (UnrealBloomPass: threshold ≈ 0.8, strength ≈ 0.6–0.9, radius ≈ 0.4). Without bloom the rims read as white lines, not a glow.
- **ground:**
  - baseColor and ORM: 2048², ETC1S.
  - normal: 2048² **WebP**. UASTC was 5 MB for this map alone.
  - There is an optional extra igloo light-spill map at `~/Desktop/blendy/web_assets_v2/tex/ground3_glow.png` on the Mac. It isn't packed into the GLB; use it as an emissiveMap/lightMap at about 0.6 if you want the glow on the snow around the igloo.
- **skirt:** baseColor and ORM 2048×1024 ETC1S, normal 1024×512 UASTC.
- **mountains_near / mid / far:** baseColor, ORM and normal, all KTX2.

## Known limitations
- The tunnel and ice blocks are lower detail than the dome bricks.
- The cap is a single flattened slab.
- The close-up shows a few small dark bake slivers between bricks.
- The ground's AO and glow were baked against the previous (v3) igloo footprint. The footprint is the same size, but small contact-shadow offsets are possible.
