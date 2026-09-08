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
      <button className="sec-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
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
  return (
    <label className="fld slider">
      <span className="fld-row">
        <span className="fld-label">{label}</span>
        <span className="fld-val">
          {format ? format(value) : value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorInput({
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  visible?: boolean
  onToggleVisible?: () => void
}) {
  return (
    <div className={`color-row ${visible === false ? 'hidden-layer' : ''}`}>
      {onToggleVisible && (
        <button
          type="button"
          className="eye"
          onClick={onToggleVisible}
          title={visible ? 'Hide layer' : 'Show layer'}
          aria-pressed={visible}
        >
          {visible ? '●' : '○'}
        </button>
      )}
      <label className="color-chip" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </label>
      <span className="color-name">{label}</span>
      <span className="color-hex">{value.toUpperCase()}</span>
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
