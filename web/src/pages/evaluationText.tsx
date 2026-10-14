import { fmtDuration } from '../lib/format'
import type { BearingMetrics, Summary } from '../lib/types'

interface DetResult { label: string; combined: Summary; runs: Record<string, { per_bearing: BearingMetrics[] }> }

const short = (l: string) => l.split(' (')[0]

/** Statements generated from the result numbers, so the prose cannot drift from the data. */
export function Findings({ h }: { h: { detectors: Record<string, DetResult> } }) {
  const d = h.detectors
  const ids = ['tocsin', 'b0_rms', 'b1_iforest'].filter((k) => d[k])
  const lead = (k: string, run: string, b: number) => d[k].runs[run]?.per_bearing.find((x) => x.bearing === b)?.lead_time_h ?? null
  const items: string[] = []
  items.push(
    `Failures alerted: ${ids.map((k) => `${short(d[k].label)} ${d[k].combined.tp} of 2`).join(', ')}.`,
  )
  for (const [run, b, name] of [['test2', 1, 'Test 2 bearing 1'], ['test3', 3, 'Test 3 bearing 3']] as const) {
    const parts = ids.map((k) => {
      const v = lead(k, run, b)
      return `${short(d[k].label)} ${v != null ? fmtDuration(v) : 'no alert'}`
    })
    items.push(`${name}, first alert before the recording endpoint: ${parts.join(', ')}.`)
  }
  items.push(
    `Undamaged bearings that received any alert (strict count, out of 6): ${ids.map((k) => `${short(d[k].label)} ${d[k].combined.fp}`).join(', ')}. ` +
      `Alert episodes on undamaged bearings that started before each run's final 24 h: ${ids.map((k) => `${short(d[k].label)} ${d[k].combined.healthy_alert_episodes_excl_last24h}`).join(', ')}.`,
  )
  return (
    <div className="findings">
      <h3>What the numbers show</h3>
      <ul>{items.map((s) => <li key={s}>{s}</li>)}</ul>
    </div>
  )
}
