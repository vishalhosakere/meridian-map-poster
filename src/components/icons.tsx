import type { ReactNode } from 'react'

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const PinIcon = () => (
  <Icon>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Icon>
)

export const ThemeIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
)

export const DropIcon = () => (
  <Icon>
    <path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z" />
    <path d="M9 14.5a3 3 0 0 0 3 3" />
  </Icon>
)

export const FrameIcon = () => (
  <Icon>
    <rect x="4.5" y="3" width="15" height="18" rx="1.5" />
    <rect x="7.5" y="6" width="9" height="9" />
    <path d="M9 18h6" />
  </Icon>
)

export const ExportIcon = () => (
  <Icon>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M5 19.5h14" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon size={20}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)

export const ChevronDownIcon = () => (
  <Icon size={20}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon size={18}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)
