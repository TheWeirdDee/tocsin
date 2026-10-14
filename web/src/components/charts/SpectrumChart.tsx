import { useMemo, useState } from 'react'
import type { BandMarker } from '../../lib/types'
import { niceTicks, useWidth } from './useWidth'

interface Props {
  f0: number
  df: number
  amp: number[]
  bands: BandMarker[]
  highlight: string | null // implicated family
  maxHz?: number
  title: string
}

const M = { top: 50, right: 14, bottom: 34, left: 56 }
const LABEL_ROW: Record<string, number> = { BPFO: 0, '2xBSF': 1, BPFI: 2 }
const FAMILY_SHORT: Record<string, string> = { BPFO: 'Outer race', BPFI: 'Inner race', '2xBSF': 'Rolling element' }

/** Envelope spectrum with the bearing's own defect-frequency bands marked. */
export function SpectrumChart({ f0, df, amp, bands, highlight, maxHz = 1000, title }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = width < 520 ? 210 : 240
  const iw = width - M.left - M.right
  const ih = height - M.top - M.bottom
  const x = (f: number) => M.left + (f / maxHz) * iw
  const yMax = useMemo(() => {
    let m = 0
    amp.forEach((v, i) => {
      if (f0 + i * df > 5 && v > m) m = v // skip the DC bin
    })
    return m > 0 ? m * 1.12 : 1
  }, [amp, f0, df])
  const y = (v: number) => M.top + ih - (Math.min(v, yMax) / yMax) * ih

  const path = useMemo(() => {
    let d = ''
    amp.forEach((v, i) => {
      const f = f0 + i * df
      if (f > maxHz) return
      d += `${d ? 'L' : 'M'}${x(f).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amp, width, yMax])

  const exp = Math.floor(Math.log10(yMax))
  const scale = 10 ** exp
  const yt = niceTicks(0, yMax / scale, 4)
  const hi = hover != null ? Math.round((hover - f0) / df) : null
  const hoverBand = hover != null ? bands.find((b) => hover >= b.lo && hover <= b.hi) : undefined

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={height}
        role="img"
        aria-label={title}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const f = ((e.clientX - r.left - M.left) / iw) * maxHz
          setHover(f >= 0 && f <= maxHz ? f : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yt.map((v) => (
          <g key={v} className="tick">
            <line x1={M.left} x2={width - M.right} y1={y(v * scale)} y2={y(v * scale)} />
            <text x={M.left - 8} y={y(v * scale) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={M.left - 8} y={M.top - 34} textAnchor="end">{exp !== 0 ? `×10${superscript(exp)}` : ''}</text>
        {bands.map((b) => {
          const on = b.family === highlight
          return (
            <g key={`${b.family}${b.harmonic}`}>
              <rect x={x(b.lo)} y={M.top} width={Math.max(2, x(b.hi) - x(b.lo))} height={ih}
                fill={on ? 'var(--ink)' : 'var(--ink-3)'} opacity={on ? 0.16 : 0.07} />
              {b.harmonic === 1 && (width > 520 || on) && (
                <text x={x(b.center)} y={M.top - 6 - (width > 520 ? (LABEL_ROW[b.family] ?? 0) * 13 : 0)} textAnchor="middle" style={{ fill: on ? 'var(--ink)' : 'var(--ink-3)', fontWeight: on ? 600 : 400, fontSize: 11.5 }}>
                  {FAMILY_SHORT[b.family] ?? b.family}
                </text>
              )}
            </g>
          )
        })}
        <path d={path} fill="none" stroke="var(--det-tocsin)" strokeWidth={1.5} strokeLinejoin="round" />
        <line x1={M.left} x2={width - M.right} y1={M.top + ih} y2={M.top + ih} className="axis-line" />
        {niceTicks(0, maxHz, width < 520 ? 4 : 8).map((f) => (
          <text key={f} x={x(f)} y={height - 14} textAnchor="middle">{f}</text>
        ))}
        <text x={width - M.right} y={height - 1} textAnchor="end">Frequency (Hz)</text>
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--ink-3)" />}
      </svg>
      {hover != null && hi != null && hi >= 0 && hi < amp.length && (
        <div className="chart-tooltip" style={{ left: Math.min(x(hover) + 10, width - 200), top: 30 }}>
          <div>{(f0 + hi * df).toFixed(1)} Hz</div>
          <div><span className="k">Envelope amplitude </span>{amp[hi].toExponential(2)}</div>
          {hoverBand && <div><span className="k">Band </span>{FAMILY_SHORT[hoverBand.family]} ×{hoverBand.harmonic} ({hoverBand.center.toFixed(0)} Hz ±2%)</div>}
        </div>
      )}
    </div>
  )
}

function superscript(n: number) {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return String(n).split('').map((c) => map[c] ?? c).join('')
}
