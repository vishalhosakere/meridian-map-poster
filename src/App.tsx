import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import MapCanvas from './components/MapCanvas'
import { BrandMark, ChipGroup, ColorInput, Section, Segmented, Slider, Toggle } from './components/ui'
import { ChevronDownIcon, CloseIcon, DropIcon, ExportIcon, FrameIcon, PinIcon, SearchIcon, ThemeIcon } from './components/icons'
import { canShareFiles, canvasPixelBudget, HANDHELD_WARN_PIXELS } from './lib/device'
import { downloadBlob, effectivePosterSize, posterSize, renderPoster, shareBlob, type RenderedPoster } from './lib/export'
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
import { useMediaQuery } from './lib/useMediaQuery'
import { BASE_WIDTHS, DEFAULT_THEME, THEMES, THEME_SECTIONS, type ColorMap, type Theme } from './themes'

type Status = 'idle' | 'geocoding' | 'fetching' | 'ready' | 'error'
type TabId = 'location' | 'theme' | 'colours' | 'layout' | 'export'

const TABS: { id: TabId; label: string; step: string; icon: () => ReactNode }[] = [
  { id: 'location', label: 'Location', step: '01', icon: PinIcon },
  { id: 'theme', label: 'Theme', step: '02', icon: ThemeIcon },
  { id: 'colours', label: 'Colours', step: '03', icon: DropIcon },
  { id: 'layout', label: 'Layout', step: '04', icon: FrameIcon },
  { id: 'export', label: 'Export', step: '05', icon: ExportIcon },
]

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

const ATTRIBUTION = 'Data © OpenStreetMap contributors · Rendered locally on canvas'

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

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

interface ExportResult extends RenderedPoster {
  filename: string
}

export default function App() {
  const isMobile = useMediaQuery('(max-width: 819px)')
  const coarse = useMediaQuery('(pointer: coarse)')
  // Touch devices get the two-step export (render, then share/download) so the share sheet
  // is opened from a fresh tap; browsers drop the user activation during a long render.
  const handheld = isMobile || coarse

  const [query, setQuery] = useState('')
  const [widthKm, setWidthKm] = useState(3)
  const [includeBuildings, setIncludeBuildings] = useState(false)
  const [includeRailways, setIncludeRailways] = useState(false)
  const [includePaths, setIncludePaths] = useState(false)
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
  const [exportError, setExportError] = useState('')
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const shareSupported = useMemo(canShareFiles, [])
  const abortRef = useRef<AbortController | null>(null)

  const [tab, setTab] = useState<TabId>('location')
  const [sheetOpen, setSheetOpen] = useState(false)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggest, setShowSuggest] = useState(false)
  const [activeSuggest, setActiveSuggest] = useState(-1)
  const selectedRef = useRef<Suggestion | null>(null)
  const suggestAbort = useRef<AbortController | null>(null)
  const skipSuggest = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

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
        setShowSuggest(s.length > 0 && document.activeElement === searchRef.current)
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

  // A rendered export only matches the poster it was made from.
  useEffect(() => {
    setExportResult(null)
  }, [buckets, view, style, composition, exportPx])

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

  // MapCanvas changes rotation too (twist gesture, compass reset); keep the slider in sync.
  function onViewChange(v: View) {
    setView(v)
    const deg = Math.round(((((-v.rotation * 180) / Math.PI) % 360) + 360) % 360)
    setRotationDeg(deg % 360)
  }

  async function generate(e?: FormEvent, place?: Suggestion) {
    e?.preventDefault()
    setShowSuggest(false)
    if (isMobile) {
      // Drop the keyboard and the sheet so the map has the whole screen while it loads.
      searchRef.current?.blur()
      setSheetOpen(false)
    }
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
          setStatus(hasData ? 'ready' : 'idle')
          searchRef.current?.focus()
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
      const minorRoads = widthKm <= 30 // residential streets get too dense past this
      await fetchOsmProgressive(
        lat,
        lon,
        widthKm,
        { includeBuildings, railways: includeRailways, paths: includePaths, minorRoads, signal: ac.signal },
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
      setFetchLayer('')
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

  function onQueryKeyDown(e: KeyboardEvent) {
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

  const exportFilename = `${slug(composition.title || query || 'map') || 'map'}-poster.png`

  async function onExport() {
    if (!hasData) return
    setExporting(true)
    setExportError('')
    setExportResult(null)
    try {
      const rendered = await renderPoster({ longEdge: exportPx, buckets, view, style, composition })
      const result = { ...rendered, filename: exportFilename }
      if (handheld) setExportResult(result)
      else {
        downloadBlob(result.blob, result.filename)
        if (result.fellBack) setExportResult(result)
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function onShare() {
    if (!exportResult) return
    setExportError('')
    try {
      await shareBlob(exportResult.blob, exportResult.filename, composition.title || 'Map poster')
    } catch (err) {
      setExportError(err instanceof Error ? `Sharing failed: ${err.message}` : 'Sharing failed')
    }
  }

  function onTab(id: TabId) {
    if (sheetOpen && tab === id) setSheetOpen(false)
    else {
      setTab(id)
      setSheetOpen(true)
    }
  }

  const requestedSize = posterSize(exportPx, composition.aspect)
  const exportSize = effectivePosterSize(exportPx, composition.aspect)
  const exportPixels = exportSize.width * exportSize.height
  const capped = exportSize.width !== requestedSize.width
  const budget = canvasPixelBudget()

  const searchForm = (
    <form className="locate" onSubmit={generate} autoComplete="off" role="search">
      <div className="suggest-wrap">
        <input
          ref={searchRef}
          className="text-input"
          type="text"
          enterKeyHint="search"
          placeholder={isMobile ? 'Search a city or address' : 'City, neighborhood, address…'}
          value={query}
          onChange={(e) => {
            selectedRef.current = null
            setQuery(e.target.value)
          }}
          onKeyDown={onQueryKeyDown}
          onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
          onBlur={() => window.setTimeout(() => setShowSuggest(false), 150)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="words"
          role="combobox"
          aria-label="Search for a place"
          aria-expanded={showSuggest}
          aria-autocomplete="list"
          aria-controls={showSuggest ? 'place-suggestions' : undefined}
        />
        {showSuggest && (
          <ul className="suggest-list" id="place-suggestions" role="listbox" aria-label="Suggested places">
            {suggestions.map((s, i) => (
              <li
                key={s.label + i}
                role="option"
                aria-selected={i === activeSuggest}
                className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                // Keep focus in the input (and the keyboard up) until the tap resolves to a click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                onMouseEnter={() => setActiveSuggest(i)}
              >
                <span className="suggest-name">{s.name}</span>
                <span className="suggest-ctx">{s.label.slice(s.name.length).replace(/^,\s*/, '')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        className={`btn primary ${isMobile ? 'icon-only' : ''}`}
        type="submit"
        disabled={busy}
        aria-label="Generate map"
      >
        {busy ? <span className="loader small dark" aria-hidden /> : isMobile ? <SearchIcon /> : 'Generate'}
      </button>
    </form>
  )

  const statusLine = (
    <>
      {status === 'error' && (
        <p className="status err" role="alert">
          ⚠ {error}
        </p>
      )}
      {status === 'ready' && <p className="status ok">Ready · {features.length.toLocaleString()} features</p>}
    </>
  )

  const locationPanel = (
    <>
      {!isMobile && searchForm}
      <Slider label="Area width" value={widthKm} min={0.5} max={50} step={0.5} suffix=" km" onChange={setWidthKm} />
      <div className="field-label">Extra layers</div>
      <Toggle label="Railways" checked={includeRailways} onChange={setIncludeRailways} />
      <Toggle
        label="Paths & trails"
        checked={includePaths}
        onChange={setIncludePaths}
        hint={includePaths && widthKm > 8 ? 'heavy' : undefined}
      />
      <Toggle
        label="Buildings"
        checked={includeBuildings}
        onChange={setIncludeBuildings}
        hint={includeBuildings && widthKm > 6 ? 'heavy' : undefined}
      />
      {widthKm >= 12 && (
        <p className="note warn">
          Large area — loads in passes{widthKm > 30 ? '; minor streets omitted above 30 km' : ''}.
          {includeBuildings || includePaths ? ' Buildings/Paths are heavy at this size.' : ''}
        </p>
      )}
      <p className="note">Roads, water &amp; parks are always included. Change area or layers, then Generate.</p>
      {isMobile && (
        <button className="btn primary block" type="button" onClick={() => generate()} disabled={busy}>
          {hasData ? 'Regenerate map' : 'Generate map'}
        </button>
      )}
      {statusLine}
    </>
  )

  const themePanel = (
    <>
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
                type="button"
                className={`theme-swatch ${themeId === th.id ? 'sel' : ''}`}
                aria-pressed={themeId === th.id}
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
    </>
  )

  const coloursPanel = (
    <>
      <ColorInput
        label="Background"
        value={colors.background}
        onChange={(v) => setColor('background', v)}
        alignWithToggles
      />
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
    </>
  )

  const layoutPanel = (
    <>
      <Segmented<PosterMode>
        label="Poster style"
        value={composition.mode}
        onChange={(mode) => setComposition((cp) => ({ ...cp, mode }))}
        options={[
          { value: 'raw', label: 'Raw map' },
          { value: 'framed', label: 'Framed poster' },
        ]}
      />
      <Segmented<ShapeMode>
        label="Map shape"
        value={composition.shape}
        onChange={(shape) => setComposition((cp) => ({ ...cp, shape }))}
        options={[
          { value: 'rect', label: 'Rectangle' },
          { value: 'circle', label: 'Circle' },
        ]}
      />

      <div className="field-label">Aspect ratio</div>
      <ChipGroup
        label="Aspect ratio"
        options={ASPECTS.map((a) => ({ key: a.label, label: a.label, value: a.value }))}
        isSelected={(v) => Math.abs(composition.aspect - v) < 1e-6}
        onSelect={(aspect) => setComposition((cp) => ({ ...cp, aspect }))}
      />

      <Slider label="Rotation" value={rotationDeg} min={0} max={359} step={1} suffix="°" onChange={updateRotation} />

      {composition.mode === 'framed' && (
        <div className="frame-fields">
          <div className="field-label">City label</div>
          <ChipGroup
            label="City label placement"
            options={LABEL_PLACEMENTS.map((p) => ({ key: p.value, label: p.label, value: p.value }))}
            isSelected={(v) => composition.labelPlacement === v}
            onSelect={(labelPlacement) => setComposition((cp) => ({ ...cp, labelPlacement }))}
          />
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
                aria-label="Poster title"
                value={composition.title}
                onChange={(e) => setComposition((cp) => ({ ...cp, title: e.target.value }))}
              />
              <input
                className="text-input"
                placeholder="Subtitle"
                aria-label="Poster subtitle"
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
    </>
  )

  const exportPanel = (
    <>
      <ChipGroup
        label="Export size"
        className="even"
        options={SIZES.map((s) => ({ key: s.label, label: s.label, value: s.px }))}
        isSelected={(px) => exportPx === px}
        onSelect={setExportPx}
      />
      <p className="note">
        {exportSize.width} × {exportSize.height} px · PNG
      </p>
      {capped && budget && (
        <p className="note warn">
          iPhone and iPad cap canvases at {Math.floor(budget / 1e5) / 10} MP, so this exports at {exportSize.width} ×{' '}
          {exportSize.height} instead of {requestedSize.width} × {requestedSize.height}.
        </p>
      )}
      {!capped && handheld && exportPixels > HANDHELD_WARN_PIXELS && (
        <p className="note warn">
          Needs about {formatMB(exportPixels * 4)} of memory. Phones can run out at this size; if that happens, Meridian
          retries at a smaller size. 4K is the safe choice on mobile.
        </p>
      )}
      <button className="btn export" type="button" disabled={!hasData || exporting} onClick={onExport}>
        {exporting ? 'Rendering…' : handheld ? 'Render PNG' : 'Export PNG'}
      </button>
      {!hasData && <p className="note">Generate a map first.</p>}
      {exportResult && (
        <div className="export-ready" role="status">
          <p className="export-ready-title">
            {handheld ? 'Poster ready' : 'Downloaded'} · {exportResult.width} × {exportResult.height} ·{' '}
            {formatMB(exportResult.blob.size)}
          </p>
          {exportResult.fellBack && (
            <p className="note warn">This device couldn’t render the full size, so the poster was scaled down to fit.</p>
          )}
          {handheld && (
            <div className="export-actions">
              {shareSupported && (
                <button className="btn primary" type="button" onClick={onShare}>
                  Save or share…
                </button>
              )}
              <button
                className="btn"
                type="button"
                onClick={() => downloadBlob(exportResult.blob, exportResult.filename)}
              >
                Download PNG
              </button>
            </div>
          )}
        </div>
      )}
      {exportError && (
        <p className="status err" role="alert">
          ⚠ {exportError}
        </p>
      )}
    </>
  )

  const panels: Record<TabId, ReactNode> = {
    location: locationPanel,
    theme: themePanel,
    colours: coloursPanel,
    layout: layoutPanel,
    export: exportPanel,
  }

  const stage = (
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
      {isMobile && status === 'error' && (
        <div className="toast err" role="alert">
          <span>⚠ {error}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss error"
            onClick={() => setStatus(hasData ? 'ready' : 'idle')}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </main>
  )

  const touchClass = handheld ? 'touch' : ''

  if (isMobile) {
    const activeTab = TABS.find((t) => t.id === tab)!
    return (
      <div className={`app mobile ${touchClass} ${sheetOpen ? 'sheet-open' : ''}`}>
        <header className="m-top">
          <BrandMark size={30} />
          <h1 className="sr-only">Meridian — Map Poster Studio</h1>
          {searchForm}
        </header>

        {stage}

        <div className="sheet">
          {sheetOpen && (
            <div className="sheet-panel" role="tabpanel" id="sheet-panel" aria-labelledby={`tab-${tab}`}>
              <div className="sheet-head">
                <span className="sheet-title">
                  <span className="sec-step">{activeTab.step}</span>
                  {activeTab.label}
                </span>
                <button type="button" className="icon-btn" aria-label="Hide controls" onClick={() => setSheetOpen(false)}>
                  <ChevronDownIcon />
                </button>
              </div>
              <div className="sheet-scroll" key={tab}>
                {panels[tab]}
                <p className="sheet-foot">{ATTRIBUTION}</p>
              </div>
            </div>
          )}
          <nav className="tabbar" role="tablist" aria-label="Poster controls">
            {TABS.map((t) => {
              const selected = sheetOpen && tab === t.id
              return (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={selected}
                  aria-controls={selected ? 'sheet-panel' : undefined}
                  onClick={() => onTab(t.id)}
                >
                  <t.icon />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    )
  }

  return (
    <div className={`app desktop ${touchClass}`}>
      <aside className="rail">
        <header className="brand">
          <BrandMark />
          <div className="brand-text">
            <h1>Meridian</h1>
            <p>Map Poster Studio</p>
          </div>
        </header>

        <div className="rail-scroll">
          {TABS.map((t) => (
            <Section key={t.id} title={t.label} step={t.step}>
              {panels[t.id]}
            </Section>
          ))}
        </div>

        <footer className="rail-foot">{ATTRIBUTION}</footer>
      </aside>

      {stage}
    </div>
  )
}
