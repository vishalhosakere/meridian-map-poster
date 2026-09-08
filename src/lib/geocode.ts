import type { GeoResult } from './types'

// OpenStreetMap's Nominatim geocoder. Free; be polite (low volume, cache results).
const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

export async function geocode(query: string): Promise<GeoResult> {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!data.length) throw new Error(`No place found for “${query}”`)
  const hit = data[0]
  return {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    displayName: hit.display_name,
  }
}
