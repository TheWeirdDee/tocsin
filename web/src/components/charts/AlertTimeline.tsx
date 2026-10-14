import { useMemo, useState } from 'react'
import { fmtShortDate, fmtStamp, parseNaive } from '../../lib/format'
import type { Replay } from '../../lib/types'
import { useWidth } from './useWidth'

export const DETECTORS = [
  { id: 'tocsin', label: 'TOCSIN', color: 'var(--det-tocsin)' },
  { id: 'b0_rms', label: 'RMS alarm', color: 'var(--det-rms)' },
  { id: 'b1_iforest', label: 'Isolation forest', color: 'var(--det-iforest)' },
] as const

const ROW = 14
const GAP = 4
const GROUP_GAP = 18

/** When was each detector in ALERT, per bearing, across the whole recorded run (clean condition). */
export function AlertTimeline({ replay }: { replay: Replay }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const narrow = width < 560
  const left = narrow ? 8 : 150
  const right = 16
  const top = 8
  const bearings = Object.keys(replay.bearings)
  const groupH = DETECTORS.length * (ROW + GAP) + (narrow ? 18 : 0)
  const height = top + bearings.length * (groupH + GROUP_GAP) + 24
  const xs = useMemo(() => replay.times.map((s) => parseNaive(s).getTime()), [replay])
  const t0 = xs[0]
  const t1 = xs[xs.length - 1]
  const iw = width - left - right
  const x = (ms: number) => left + ((ms - t0) / (t1 - t0)) * iw

  const segs = useMemo(() => {
    const out: Record<string, { a: number; b: number }[]> = {}
    for (const bid of bearings) {
      for (const d of DETECTORS) {
        const eff = replay.bearings[bid].detectors[d.id].effective
        const list: { a: number; b: number }[] = []
        for (let i = 0; i < eff.length; i++) {
          if (eff[i] !== 3) continue
          const last = list[list.length - 1]
          if (last && last.b === i - 1) last.b = i
          else list.push({ a: i, b: i })
        }
        out[`${bid}/${d.id}`] = list
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay])

  const span = (t1 - t0) / 86_400_000
  const step = span > 20 ? 7 : span > 8 ? 2 : 1
  const ticks: number[] = []
  const start = new Date(t0)
  start.setUTCHours(0, 0, 0, 0)
  for (let d = start.getTime() + 86_400_000; d <= t1; d += step * 86_400_000) ticks.push(d)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" width={width} height={height} role="img"
        aria-label={`Alert periods per bearing and detector for ${replay.label}. The run ends at ${fmtStamp(replay.times[replay.times.length - 1])}.`}>
        {ticks.map((d) => (
          <g key={d} className="tick">
            <line x1={x(d)} x2={x(d)} y1={top} y2={height - 22} />
            <text x={x(d)} y={height - 6} textAnchor="middle">{fmtShortDate(new Date(d).toISOString().slice(0, 19))}</text>
          </g>
        ))}
        {bearings.map((bid, gi) => {
          const b = replay.bearings[bid]
          const gy = top + gi * (groupH + GROUP_GAP)
          return (
            <g key={bid}>
              <text x={narrow ? left : 4} y={narrow ? gy + 11 : gy + 12} style={{ fill: 'var(--ink)', fontWeight: 600 }}>
                Bearing {bid}{b.faulty ? ` · ${b.label}` : narrow ? ' · undamaged' : ''}
              </text>
              {!narrow && !b.faulty && <text x={4} y={gy + 28} style={{ fill: 'var(--ink-3)' }}>undamaged</text>}
              {DETECTORS.map((d, k) => {
                const yy = gy + (narrow ? 18 : 0) + k * (ROW + GAP)
                const key = `${bid}/${d.id}`
                return (
                  <g key={d.id}>
                    <rect x={left} y={yy} width={iw} height={ROW} rx={3} fill="var(--surface-2)" />
                    {segs[key].map((s) => (
                      <rect key={s.a} x={x(xs[s.a])} y={yy} width={Math.max(2, x(xs[s.b]) - x(xs[s.a]))} height={ROW} rx={2}
                        fill={d.color} onPointerEnter={() => setHover(`${key}/${s.a}/${s.b}`)} onPointerLeave={() => setHover(null)} />
                    ))}
                  </g>
                )
              })}
              <line x1={x(t1)} x2={x(t1)} y1={gy - 2} y2={gy + groupH} stroke="var(--ink)" strokeWidth={1.5} />
            </g>
          )
        })}
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>
        {DETECTORS.map((d) => (<span key={d.id}><i className="box" style={{ background: d.color }} />{d.label} in ALERT</span>))}
        <span><i style={{ background: 'var(--ink)', width: 2, height: 12 }} />End of recording (endpoint)</span>
      </div>
      {hover && (() => {
        const [bid, det, a, b] = hover.split('/')
        const d = DETECTORS.find((q) => q.id === det)!
        return (
          <div className="chart-tooltip" style={{ left: 12, top: 0 }}>
            Bearing {bid} · {d.label}: ALERT {fmtStamp(replay.times[+a])} → {fmtStamp(replay.times[+b])}
          </div>
        )
      })()}
    </div>
  )
}
