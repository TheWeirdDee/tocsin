import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDuration, fmtNum, fmtStamp } from '../lib/format'
import type { BearingMetrics, Summary } from '../lib/types'

interface Det { label: string; combined: Summary; runs: Record<string, { per_bearing: BearingMetrics[] }> }
interface Heldout { detectors: Record<string, Det> }
interface PRF { tp: number; fp: number; fn: number; precision_frac: string; recall_frac: string; f1: number | null }
interface Derived {
  versions: Record<string, Record<string, { all_alerts: PRF; alerts_starting_before_final_24h: PRF }>>
  fault_family_identification_v1_1: { run: string; role: string; bearing: number; label: string; expected_family: string; alert_onsets: number; families_at_onsets: string[]; onsets_matching: number }[]
}
interface Rob { grid: Record<string, Record<string, { combined: Summary }>>; conditions: Record<string, string> }
interface Ex {
  A_alert_kept_through_invalid: { run: string; condition: string; bearing: number; timestamp: string; reason: string; url: string } | null
  B_persistence_resumes_after_gap: { run: string; condition: string; bearing: number; count_before: number; count_during_gap: number; count_after: number; state_after: string; url: string } | null
  C_invalid_never_normal: { run: string; condition: string; bearing: number; timestamp: string; url: string } | null
  exhaustive_check: { invalid_readings_checked: number; invalid_readings_shown_with_a_verdict: number }
}

const NAMES: Record<string, string> = { tocsin: 'TOCSIN (submitted)', b0_rms: 'RMS level alarm', b1_iforest: 'Isolation forest', a1_broadband_env: 'Simpler variant A1 (ablation)' }
const FAM: Record<string, string> = { BPFO: 'outer race', BPFI: 'inner race', '2xBSF': 'rolling element' }
const f1 = (x: number | null) => (x == null ? '—' : x.toFixed(2))

/** Answers the six evaluation questions with counts, plus metric rationale and robustness demonstrations. */
export function Glance({ h }: { h: Heldout }) {
  const [d, setD] = useState<Derived | null>(null)
  const [rob, setRob] = useState<Rob | null>(null)
  const [ex, setEx] = useState<Ex | null>(null)
  useEffect(() => {
    api.result<Derived>('derived_metrics').then(setD).catch(() => undefined)
    api.result<Rob>('robustness').then(setRob).catch(() => undefined)
    api.result<Ex>('robustness_examples').then(setEx).catch(() => undefined)
  }, [])
  const t = h.detectors.tocsin.combined
  const lead = (k: string, run: string, b: number) => h.detectors[k]?.runs[run]?.per_bearing.find((x) => x.bearing === b)?.lead_time_h ?? null
  const noisy = rob ? ['noise20', 'noise10', 'noise0'].map((c) => { const k = rob.grid[c].tocsin.combined; return `${rob.conditions[c].replace('Added sensor noise, ', '')}: ${k.tp}/2 failures (first alerts ${k.lead_times_h.map((x) => fmtDuration(x)).join(' and ')} before the endpoint), ${k.fp}/6 undamaged` }).join(' · ') : '…'
  const v11 = d?.versions['v1.1_current']
  const v10 = d?.versions['v1.0_preregistered']

  return (
    <>
      <section id="glance" className="ev-section" aria-labelledby="glance-h">
        <div className="ev-section-head">
          <h2 id="glance-h">At a glance</h2>
          <p className="muted">Current version (v1.1), held-out IMS Tests 2 and 3. Denominators are bearings: 2 damaged, 6 undamaged.</p>
        </div>
        <dl className="glance">
          <div><dt>How many damaged bearings alerted?</dt><dd><b>{t.tp} of 2</b> for TOCSIN. The RMS alarm and isolation forest: 2 of 2.</dd></div>
          <div><dt>How many undamaged bearings alerted?</dt><dd><b>{t.fp} of 6</b> for TOCSIN (RMS 6 of 6, isolation forest 3 of 6). Most of these alerts started in each run's final day.</dd></div>
          <div><dt>How much time was spent in alert?</dt><dd><b>{fmtNum(t.healthy_alert_hours_per_bearing_day, 2)} h</b> per undamaged bearing-day for TOCSIN (RMS {fmtNum(h.detectors.b0_rms.combined.healthy_alert_hours_per_bearing_day, 2)}, isolation forest {fmtNum(h.detectors.b1_iforest.combined.healthy_alert_hours_per_bearing_day, 2)}).</dd></div>
          <div><dt>When did alerts occur?</dt><dd>Test 3 bearing 3: TOCSIN <b>{fmtDuration(lead('tocsin', 'test3', 3))}</b> before the recording endpoint (RMS {fmtDuration(lead('b0_rms', 'test3', 3))}). Test 2 bearing 1: TOCSIN <b>no alert</b> (RMS {fmtDuration(lead('b0_rms', 'test2', 1))}).</dd></div>
          <div><dt>What happened under noise and missing data?</dt><dd>With added noise, {noisy}. Caution: at 10 and 0 dB, the Test 2 bearing 1 “alerts” come within an hour of the endpoint, from machine-stopped readings that the added noise hides. They are not early detections. No failed reading was ever shown with a verdict{ex ? ` (${ex.exhaustive_check.invalid_readings_checked.toLocaleString()} checked)` : ''}.</dd></div>
          <div><dt>What was frozen, and what was explored afterwards?</dt><dd>Frozen before held-out processing: band, thresholds, persistence, calibration (v1.0). After seeing results: data-handling fixes (v1.1), the ±4% window, and the simpler-variant comparison.</dd></div>
        </dl>
      </section>

      <section id="prf" className="ev-section" aria-labelledby="prf-h">
        <div className="ev-section-head">
          <h2 id="prf-h">Detection: precision, recall and F1 per bearing</h2>
          <p className="muted">The unit is one bearing in one held-out test. A bearing counts as a predicted fault if it received any alert. Fractions show the raw counts behind each ratio.</p>
        </div>
        <div className="panel panel-body">
          {v11 && v10 ? (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Precision, recall and F1 table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead>
                  <tr><th>Detector</th><th className="n">Recall v1.1</th><th className="n">Precision v1.1</th><th className="n">F1 v1.1</th><th className="n">F1 v1.0 (pre-registered)</th><th className="n">Precision v1.1, alerts starting before the final 24 h</th></tr>
                </thead>
                <tbody>
                  {['tocsin', 'b0_rms', 'b1_iforest', 'a1_broadband_env'].map((k) => (
                    <tr key={k} className={k === 'tocsin' ? 'hl' : ''}>
                      <td>{NAMES[k]}</td>
                      <td className="n">{v11[k].all_alerts.recall_frac}</td>
                      <td className="n">{v11[k].all_alerts.precision_frac}</td>
                      <td className="n">{f1(v11[k].all_alerts.f1)}</td>
                      <td className="n">{f1(v10[k].all_alerts.f1)}</td>
                      <td className="n">{v11[k].alerts_starting_before_final_24h.precision_frac}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="skeleton" style={{ height: 160 }} />}
          <div className="findings">
            <h3>Why these metrics</h3>
            <ul>
              <li>The IMS labels say only which bearing was damaged <em>by the end</em> of each test. There is no onset time, so per-reading fault labels would have to be invented. TOCSIN therefore reports event-level results per bearing (alerted or not, and when) instead of per-reading classification scores.</li>
              <li>With 2 damaged and 6 undamaged bearings, one bearing moves recall by 50 points. The fractions are the result, and the ratios are only a summary of them.</li>
              <li>The "before the final 24 h" column was pre-registered as a sub-analysis. When a bearing fails, the whole shared shaft shakes, and late alerts on its neighbours may reflect that coupling rather than their own condition.</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="fault-id" className="ev-section" aria-labelledby="faultid-h">
        <div className="ev-section-head">
          <h2 id="faultid-h">Identifying the potential fault condition</h2>
          <p className="muted">Each TOCSIN alert names the defect family whose frequency band rose most. Here that name is compared with the dataset label for damaged bearings.</p>
        </div>
        <div className="panel panel-body">
          {d ? (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Fault family identification table">
              <table className="data">
                <thead><tr><th>Run · bearing</th><th>Set</th><th>Dataset label</th><th className="n">Alert onsets</th><th>Family named at the onsets</th><th className="n">Matching the label</th></tr></thead>
                <tbody>
                  {d.fault_family_identification_v1_1.map((r) => (
                    <tr key={`${r.run}${r.bearing}`} className={r.role === 'held-out' ? 'hl' : ''}>
                      <td>{r.run.replace('test', 'Test ')} · B{r.bearing}</td>
                      <td>{r.role === 'held-out' ? 'held-out' : 'tuning (not evidence)'}</td>
                      <td>{r.label}</td>
                      <td className="n">{r.alert_onsets}</td>
                      <td>{r.families_at_onsets.length ? [...new Set(r.families_at_onsets)].map((f) => FAM[f] ?? f).join(', ') : 'no alert'}</td>
                      <td className="n">{r.alert_onsets ? `${r.onsets_matching} of ${r.alert_onsets}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="skeleton" style={{ height: 140 }} />}
          <p className="small muted" style={{ marginTop: 10 }}>Held-out evidence is a single alerted failure, so it shows that the naming can work, not how often it is right. On the tuning set, the roller-element failure was named as the outer race.</p>
        </div>
      </section>

      <section id="no-switch" className="ev-section" aria-labelledby="noswitch-h">
        <div className="ev-section-head"><h2 id="noswitch-h">Why the simpler variant was not adopted</h2></div>
        <div className="panel panel-body">
          <p style={{ maxWidth: '90ch', color: 'var(--ink-2)' }}>
            The ablation without defect bands (A1) alerted on both held-out failures and spent the least time alerting on undamaged bearings. Making it the default <em>now</em>,
            because of these results, would choose the final solution using its own test data. PS01 requires evaluation on data not used to tune the final solution, and these
            two recordings could then no longer serve as that test. TOCSIN therefore stays the submitted detector. A1 is a candidate to evaluate, with a frozen procedure, on recordings not yet seen.
          </p>
        </div>
      </section>

      {ex && (
        <section id="state-logic" className="ev-section" aria-labelledby="statelogic-h">
          <div className="ev-section-head">
            <h2 id="statelogic-h">Degraded data: what the state logic does</h2>
            <p className="muted">Verified examples found in the stored replays (seeded “40% gaps” condition), plus an exhaustive check.</p>
          </div>
          <div className="panel panel-body">
            <ul className="limits">
              {ex.C_invalid_never_normal && <li><strong>Missing data does not become “normal”.</strong> {ex.C_invalid_never_normal.run.replace('test', 'Test ')} bearing {ex.C_invalid_never_normal.bearing}, {fmtStamp(ex.C_invalid_never_normal.timestamp)}: the reading fails the checks and shows “No valid data”, with the previous Normal state kept and dated. <Link to={ex.C_invalid_never_normal.url}>Open</Link></li>}
              {ex.A_alert_kept_through_invalid && <li><strong>A failed reading does not clear an alert.</strong> {ex.A_alert_kept_through_invalid.run.replace('test', 'Test ')} bearing {ex.A_alert_kept_through_invalid.bearing}, {fmtStamp(ex.A_alert_kept_through_invalid.timestamp)}: the bearing is in ALERT, the reading is invalid, and the alert remains. <Link to={ex.A_alert_kept_through_invalid.url}>Open</Link></li>}
              {ex.B_persistence_resumes_after_gap && <li><strong>Valid data resumes the count.</strong> {ex.B_persistence_resumes_after_gap.run.replace('test', 'Test ')} bearing {ex.B_persistence_resumes_after_gap.bearing}: {ex.B_persistence_resumes_after_gap.count_before} of 3 readings above threshold, then an invalid reading (count stays {ex.B_persistence_resumes_after_gap.count_during_gap}), then the next valid reading makes it {ex.B_persistence_resumes_after_gap.count_after} of 3 and the state becomes {ex.B_persistence_resumes_after_gap.state_after}. <Link to={ex.B_persistence_resumes_after_gap.url}>Open</Link></li>}
              <li><strong>Exhaustive check:</strong> across every stored replay and all three detectors, {ex.exhaustive_check.invalid_readings_checked.toLocaleString()} failed readings were found, and {ex.exhaustive_check.invalid_readings_shown_with_a_verdict} of them were shown with a verdict.</li>
              <li><strong>Noise degrades results.</strong> The robustness table below reports it per condition. These are synthetic perturbations of real recordings, and they do not cover every real sensor fault.</li>
            </ul>
            <p className="small muted" style={{ marginTop: 10 }}>The bearing in these examples is undamaged according to the labels. Its late alert is one of the final-day alerts counted above.</p>
          </div>
        </section>
      )}
    </>
  )
}
