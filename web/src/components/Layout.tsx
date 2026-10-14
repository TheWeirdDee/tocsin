import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Close, Logo, Menu } from './Icons'


export function Layout() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setOpen(false)
    if (!loc.hash) {
      window.scrollTo(0, 0)
      return
    }
    // Sections on some pages render after their data loads; retry briefly before giving up.
    let tries = 0
    const id = decodeURIComponent(loc.hash.slice(1))
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 40) {
        window.clearInterval(timer)
        el?.scrollIntoView({ block: 'start' })
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [loc.pathname, loc.hash])

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="TOCSIN home">
            <Logo />
            <span>TOCSIN</span>
          </Link>
          <button className="btn btn-ghost btn-icon menu-toggle" aria-expanded={open} aria-controls="site-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <Close /> : <Menu />}
          </button>
          <nav id="site-nav" className={`nav${open ? ' open' : ''}`} aria-label="Main">
            <NavLink to="/evaluation">Evaluation</NavLink>
            <NavLink to="/data">Data &amp; method</NavLink>
            <NavLink to="/analyze">Analyze a file</NavLink>
            <Link to="/demo" className="btn btn-primary btn-sm">Open demo</Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <p>TOCSIN · built for Wild Bugs PS01 (MachinaSense). Demo data: IMS Bearing Data Set, NASA Prognostics Data Repository.</p>
          <p>
            <Link to="/data">Sources &amp; licence</Link> · <Link to="/evaluation#reproduce">Reproduce</Link>
          </p>
        </div>
      </footer>
    </>
  )
}
