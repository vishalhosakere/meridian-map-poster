import { classify } from './classify'
import { buildSeaPolygons, type Rect } from './coastline'
import { bboxFromCenter, project } from './projection'
import type { Feature, Pt } from './types'

// overpass.ch, used first when VITE_OVERPASS_KEY is set: fast, and generous per query (60 s, 256 MiB;
// 30 requests a minute). Vite inlines the key into the client bundle, so it is readable on the deployed site.
const OVERPASS_KEY = import.meta.env.VITE_OVERPASS_KEY?.trim()
const KEYED_ENDPOINT = OVERPASS_KEY ? `https://api.overpass.ch/v1/${OVERPASS_KEY}/interpreter` : null

// Public mirrors that send `Access-Control-Allow-Origin: *`, so the browser calls them directly (no proxy → no
// Netlify edge timeout). The fallback without a key, or when overpass.ch fails. Ordered by past reliability.
// NB: overpass.osm.ch is Switzerland-only — do NOT use it (returns empty outside CH).
const PUBLIC_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
// Remember the mirror that last worked so the next map tries it first.
let preferredPublic = 0

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

/**
 * The widest area (km) at which each heavy layer is still fetched. Above these a map is main roads, water and
 * parks (plus rail when chosen), which keeps one query well inside overpass.ch's 60 s / 256 MiB: in New York and
 * Bengaluru the base query measured 25–36 MB at 10 km and 207 MB (23 s) at 50 km with rail.
 */
export const LAYER_MAX_KM = { minorRoads: 5, paths: 5, buildings: 5 } as const

export interface LayerChoice {
  buildings: boolean
  railways: boolean
  /** footways/paths/cycleways/steps — huge count. */
  paths: boolean
}

export interface Layers extends LayerChoice {
  /** residential/service/unclassified roads. */
  minorRoads: boolean
}

/** The layers actually fetched for an area, after the size caps. */
export function effectiveLayers(widthKm: number, chosen: LayerChoice): Layers {
  return {
    minorRoads: widthKm <= LAYER_MAX_KM.minorRoads,
    paths: chosen.paths && widthKm <= LAYER_MAX_KM.paths,
    buildings: chosen.buildings && widthKm <= LAYER_MAX_KM.buildings,
    railways: chosen.railways,
  }
}

/** Every layer in one union, constrained to ONLY the tag values we render. */
function clauses(bbox: string, layers: Layers): string[] {
  const b = `(${bbox})`
  let roadClasses = 'motorway|trunk|primary|secondary|tertiary'
  if (layers.minorRoads) roadClasses += '|residential|unclassified|living_street|road|service'
  if (layers.paths) roadClasses += '|pedestrian|footway|path|cycleway|track|steps|bridleway|corridor'
  const list = [`way["highway"~"^(${roadClasses})(_link)?$"]${b};`]
  if (layers.railways) {
    list.push(`way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge|monorail|funicular)$"]${b};`)
  }
  // Core water + parks (lean — the long agricultural/misc landuse tail is intentionally omitted).
  list.push(
    `way["natural"~"^(water|bay|strait)$"]${b};`,
    `way["water"]${b};`,
    `way["landuse"~"^(reservoir|basin)$"]${b};`,
    `way["waterway"~"^(river|canal|stream|riverbank)$"]${b};`,
    `way["natural"="coastline"]${b};`,
    `way["natural"~"^(beach|sand)$"]${b};`,
    `way["leisure"~"^(park|garden|nature_reserve|golf_course|pitch|recreation_ground)$"]${b};`,
    `way["landuse"~"^(forest|grass|meadow|cemetery|recreation_ground)$"]${b};`,
    `way["natural"~"^(wood|scrub|heath|grassland|wetland)$"]${b};`,
    `relation["natural"~"^(water|bay|strait|wetland|wood)$"]${b};`,
    `relation["water"]${b};`,
    `relation["waterway"="riverbank"]${b};`,
    `relation["leisure"~"^(park|garden|nature_reserve)$"]${b};`,
    `relation["landuse"~"^(forest|grass|meadow|cemetery)$"]${b};`,
  )
  if (layers.buildings) list.push(`way["building"]${b};`, `relation["building"]${b};`)
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

const KEYED_TIMEOUT = 150_000 // overpass.ch stops a query at 60 s; the rest is downloading up to ~200 MB
const PUBLIC_TIMEOUT = 45_000 // abort a single mirror request after this so it can't hang the UI
const PUBLIC_ROUNDS = 2
// A healthy mirror answers /api/status at once; an overloaded one accepts the connection and never replies,
// which used to cost a full PUBLIC_TIMEOUT per mirror per round.
const PROBE_TIMEOUT = 4_000
const PROBE_TTL = 60_000

interface HttpError extends Error {
  status?: number
  retryAfter?: number
}

async function fetchOnce(endpoint: string, body: string, timeoutMs: number, signal?: AbortSignal): Promise<OverpassElement[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
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

let probe: { at: number; alive: Promise<string[]> } | null = null

/** The public mirrors that answer at all within PROBE_TIMEOUT, checked in parallel and cached for a minute. */
function aliveMirrors(): Promise<string[]> {
  if (probe && Date.now() - probe.at < PROBE_TTL) return probe.alive
  const alive = Promise.all(
    PUBLIC_ENDPOINTS.map(async (url) => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT)
      try {
        // no-cors: not every status page sends CORS headers. Any reply, even an error page, shows the server is
        // up; a mirror that refuses queries still fails fast on the real request.
        await fetch(url.replace(/interpreter$/, 'status'), { mode: 'no-cors', cache: 'no-store', signal: ac.signal })
        return url
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }),
  ).then((urls) => urls.filter((u): u is string => u !== null))
  probe = { at: Date.now(), alive }
  return alive
}

const formBody = (list: string[], timeoutSec: number) =>
  `data=${encodeURIComponent(`[out:json][timeout:${timeoutSec}];(${list.join('')});out geom;`)}`

async function runQuery(
  list: string[],
  signal?: AbortSignal,
  onStatus?: (message: string) => void,
): Promise<OverpassElement[]> {
  let lastErr: HttpError | undefined

  if (KEYED_ENDPOINT) {
    const body = formBody(list, 60)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchOnce(KEYED_ENDPOINT, body, KEYED_TIMEOUT, signal)
      } catch (err) {
        if (signal?.aborted) throw err
        lastErr = err as HttpError
        // Rate-limited: wait once as told. Anything else falls back to the public mirrors.
        if (lastErr.status !== 429 || attempt > 0) break
        const wait = Math.min(lastErr.retryAfter ?? 5000, 20000)
        onStatus?.(`map data · rate-limited, retrying in ${Math.round(wait / 1000)}s`)
        await sleep(wait, signal)
      }
    }
  }

  const alive = await aliveMirrors()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const rank = (url: string) => (PUBLIC_ENDPOINTS.indexOf(url) - preferredPublic + PUBLIC_ENDPOINTS.length) % PUBLIC_ENDPOINTS.length
  const ordered = [...alive].sort((a, b) => rank(a) - rank(b))
  const body = formBody(list, 180)
  for (let round = 0; round < PUBLIC_ROUNDS && ordered.length; round++) {
    for (const url of ordered) {
      try {
        const elements = await fetchOnce(url, body, PUBLIC_TIMEOUT, signal)
        preferredPublic = PUBLIC_ENDPOINTS.indexOf(url)
        return elements
      } catch (err) {
        if (signal?.aborted) throw err
        lastErr = err as HttpError
      }
    }
    if (round < PUBLIC_ROUNDS - 1) {
      const wait = Math.min(Math.max(2000, lastErr?.retryAfter ?? 0), 15000)
      onStatus?.(`map data · servers busy, retrying in ${Math.round(wait / 1000)}s`)
      await sleep(wait, signal)
    }
  }

  const code = lastErr?.status
  const reason =
    !ordered.length && !code
      ? 'not responding'
      : code === 429
        ? 'rate-limited (429)'
        : code
          ? `busy (${code})`
          : lastErr?.name === 'TimeoutError'
            ? 'too slow to answer'
            : lastErr?.message || 'request failed'
  throw new Error(`Map data servers are ${reason}. Try again shortly, or reduce the area.`)
}

/** Fetch every layer for the area in one query (see LAYER_MAX_KM for what large areas leave out). */
export async function fetchOsm(
  lat: number,
  lon: number,
  widthKm: number,
  layers: Layers,
  signal?: AbortSignal,
  onStatus?: (message: string) => void,
): Promise<Feature[]> {
  // Keep the fetch area close to the visible square at large zooms so we don't over-query.
  const pad = widthKm > 20 ? 1.08 : 1.25
  const { s, w, n, e } = bboxFromCenter(lat, lon, widthKm, pad)
  const sw = project(w, s)
  const ne = project(e, n)
  const mercRect: Rect = { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y }
  onStatus?.('map data')
  const elements = await runQuery(clauses(`${s},${w},${n},${e}`, layers), signal, onStatus)
  const { features, coastline } = parse(elements)
  // Fill open sea from coastline (drawn first so it sits under other water/land).
  if (coastline.length) features.unshift(...buildSeaPolygons(coastline, mercRect))
  return features
}
