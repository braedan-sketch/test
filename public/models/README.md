# BLENDY web assets: igloo v11, terrain v8, mountains v7, rings v4, crystal v3 (handoff_v9, 2026-10-26)

This replaces `handoff_v8/`. **mountains.glb is byte-identical to handoff_v8**; the other four changed. All files use **Draco + KTX2** (Basis), with no meshopt. Node names and extras are unchanged, and all five pass `gltf-transform validate` with no errors.

Built in Blender 5.2.2 on the M2 Pro. Sources are in `~/Desktop/blendy/web_assets_v2/scripts/` on the Mac:
- Igloo: `igloo_layout11`, `igloo_build11`, `snowmat11`, `igloo_bake11`, `export11`, `compose_hero12`
- Terrain: `terrain_fix8`, `terrainmat5`, `terrain_bake8`, `tex_lift8`, `glow_blur`
- Crystal: `crystal_build3`, `crystal_fx3`, `crystalmat3`, `crystal_bake3`, `core_fit3`, `crystal_compose3`, `export_crystal3`
- Rings: `rings_build4`, `rings_bake4` (with `ringmat3`), `rings_fx4`, `rings_compose4`, `export_rings4`
- Chains: `run_v11*.sh`
- Blends: `igloo_baked_v11`, `terrain_baked_v8`, `crystal_baked_v3b`, `rings_baked_v4`
- Maps: `tex/igloo11_*`, `ground8l_*`, `crystal3_*`, `rings4_*`

| file | size | contents |
|---|---|---|
| igloo.glb | 5.32 MB | `IGLOO` + 40 nodes `igloo_brick_000…039` (extras row/t/kind/bidx), ~71.7k tris |
| terrain.glb | 2.84 MB | GROUND + SKIRT; the ground now has a raised mound under the igloo |
| mountains.glb | 3.29 MB | unchanged from handoff_v8 |
| rings.glb | 3.71 MB | `RINGS`: ring_outer (8), ring_inner (6), lattice (now a frosted disc), halo |
| crystal.glb | 2.48 MB | `CRYSTAL`: crystal_shell (~12k tris) + crystal_core (3 image cards) |

```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
```

## Shared conventions
- 1 unit = 1 m. glTF is +Y up. Load igloo, terrain and mountains with identity transforms and they line up: the igloo sits at the origin.
- Set the camera far plane to at least 1500 for the mountains.
- rings.glb and crystal.glb are their own scenes, each centred on its own origin. rings.glb is the portal section. Its axis is glTF **+Z**: the portal faces a camera placed on +Z, looking toward −Z. It is centred on its own origin.

## Igloo v11: darker translucent ice, crisp even seams, clean dome
- Same node scheme as v5–v10 (40 blocks; courses 11/10/9/7 + 3 cap).
- bbox: x −1.94…2.05, y −0.17…2.26, z −2.07…1.89.
- **Faces:**
  - Darker blue ice (≈0.40–0.73 linear), glossier (roughness ≈0.28–0.46).
  - Finer grain: displacement and bump about halved, with a finer noise scale.
- **Seams:**
  - The edge band is narrower and brighter, near-white (0.96, 0.98, 1.0).
  - The per-block directional weighting is now near-even (0.75–1.0 on every edge), so the glow runs through all seams.
- **Translucency look:** a wide glow fading in from each block's edges toward its centre, ×0.20 and tinted icy blue (0.62, 0.80, 1.0), packed into the emissive. There is no real subsurface scattering in the GLB.
- **Shape:**
  - The courses are no longer tumbled; only the 3 cap slabs are tilted.
  - Row jitter and the sideways lean of the top are both about halved, giving a cleaner dome.
- **Suggested three.js values:** `emissiveIntensity` ≈ 3.4. Keep the interior point light low (≈0.4× the v10 value), or the doorway gaps hot-spot. Bloom threshold 0.85, strength 0.55.
- Preview: EMIS 3.4, interior light 700 W, camera (−10.8, 9.5, 2.4) → (0, 0, 0.9), 70 mm, fog 0.008.

## Terrain v8: raised rocky snow mound
- The igloo pad (y ≈ +0.05) is now the top of a mound. Around the igloo the ground falls about 1.7 m between 0.2 m and 7 m from the footprint (about −1.6 m at r = 8 m), blending back to the natural terrain by about 11 m.
- Snow-covered rock ridges break out of the mound flanks, starting 0.6 m from the footprint and fading out by 6–10 m.
- **Sparkle removed:**
  - no pointiness speckle;
  - no glossy "glaze" patches;
  - the fine-grain bump is cut to 12%;
  - the baked igloo light-spill map (`ground8l_glow.png`, Mac only, not in the GLB) has its fireflies removed; the raw copy is `ground8l_glow_raw.png`.
- The ground albedo uses the same paler grade as v7 (`ground8l_`). The skirt and mountains are unchanged.

## Rings v4: frosted disc, softer wispy halo, thicker inner arcs
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

- **v4 changes:**
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

## Crystal v3
```
CRYSTAL
├─ crystal_shell   chunky blocky-irregular rock crystal, ≈ 1.23 × 1.27 × 0.96 m (x, y-up, z), ~12k tris
└─ crystal_core    3 bent image cards with the brown "penguins" picture, inside the shell
```
- **Shape:** the convex hull of a jittered box. 85% of its corners are clipped into 2–3 points, giving big uneven facets, plus 9 face points and a slight lean/skew. Bevel 0.065 m, 14 edge chips.
- **Broken face:** the big lower-front-right fracture, plus **46 small sharp cleavage cuts** snapped onto the surface. That gives a fine crystalline break instead of v2's hammered/crumb displacement. The hammer displacement is gone everywhere, and the fracture roughness is glassy (≈0.2–0.4).
- **`crystal_glass`:** transmission 1, IOR 1.5. `KHR_materials_volume` uses thickness = G of `crystal3_thickcloud`, **thicknessFactor = 1.455 m**. This is the measured 99th-percentile thickness of the final v3 shell; the earlier 1.357 figure came from the first v3 build. The R channel is inner-structure depth (1 = 0.695 m).
- **`crystal_image`** (core): a 1024² RGBA picture with a warm tan/brown palette, lighter areas, and soft-edged dark penguin-like figures with light bellies. Alpha ≈ 0.75 in the tile centres. Emissive ×0.5, double-sided, BLEND. Render it before the shell or into the transmission target, with `depthWrite = false`.
- Extras on `crystal_shell`: `thickness_max_m` 1.455, `cloud_max_m` 0.695.
- Preview: `ROT=(0.15,-0.1,0.75)`, 62 mm lens, 5.2 m away.

## Known limitations vs igloo.inc (blunt)
- **Igloo v11: overcorrected toward tidy.**
  - The seams now punch and glow evenly, but it reads as a neat textbook igloo with flat grey "screen" faces in thick glowing frames.
  - Theirs is lumpier, with varied block sizes, chunky tumbled and overhanging blocks, and faces that vary in tone and show inner structure.
  - Our faces are too uniform from block to block.
- **Terrain v8:**
  - The mound is there, but it's pale and smooth with small pointy spikes.
  - Theirs is a darker, craggier rocky mound filling the foreground.
  - Our foreground rocks read as spiky cones.
  - The mid-distance crags are still busy.
- **Crystal v3:**
  - Much closer: chunky and irregular, with a crystalline break and a picture inside.
  - Ours is now a bit too wide/squat, and its glass too clear and bright. Theirs is a dusky blue-grey with frosted, smoky depth.
  - The inner figures are warmer/oranger and double up through refraction. Theirs are muted and integrated into a smoky cloud.
  - A small dark internal sliver remains on the right face.
- **Rings v4:**
  - Thicker arcs and a softer, wispy halo are closer.
  - The frosted disc is so subtle it barely reads.
  - The stone is still too lumpy and grainy vs their smooth worn surface.
  - The wisps are fine and wiry rather than their broad blue flares.
  - No background fog streaks.
- No UI callouts on any asset (those are DOM).
