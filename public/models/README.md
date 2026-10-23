# BLENDY web assets: igloo v7, terrain v5, mountains v5 (handoff_v5, 2026-10-23)

This replaces `handoff_v4/`. The node structure and extras are the same as v5 and v6: one node per block under `IGLOO`, centred positions, and extras row/t/kind/bidx. v7 has 37 blocks and **no tunnel**, so there are no `tunnel` or `ice` kinds.

These were built in Blender 5.2.2 on the M2 Pro. Source files are in `~/Desktop/blendy/web_assets_v2` on the Mac: the scripts are `igloo_layout7/igloo_build7/igloo_bake7/snowmat7.py`, `terrain_fix5/terrain_bake5.py`, `skirt_ao_fix.py`, `mtn_ao_fix.py`, `compose_hero8.py`, `export7.py` and `export7m.py`, the blends are `igloo_baked_v7.blend` and `terrain_baked_v5.blend`, and the raw PNG maps are in `tex/`.

| file | size | geometry | textures |
|---|---|---|---|
| igloo.glb | 5.6 MB | Draco (KHR_draco_mesh_compression), 37 block nodes + root, ~71k tris | KTX2 (KHR_texture_basisu), 2048² |
| terrain.glb | 4.0 MB | Draco, 2 nodes, ~88k tris | KTX2, plus one WebP (ground normal) |
| mountains.glb | 3.1 MB | Draco, 3 nodes (now Draco like the others; no meshopt) | KTX2 ETC1S, 2048×1024 (normals included) |

Loader setup for three.js GLTFLoader:
```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
// No MeshoptDecoder is needed any more: all three files use Draco.
```

## Units, axes and shared world space
- 1 unit = 1 metre. glTF is **+Y up**, right-handed. Blender Z-up was converted on export, so Blender −Y becomes glTF **+Z**.
- All three files share one world origin. Load them with identity transforms and they line up.
- **Igloo v7:** the dome centre sits at the origin. The dome base ring is at y = 0.
  - The dome is compact and rounded: outer radius ≈1.75 m, cap top at y ≈ 2.35 m, bbox x and z ≈ ±1.82 m.
  - There is no entrance tunnel.
  - The lowest blocks reach y ≈ −0.13 m, so they are seated in the snow.
- **Terrain (GROUND):** a 60 × 60 m patch centred on the origin, x and z in [−30, 30].
  - It forms a natural snow mound under the igloo. Inside the dome footprint (r < 1.85 m) the surface is flat at y ≈ +0.07 m, with snow banked against the walls.
  - Outside the footprint it falls away smoothly: ≈ −0.1 m at r = 3.5 m, ≈ −0.6 m at r = 6 m and ≈ −1.1 m at r = 8 m. Past 8 m it becomes the natural drift terrain.
  - The old raised crater ring and its cut wedge are gone.
  - **v5 is rough and dark right up to the igloo.** Dark ridged rock outcrops start 0.25 m outside the 1.85 m footprint, including on the mound slope, and reach full strength by about 6 m out.
    - They are up to ≈1.5 m high, with two extra layers of fine rough detail, and fade out by r ≈ 29 m.
    - The surface is darker snow with a near-black rock colour.
    - Only the flat pad under the igloo stays smooth.
  - The ground AO and the igloo snow-glow map (now brighter, from a 1500 W interior light) were re-baked against the v7 footprint.
    - Strictly, the bake used the first v7 pass, Rx 1.72 m; the final dome is Rx 1.75 m. That's a 3 cm difference, not visible.
- **SKIRT:** a ring from r = 28 m to 85 m. It uses the same height function as GROUND and is tucked 4 cm under the GROUND edge, so there is no visible seam.
- **Mountains:** three rings centred on the origin.

  | ring | radius |
  |---|---|
  | MOUNTAINS_NEAR | 48–96 m |
  | MOUNTAINS_MID | 98–182 m |
  | MOUNTAINS_FAR | 195–335 m |

  Peaks reach roughly 20, 50 and 110 m. Set the camera far plane to at least 1500.
- All three files use Draco, so no node transform carries quantization scale or offset. (The old v2 mountains.glb did, because it used meshopt.)

## Igloo structure (separation animation)
- The root node is `IGLOO` (an empty at the origin). It has 37 child mesh nodes, one per block:
  - `igloo_brick_000` … `igloo_brick_033`: 34 large, slightly rounded slabs, wider than tall (≈1.0 × 0.5 × 0.52 m, narrower near the top). kind = `brick`, rows 0–3, with 10/9/8/7 blocks per course.
    - Rows 0–1 are orderly and horizontal, with modest gaps.
    - Rows 2–3 are progressively more offset and tilted, with wider gaps.
    - About half the blocks in the top two courses are pushed out by 15–32 cm and tumbled.
  - `igloo_brick_034` … `igloo_brick_036`: the cap, 3 tumbled blocks. kind = `key`, row 4.
- **Node translation = block centroid** in world metres. Each mesh is centred on its own node, so you can animate `node.position` and `node.rotation` directly.
  - Separation direction: `dir = normalize(node.position - vec3(0, node.position.y*0.3, 0))`.
- **glTF extras** (three.js `object.userData`):
  - `row`: int. Course index from the ground up: 0–3 for bricks, 4 for the cap.
  - `t`: float in 0–1, the build order around and up the dome.
  - `kind`: `brick` | `key`.
  - `bidx`: int, a stable block id.
- All blocks share one material, `igloo_snow`, and one UV atlas.

## Texture maps
- **igloo_snow** (all 2048², baked from an ~890k-tri high-poly sculpt):
  - baseColor: dark grey packed-snow body (sRGB, ETC1S).
  - normal: tangent space, OpenGL/glTF convention (UASTC + zstd).
  - ORM (occlusionTexture + metallicRoughnessTexture): R = AO, G = roughness, B = metallic (always 0). ETC1S.
  - emissive (sRGB, ETC1S; emissiveFactor is 1) is much brighter and wider than v6:
    - a wide rim on every block edge;
    - **every face that isn't the block's outward face is fully lit**: sides, tops, bottoms and inner faces, i.e. everything you see through the gaps. The glow bleeds between blocks as if lit from inside;
    - seam glow;
    - a very faint line pattern on about 15% of blocks.
    - The Cycles preview used emission 3.2 and Glare/Bloom threshold 0.9, strength 0.6, size 0.55. That preview is too hot next to igloo.inc. The site sets `emissiveIntensity` to 2, tints the emissive cool (`0.86, 0.93, 1`), and keeps bloom subtle (threshold 0.88, hero strength about 0.32) so the slab faces stay matte grey and the cap is not blown out. A cool point light at (0, 0.9, 0) lights the gaps.
- **ground (v5: dark snow, near-black rock up to the igloo):**
  - baseColor and ORM: 2048², ETC1S.
  - normal: 2048² **WebP**. UASTC was 5 MB for this map alone.
  - There is an optional extra igloo light-spill map at `~/Desktop/blendy/web_assets_v2/tex/ground5_glow.png` on the Mac. It isn't packed into the GLB; use it as an emissiveMap/lightMap at about 0.6 if you want the glow on the snow around the igloo.
- **skirt:** baseColor and ORM 2048×1024 ETC1S, normal 1024×512 UASTC.
  - v5 floors the skirt AO at 0.72. That AO had been baked with the mountains covering it, so it was almost black (AO = 0) wherever the mountains sit over the skirt. The thin dark triangle seen in v6 renders, at world ≈ (41.5, 0.3, 41.0) in glTF terms, was that near-black skirt AO showing through where the MOUNTAINS_NEAR base dips just under the skirt.
- **mountains_near / mid / far:** baseColor, ORM and normal, all KTX2 ETC1S at 2048×1024. The normals are ETC1S here, not UASTC 1024×512 as in v2. That's fine at mountain distance, but re-encode them as UASTC if you see banding.
  - v5 floors the MOUNTAINS_NEAR AO at 0.85 (`mtn_ao_fix.py`, maps `tex/mtn_near5_*`). Its base had been AO-baked as near-black where it sits under the skirt, and that edge was the main source of the dark triangle outline.

## Known limitations
- **Mountain artefact:** fixed in the textures, in two places. terrain.glb floors the skirt AO at 0.72, and mountains.glb (re-exported in v5) floors the MOUNTAINS_NEAR AO at 0.85. The geometry is unchanged.
  - In the hero render the dark triangle outline is gone. A couple of very thin dark slits remain on one right-hand mid-distance ridge; they're barely visible at 1440×900.
  - I tried two geometric fixes, pushing the mountain base under the skirt and lifting it, and rejected both: one exposed a hollow, the other made it worse. They're kept on the Mac as `mtn_fix7.py` / `mtn_fix7b.py` and `terrain_baked_v5mtn*.blend`.
- The overall silhouette is still wider than tall (≈3.6 m wide × 2.35 m tall). A dome on the ground can only look taller than wide from a low camera.
- The tops of the cap and tumbled blocks glow very strongly, because their faces don't point outward. That reads a little blown out at the very top.
