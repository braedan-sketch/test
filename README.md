# BLENDY

A proof-of-concept scroll-driven WebGL study: an ice structure on a foggy range, taken apart by the scroll, then left as rings and a single clear block.

The name and every on-screen string live in [`src/brand.ts`](src/brand.ts). Change that file to retitle the piece.

## Run

```bash
npm install
npm run dev
```

Vite prints a local URL, usually [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

`npm run build` typechecks and writes a static site to `dist/`. Deploy that folder as-is, or connect the repo to Vercel. [`vercel.json`](vercel.json) points Vercel at the Vite build.

## Scroll

The canvas stays fixed. Scroll scrubs one continuous scene:

1. **Field** — the structure on procedural snow, drifting flakes, a slow camera move, and HUD callouts on the courses.
2. **Release** — scroll opens a slow exploded view. Blocks drift a short way along their outward direction, crown and entrance leading slightly, then float. Scroll back and they settle together. Seams and the core brighten as the gaps open.
3. **Lattice** — the blocks dissolve into floating arcs, concentric rings, and a clear block.
4. **Note** — a short manifesto and a contact link.

Headings scramble when a section becomes active. The corner control toggles a small generated drone (no audio files).

## Model

`public/models/igloo_bricks.glb` is the Draco-compressed structure. Each mesh carries a `row` extra: the course index. The highest row is the crown and leaves first. The Draco decoder is loaded from the three.js distribution at build time.

## Quality

Desktop renders with transmission on the blocks, soft shadows, and a 1.5 device-pixel cap. Narrow screens, coarse pointers, and low core counts drop transmission on the blocks, shadows, and most of the flakes. If the first seconds after load stay under 48 fps, the pixel ratio steps down once. Add `?quality=low` or `?quality=high` to force a tier.

## Stack

Vite, TypeScript, three.js, postprocessing (bloom, film grain, chromatic aberration), GSAP ScrollTrigger, and Lenis.
