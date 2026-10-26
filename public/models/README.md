# BLENDY web assets: igloo v13, terrain v10, mountains v7, rings v6, crystal v5 (handoff_v11, 2026-10-26)

This replaces `handoff_v10/`. **mountains.glb is byte-identical to handoff_v10, v9 and v8.** The other four files changed. Every file is **Draco + KTX2** (Basis) with no meshopt. Node names and extras are unchanged, and all five pass `gltf-transform validate` with **0 errors**. The warnings are the usual KTX2/tangent notices (IMAGE_UNRECOGNIZED_FORMAT, VALUE_NOT_IN_LIST, MESH_PRIMITIVE_GENERATED_TANGENT_SPACE).

| file | size | contents |
|---|---|---|
| igloo.glb | 5.44 MB | `IGLOO` + 40 nodes `igloo_brick_000…039` (extras row/t/kind/bidx), 81.5k tris |
| terrain.glb | 2.68 MB | GROUND + SKIRT: deeper mound under the igloo, crusted rock crag in front, 87.9k tris |
| mountains.glb | 3.29 MB | unchanged |
| rings.glb | 3.21 MB | `RINGS` (19 nodes): ring_outer (8), ring_inner (6), lattice, halo. Same geometry as v5 |
| crystal.glb | 2.70 MB | `CRYSTAL`: crystal_shell (11.3k tris total) + crystal_core (3 image cards) |

Sources are in `~/Desktop/blendy/web_assets_v2/scripts/` on the Mac:
- Igloo: `igloo_layout13`, `igloo_build13`, `snowmat13`, `igloo_bake13`, `export13`, `compose_hero14`
- Terrain: `terrain_fix10`, `terrain_bake10`, `tex_lift10`, `glow_blur10`
- Crystal: `crystal_build5`, `crystal_fx5`, `crystal_bake5`, `core_fit5`, `crystal_compose5`, `export_crystal5`, plus `patch_thick13.py`
- Rings: `ringmat6`, `rings_bake6`, `rings_fx6`, `rings_compose6`, `export_rings6`
- Chains: `run_v13.sh`, `run_v13b.sh`, `run_v13c.sh`, `run_v13d.sh`. Pre-tweak copies are kept as `*_a.py` and `rings_fx6_b.py`
- Blends: `igloo_baked_v13`, `terrain_baked_v10`, `crystal_baked_v5b`, `rings_baked_v6`
- Maps: `tex/igloo13_*`, `ground10l_*`, `crystal5_*`, `rings6_*`
- Pack: `export/raw13` → `export/web13`


```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
```

## Shared conventions
- 1 unit = 1 m. glTF is +Y up. Load igloo, terrain and mountains with identity transforms and they line up: the igloo sits at the origin.
- Set the camera far plane to at least 1500 for the mountains.
- rings.glb and crystal.glb are their own scenes, each centred on its own origin. rings.glb is the portal section. Its axis is glTF **+Z**: the portal faces a camera placed on +Z, looking toward −Z. It is centred on its own origin.

## Igloo v13: tonal range, internal structure, uneven base
- Same 40 bricks and the same node names and extras. `igloo_meta_v13.json` is regenerated with the same schema.
- **Per-block tone:**
  - A v12 bug had disabled the per-block tint. It is fixed: a ramp on the per-block random value runs from near-black (0.10, 0.13, 0.19) through blue-grey (0.75, 0.80, 0.90) to bright ice (×1.45).
  - Each block also gets its own inner-glow brightness (0.05–1.65×).
- **Internal structure, baked into basecolor and emissive:**
  - Thin crack network: Voronoi edges, noise-masked so only some blocks crack.
  - Fine bubbles and frost veins, lighter than the base.
  - Cracks and veins glow faintly from inside, scaled by the block's brightness.
- **Bottom two courses:** more jitter (J 0.62), steps of ±0.13 m on the bottom course and ±0.09 m on the second, plus tilt.

## Terrain v10: perched mound, crusted crag
- The mound drops about 2.1 m from the igloo out to a radius of about 8 m. Ring means: 0.04 at r=1, −0.16 at r=2.5, −0.73 at r=4.5, −1.60 at r=6, −2.10 at r=8.
- The igloo now sits on a crown with falling ground around it.
- A crust layer goes on after the spike blur: ridged noise (0.38 m), fine fbm (0.16 m) and an abs-fbm crag (0.7 m), applied only on the rock mask and flanks. Result: textured crusted rock, not smooth humps.
- AO/basecolor were re-baked against the v13 igloo. The albedo lift is 0.78, and the glow is blurred to kill fireflies.
- The hero camera is lowered to look slightly up at the igloo: `CAMLOC=(-11.2,9.8,1.15) TGT=(0,0,0.95) LENS=62`.

## Rings v6: darker, thinner bluer halo, flares
- The geometry is the same as v5, so `rings_meta_v5.json` is still valid.
- **Stone:**
  - darker base (0.22, 0.25, 0.30)–(0.38, 0.41, 0.47)
  - cavity ×1.2
  - rim lift to (0.62, 0.65, 0.70)
  - bump 0.6 (was 0.32), so there is visible grain
- **Halo (`rings6_halo`):**
  - A thin core line about 0.03 m wide (was a thick white band), with much less soft bloom.
  - Bluer RGB.
  - Broad angular flare lobes reach inward over the gap (0.30–0.72 m) and barely onto the stone.
  - An earlier test that let them spill outward turned the whole outer ring blue, so that was rejected.
- Preview exposure is down: EXPO −0.95, HAL 5, LAT 1.2, bloom 0.55.

## Crystal v5
```
CRYSTAL
├─ crystal_shell   faceted irregular crystal, ≈ 1.03 × 1.49 × 0.83 m (x, y-up, z)
└─ crystal_core    3 image cards: the middle one carries the smoky figures, front/back cards are thin haze
```
- **Shape:**
  - 14 extra surface points, then a convex hull.
  - Then 9 random planar clips, which give more, smaller facets.
  - Then all 46 cleavage cuts (none rejected this time).
  - LOW is 10.7k faces.
- **Glass:**
  - `KHR_materials_volume`: attenuationColor (0.60, 0.68, 0.76), attenuationDistance 1.0 m, **thicknessFactor 1.4996 m**. That is the measured 99th-percentile thickness, written from `crystal_meta_v5.json`.
  - thicknessTexture = G of `crystal5_thickcloud`.
- **`crystal_image`:**
  - Darker, crisper figures (smoothstep 0.62–1.12, darkness 0.85).
  - Haze cards are lighter (alpha 0.16–0.32).
  - Alpha is forced to 0 within 4% of tile borders, which removes the edge speck from the core card.
  - Emissive ×0.65.
- Extras on `crystal_shell`: `thickness_max_m` 1.4996, `cloud_max_m` 0.7031.
- Preview: `ROT=(0.12,-0.1,0.75)`, 58 mm, bloom threshold 1.3, key 320 W.

## Review
- `review/sbs_01_hero_v10.jpg`, `sbs_03_crystal_v10.jpg`, `sbs_04_rings_v10.jpg`
- Plain renders: `hero_v21.jpg`, `crystal_v5.jpg`, `rings_v6.jpg`, in `progress/f13/`

## Known limitations vs igloo.inc (blunt)
- **Igloo v13:**
  - Real tonal range now: some blocks are near-black, some bright glowing ice. A clear step up.
  - The internal structure reads as a thin crack web. It is still more "crackle texture" than their deep refracted ice.
  - Bottom courses are better but still read mostly level from the hero camera. Theirs are chunkier and more broken.
  - Overall the igloo is brighter and whiter-glowing than theirs.
- **Terrain v10:**
  - The foreground is a crusted crag now, not blobs.
  - The igloo reads as sitting up on a raised ledge, but not as dramatically perched on a peak as theirs.
  - The mid-distance and background are still busier and lighter than their soft fog-out.
- **Crystal v5:**
  - The figures are a much clearer, darker smoky group of three.
  - The silhouette has more facets but is still too slab-like. Their deep jagged broken side is still missing.
  - A small bright refracted glint remains near the top centre, inside the glass at the fracture. The top-edge speck from v4 is softened but not completely gone.
  - The glass is clearer and bluer than their foggy, dirty interior.
- **Rings v6:**
  - Exposure is down, the stone is darker with grain, and the halo is a thin blue line. All three goals are met.
  - The broad flares show only as a faint blue glow across the gap. Theirs are brighter, wispier flares over the stone.
  - The stone still reads as soft clay/foam, not their crisp carved stone.
  - Our scene is darker and bluer than their pale frosted look overall.

## handoff_hero_v1 (baked hero, `?baked=1`)

Drop files in `public/models/hero/`. The page only reads them when the URL has `?baked=1`. Until the files exist, that flag keeps the realtime igloo and terrain.

Optional `hero.json` names the files. Without it, the loader probes the defaults. Paths are relative to this folder unless they start with `/`. Every map is KTX2.

```json
{
  "igloo": {
    "model": "igloo.glb",
    "light": "igloo_light.ktx2",
    "ao": "igloo_ao.ktx2",
    "seam": "igloo_seam.ktx2",
    "albedo": "igloo_albedo.ktx2",
    "lightIntensity": 1,
    "aoIntensity": 1
  },
  "terrain": {
    "light": "terrain_light.ktx2",
    "ao": "terrain_ao.ktx2",
    "albedo": "terrain_albedo.ktx2"
  }
}
```

- `light` is Cycles illuminance on UV2 (`TEXCOORD_1`). Linear. It replaces the sun, the hemisphere, and the environment on that material.
- `ao` is UV2, red channel, linear.
- `seam` is the emissive mask, UV0, linear. The realtime seam curve, burst fade, and bloom stay on top of it. Do not bake the glow into the lightmap and stop there.
- `albedo` is base color, UV0, sRGB. Leave it out when the lightmap is the only new bake. Do not also paint the lighting into the albedo if `light` is present.
- `model` is optional. An igloo override still needs one mesh per brick, translation only, and extras `row` / `t` / `kind` / `bidx`, so the blocks can separate. Identity transform, same as the current glb. Terrain stays in the same place as `/models/terrain.glb`.
- Channels default to UV2 for light and AO, UV0 for seam and albedo. `lightChannel`, `aoChannel`, `seamChannel`, and `albedoChannel` override them (`0`, `1`, or `2`).
