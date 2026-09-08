import type { Feature, Pt } from './types'

// Fill open sea from natural=coastline ways. OSM convention: land is on the LEFT of a
// coastline way's direction, water on the RIGHT. We stitch coastline ways into chains,
// clip them to the fetch bbox, then close each open chain along the bbox boundary on the
// water side to produce water polygons. Best-effort: guarded so a bad case yields nothing.

export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const EPS = 1e-6
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Merge polylines that share endpoints into maximal (possibly still open) chains. */
function stitchChains(segments: Pt[][]): Pt[][] {
  const out: Pt[][] = []
  const used = new Array(segments.length).fill(false)
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue
    used[i] = true
    let chain = segments[i].slice()
    let grew = true
    while (grew) {
      grew = false
      const head = chain[0]
      const tail = chain[chain.length - 1]
      if (same(head, tail)) break
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue
        const s = segments[j]
        const sh = s[0]
        const st = s[s.length - 1]
        if (same(tail, sh)) chain = chain.concat(s.slice(1))
        else if (same(tail, st)) chain = chain.concat(s.slice(0, -1).reverse())
        else if (same(head, st)) chain = s.slice(0, -1).concat(chain)
        else if (same(head, sh)) chain = s.slice(1).reverse().concat(chain)
        else continue
        used[j] = true
        grew = true
        break
      }
    }
    out.push(chain)
  }
  return out
}

/** Liang–Barsky clip of a single segment to the rect. */
function clipSeg(p0: Pt, p1: Pt, r: Rect): [Pt, Pt] | null {
  let t0 = 0
  let t1 = 1
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  if (test(-dx, p0.x - r.minX) && test(dx, r.maxX - p0.x) && test(-dy, p0.y - r.minY) && test(dy, r.maxY - p0.y)) {
    return [
      { x: p0.x + t0 * dx, y: p0.y + t0 * dy },
      { x: p0.x + t1 * dx, y: p0.y + t1 * dy },
    ]
  }
  return null
}

/** Clip a polyline to the rect, returning the inside pieces. */
function clipPolyline(pts: Pt[], r: Rect): Pt[][] {
  const pieces: Pt[][] = []
  let cur: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSeg(pts[i], pts[i + 1], r)
    if (!seg) {
      if (cur.length) pieces.push(cur)
      cur = []
      continue
    }
    const [a, b] = seg
    if (!cur.length) cur = [a, b]
    else if (same(cur[cur.length - 1], a)) cur.push(b)
    else {
      pieces.push(cur)
      cur = [a, b]
    }
  }
  if (cur.length) pieces.push(cur)
  return pieces
}

function onBoundary(p: Pt, r: Rect): boolean {
  const e = Math.min(r.maxX - r.minX, r.maxY - r.minY) * 1e-4
  return (
    Math.abs(p.x - r.minX) < e ||
    Math.abs(p.x - r.maxX) < e ||
    Math.abs(p.y - r.minY) < e ||
    Math.abs(p.y - r.maxY) < e
  )
}

/** Position around the perimeter as t ∈ [0,4): bottom → right → top → left (CCW, y-up). */
function perim(p: Pt, r: Rect): number {
  const w = r.maxX - r.minX
  const h = r.maxY - r.minY
  const e = Math.min(w, h) * 1e-3
  if (Math.abs(p.y - r.minY) < e) return (p.x - r.minX) / w
  if (Math.abs(p.x - r.maxX) < e) return 1 + (p.y - r.minY) / h
  if (Math.abs(p.y - r.maxY) < e) return 2 + (r.maxX - p.x) / w
  return 3 + (r.maxY - p.y) / h
}

function cornerAt(t: number, r: Rect): Pt {
  switch (((t % 4) + 4) % 4) {
    case 0:
      return { x: r.minX, y: r.minY }
    case 1:
      return { x: r.maxX, y: r.minY }
    case 2:
      return { x: r.maxX, y: r.maxY }
    default:
      return { x: r.minX, y: r.maxY }
  }
}

const mod4 = (x: number) => ((x % 4) + 4) % 4

export function buildSeaPolygons(coastlineSegments: Pt[][], r: Rect): Feature[] {
  try {
    const chains: Pt[][] = []
    for (const chain of stitchChains(coastlineSegments)) {
      for (const piece of clipPolyline(chain, r)) if (piece.length >= 2) chains.push(piece)
    }
    // Only chains that cross the view (both ends on the boundary) can bound sea.
    const items = chains
      .filter((c) => onBoundary(c[0], r) && onBoundary(c[c.length - 1], r))
      .map((c) => ({ c, ts: perim(c[0], r), te: perim(c[c.length - 1], r), used: false }))
    if (!items.length) return []

    const polys: Pt[][] = []
    for (const start of items) {
      if (start.used) continue
      const ring: Pt[] = []
      let cur = start
      let guard = 0
      do {
        cur.used = true
        for (const p of cur.c) ring.push(p)
        // Walk the boundary from this chain's exit (te) DECREASING t — keeps water (right side) enclosed.
        let next: typeof items[number] | null = null
        let bestGap = Infinity
        for (const it of items) {
          const gap = mod4(cur.te - it.ts)
          if (gap < bestGap) {
            bestGap = gap
            next = it
          }
        }
        if (!next) break
        const cornersToAdd: { t: number; gap: number }[] = []
        for (let ci = 0; ci < 4; ci++) {
          const gap = mod4(cur.te - ci)
          if (gap > 1e-6 && gap < bestGap - 1e-6) cornersToAdd.push({ t: ci, gap })
        }
        cornersToAdd.sort((a, b) => a.gap - b.gap)
        for (const { t } of cornersToAdd) ring.push(cornerAt(t, r))
        cur = next
      } while (cur !== start && ++guard < items.length + 2)

      if (ring.length >= 3) polys.push(ring)
    }

    return polys.map((ring) => ({ key: 'water' as const, kind: 'polygon' as const, rings: [ring] }))
  } catch {
    return []
  }
}
