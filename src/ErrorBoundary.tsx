import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unexpected UI error.',
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('UI render failure:', error, errorInfo)
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main style={{ padding: '2rem', fontFamily: '"Avenir Next", "Segoe UI", sans-serif' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Something went wrong in the UI</h1>
          <p style={{ marginBottom: '0.75rem' }}>
            {this.state.message || 'A runtime error prevented the app from rendering.'}
          </p>
          <p style={{ opacity: 0.8 }}>
            Open DevTools Console for the full stack trace and refresh after restarting the dev server.
          </p>
        </main>
      )
    }

    return this.props.children
  }
}

