import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Arrow } from '../components/Icons'
import { StateBadge } from '../components/StateBadge'
import { api } from '../lib/api'
import { fmtDuration } from '../lib/format'
import type { BearingMetrics, Summary } from '../lib/types'
import './landing.css'

interface Heldout { detectors: Record<string, { label: string; combined: Summary; runs: Record<string, { per_bearing: BearingMetrics[] }> }> }

export default function Landing() {
  const [h, setH] = useState<Heldout | null>(null)
  useEffect(() => { api.result<Heldout>('heldout').then(setH).catch(() => undefined) }, [])
  const lead = (d: string, run: string, b: number) => h?.detectors[d]?.runs[run]?.per_bearing.find((x) => x.bearing === b)?.lead_time_h ?? null

  return (
    <div className="landing">
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">Bearing vibration · inspection priority</p>
          <h1>Know which machine to inspect first, and see the evidence.</h1>
          <p className="lede">
            TOCSIN checks each bearing's own fault frequencies against that bearing's own healthy baseline.
            It ranks bearings for inspection and attaches the vibration evidence behind every alert.
          </p>
          <div className="hero-cta">
            <Link to="/demo" className="btn btn-primary">Open the demo <Arrow /></Link>
            <Link to="/evaluation" className="btn">See held-out results</Link>
          </div>
          <p className="small muted">The demo replays public run-to-failure recordings from a bearing test rig. It is not a live machine feed.</p>
        </div>
        <figure className="preview" aria-label="Product preview">
          <picture>
            <source media="(max-width: 640px)" srcSet="/preview-mobile.png" />
            <img src="/preview.png" alt="TOCSIN replay of IMS Test 3 on 16 April 2004: bearing 3 is first in the inspection list with an Alert, and its evidence card shows the outer-race band at 1.83 times its healthy reference for 3 consecutive readings." width={1280} height={860} />
          </picture>
          <figcaption className="small muted">Actual screen: IMS Test 3 replay at TOCSIN's first alert on bearing 3, 16 Apr 2004.</figcaption>
        </figure>
      </section>

      <section className="band">
        <div className="wrap two-col">
          <div>
            <h2>Built for the person who decides where the next inspection goes</h2>
            <p>
              A maintenance or reliability lead at a plant with pumps, fans, conveyors and drives. They have accelerometers or a route collector, but no vibration analyst on staff.
            </p>
          </div>
          <div className="problem">
            <div>
              <h3>Today</h3>
              <p>A fixed vibration-level alarm. Overall level often rises only once damage is advanced, and every alarm still needs an expert to read a spectrum.</p>
            </div>
            <div>
              <h3>With TOCSIN</h3>
              <p>A ranked list of bearings. Each alert names the defect band it found, how far that band is above the bearing's own healthy level, and for how many readings it has held.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap steps-sec">
        <h2>How a reading becomes a priority</h2>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <h3>Check the reading</h3>
            <p>Wrong length, wrong rate or too many missing samples means <em>no verdict</em>. The last valid state is kept and its age shown. A broken sensor never produces an all-clear.</p>
          </li>
          <li>
            <span className="step-n">2</span>
            <h3>Look where defects show</h3>
            <p>Envelope analysis exposes the repeating impacts of a damaged race or roller at frequencies set by the bearing's geometry and shaft speed.</p>
          </li>
          <li>
            <span className="step-n">3</span>
            <h3>Compare to itself</h3>
            <p>Each bearing is measured against its own first 12 hours of readings, not against a generic limit.</p>
          </li>
          <li>
            <span className="step-n">4</span>
            <h3>Require persistence</h3>
            <p>One reading above threshold is <StateBadge state="WATCH" compact />. Three in a row is <StateBadge state="ALERT" compact />. The bearing then moves up the inspection list with its evidence.</p>
          </li>
        </ol>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>Measured on recordings it was never tuned on</h2>
          <p className="muted" style={{ maxWidth: '70ch', marginTop: 6 }}>
            Thresholds were frozen on IMS Test 1. Tests 2 and 3 were then processed once.
            The held-out set holds <strong>2 failure events and 6 undamaged bearings</strong>. That is too few for percentages, so counts are shown.
          </p>
          <p className="notice warn" style={{ marginTop: 14, maxWidth: '80ch' }}>
            The goal was to warn earlier than a vibration-level (RMS) alarm, with fewer false alerts. It did not. TOCSIN missed one of the two failures, because the observed defect tone sat just outside its frequency window.
            It spent the least time alerting on undamaged bearings and warned first on the other failure. The evaluation page explains why.
          </p>
          {h ? (
            <div className="results-grid">
              {(['tocsin', 'b0_rms', 'b1_iforest'] as const).map((d) => {
                const s = h.detectors[d].combined
                return (
                  <div key={d} className={`result-card${d === 'tocsin' ? ' main' : ''}`}>
                    <h3>{h.detectors[d].label.split(' (')[0]}</h3>
                    <dl>
                      <div><dt>Failures alerted</dt><dd>{s.tp} of 2</dd></div>
                      <div><dt>First alert before recording endpoint · Test 2 B1</dt><dd>{fmtDuration(lead(d, 'test2', 1)) === '—' ? 'none' : fmtDuration(lead(d, 'test2', 1))}</dd></div>
                      <div><dt>First alert before recording endpoint · Test 3 B3</dt><dd>{fmtDuration(lead(d, 'test3', 3)) === '—' ? 'none' : fmtDuration(lead(d, 'test3', 3))}</dd></div>
                      <div><dt>Undamaged bearings alerted</dt><dd>{s.fp} of 6</dd></div>
                    </dl>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="skeleton" style={{ height: 180, marginTop: 20 }} />
          )}
          <p className="small muted" style={{ marginTop: 10 }}>Figures are from the current version (v1.1), which fixes two data-handling defects found after the pre-registered run. Both versions are on the evaluation page.</p>
          <p style={{ marginTop: 16 }}><Link to="/evaluation">Full results, robustness under noise and missing data, ablations and the protocol <Arrow style={{ display: 'inline', width: 16, verticalAlign: '-3px' }} /></Link></p>
        </div>
      </section>

      <section className="wrap honest">
        <div>
          <h2>What the demo shows today</h2>
          <ul>
            <li>Ingestion and validation of real accelerometer recordings (IMS format or CSV).</li>
            <li>Per-bearing defect-band detection with a persistence gate and explicit no-data states.</li>
            <li>Evidence for every alert: band, level against the bearing's own reference, persistence, spectrum, data quality and analysis version.</li>
            <li>Head-to-head comparison with an RMS alarm and an isolation forest under the same rules.</li>
            <li>Replays with injected noise, dropped samples and lost readings, each rerun through the full pipeline.</li>
          </ul>
        </div>
        <div>
          <h2>What is not validated</h2>
          <ul>
            <li>Performance on a real plant, other bearing types, or variable speed and load. All data comes from one constant-speed test rig.</li>
            <li>Reliable detection rates. There are only two held-out failures.</li>
            <li>Remaining-life or time-to-failure estimates. TOCSIN does not make them.</li>
            <li>Inner-race and rolling-element naming on held-out data, which contains only outer-race failures.</li>
          </ul>
        </div>
      </section>

      <section className="wrap closing">
        <h2>Check it yourself</h2>
        <p className="muted">The data source, checksums, protocol and every command needed to regenerate the numbers are public.</p>
        <div className="hero-cta">
          <Link to="/demo" className="btn btn-primary">Open the demo <Arrow /></Link>
          <Link to="/data" className="btn">Data &amp; method</Link>
          <Link to="/evaluation#reproduce" className="btn">Reproduce the results</Link>
        </div>
      </section>
    </div>
  )
}
