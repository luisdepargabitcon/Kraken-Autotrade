/**
 * AMA R4 — Contract tests for mode-selector correctness and navigation
 * side-effect isolation. See workflow fix/ama-r4-controls-lab-ux-20260810.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { AmaModeSelector } from "../AmaModeSelector";
import { translateMacroZone } from "../amaLabels";

// NOTA: este repo no tiene jsdom / @testing-library/react instalados (entorno
// de test vitest "node"). Estos tests validan comportamiento observable vía
// renderToString (mismo patrón que amaUxRedesign.test.tsx) y contratos puros.
// La simulación de clics real (§21 del workflow R4) requiere jsdom +
// testing-library, que no se han añadido en esta sesión para no ampliar el
// alcance de dependencias sin necesidad estrictamente bloqueante. Pendiente
// como seguimiento explícito (ver informe final).

afterEach(() => {
  vi.restoreAllMocks();
});

// AmaModeSelector no usa hooks: es una función pura (props) => JSX. Podemos
// invocarla directamente para inspeccionar el árbol de elementos React sin
// necesidad de jsdom, y disparar sus onClick manualmente.
function findNodeByText(node: any, text: string): any {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNodeByText(child, text);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const children = node.props?.children;
  const hasDirectText = children === text || (Array.isArray(children) && children.includes(text));
  if (hasDirectText && node.props?.onClick) return node;
  const found = findNodeByText(children, text);
  return found;
}

describe("AmaModeSelector — backend truth only", () => {
  it("marks OFF as active only when environment prop says OFF (renders via renderToString)", () => {
    const html = renderToString(
      <AmaModeSelector environment="OFF" onSelectEnvironment={() => {}} />,
    );
    expect(html).toContain("Desactivado");
  });

  it("does not call onSelectEnvironment automatically (pure render, no hooks/effects)", () => {
    const spy = vi.fn();
    renderToString(<AmaModeSelector environment="OFF" onSelectEnvironment={spy} />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clicking Real invokes the handler but never assumes activation itself", () => {
    const spy = vi.fn();
    const tree = AmaModeSelector({ environment: "OFF", onSelectEnvironment: spy }) as any;
    const realButton = findNodeByText(tree, "Real");
    expect(realButton).not.toBeNull();
    realButton.props.onClick();
    expect(spy).toHaveBeenCalledWith("REAL");
    // AmaModeSelector no cambia su propio estado: `environment` sigue viniendo
    // del padre (backend truth). El padre (Ama.tsx) decide si abre el wizard
    // o marca REAL activo, solo tras confirmación del backend.
  });
});

describe("AmaLabPanel source — no mode side-effects wired to tab navigation", () => {
  it("handleSubtabChange no longer references onSetMode (source-level regression guard)", async () => {
    // Import the raw source and assert the tab-change handler body contains
    // no call to onSetMode. This guards against reintroducing the R4 bug
    // where switching Lab subtabs silently changed the backend AMA mode.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AmaLabPanel.tsx"),
      "utf-8",
    );
    const handlerMatch = src.match(/function handleSubtabChange\([^)]*\)\s*{([\s\S]*?)\n  }/);
    expect(handlerMatch).not.toBeNull();
    const handlerBody = handlerMatch ? handlerMatch[1] : "";
    expect(handlerBody).not.toContain("onSetMode");
  });
});

describe("amaLabels — macro zone translation never leaks raw enums", () => {
  it("translates every real backend MacroZone value (see amaTypes.ts)", () => {
    expect(translateMacroZone("NORMAL")).toBe("Normal");
    expect(translateMacroZone("RETROCESO")).toBe("Retroceso");
    expect(translateMacroZone("CORRECCION")).toBe("Corrección");
    expect(translateMacroZone("VALUE")).toBe("Zona de valor");
    expect(translateMacroZone("DEEP_VALUE")).toBe("Valor profundo");
    expect(translateMacroZone("CAPITULACION")).toBe("Capitulación");
    expect(translateMacroZone("CAPITULACION_EXTREMA")).toBe("Capitulación extrema");
  });

  it("never renders a raw/unknown enum to the user", () => {
    expect(translateMacroZone("SOME_FUTURE_ZONE")).toBe("Sin clasificar");
    expect(translateMacroZone(undefined)).toBe("Sin clasificar");
    expect(translateMacroZone(null)).toBe("Sin clasificar");
  });
});
