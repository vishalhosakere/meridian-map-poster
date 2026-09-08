import type { LatLon, Pt } from './types'

// Web-Mercator (EPSG:3857) — the projection every slippy map uses.
const R = 6378137
const DEG = Math.PI / 180
const MAX_LAT = 85.05112878

export function project(lon: number, lat: number): Pt {
  const clamped = Math.max(Math.min(lat, MAX_LAT), -MAX_LAT)
  return {
    x: lon * DEG * R,
    y: Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2)) * R,
  }
}

export function unproject(x: number, y: number): LatLon {
  return {
    lon: (x / R) / DEG,
    lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG,
  }
}

export interface BBox {
  s: number
  w: number
  n: number
  e: number
}

/**
 * A square (in Mercator meters) centered on lat/lon, sized so it appears
 * roughly `widthKm` of ground distance across at that latitude.
 * `pad` expands the fetch area beyond the visible square (headroom for panning).
 */
export function bboxFromCenter(lat: number, lon: number, widthKm: number, pad = 1.25): BBox {
  const c = project(lon, lat)
  const cosLat = Math.max(Math.cos(lat * DEG), 1e-6)
  const halfMerc = ((widthKm * 1000) / 2 / cosLat) * pad
  const sw = unproject(c.x - halfMerc, c.y - halfMerc)
  const ne = unproject(c.x + halfMerc, c.y + halfMerc)
  return { s: sw.lat, w: sw.lon, n: ne.lat, e: ne.lon }
}

/** Mercator meters that should span the map for a given ground width in km. */
export function spanMetersForWidthKm(lat: number, widthKm: number): number {
  const cosLat = Math.max(Math.cos(lat * DEG), 1e-6)
  return (widthKm * 1000) / cosLat
}
