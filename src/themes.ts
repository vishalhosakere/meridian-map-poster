import type { StyleKey } from './lib/types'

export type ColorMap = Record<'background' | StyleKey, string>

export type ThemeCategory = 'draughtsman' | 'terrain' | 'voltage'

export interface Theme {
  id: string
  name: string
  dark: boolean
  category: ThemeCategory
  colors: ColorMap
}

/** Ordered sections for the theme picker, with cool names + a hint. */
export const THEME_SECTIONS: { id: ThemeCategory; label: string; hint: string }[] = [
  { id: 'draughtsman', label: 'Draughtsman', hint: 'ink · blueprint · mono' },
  { id: 'terrain', label: 'Terrain', hint: 'coast · forest · earth' },
  { id: 'voltage', label: 'Voltage', hint: 'neon · cyber · brass' },
]

/**
 * Base stroke widths (px @ 1000px reference dimension). Fills use 0.
 * A 5-tier road ramp — roads carry the contrast, so they read as fine lines.
 */
export const BASE_WIDTHS: Record<StyleKey, number> = {
  water: 1.1,
  green: 0,
  sand: 0,
  building: 0,
  motorway: 2.6,
  primary: 1.9,
  secondary: 1.4,
  tertiary: 1.05,
  residential: 0.7,
  path: 0.45,
  rail: 0.7,
}

/** Blend `a` toward `b` by `t` (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => {
    let s = h.replace('#', '')
    if (s.length === 3) s = s.split('').map((c) => c + c).join('')
    const n = parseInt(s, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t)
  const hx = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hx(c(r1, r2))}${hx(c(g1, g2))}${hx(c(b1, b2))}`
}

interface Spec {
  id: string
  name: string
  cat: ThemeCategory
  dark: boolean
  bg: string
  water: string
  green: string
  /** Strongest road color (motorway). */
  roadTop: string
  /** Faintest road color (residential). */
  roadBottom: string
  sand?: string
  building?: string
  path?: string
  rail?: string
}

/** Build a theme: the 5 road tiers interpolate from roadTop → roadBottom; minor fills derive. */
function make(s: Spec): Theme {
  const road = (t: number) => mix(s.roadTop, s.roadBottom, t)
  return {
    id: s.id,
    name: s.name,
    dark: s.dark,
    category: s.cat,
    colors: {
      background: s.bg,
      water: s.water,
      green: s.green,
      sand: s.sand ?? (s.dark ? mix(s.bg, '#2b2416', 0.5) : mix(s.bg, '#d8c398', 0.3)),
      building: s.building ?? mix(s.bg, s.roadBottom, s.dark ? 0.2 : 0.12),
      motorway: s.roadTop,
      primary: road(0.22),
      secondary: road(0.45),
      tertiary: road(0.7),
      residential: s.roadBottom,
      path: s.path ?? mix(s.roadBottom, s.bg, 0.42),
      rail: s.rail ?? mix(s.roadTop, s.roadBottom, 0.45),
    },
  }
}

export const THEMES: Theme[] = [
  // ── Draughtsman — minimal / formal / editorial ──
  make({ id: 'ink-paper', name: 'Ink & Paper', cat: 'draughtsman', dark: false, bg: '#f4efe4', water: '#bcd4dd', green: '#d3e0c2', roadTop: '#1b1815', roadBottom: '#b0a794' }),
  make({ id: 'blueprint', name: 'Blueprint', cat: 'draughtsman', dark: true, bg: '#0c2b4d', water: '#15406a', green: '#17496a', roadTop: '#eef7ff', roadBottom: '#6f9fc4' }),
  make({ id: 'sepia', name: 'Sepia', cat: 'draughtsman', dark: false, bg: '#efe6d2', water: '#d6c9a4', green: '#d6cfa2', roadTop: '#3d2f1c', roadBottom: '#ad9871' }),
  make({ id: 'vintage-atlas', name: 'Vintage Atlas', cat: 'draughtsman', dark: false, bg: '#e7dcc4', water: '#b3c6bb', green: '#c7d1a6', roadTop: '#4a3826', roadBottom: '#a89573' }),
  make({ id: 'bone', name: 'Bone', cat: 'draughtsman', dark: false, bg: '#f7f5f0', water: '#e1ded6', green: '#e6e9df', roadTop: '#14110d', roadBottom: '#b6b1a6' }),
  make({ id: 'noir', name: 'Noir', cat: 'draughtsman', dark: true, bg: '#000000', water: '#0d0d0d', green: '#0f0f0f', roadTop: '#ffffff', roadBottom: '#575757' }),
  make({ id: 'midnight', name: 'Midnight', cat: 'draughtsman', dark: true, bg: '#0e1116', water: '#16323f', green: '#182a20', roadTop: '#ece9df', roadBottom: '#6b685f' }),
  make({ id: 'slate', name: 'Slate', cat: 'draughtsman', dark: true, bg: '#1f2933', water: '#2b3f4f', green: '#2c3a30', roadTop: '#e6edf2', roadBottom: '#6f7f8f' }),
  make({ id: 'nord', name: 'Nord', cat: 'draughtsman', dark: true, bg: '#2e3440', water: '#4a6a8a', green: '#8aa678', roadTop: '#eceff4', roadBottom: '#7b8aa0' }),

  // ── Terrain — natural / calm / organic ──
  make({ id: 'coastal', name: 'Coastal', cat: 'terrain', dark: false, bg: '#f2ead6', water: '#8fbecb', green: '#cfe0bd', roadTop: '#26454b', roadBottom: '#86999c' }),
  make({ id: 'arctic', name: 'Arctic', cat: 'terrain', dark: false, bg: '#eef4f7', water: '#b9d6e8', green: '#d3e4e0', roadTop: '#223642', roadBottom: '#8fa6b3' }),
  make({ id: 'sakura', name: 'Sakura', cat: 'terrain', dark: false, bg: '#fbeff1', water: '#d5e6ea', green: '#dcecd2', roadTop: '#7a4b57', roadBottom: '#d6a3b0' }),
  make({ id: 'forest', name: 'Forest', cat: 'terrain', dark: true, bg: '#0f2018', water: '#123a39', green: '#1c3a24', roadTop: '#e6efdc', roadBottom: '#7f9a72' }),
  make({ id: 'dune', name: 'Dune', cat: 'terrain', dark: false, bg: '#f0e6d2', water: '#c6d3c4', green: '#cdd2a0', roadTop: '#6b4a2a', roadBottom: '#c19a63' }),
  make({ id: 'emerald-night', name: 'Emerald Night', cat: 'terrain', dark: true, bg: '#05140f', water: '#0c2e2a', green: '#0f2e1f', roadTop: '#37e0a0', roadBottom: '#17795a' }),
  make({ id: 'autumn', name: 'Autumn', cat: 'terrain', dark: false, bg: '#f5ead6', water: '#c3cbb0', green: '#b8ac5c', roadTop: '#7a2410', roadBottom: '#cf8f4a' }),

  // ── Voltage — bold / neon / cyberpunk / steampunk ──
  make({ id: 'signal', name: 'Signal', cat: 'voltage', dark: false, bg: '#f2efe9', water: '#ccd7db', green: '#d8e0cd', roadTop: '#d81e2c', roadBottom: '#2b2b2b' }),
  make({ id: 'gold-leaf', name: 'Gold Leaf', cat: 'voltage', dark: true, bg: '#0c0b08', water: '#201d16', green: '#1b1e13', roadTop: '#f0c85c', roadBottom: '#6f5a24' }),
  make({ id: 'copper', name: 'Copper', cat: 'voltage', dark: true, bg: '#1b1614', water: '#2a2a2f', green: '#24261a', roadTop: '#e0a35c', roadBottom: '#7a5a3a' }),
  make({ id: 'steampunk', name: 'Steampunk', cat: 'voltage', dark: true, bg: '#17110a', water: '#24313a', green: '#26281a', roadTop: '#d9a441', roadBottom: '#8a6a3a', rail: '#b8863c' }),
  make({ id: 'neon-noir', name: 'Neon Noir', cat: 'voltage', dark: true, bg: '#0a0812', water: '#141f3a', green: '#12182a', roadTop: '#ff2e88', roadBottom: '#00e0d0' }),
  make({ id: 'vaporwave', name: 'Vaporwave', cat: 'voltage', dark: true, bg: '#1a0f2e', water: '#2a1f52', green: '#241a44', roadTop: '#ff5fd0', roadBottom: '#4be0e0' }),
  make({ id: 'synthwave', name: 'Synthwave', cat: 'voltage', dark: true, bg: '#1b1036', water: '#241a52', green: '#201a44', roadTop: '#ff5fae', roadBottom: '#ffb35c' }),
  make({ id: 'cyberpunk', name: 'Cyberpunk', cat: 'voltage', dark: true, bg: '#0a0a12', water: '#101a3a', green: '#10182a', roadTop: '#fbe40b', roadBottom: '#05d9e8' }),
  make({ id: 'tokyo-night', name: 'Tokyo Night', cat: 'voltage', dark: true, bg: '#1a1b26', water: '#24283b', green: '#1f2335', roadTop: '#7aa2f7', roadBottom: '#bb9af7' }),
  make({ id: 'matrix', name: 'Matrix', cat: 'voltage', dark: true, bg: '#04100a', water: '#0a2018', green: '#08180f', roadTop: '#46ff8f', roadBottom: '#0f6a38' }),
]

export const DEFAULT_THEME = THEMES[0]
