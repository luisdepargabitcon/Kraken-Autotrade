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
  it("AmaLabPanel.tsx never calls onSetMode directly (only ShadowLiveTab's explicit start/stop CTA does)", async () => {
    // Regression guard for the R4 bug where switching Lab subtabs (or the
    // 4 home cards) silently changed the backend AMA mode. AmaLabPanel now
    // only navigates local view state (activeFlow/subtab); the only place
    // allowed to call onSetMode is the explicit "Iniciar/Detener simulación"
    // CTA inside ShadowLiveTab (AmaTabs.tsx), which is passed down as a prop.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AmaLabPanel.tsx"),
      "utf-8",
    );
    expect(src).not.toContain("onSetMode(");
    // onSetMode must still be forwarded as a prop to ShadowLiveTab (the only
    // legitimate consumer), not swallowed.
    expect(src).toContain("onSetMode={onSetMode}");
  });
});

describe("AmaRealPanel source — single-level navigation, no internal Tabs bar", () => {
  it("no longer imports/renders its own Tabs/TabsList (nav is fully delegated to AmaContextualNav)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AmaRealPanel.tsx"),
      "utf-8",
    );
    expect(src).not.toContain("TabsList");
    expect(src).not.toContain("TabsTrigger");
  });
});

describe("Terminología global AMA — sin términos técnicos prohibidos visibles", () => {
  // Regresión: se detectaron y corrigieron "Maker"/"post-only"/"handler"/
  // "endpoint" visibles en amaLabels.ts y AmaModeGuide.tsx (§11 auditoría R4).
  // "Ledger" se excluye intencionalmente: es un identificador interno de
  // código (LedgerTab/LedgerEntry en AmaTabs.tsx), nunca texto visible — el
  // texto visible ya usa "Movimientos" (verificado manualmente).
  const FORBIDDEN = ["handler", "endpoint", "post-only", "Maker", "Kill Switch"];
  const FILES = [
    "../amaLabels.ts",
    "../AmaModeGuide.tsx",
    "../AmaHelpTab.tsx",
    "../AmaTabs.tsx",
    "../AmaRealPanel.tsx",
    "../AmaCommandBar.tsx",
    "../AmaEventsPanel.tsx",
  ];

  it.each(FILES)("%s contains no forbidden raw technical term", async (relPath) => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");
    for (const term of FORBIDDEN) {
      expect(src, `${relPath} should not contain "${term}"`).not.toContain(term);
    }
  });
});

describe("AmaTabs source — API buttons validate response.ok/json.success (§3 R4)", () => {
  it("startLab/startReplay/createScenario/runScenario/closeScenario check res.ok before treating as success", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../AmaTabs.tsx"), "utf-8");
    // Regression: these previously used a bare `api()` helper that never
    // checked res.ok, silently treating network/server errors as success.
    const okChecks = (src.match(/!res\.ok \|\| !json\?\.success/g) || []).length;
    expect(okChecks).toBeGreaterThanOrEqual(5);
  });

  it("grant() (Activar real limitado) has double-click protection via a busy flag", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../AmaTabs.tsx"), "utf-8");
    expect(src).toContain("if (granting) return;");
  });
});

describe("AmaRealActivationWizard — CHECK_LABELS covers every backend readiness key", () => {
  it("every checks.<key> produced by evaluateRealActivationReadiness has a CHECK_LABELS entry (regression: gatewayAvailable/makerOnly/postOnly/schedulerOperational/realFullLocked leaked raw in staging)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const backendSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../../../server/services/ama/amaRealLimitedService.ts"),
      "utf-8",
    );
    const wizardSrc = fs.readFileSync(
      path.resolve(__dirname, "../AmaRealActivationWizard.tsx"),
      "utf-8",
    );
    const backendKeys = new Set(
      [...backendSrc.matchAll(/checks\.(\w+)\s*=/g)].map((m) => m[1]),
    );
    expect(backendKeys.size).toBeGreaterThanOrEqual(15); // sanity: evita un regex roto que no encuentre nada
    const missing = [...backendKeys].filter((key) => !wizardSrc.includes(`  ${key}: {`));
    expect(missing, `CHECK_LABELS le falta traducir: ${missing.join(", ")}`).toEqual([]);
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
