import { fmtDuration, fmtNum, fmtStamp } from '../lib/format'
import type { Replay } from '../lib/types'

/** TOCSIN alert onsets for one bearing that have happened by the replay cursor. */
export function AlertLog({ replay, bid, t, onSeek, hoursTo }: {
  replay: Replay; bid: string; t: number; onSeek: (i: number) => void; hoursTo: (i: number) => number
}) {
  const events = replay.bearings[bid].alert_events.filter((e) => (e.index ?? 0) <= t)
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Alert log · bearing {bid}</h3>
        <span className="panel-sub">{events.length ? `${events.length} alert onset${events.length > 1 ? 's' : ''} so far` : 'No alerts so far'}</span>
      </div>
      <div className="panel-body">
        {events.length === 0 ? (
          <p className="small muted">No alert has been raised on this bearing up to this point in the recording.</p>
        ) : (
          <ol className="alert-log">
            {events.slice().reverse().map((e) => (
              <li key={e.index}>
                <button className="alert-log-item" onClick={() => onSeek(e.index!)}>
                  <span className="num"><strong>{fmtStamp(e.timestamp)}</strong> · {fmtDuration(hoursTo(e.index!))} before the current replay position</span>
                  <span className="small">{e.family_label ? `${e.family_label} band` : 'defect band'} · score {fmtNum(e.score, 1)} (threshold {e.threshold}) · {e.ratio_vs_reference != null ? `${fmtNum(e.ratio_vs_reference, 2)}× reference` : ''}</span>
                  <span className="small muted">{e.sentence}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
