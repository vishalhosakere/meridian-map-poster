// Core domain types shared across the data + render pipeline.

/** A point in Web-Mercator meters. */
export interface Pt {
  x: number
  y: number
}

/** The set of stylable feature groups exposed as color/width "knobs". */
export type StyleKey =
  | 'water'
  | 'green'
  | 'sand'
  | 'building'
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'path'
  | 'rail'

export const STYLE_KEYS: StyleKey[] = [
  'water',
  'green',
  'sand',
  'building',
  'motorway',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'path',
  'rail',
]

/** A renderable feature. Polygons may carry holes as extra rings (even-odd fill). */
export interface Feature {
  key: StyleKey
  kind: 'line' | 'polygon'
  rings: Pt[][]
}

export interface LatLon {
  lat: number
  lon: number
}

export interface GeoResult extends LatLon {
  displayName: string
}

/** The geographic view. Independent of pixel size so exports stay consistent. */
export interface View {
  /** Center, in Web-Mercator meters. */
  cx: number
  cy: number
  /** Mercator meters that fit across the map's shorter dimension. */
  spanMeters: number
  /** Rotation in radians (clockwise). */
  rotation: number
}
