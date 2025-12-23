import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  console.error("[FATAL] Root element not found");
  document.body.innerHTML = '<div style="color:white;padding:20px;">Error: Root element not found. Please reload.</div>';
} else {
  try {
    createRoot(rootElement).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  } catch (e) {
    console.error("[FATAL] Error mounting React app:", e);
    document.body.innerHTML = `<div style="color:white;padding:20px;">Error mounting app: ${e}. Please reload.</div>`;
  }
}
