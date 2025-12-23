import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Error capturado:", error);
    console.error("[ErrorBoundary] Stack:", errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn("No se pudo limpiar storage:", e);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          color: "#fff",
          padding: "20px",
          fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
          <div style={{
            maxWidth: "600px",
            textAlign: "center"
          }}>
            <h1 style={{ color: "#ef4444", marginBottom: "16px" }}>
              Error de aplicación
            </h1>
            <p style={{ color: "#a1a1aa", marginBottom: "24px" }}>
              Ha ocurrido un error inesperado. Puedes intentar recargar la página.
            </p>
            
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "24px" }}>
              <button
                onClick={this.handleReload}
                data-testid="button-reload-page"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "16px"
                }}
              >
                Recargar página
              </button>
              <button
                onClick={this.handleClearAndReload}
                data-testid="button-clear-and-reload"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#52525b",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "16px"
                }}
              >
                Limpiar datos y recargar
              </button>
            </div>

            <details style={{ textAlign: "left", backgroundColor: "#1a1a1a", padding: "16px", borderRadius: "8px" }}>
              <summary style={{ cursor: "pointer", color: "#a1a1aa", marginBottom: "8px" }}>
                Detalles técnicos
              </summary>
              <pre style={{ 
                whiteSpace: "pre-wrap", 
                wordBreak: "break-word",
                fontSize: "12px",
                color: "#ef4444",
                margin: 0
              }}>
                {this.state.error?.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
