import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** Keeps navigation and recovery available if a page fails to render (audit TC-01). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TOCSIN page error', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="wrap crash" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1 style={{ fontSize: 28 }}>This page could not be displayed.</h1>
        <p className="muted">
          The link may contain a value TOCSIN does not understand, or the page hit an unexpected error. Nothing was changed.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href="/demo">Open the replay from the start</a>
          <a className="btn" href="/">Go to the home page</a>
        </div>
        <p className="small muted mono">{this.state.error.message}</p>
      </div>
    )
  }
}
