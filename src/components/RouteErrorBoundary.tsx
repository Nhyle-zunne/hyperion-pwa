import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Keep diagnostics useful without logging any screen data or user content.
    console.error('[Hyperion] A route failed to render.', error.name, error.message)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen" role="alert" aria-live="assertive">
          <section className="card" style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center' }}>
            <h1 className="page-title">We couldn’t load this page</h1>
            <p className="subtitle">
              A temporary error or an app update may have interrupted this screen.
            </p>
            <p style={{ marginBottom: 18 }}>
              Reload Hyperion to try loading the page again.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload Hyperion
            </button>
          </section>
        </div>
      )
    }

    return this.props.children
  }
}
