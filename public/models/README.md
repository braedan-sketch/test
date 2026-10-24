# BLENDY web assets: igloo v10, terrain v7, mountains v7, rings v3, crystal v2 (handoff_v8, 2026-10-23)

This replaces `handoff_v7/`. **All five files changed.** They all use **Draco + KTX2** (Basis). There is no meshopt anywhere. Node names and extras are the same as v7, so the igloo separation, rings explode and crystal code should work as is.

Built in Blender 5.2.2 on the M2 Pro. Sources are in `~/Desktop/blendy/web_assets_v2` on the Mac:
- Igloo: `scripts/igloo_layout10.py`, `igloo_build10.py`, `snowmat10.py`, `igloo_bake10.py`, `export10.py`, `compose_hero11.py`
- Terrain/mountains: `terrain_fix7.py`, `terrain_bake7.py`, `tex_lift.py` (paler/less-contrast grade), `export10.py` (terrain), `export10m.py` (mountains)
- Rings v3: `rings_build3.py`, `ringmat3.py`, `rings_bake3.py`, `rings_fx3.py`, `export_rings3.py`, `rings_compose3.py`
- Crystal v2: `crystal_build2.py`, `crystal_fx.py` (core image), `crystal_bake2.py`, `core_fit.py`, `crystal_compose2.py`, `export_crystal2.py`
- Compression: `tools/ktxdraco.sh`. The crystal also gets an ETC1S pass on `thicknessTexture` and a JSON patch of `thicknessFactor`.
- Blends: `igloo_baked_v10.blend`, `terrain_baked_v7.blend`, `rings_baked_v3.blend`, `crystal_baked_v2b.blend`. Raw maps are in `tex/` (`igloo10_*`, `ground7l_*`, `skirt7_*`, `mtn_*7_*`, `rings3_*`, `crystal2_*`).

| file | size | contents |
|---|---|---|
| igloo.glb | 5.44 MB | `IGLOO` root plus 40 block nodes `igloo_brick_000…039`, ~71.5k tris. KTX2 2048² (normal UASTC) |
| terrain.glb | 3.51 MB | GROUND + SKIRT. KTX2; ground normal WebP, skirt normal UASTC 1024 |
| mountains.glb | 3.29 MB | MOUNTAINS_NEAR/MID/FAR, paler grade, normals UASTC 1024 |
| rings.glb | 3.64 MB | `RINGS` root: ring_outer (8 segments), ring_inner (6 pieces), lattice, halo |
| crystal.glb | 4.65 MB | `CRYSTAL` root: crystal_shell (glass, ~8.1k tris) + crystal_core (3 image cards). KHR_materials_transmission + KHR_materials_volume |

All five pass `gltf-transform validate` with no errors.

```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
```

## Shared conventions
- 1 unit = 1 m. glTF is +Y up. Load igloo, terrain and mountains with identity transforms and they line up: the igloo sits at the origin.
- Set the camera far plane to at least 1500 for the mountains.
- rings.glb and crystal.glb are their own scenes, each centred on its own origin. rings.glb is the portal section. Its axis is glTF **+Z**: the portal faces a camera placed on +Z, looking toward −Z. It is centred on its own origin.

## Igloo v10: pale frosted ice, no grid, taller dome
- **Node structure is unchanged:**
  - `IGLOO` root with `igloo_brick_000…039` children.
  - Node translation = block centroid.
  - extras: row/t/kind/bidx.
  - Courses: 11 / 10 / 9 / 7 blocks + 3 cap blocks.
  - **bbox changed:** x −1.95…2.05, y −0.17…2.35 (was 2.08, so the dome is about 0.27 m taller), z −2.07…1.89. The footprint radius is unchanged (≈1.9 m), so terrain still lines up.
- **The grid pattern is gone.** It came from the UI wave bands in the snow material leaking into the emissive map. They have been removed.
- **Faces are pale frosted ice:**
  - baseColor is light blue-white (≈0.62–0.89 linear) with soft frost noise and a slightly bluer cavity.
  - roughness is 0.55–0.8.
  - The emissive carries a faint internal frost brightness (≈14% strength, noise-modulated) on top of the edge/gap glow, so no face goes near-black.
- **Glow:** the per-block directional weighting is kept from v9 (top edges lead, bottoms weak, uneven sides). The gap/edge emissive colour is now near-white (0.94, 0.97, 1.0) and the curve is lifted (`^0.85`), so gap light reads brighter and whiter.
- **Layout:** blocks are 0.98 × 0.58 m (was shorter), the dome is taller and rounder, and the rows have more jitter: random width 0.78–1.22 and up to ~1.2× phase jitter on the upper courses. The lopsided v8 transform and the v9 slabs are kept.
- **Suggested three.js values:** `emissiveIntensity` ≈ 3–3.4, interior point light at (0, 0.9, 0) ≈ 1.3× the v9 value, bloom threshold ≈ 0.85, strength ≈ 0.6. Fog: `FogExp2` with a pale blue-grey colour; the preview used Cycles volume density 0.008 (double v9). The Cycles preview used EMIS 3.4, interior light 2400 W, exposure −0.1.

## Terrain v7 + mountains v7: paler, softer
- Pad follows the v10 footprint (same radius). The near-field crags are lower: rough terrain keeps 75% height outside the smooth zone, and sparse ridges reach 45% height inside it.
- Ground re-baked against the v10 igloo (`tex/ground7_*`; the light-spill map `ground7l_glow.png` stays on the Mac, not in the GLB).
- **Grade (`tex_lift.py`): albedo lifted and contrast reduced**, `c' = lift + gain·c`: ground 0.14 + 0.86c, skirt 0.22 + 0.78c, mountains 0.26–0.30 + 0.70–0.74c. AO is floored at 0.70 (ground) up to 0.88 (far mountains), so distant crags stop reading as dark and contrasty.
- The mountains were re-exported only for the new maps; the geometry is unchanged from v5.

## Rings v3: worn stone grit, visible lattice
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

- **v3 changes (on top of v2):**
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

## Crystal v2
```
CRYSTAL
├─ crystal_shell   irregular chunky rock-crystal glass, ≈ 0.90 × 1.34 × 0.73 m (x, y-up, z), ~8.1k tris
└─ crystal_core    3 bent image cards (the brownish inner structure), fully inside the shell
```
- **Modelling:**
  - The silhouette is no longer a box: it is the convex hull of 22 jittered points, leaning and asymmetric, with facets merged at 4°.
  - Angle-limited bevel (0.065 m, 5 segments), 14 edge chips.
  - **One big broken face** at the lower front-right: a large fracture chunk with crumbly, gritty displacement. It is frosted and rough, as in their stop_029.
  - Baked from a 67k-face HIGH.
- **`crystal_glass`:** same as v1.
  - `KHR_materials_transmission`: transmission 1, IOR 1.5.
  - `KHR_materials_volume`: thicknessTexture = **G channel** of `crystal2_thickcloud`, **thicknessFactor = 0.887 m**, attenuation as v1.
  - normal UASTC 2048², ORM (R = AO, G = roughness; the fracture ≈ 0.6+), baseColor pale blue-grey with a frosted fracture.
  - R channel of thickcloud = inner-structure depth (1 = 0.617 m), for a custom shader.
- **`crystal_core` → material `crystal_image`:**
  - A 1024² RGBA texture: a warped-fbm brown palette (dark 0.08 → light 0.80) with lighter belly areas, a vague figure and frost streaks. Each card uses a 0.5 × 0.5 UV tile with a ragged alpha.
  - emissive = same texture × 0.35, double-sided, alphaMode BLEND.
  - The cards are pulled toward the centre per vertex (`core_fit.py`) so that every vertex is at least 7 cm inside the shell; nothing pokes through.
  - In three.js, render the cards before the shell, or into the transmission render target, so they show through the glass. `depthWrite = false`.
- **Preview** (`crystal_compose2.py`): camera 5.2 m, 62 mm lens, the same lights and sky as v1, thin film 260 nm (not in the GLB; add `iridescence` ≈ 0.4 in `MeshPhysicalMaterial`).
- Extras on `crystal_shell`: `thickness_max_m` 0.887, `cloud_max_m` 0.617.

## Known limitations (vs igloo.inc)
- **Igloo v10:**
  - Faces are now pale and the grid is gone, but they read as **packed snow or sugar cubes rather than translucent ice**. There is no real subsurface or refraction, and the surface grain is too coarse and fuzzy.
  - Their blocks are darker-faced with crisp, bright white seams; ours are bright everywhere, so the gap glow has less contrast.
  - The glow is strongest low in the centre (doorway gaps). Theirs runs evenly through all the seams.
  - The top courses look like a tumbled pile rather than a clean dome.
  - Their igloo sits on a raised rocky mound; ours sits on a flat smooth pad.
- **Terrain/mountains:** paler and fogged now, close in tone to theirs. The mid-distance crags are still slightly busier, and the near snow has fine sparkle speckle theirs doesn't.
- **Rings v3:**
  - The grit is back (it now reads as stone, not clay) and the lattice is visible.
  - The lattice reads as a scattered white wire net. Theirs is a subtle frosted disc.
  - Our halo is a harder, brighter white line; theirs is softer with wispy blue streaks.
  - Our inner arcs are thinner and less chunky. There is no background fog or wisps.
- **Crystal v2:**
  - The silhouette is irregular and the broken face is there.
  - Ours is more elongated and leaf-shaped than their chunkier block.
  - The inner structure reads as a warm brown haze, not the clearly image-like figure in theirs.
  - The fracture frosting is a coarse hammered texture rather than their fine crystalline break.
  - There are no UI callouts (those are DOM).
