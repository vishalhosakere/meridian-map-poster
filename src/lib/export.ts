import { compose } from './render'
import type { Buckets, Composition, StyleState } from './render'
import type { View } from './types'

export interface ExportInput {
  longEdge: number
  buckets: Buckets
  view: View
  style: StyleState
  composition: Composition
  filename: string
}

/** Render the poster to an offscreen canvas at high resolution and download a PNG. */
export async function exportPng(input: ExportInput): Promise<void> {
  const { longEdge, buckets, view, style, composition } = input

  // Wait for webfonts so title text renders correctly.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* ignore */
    }
  }

  const aspect = composition.aspect
  let w: number
  let h: number
  if (aspect >= 1) {
    w = longEdge
    h = Math.round(longEdge / aspect)
  } else {
    h = longEdge
    w = Math.round(longEdge * aspect)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create export canvas')

  compose({ ctx, width: w, height: h, dpr: 1, buckets, view, style, composition })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Export failed')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = input.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
