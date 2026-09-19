import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Last-resort safety net: an uncaught error anywhere in the routed page tree
// would otherwise unmount the whole React app, leaving a blank screen with
// no way to recover short of a manual browser refresh. This catches that,
// shows a recoverable fallback instead, and lets the user retry the current
// page without losing the rest of the app (nav bar, WebSocket connection).
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AANKHODEKHA: caught a render error', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle size={40} style={{ color: 'var(--accent-red)' }} />
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              This page hit an unexpected error
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              {this.state.error.message || 'Something went wrong rendering this view.'}
            </div>
          </div>
          <button className="btn-primary flex items-center gap-2" onClick={this.reset}>
            <RotateCcw size={14} />
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
