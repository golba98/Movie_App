import { Component, type ReactNode } from 'react'
import { Link } from 'react-router'

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // The UI recovers without exposing runtime details to visitors.
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto flex min-h-screen max-w-xl items-center px-4 text-center">
          <div>
            <h1 className="text-3xl font-black">CineScope hit an unexpected problem</h1>
            <p className="mt-4 text-zinc-400">Reload the page to try again. Your favourites remain saved on this device.</p>
            <Link to="/" onClick={() => this.setState({ failed: false })} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-black text-zinc-950">Return home</Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
