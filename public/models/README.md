# BLENDY web assets: igloo v12, terrain v9, mountains v7, rings v5, crystal v4 (handoff_v10, 2026-10-26)

This replaces `handoff_v9/`. **mountains.glb is byte-identical to handoff_v9/v8**; the other four changed. All files are **Draco + KTX2** (Basis) with no meshopt. Node names and extras are unchanged, and all five pass `gltf-transform validate` with no errors.

Sources are in `~/Desktop/blendy/web_assets_v2/scripts/` on the Mac:
- Igloo: `igloo_layout12`, `igloo_build12`, `snowmat12`, `igloo_bake12`, `export12`, `compose_hero13`
- Terrain: `terrain_fix9`, `terrain_bake9`, `tex_lift9`, `glow_blur9`
- Crystal: `crystal_build4`, `crystal_fx4`, `crystalmat4`, `crystal_bake4`, `core_fit4`, `crystal_compose4`, `export_crystal4`
- Rings: `rings_build5`, `ringmat5`, `rings_bake5`, `rings_fx5`, `rings_compose5`, `export_rings5`
- Chains: `run_v12*.sh`
- Blends: `igloo_baked_v12`, `terrain_baked_v9`, `crystal_baked_v4b`, `rings_baked_v5`
- Maps: `tex/igloo12_*`, `ground9l_*`, `crystal4_*`, `rings5_*`

| file | size | contents |
|---|---|---|
| igloo.glb | 5.21 MB | `IGLOO` + 40 nodes `igloo_brick_000…039` (extras row/t/kind/bidx), ~78k tris |
| terrain.glb | 2.59 MB | GROUND + SKIRT: darker craggy rock mound under and in front of the igloo |
| mountains.glb | 3.29 MB | unchanged |
| rings.glb | 3.14 MB | `RINGS`: ring_outer (8), ring_inner (6), lattice (frosted disc), halo |
| crystal.glb | 2.82 MB | `CRYSTAL`: crystal_shell (~12k tris) + crystal_core (3 image cards) |

```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
```

## Shared conventions
- 1 unit = 1 m. glTF is +Y up. Load igloo, terrain and mountains with identity transforms and they line up: the igloo sits at the origin.
- Set the camera far plane to at least 1500 for the mountains.
- rings.glb and crystal.glb are their own scenes, each centred on its own origin. rings.glb is the portal section. Its axis is glTF **+Z**: the portal faces a camera placed on +Z, looking toward −Z. It is centred on its own origin.

## Igloo v12: irregular again, thinner seams, per-block tone
- Same node scheme (40 blocks; courses 11/10/9/7 + 3 cap). bbox x −1.97…2.07, y −0.19…2.37, z −2.08…1.90.
- **Irregularity:**
  - Block lengths vary 0.66–1.38× and depth/height ±12–20%.
  - Row jitter is back to roughly the v10 level.
  - ~40% of the top two courses are **tumbled, chunky, overhanging** blocks (pushed out 0.10–0.24 m, rotated 1.6× harder, kept chunky rather than slab-thin). The 3 cap blocks tilt up to ±24°.
  - The top leans sideways by 0.18 m.
- **Thinner glow frames:** the seam band now covers only the outer ~2.5–12% of each face (was ~5–20%), the bevel rim is thinner, and side-face glow is 0.45. They no longer read as screen bezels.
- **Per-block tone:** each block gets a tint between 0.78–0.95× and 1.12–1.16× per channel, plus large-scale tonal noise across each face. Each block's inner translucency brightness also varies, 0.2–1.5×.
- Suggested three.js values: `emissiveIntensity` ≈ 3.4, a low interior point light, bloom threshold 0.85 / strength 0.55.

## Terrain v9: darker craggy rock mound, calmer mid-distance
- The raised mound is kept from v8 (falls ~1.6 m within 8 m of the igloo).
- **Flank rocks:**
  - A broad craggy mass (ridged noise, sharpness 1.5, ~0.95 m) plus broken mid-scale crag faces and fine rubble, covering most of the mound and the foreground out to ~12 m.
  - A 9 cm low-pass within 16–22 m removes single-vertex spikes (no cones).
- Mid-distance rock ridges are reduced to ~60% height. The near-rock band now ends at 13–19 m instead of 22–29 m.
- **Material:**
  - Rock now starts on much gentler slopes (0.06 vs 0.16), using the darker rock palette.
  - The albedo is graded *darker* (0.80·c) rather than lifted.
  - Sparkle fixes are kept: no pointiness dots or glaze, fine bump at 12%, and a denoised spill map (`ground9l_glow.png`, Mac only).

## Rings v5: readable frosted disc, smooth worn stone, broad blue flares
Hierarchy, with names exactly as below:
```
RINGS
├─ ring_outer        (empty)  → ring_outer_00 … ring_outer_07   8 thick pillowy stone segments
├─ ring_inner        (empty)  → ring_inner_00 … ring_inner_05   one dominant thick C + 2 outer arcs + 1 small arc + 2 loose blocks
├─ lattice           (mesh)   frosted disc with an icy triangulated wireframe, r = 1.5 m
└─ halo              (mesh)   wide soft blue halo: annulus r 0.9–2.0 m, white-hot core at r 1.42, blue spill inward and onto the stone
```
- **Stone pieces:**
  - Every node's translation is the piece's centroid, with its mesh centred on the node, so `position` and `rotation` animate directly.
  - extras:
    - `group` (`ring_outer` | `ring_inner`);
    - `pidx`;
    - `arc` (0–3: which concentric ring; 9 = loose block);
    - `a0`, `a1`: start and end angle in radians, measured in the ring plane from glTF +X toward +Y;
    - `R`: mid-radius in metres.
  - The mid-angle (a0+a1)/2 gives a natural radial explode direction.
- **Dimensions:**
  - Outer ring: inner radius 1.41 m, outer radius 2.05 m, depth ≈ 0.56 m (front and back faces are slightly domed). There are thin seams between segments.
  - Inner pieces (glTF depth offset; + = toward the camera):

    | pieces | R (m) | width (m) | depth (m) | depth offset (m) |
    |---|---|---|---|---|
    | `ring_inner_00`, `_01`: two arcs, 100–150° and 22–74° | 1.08 | 0.24 | 0.30 | +0.45 |
    | `ring_inner_02`: the **dominant C**, 112–342° | 0.80 | 0.42 | 0.50 | −0.05 |
    | `ring_inner_03`: small arc, 170–290° | 0.42 | 0.15 | 0.22 | +0.40 |
    | `ring_inner_04`, `_05`: loose blocks | | | | |

- **v5 changes:**
  - The `lattice` disc now **clearly reads as frosted glass**: a milky body (alpha ≈ 0.40–0.75), soft frost patches and swirl, fine grain, ice-crystal cells, a brighter rim zone and a soft central glow. The lattice is a faint hint only.
  - **Smooth worn stone:** displacement is cut to roughly a third (0.010 / 0.0014 / 0.0012), with 3 smoothing passes at 0.5. The material is paler, with bump 0.22, little pitting and sparse frost speckle.
  - **Halo:** the wiry wisps are replaced by **broad blue flares**: 3–5 low-frequency angular lobes reaching 0.26–0.62 m in and out of the ring, ×1.45, blue (0.30, 0.58, 1.0), with only soft broad striation.
  - Background fog is preview-only (drifting fog bands on the camera backdrop in `rings_compose5`). On the web, use scene fog or a fog-card background.
  - Preview: HAL 7, LAT 1.4.
- **v4 changes (kept):**
  - The `lattice` node is now a **subtle frosted glass disc**: fine frost grain, soft frost patches, tiny ice-crystal cell walls and a faint thin triangulated lattice. Alpha is ≈0.14–0.5 (was ≈0.06 + wires).
  - Halo: the core is softer and dimmer (×0.6, wider falloff). **Blue wisps** (sheared ridged noise in angle/radius) stream in and out of the ring.
  - Inner arcs are thicker: outer arcs W 0.30 × D 0.38 at R 1.10; the dominant C is W 0.46 × D 0.56; the small arc is W 0.22 × D 0.30 at R 0.45. The loose blocks are 0.26 and 0.19. The `R` extras changed to match. The dimension table below is from v2/v3; use the node extras.
  - Suggested: lattice colour ×1.2–1.6 (additive), halo ×5–6. Preview: LAT 1.6, HAL 6.
- **v3 changes (kept):**
  - Some grit is back: displacement cl1 0.013 / cl2 0.0042 / vo 0.0045 with one lighter smoothing pass, bump 0.6, pitting and frost speckle back on, full cavity.
  - The halo soft term is reduced (0.55·e^(−d/0.20) + 0.16·e^(−d/0.5), was 0.75/0.3). The lattice lines are brighter and thicker (width 0.009) and its alpha is ~0.06 base + lines, so the triangulated wires read inside the halo.
  - Same pieces, names, extras and dimensions as v2.
- **Modelling (from v2):**
  - Smaller and fewer edge chips, and no face scoops.
  - Lower displacement, with heavier smoothing and a larger bevel (0.09 m) on the outer segments.
  - The stone material has less frost speckle, cavity blotching and pitting, and half the bump.
- **Material `ring_stone`:**
  - baseColor: cool blue-grey worn stone with frost speckle, lighter worn edges and dark chips (sRGB ETC1S).
  - normal: UASTC.
  - ORM: AO, roughness ≈ 0.7–0.9, metallic 0.
  - emissive (sRGB ETC1S):
    - faint icy crack lattice in patches over the stone;
    - a blue glow on the outer ring's inward-facing wall;
    - **v2: a blue halo spill** on the front face near the inner edge (r 1.40→1.85 m).
  - Use `emissiveIntensity` ≈ 1–1.5.
- **`lattice_fx` and `halo_fx`:** alphaMode BLEND, double-sided. The baseColor RGBA texture is the same image as the emissive (rgb = glow colour, a = coverage).
  - For the intended look, use `MeshBasicMaterial`/additive: `blending = THREE.AdditiveBlending`, `depthWrite = false`, map = the texture, colour × 6–8 for the halo and × 2–3 for the lattice (v3), then bloom.
  - The halo is placed in front of the outer ring's domed front face (glTF z ≈ +0.40). The lattice sits just behind the ring plane (z ≈ −0.25), so the inner arcs read in front of the frosted disc.
- **Preview** (`rings_compose3.py`):
  - camera at glTF (2.4, 1.9, 8.2), looking at the origin, 44 mm lens (≈ 29° vertical FOV at 16:10);
  - halo emission 7, lattice emission 2.8 (v3), exposure −0.5;
  - sun from the upper left;
  - dim fill: lighting world 0.18, camera-visible background 0.42;
  - 40 W core light;
  - bloom threshold 0.85, strength 0.95, size 0.7.

## Crystal v4
```
CRYSTAL
├─ crystal_shell   taller blocky-irregular crystal, ≈ 1.14 × 1.49 × 0.88 m (x, y-up, z), ~12k tris
└─ crystal_core    3 image cards: the middle one carries two soft penguin figures, front/back cards are thin smoke
```
- **Shape:** base box 0.98 × 0.80 × 1.40 (was 1.08 × 0.88 × 1.18), same clipped-corner hull, lean and skew.
- **Broken face:**
  - Same fracture plus 46 cleavage cuts.
  - Each cut's centre is snapped onto or just outside the surface, and cuts are applied one at a time. 2 cuts that broke the exact boolean were rejected.
  - So no cut is buried inside the glass, and **the dark sliver is gone**.
- **Dusky smoky blue-grey glass:**
  - baseColor 0.56–0.79 blue-grey, roughness 0.08–0.30.
  - `KHR_materials_volume`: attenuationColor (0.60, 0.68, 0.76), attenuationDistance 1.0 m, **thicknessFactor 1.556 m** (the measured 99th-percentile thickness of this shell), thicknessTexture = G of `crystal4_thickcloud`.
  - The Cycles preview adds a light volume scatter (density 0.3) for smoky depth; that isn't in the GLB. Fake it with `MeshPhysicalMaterial` roughness ≈ 0.15 + attenuation, or a custom shader using the R (cloud) channel.
- **`crystal_image`** (core):
  - Muted grey-brown palette (no orange).
  - Figures only on the middle card's tile, so they no longer double up.
  - The front/back cards are a thin smoky haze (alpha 0.3–0.55×).
  - Emissive ×0.65, double-sided, BLEND. Render before the shell or into the transmission target.
- Extras on `crystal_shell`: `thickness_max_m` 1.556, `cloud_max_m` 0.737.
- Preview: `ROT=(0.12,-0.1,0.75)`, 58 mm lens.

## Known limitations vs igloo.inc (blunt)
- **Igloo v12:**
  - Irregular and tumbled again with thinner seams; the silhouette and top are now in the right family.
  - Faces still read as one flat blue-grey material. Theirs vary from near-black to bright translucent ice with visible inner structure; ours vary only mildly.
  - Bottom courses are still too even and too horizontal.
- **Terrain v9:**
  - Darker rock and no spike cones, but the foreground reads as smooth rounded humps and blobs, not their textured, crusted crag.
  - From the hero camera, the igloo doesn't read as sitting *on top* of a mound; theirs is clearly perched.
  - The mid-distance is calmer but still busier than their soft fog-out.
- **Crystal v4:**
  - Taller and dusky blue-grey now, closer in tone.
  - The figures read only as faint soft grey shadows; theirs are a clearer, darker smoky picture.
  - The silhouette is still too clean and box-like with flat faces. Theirs is more jagged, with a deeper broken side.
  - A tiny bright speck remains on the top edge.
- **Rings v5:**
  - Smooth stone, a readable frosted disc and background fog are there.
  - The whole frame is now too bright and milky, with low contrast: the halo is a thick hot-white ring, and the stone washes out under it.
  - The broad blue flares barely show.
  - Their stone is darker and more defined, and their glow is thinner and bluer.
- No UI callouts (DOM).
