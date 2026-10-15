import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SpectrumChart } from '../components/charts/SpectrumChart'
import { Info, Upload, Warn } from '../components/Icons'
import { ApiError, analyzeUpload, api, type AnalyzeResult } from '../lib/api'
import { fmtHz, fmtNum } from '../lib/format'
import type { RunsIndex } from '../lib/types'
import './evaluation.css'
import './workspace.css'

// The stored healthy references were recorded under one acquisition configuration.
// Readings taken under other settings cannot be compared with them (audit TC-08),
// so the configuration is shown, not edited. The API enforces the same rule.
const SUPPORTED = { sampleRate: 20000, rpm: 2000, samples: 20480 }

const SAMPLES = [
  { href: '/samples/ims_test2_2004.02.12.10.32.39.txt', label: 'IMS Test 2, first reading (12 Feb 2004 10:32)' },
  { href: '/samples/ims_test2_2004.02.19.05.42.39.txt', label: 'IMS Test 2, near the recording endpoint (19 Feb 2004 05:42)' },
]

// fileRevision changes on every file choice, so two different files with the same name and size never
// share a signature (re-audit R-06).
interface Inputs { fileName: string; fileSize: number; fileRevision: number; column: number; reference: string }
const sig = (i: Inputs) => JSON.stringify(i)

export default function Analyze() {
  const [runs, setRuns] = useState<RunsIndex | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileRevision, setFileRevision] = useState(0)
  const chooseFile = (f: File | null) => { setFile(f); setFileRevision((r) => r + 1) }
  const [col, setCol] = useState('0')
  const [ref, setRef] = useState('test2:1')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ result: AnalyzeResult; inputs: Inputs } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestSeq = useRef(0) // only the newest request may set the result (audit TC-05)
  const [sp] = useSearchParams()
  const sampleParam = sp.get('sample')

  useEffect(() => { api.runs().then(setRuns).catch(() => undefined) }, [])
  // Scenario entry: preload a real IMS sample (the user still presses Analyze).
  useEffect(() => {
    const s = sampleParam === 'first' ? SAMPLES[0] : sampleParam === 'late' ? SAMPLES[1] : null
    if (s) loadSample(s.href)
    // Runs only when the sample link changes; loadSample is recreated every render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleParam])

  const current: Inputs | null = useMemo(
    () => (file ? { fileName: file.name, fileSize: file.size, fileRevision, column: Number(col), reference: ref } : null),
    [file, fileRevision, col, ref],
  )
  // A result is only current for the exact inputs it was computed from (audit TC-05).
  const stale = !!res && (!current || sig(current) !== sig(res.inputs))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !current) { setErr('Choose a file first.'); return }
    if (!Number.isInteger(Number(col)) || Number(col) < 0) { setErr('The channel column must be a whole number, 0 or more.'); return }
    setBusy(true); setErr(null)
    const form = new FormData()
    form.append('file', file)
    form.append('sample_rate', String(SUPPORTED.sampleRate))
    form.append('rpm', String(SUPPORTED.rpm))
    form.append('column', col)
    form.append('reference', ref)
    const snapshot = { ...current }
    const seq = ++requestSeq.current
    try {
      const result = await analyzeUpload(form)
      if (seq !== requestSeq.current) return
      setRes({ result, inputs: snapshot })
    } catch (e2) {
      if (seq !== requestSeq.current) return
      setRes(null)
      setErr(e2 instanceof ApiError ? (e2.status ? `${e2.message} (HTTP ${e2.status})` : e2.message) : 'Analysis failed.')
    } finally {
      if (seq === requestSeq.current) setBusy(false)
    }
  }

  async function loadSample(href: string) {
    setErr(null)
    try {
      const r = await fetch(href)
      if (!r.ok) throw new Error()
      const blob = await r.blob()
      chooseFile(new File([blob], href.split('/').pop()!, { type: 'text/plain' }))
    } catch {
      setErr('Could not load the sample file.')
    }
  }

  const refs = runs ? Object.entries(runs.references).flatMap(([run, bs]) => Object.entries(bs).map(([b, v]) => ({ id: `${run}:${b}`, label: v.label }))) : []
  const refLabel = (id: string) => refs.find((r) => r.id === id)?.label ?? id
  const result = res?.result
  const ev = result?.evidence

  return (
    <div className="wrap ev-page">
      <header className="ev-head">
        <p className="eyebrow">Live file analysis</p>
        <h1>Check a single IMS-format reading against a stored healthy reference</h1>
        <p className="lede">
          Unlike the replay, this runs the analysis pipeline on the server, now, for the file you choose. TOCSIN checks the reading's quality,
          measures the strength of each bearing-fault vibration pattern, and compares it with the healthy reference of one IMS test bearing.
          One reading can reach WATCH at most: an alert needs three consecutive readings.
        </p>
        <div className="notice info" role="note">
          <Info />
          <div>
            <strong>Supported scope: IMS-compatible readings only.</strong> The references were recorded on the IMS rig (Rexnord ZA-2115 bearings),
            at {SUPPORTED.sampleRate.toLocaleString()} Hz and {SUPPORTED.rpm.toLocaleString()} RPM, as {SUPPORTED.samples.toLocaleString()}-sample readings.
            A file from other machinery may parse, and its spectrum may be computable, but comparing it with these references is not scientifically supported.
            This page is not a general machinery monitor.
          </div>
        </div>
      </header>

      <form className="panel panel-body an-form" onSubmit={submit}>
        <div
          className={`drop${dragging ? ' on' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]) }}
        >
          <Upload />
          <div>
            <strong>{file ? file.name : 'Drop a reading here'}</strong>
            <p className="small muted">IMS ASCII (tab-separated columns) or CSV, one column per channel, up to 8 MB. Empty cells, and blank lines inside the data, count as missing samples at their own position; rows must all have the same number of fields.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>Choose file</button>
          <input ref={inputRef} type="file" className="visually-hidden" accept=".txt,.csv,.tsv,text/plain,text/csv" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} aria-label="Reading file" />
        </div>
        <div className="small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted">Or use a real IMS reading:</span>
          {SAMPLES.map((s) => <button type="button" key={s.href} className="btn btn-sm btn-ghost" onClick={() => loadSample(s.href)}>{s.label}</button>)}
        </div>
        <div className="an-fields">
          <label className="field"><span>Sample rate (fixed)</span><input type="text" readOnly value={`${SUPPORTED.sampleRate.toLocaleString()} Hz`} aria-describedby="fixed-help" /></label>
          <label className="field"><span>Shaft speed (fixed)</span><input type="text" readOnly value={`${SUPPORTED.rpm.toLocaleString()} RPM`} aria-describedby="fixed-help" /></label>
          <label className="field"><span>Channel column (0 = first)</span><input type="number" min={0} max={63} step={1} value={col} onChange={(e) => setCol(e.target.value)} /></label>
          <label className="field an-ref"><span>Healthy reference to compare against</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)}>
              {refs.length ? refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>) : <option value="test2:1">IMS Test 2 · bearing 1</option>}
            </select>
          </label>
        </div>
        <p id="fixed-help" className="small muted">Sample rate and speed are fixed to the references' acquisition settings. The API rejects other values instead of comparing incompatible data.</p>
        <div><button className="btn btn-primary" disabled={busy || !file}>{busy ? <><span className="spinner" /> Analyzing…</> : 'Analyze reading'}</button></div>
      </form>

      {err && <div className="notice error" role="alert" style={{ marginTop: 16 }}><Warn /><div><strong>Analysis not completed.</strong> {err}</div></div>}

      {res && result && (
        <section className="detail" style={{ marginTop: 16 }} aria-live="polite">
          {stale && (
            <div className="notice warn" role="status" data-testid="stale-result">
              <Warn />
              <div><strong>Previous result. The inputs have changed since this analysis.</strong> Run the analysis again to get a result for the current file, column and reference.</div>
            </div>
          )}
          <div className={stale ? 'an-stale' : ''}>
            <div className="an-inputs" data-testid="result-inputs">
              <span>File <b>{res.inputs.fileName}</b> ({(res.inputs.fileSize / 1024).toFixed(0)} KB)</span>
              <span>Column <b>{res.inputs.column}</b></span>
              <span>Reference <b>{refLabel(res.inputs.reference)}</b></span>
              <span>Acquisition <b>{SUPPORTED.sampleRate.toLocaleString()} Hz · {SUPPORTED.rpm.toLocaleString()} RPM</b></span>
            </div>
            {!result.valid ? (
              <div className="panel evidence s-DATA_INSUFFICIENT" style={{ marginTop: 12 }}>
                <div className="panel-head"><h2>No verdict</h2></div>
                <div className="panel-body"><p className="ev-sentence">{result.sentence}</p>
                  <p className="small muted" style={{ marginTop: 8 }}>{result.quality.n_samples.toLocaleString()} samples · {fmtNum(result.quality.missing_fraction * 100, 1)}% missing · longest gap {result.quality.longest_gap.toLocaleString()} samples</p>
                </div>
              </div>
            ) : (
              <>
                <div className={`panel evidence s-${result.verdict === 'ABOVE_THRESHOLD' ? 'WATCH' : 'NORMAL'}`} style={{ marginTop: 12 }}>
                  <div className="panel-head">
                    <h2>{result.verdict === 'ABOVE_THRESHOLD' ? 'Above threshold (one reading)' : 'Below threshold'}</h2>
                    <span className="panel-sub">Analyzed in {fmtNum(result.timing_ms.total, 1)} ms on the server</span>
                  </div>
                  <div className="panel-body">
                    <p className="ev-sentence">{ev?.sentence}</p>
                    <dl className="ev-grid">
                      <div><dt>Analyzed</dt><dd>Uploaded reading, column {res.inputs.column}</dd></div>
                      <div><dt>Compared with</dt><dd>{result.reference?.label}</dd></div>
                      <div><dt>Implicated band</dt><dd>{ev?.family_label ?? '—'} · {fmtHz(ev?.defect_hz)}</dd></div>
                      <div><dt>Peak found at</dt><dd>{fmtHz(ev?.peak_hz)}</dd></div>
                      <div><dt>Prominence / reference</dt><dd>{fmtNum(ev?.current_prom_db)} / {fmtNum(ev?.reference_prom_db)} dB</dd></div>
                      <div><dt>Score vs threshold</dt><dd>{fmtNum(result.score, 1)} / {result.threshold}</dd></div>
                      {Object.entries(result.z ?? {}).map(([k, v]) => <div key={k}><dt>z · {k}</dt><dd>{fmtNum(v, 2)}</dd></div>)}
                      <div><dt>Data quality</dt><dd>{result.quality.interpolated ? `${result.quality.interpolated} samples interpolated` : 'complete'}</dd></div>
                    </dl>
                    <p className="small muted ev-foot">{result.persistence_note} The score is a robust z-value, not a probability. The comparison is meaningful only for IMS-compatible readings (see the scope note above).</p>
                  </div>
                </div>
                {result.spectrum && result.band_markers && (
                  <div className="panel" style={{ marginTop: 16 }}>
                    <div className="panel-head"><h3>Envelope spectrum of the uploaded reading</h3><span className="panel-sub">{res.inputs.fileName} · column {res.inputs.column}</span></div>
                    <div className="panel-body">
                      <SpectrumChart title="Envelope spectrum of uploaded reading" f0={result.spectrum.f0} df={result.spectrum.df} amp={result.spectrum.amp} bands={result.band_markers} highlight={ev?.family ?? null} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
      <p className="small muted" style={{ marginTop: 24 }}>
        Monitoring your own machine would need its own bearing geometry, acquisition settings and healthy reference. That workflow does not exist yet: see <Link to="/data#scope">what is and is not supported</Link>.
      </p>
    </div>
  )
}
