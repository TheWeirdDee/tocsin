import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpectrumChart } from '../components/charts/SpectrumChart'
import { Arrow } from '../components/Icons'
import { DEMO_URL, FRONTEND_COMMIT, REPO_URL } from '../components/Layout'
import { LivePreview } from '../components/LivePreview'
import { StateBadge } from '../components/StateBadge'
import { api, type FrozenConfig } from '../lib/api'
import { fmtDuration, fmtNum, fmtStamp, hoursBetween } from '../lib/format'
import { useLandingMotion } from '../lib/landingMotion'
import type { BearingMetrics, Evidence, SpectrumResp, Summary } from '../lib/types'
import './landing.css'

interface Det { label: string; theta: number; combined: Summary; runs: Record<string, { per_bearing: BearingMetrics[] }> }
interface Heldout { detectors: Record<string, Det> }
interface PRF { precision_frac: string; recall_frac: string; f1: number | null }
interface Derived { versions: Record<string, Record<string, { all_alerts: PRF; alerts_starting_before_final_24h: PRF }>> }
interface RobEx {
  A_alert_kept_through_invalid: { run: string; bearing: number; timestamp: string; url: string } | null
  C_invalid_never_normal: { run: string; bearing: number; timestamp: string; url: string; reason: string } | null
  exhaustive_check: { invalid_readings_checked: number; invalid_readings_shown_with_a_verdict: number }
}
interface Verification { analyze_server_ms?: { median: number; n: number } }

const ROWS = [
  { id: 'tocsin', name: 'TOCSIN (defect-band envelope, the submitted detector)' },
  { id: 'b0_rms', name: 'RMS level alarm (baseline)' },
  { id: 'b1_iforest', name: 'Isolation forest (baseline)' },
  { id: 'a1_broadband_env', name: 'Simpler variant: envelope level, no defect bands (ablation)' },
]

const f1 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2))

export default function Landing() {
  const [h, setH] = useState<Heldout | null>(null)
  const [der, setDer] = useState<Derived | null>(null)
  const [cfg, setCfg] = useState<FrozenConfig | null>(null)
  const [alertEv, setAlertEv] = useState<{ ev: Evidence; end: string } | null>(null)
  const [missSpec, setMissSpec] = useState<SpectrumResp | null>(null)
  const [rob, setRob] = useState<RobEx | null>(null)
  const [ver, setVer] = useState<Verification | null>(null)
  const [apiCommit, setApiCommit] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useLandingMotion(root)

  useEffect(() => {
    api.result<Heldout>('heldout').then(setH).catch(() => undefined)
    api.result<Derived>('derived_metrics').then(setDer).catch(() => undefined)
    api.result<RobEx>('robustness_examples').then(setRob).catch(() => undefined)
    api.result<Verification[]>('deploy-verification').then((v) => setVer(Array.isArray(v) ? v[v.length - 1] : null)).catch(() => undefined)
    api.config().then(setCfg).catch(() => undefined)
    api.health().then((x) => setApiCommit((x as { build_commit?: string }).build_commit ?? null)).catch(() => undefined)
    // The worked alert is TOCSIN's first alert onset on IMS Test 3 bearing 3, read from the replay output.
    api.replay('test3', 'clean').then((r) => {
      const ev = r.bearings['3']?.alert_events[0]
      if (ev) setAlertEv({ ev, end: r.times[r.times.length - 1] })
    }).catch(() => undefined)
    api.spectrum('test2', 1, 900, 'clean').then(setMissSpec).catch(() => undefined)
  }, [])

  const lead = (d: string, run: string, b: number) => h?.detectors[d]?.runs[run]?.per_bearing.find((x) => x.bearing === b)?.lead_time_h ?? null
  const outerBand = cfg?.band_markers.find((m) => m.family === 'BPFO' && m.harmonic === 1)
  const cur = der?.versions['v1.1_current']

  return (
    <div className="landing" ref={root}>
      <section className="hero">
        <div className="wrap hero-inner">
          <Link to="/evaluation" className="announce">
            <span className="accent">Held-out result</span> TOCSIN alerted on 1 of 2 bearing failures. See why <Arrow />
          </Link>
          <h1>Understand changes in machine <span className="accent-word">vibration</span>.<br />See the evidence behind each warning.</h1>
          <p className="hero-lede">
            TOCSIN is a browser-based tool for analyzing bearing vibration recordings. Try a provided sample, inspect changes over time, and compare the warnings from different detection methods.
          </p>
          <div className="hero-cta">
            <Link to="/analyze?sample=late" className="btn btn-pill btn-lg">Analyze a sample <span className="disc" aria-hidden="true"><Arrow /></span></Link>
            <Link to="/demo/test3?guide=alert&b=3" className="btn-link">Explore a recorded test <Arrow /></Link>
            <a href={DEMO_URL} className="btn-link" target="_blank" rel="noopener noreferrer">Watch the demo (3 min, YouTube) <Arrow /></a>
          </div>
          <p className="hero-scope">Research prototype using recorded laboratory data, not a production monitoring system. Currently supports the documented IMS bearing-test setup.</p>
        </div>
        <div className="wrap">
          <LivePreview />
        </div>
      </section>

      <section className="wrap sec">
        <div className="split">
          <div>
            <p className="eyebrow"><span className="tick" />The basics</p>
            <h2>What is a vibration recording?</h2>
          </div>
          <div className="muted" style={{ maxWidth: '60ch' }}>
            <p>
              Bearings help shafts rotate smoothly inside machines such as motors, pumps and fans. A vibration sensor measures their movement and records it as numbers over time.
            </p>
            <p style={{ marginTop: 12 }}>
              Changes in those measurements can be clues to damage. TOCSIN helps you examine the changes and the evidence behind a warning.
            </p>
            <p style={{ marginTop: 12 }}>
              The examples here come from laboratory bearing tests. They are measurements shown as charts, not audio recordings to listen to. TOCSIN has been evaluated only on these laboratory tests, not on the machines named above.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap sec">
        <div className="sec-head center">
          <p className="eyebrow"><span className="tick" />Start here</p>
          <h2>Start with a sample. Then investigate the recording.</h2>
          <p className="muted sec-lede">
            Sample analysis runs on the server when you request it. Recorded-test exploration displays results computed beforehand.
          </p>
        </div>
        <div className="entry-grid">
          <Link to="/analyze?sample=late" className="entry">
            <span className="entry-tag">Step 1 · runs on request</span>
            <h3>Analyze a provided reading</h3>
            <p>Run the analysis on a provided sample or a compatible file. See its measurements and how they compare with a stored reference.</p>
            <span className="go">Open <Arrow /></span>
          </Link>
          <Link to="/demo/test3?guide=alert&b=3" className="entry">
            <span className="entry-tag">Step 2 · computed beforehand</span>
            <h3>Explore a warning over time</h3>
            <p>Move through a laboratory test to see when a warning appeared and what supported it.</p>
            <span className="go">Open <Arrow /></span>
          </Link>
          <Link to="/evaluation#glance" className="entry">
            <span className="entry-tag">Step 3 · counts, not percentages</span>
            <h3>Compare the results and limitations</h3>
            <p>See how TOCSIN did against simpler methods, including the failure it missed.</p>
            <span className="go">Open <Arrow /></span>
          </Link>
        </div>
        <p className="small muted" style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span>Go deeper:</span>
          <Link to="/demo/test2?guide=miss&b=1">Inspect the missed failure</Link>
          <Link to="/demo/test2?guide=gaps&cond=gaps&b=1">See missing-data handling</Link>
        </p>
      </section>

      <section className="wrap sec">
        <div className="sec-head center">
          <p className="eyebrow"><span className="tick" />How it works</p>
          <h2>Three steps for every reading</h2>
          <p className="muted sec-lede">The same steps run in the replay and on an uploaded file.</p>
        </div>
        <div className="steps-split">
          <ol className="steps">
            <li>
              <span className="step-n">01</span>
              <h3>First, check the reading</h3>
              <p>Missing or unusable data should not look reassuring. TOCSIN checks supported quality conditions before producing a verdict.</p>
            </li>
            <li>
              <span className="step-n">02</span>
              <h3>Then, compare the vibration</h3>
              <p>It compares the strength of each bearing fault's vibration pattern with a reference learned from the same bearing's early recordings.</p>
            </li>
            <li>
              <span className="step-n">03</span>
              <h3>Finally, inspect the evidence</h3>
              <p>See which frequency band changed, how far it moved from the reference and whether the change persisted across valid readings.</p>
            </li>
          </ol>
          <div className="panel pipeline-card" aria-label="The three steps applied to one real reading">
            <div className="pc-head"><span className="mono-label">Reading · IMS Test 3 · bearing 3</span><span className="mono-label">{alertEv ? fmtStamp(alertEv.ev.timestamp) : '…'}</span></div>
            <ol>
              <li><span className="k">01 · Quality check</span><span className="v">Valid: 20,480 samples at 20 kHz, nothing missing.</span></li>
              <li><span className="k">02 · Compare with this bearing's reference</span><span className="v">{alertEv ? `Outer-race band ${fmtNum(alertEv.ev.current_prom_db)} dB above background, against ${fmtNum(alertEv.ev.reference_prom_db)} dB in its early readings (score ${fmtNum(alertEv.ev.score, 1)}; alert threshold ${alertEv.ev.threshold}).` : '…'}</span></li>
              <li><span className="k">03 · Evidence and state</span><span className="v">{alertEv ? `Above threshold for ${alertEv.ev.persistence.count} of ${alertEv.ev.persistence.required} consecutive valid readings: ALERT, inspection priority 1.` : '…'}</span></li>
            </ol>
          </div>
        </div>
      </section>

      <section className="wrap sec">
        <div className="split">
          <div>
            <p className="eyebrow"><span className="tick" />One alert, explained</p>
            <h2>Bearing 3 needs a closer look</h2>
            <p style={{ marginTop: 14, maxWidth: '46ch' }}>
              A vibration pattern associated with bearing damage stayed unusually strong across three usable readings. Review the trend and supporting measurements before deciding on an inspection.
              This warning identifies an unusual pattern. It does not confirm a damaged bearing.
            </p>
            <p className="muted" style={{ marginTop: 14, maxWidth: '46ch' }}>
              The evidence: this frequency band rose above the bearing's reference level for three valid readings. Every number comes from the analysis output for that reading.
              The sentence is a template filled from those numbers; no language model writes it.
            </p>
            <p className="action-note">
              <strong>What to do with it:</strong> review this bearing's vibration trend and arrange a confirmatory inspection. The alert identifies an abnormal pattern; it does not confirm a physical defect.
            </p>
            <p style={{ marginTop: 18 }}><Link to="/demo/test3?guide=alert&b=3">Open this alert in the replay</Link></p>
          </div>
          <div className="panel ev-card">
            {alertEv ? (
              <>
                <div className="ev-card-head">
                  <span>IMS Test 3 · bearing 3 · {fmtStamp(alertEv.ev.timestamp)}</span>
                  <StateBadge state="ALERT" />
                </div>
                <dl className="ev-stats">
                  <div><dt>Measurement</dt><dd className="num">{fmtNum(alertEv.ev.current_prom_db)} dB</dd><dd className="sub">{alertEv.ev.family_label} band strength above local background</dd></div>
                  <div><dt>Reference</dt><dd className="num">{fmtNum(alertEv.ev.reference_prom_db)} dB</dd><dd className="sub">this bearing's own early-recording median</dd></div>
                  <div><dt>Persistence</dt><dd className="num">{alertEv.ev.persistence.count} of {alertEv.ev.persistence.required}</dd><dd className="sub">consecutive valid readings</dd></div>
                </dl>
                <p className="ev-card-sentence">{alertEv.ev.sentence}</p>
                <p className="small muted">{fmtDuration(hoursBetween(alertEv.ev.timestamp, alertEv.end))} before the recording endpoint · score {fmtNum(alertEv.ev.score, 1)} vs threshold {alertEv.ev.threshold} (how many of the bearing's normal spreads the band moved; not a probability)</p>
              </>
            ) : <div className="skeleton" style={{ height: 220 }} />}
          </div>
        </div>
      </section>

      <section className="wrap sec">
        <div className="split reverse">
          <div className="panel nodata-card">
            <div className="ev-card-head">
              <span>{rob?.C_invalid_never_normal ? `IMS Test 3 · bearing ${rob.C_invalid_never_normal.bearing} · ${fmtStamp(rob.C_invalid_never_normal.timestamp)}` : 'Loading…'}</span>
              <StateBadge state="DATA_INSUFFICIENT" />
            </div>
            <p className="ev-card-sentence">No current verdict. This reading failed the quality checks: {rob?.C_invalid_never_normal?.reason ?? '…'}.</p>
            <ul className="nodata-list">
              <li><span className="k">During a gap</span> the previous valid state is shown with its age. It is not refreshed as "normal".</li>
              <li><span className="k">During an alert</span> a failed reading does not clear the alert. {rob?.A_alert_kept_through_invalid && <Link to={rob.A_alert_kept_through_invalid.url}>See an example</Link>}</li>
              <li><span className="k">After the gap</span> persistence counting resumes from where it stopped. A failed reading neither advances nor resets it.</li>
            </ul>
            {rob && <p className="small muted">Checked across every stored replay: {rob.exhaustive_check.invalid_readings_checked.toLocaleString()} failed readings, {rob.exhaustive_check.invalid_readings_shown_with_a_verdict} shown with a verdict.</p>}
          </div>
          <div>
            <p className="eyebrow"><span className="tick" />Missing and noisy data</p>
            <h2>A gap is not a clean bill of health</h2>
            <p className="muted" style={{ marginTop: 14, maxWidth: '48ch' }}>
              The robustness replays apply labelled, seeded perturbations to the real recordings: added sensor noise, dropped samples, 40% gaps and lost readings. Each is rerun through the full pipeline.
              Noise does degrade detection, and the results page reports that.
            </p>
            <p className="muted small" style={{ marginTop: 10, maxWidth: '48ch' }}>Synthetic perturbations cannot stand in for every real sensor fault.</p>
            <p style={{ marginTop: 18, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Link to="/demo/test2?guide=gaps&cond=gaps&b=1">See it in the replay</Link><Link to="/evaluation#robustness">Robustness results</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="wrap sec">
        <div className="sec-head">
          <p className="eyebrow"><span className="tick" />Results</p>
          <h2>What did the tests show?</h2>
          <p className="muted sec-lede">
            TOCSIN raised an alert for one of two bearings labelled as failed. Both comparison methods alerted on both. It also alerted on four of six bearings not labelled as failed.
            These results show the method's limitations; they do not establish reliable performance on other machines. The results page separates the original evaluation
            from later data-handling corrections and exploratory changes. <Link to="/evaluation">See the comparison and limitations</Link>.
          </p>
        </div>
        <div className="panel">
          {h && cur ? (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Held-out comparison table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead>
                  <tr>
                    <th>Detector · held-out IMS Tests 2 and 3</th>
                    <th className="n">Failures alerted (recall)</th>
                    <th className="n">Alerted bearings that were damaged (precision)</th>
                    <th className="n">F1</th>
                    <th className="n">Test 2 B1 · first alert before endpoint</th>
                    <th className="n">Test 3 B3 · first alert before endpoint</th>
                    <th className="n">Alert hours per undamaged bearing-day</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.filter((r) => h.detectors[r.id] && cur[r.id]).map((r) => {
                    const s = h.detectors[r.id].combined
                    const m = cur[r.id].all_alerts
                    const l2 = lead(r.id, 'test2', 1)
                    const l3 = lead(r.id, 'test3', 3)
                    return (
                      <tr key={r.id} className={r.id === 'tocsin' ? 'hl' : ''}>
                        <td>{r.name}</td>
                        <td className="n"><strong>{m.recall_frac}</strong></td>
                        <td className="n">{m.precision_frac}</td>
                        <td className="n">{f1(m.f1)}</td>
                        <td className="n">{l2 == null ? 'missed' : fmtDuration(l2)}</td>
                        <td className="n">{l3 == null ? 'missed' : fmtDuration(l3)}</td>
                        <td className="n">{fmtNum(s.healthy_alert_hours_per_bearing_day, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="skeleton" style={{ height: 200 }} />}
        </div>
        <p className="small muted" style={{ marginTop: 12, maxWidth: '110ch' }}>
          Unit: one bearing in one held-out test (2 damaged, 6 undamaged). Any alert counts. Precision is damaged bearings among alerted bearings (TOCSIN: 1 of 5); it is not a per-reading rate or a field estimate. Lead time is measured to the last recorded reading (the recording endpoint), not to a measured failure time.
          Current version (v1.1: data-handling corrections made after the pre-registered run). The simpler variant is shown for comparison and was <em>not</em> adopted, because choosing it after seeing these
          results would tune the final solution on its own test data. <Link to="/evaluation">All versions, metrics and caveats</Link>.
        </p>
      </section>

      <section className="wrap sec">
        <div className="split">
          <div>
            <p className="eyebrow"><span className="tick" />The failure it missed</p>
            <h2>A window that was too narrow</h2>
            <p className="muted" style={{ marginTop: 14, maxWidth: '50ch' }}>
              On IMS Test 2, bearing 1 failed and TOCSIN never alerted. The real outer-race tone sits at about 231 Hz. TOCSIN looks within ±2% of the
              236.4 Hz computed from published geometry at nominal speed, a window that starts at {outerBand ? `${outerBand.lo.toFixed(1)} Hz` : '231.7 Hz'}.
              The tone fell just outside it.
            </p>
            <p className="muted" style={{ marginTop: 12, maxWidth: '50ch' }}>
              A wider window catches it, but that change was explored after seeing the held-out results, so it is not evidence. The submitted detector is unchanged.
            </p>
            <p style={{ marginTop: 18, display: 'flex', gap: 16, flexWrap: 'wrap' }}><Link to="/demo/test2?guide=miss&b=1">See the miss in the replay</Link><Link to="/evaluation#diagnosis">Read the diagnosis</Link></p>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <p className="small muted" style={{ marginBottom: 8 }}>IMS Test 2 · bearing 1 · reading 901 (18 Feb 2004) · envelope spectrum (vibration-pattern strength by repetition rate)</p>
            {missSpec && cfg ? (
              <SpectrumChart title="Envelope spectrum of IMS Test 2 bearing 1 on 18 Feb 2004, showing the tallest peak just below the outer-race window" f0={missSpec.f0} df={missSpec.df}
                amp={missSpec.amp} bands={cfg.band_markers} highlight="BPFO" maxHz={500} />
            ) : <div className="skeleton" style={{ height: 240 }} />}
          </div>
        </div>
      </section>

      <section className="wrap sec">
        <div className="sec-head">
          <p className="eyebrow"><span className="tick" />Who it is for</p>
          <h2>Who can use TOCSIN today, and who it could help next</h2>
        </div>
        <dl className="facts three">
          <div className="fact"><dt>Today</dt><dd>Students, researchers and developers investigating bearing vibration data can explore real recordings, compare detection methods and analyze compatible samples.</dd></div>
          <div className="fact"><dt>What works now</dt><dd>You can analyze one compatible reading against an existing laboratory reference. Connecting your own sensors and building a reference for your own machine are not supported yet.</dd></div>
          <div className="fact"><dt>Next (not built)</dt><dd>Maintenance teams that already collect vibration measurements could benefit from clearer inspection priorities. That would need machine-specific settings, reference readings and further validation. No downtime or cost saving has been measured.</dd></div>
        </dl>
      </section>

      <section className="wrap sec">
        <div className="sec-head">
          <p className="eyebrow"><span className="tick" />Reproducibility and deployment</p>
          <h2>Check it yourself</h2>
        </div>
        <dl className="facts">
          <div className="fact"><dt>Data</dt><dd>IMS Bearing Data Set (University of Cincinnati, NASA Prognostics Data Repository). Three run-to-failure tests, 9,464 one-second readings. Labels: damaged bearing at end of test; no onset times. Conditions: constant 2000 RPM and 6000 lb.</dd></div>
          <div className="fact"><dt>Evaluation</dt><dd>Thresholds frozen on Test 1. Tests 2 and 3 held out: 2 failures, 6 undamaged bearings. Protocol written before held-out processing.</dd></div>
          <div className="fact"><dt>Deployment</dt><dd>Browser app plus one small API service. Server analysis of one reading: about {ver?.analyze_server_ms ? `${Math.round(ver.analyze_server_ms.median)} ms` : '35 ms'} median on the deployed service; about 125 MB of memory measured on a laptop. No GPU, no edge hardware.</dd></div>
          <div className="fact"><dt>Running versions</dt><dd className="mono">frontend {FRONTEND_COMMIT.slice(0, 7)} · API {apiCommit ? apiCommit.slice(0, 7) : 'not reported'} · config {cfg ? cfg.sha256.slice(0, 8) : '…'}</dd></div>
        </dl>
        <p style={{ marginTop: 18, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Link to="/data">Data &amp; method</Link><Link to="/evaluation#protocol">Evaluation protocol</Link><Link to="/evaluation#reproduce">Reproduction steps</Link><Link to="/evaluation#deployment">Deployment measurements</Link><a href={REPO_URL}>Source on GitHub</a>
        </p>
      </section>

      <section className="wrap sec faq-split">
        <div>
          <p className="eyebrow"><span className="tick" />Questions</p>
          <h2>What can I use it for today?</h2>
        </div>
        <div className="faq">
          <details>
            <summary>What does TOCSIN analyze?</summary>
            <p>Vibration measurements from bearings: numbers recorded by a sensor thousands of times per second. It looks for vibration patterns associated with bearing damage and shows the evidence behind any warning. Today it supports the documented IMS laboratory setup only.</p>
          </details>
          <details>
            <summary>What is a bearing?</summary>
            <p>A bearing lets a shaft rotate smoothly inside a machine, such as a motor, pump or fan. When a bearing starts to wear or crack, the way it vibrates often changes.</p>
          </details>
          <details>
            <summary>Does it use sound recordings?</summary>
            <p>No. The data are vibration measurements from sensors on a laboratory test rig, shown as charts. There is nothing to listen to.</p>
          </details>
          <details>
            <summary>Is this live data from a machine?</summary>
            <p>No. The replay steps through readings recorded on a bearing test rig in 2003–2004, revealing decisions the frozen pipeline computed in advance. Nothing is streamed from a machine. The Analyze page does run the pipeline live, on one uploaded reading.</p>
          </details>
          <details>
            <summary>What does a warning mean?</summary>
            <p>A repeated vibration pattern has changed enough to deserve closer examination. TOCSIN shows the measurements supporting that warning. It does not confirm damage or predict exactly when the bearing will fail.</p>
            <p>The technical rule: a bearing-fault frequency band stayed above its threshold, relative to the same bearing's early readings, for three consecutive valid readings. It means "prioritize a confirmatory inspection", not "this bearing will fail". The score is not a probability.</p>
          </details>
          <details>
            <summary>What happens when data is missing?</summary>
            <p>When a reading fails the supported quality checks, TOCSIN withholds a verdict instead of treating missing data as normal. The last valid state is kept and its age is shown. Only the conditions in the checks are covered: wrong rate or length, too many missing samples, long gaps, and readings far below the bearing's normal level.</p>
          </details>
          <details>
            <summary>Can I upload data from my own machine?</summary>
            <p>Not yet. The Analyze page compares one IMS-compatible reading with a stored IMS reference. Your own machine would need its own geometry, settings and healthy reference. See <Link to="/data#scope">the scope notes</Link>.</p>
          </details>
          <details>
            <summary>How well did the detector perform?</summary>
            <p>On two held-out failures it alerted on one, with 4 of 6 undamaged bearings also alerted. The simpler variant without defect bands did better on these recordings. That is a research result, not evidence of reliable fault detection.</p>
          </details>
        </div>
      </section>

      <section className="wrap sec">
        <div className="closing">
          <div>
            <h2>Try a sample, or inspect the full results.</h2>
            <p>Analyze a real IMS reading against a stored reference, or read every number behind this page.</p>
            <div className="hero-cta" style={{ marginTop: 20 }}>
              <Link to="/analyze?sample=late" className="btn btn-pill btn-lg orange">Analyze a sample <span className="disc" aria-hidden="true"><Arrow /></span></Link>
              <Link to="/evaluation" className="btn-link">Inspect the results <Arrow /></Link>
            </div>
          </div>
          <div className="closing-card" aria-label="Latest alert in the example replay">
            <div className="cc-head"><span className="mono-label">Alert · recorded replay</span><span className="mono-label">IMS Test 3</span></div>
            <div className="cc-body">
              <p className="cc-title">Bearing 3: outer-race band above its own reference for 3 valid readings.</p>
              <p className="small muted">Prioritize a confirmatory inspection. The alert identifies an abnormal pattern; it does not confirm a defect.</p>
            </div>
            <div className="cc-foot"><span>{alertEv ? fmtStamp(alertEv.ev.timestamp) : '…'}</span><StateBadge state="ALERT" /></div>
          </div>
        </div>
      </section>
    </div>
  )
}
