import { useState, type ReactNode } from 'react'

export function Section({
  title,
  step,
  children,
  defaultOpen = true,
}: {
  title: string
  step?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`sec ${open ? 'open' : 'closed'}`}>
      <button type="button" className="sec-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {step && <span className="sec-step">{step}</span>}
        <span className="sec-title">{title}</span>
        <span className="sec-chev" aria-hidden>
          {open ? '–' : '+'}
        </span>
      </button>
      {open && <div className="sec-body">{children}</div>}
    </section>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  const shown = `${format ? format(value) : value}${suffix ?? ''}`
  return (
    <label className="fld slider">
      <span className="fld-row">
        <span className="fld-label">{label}</span>
        <span className="fld-val">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={value === o.value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ChipGroup<T>({
  label,
  options,
  isSelected,
  onSelect,
  className,
}: {
  label: string
  options: { key: string; label: string; value: T }[]
  isSelected: (v: T) => boolean
  onSelect: (v: T) => void
  className?: string
}) {
  return (
    <div className={`chip-row ${className ?? ''}`} role="group" aria-label={label}>
      {options.map((o) => {
        const on = isSelected(o.value)
        return (
          <button
            key={o.key}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onSelect(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function ColorInput({
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
  alignWithToggles = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  visible?: boolean
  onToggleVisible?: () => void
  /** Indent a row without a visibility toggle so it lines up with rows that have one. */
  alignWithToggles?: boolean
}) {
  return (
    <div className={`color-row ${visible === false ? 'hidden-layer' : ''}`}>
      {!onToggleVisible && alignWithToggles && <span className="eye-spacer" aria-hidden />}
      {onToggleVisible && (
        <button
          type="button"
          className="eye"
          onClick={onToggleVisible}
          title={visible ? 'Hide layer' : 'Show layer'}
          aria-label={`Show ${label}`}
          aria-pressed={visible}
        >
          <span aria-hidden>{visible ? '●' : '○'}</span>
        </button>
      )}
      <label className="color-pick">
        <span className="color-chip" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour`} />
        </span>
        <span className="color-name">{label}</span>
        <span className="color-hex">{value.toUpperCase()}</span>
      </label>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">
        {label}
        {hint && <em className="toggle-hint">{hint}</em>}
      </span>
    </label>
  )
}

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <span className="ring" />
      <span className="dot" />
    </div>
  )
}
