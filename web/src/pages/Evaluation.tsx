import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTimeline } from '../components/charts/AlertTimeline'
import { Warn } from '../components/Icons'
import { ApiError, api } from '../lib/api'
import { fmtDuration, fmtNum } from '../lib/format'
import type { BearingMetrics, Replay, Summary } from '../lib/types'
import { Findings } from './evaluationText'
import { Glance } from './evaluationGlance'
import './evaluation.css'

interface DetResult {
  label: string
  theta: number
  k: number
  combined: Summary
  runs: Record<string, { per_bearing: BearingMetrics[]; summary: Summary }>
  tuning_test1: { per_bearing: BearingMetrics[]; summary: Summary }
}
interface Heldout { generated: string; config_sha: string; endpoint: string; detectors: Record<string, DetResult> }
interface Robust {
  conditions: Record<string, string>
  grid: Record<string, Record<string, { combined: Summary; valid_fraction: Record<string, number> }>>
}
interface Sens { note: string; grid: ({ n_ref: number; k: number } & Record<string, Summary | number>)[] }
interface Deploy { [k: string]: unknown }
interface PostHoc { label: string; theta: number; band_tol: number; combined: Summary; runs: Record<string, BearingMetrics[]>; tuning_test1: Summary }

const MAIN = ['tocsin', 'b0_rms', 'b1_iforest']
const ABL = ['tocsin', 'a1_broadband_env', 'a2_global_ref', 'a3_no_persistence']
const COLOR: Record<string, string> = { tocsin: 'var(--det-tocsin)', b0_rms: 'var(--det-rms)', b1_iforest: 'var(--det-iforest)' }
const FAULTY: { run: string; bearing: number; label: string }[] = [
  { run: 'test2', bearing: 1, label: 'Test 2 · bearing 1' },
  { run: 'test3', bearing: 3, label: 'Test 3 · bearing 3' },
]

export default function Evaluation() {
  const [h, setH] = useState<Heldout | null>(null)
  const [rob, setRob] = useState<Robust | null>(null)
  const [sens, setSens] = useState<Sens | null>(null)
  const [dep, setDep] = useState<Deploy | null>(null)
  const [v10, setV10] = useState<Heldout | null>(null)
  const [post, setPost] = useState<PostHoc | null>(null)
  const [replays, setReplays] = useState<Record<string, Replay>>({})
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.result<Heldout>('heldout').then(setH).catch((e) => setErr(e instanceof ApiError ? e.message : 'Results unavailable'))
    api.result<Robust>('robustness').then(setRob).catch(() => undefined)
    api.result<Sens>('sensitivity').then(setSens).catch(() => undefined)
    api.result<Deploy>('deploy').then(setDep).catch(() => undefined)
    api.result<Heldout>('heldout_v1_0').then(setV10).catch(() => undefined)
    api.result<PostHoc>('posthoc_tol4').then(setPost).catch(() => undefined)
    for (const r of ['test2', 'test3']) api.replay(r, 'clean').then((x) => setReplays((p) => ({ ...p, [r]: x }))).catch(() => undefined)
  }, [])

  return (
    <div className="wrap ev-page">
      <header className="ev-head">
        <p className="eyebrow">Evaluation</p>
        <h1>Evaluation on two reserved bearing-test runs</h1>
        <p className="lede">
          Thresholds and the analysis band were frozen using IMS Test 1 only, before Tests 2 and 3 were processed.
          The original pre-registered run (v1.0) is preserved. The current version (v1.1) corrects two data-handling defects found after those results were inspected, so v1.1 is not untouched validation.
          The pre-registered hypothesis was that TOCSIN would warn earlier than a vibration-level alarm, with fewer false alerts.
          <strong> The held-out results do not support that hypothesis.</strong> This page shows what was measured, including where TOCSIN lost.
        </p>
        <div className="counts" role="note">
          <div><strong>2</strong><span>held-out failure events</span></div>
          <div><strong>6</strong><span>held-out undamaged bearings</span></div>
          <div><strong>2</strong><span>held-out run-to-failure tests</span></div>
        </div>
        <p className="small muted">
          With two failure events, any percentage would overstate certainty. Raw counts are shown throughout.
          Protocol: <a href="#protocol">written before held-out data was processed</a>{h ? <> · config <code>{h.config_sha.slice(0, 8)}</code></> : null}.
        </p>
      </header>

      {err && <div className="notice error" role="alert"><Warn /><div>{err}</div></div>}
      {!h && !err && <div className="skeleton" style={{ height: 280 }} aria-label="Loading results" />}

      {h && (
        <>
          <Outcome h={h} />
          <Glance h={h} />
          <Section id="headline" title="Held-out results (current version, v1.1)" sub="IMS Tests 2 and 3, as recorded. Endpoint = last recorded reading of each run. v1.1 fixes two ingestion defects found in the pre-registered v1.0 run (see below).">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead>
                  <tr>
                    <th>Detector</th>
                    <th className="n">Failures alerted</th>
                    {FAULTY.map((f) => <th key={f.label} className="n">First alert before recording endpoint<br />{f.label}</th>)}
                    <th className="n">Undamaged bearings alerted</th>
                    <th className="n">Undamaged alert episodes<br /><span className="muted">(started before final 24 h)</span></th>
                    <th className="n">Alert h per undamaged<br />bearing-day</th>
                  </tr>
                </thead>
                <tbody>
                  {[...MAIN, 'b0_rms_3sigma'].filter((d) => h.detectors[d]).map((d) => {
                    const r = h.detectors[d]
                    const s = r.combined
                    return (
                      <tr key={d} className={d === 'tocsin' ? 'hl' : ''}>
                        <td><span className="swatch" style={{ background: COLOR[d] ?? 'var(--ink-3)' }} />{r.label.split(' (')[0]}<span className="cellnote">{r.label.includes('(') ? r.label.slice(r.label.indexOf('(') + 1, -1) : ''}</span></td>
                        <td className="n"><strong>{s.tp} of {s.n_faulty}</strong></td>
                        {FAULTY.map((f) => {
                          const m = r.runs[f.run]?.per_bearing.find((b) => b.bearing === f.bearing)
                          return <td key={f.label} className="n">{m?.lead_time_h != null ? fmtDuration(m.lead_time_h) : 'missed'}{m && m.alert_active_at_end && m.terminal_alert_lead_time_h != null && m.terminal_alert_lead_time_h !== m.lead_time_h ? <span className="cellnote">sustained {fmtDuration(m.terminal_alert_lead_time_h)}</span> : null}</td>
                        })}
                        <td className="n"><strong>{s.fp} of {s.n_healthy}</strong></td>
                        <td className="n">{s.healthy_alert_episodes} ({s.healthy_alert_episodes_excl_last24h})</td>
                        <td className="n">{fmtNum(s.healthy_alert_hours_per_bearing_day, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Lead time = endpoint minus first alert. "Sustained" = the alert episode still active at the endpoint. The untuned 3σ RMS alarm is shown only as context for a naive fixed alarm.
              Every detector except it received the same per-bearing calibration window ({h.detectors.tocsin.k === 3 ? 'first 72 valid readings' : ''}), the same persistence rule (3 consecutive readings) and the same threshold-selection rule on Test 1.
            </p>
            <Findings h={h} />
          </Section>

          {v10 && <VersionSection v10={v10} v11={h} />}
          <DiagnosisSection h={h} post={post} />

          <Section id="timelines" title="When each detector was in alert" sub="Whole recorded run, clean signals. Each row is one detector on one bearing.">
            {['test2', 'test3'].map((r) => (
              <div key={r} className="tl-block">
                <h3>{r === 'test2' ? 'IMS Test 2' : 'IMS Test 3'} <span className="muted small">· held-out</span></h3>
                {replays[r] ? <AlertTimeline replay={replays[r]} /> : <div className="skeleton" style={{ height: 200 }} />}
              </div>
            ))}
          </Section>

          <Section id="per-bearing" title="Per-bearing detail" sub="All eight held-out bearings, every main detector">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead>
                  <tr><th>Run · bearing</th><th>Label</th>{MAIN.map((d) => <th key={d} className="n">{h.detectors[d].label.split(' (')[0]}: first alert · episodes · alert hours</th>)}</tr>
                </thead>
                <tbody>
                  {['test2', 'test3'].flatMap((r) => [1, 2, 3, 4].map((b) => {
                    const ms = MAIN.map((d) => h.detectors[d].runs[r].per_bearing.find((x) => x.bearing === b)!)
                    return (
                      <tr key={`${r}${b}`}>
                        <td>{r === 'test2' ? 'Test 2' : 'Test 3'} · B{b}</td>
                        <td>{ms[0].faulty ? <strong>failed (end of test)</strong> : 'undamaged'}</td>
                        {ms.map((m, i) => (
                          <td key={i} className="n">{m.lead_time_h != null ? `${fmtDuration(m.lead_time_h)} before endpoint` : 'none'} · {m.alert_episodes} · {fmtNum(m.alert_hours, 1)} h</td>
                        ))}
                      </tr>
                    )
                  }))}
                </tbody>
              </table>
            </div>
          </Section>

          {rob && (
            <Section id="robustness" title="Robustness: same held-out runs, degraded signals" sub="Each condition modifies the raw signal and reruns the full pipeline with the frozen configuration">
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
                <table className="data">
                  <thead>
                    <tr><th>Condition</th><th className="n">Readings valid</th>{MAIN.map((d) => <th key={d} className="n"><span className="swatch" style={{ background: COLOR[d] }} />{h.detectors[d].label.split(' (')[0]}<br /><span className="muted">alerted failures · undamaged with alert · lead times</span></th>)}</tr>
                  </thead>
                  <tbody>
                    {Object.entries(rob.conditions).map(([c, label]) => {
                      const row = rob.grid[c]
                      const vf = row.tocsin.valid_fraction
                      return (
                        <tr key={c} className={c === 'clean' ? 'hl' : ''}>
                          <td>{label}</td>
                          <td className="n">{Object.values(vf).map((v) => `${Math.round(v * 100)}%`).join(' / ')}</td>
                          {MAIN.map((d) => {
                            const s = row[d].combined
                            return <td key={d} className="n"><strong>{s.tp}/2</strong> · {s.fp}/6 · {s.lead_times_h.length ? s.lead_times_h.map((x) => fmtDuration(x)).join(', ') : '—'}</td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                Under added noise, TOCSIN's very late Test 2 bearing 1 alerts (under an hour before the recording endpoint) come from the machine-stopped final readings: the added noise hides the flat signal from the low-signal rule. They are not early detections.
                {' '}Readings valid: share of readings passing validation, for Test 2 / Test 3. Noise is added at a fixed level per bearing, set from its reference-window RMS, like a constant sensor noise floor.
                All complications are seeded and reproducible. In the <Link to="/demo/test2?cond=noise0">demo</Link> you can replay the precomputed analysis for each condition.
              </p>
            </Section>
          )}

          <Section id="ablations" title="Ablations: what each part of TOCSIN contributes" sub="Same held-out runs. Each row removes or changes one ingredient.">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead><tr><th>Variant</th><th className="n">Threshold</th><th className="n">Failures alerted</th><th className="n">Lead times</th><th className="n">Undamaged with alert</th><th className="n">Undamaged alert episodes</th><th className="n">Alert h / undamaged bearing-day</th></tr></thead>
                <tbody>
                  {ABL.filter((d) => h.detectors[d]).map((d) => {
                    const r = h.detectors[d]
                    const s = r.combined
                    return (
                      <tr key={d} className={d === 'tocsin' ? 'hl' : ''}>
                        <td>{r.label}</td><td className="n">{r.theta}{r.k === 1 ? ' (k = 1)' : ''}</td>
                        <td className="n">{s.tp} of 2</td><td className="n">{s.lead_times_h.map((x) => fmtDuration(x)).join(', ') || '—'}</td>
                        <td className="n">{s.fp} of 6</td><td className="n">{s.healthy_alert_episodes}</td><td className="n">{fmtNum(s.healthy_alert_hours_per_bearing_day, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <AblationNote h={h} />
            <p className="small muted" style={{ marginTop: 10 }}>A1 and A2 thresholds were selected on Test 1 with the same rule. A3 keeps TOCSIN's threshold and removes persistence, so it differs from TOCSIN on purpose.</p>
          </Section>

          {sens && (
            <Section id="sensitivity" title="Sensitivity to calibration length and persistence" sub={sens.note}>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
                <table className="data">
                  <thead><tr><th>Reference readings (N)</th><th className="n">Persistence (k)</th>{MAIN.map((d) => <th key={d} className="n">{h.detectors[d].label.split(' (')[0]}<br /><span className="muted">held-out: failures · undamaged with alert</span></th>)}</tr></thead>
                  <tbody>
                    {sens.grid.map((g) => (
                      <tr key={`${g.n_ref}-${g.k}`} className={g.n_ref === 72 && g.k === 3 ? 'hl' : ''}>
                        <td className="n">{g.n_ref}{g.n_ref === 72 && g.k === 3 ? ' (frozen)' : ''}</td><td className="n">{g.k}</td>
                        {MAIN.map((d) => { const s = g[d] as Summary; return <td key={d} className="n">{s.tp}/2 · {s.fp}/6</td> })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section id="tuning" title="Tuning set (IMS Test 1): used to choose thresholds" sub="Not held-out. Shown for transparency, not as evidence of generalisation.">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead><tr><th>Detector</th><th className="n">Threshold</th><th className="n">Failures alerted</th><th className="n">Lead times (B3 inner race, B4 roller)</th><th className="n">Undamaged with alert</th></tr></thead>
                <tbody>
                  {MAIN.map((d) => {
                    const r = h.detectors[d]
                    const s = r.tuning_test1.summary
                    return <tr key={d}><td>{r.label}</td><td className="n">{r.theta}</td><td className="n">{s.tp} of 2</td><td className="n">{s.lead_times_h.map((x) => fmtDuration(x)).join(', ') || '—'}</td><td className="n">{s.fp} of 2</td></tr>
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {dep && <DeploySection dep={dep} />}

          <Section id="metrics" title="Metric definitions" sub="Matched to the label structure: IMS labels say only which bearing was damaged at the end of each test">
            <dl className="defs">
              <dt>Failure alerted</dt><dd>The damaged bearing entered ALERT at least once after its calibration window.</dd>
              <dt>Lead time</dt><dd>Endpoint minus the first ALERT. The endpoint is the <em>last recorded reading</em> of the run, not a measured physical failure time.</dd>
              <dt>Sustained lead time</dt><dd>Endpoint minus the start of the ALERT episode still active at the endpoint.</dd>
              <dt>Undamaged bearing with alert</dt><dd>Any ALERT on a bearing the readme does not list as damaged. This is a strict false-alarm count: alerts in the final 24 h, when a failing neighbour on the same shaft can shake the whole rig, are still counted, and are also reported separately.</dd>
              <dt>Alert hours per undamaged bearing-day</dt><dd>Time spent in ALERT divided by monitored days, summed over undamaged bearings. Each reading counts as the time until the next reading, capped at 20 minutes, so overnight pauses are not counted.</dd>
              <dt>Score</dt><dd>Robust z-value of the strongest defect-band prominence against the bearing's own first 72 valid readings. It is not a probability.</dd>
            </dl>
          </Section>

          <Section id="limitations" title="Limitations" sub="Read these before relying on any number above">
            <ul className="limits">
              <li><strong>Two held-out failures.</strong> The held-out set contains one outer-race failure in each of two tests. That is enough to show the method working (or not) on unseen data, not to estimate a reliable detection rate.</li>
              <li><strong>Fault onset is unlabelled.</strong> Lead times are measured to the recording endpoint (the last recorded reading), not to a physical failure time, so they are not time-to-failure guarantees.</li>
              <li><strong>One rig, constant speed.</strong> All tests ran at a nominal 2000 RPM under a constant 6000 lb load. Changing speed and load were not tested, and speed is assumed rather than measured.</li>
              <li><strong>Fault-type naming is a hint.</strong> The implicated band names the defect family whose frequency is strongest. On held-out data only outer-race failures exist, so naming of inner-race or rolling-element faults is not validated there.</li>
              <li><strong>Complications are simulated.</strong> Noise and missing data are injected into real recordings with fixed seeds. Real sensor faults can look different.</li>
              <li><strong>Bench data, not a plant.</strong> No factory deployment or inspection outcome is claimed.</li>
            </ul>
          </Section>

          <Section id="protocol" title="Protocol" sub="Pre-registered before any held-out reading was processed">
            <ul className="limits">
              <li>Tuning: IMS Test 1 (first channel per bearing). Held-out: IMS Tests 2 and 3, every bearing, whatever the outcome.</li>
              <li>Calibration: each detector learns each bearing's reference from its first 72 valid readings. No later reading is used.</li>
              <li>Threshold rule: the smallest threshold for which every undamaged Test 1 bearing spends at most 1% of its monitored readings in ALERT. Persistence k = 3 was fixed in advance.</li>
              <li>Full text, including the change log: <code>docs/EVALUATION_PROTOCOL.md</code> in the repository.</li>
            </ul>
          </Section>

          <Section id="reproduce" title="Reproduce these numbers" sub="About 45 minutes on a laptop. Needs about 1.2 GB free disk; raw data is streamed from the archive and never fully extracted.">
            <h3 className="small muted" style={{ margin: '4px 0 8px' }}>macOS / Linux</h3>
            <pre className="code" tabIndex={0} aria-label="Commands (scrolls horizontally)"><code>{`python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python scripts/fetch_data.py          # download + verify SHA-256 of the NASA archive
.venv/bin/python scripts/extract_features.py test1 --bands 1000-9000,2000-8000,4000-9000
.venv/bin/python scripts/tune.py                # Test 1 only -> config/frozen.json
.venv/bin/python scripts/extract_features.py test2 --bands 2000-8000 --conditions all --spectra clean,noise10,noise0,drop20
.venv/bin/python scripts/extract_features.py test3 --bands 2000-8000 --conditions all --spectra clean,noise10,noise0,drop20
.venv/bin/python scripts/evaluate.py            # -> results/heldout.json, robustness.json, sensitivity.json
.venv/bin/python scripts/build_artifacts.py     # -> artifacts/ served by the app
# or all of the above: PYTHON=.venv/bin/python sh scripts/reproduce.sh`}</code></pre>
            <h3 className="small muted" style={{ margin: '12px 0 8px' }}>Windows (PowerShell)</h3>
            <pre className="code" tabIndex={0} aria-label="Commands (scrolls horizontally)"><code>{String.raw`py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python scripts\fetch_data.py
.venv\Scripts\python scripts\extract_features.py test1 --bands 1000-9000,2000-8000,4000-9000
.venv\Scripts\python scripts\tune.py
.venv\Scripts\python scripts\extract_features.py test2 --bands 2000-8000 --conditions all --spectra clean,noise10,noise0,drop20
.venv\Scripts\python scripts\extract_features.py test3 --bands 2000-8000 --conditions all --spectra clean,noise10,noise0,drop20
.venv\Scripts\python scripts\evaluate.py
.venv\Scripts\python scripts\build_artifacts.py`}</code></pre>
            <p className="small muted">Shortcut without the raw archive: <code>.venv/bin/python scripts/fetch_artifacts.py</code> (Windows: <code>.venv\Scripts\python</code>) downloads the verified demo bundle, and the release's feature bundle lets <code>evaluate.py</code> rerun without the 1 GB NASA download.</p>
            <p className="small muted">Requires <code>bsdtar</code> (libarchive) to stream the RAR archives. Every result file records the frozen-config hash. Generated {new Date(h.generated).toUTCString()}.</p>
          </Section>
        </>
      )}
    </div>
  )
}

const SHORT: Record<string, string> = { tocsin: 'TOCSIN', b0_rms: 'RMS alarm', b1_iforest: 'Isolation forest' }
const leadOf = (r: { runs: Record<string, { per_bearing: BearingMetrics[] }> }, run: string, b: number) =>
  r.runs[run]?.per_bearing.find((x) => x.bearing === b)?.lead_time_h ?? null
const leadTxt = (v: number | null) => (v == null ? 'missed' : fmtDuration(v))

function Outcome({ h }: { h: Heldout }) {
  const d = h.detectors
  const quietest = MAIN.reduce((a, k) =>
    (d[k].combined.healthy_alert_hours_per_bearing_day ?? Infinity) < (d[a].combined.healthy_alert_hours_per_bearing_day ?? Infinity) ? k : a, MAIN[0])
  const t2 = leadOf(d.tocsin, 'test2', 1)
  return (
    <section id="outcome" className="ev-section" aria-labelledby="outcome-h">
      <div className="panel panel-body outcome">
        <h2 id="outcome-h">Outcome in one paragraph</h2>
        <p>
          <strong>Claim withdrawn: “earlier and quieter”.</strong> On the two held-out failures, TOCSIN alerted on {d.tocsin.combined.tp} of 2.
          The RMS alarm alerted on {d.b0_rms.combined.tp} of 2 and the isolation forest on {d.b1_iforest.combined.tp} of 2.
          TOCSIN {t2 == null ? 'did not alert on' : `alerted ${fmtDuration(t2)} before the recording endpoint on`} Test 2 bearing 1, where the RMS alarm warned {leadTxt(leadOf(d.b0_rms, 'test2', 1))} before the recording endpoint.
          On Test 3 bearing 3, TOCSIN's first alert came before the other two detectors': {leadTxt(leadOf(d.tocsin, 'test3', 3))}, against {leadTxt(leadOf(d.b0_rms, 'test3', 3))} for the RMS alarm and {leadTxt(leadOf(d.b1_iforest, 'test3', 3))} for the isolation forest{d.b0_rms_3sigma ? ` (a stricter 3-sigma RMS alarm warned ${leadTxt(leadOf(d.b0_rms_3sigma, 'test3', 3))} before)` : ''}.
          On undamaged bearings, {SHORT[quietest]} spent the least time in alert ({fmtNum(d[quietest].combined.healthy_alert_hours_per_bearing_day, 2)} h per bearing-day).
          All three detectors alerted on some undamaged bearings, mostly in each run's final day.
        </p>
        <p className="muted small">
          What TOCSIN does show on this data: alerts that name a defect band and give the evidence, fewer alert-hours on undamaged bearings than the other two detectors, and an earlier first alert than those two on one of the two failures.
          What it does not show: reliable early warning. Its own ablation found that a simpler broadband envelope level, with no fault-frequency bands, did better on these two runs.
          With two failure events, none of these differences is statistically meaningful.
        </p>
      </div>
    </section>
  )
}

function VersionSection({ v10, v11 }: { v10: Heldout; v11: Heldout }) {
  const versions: [string, Heldout][] = [['v1.0 (pre-registered)', v10], ['v1.1 (current)', v11]]
  return (
    <Section id="versions" title="Pre-registered run (v1.0) and the corrected version (v1.1)" sub="v1.0 is the clean held-out result. v1.1 was produced after v1.0's results were seen, so its numbers are not clean held-out evidence.">
      <ul className="limits" style={{ marginBottom: 14 }}>
        <li><strong>Defect 1: reading order.</strong> Test 3's archive stores one file (18 Apr 02:42) between 4 Apr 19:01 and 19:11. v1.0 analysed it out of time order. v1.1 sorts by timestamp.</li>
        <li><strong>Defect 2: machine-stopped readings accepted.</strong> The final readings of Tests 2 and 3 are flat on all four channels (1–6% of normal level). v1.0 scored them, and TOCSIN's only Test 2 bearing 1 alert came from them. v1.1 gives no verdict for a reading below 10% of the bearing's normal level. This affects no Test 1 reading, so no threshold changed.</li>
      </ul>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
        <table className="data">
          <thead><tr><th>Detector</th><th>Version</th><th className="n">Failures alerted</th><th className="n">Test 2 B1 first alert</th><th className="n">Test 3 B3 first alert</th><th className="n">Undamaged with alert</th><th className="n">Alert h / undamaged bearing-day</th></tr></thead>
          <tbody>
            {MAIN.flatMap((k) => versions.map(([label, src]) => {
              const r = src.detectors[k]
              return (
                <tr key={`${k}${label}`} className={k === 'tocsin' ? 'hl' : ''}>
                  <td>{SHORT[k]}</td><td>{label}</td><td className="n">{r.combined.tp} of 2</td>
                  <td className="n">{leadTxt(leadOf(r, 'test2', 1))}</td><td className="n">{leadTxt(leadOf(r, 'test3', 3))}</td>
                  <td className="n">{r.combined.fp} of 6</td><td className="n">{fmtNum(r.combined.healthy_alert_hours_per_bearing_day, 2)}</td>
                </tr>
              )
            }))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>v1.0's TOCSIN “alert” on Test 2 bearing 1, 10 minutes before the recording endpoint, was produced by machine-stopped readings, not by fault evidence.</p>
    </Section>
  )
}

function DiagnosisSection({ h, post }: { h: Heldout; post: PostHoc | null }) {
  const t = h.detectors.tocsin
  return (
    <Section id="diagnosis" title="Why TOCSIN missed Test 2 bearing 1" sub="Post-hoc diagnosis. It explains the miss; it is not held-out evidence for any fix.">
      <ul className="limits">
        <li>
          On both held-out outer-race failures, the envelope spectrum shows a strong tone at <strong>about 231 Hz</strong>. On Test 2 bearing 1 it is roughly 30× the local median from 17 Feb onward.
          The outer-race frequency computed from published geometry at the nominal 2000 RPM is 236.4 Hz. TOCSIN's ±2% window runs from 231.7 to 241.1 Hz, so it <strong>excludes the tone</strong>. The tone also falls inside the background estimate, which lowers the measured prominence.
        </li>
        <li>The likely causes are a shaft speed slightly below nominal, or geometry differing from the published values. The dataset records no speed, so this cannot be settled here.</li>
        <li>You can see it in the replay: <Link to="/demo/test2?cond=clean&b=1&t=900">Test 2, bearing 1, 18 Feb</Link>. The tallest peak sits just left of the shaded outer-race window.</li>
      </ul>
      {post ? (
        <div className="table-scroll" style={{ marginTop: 14 }} tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
          <table className="data">
            <thead><tr><th>Variant</th><th className="n">Threshold (Test 1 rule)</th><th className="n">Failures alerted</th><th className="n">Test 2 B1</th><th className="n">Test 3 B3</th><th className="n">Undamaged with alert</th><th className="n">Alert h / undamaged bearing-day</th></tr></thead>
            <tbody>
              <tr><td>TOCSIN v1.1, ±2% window (deployed)</td><td className="n">{t.theta}</td><td className="n">{t.combined.tp} of 2</td><td className="n">{leadTxt(leadOf(t, 'test2', 1))}</td><td className="n">{leadTxt(leadOf(t, 'test3', 3))}</td><td className="n">{t.combined.fp} of 6</td><td className="n">{fmtNum(t.combined.healthy_alert_hours_per_bearing_day, 2)}</td></tr>
              <tr><td><strong>Post-hoc:</strong> ±4% window</td><td className="n">{post.theta}</td><td className="n">{post.combined.tp} of 2</td>
                <td className="n">{leadTxt(post.runs.test2.find((b) => b.bearing === 1)?.lead_time_h ?? null)}</td>
                <td className="n">{leadTxt(post.runs.test3.find((b) => b.bearing === 3)?.lead_time_h ?? null)}</td>
                <td className="n">{post.combined.fp} of 6</td><td className="n">{fmtNum(post.combined.healthy_alert_hours_per_bearing_day, 2)}</td></tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 10 }}>The ±4% variant reuses the pre-registered threshold rule on Test 1. It was designed after the held-out results were seen, so a fresh run-to-failure dataset would be needed to validate it. The deployed detector stays at ±2%.</p>
        </div>
      ) : null}
    </Section>
  )
}


function AblationNote({ h }: { h: Heldout }) {
  const t = h.detectors.tocsin
  const a1 = h.detectors.a1_broadband_env
  if (!a1) return null
  const a1Better = a1.combined.tp >= t.combined.tp && (a1.combined.healthy_alert_hours_per_bearing_day ?? 9) <= (t.combined.healthy_alert_hours_per_bearing_day ?? 9)
  return (
    <div className="findings">
      <h3>What the ablations say</h3>
      <ul>
        {a1Better ? (
          <li>
            <strong>Removing the defect bands helped on this data.</strong> A1 uses the broadband envelope level alone, with no fault frequencies. It alerted on {a1.combined.tp} of 2 failures, against TOCSIN's {t.combined.tp},
            and spent {fmtNum(a1.combined.healthy_alert_hours_per_bearing_day, 2)} h per undamaged bearing-day in alert, against {fmtNum(t.combined.healthy_alert_hours_per_bearing_day, 2)}.
            As configured, with a ±2% window at nominal speed, the defect-band step cost detections rather than adding specificity. See the diagnosis above.
          </li>
        ) : (
          <li>A1 (no defect bands) alerted on {a1.combined.tp} of 2 failures, against TOCSIN's {t.combined.tp}.</li>
        )}
        <li>Removing persistence (A3) raised the alert episodes on undamaged bearings from {t.combined.healthy_alert_episodes} to {h.detectors.a3_no_persistence?.combined.healthy_alert_episodes}. The persistence gate is doing its job.</li>
      </ul>
    </div>
  )
}

interface VerRec { time: string; label: string; build_commit: string; analyze_server_ms: { median: number; max: number; n: number }; analyze_round_trip_ms: { median: number }; passed: number; failed: number }

function DeploySection({ dep }: { dep: Deploy }) {
  const d = dep as { hardware?: { summary?: string }; rows?: { name: string; value: string; includes: string }[]; note?: string }
  const [ver, setVer] = useState<VerRec[] | null>(null)
  useEffect(() => { api.result<VerRec[]>('deploy-verification').then(setVer).catch(() => undefined) }, [])
  return (
    <Section id="deployment" title="Deployment measurements" sub="Proposed deployment: a browser app calling one small API service. No GPU or edge hardware needed.">
      {ver && ver.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Deployed service measurements" style={{ marginBottom: 16 }}>
          <table className="data">
            <thead><tr><th>Deployed Railway service</th><th className="n">Server-side analysis per reading (median / max)</th><th className="n">Round trip from the build machine (median)</th><th className="n">Checks passed</th></tr></thead>
            <tbody>
              {ver.filter((v) => v.analyze_server_ms).map((v) => (
                <tr key={v.time}><td>{v.label} · {v.time.slice(0, 10)} · commit <code>{v.build_commit?.slice(0, 7)}</code></td>
                  <td className="n">{v.analyze_server_ms.median.toFixed(1)} / {v.analyze_server_ms.max.toFixed(1)} ms (n = {v.analyze_server_ms.n})</td>
                  <td className="n">{(v.analyze_round_trip_ms.median / 1000).toFixed(1)} s</td>
                  <td className="n">{v.passed} / {v.passed + v.failed}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>Round trips are dominated by uploading a 0.55 MB reading over the build machine's own connection. The server-side time is the analysis itself.</p>
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 8 }}>Laptop measurements: {d.hardware?.summary ?? 'build machine'}.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
        <table className="data">
          <thead><tr><th>Measurement</th><th className="n">Value</th><th>What it includes</th></tr></thead>
          <tbody>
            {(d.rows ?? []).map((r) => (
              <tr key={r.name}><td>{r.name}</td><td className="n">{r.value}</td><td className="small">{r.includes}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.note && <p className="small muted" style={{ marginTop: 10 }}>{d.note}</p>}
    </Section>
  )
}

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="ev-section" aria-labelledby={`${id}-h`}>
      <div className="ev-section-head">
        <h2 id={`${id}-h`}>{title}</h2>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="panel panel-body">{children}</div>
    </section>
  )
}
