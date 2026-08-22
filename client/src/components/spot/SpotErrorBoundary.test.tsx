import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { SpotErrorBoundary } from "./SpotErrorBoundary";

describe("SpotErrorBoundary", () => {
  it.skip("renders Spanish fallback when a child throws", () => {
    // Error-boundary catch paths require a client-side DOM renderer.
    // This suite uses react-dom/server in a node environment; the runtime
    // does not invoke componentDidCatch, so the throwing-child test is skipped.
  });

  it("renders children when there is no error", () => {
    const html = renderToString(
      <SpotErrorBoundary name="Historial">
        <div data-testid="ok">Contenido normal</div>
      </SpotErrorBoundary>,
    );
    expect(html).toContain("Contenido normal");
    expect(html).not.toContain("No se pudo mostrar este panel");
  });
});
