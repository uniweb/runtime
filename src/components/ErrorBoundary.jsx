/**
 * ErrorBoundary
 *
 * React error boundary to catch and display errors gracefully.
 */

import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Runtime] Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div style={{
          padding: '2rem',
          margin: '1rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '0.5rem',
          color: '#dc2626'
        }}>
          <h2 style={{ margin: '0 0 1rem' }}>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
          {import.meta.env?.DEV && (
            <pre style={{ fontSize: '0.75rem', overflow: 'auto', marginTop: '1rem' }}>
              {this.state.error?.stack}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
