import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './ui/Button'

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App crashed:', error, info)
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined })
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-bg p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-danger/15 text-danger">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
          <p className="mt-2 text-sm text-foreground/60">
            {this.state.error?.message || 'Erro inesperado ao renderizar a aplicação.'}
          </p>
          <div className="mt-6 flex justify-center">
            <Button onClick={this.reset} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Recarregar
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
