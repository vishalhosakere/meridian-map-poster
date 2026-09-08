import type { StyleKey } from './types'

type Tags = Record<string, string>

// highway=* → which knob it belongs to (5-tier hierarchy).
const HIGHWAY: Record<string, StyleKey> = {
  motorway: 'motorway',
  trunk: 'motorway',
  motorway_link: 'motorway',
  trunk_link: 'motorway',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'residential',
  unclassified: 'residential',
  living_street: 'residential',
  road: 'residential',
  service: 'residential',
  pedestrian: 'path',
  footway: 'path',
  path: 'path',
  cycleway: 'path',
  track: 'path',
  steps: 'path',
  bridleway: 'path',
  corridor: 'path',
}

const RAIL = new Set(['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'monorail', 'funicular'])
const LEISURE_GREEN = new Set(['park', 'garden', 'nature_reserve', 'golf_course', 'pitch', 'recreation_ground', 'common', 'dog_park', 'playground'])
const LANDUSE_GREEN = new Set(['forest', 'grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'allotments', 'orchard', 'vineyard', 'farmland', 'greenfield', 'flowerbed', 'plant_nursery', 'grassland'])
const NATURAL_GREEN = new Set(['wood', 'scrub', 'grassland', 'heath', 'fell', 'tree_row', 'wetland'])

export interface Classified {
  key: StyleKey
  kind: 'line' | 'polygon'
}

/** Map raw OSM tags to a style key + geometry kind, or null to skip. */
export function classify(tags: Tags | undefined): Classified | null {
  if (!tags) return null

  if (tags.building && tags.building !== 'no') return { key: 'building', kind: 'polygon' }

  if (tags.highway) {
    return { key: HIGHWAY[tags.highway] ?? 'residential', kind: 'line' }
  }

  if (tags.railway && RAIL.has(tags.railway)) return { key: 'rail', kind: 'line' }

  // Water (fills)
  if (
    tags.natural === 'water' ||
    tags.natural === 'bay' ||
    tags.natural === 'strait' ||
    tags.water ||
    tags.landuse === 'reservoir' ||
    tags.landuse === 'basin'
  ) {
    return { key: 'water', kind: 'polygon' }
  }
  if (tags.natural === 'coastline') return { key: 'water', kind: 'line' }
  if (tags.waterway) {
    if (tags.waterway === 'riverbank' || tags.waterway === 'dock' || tags.area === 'yes') {
      return { key: 'water', kind: 'polygon' }
    }
    if (['river', 'canal', 'stream', 'drain', 'ditch', 'tidal_channel'].includes(tags.waterway)) {
      return { key: 'water', kind: 'line' }
    }
  }

  // Sand / beach
  if (tags.natural === 'beach' || tags.natural === 'sand' || tags.natural === 'dune') {
    return { key: 'sand', kind: 'polygon' }
  }

  // Greenspace
  if (tags.leisure && LEISURE_GREEN.has(tags.leisure)) return { key: 'green', kind: 'polygon' }
  if (tags.landuse && LANDUSE_GREEN.has(tags.landuse)) return { key: 'green', kind: 'polygon' }
  if (tags.natural && NATURAL_GREEN.has(tags.natural)) return { key: 'green', kind: 'polygon' }

  return null
}
