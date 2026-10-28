import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { compose, mapRectOf, type Buckets, type Composition, type StyleState } from '../lib/render'
import type { Pt, View } from '../lib/types'
import { useMediaQuery } from '../lib/useMediaQuery'

const MIN_SPAN = 40
const MAX_SPAN = 400000
// A pinch only starts rotating once the fingers twist past this, so plain zooms stay north-up.
const ROTATE_THRESHOLD = (12 * Math.PI) / 180
// Room a 44px control needs beside the poster before we move the controls off it.
const CONTROL_GUTTER = 56
const COMPACT_STAGE = 640

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

type Gesture =
  | { kind: 'pan'; id: number; world: Pt; view: View }
  | {
      kind: 'pinch'
      ids: [number, number]
      world: Pt
      view: View
      dist: number
      angle: number
      rotating: boolean
    }

const clampSpan = (s: number) => Math.max(MIN_SPAN, Math.min(MAX_SPAN, s))

function normalizeAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Screen offset from the map centre, rotated into view space. */
function viewOffset(p: Pt, rotation: number, rect: Rect) {
  const a = p.x - (rect.x + rect.w / 2)
  const b = p.y - (rect.y + rect.h / 2)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { vx: cos * a + sin * b, vy: -sin * a + cos * b }
}

function worldAtScreen(p: Pt, view: View, rect: Rect): Pt {
  const { vx, vy } = viewOffset(p, view.rotation, rect)
  const scale = Math.min(rect.w, rect.h) / view.spanMeters
  return { x: view.cx + vx / scale, y: view.cy - vy / scale }
}

/** The view, at the given span and rotation, that places `world` under screen point `p`. */
function pinWorld(world: Pt, p: Pt, base: View, spanMeters: number, rotation: number, rect: Rect): View {
  const { vx, vy } = viewOffset(p, rotation, rect)
  const scale = Math.min(rect.w, rect.h) / spanMeters
  return { ...base, spanMeters, rotation, cx: world.x - vx / scale, cy: world.y + vy / scale }
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
  const [size, setSize] = useState({ w: 0, h: 0, cw: 0, ch: 0 })
  const [fontEpoch, setFontEpoch] = useState(0)
  const coarse = useMediaQuery('(pointer: coarse)')

  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture | null>(null)
  // Gesture input arrives faster than the display refreshes; coalesce to one view update per frame.
  const pendingView = useRef<View | null>(null)
  const emitFrame = useRef(0)

  const viewRef = useRef(view)
  viewRef.current = view
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const layoutRef = useRef({ size, composition, hasData })
  layoutRef.current = { size, composition, hasData }

  const latestView = () => pendingView.current ?? viewRef.current
  const rectNow = (): Rect => mapRectOf(layoutRef.current.size.w, layoutRef.current.size.h, layoutRef.current.composition)

  function emit(v: View) {
    pendingView.current = v
    if (emitFrame.current) return
    emitFrame.current = requestAnimationFrame(() => {
      emitFrame.current = 0
      const next = pendingView.current
      pendingView.current = null
      if (next) onViewChangeRef.current(next)
    })
  }

  useEffect(() => () => cancelAnimationFrame(emitFrame.current), [])

  // Fit a canvas of composition.aspect inside the container (contain).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const fit = () => {
      const pad = el.clientWidth < COMPACT_STAGE ? 12 : 28
      const availW = el.clientWidth - pad * 2
      const availH = el.clientHeight - pad * 2
      if (availW <= 0 || availH <= 0) return
      let w = availW
      let h = w / composition.aspect
      if (h > availH) {
        h = availH
        w = h * composition.aspect
      }
      setSize({ w: Math.floor(w), h: Math.floor(h), cw: el.clientWidth, ch: el.clientHeight })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [composition.aspect])

  // The poster's fonts are only used on the canvas; load them explicitly and redraw once ready.
  useEffect(() => {
    if (!document.fonts) return
    let live = true
    Promise.all([document.fonts.load('600 40px "Fraunces"'), document.fonts.load('400 12px "Space Mono"')])
      .catch(() => undefined)
      .then(() => live && setFontEpoch((n) => n + 1))
    return () => {
      live = false
    }
  }, [])

  // Resizing the backing store clears it and reallocates memory, so only do it when the size changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
  }, [size])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const raf = requestAnimationFrame(() => {
      const dpr = canvas.width / size.w
      compose({ ctx, width: size.w, height: size.h, dpr, buckets, view, style, composition })
    })
    return () => cancelAnimationFrame(raf)
  }, [buckets, view, style, composition, size, fontEpoch])

  function localPoint(e: { clientX: number; clientY: number }): Pt {
    const b = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }

  /** (Re)anchor the gesture to whichever pointers are down, starting from the current view. */
  function beginGesture() {
    const active = [...pointers.current.entries()]
    const v = latestView()
    const rect = rectNow()
    if (active.length === 0) {
      gesture.current = null
    } else if (active.length === 1) {
      const [id, p] = active[0]
      gesture.current = { kind: 'pan', id, world: worldAtScreen(p, v, rect), view: v }
    } else {
      const [[idA, a], [idB, b]] = active
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      gesture.current = {
        kind: 'pinch',
        ids: [idA, idB],
        world: worldAtScreen(mid, v, rect),
        view: v,
        dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        rotating: false,
      }
    }
    canvasRef.current?.classList.toggle('grabbing', gesture.current !== null)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!hasData) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, localPoint(e))
    if (pointers.current.size <= 2) beginGesture()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, localPoint(e))
    const g = gesture.current
    if (!g || !layoutRef.current.hasData) return
    const rect = rectNow()

    if (g.kind === 'pan') {
      const p = pointers.current.get(g.id)
      if (p) emit(pinWorld(g.world, p, g.view, g.view.spanMeters, g.view.rotation, rect))
      return
    }

    const a = pointers.current.get(g.ids[0])
    const b = pointers.current.get(g.ids[1])
    if (!a || !b) return
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    if (!g.rotating && Math.abs(normalizeAngle(angle - g.angle)) > ROTATE_THRESHOLD) {
      // Start rotating from here so crossing the threshold doesn't snap the map.
      g.rotating = true
      g.angle = angle
    }
    const rotation = g.rotating ? normalizeAngle(g.view.rotation + angle - g.angle) : g.view.rotation
    const span = clampSpan((g.view.spanMeters * g.dist) / dist)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    emit(pinWorld(g.world, mid, g.view, span, rotation, rect))
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.delete(e.pointerId)) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    beginGesture()
  }

  // Wheel / trackpad zoom toward the cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      if (!layoutRef.current.hasData || !canvas) return
      e.preventDefault()
      const p = localPoint(e)
      const rect = rectNow()
      const v = latestView()
      const world = worldAtScreen(p, v, rect)
      const span = clampSpan(v.spanMeters * Math.pow(1.0015, e.deltaY))
      emit(pinWorld(world, p, v, span, v.rotation, rect))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  function zoomBy(factor: number) {
    const v = latestView()
    onViewChange({ ...v, spanMeters: clampSpan(v.spanMeters * factor) })
  }

  const rotDeg = Math.round((((-view.rotation * 180) / Math.PI) % 360 + 360) % 360)

  // On small stages, park the controls in the letterbox space beside or below the poster when there is any.
  const freeX = (size.cw - size.w) / 2
  const freeY = (size.ch - size.h) / 2
  const compact = size.cw > 0 && size.cw < COMPACT_STAGE
  const controlsInRow = compact && freeX < CONTROL_GUTTER && freeY >= CONTROL_GUTTER
  const controlsStyle = !compact
    ? undefined
    : controlsInRow
      ? { right: freeX, bottom: Math.max(8, (freeY - 44) / 2) }
      : freeX >= CONTROL_GUTTER
        ? { right: (freeX - 44) / 2 }
        : undefined

  return (
    <div className="stage" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="img"
        aria-label={hasData ? `Poster preview: ${composition.title || 'map'}` : 'Empty poster preview'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
      />

      {hasData && (
        <div className={`map-controls ${controlsInRow ? 'row' : ''}`} style={controlsStyle}>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1 / 1.3)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1.3)}>
            −
          </button>
          <button
            type="button"
            className="compass"
            aria-label={`Reset rotation (currently ${rotDeg}°)`}
            title="Reset rotation"
            onClick={() => onViewChange({ ...latestView(), rotation: 0 })}
            style={{ transform: `rotate(${view.rotation}rad)` }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M12 3 L15 13 L12 11 L9 13 Z" fill="currentColor" />
              <path d="M12 21 L9 12 L12 14 L15 12 Z" fill="currentColor" opacity="0.35" />
            </svg>
          </button>
          <div className="rot-readout" aria-hidden>
            {rotDeg}°
          </div>
        </div>
      )}

      {!hasData && !busy && (
        <div className="stage-hint">
          <div className="stage-hint-inner">
            <span className="stage-hint-mark" aria-hidden>
              ◎
            </span>
            <p className="stage-hint-title">Search a city to begin.</p>
            <p className="dim">
              {coarse
                ? 'Then drag to pan, pinch to zoom, twist to rotate.'
                : 'Then drag to pan, scroll to zoom, and dial in a theme.'}
            </p>
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
        <div className="loading-chip" role="status">
          <span className="loader small" />
          {busyLabel ? `Loading ${busyLabel}…` : 'Loading…'}
        </div>
      )}
    </div>
  )
}
