BLENDY hero GLBs (built in Blender 5.2.2, Oct 22 2026). Units: metres, glTF Y-up.
crystal.glb            1 mesh, 39.2k tris, Draco. Transmission + IOR 1.31 + volume (thickness 0.9, attenuation) + iridescence; 2k normal + 1k roughness (JPEG).
rings.glb              10 meshes / 40.6k tris, Draco: ring_outer, ring_mid_seg0-5, ring_inner_seg0-2 (origins at piece centres, parented to empties ring_outer/ring_mid/ring_inner at world origin). Same ice material family, 2k normal + 1k roughness.
fox_bust.glb           1 mesh, 120k tris, Draco, plain matte material (use as point source / depth).
fox_points.glb         150k POINTS (mode 0) with NORMAL. KHR_mesh_quantization (REQUIRED): int16 normalized positions + int8 normals, dequantized by node scale/translation -> use the node transform (or bake it with geometry.applyMatrix4(node.matrixWorld)). Float version: fox_points.ply (3.6 MB).
igloo_bricks_baked.glb 119 meshes (same names/'row' etc. extras as igloo_bricks.glb), 101k tris, Draco, KHR_materials_unlit with one 2k baked lighting atlas (v24 Cycles: direct+indirect diffuse, SSS/transmission, emission; no specular, no bloom). Render with toneMapping = NoToneMapping and texture sRGB; add bloom in post for the seam glow.
Requires DRACOLoader for all except fox_points.glb.
