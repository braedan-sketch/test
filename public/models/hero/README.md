# handoff_hero_v1 — baked-lighting hero (igloo v16 + terrain v12)

Drop the contents into `public/models/hero/`. The site uses this folder as the default hero. `?baked=0` keeps the realtime igloo and terrain. `hero.json` maps every file and holds the intensities. The page frames this camera at about 59 mm, centred. 78 mm overfills, and 68 mm sat too close and too far left.

## Files
| file | what | UV | colour space | encoding |
|---|---|---|---|---|
| igloo.glb | IGLOO root + 40 brick meshes `igloo_brick_000..039` | UV0+UV1 | – | Draco (texcoord q14) + KTX2 |
| terrain.glb | GROUND (lightmapped) + SKIRT (realtime) | UV0+UV1 | – | Draco + KTX2 |
| igloo_lightmap.ktx2 | 4K Cycles DIFFUSE direct+indirect (GI, seam bounce kept subtle) | **UV1** | sRGB | UASTC + zstd, mips |
| ground_lightmap.ktx2 | 4K ground lightmap | **UV1** | sRGB | UASTC + zstd, mips |
| igloo_ao.ktx2 / ground_ao.ktx2 | 2K AO (dist 0.5 m igloo / 2.0 m ground) | **UV1** | linear | ETC1S |
| igloo_seam_mask.ktx2 | 2K emissive seam/core mask | UV0 | sRGB | UASTC |
| igloo_albedo.ktx2 | 2K baked albedo (v16 grade, HIGH→LOW detail) | UV0 | sRGB | ETC1S |
| hb1_ref.jpg | Cycles reference still, hero camera | | | |
| sbs_hero_bake_v1.jpg | igloo.inc hero / Cycles ref / baked web preview | | | |
| hb1_meta.json | raw bake constants | | | |

The GLB materials already embed albedo, normal, roughness (UV0), occlusion (UV1) and the seam mask as emissiveTexture (UV0). The loose KTX2s are for the site loader to assign the lightmap (glTF has no lightmap slot) and to override if wanted.
Note: in igloo.glb the exporter packed AO (R, read via texCoord 1) and roughness (G, read via texCoord 0) into one image. That's valid glTF because the channels are independent. If you assign `igloo_ao.ktx2` as aoMap, it does the same job.

## Lightmap encoding
PNG/KTX2 value = sRGB(E / LMAX), where E is the Cycles diffuse irradiance factor (outgoing = albedo × E).
three.js (r155+) computes irradiance += lightMap × lightMapIntensity and diffuse = irradiance × albedo / π, so:
- `lightMapIntensity = π × LMAX`, which is **55.83** for the igloo and **38.63** for the ground (see hero.json).
- The lightmap texture must use `colorSpace = THREE.SRGBColorSpace` (KTX2Loader sets it from the file's sRGB OETF; check this).

## three.js setup
```js
mat.lightMap = lm; mat.lightMap.channel = 1; mat.lightMapIntensity = cfg.lightMapIntensity;
mat.aoMap = ao;    mat.aoMap.channel = 1;    mat.aoMapIntensity = 0.25;  // AO also darkens the lightmap in three; keep it low
mat.emissiveMap = seam; mat.emissiveMap.channel = 0; mat.emissive.setRGB(0.93,0.96,1.0); mat.emissiveIntensity = 2.8;
// optional: mat.map = albedo (sRGB, channel 0)
```
- Baked meshes (igloo bricks, GROUND) should get **no sun or environment lighting**: set `envMapIntensity = 0` and exclude them from the directional light (layers), or use MeshLambert/Basic-style shading. The lightmap already contains the sun, sky and GI.
- Keep the seam glow (emissive) and bloom realtime. The bake used only a subtle seam emission (0.8) to avoid double-counting.
- SKIRT is not lightmapped, so keep its realtime material.
- Mountains are not included. The site keeps its existing `mountains.glb`, unchanged since v8.
- Axes: glTF is Y-up. The hero camera in three is pos (-11.2, 2.2, -9.8), target (0, 0.8, 0), and 78 mm on a 36 mm sensor, which gives a horizontal FOV of about 25.9°. For a 16:10 viewport, vertical FOV ≈ 16.3°.

## Bricks
- Each brick is its own node and mesh with a **translation-only** pivot at its centroid (no rotation or scale), baked in the assembled pose.
- extras: `row`, `t`, `kind`, `bidx` (from igloo_meta_v14).
- The separation animation can translate the nodes. **Limitation:** the lightmap and AO are correct only in the assembled pose. Once bricks move apart, the baked contact shadows and seam bounce stay on the faces, which reads fine for small or fast offsets.

## Colour space summary
sRGB: albedo, lightmap, seam mask. Linear: AO, normal, roughness. Renderer: `outputColorSpace = SRGB`. The reference used AgX Medium High Contrast at exposure −0.1, so match it with `AgXToneMapping` or a mild ACES at exposure ≈ 0.9.
