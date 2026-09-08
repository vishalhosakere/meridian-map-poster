// Type-ahead place search via Photon (Komoot) — free, keyless, CORS-enabled, and built
// for autocomplete over OpenStreetMap data. Results include coordinates, so a chosen
// suggestion needs no second geocoding call.
const ENDPOINT = 'https://photon.komoot.io/api/'

export interface Suggestion {
  name: string
  label: string
  country: string
  lat: number
  lon: number
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    city?: string
    county?: string
    state?: string
    country?: string
    osm_key?: string
    osm_value?: string
  }
}

export async function suggestPlaces(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&limit=6&lang=en`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Suggest failed (${res.status})`)
  const data = (await res.json()) as { features: PhotonFeature[] }

  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const f of data.features ?? []) {
    const p = f.properties
    const name = p.name ?? p.city ?? ''
    if (!name) continue
    const [lon, lat] = f.geometry.coordinates
    const label = [name, p.city && p.city !== name ? p.city : null, p.state, p.country]
      .filter(Boolean)
      .join(', ')
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ name, label, country: p.country ?? '', lat, lon })
  }
  return out
}
