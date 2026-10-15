/* eslint-disable react-refresh/only-export-components -- application entrypoint mounts React. */
import '@fontsource-variable/inter-tight/wght.css'
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import './styles/global.css'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import Landing from './pages/Landing'

const Workspace = lazy(() => import('./pages/Workspace'))
const Evaluation = lazy(() => import('./pages/Evaluation'))
const DataPage = lazy(() => import('./pages/DataPage'))
const Analyze = lazy(() => import('./pages/Analyze'))

function NotFound() {
  return (
    <div className="wrap" style={{ padding: '80px 0' }}>
      <h1>Page not found</h1>
      <p className="muted" style={{ margin: '12px 0 20px' }}>That address does not exist in TOCSIN.</p>
      <Link className="btn btn-primary" to="/">Go to the start</Link>
    </div>
  )
}

const Loading = () => <div className="wrap" style={{ padding: '40px 0' }}><div className="skeleton" style={{ height: 320 }} aria-label="Loading" /></div>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last line of defence: anything that escapes the page-level boundary still leaves a recovery screen. */}
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="demo" element={<Workspace />} />
            <Route path="demo/:run" element={<Workspace />} />
            <Route path="evaluation" element={<Evaluation />} />
            <Route path="data" element={<DataPage />} />
            <Route path="analyze" element={<Analyze />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
