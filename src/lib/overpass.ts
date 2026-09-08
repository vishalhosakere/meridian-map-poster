import { classify } from './classify'
import { buildSeaPolygons, type Rect } from './coastline'
import { bboxFromCenter, project } from './projection'
import type { Feature, Pt } from './types'

// In production, hit same-origin Netlify proxy paths (see netlify.toml) to dodge browser
// CORS. In local dev, call the mirrors directly (they allow CORS from localhost).
const ENDPOINTS = import.meta.env.PROD
  ? ['/osm/de', '/osm/kumi', '/osm/mail']
  : [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ]
// Remember the endpoint that last worked so multi-pass fetches don't re-fail over every time.
let preferredEndpoint = 0

interface Geom {
  lat: number
  lon: number
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  tags?: Record<string, string>
  geometry?: Geom[]
  members?: Array<{ type: string; role: string; geometry?: Geom[] }>
}

export interface FetchOptions {
  includeBuildings: boolean
  /** residential/service/unclassified roads (dropped at very large areas). */
  minorRoads: boolean
  /** footways/paths/cycleways/steps (dropped beyond a few km — invisible + huge count). */
  paths: boolean
  signal?: AbortSignal
}

export interface LayerPass {
  key: string
  clauses: string[]
}

/**
 * One Overpass query per layer group, each constrained to ONLY the tag values we render.
 * This is the core fix for large areas: we no longer download unstyled landuse/natural/
 * highway data just to discard it in classify().
 */
function passes(bbox: string, opts: FetchOptions): LayerPass[] {
  const b = `(${bbox})`
  const list: LayerPass[] = []

  // One query per broad group keeps the request count low (fewer 429s) while still
  // rendering progressively. Level-of-detail: drop invisible road classes at large areas.
  let roadClasses = 'motorway|trunk|primary|secondary|tertiary'
  if (opts.minorRoads) roadClasses += '|residential|unclassified|living_street|road|service'
  if (opts.paths) roadClasses += '|pedestrian|footway|path|cycleway|track|steps|bridleway|corridor'
  list.push({
    key: 'roads',
    clauses: [
      `way["highway"~"^(${roadClasses})(_link)?$"]${b};`,
      `way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge|monorail|funicular)$"]${b};`,
    ],
  })

  list.push({
    key: 'land & water',
    clauses: [
      `way["natural"~"^(water|bay|strait)$"]${b};`,
      `way["water"]${b};`,
      `way["landuse"~"^(reservoir|basin)$"]${b};`,
      `way["waterway"~"^(river|canal|stream|riverbank|dock|drain|ditch|tidal_channel)$"]${b};`,
      `way["natural"="coastline"]${b};`,
      `way["natural"~"^(beach|sand|dune)$"]${b};`,
      `way["leisure"~"^(park|garden|nature_reserve|golf_course|pitch|recreation_ground|common|dog_park|playground)$"]${b};`,
      `way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green|cemetery|allotments|orchard|vineyard|farmland|greenfield|flowerbed|plant_nursery|grassland)$"]${b};`,
      `way["natural"~"^(wood|scrub|grassland|heath|fell|tree_row|wetland)$"]${b};`,
      `relation["natural"~"^(water|bay|strait|wetland|wood)$"]${b};`,
      `relation["water"]${b};`,
      `relation["waterway"="riverbank"]${b};`,
      `relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]${b};`,
      `relation["landuse"~"^(forest|grass|meadow|cemetery|farmland)$"]${b};`,
    ],
  })

  if (opts.includeBuildings) {
    list.push({ key: 'buildings', clauses: [`way["building"]${b};`, `relation["building"]${b};`] })
  }
  return list
}

const EPS = 1e-6
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Stitch multipolygon member segments into closed rings by matching endpoints. */
function stitchRings(segments: Pt[][]): Pt[][] {
  const rings: Pt[][] = []
  const used = new Array(segments.length).fill(false)
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue
    used[i] = true
    let ring = segments[i].slice()
    let grew = true
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false
      const head = ring[0]
      const tail = ring[ring.length - 1]
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue
        const seg = segments[j]
        const sh = seg[0]
        const st = seg[seg.length - 1]
        if (same(tail, sh)) {
          ring = ring.concat(seg.slice(1))
        } else if (same(tail, st)) {
          ring = ring.concat(seg.slice(0, -1).reverse())
        } else if (same(head, st)) {
          ring = seg.slice(0, -1).concat(ring)
        } else if (same(head, sh)) {
          ring = seg.slice(1).reverse().concat(ring)
        } else {
          continue
        }
        used[j] = true
        grew = true
        break
      }
    }
    rings.push(ring)
  }
  return rings
}

function parse(elements: OverpassElement[]): { features: Feature[]; coastline: Pt[][] } {
  const feats: Feature[] = []
  const coastline: Pt[][] = []
  for (const el of elements) {
    // Collect coastline separately — it becomes filled sea, not a stray line.
    if (el.type === 'way' && el.tags?.natural === 'coastline' && el.geometry) {
      const pts = el.geometry.map((g) => project(g.lon, g.lat))
      if (pts.length >= 2) coastline.push(pts)
      continue
    }

    const c = classify(el.tags)
    if (!c) continue

    if (el.type === 'way' && el.geometry) {
      const pts = el.geometry.map((g) => project(g.lon, g.lat))
      if (pts.length < 2) continue
      feats.push({ key: c.key, kind: c.kind, rings: [pts] })
    } else if (el.type === 'relation' && el.members) {
      const outer: Pt[][] = []
      const inner: Pt[][] = []
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue
        const pts = m.geometry.map((g) => project(g.lon, g.lat))
        if (pts.length < 2) continue
        if (m.role === 'inner') inner.push(pts)
        else outer.push(pts)
      }
      if (!outer.length) continue
      const rings = [...stitchRings(outer), ...stitchRings(inner)]
      feats.push({ key: c.key, kind: 'polygon', rings })
    }
  }
  return { features: feats, coastline }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

const REQUEST_TIMEOUT = 45000 // abort a single mirror request after this so it can't hang the UI
const MAX_ATTEMPTS = 4

interface HttpError extends Error {
  status?: number
  retryAfter?: number
}

async function fetchOnce(endpoint: string, body: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), REQUEST_TIMEOUT)
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ac.signal,
    })
    if (!res.ok) {
      const err: HttpError = new Error(`Overpass ${res.status}`)
      err.status = res.status
      const ra = res.headers.get('retry-after')
      if (ra) err.retryAfter = parseInt(ra, 10) * 1000
      throw err
    }
    const json = (await res.json()) as { elements: OverpassElement[] }
    return json.elements ?? []
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function runQuery(
  query: string,
  signal?: AbortSignal,
  onRetry?: (waitMs: number) => void,
): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`
  let lastErr: HttpError | undefined
  // Public Overpass mirrors return 429 (rate limit) / 504 (overloaded) — retry the whole
  // mirror set with exponential backoff, honoring any Retry-After hint.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    for (let i = 0; i < ENDPOINTS.length; i++) {
      const idx = (preferredEndpoint + i) % ENDPOINTS.length
      try {
        const elements = await fetchOnce(ENDPOINTS[idx], body, signal)
        preferredEndpoint = idx
        return elements
      } catch (err) {
        if (signal?.aborted) throw err
        lastErr = err as HttpError
      }
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      const backoff = Math.min(2000 * 2 ** attempt, 15000) // 2s, 4s, 8s…
      const wait = Math.max(backoff, lastErr?.retryAfter ?? 0)
      onRetry?.(wait)
      await sleep(wait, signal)
    }
  }
  const code = lastErr?.status
  const reason = code === 429 ? 'rate-limited (429)' : code ? `busy (${code})` : lastErr?.message || 'request failed'
  throw new Error(`Map data servers are ${reason}. Try again shortly, or reduce the area.`)
}

/**
 * Fetch OSM data one layer at a time, invoking `onPass` with each layer's features as it
 * arrives so the canvas can render progressively (major roads first, buildings last).
 */
export async function fetchOsmProgressive(
  lat: number,
  lon: number,
  widthKm: number,
  opts: FetchOptions,
  onPass: (features: Feature[], key: string, done: boolean) => void,
  onStatus?: (message: string) => void,
): Promise<void> {
  // Keep the fetch area close to the visible square at large zooms so we don't over-query.
  const pad = widthKm > 20 ? 1.08 : 1.25
  const { s, w, n, e } = bboxFromCenter(lat, lon, widthKm, pad)
  const bbox = `${s},${w},${n},${e}`
  const sw = project(w, s)
  const ne = project(e, n)
  const mercRect: Rect = { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y }
  const plan = passes(bbox, opts)

  for (let i = 0; i < plan.length; i++) {
    const layer = plan[i]
    onStatus?.(layer.key)
    const query = `[out:json][timeout:180];(${layer.clauses.join('')});out geom;`
    const elements = await runQuery(query, opts.signal, (waitMs) =>
      onStatus?.(`${layer.key} · servers busy, retrying in ${Math.round(waitMs / 1000)}s`),
    )
    const { features, coastline } = parse(elements)
    // Fill open sea from coastline (drawn first so it sits under other water/land).
    if (coastline.length) features.unshift(...buildSeaPolygons(coastline, mercRect))
    onPass(features, layer.key, i === plan.length - 1)
  }
}
