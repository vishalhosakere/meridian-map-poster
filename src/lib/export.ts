import { canvasPixelBudget, IOS_CANVAS_PIXELS } from './device'
import { compose } from './render'
import type { Buckets, Composition, StyleState } from './render'
import type { View } from './types'

export interface PosterSize {
  width: number
  height: number
}

export interface RenderInput {
  longEdge: number
  buckets: Buckets
  view: View
  style: StyleState
  composition: Composition
}

export interface RenderedPoster {
  blob: Blob
  width: number
  height: number
  /** True when a render failed at the expected size and a smaller fallback was used. */
  fellBack: boolean
}

// Last-resort size when even the iOS-sized canvas fails (very low-memory devices).
const FALLBACK_PIXELS = 2048 * 2560

export function posterSize(longEdge: number, aspect: number): PosterSize {
  return aspect >= 1
    ? { width: longEdge, height: Math.round(longEdge / aspect) }
    : { width: Math.round(longEdge * aspect), height: longEdge }
}

export function fitToPixels(size: PosterSize, maxPixels: number): PosterSize {
  const area = size.width * size.height
  if (area <= maxPixels) return size
  const k = Math.sqrt(maxPixels / area)
  return { width: Math.floor(size.width * k), height: Math.floor(size.height * k) }
}

/** The size an export will actually render at on this device. */
export function effectivePosterSize(longEdge: number, aspect: number): PosterSize {
  const requested = posterSize(longEdge, aspect)
  const budget = canvasPixelBudget()
  return budget ? fitToPixels(requested, budget) : requested
}

/**
 * Render the poster offscreen and encode it as PNG. Oversized canvases fail silently on some
 * mobile browsers (blank or null context), so each attempt is verified and retried smaller.
 */
export async function renderPoster(input: RenderInput): Promise<RenderedPoster> {
  // Title text is drawn with web fonts; render before they load and the export falls back to Georgia.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* fonts are a nicety, never a blocker */
    }
  }

  const requested = posterSize(input.longEdge, input.composition.aspect)
  const first = effectivePosterSize(input.longEdge, input.composition.aspect)
  const attempts = [first, fitToPixels(requested, IOS_CANVAS_PIXELS), fitToPixels(requested, FALLBACK_PIXELS)].filter(
    (s, i, all) => all.findIndex((o) => o.width === s.width && o.height === s.height) === i,
  )

  for (const size of attempts) {
    const blob = await renderAt(size, input)
    if (blob) {
      return { blob, ...size, fellBack: size !== first }
    }
  }
  throw new Error('This device ran out of memory rendering the poster. Try a smaller size.')
}

async function renderAt(size: PosterSize, input: RenderInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const { buckets, view, style, composition } = input
    compose({ ctx, width: size.width, height: size.height, dpr: 1, buckets, view, style, composition })
    // compose() paints an opaque background first, so a transparent corner means the canvas never allocated.
    if (ctx.getImageData(size.width - 1, size.height - 1, 1, 1).data[3] === 0) return null
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  } finally {
    // Release the backing store now; WebKit holds canvas memory until GC otherwise.
    canvas.width = 0
    canvas.height = 0
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** Opens the OS share sheet (Save Image, AirDrop, Files…). Resolves false if the user dismissed it. */
export async function shareBlob(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: 'image/png' })
  try {
    await navigator.share({ files: [file], title })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    throw err
  }
}
