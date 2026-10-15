import { useEffect, useState } from 'react'
import { api, type FrozenConfig } from '../lib/api'
import { fmtStamp } from '../lib/format'
import type { RunsIndex } from '../lib/types'
import './evaluation.css'

interface Manifest {
  archives?: { name: string; sha256: string; bytes: number }[]
  source_url?: string
  software?: Record<string, string>
}

const FAM_NAME: Record<string, string> = { BPFO: 'Outer race (BPFO)', BPFI: 'Inner race (BPFI)', '2xBSF': 'Rolling element (2×BSF)', BSF: 'Ball spin (BSF)', FTF: 'Cage (FTF)', shaft: 'Shaft' }

export default function DataPage() {
  const [runs, setRuns] = useState<RunsIndex | null>(null)
  const [cfg, setCfg] = useState<FrozenConfig | null>(null)
  const [man, setMan] = useState<Manifest | null>(null)
  useEffect(() => {
    api.runs().then(setRuns).catch(() => undefined)
    api.config().then(setCfg).catch(() => undefined)
    api.result<Manifest>('manifest').then(setMan).catch(() => undefined)
  }, [])

  return (
    <div className="wrap ev-page">
      <header className="ev-head">
        <p className="eyebrow">Data &amp; method</p>
        <h1>What the demo runs on, and exactly how it decides</h1>
        <p className="lede">
          All demo data is real vibration recorded on a bearing test rig at the University of Cincinnati and published by NASA.
          No organiser dataset was linked in the PS01 brief, so TOCSIN uses this public run-to-failure set and says so wherever results appear.
        </p>
      </header>

      <Sec id="scope" title="What is and is not supported">
        <div className="scope-grid">
          <div>
            <h3>Supported today</h3>
            <ul className="limits">
              <li>Replaying the three recorded IMS run-to-failure tests, with decisions precomputed by the frozen pipeline.</li>
              <li>Analyzing one IMS-compatible reading (20 kHz, 2000 RPM, 20,480 samples, ZA-2115 bearing) against a stored healthy reference of an IMS test bearing.</li>
              <li>Seeded noise and missing-data perturbations of the real recordings, each rerun through the full pipeline.</li>
            </ul>
          </div>
          <div>
            <h3>Not supported</h3>
            <ul className="limits">
              <li>Monitoring your own machine. There is no machine setup, no machine-specific healthy reference, no sequential upload history and no inspection outcomes.</li>
              <li>Other bearings, sample rates or speeds. A file may parse and its spectrum may be computable, but comparing it with an IMS reference is not scientifically supported, so the API rejects other settings.</li>
              <li>Reliable fault detection. On two held-out failures TOCSIN alerted on one.</li>
            </ul>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>The gap between this research demonstrator and a usable manual-upload monitoring workflow is assessed in <code>docs/PRODUCT_GAP.md</code> in the repository.</p>
      </Sec>

      <Sec id="labels" title="Labels and operating conditions available">
        <dl className="defs">
          <dt>Labels</dt><dd>For each test, the readme names the bearing or bearings damaged <em>at the end</em> of the test: Test 1 bearing 3 (inner race) and bearing 4 (roller); Test 2 bearing 1 (outer race); Test 3 bearing 3 (outer race). All other bearings are undamaged. There is no fault-onset time and no per-reading label.</dd>
          <dt>Operating conditions</dt><dd>One rig. Shaft speed held at a nominal 2000 RPM. Radial load 6000 lb. Forced lubrication. Conditions do not change within or between tests, so a change in operating conditions is <strong>not</strong> demonstrated by this data.</dd>
          <dt>Fault point used</dt><dd>The last recorded reading of each test (the recording endpoint). Lead times are measured to it, not to a physical failure time.</dd>
          <dt>Split</dt><dd>Test 1 for tuning; Tests 2 and 3 held out (2 damaged and 6 undamaged bearings).</dd>
        </dl>
      </Sec>

      <Sec id="source" title="Source and licence">
        <dl className="defs">
          <dt>Dataset</dt><dd>IMS Bearing Data Set: NSF I/UCR Center for Intelligent Maintenance Systems, University of Cincinnati, with support from Rexnord Corp.</dd>
          <dt>Repository</dt><dd>NASA Prognostics Data Repository (PCoE), entry 4 “Bearings”. Download: <a href="https://phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip">phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip</a></dd>
          <dt>Citation</dt><dd>J. Lee, H. Qiu, G. Yu, J. Lin and Rexnord Technical Services (2007). “Bearing Data Set”, IMS, University of Cincinnati. NASA Prognostics Data Repository, NASA Ames Research Center.</dd>
          <dt>Terms</dt><dd>No dataset-specific licence is published. The repository asks users to acknowledge it and the data donors, and states that the data is used at the user's own risk.</dd>
          <dt>Integrity</dt>
          <dd>
            {man?.archives?.length ? (
              <ul className="limits">{man.archives.map((a) => <li key={a.name}><code>{a.name}</code> · {(a.bytes / 1e6).toFixed(1)} MB · SHA-256 <code className="hash">{a.sha256}</code></li>)}</ul>
            ) : 'Checksums are listed in results/manifest.json.'}
            <span className="small muted">Each of the {runs ? runs.runs.reduce((s, r) => s + r.n_snapshots, 0).toLocaleString() : '9,464'} recording files is also hashed individually during processing.</span>
          </dd>
        </dl>
      </Sec>

      <Sec id="rig" title="Recording facts (from the official readme)">
        <dl className="defs">
          <dt>Rig</dt><dd>Four Rexnord ZA-2115 double-row bearings on one shaft, driven at a constant 2000 RPM. A 6000 lb radial load was applied by a spring mechanism. Bearings are force-lubricated.</dd>
          <dt>Sensors</dt><dd>PCB 353B33 ICP accelerometers on the bearing housings. Test 1 has two per bearing (x and y); Tests 2 and 3 have one per bearing. Units are not documented, so values are treated as raw sensor output.</dd>
          <dt>Each reading</dt><dd>One-second snapshot: 20,480 samples at 20 kHz, every 10 minutes. The first 43 files of Test 1 were taken every 5 minutes. Longer gaps between file names mark the experiment resuming the next working day.</dd>
          <dt>Labels</dt><dd>The readme states only which bearing had a defect <em>at the end</em> of each test. There is no onset time and no per-reading label.</dd>
        </dl>
      </Sec>

      <Sec id="runs" title="Runs used">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
          <table className="data">
            <thead><tr><th>Run</th><th>Role</th><th className="n">Files (archive / readme)</th><th>Recorded</th><th>Channels used</th><th>Readme label</th></tr></thead>
            <tbody>
              {(runs?.runs ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)).map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{r.role === 'held-out' ? 'Held-out evaluation' : 'Tuning only'}</td>
                  <td className="n">{r.n_snapshots.toLocaleString()} / {r.readme_files.toLocaleString()}</td>
                  <td>{fmtStamp(r.first)} → {fmtStamp(r.last)}</td>
                  <td>{Object.entries(r.channels).map(([b, c]) => `B${b}: ch ${c}`).join(', ')}</td>
                  <td>{r.readme}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="findings">
          <h3>Discrepancies found and how they were handled</h3>
          <ul>
            <li>The Test 3 archive holds <strong>6,324</strong> files ending 18 Apr 2004, while the readme says 4,448 files ending 4 Apr 2004. All archived files are used, and the endpoint is the last archived file.</li>
            <li>The Test 3 files sit in a folder named <code>4th_test/txt</code> inside <code>3rd_test.rar</code>. They are treated as Test 3 because that is the archive they come from.</li>
            <li>Test 1 records two axes per bearing. The first channel of each pair (x-axis) was chosen before tuning.</li>
          </ul>
        </div>
      </Sec>

      <Sec id="geometry" title="Bearing geometry and defect frequencies">
        {cfg ? (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              {cfg.bearing.n_rollers} rollers per row, pitch diameter {cfg.bearing.pitch_diameter} in, roller diameter {cfg.bearing.roller_diameter} in, contact angle {cfg.bearing.contact_angle_deg}°.
              Source: {cfg.bearing.source}. This is not stated in the IMS readme. Frequencies are computed in code from the standard kinematic formulas at the assumed {cfg.rpm_assumed} RPM.
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls horizontally on narrow screens)">
              <table className="data">
                <thead><tr><th>Frequency</th><th className="n">Hz at {cfg.rpm_assumed} RPM</th><th className="n">Orders (× shaft)</th></tr></thead>
                <tbody>
                  {Object.entries(cfg.defect_hz).map(([k, v]) => (
                    <tr key={k}><td>{FAM_NAME[k] ?? k}</td><td className="n">{v.toFixed(2)}</td><td className="n">{(v / cfg.defect_hz.shaft).toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <div className="skeleton" style={{ height: 160 }} />}
      </Sec>

      <Sec id="method" title="How TOCSIN decides">
        <ol className="limits">
          <li><strong>Validate.</strong> Each reading must be at the expected rate and at least 90% of the expected length, have at most 20% of samples missing, and have no gap longer than 2,048 samples (0.1 s). Short gaps are filled by linear interpolation and the filled count is shown. Otherwise the reading gets <em>no verdict</em>.</li>
          <li><strong>Envelope.</strong> Band-pass {cfg ? cfg.band.replace('-', '–') : '2000–8000'} Hz (chosen on Test 1), take the Hilbert envelope, then its spectrum. Resolution is about 0.98 Hz.</li>
          <li><strong>Defect bands.</strong> For outer race, inner race and rolling element, find the peak within ±2% of each of the first three harmonics. Compare it with the median level in the surrounding ±25 Hz (prominence, in dB).</li>
          <li><strong>Own baseline.</strong> Compare each family's prominence with the median and spread of the same bearing's first 72 valid readings (a robust z-score). The strongest family is the score and names the implicated band.</li>
          <li><strong>Persistence.</strong> One reading above the threshold sets WATCH. Three consecutive readings set ALERT. Three consecutive readings below the threshold clear it. Invalid readings freeze the counters and never clear an alert.</li>
          <li><strong>Priority.</strong> Bearings are ranked by the state of their last valid reading, then by score relative to the threshold.</li>
        </ol>
      </Sec>

      <Sec id="assumptions" title="Assumptions">
        <ul className="limits">
          <li>Shaft speed is not recorded per reading. The rig's nominal 2000 RPM is assumed, and the ±2% band windows absorb small slip.</li>
          <li>The healthy reference assumes each bearing is undamaged during its first 72 valid readings (12 hours at 10-minute spacing). No fleet-wide fallback reference is used.</li>
          <li>The last recorded reading is used as the evaluation endpoint (the recording endpoint), because the dataset gives no physical failure timestamp.</li>
        </ul>
      </Sec>
    </div>
  )
}

function Sec({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="ev-section" aria-labelledby={`${id}-h`}>
      <div className="ev-section-head"><h2 id={`${id}-h`}>{title}</h2></div>
      <div className="panel panel-body">{children}</div>
    </section>
  )
}
