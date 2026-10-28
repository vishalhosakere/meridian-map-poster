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
- **Interactive canvas** — drag to pan, scroll to zoom (toward the cursor), rotate. On touch
  screens: one-finger pan, pinch to zoom, two-finger twist to rotate.
- **Works on phones** — below 820px the controls move into a bottom tab bar (Location / Theme /
  Colours / Layout / Export) whose sheet collapses so the poster gets the screen.
- **26 predefined themes** — formal (Ink & Paper, Blueprint, Sepia), minimal (Bone, Noir),
  bold (Signal, Autumn, Gold Leaf), neon (Neon Noir, Vaporwave, Matrix), and more.
- **Per-feature color knobs** — recolor each layer (5 road tiers: motorway → street, plus
  paths, rail, water, parks, sand, buildings), hide layers, scale road weight.
- **Poster composition** — raw edge-to-edge map *or* framed poster; title/subtitle/auto
  coordinates with label placement (none / on-map gradient / below / top); rectangle or
  circle crop; 7 aspect ratios (1:1 → 16:9, A-series).
- **High-res PNG export** — 2K / 4K / 6K / 8K, rendered off-screen (resolution-independent),
  with OpenStreetMap attribution baked into the image. On touch devices the poster is rendered
  first, then saved via the share sheet (e.g. Save Image on iOS) or downloaded. iPhone/iPad exports
  are capped at Safari's 16.7 MP canvas limit; if any device fails to allocate a canvas, the
  export retries at a smaller size and says so.

## Tech

- React 19 + Vite 8 + TypeScript 7, no map library.
- `src/lib/overpass.ts` — Overpass API query + multipolygon ring stitching.
- `src/lib/projection.ts` — Web-Mercator projection.
- `src/lib/classify.ts` — OSM tags → style layer.
- `src/lib/render.ts` — the canvas compositor (used for both live preview and export).
- `src/lib/export.ts` — off-screen export with per-device size caps and fallback.
- `src/themes.ts` — the 26 palettes.
- `scripts/vite-plugin-seo.ts` — canonical URL, robots, sitemap and JSON-LD per Netlify context.

## Run locally

```bash
npm install
npm run dev      # http://127.0.0.1:4102
```

Other scripts: `npm run build` (outputs `dist/`), `npm run preview` (http://127.0.0.1:4112),
`npm run typecheck`. Requires Node 20.19+ or 22.12+ (Vite 8). The dev and preview servers bind to
`127.0.0.1` only; they are not reachable from other devices on your network.

## Deploy to Netlify

`netlify.toml` is included (build `npm run build`, publish `dist`, SPA redirect). Either:

- **Git:** push this folder to a repo and "Add new site → Import from Git" on Netlify. It
  auto-detects the config.
- **CLI:** `npm i -g netlify-cli && netlify deploy --build --prod`.
- **Drag-and-drop:** run `CONTEXT=production URL=https://<your-site>.netlify.app npm run build`
  and drop the `dist/` folder onto the Netlify UI. Without those variables the build is treated as
  local: it carries `noindex` and a canonical URL of `http://127.0.0.1:4102`.

### Search engines

The build reads Netlify's build-time variables, so nothing is hard-coded:

| Netlify `CONTEXT` | Canonical / `og:url` | `robots.txt` | `<meta name="robots">` |
| --- | --- | --- | --- |
| `production` | `URL` (custom domain once added, else `*.netlify.app`) | `Allow: /` plus `Sitemap:` | none (indexable) |
| `deploy-preview`, `branch-deploy` | `DEPLOY_PRIME_URL` | `Disallow: /` | `noindex` |
| unset (local build) | `http://127.0.0.1:4102` | `Disallow: /` | `noindex` |

`dist/sitemap.xml` lists the single page. `index.html` ships a static description of the app
inside `#root` (replaced by React on mount), so crawlers get real content before any JavaScript
runs. A `WebApplication` JSON-LD block is injected as well.

**Google Search Console verification.** `*.netlify.app` sites can't use DNS verification, so use
the HTML-tag method:

1. In Search Console, add a **URL-prefix** property for the production URL and pick
   **HTML tag**. Copy only the `content` value from the tag it shows.
2. In Netlify → Site configuration → Environment variables, add `GOOGLE_SITE_VERIFICATION` with
   that value (scope: Builds).
3. Trigger a new production deploy, then press **Verify** in Search Console. The build injects
   `<meta name="google-site-verification" content="…">` and fails if the value isn't a plain token.
4. Submit `https://<your-site>/sitemap.xml` under **Sitemaps**, then use **URL inspection →
   Request indexing** for the home page.

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
