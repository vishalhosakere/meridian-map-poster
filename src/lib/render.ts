import type { ColorMap } from '../themes'
import type { Feature, StyleKey, View } from './types'

// Bottom→top paint order.
const ORDER: StyleKey[] = [
  'green',
  'sand',
  'water',
  'building',
  'path',
  'residential',
  'tertiary',
  'secondary',
  'primary',
  'motorway',
  'rail',
]

export type PosterMode = 'raw' | 'framed'
export type ShapeMode = 'rect' | 'circle'
/** Where the city label sits (poster mode only). 'overlay' = on the map with a gradient scrim. */
export type LabelPlacement = 'none' | 'overlay' | 'below' | 'above'

export interface Composition {
  mode: PosterMode
  shape: ShapeMode
  /** Outer canvas aspect ratio (width / height). */
  aspect: number
  title: string
  subtitle: string
  coordsLine: string
  showCoords: boolean
  matColor: string
  frameColor: string
  showBorder: boolean
  /** Outer margin as a fraction of the shorter side. */
  margin: number
  /** Title band height as a fraction of the shorter side. */
  titleBand: number
  uppercaseTitle: boolean
  labelPlacement: LabelPlacement
  /** On-map label scrim: height as a fraction of map height. */
  scrimHeight: number
  /** On-map label scrim: peak opacity of the paper fade (0–1). */
  scrimStrength: number
  /** On-map label: gaussian blur (px) of the map behind the label. 0 = off. */
  labelBlur: number
}

export interface StyleState {
  colors: ColorMap
  widths: Record<StyleKey, number>
  widthScale: number
  hidden: Set<StyleKey>
}

export type Buckets = Record<StyleKey, { polys: Path2D[]; lines: Path2D[] }>

/** Bucket features by style key and pre-bake each into a world-space Path2D (built once). */
export function bucketize(features: Feature[]): Buckets {
  const b = {} as Buckets
  for (const k of ORDER) b[k] = { polys: [], lines: [] }
  for (const f of features) {
    const bucket = b[f.key]
    if (!bucket) continue
    const p = new Path2D()
    if (f.kind === 'polygon') {
      for (const ring of f.rings) {
        if (ring.length < 2) continue
        p.moveTo(ring[0].x, ring[0].y)
        for (let i = 1; i < ring.length; i++) p.lineTo(ring[i].x, ring[i].y)
        p.closePath()
      }
      bucket.polys.push(p)
    } else {
      const ring = f.rings[0]
      if (!ring || ring.length < 2) continue
      p.moveTo(ring[0].x, ring[0].y)
      for (let i = 1; i < ring.length; i++) p.lineTo(ring[i].x, ring[i].y)
      bucket.lines.push(p)
    }
  }
  return b
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
  m: number
  band: number
  bandPos: 'none' | 'top' | 'bottom'
  hasText: boolean
}

function layout(W: number, H: number, cp: Composition): Rect {
  if (cp.mode === 'raw') return { x: 0, y: 0, w: W, h: H, m: 0, band: 0, bandPos: 'none', hasText: false }
  const short = Math.min(W, H)
  const m = cp.margin * short
  const placement = cp.labelPlacement
  const bandPos = placement === 'below' ? 'bottom' : placement === 'above' ? 'top' : 'none'
  const band = bandPos === 'none' ? 0 : cp.titleBand * short
  const areaTop = bandPos === 'top' ? m + band : m
  let x = m
  let y = areaTop
  let w = W - 2 * m
  let h = H - 2 * m - band
  if (cp.shape === 'circle') {
    const d = Math.min(w, h)
    x = m + (w - d) / 2
    y = areaTop + (h - d) / 2
    w = d
    h = d
  }
  const hasText = !!(cp.title || cp.subtitle || (cp.showCoords && cp.coordsLine))
  return { x, y, w, h, m, band, bandPos, hasText }
}

function clipToShape(ctx: CanvasRenderingContext2D, r: Rect, shape: ShapeMode) {
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2)
  } else {
    ctx.rect(r.x, r.y, r.w, r.h)
  }
  ctx.clip()
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  buckets: Buckets,
  view: View,
  style: StyleState,
  shape: ShapeMode,
) {
  const scale = Math.min(r.w, r.h) / view.spanMeters
  const k = Math.min(r.w, r.h) / 1000

  ctx.save()
  clipToShape(ctx, r, shape)
  ctx.fillStyle = style.colors.background
  ctx.fillRect(r.x, r.y, r.w, r.h)

  ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
  ctx.rotate(view.rotation)
  ctx.scale(scale, -scale)
  ctx.translate(-view.cx, -view.cy)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const key of ORDER) {
    if (style.hidden.has(key)) continue
    const bucket = buckets[key]
    if (!bucket) continue
    const color = style.colors[key]

    if (bucket.polys.length) {
      ctx.fillStyle = color
      for (const p of bucket.polys) ctx.fill(p, 'evenodd')
    }

    if (bucket.lines.length) {
      const lw = (style.widths[key] * style.widthScale * k) / scale
      if (lw > 0) {
        ctx.strokeStyle = color
        ctx.lineWidth = lw
        for (const p of bucket.lines) ctx.stroke(p)
      }
    }
  }

  ctx.restore()
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Shrink long titles so they don't overflow (mirrors maptoposter's 10/len heuristic). */
function titleFontSize(base: number, title: string): number {
  const len = title.length
  if (len <= 13) return base
  return Math.max((base * 13) / len, base * 0.5)
}

/** ODbL requires visible attribution — bake it into every exported image. */
function drawAttribution(ctx: CanvasRenderingContext2D, W: number, H: number, cp: Composition) {
  const short = Math.min(W, H)
  const pad = short * 0.022
  const size = Math.max(9, short * 0.0115)
  ctx.save()
  ctx.font = `400 ${size}px "Space Mono", monospace`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = 0.55
  ctx.fillStyle = cp.frameColor
  ctx.fillText('© OpenStreetMap contributors', W - pad, H - pad)
  ctx.restore()
}

/** Title + coordinates drawn over the map, with a gradient scrim for legibility. */
function drawMapLabel(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  cp: Composition,
  colors: ColorMap,
  shape: ShapeMode,
  dpr: number,
) {
  const title = cp.uppercaseTitle ? cp.title.toUpperCase() : cp.title
  const subParts: string[] = []
  if (cp.subtitle) subParts.push(cp.uppercaseTitle ? cp.subtitle.toUpperCase() : cp.subtitle)
  if (cp.showCoords && cp.coordsLine) subParts.push(cp.coordsLine)
  const sub = subParts.join('   ·   ')
  if (!title && !sub) return

  const short = Math.min(r.w, r.h)
  const pad = short * 0.055
  const titleSize = titleFontSize(short * 0.05, title)
  const subSize = short * 0.018
  const textBlock = pad + titleSize + (sub ? subSize * 2.1 : 0)
  // User-tunable scrim height, but never shorter than the text it backs.
  const gradH = Math.max(r.h * cp.scrimHeight, textBlock)
  const stripY = r.y + r.h - gradH
  const cx = r.x + r.w / 2

  ctx.save()
  clipToShape(ctx, r, shape)

  // Frosted blur, tapered: heaviest at the bottom edge, fading to sharp toward the top
  // where it merges into the map. Blur into an offscreen strip, then mask its opacity
  // with a vertical gradient before compositing back over the (sharp) map.
  if (cp.labelBlur > 0) {
    const dw = Math.max(1, Math.round(r.w * dpr))
    const dh = Math.max(1, Math.round(gradH * dpr))
    const tmp = document.createElement('canvas')
    tmp.width = dw
    tmp.height = dh
    const tctx = tmp.getContext('2d')
    if (tctx) {
      tctx.filter = `blur(${cp.labelBlur * dpr}px)`
      tctx.drawImage(ctx.canvas, r.x * dpr, stripY * dpr, dw, dh, 0, 0, dw, dh)
      tctx.filter = 'none'
      tctx.globalCompositeOperation = 'destination-in'
      const mask = tctx.createLinearGradient(0, dh, 0, 0)
      mask.addColorStop(0, 'rgba(0,0,0,1)') // bottom: full blur
      mask.addColorStop(0.5, 'rgba(0,0,0,0.5)')
      mask.addColorStop(1, 'rgba(0,0,0,0)') // top: sharp
      tctx.fillStyle = mask
      tctx.fillRect(0, 0, dw, dh)
      ctx.drawImage(tmp, 0, 0, dw, dh, r.x, stripY, r.w, gradH)
    }
  }

  // Gradient scrim: opaque at the bottom edge, fading up into the map.
  const s = cp.scrimStrength
  const grad = ctx.createLinearGradient(0, r.y + r.h, 0, stripY)
  grad.addColorStop(0, hexToRgba(colors.background, s))
  grad.addColorStop(0.5, hexToRgba(colors.background, s * 0.55))
  grad.addColorStop(1, hexToRgba(colors.background, 0))
  ctx.fillStyle = grad
  ctx.fillRect(r.x, stripY, r.w, gradH)

  ctx.fillStyle = cp.frameColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  const hasSub = !!sub
  const titleBaseline = r.y + r.h - pad - (hasSub ? subSize * 2.1 : 0)

  if (title) {
    ctx.font = `600 ${titleSize}px "Fraunces", Georgia, serif`
    ctx.letterSpacing = `${titleSize * 0.05}px`
    ctx.fillText(title, cx, titleBaseline)
  }

  if (hasSub) {
    const ruleY = titleBaseline + subSize * 0.9
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.strokeStyle = cp.frameColor
    ctx.lineWidth = Math.max(1, short * 0.0011)
    ctx.beginPath()
    ctx.moveTo(cx - short * 0.045, ruleY)
    ctx.lineTo(cx + short * 0.045, ruleY)
    ctx.stroke()
    ctx.restore()

    ctx.font = `400 ${subSize}px "Space Mono", monospace`
    ctx.letterSpacing = `${subSize * 0.16}px`
    ctx.globalAlpha = 0.9
    ctx.fillText(sub, cx, titleBaseline + subSize * 2.1)
    ctx.globalAlpha = 1
  }

  ctx.restore()
}

function drawFrame(ctx: CanvasRenderingContext2D, r: Rect, W: number, H: number, cp: Composition) {
  const short = Math.min(W, H)

  if (cp.showBorder) {
    ctx.save()
    ctx.strokeStyle = cp.frameColor
    ctx.globalAlpha = 0.9
    ctx.lineWidth = Math.max(1, short * 0.0016)
    if (cp.shape === 'circle') {
      ctx.beginPath()
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    ctx.restore()
  }

  if (r.bandPos === 'none' || !r.hasText) return

  const cx = W / 2
  const bandTop = r.bandPos === 'bottom' ? r.y + r.h : r.m
  const bandBottom = r.bandPos === 'bottom' ? H - r.m : r.y
  const bandMid = (bandTop + bandBottom) / 2

  ctx.save()
  ctx.fillStyle = cp.frameColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const title = cp.uppercaseTitle ? cp.title.toUpperCase() : cp.title
  const titleSize = titleFontSize(short * 0.044, title)
  const subSize = short * 0.017

  const hasSub = !!(cp.subtitle || (cp.showCoords && cp.coordsLine))
  const titleY = hasSub ? bandMid - subSize * 1.1 : bandMid

  if (title) {
    ctx.font = `600 ${titleSize}px "Fraunces", Georgia, serif`
    ctx.letterSpacing = `${titleSize * 0.06}px`
    ctx.fillText(title, cx, titleY)
  }

  // Accent rule beneath the title.
  if (title && hasSub) {
    const ruleY = titleY + titleSize * 0.62
    const ruleW = short * 0.06
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.lineWidth = Math.max(1, short * 0.0012)
    ctx.strokeStyle = cp.frameColor
    ctx.beginPath()
    ctx.moveTo(cx - ruleW / 2, ruleY)
    ctx.lineTo(cx + ruleW / 2, ruleY)
    ctx.stroke()
    ctx.restore()
  }

  if (hasSub) {
    const subY = titleY + titleSize * 0.95
    ctx.letterSpacing = `${subSize * 0.18}px`
    ctx.globalAlpha = 0.85
    const parts: string[] = []
    if (cp.subtitle) parts.push(cp.subtitle.toUpperCase())
    if (cp.showCoords && cp.coordsLine) parts.push(cp.coordsLine)
    ctx.font = `400 ${subSize}px "Space Mono", monospace`
    ctx.fillText(parts.join('   ·   '), cx, subY)
  }

  ctx.restore()
}

export interface ComposeInput {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  buckets: Buckets
  view: View
  style: StyleState
  composition: Composition
}

/** Draw the full poster (paper + map + frame). Used for live preview and export alike. */
export function compose(input: ComposeInput) {
  const { ctx, width, height, dpr, buckets, view, style, composition: cp } = input
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = cp.mode === 'framed' ? cp.matColor : style.colors.background
  ctx.fillRect(0, 0, width, height)

  const r = layout(width, height, cp)
  drawScene(ctx, r, buckets, view, style, cp.shape)
  // Labels are a poster-mode concept; a raw map stays clean.
  if (cp.mode === 'framed') {
    if (cp.labelPlacement === 'overlay') drawMapLabel(ctx, r, cp, style.colors, cp.shape, dpr)
    drawFrame(ctx, r, width, height, cp)
  }
  drawAttribution(ctx, width, height, cp)
}

/** The map's on-screen rectangle in CSS px — needed to translate pointer input to the view. */
export function mapRectOf(width: number, height: number, cp: Composition): { x: number; y: number; w: number; h: number } {
  const r = layout(width, height, cp)
  return { x: r.x, y: r.y, w: r.w, h: r.h }
}
