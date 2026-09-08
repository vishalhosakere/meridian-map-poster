import { useEffect, useMemo, useRef, useState } from 'react'
import MapCanvas from './components/MapCanvas'
import { ColorInput, Section, Segmented, Slider, Toggle } from './components/ui'
import { exportPng } from './lib/export'
import { fetchOsmProgressive } from './lib/overpass'
import { geocode } from './lib/geocode'
import { suggestPlaces, type Suggestion } from './lib/suggest'
import { project, spanMetersForWidthKm } from './lib/projection'
import {
  bucketize,
  type Composition,
  type LabelPlacement,
  type PosterMode,
  type ShapeMode,
  type StyleState,
} from './lib/render'
import type { Feature, StyleKey, View } from './lib/types'
import { BASE_WIDTHS, DEFAULT_THEME, THEMES, THEME_SECTIONS, type ColorMap, type Theme } from './themes'

type Status = 'idle' | 'geocoding' | 'fetching' | 'ready' | 'error'

const LAYER_LABELS: { key: StyleKey; label: string }[] = [
  { key: 'motorway', label: 'Motorways' },
  { key: 'primary', label: 'Primary roads' },
  { key: 'secondary', label: 'Secondary roads' },
  { key: 'tertiary', label: 'Tertiary roads' },
  { key: 'residential', label: 'Streets' },
  { key: 'path', label: 'Paths & trails' },
  { key: 'rail', label: 'Railways' },
  { key: 'water', label: 'Water' },
  { key: 'green', label: 'Parks & green' },
  { key: 'sand', label: 'Sand & beach' },
  { key: 'building', label: 'Buildings' },
]

const ASPECTS: { label: string; value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: 'A √2', value: 1 / Math.SQRT2 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
]

const SIZES: { label: string; px: number }[] = [
  { label: '2K', px: 2048 },
  { label: '4K', px: 4096 },
  { label: '6K', px: 6000 },
  { label: '8K', px: 8192 },
]

const LABEL_PLACEMENTS: { value: LabelPlacement; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'overlay', label: 'On map' },
  { value: 'below', label: 'Below' },
  { value: 'above', label: 'Top' },
]

function formatCoords(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`
  const lo = `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
  return `${la}  ·  ${lo}`
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default function App() {
  const [query, setQuery] = useState('')
  const [widthKm, setWidthKm] = useState(3)
  const [includeBuildings, setIncludeBuildings] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [fetchLayer, setFetchLayer] = useState('')
  const [features, setFeatures] = useState<Feature[]>([])

  const [themeId, setThemeId] = useState(DEFAULT_THEME.id)
  const [colors, setColors] = useState<ColorMap>({ ...DEFAULT_THEME.colors })
  const [widthScale, setWidthScale] = useState(1)
  const [hidden, setHidden] = useState<Set<StyleKey>>(new Set())

  const [view, setView] = useState<View>({ cx: 0, cy: 0, spanMeters: spanMetersForWidthKm(0, 3), rotation: 0 })
  const [rotationDeg, setRotationDeg] = useState(0)

  const [composition, setComposition] = useState<Composition>({
    mode: 'framed',
    shape: 'rect',
    aspect: 4 / 5,
    title: '',
    subtitle: '',
    coordsLine: '',
    showCoords: true,
    matColor: DEFAULT_THEME.colors.background,
    frameColor: DEFAULT_THEME.colors.motorway,
    showBorder: true,
    margin: 0.055,
    titleBand: 0.13,
    uppercaseTitle: true,
    labelPlacement: 'below',
    scrimHeight: 0.15,
    scrimStrength: 0.92,
    labelBlur: 8,
  })

  const [exportPx, setExportPx] = useState(4096)
  const [exporting, setExporting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggest, setShowSuggest] = useState(false)
  const [activeSuggest, setActiveSuggest] = useState(-1)
  const selectedRef = useRef<Suggestion | null>(null)
  const suggestAbort = useRef<AbortController | null>(null)
  const skipSuggest = useRef(false)

  // Debounced type-ahead suggestions.
  useEffect(() => {
    if (skipSuggest.current) {
      skipSuggest.current = false
      return
    }
    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setShowSuggest(false)
      return
    }
    const id = setTimeout(async () => {
      suggestAbort.current?.abort()
      const ac = new AbortController()
      suggestAbort.current = ac
      try {
        const s = await suggestPlaces(q, ac.signal)
        setSuggestions(s)
        setShowSuggest(s.length > 0)
        setActiveSuggest(-1)
      } catch {
        /* ignore transient suggest errors */
      }
    }, 280)
    return () => clearTimeout(id)
  }, [query])

  const buckets = useMemo(() => bucketize(features), [features])
  const style: StyleState = useMemo(
    () => ({ colors, widths: BASE_WIDTHS, widthScale, hidden }),
    [colors, widthScale, hidden],
  )

  const busy = status === 'geocoding' || status === 'fetching'
  const hasData = features.length > 0

  function applyTheme(theme: Theme) {
    setThemeId(theme.id)
    setColors({ ...theme.colors })
    setComposition((cp) => ({ ...cp, matColor: theme.colors.background, frameColor: theme.colors.motorway }))
  }

  function setColor(key: keyof ColorMap, value: string) {
    setColors((c) => ({ ...c, [key]: value }))
  }

  function toggleLayer(key: StyleKey) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function updateRotation(deg: number) {
    setRotationDeg(deg)
    setView((v) => ({ ...v, rotation: (-deg * Math.PI) / 180 }))
  }

  // MapCanvas may change rotation (compass reset) — keep the slider in sync.
  function onViewChange(v: View) {
    setView(v)
    const deg = Math.round(((((-v.rotation * 180) / Math.PI) % 360) + 360) % 360)
    setRotationDeg(deg % 360)
  }

  async function generate(e?: React.FormEvent, place?: Suggestion) {
    e?.preventDefault()
    setShowSuggest(false)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setStatus('geocoding')
    setError('')
    try {
      let lat: number
      let lon: number
      let cityName: string
      let country: string

      const sel = place ?? (selectedRef.current?.label === query.trim() ? selectedRef.current : null)
      if (sel) {
        lat = sel.lat
        lon = sel.lon
        cityName = sel.name
        country = sel.country
      } else {
        const q = query.trim()
        if (!q) {
          setStatus('idle')
          return
        }
        const geo = await geocode(q)
        lat = geo.lat
        lon = geo.lon
        cityName = geo.displayName.split(',')[0].trim()
        country = geo.displayName.split(',').pop()?.trim() ?? ''
      }

      const c = project(lon, lat)
      const span = spanMetersForWidthKm(lat, widthKm)
      setView({ cx: c.x, cy: c.y, spanMeters: span, rotation: 0 })
      setRotationDeg(0)
      setComposition((cp) => ({
        ...cp,
        title: cityName,
        subtitle: country,
        coordsLine: formatCoords(lat, lon),
      }))

      setStatus('fetching')
      setFeatures([])
      // Drop detail that's invisible (and huge) at large areas.
      const paths = widthKm <= 8
      const minorRoads = widthKm <= 30
      await fetchOsmProgressive(
        lat,
        lon,
        widthKm,
        { includeBuildings, minorRoads, paths, signal: ac.signal },
        (feats) => {
          if (ac.signal.aborted) return
          setFeatures((prev) => [...prev, ...feats])
        },
        (message) => {
          if (!ac.signal.aborted) setFetchLayer(message)
        },
      )
      setFetchLayer('')
      setStatus('ready')
    } catch (err) {
      if (ac.signal.aborted) return
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  function selectSuggestion(s: Suggestion) {
    selectedRef.current = s
    skipSuggest.current = true
    setQuery(s.label)
    setSuggestions([])
    setShowSuggest(false)
    generate(undefined, s)
  }

  function onQueryKeyDown(e: React.KeyboardEvent) {
    if (!showSuggest || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggest((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggest((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeSuggest >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions[activeSuggest])
    } else if (e.key === 'Escape') {
      setShowSuggest(false)
    }
  }

  async function onExport() {
    if (!hasData) return
    setExporting(true)
    try {
      const name = slug(composition.title || query || 'map') || 'map'
      await exportPng({
        longEdge: exportPx,
        buckets,
        view,
        style,
        composition,
        filename: `${name}-poster.png`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportDims = (() => {
    const a = composition.aspect
    return a >= 1
      ? `${exportPx} × ${Math.round(exportPx / a)} px`
      : `${Math.round(exportPx * a)} × ${exportPx} px`
  })()

  return (
    <div className="app">
      <aside className="rail">
        <header className="brand">
          <div className="brand-mark" aria-hidden>
            <span className="ring" />
            <span className="dot" />
          </div>
          <div className="brand-text">
            <h1>Meridian</h1>
            <p>Map Poster Studio</p>
          </div>
        </header>

        <div className="rail-scroll">
          <Section title="Location" step="01">
            <form className="locate" onSubmit={generate} autoComplete="off">
              <div className="suggest-wrap">
                <input
                  className="text-input"
                  placeholder="City, neighborhood, address…"
                  value={query}
                  onChange={(e) => {
                    selectedRef.current = null
                    setQuery(e.target.value)
                  }}
                  onKeyDown={onQueryKeyDown}
                  onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                  onBlur={() => window.setTimeout(() => setShowSuggest(false), 130)}
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={showSuggest}
                  aria-autocomplete="list"
                />
                {showSuggest && (
                  <ul className="suggest-list" role="listbox">
                    {suggestions.map((s, i) => (
                      <li
                        key={s.label + i}
                        role="option"
                        aria-selected={i === activeSuggest}
                        className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectSuggestion(s)
                        }}
                        onMouseEnter={() => setActiveSuggest(i)}
                      >
                        <span className="suggest-name">{s.name}</span>
                        <span className="suggest-ctx">{s.label.slice(s.name.length).replace(/^,\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? '…' : 'Generate'}
              </button>
            </form>

            <Slider
              label="Area width"
              value={widthKm}
              min={0.5}
              max={50}
              step={0.5}
              suffix=" km"
              onChange={setWidthKm}
            />
            <Toggle
              label="Buildings"
              checked={includeBuildings}
              onChange={setIncludeBuildings}
              hint={widthKm > 6 ? 'heavy at this size' : undefined}
            />
            {widthKm >= 12 && (
              <p className="note warn">
                Large area — data loads in passes; detail is simplified
                {widthKm > 30 ? ' (minor streets & footpaths omitted)' : ' (footpaths omitted)'}.
                {includeBuildings ? ' Turn Buildings off above ~15 km to keep it responsive.' : ''}
              </p>
            )}
            <p className="note">Adjust area or buildings, then press Generate to refetch data.</p>

            {status === 'error' && <p className="status err">⚠ {error}</p>}
            {status === 'ready' && <p className="status ok">Ready · {features.length.toLocaleString()} features</p>}
          </Section>

          <Section title="Theme" step="02">
            {THEME_SECTIONS.map((sec) => (
              <div className="theme-section" key={sec.id}>
                <div className="theme-cat">
                  <span>{sec.label}</span>
                  <em>{sec.hint}</em>
                </div>
                <div className="theme-grid">
                  {THEMES.filter((th) => th.category === sec.id).map((th) => (
                    <button
                      key={th.id}
                      className={`theme-swatch ${themeId === th.id ? 'sel' : ''}`}
                      onClick={() => applyTheme(th)}
                      title={th.name}
                    >
                      <span className="sw-strip" style={{ background: th.colors.background }} />
                      <span className="sw-strip" style={{ background: th.colors.water }} />
                      <span className="sw-strip" style={{ background: th.colors.green }} />
                      <span className="sw-strip" style={{ background: th.colors.secondary }} />
                      <span className="sw-strip" style={{ background: th.colors.motorway }} />
                      <span className="sw-name">{th.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          <Section title="Palette" step="03">
            <ColorInput label="Background" value={colors.background} onChange={(v) => setColor('background', v)} />
            {LAYER_LABELS.map(({ key, label }) => (
              <ColorInput
                key={key}
                label={label}
                value={colors[key]}
                onChange={(v) => setColor(key, v)}
                visible={!hidden.has(key)}
                onToggleVisible={() => toggleLayer(key)}
              />
            ))}
            <Slider
              label="Road weight"
              value={widthScale}
              min={0.3}
              max={3}
              step={0.1}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={setWidthScale}
            />
          </Section>

          <Section title="Composition" step="04">
            <Segmented<PosterMode>
              value={composition.mode}
              onChange={(mode) => setComposition((cp) => ({ ...cp, mode }))}
              options={[
                { value: 'raw', label: 'Raw map' },
                { value: 'framed', label: 'Framed poster' },
              ]}
            />
            <Segmented<ShapeMode>
              value={composition.shape}
              onChange={(shape) => setComposition((cp) => ({ ...cp, shape }))}
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'circle', label: 'Circle' },
              ]}
            />

            <div className="chip-row">
              {ASPECTS.map((a) => (
                <button
                  key={a.label}
                  className={`chip ${Math.abs(composition.aspect - a.value) < 1e-6 ? 'on' : ''}`}
                  onClick={() => setComposition((cp) => ({ ...cp, aspect: a.value }))}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <Slider
              label="Rotation"
              value={rotationDeg}
              min={0}
              max={359}
              step={1}
              suffix="°"
              onChange={updateRotation}
            />

            {composition.mode === 'framed' && (
              <div className="frame-fields">
                <div className="field-label">City label</div>
                <div className="chip-row">
                  {LABEL_PLACEMENTS.map((p) => (
                    <button
                      key={p.value}
                      className={`chip ${composition.labelPlacement === p.value ? 'on' : ''}`}
                      onClick={() => setComposition((cp) => ({ ...cp, labelPlacement: p.value }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {composition.labelPlacement === 'overlay' && (
                  <>
                    <Slider
                      label="Fade height"
                      value={composition.scrimHeight}
                      min={0.12}
                      max={0.6}
                      step={0.01}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => setComposition((cp) => ({ ...cp, scrimHeight: v }))}
                    />
                    <Slider
                      label="Fade strength"
                      value={composition.scrimStrength}
                      min={0.3}
                      max={1}
                      step={0.02}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => setComposition((cp) => ({ ...cp, scrimStrength: v }))}
                    />
                    <Slider
                      label="Blur"
                      value={composition.labelBlur}
                      min={0}
                      max={20}
                      step={1}
                      suffix="px"
                      onChange={(v) => setComposition((cp) => ({ ...cp, labelBlur: v }))}
                    />
                  </>
                )}
                {composition.labelPlacement !== 'none' && (
                  <>
                    <input
                      className="text-input"
                      placeholder="Title"
                      value={composition.title}
                      onChange={(e) => setComposition((cp) => ({ ...cp, title: e.target.value }))}
                    />
                    <input
                      className="text-input"
                      placeholder="Subtitle"
                      value={composition.subtitle}
                      onChange={(e) => setComposition((cp) => ({ ...cp, subtitle: e.target.value }))}
                    />
                    <Toggle
                      label="Show coordinates"
                      checked={composition.showCoords}
                      onChange={(v) => setComposition((cp) => ({ ...cp, showCoords: v }))}
                    />
                    <Toggle
                      label="Uppercase title"
                      checked={composition.uppercaseTitle}
                      onChange={(v) => setComposition((cp) => ({ ...cp, uppercaseTitle: v }))}
                    />
                  </>
                )}
                <Toggle
                  label="Border"
                  checked={composition.showBorder}
                  onChange={(v) => setComposition((cp) => ({ ...cp, showBorder: v }))}
                />
                <ColorInput
                  label="Paper / mat"
                  value={composition.matColor}
                  onChange={(v) => setComposition((cp) => ({ ...cp, matColor: v }))}
                />
                <ColorInput
                  label="Frame & text"
                  value={composition.frameColor}
                  onChange={(v) => setComposition((cp) => ({ ...cp, frameColor: v }))}
                />
                <Slider
                  label="Margin"
                  value={composition.margin}
                  min={0}
                  max={0.14}
                  step={0.005}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setComposition((cp) => ({ ...cp, margin: v }))}
                />
              </div>
            )}
          </Section>

          <Section title="Export" step="05">
            <div className="chip-row">
              {SIZES.map((s) => (
                <button
                  key={s.px}
                  className={`chip ${exportPx === s.px ? 'on' : ''}`}
                  onClick={() => setExportPx(s.px)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="note">{exportDims} · PNG</p>
            <button className="btn export" disabled={!hasData || exporting} onClick={onExport}>
              {exporting ? 'Rendering…' : 'Export PNG'}
            </button>
          </Section>
        </div>

        <footer className="rail-foot">
          Data © OpenStreetMap contributors · Rendered locally on canvas
        </footer>
      </aside>

      <main className="canvas-wrap">
        <MapCanvas
          buckets={buckets}
          view={view}
          style={style}
          composition={composition}
          hasData={hasData}
          busy={busy}
          busyLabel={fetchLayer}
          onViewChange={onViewChange}
        />
      </main>
    </div>
  )
}
