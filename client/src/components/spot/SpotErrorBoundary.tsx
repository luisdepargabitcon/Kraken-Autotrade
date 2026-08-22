import * as React from "react";

interface Props {
  children: React.ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SpotErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[SpotErrorBoundary] ${this.props.name}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-6 text-amber-400 text-sm">
          <p className="font-semibold">No se pudo mostrar este panel</p>
          <p className="text-xs text-muted-foreground mt-1">{this.state.error?.message || "Error desconocido"}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
