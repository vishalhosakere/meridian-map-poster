import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { compose, mapRectOf, type Buckets, type Composition, type StyleState } from '../lib/render'
import type { View } from '../lib/types'

const MIN_SPAN = 40
const MAX_SPAN = 400000

interface Props {
  buckets: Buckets
  view: View
  style: StyleState
  composition: Composition
  hasData: boolean
  busy: boolean
  busyLabel?: string
  onViewChange: (v: View) => void
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function worldAtScreen(px: number, py: number, view: View, rect: Rect) {
  const mcx = rect.x + rect.w / 2
  const mcy = rect.y + rect.h / 2
  const a = px - mcx
  const b = py - mcy
  const cos = Math.cos(view.rotation)
  const sin = Math.sin(view.rotation)
  const vx = cos * a + sin * b
  const vy = -sin * a + cos * b
  const scale = Math.min(rect.w, rect.h) / view.spanMeters
  return { x: view.cx + vx / scale, y: view.cy - vy / scale, vx, vy, scale }
}

export default function MapCanvas({
  buckets,
  view,
  style,
  composition,
  hasData,
  busy,
  busyLabel,
  onViewChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const drag = useRef<{ world: { x: number; y: number }; view: View } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // Fit a canvas of composition.aspect inside the container (contain).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const pad = 28
      const availW = el.clientWidth - pad * 2
      const availH = el.clientHeight - pad * 2
      if (availW <= 0 || availH <= 0) return
      let w = availW
      let h = w / composition.aspect
      if (h > availH) {
        h = availH
        w = h * composition.aspect
      }
      setSize({ w: Math.floor(w), h: Math.floor(h) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [composition.aspect])

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = requestAnimationFrame(() => {
      compose({ ctx, width: size.w, height: size.h, dpr, buckets, view, style, composition })
    })
    return () => cancelAnimationFrame(raf)
  }, [buckets, view, style, composition, size])

  const rectNow = (): Rect => mapRectOf(size.w, size.h, composition)

  function onPointerDown(e: React.PointerEvent) {
    if (!hasData) return
    const canvas = canvasRef.current!
    const b = canvas.getBoundingClientRect()
    const px = e.clientX - b.left
    const py = e.clientY - b.top
    const w = worldAtScreen(px, py, viewRef.current, rectNow())
    drag.current = { world: { x: w.x, y: w.y }, view: viewRef.current }
    canvas.setPointerCapture(e.pointerId)
    canvas.classList.add('grabbing')
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const canvas = canvasRef.current!
    const b = canvas.getBoundingClientRect()
    const px = e.clientX - b.left
    const py = e.clientY - b.top
    const rect = rectNow()
    const v = viewRef.current
    // vx/vy depend only on screen point + rotation; solve for center that pins the grabbed world point.
    const mcx = rect.x + rect.w / 2
    const mcy = rect.y + rect.h / 2
    const cos = Math.cos(v.rotation)
    const sin = Math.sin(v.rotation)
    const vx = cos * (px - mcx) + sin * (py - mcy)
    const vy = -sin * (px - mcx) + cos * (py - mcy)
    const scale = Math.min(rect.w, rect.h) / v.spanMeters
    onViewChange({
      ...v,
      cx: drag.current.world.x - vx / scale,
      cy: drag.current.world.y + vy / scale,
    })
  }

  function endDrag(e: React.PointerEvent) {
    drag.current = null
    canvasRef.current?.classList.remove('grabbing')
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  // Wheel zoom toward cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      if (!hasData || !canvas) return
      e.preventDefault()
      const b = canvas.getBoundingClientRect()
      const px = e.clientX - b.left
      const py = e.clientY - b.top
      const rect = mapRectOf(size.w, size.h, composition)
      const v = viewRef.current
      const w = worldAtScreen(px, py, v, rect)
      const factor = Math.pow(1.0015, e.deltaY)
      const newSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, v.spanMeters * factor))
      const scaleAfter = Math.min(rect.w, rect.h) / newSpan
      onViewChange({
        ...v,
        spanMeters: newSpan,
        cx: w.x - w.vx / scaleAfter,
        cy: w.y + w.vy / scaleAfter,
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [hasData, size, composition, onViewChange])

  function zoomBy(factor: number) {
    const v = viewRef.current
    onViewChange({ ...v, spanMeters: Math.max(MIN_SPAN, Math.min(MAX_SPAN, v.spanMeters * factor)) })
  }

  const rotDeg = Math.round((((-view.rotation * 180) / Math.PI) % 360 + 360) % 360)

  return (
    <div className="stage" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      {hasData && (
        <div className="map-controls">
          <button title="Zoom in" onClick={() => zoomBy(1 / 1.3)}>
            +
          </button>
          <button title="Zoom out" onClick={() => zoomBy(1.3)}>
            −
          </button>
          <button
            className="compass"
            title="Reset rotation"
            onClick={() => onViewChange({ ...view, rotation: 0 })}
            style={{ transform: `rotate(${view.rotation}rad)` }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M12 3 L15 13 L12 11 L9 13 Z" fill="currentColor" />
              <path d="M12 21 L9 12 L12 14 L15 12 Z" fill="currentColor" opacity="0.35" />
            </svg>
          </button>
        </div>
      )}

      {hasData && <div className="rot-readout">{rotDeg}°</div>}

      {!hasData && !busy && (
        <div className="stage-hint">
          <div className="stage-hint-inner">
            <span className="stage-hint-mark">◎</span>
            <p>Search a city to begin.</p>
            <p className="dim">Then drag to pan, scroll to zoom, and dial in a theme.</p>
          </div>
        </div>
      )}

      {busy && !hasData && (
        <div className="stage-hint">
          <div className="stage-hint-inner">
            <span className="loader" />
            <p>Loading {busyLabel || 'map data'}…</p>
          </div>
        </div>
      )}

      {busy && hasData && (
        <div className="loading-chip">
          <span className="loader small" />
          {busyLabel ? `Loading ${busyLabel}…` : 'Loading…'}
        </div>
      )}
    </div>
  )
}
