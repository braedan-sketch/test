# BLENDY web assets: igloo v8, terrain v6, mountains v5, rings v1 (handoff_v6, 2026-10-23)

This replaces `handoff_v5/`. All four files use **Draco + KTX2** (Basis). There is no meshopt anywhere, so no node transform carries quantization.

Built in Blender 5.2.2 on the M2 Pro. Sources are in `~/Desktop/blendy/web_assets_v2` on the Mac:
- Igloo: `scripts/igloo_layout8.py`, `igloo_build8.py`, `snowmat8.py`, `igloo_bake8.py`
- Terrain: `terrain_fix6.py`, `terrain_bake6.py`
- Rings: `rings_build.py`, `ringmat.py`, `rings_bake.py`, `rings_fx.py`, `rings_fxmesh.py`, `export_rings.py`
- Export and preview: `export8.py`, `compose_hero9.py`, `rings_compose.py`
- Compression: `tools/ktxdraco.sh`
- Blends: `igloo_baked_v8.blend`, `terrain_baked_v6.blend`, `rings_baked_v1.blend`. Raw maps are in `tex/` (`igloo8_*`, `ground6_*`, `rings1_*`).

| file | size | contents |
|---|---|---|
| igloo.glb | 5.6 MB | `IGLOO` root plus 40 block nodes, ~76k tris. KTX2 2048² (normal UASTC) |
| terrain.glb | 3.9 MB | GROUND + SKIRT. KTX2, with the ground normal as WebP 2048², skirt normal UASTC 1024×512 |
| mountains.glb | 3.1 MB | unchanged from handoff_v5 (MOUNTAINS_NEAR/MID/FAR) |
| rings.glb | 3.8 MB | `RINGS` root: ring_outer (8 segments), ring_inner (11 pieces), lattice, halo. Stone normal UASTC 1024² |

A 7.0 MB variant of rings.glb with a 2048² stone normal is on the Mac at `export/web8/rings_n2048.glb`, if close-ups need it.

```js
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
```

## Shared conventions
- 1 unit = 1 m. glTF is +Y up. Load igloo, terrain and mountains with identity transforms and they line up: the igloo sits at the origin.
- Set the camera far plane to at least 1500 for the mountains.
- rings.glb is its own scene, a separate portal section. Its axis is glTF **+Z**: the portal faces a camera placed on +Z, looking toward −Z. It is centred on its own origin.

## Igloo v8: lower, wider, lopsided, calmer glow
- **Node structure is the same as v5–v7.**
  - `IGLOO` root, with one child per block: `igloo_brick_000…039`.
  - Node translation = block centroid. Each mesh is centred on its node.
  - extras: `row` (0–3 courses, 4 = cap), `t` (0–1 build order), `kind` (`brick` | `key`), `bidx`.
  - Courses hold 11 / 10 / 9 / 7 blocks, plus 3 cap blocks.
- **Shape:**
  - bbox x −1.96…2.10, y −0.15…2.13, z −2.10…1.95. That's ≈ 4.05 m wide × 2.3 m tall (≈1.75:1 by bbox; it reads ≈1.5:1 from the hero camera).
  - Lopsided:
    - the base bulges 6.5% on one side;
    - the courses slump up to 8% on the other side;
    - the upper courses shear about 24 cm sideways.
  - The upper courses are tilted and offset less than in v7. About a third of the top-two-course blocks are pushed out 8–20 cm.
- **Material:**
  - Matte mid-grey faces: albedo ≈ 0.30–0.50, roughness ≈ 0.78–0.95, softer grain bump.
  - The emissive is redistributed:
    - outward faces: 0;
    - side, top and bottom faces: **≈35%**;
    - **full strength** on block edges (rim band), inward-facing faces and seams/gaps.
  - Suggested three.js values: `emissiveIntensity` ≈ 2, UnrealBloom threshold ≈ 0.85, strength ≈ 0.5, radius ≈ 0.55, plus a point light inside the dome at (0, 0.9, 0) at modest intensity. These match the Cycles preview: EMIS 2.0, interior light 1200 W, AgX Medium High Contrast, exposure −0.25.
  - The site keeps intensity near 1.4 and masks the emissive toward the full-strength gaps, with the cap clamped, because the uniform border still reads as a picture frame at the Cycles settings. Hero bloom stays under strength 0.2 and threshold 0.92.

## Terrain v6: smooth snow mound near the camera
- The flat pad follows the v8 lopsided footprint. Inside it, y ≈ +0.05.
- Within about 14 m of the igloo, the ground is low-passed (σ ≈ 0.9 m) into a smooth snow mound. It blends back to rough terrain between 14 and 20 m.
- Inside the smooth zone, only a few sparse rocky ridges remain: about 7% of the area, at 55% height.
- Rough, dark outcrops continue in the mid-distance as before.
- Ground AO and the igloo light-spill map (`tex/ground6_glow.png` on the Mac; not in the GLB) were re-baked against the **final v8 footprint**. The bottom two courses are identical in the final build.
- The skirt keeps v5 maps (`skirt5_`, AO floored at 0.72).

## Rings v1 (new)
Hierarchy, with names exactly as below:
```
RINGS
├─ ring_outer        (empty)  → ring_outer_00 … ring_outer_07   8 thick pillowy stone segments
├─ ring_inner        (empty)  → ring_inner_00 … ring_inner_10   broken concentric C-arcs + 3 loose blocks
├─ lattice           (mesh)   frosted disc with an icy triangulated wireframe, r = 1.5 m
└─ halo              (mesh)   glowing annulus at the outer ring's inner edge, r 1.1–1.85 m
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
  - Inner arcs:

    | R | width (m) | depth (m) | depth offset from ring plane (m) |
    |---|---|---|---|
    | 1.08 | 0.24 | 0.30 | 0.45 |
    | 0.80 | 0.34 | 0.42 | 0.10 behind |
    | 0.55 | 0.19 | 0.26 | 0.70 |
    | 0.34 | 0.15 | 0.24 | 0.35 |

    Depth offsets without "behind" are toward the camera. The staggering is there for parallax.
- **Modelling:** real boolean chips on edges and corners, worn scoops on the faces, a bevelled and domed cross-section, and noise displacement. Baked from a ~340k-quad remeshed sculpt to ~47k render tris (31k verts).
- **Material `ring_stone`:**
  - baseColor: cool blue-grey worn stone with frost speckle, lighter worn edges and dark chips (sRGB ETC1S).
  - normal: UASTC.
  - ORM: AO, roughness ≈ 0.7–0.9, metallic 0.
  - emissive (sRGB ETC1S):
    - faint icy crack lattice in patches over the stone;
    - a glow on the outer ring's inward-facing wall (lit by the portal);
    - a soft edge rim.
  - Use `emissiveIntensity` ≈ 1–1.5.
- **`lattice_fx` and `halo_fx`:** alphaMode BLEND, double-sided. The baseColor RGBA texture is the same image as the emissive (rgb = glow colour, a = coverage).
  - For the intended look, use `MeshBasicMaterial`/additive: `blending = THREE.AdditiveBlending`, `depthWrite = false`, map = the texture, colour × 6–9 for the halo and × 1–1.6 for the lattice, then bloom.
  - The halo is placed just in front of the outer ring's front face (glTF z ≈ +0.31). The lattice sits just behind the ring plane (z ≈ −0.25), so the inner arcs read in front of the frosted disc.
- **Preview** (`rings_compose.py`):
  - camera at glTF (2.4, 1.9, 8.2), looking at the origin, 44 mm lens (≈ 29° vertical FOV at 16:10);
  - halo emission 9, lattice emission 1.6;
  - sun from the upper left;
  - dim fill: lighting world 0.18, camera-visible background 0.42;
  - 40 W core light;
  - bloom threshold 0.85, strength 1.0, size 0.7.

## Known limitations
- **Igloo:**
  - The slab faces have a uniform glowing border on all four sides, so blocks read slightly like picture frames. igloo.inc's glow is concentrated on the top edges and in the gaps.
  - The cap and tumbled blocks still read as cubes.
- **Rings:**
  - The halo is a crisp bright line with less soft blue spill than igloo.inc.
  - The stone is more pitted and blotchy than their smoother worn surface.
  - The inner cluster is busier and less bold than their single dominant thick C.
  - There is no background fog or wisps; that's a scene and post concern.
