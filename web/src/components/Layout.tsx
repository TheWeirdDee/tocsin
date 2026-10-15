import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { applyMeta } from '../lib/meta'
import { ErrorBoundary } from './ErrorBoundary'
import { Arrow, Close, Logo, Menu } from './Icons'

export const REPO_URL = 'https://github.com/TheWeirdDee/tocsin'
export const FRONTEND_COMMIT: string = __BUILD_COMMIT__

export function Layout() {
  const [open, setOpen] = useState(false)
  const [apiCommit, setApiCommit] = useState<string | null>(null)
  const loc = useLocation()

  useEffect(() => {
    api.health().then((h) => setApiCommit((h as { build_commit?: string }).build_commit ?? null)).catch(() => setApiCommit(null))
  }, [])

  useEffect(() => applyMeta(loc.pathname), [loc.pathname])

  useEffect(() => {
    setOpen(false)
    if (!loc.hash) {
      window.scrollTo(0, 0)
      return
    }
    // Sections on some pages render after their data loads; retry briefly before giving up. Once the
    // target exists, keep it in place while content above it loads (slow connections), until the
    // reader scrolls or 15 s pass.
    let tries = 0
    let ro: ResizeObserver | null = null
    let stopTimer = 0
    // A malformed fragment (for example #%) must never take the page down: fall back to the raw text.
    let id = loc.hash.slice(1)
    try { id = decodeURIComponent(id) } catch { /* keep the raw fragment */ }
    const stop = () => {
      ro?.disconnect()
      ro = null
      window.clearTimeout(stopTimer)
      for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(ev, stop)
    }
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 40) {
        window.clearInterval(timer)
        if (!el) return
        el.scrollIntoView({ block: 'start' })
        ro = new ResizeObserver(() => el.scrollIntoView({ block: 'start' }))
        ro.observe(document.body)
        stopTimer = window.setTimeout(stop, 15_000)
        for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(ev, stop, { passive: true })
      }
    }, 100)
    return () => { window.clearInterval(timer); stop() }
  }, [loc.pathname, loc.hash])

  const short = (s: string | null) => (s ? s.slice(0, 7) + (s.endsWith('+uncommitted') ? '+uncommitted' : '') : 'unknown')
  const mismatch = apiCommit && FRONTEND_COMMIT !== 'dev' && apiCommit !== FRONTEND_COMMIT.replace('+uncommitted', '')

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="TOCSIN home">
            <Logo />
            <span>TOCSIN</span>
          </Link>
          <Link to="/demo/test3?guide=alert&b=3" className="btn btn-pill btn-sm header-cta-mobile">Replay <span className="disc" aria-hidden="true"><Arrow /></span></Link>
          <button className="btn btn-ghost btn-icon menu-toggle" aria-expanded={open} aria-controls="site-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <Close /> : <Menu />}
          </button>
          <div id="site-nav" className={`nav-wrap${open ? ' open' : ''}`}>
            <nav className="nav-pill header-center" aria-label="Main">
              <NavLink to="/demo">Demo</NavLink>
              <NavLink to="/evaluation">Results</NavLink>
              <NavLink to="/data">Method</NavLink>
              <NavLink to="/analyze">Analyze</NavLink>
              <a href={REPO_URL} rel="noreferrer">GitHub</a>
            </nav>
            <Link to="/demo/test3?guide=alert&b=3" className="btn btn-pill btn-sm">Explore the replay <span className="disc" aria-hidden="true"><Arrow /></span></Link>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <ErrorBoundary resetKey={loc.pathname + loc.search}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p>TOCSIN · research prototype for Wild Bugs PS01 (MachinaSense) · Divine Dilibe · MIT licence</p>
            <p>Demo data: IMS Bearing Data Set, NASA Prognostics Data Repository. Recorded data, not a live feed.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            <p><Link to="/data">Sources &amp; licence</Link> · <Link to="/evaluation#reproduce">Reproduce</Link> · <a href={REPO_URL}>GitHub</a></p>
            <p className="versions" data-testid="versions">
              frontend {short(FRONTEND_COMMIT)} · API {apiCommit ? apiCommit.slice(0, 7) : 'not reported'}
              {mismatch ? <span style={{ color: 'var(--st-watch-ink)' }}> · versions differ</span> : null}
            </p>
          </div>
        </div>
      </footer>
    </>
  )
}
