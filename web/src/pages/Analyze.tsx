import { useEffect, useRef, useState } from 'react'
import { SpectrumChart } from '../components/charts/SpectrumChart'
import { Upload, Warn } from '../components/Icons'
import { ApiError, analyzeUpload, api, type AnalyzeResult } from '../lib/api'
import { fmtHz, fmtNum } from '../lib/format'
import type { RunsIndex } from '../lib/types'
import './evaluation.css'
import './workspace.css'

const SAMPLES = [
  { href: '/samples/ims_test2_2004.02.12.10.32.39.txt', label: 'IMS Test 2, first reading (12 Feb 2004 10:32)' },
  { href: '/samples/ims_test2_2004.02.19.05.42.39.txt', label: 'IMS Test 2, near the end (19 Feb 2004 05:42)' },
]

export default function Analyze() {
  const [runs, setRuns] = useState<RunsIndex | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fs, setFs] = useState('20000')
  const [rpm, setRpm] = useState('2000')
  const [col, setCol] = useState('0')
  const [ref, setRef] = useState('test2:1')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AnalyzeResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { api.runs().then(setRuns).catch(() => undefined) }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setErr('Choose a file first.'); return }
    setBusy(true); setErr(null); setRes(null)
    const form = new FormData()
    form.append('file', file)
    form.append('sample_rate', fs)
    form.append('rpm', rpm)
    form.append('column', col)
    form.append('reference', ref)
    try {
      setRes(await analyzeUpload(form))
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Analysis failed.')
    } finally {
      setBusy(false)
    }
  }

  async function loadSample(href: string) {
    setErr(null)
    try {
      const r = await fetch(href)
      if (!r.ok) throw new Error()
      const blob = await r.blob()
      setFile(new File([blob], href.split('/').pop()!, { type: 'text/plain' }))
    } catch {
      setErr('Could not load the sample file.')
    }
  }

  const refs = runs ? Object.entries(runs.references).flatMap(([run, bs]) => Object.entries(bs).map(([b, v]) => ({ id: `${run}:${b}`, label: v.label }))) : []
  const ev = res?.evidence

  return (
    <div className="wrap ev-page">
      <header className="ev-head">
        <p className="eyebrow">Analyze a file</p>
        <h1>Run the frozen pipeline on one vibration snapshot</h1>
        <p className="lede">
          Upload one reading. TOCSIN validates it, computes the envelope spectrum and defect-band prominences, and compares them with a stored healthy reference.
          It runs live on the server. One reading can reach WATCH at most, because an alert needs three consecutive readings.
        </p>
      </header>

      <form className="panel panel-body an-form" onSubmit={submit}>
        <div
          className={`drop${dragging ? ' on' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]) }}
        >
          <Upload />
          <div>
            <strong>{file ? file.name : 'Drop a file here'}</strong>
            <p className="small muted">IMS ASCII (tab-separated columns) or CSV with one column per channel, up to 8 MB. Empty cells count as missing samples.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>Choose file</button>
          <input ref={inputRef} type="file" className="visually-hidden" accept=".txt,.csv,.tsv,text/plain,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Snapshot file" />
        </div>
        <div className="small" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted">Or use a real IMS reading:</span>
          {SAMPLES.map((s) => <button type="button" key={s.href} className="btn btn-sm btn-ghost" onClick={() => loadSample(s.href)}>{s.label}</button>)}
        </div>
        <div className="an-fields">
          <label className="field"><span>Sample rate (Hz)</span><input type="number" min={100} max={200000} value={fs} onChange={(e) => setFs(e.target.value)} /></label>
          <label className="field"><span>Shaft speed (RPM)</span><input type="number" min={60} max={30000} value={rpm} onChange={(e) => setRpm(e.target.value)} /></label>
          <label className="field"><span>Channel column (0 = first)</span><input type="number" min={0} max={63} value={col} onChange={(e) => setCol(e.target.value)} /></label>
          <label className="field an-ref"><span>Healthy reference to compare against</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)}>
              {refs.length ? refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>) : <option value="test2:1">IMS Test 2 · bearing 1</option>}
            </select>
          </label>
        </div>
        <p className="small muted">The geometry is fixed to the IMS ZA-2115 bearing. Results for other bearings would need their own geometry, which this demo does not accept.</p>
        <div><button className="btn btn-primary" disabled={busy || !file}>{busy ? <><span className="spinner" /> Analyzing…</> : 'Analyze snapshot'}</button></div>
      </form>

      {err && <div className="notice error" role="alert" style={{ marginTop: 16 }}><Warn /><div>{err}</div></div>}

      {res && (
        <section className="detail" style={{ marginTop: 16 }} aria-live="polite">
          {!res.valid ? (
            <div className="panel evidence s-DATA_INSUFFICIENT">
              <div className="panel-head"><h2>No verdict</h2></div>
              <div className="panel-body"><p className="ev-sentence">{res.sentence}</p>
                <p className="small muted" style={{ marginTop: 8 }}>{res.quality.n_samples.toLocaleString()} samples · {fmtNum(res.quality.missing_fraction * 100, 1)}% missing · longest gap {res.quality.longest_gap.toLocaleString()} samples</p>
              </div>
            </div>
          ) : (
            <>
              <div className={`panel evidence s-${res.verdict === 'ABOVE_THRESHOLD' ? 'WATCH' : 'NORMAL'}`}>
                <div className="panel-head">
                  <h2>{res.verdict === 'ABOVE_THRESHOLD' ? 'Above threshold (one reading)' : 'Below threshold'}</h2>
                  <span className="panel-sub">Analyzed in {fmtNum(res.timing_ms.total, 1)} ms on the server</span>
                </div>
                <div className="panel-body">
                  <p className="ev-sentence">{ev?.sentence}</p>
                  <dl className="ev-grid">
                    <div><dt>Implicated band</dt><dd>{ev?.family_label ?? '—'} · {fmtHz(ev?.defect_hz)}</dd></div>
                    <div><dt>Peak found at</dt><dd>{fmtHz(ev?.peak_hz)}</dd></div>
                    <div><dt>Prominence now / reference</dt><dd>{fmtNum(ev?.current_prom_db)} / {fmtNum(ev?.reference_prom_db)} dB</dd></div>
                    <div><dt>Score vs threshold</dt><dd>{fmtNum(res.score, 1)} / {res.threshold}</dd></div>
                    {Object.entries(res.z ?? {}).map(([k, v]) => <div key={k}><dt>z · {k}</dt><dd>{fmtNum(v, 2)}</dd></div>)}
                    <div><dt>Data quality</dt><dd>{res.quality.interpolated ? `${res.quality.interpolated} samples interpolated` : 'complete'}</dd></div>
                    <div className="wide"><dt>Reference · speed</dt><dd>{res.reference?.label} · {res.speed_note}</dd></div>
                  </dl>
                  <p className="small muted ev-foot">{res.persistence_note} The score is a robust z-value, not a probability.</p>
                </div>
              </div>
              {res.spectrum && res.band_markers && (
                <div className="panel">
                  <div className="panel-head"><h3>Envelope spectrum of the uploaded reading</h3></div>
                  <div className="panel-body">
                    <SpectrumChart title="Envelope spectrum of uploaded reading" f0={res.spectrum.f0} df={res.spectrum.df} amp={res.spectrum.amp} bands={res.band_markers} highlight={ev?.family ?? null} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
