# Meridian — Map Poster Studio

Turn any city into a printable, fully re-colorable map poster. Meridian pulls raw
[OpenStreetMap](https://www.openstreetmap.org/) data for the area you pick and renders
it **from scratch on an HTML canvas**, so every feature — highways, main roads, streets,
paths, railways, water, parks, sand, buildings — is drawn by us and every color is a knob
you control. Because it's vector, exports are resolution-independent (crisp at any size).

No API keys, no tile servers, no backend. It's a static site.

## Features

- **Any location** — type-ahead search (Photon autosuggest) + geocoding (Nominatim); city,
  neighborhood, or address.
- **Adjustable area** — 0.5–50 km wide. Buildings are an optional layer (off by default);
  large areas load in progressive passes with level-of-detail pruning.
- **Interactive canvas** — drag to pan, scroll to zoom (toward the cursor), rotate.
- **20 predefined themes** — formal (Ink & Paper, Blueprint, Sepia), minimal (Bone, Noir),
  bold (Signal, Autumn, Gold Leaf), neon (Neon Noir, Vaporwave, Matrix), and more.
- **Per-feature color knobs** — recolor each layer (5 road tiers: motorway → street, plus
  paths, rail, water, parks, sand, buildings), hide layers, scale road weight.
- **Poster composition** — raw edge-to-edge map *or* framed poster; title/subtitle/auto
  coordinates with label placement (none / on-map gradient / below / top); rectangle or
  circle crop; 7 aspect ratios (1:1 → 16:9, A-series).
- **High-res PNG export** — 2K / 4K / 6K / 8K, rendered off-screen (resolution-independent),
  with OpenStreetMap attribution baked into the image.

## Tech

- React + Vite + TypeScript, no map library.
- `src/lib/overpass.ts` — Overpass API query + multipolygon ring stitching.
- `src/lib/projection.ts` — Web-Mercator projection.
- `src/lib/classify.ts` — OSM tags → style layer.
- `src/lib/render.ts` — the canvas compositor (used for both live preview and export).
- `src/themes.ts` — the 20 palettes.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts: `npm run build` (outputs `dist/`), `npm run preview`, `npm run typecheck`.

## Deploy to Netlify

`netlify.toml` is included (build `npm run build`, publish `dist`, SPA redirect). Either:

- **Git:** push this folder to a repo and "Add new site → Import from Git" on Netlify. It
  auto-detects the config.
- **CLI:** `npm i -g netlify-cli && netlify deploy --build --prod`.
- **Drag-and-drop:** run `npm run build` and drop the `dist/` folder onto the Netlify UI.

## Notes & limits

- Uses the public **Overpass** (map data), **Nominatim** (geocoding) and **Photon**
  (autosuggest) endpoints — all free and rate-limited. Requests are split into progressive
  passes with value-constrained queries; on a 429/504 Meridian retries with backoff across
  three Overpass mirrors. Very large areas *with buildings* are still heavy — for reliable
  50 km rendering, point `ENDPOINTS` in `src/lib/overpass.ts` at a self-hosted Overpass.
- Web fonts (Fraunces / Space Mono / Hanken Grotesk) load from the Google Fonts CDN — the
  only external asset. Non-Latin titles fall back until a CJK/Arabic font is bundled.
- Zooming far out past the fetched area shows blank edges — increase **Area width** and press
  **Generate** to pull a wider extent.
- Open sea is filled from `natural=coastline` (closed against the fetch bbox) plus
  `natural=water/bay/strait` polygons.
- Map data © OpenStreetMap contributors ([ODbL](https://opendatacommons.org/licenses/odbl/)).
  Attribution is baked into exported images; keep it visible on anything you publish.
