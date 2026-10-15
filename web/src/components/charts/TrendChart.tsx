import { useMemo, useState } from 'react'
import { fmtNum, fmtShortDate, fmtStamp, parseNaive } from '../../lib/format'
import type { Num } from '../../lib/types'
import { STATE_NAMES } from '../../lib/types'
import { STATE_LABEL } from '../../lib/state'
import { niceTicks, useWidth } from './useWidth'

const STATE_FILL: Record<number, string> = {
  0: 'var(--st-base)',
  1: 'var(--st-normal)',
  2: 'var(--st-watch)',
  3: 'var(--st-alert)',
  4: 'var(--st-nodata)',
}

export interface Strip {
  label: string
  effective: number[]
  color: string // identity swatch for the detector
}

interface Props {
  times: string[]
  score: Num[]
  valid: number[]
  threshold: number
  t: number // current replay index; nothing after t is drawn
  strips: Strip[]
  onSeek?: (i: number) => void
  title: string
  /** First index at which the bearing's reference exists. Scores before it depend on
   *  readings the replay has not reached yet, so they are never drawn (audit TC-03). */
  scoreFrom: number
  /** Optional first index of the visible time window (default: whole run). */
  from?: number
}

const M = { top: 24, right: 16, bottom: 28, left: 44 }
const STRIP_H = 12
const STRIP_GAP = 8

/** Health-score trend. Draws only readings up to the replay cursor (causal display). */
export function TrendChart({ times, score, valid, threshold, t, strips, onSeek, title, scoreFrom, from = 0 }: Props) {
  const shown = (i: number) => scoreFrom >= 0 && i >= scoreFrom && i <= t && !!valid[i] && score[i] != null
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const plotH = width < 520 ? 170 : 210
  const labelW = width < 520 ? 0 : 96
  const left = M.left + labelW
  const stripsH = strips.length * (STRIP_H + STRIP_GAP) + 6
  const height = M.top + plotH + stripsH + M.bottom
  const innerW = width - left - M.right
  const n = times.length

  const t0 = useMemo(() => parseNaive(times[from]).getTime(), [times, from])
  const t1 = useMemo(() => parseNaive(times[n - 1]).getTime(), [times, n])
  const xs = useMemo(() => times.map((s) => parseNaive(s).getTime()), [times])
  const x = (ms: number) => left + ((ms - t0) / Math.max(1, t1 - t0)) * innerW

  // y range grows with what has been observed so far (never peeks ahead)
  let maxSeen = threshold * 1.6
  let minSeen = -3
  for (let i = from; i <= t; i++) {
    const s = score[i]
    if (s != null && shown(i)) {
      if (s > maxSeen) maxSeen = s
      if (s < minSeen) minSeen = s
    }
  }
  const yMax = maxSeen * 1.08
  const yMin = Math.max(minSeen, -10)
  const y = (v: number) => M.top + plotH - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * plotH

  // pixel-bucketed max decimation keeps spikes visible on long runs
  const path = useMemo(() => {
    const buckets = new Map<number, { i: number; v: number }>()
    for (let i = from; i <= t; i++) {
      const s = score[i]
      if (s == null || !shown(i)) continue
      const px = Math.round(x(xs[i]))
      const cur = buckets.get(px)
      if (!cur || s > cur.v) buckets.set(px, { i, v: s })
    }
    const pts = [...buckets.entries()].sort((a, b) => a[0] - b[0])
    let d = ''
    let prevI = -10
    for (const [px, { i, v }] of pts) {
      // break the line across long recording pauses (> 2 h) so gaps are not drawn as data
      const gap = prevI >= 0 && xs[i] - xs[prevI] > 2 * 3_600_000
      d += `${d && !gap ? 'L' : 'M'}${px},${y(v).toFixed(1)}`
      prevI = i
    }
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, valid, t, width, yMax, yMin, xs, scoreFrom, from])

  const stripSegs = (eff: number[]) => {
    const segs: { a: number; b: number; s: number }[] = []
    for (let i = from; i <= t; i++) {
      const s = valid[i] ? eff[i] : 4
      const last = segs[segs.length - 1]
      if (last && last.s === s && xs[i] - xs[last.b] < 2 * 3_600_000) last.b = i
      else segs.push({ a: i, b: i, s })
    }
    return segs
  }

  const yt = niceTicks(yMin, yMax, 4)
  const days = useMemo(() => {
    const ticks: number[] = []
    const span = (t1 - t0) / 86_400_000
    const step = (span > 20 ? 7 : span > 8 ? 2 : 1) * (width < 520 ? 2 : 1)
    const start = new Date(t0)
    start.setUTCHours(0, 0, 0, 0)
    for (let d = start.getTime() + 86_400_000; d <= t1; d += step * 86_400_000) ticks.push(d)
    return ticks
  }, [t0, t1, width])

  const nearest = (clientX: number, rect: DOMRect) => {
    const ms = t0 + ((clientX - rect.left - left) / innerW) * (t1 - t0)
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (xs[mid] < ms) lo = mid + 1
      else hi = mid
    }
    return Math.min(lo, n - 1)
  }

  const h = hover != null && hover <= t ? hover : null
  const cursorX = x(xs[t])
  const thY = y(threshold)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={height}
        role="img"
        aria-label={`${title}. Showing readings up to ${fmtStamp(times[t])}. Alert threshold ${threshold}.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSeek?.(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        style={{ cursor: onSeek ? 'crosshair' : undefined }}
      >
        {yt.map((v) => (
          <g key={v} className="tick">
            <line x1={left} x2={width - M.right} y1={y(v)} y2={y(v)} />
            <text x={left - 8} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {/* future region is explicitly unrevealed */}
        {cursorX < width - M.right - 1 && (
          <rect x={cursorX} y={M.top} width={width - M.right - cursorX} height={plotH} fill="var(--surface-2)" opacity={0.6} />
        )}
        {(() => {
          const end = scoreFrom >= 0 && scoreFrom <= t ? Math.max(left, x(xs[scoreFrom])) : cursorX
          return end > left + 2 ? (
            <g>
              <rect x={left} y={M.top} width={end - left} height={plotH} fill="var(--st-base-bg)" />
              {end - left > 120 && (
                <text x={left + 8} y={M.top + plotH - 8} style={{ fill: 'var(--st-base-ink)' }}>Learning baseline: no score yet</text>
              )}
            </g>
          ) : null
        })()}
        <line x1={left} x2={width - M.right} y1={thY} y2={thY} stroke="var(--st-alert)" strokeWidth={1.5} />
        <text x={left + 6} y={thY - 6} style={{ fill: 'var(--st-alert-ink)', fontWeight: 600 }}>
          Alert threshold {threshold}
        </text>
        <text x={left} y={M.top - 8} style={{ fill: 'var(--ink-3)' }}>Score (robust z)</text>
        <path d={path} fill="none" stroke="var(--det-tocsin)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {shown(t) ? (
          <circle cx={cursorX} cy={y(score[t] as number)} r={4.5} fill="var(--det-tocsin)" stroke="var(--surface)" strokeWidth={2} />
        ) : null}
        <line x1={cursorX} x2={cursorX} y1={M.top} y2={M.top + plotH + stripsH} stroke="var(--ink)" strokeWidth={1} />

        {strips.map((s, k) => {
          const yy = M.top + plotH + 8 + k * (STRIP_H + STRIP_GAP)
          return (
            <g key={s.label}>
              {labelW > 0 && (
                <>
                  <rect x={4} y={yy + 2} width={8} height={8} rx={2} fill={s.color} />
                  <text x={16} y={yy + 10} style={{ fill: 'var(--ink-2)' }}>{s.label}</text>
                </>
              )}
              <rect x={left} y={yy} width={innerW} height={STRIP_H} rx={3} fill="var(--surface-2)" />
              {stripSegs(s.effective).map((g) => (
                <rect
                  key={g.a}
                  x={x(xs[g.a])}
                  y={yy}
                  width={Math.max(1.5, x(xs[g.b]) - x(xs[g.a]) + 1)}
                  height={STRIP_H}
                  fill={STATE_FILL[g.s]}
                  opacity={g.s === 1 ? 0.35 : g.s === 0 ? 0.5 : 1}
                />
              ))}
            </g>
          )
        })}
        {days.map((d) => (
          <text key={d} x={x(d)} y={height - 8} textAnchor="middle">{fmtShortDate(new Date(d).toISOString().slice(0, 19))}</text>
        ))}
        {h != null && (
          <line x1={x(xs[h])} x2={x(xs[h])} y1={M.top} y2={M.top + plotH} stroke="var(--ink-3)" strokeWidth={1} />
        )}
      </svg>
      {labelW === 0 && (
        <div className="legend" style={{ marginTop: 4 }}>
          {strips.map((s, k) => (
            <span key={s.label}><i className="box" style={{ background: s.color }} />Row {k + 1}: {s.label}</span>
          ))}
        </div>
      )}
      {h != null && (
        <div className="chart-tooltip" style={{ left: Math.min(x(xs[h]) + 10, width - 210), top: 8 }}>
          <div>{fmtStamp(times[h])}</div>
          <div><span className="k">Score </span>{!valid[h] ? 'no valid reading' : shown(h) ? fmtNum(score[h], 2) : 'not yet available (learning baseline)'}</div>
          {strips.map((s) => (
            <div key={s.label}><span className="k">{s.label}: </span>{valid[h] ? STATE_LABEL[STATE_NAMES[s.effective[h]]] : STATE_LABEL.DATA_INSUFFICIENT}</div>
          ))}
        </div>
      )}
    </div>
  )
}
