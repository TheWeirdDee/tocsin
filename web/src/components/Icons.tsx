import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const Logo = (p: P) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <rect width="32" height="32" rx="7" fill="#141414" />
    <path d="M6 19h4l2.5-7 4 13 3-10 1.5 4H26" fill="none" stroke="#f6f5f1" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const Play = (p: P) => (<svg {...base} {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>)
export const Pause = (p: P) => (<svg {...base} {...p}><path d="M8 5v14M16 5v14" strokeWidth={3} /></svg>)
export const Reset = (p: P) => (<svg {...base} {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>)
export const Step = (p: P) => (<svg {...base} {...p}><path d="M6 5l8 7-8 7z" fill="currentColor" /><path d="M18 5v14" /></svg>)
export const StepBack = (p: P) => (<svg {...base} {...p}><path d="M18 5l-8 7 8 7z" fill="currentColor" /><path d="M6 5v14" /></svg>)
export const Info = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>)
export const Warn = (p: P) => (<svg {...base} {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>)
export const Menu = (p: P) => (<svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>)
export const Close = (p: P) => (<svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>)
export const Arrow = (p: P) => (<svg {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>)
export const Upload = (p: P) => (<svg {...base} {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></svg>)
export const Jump = (p: P) => (<svg {...base} {...p}><path d="M4 12h12M12 6l6 6-6 6" /><path d="M20 5v14" /></svg>)

/* State glyphs: shape differs per state so colour is never the only cue. */
export const StateGlyph = ({ state, ...p }: P & { state: string }) => {
  switch (state) {
    case 'ALERT':
      return (<svg {...base} {...p}><path d="M12 3l10 18H2z" fill="currentColor" stroke="none" /><path d="M12 10v4.5M12 17.5v.3" stroke="#d03b3b" strokeWidth={2.4} /></svg>)
    case 'WATCH':
      return (<svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3 2" /></svg>)
    case 'NORMAL':
      return (<svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8 12.5l2.7 2.7L16 9.8" /></svg>)
    case 'DATA_INSUFFICIENT':
      return (<svg {...base} {...p}><circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" /><path d="M9 9l6 6M15 9l-6 6" /></svg>)
    default:
      return (<svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5h4" opacity={0.8} /></svg>)
  }
}
