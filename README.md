# BLENDY

A proof-of-concept scroll-driven WebGL study. Scroll is the only clock: a wireframe shelter becomes frosted ice, the courses fly outward, and the view continues through a crystal, three rings, and a point-cloud fox.

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

The canvas stays fixed. Scroll scrubs the whole piece. Nothing keeps animating after the scroll settles, and scrolling back reverses the same poses, including the courses returning in reverse order.

1. **Field** — high-angle wireframe on cratered grey ground and dense fog. The camera dollies toward eye level as the wire dissolves into frosted blocks with bright seams. Crown, dome, and entrance leave first; the lower courses follow, flying out about one to one-and-a-half radii with a slow tumble. A white core blooms in the middle. Coordinate leaders stay pinned to their blocks.
2. **Rift** — a screen-space ripple, blur, and chromatic fringe carries the open structure into the next mass.
3. **Mass** — a jagged refractive crystal. The camera pushes through it into white.
4. **Rings** — three thick frosted rings spin around a bright core while the camera looks down, pushes in, and rolls. The HUD hides except the sound toggle.
5. **Witness** — an original point-cloud arctic fox above a ring. The camera orbits. Contact lines scramble as they change. The points lift away, then a pixel glitch wipes up the frame.

Headings, nav, and corner notes scramble when they appear. The bottom-left control toggles a small generated drone (no audio files).

Desktop renders with transmission on the blocks and the crystal, soft shadows, and a 1.5 device-pixel cap. Narrow screens, coarse pointers, and low core counts drop transmission, shadows, and most of the points. If the first seconds after load stay under 48 fps, the pixel ratio steps down once. Add `?quality=low` or `?quality=high` to force a tier.

## Model

`public/models/igloo_bricks.glb` is the Draco-compressed structure. Each mesh carries a `row` extra: the course index. The highest row is the crown and leaves first. The Draco decoder is loaded from the three.js distribution at build time.

## Stack

Vite, TypeScript, three.js, postprocessing (bloom, film grain, chromatic aberration, and a scroll-driven warp), and Lenis.
