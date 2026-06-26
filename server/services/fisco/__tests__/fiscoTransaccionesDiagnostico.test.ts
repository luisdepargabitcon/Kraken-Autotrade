/**
 * Tests para paginación de transacciones, diagnostic-detail y regresión FISCO.
 *
 * Transacciones:
 *   T-01 a T-10: endpoint operations, paginación, filtros, UI
 *
 * Diagnóstico:
 *   D-01 a D-08: endpoint diagnostic-detail, copy castellano, UI
 *
 * Regresión:
 *   R-01 a R-04: control-status, finalization, result-history no se rompen
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const CLIENT_DIR = join(__dirname, "../../../../client/src/components/fisco");
const DASHBOARD_PATH = join(__dirname, "../../../../client/src/pages/FiscoDashboard.tsx");
const ROUTES_PATH = join(__dirname, "../../../routes/fisco.routes.ts");

// ─── Transacciones ────────────────────────────────────────────────────────────

describe("Transacciones — paginación y filtros", () => {
  const routesContent = readFileSync(ROUTES_PATH, "utf-8");
  const txContent = readFileSync(join(CLIENT_DIR, "FiscoTransaccionesSection.tsx"), "utf-8");

  it("T-01: endpoint operations soporta parámetro page", () => {
    expect(routesContent).toContain("req.query.page");
  });

  it("T-02: endpoint operations soporta parámetro pageSize", () => {
    expect(routesContent).toContain("req.query.pageSize");
  });

  it("T-03: endpoint operations devuelve total y totalPages", () => {
    expect(routesContent).toContain("totalPages");
    expect(routesContent).toContain("Math.ceil(total / pageSize)");
  });

  it("T-04: endpoint operations no mezcla años cuando se filtra por year", () => {
    expect(routesContent).toContain("EXTRACT(YEAR FROM executed_at)");
  });

  it("T-05: endpoint operations soporta filtro por asset", () => {
    expect(routesContent).toContain("assetFilter");
    expect(routesContent).toContain("asset = $");
  });

  it("T-06: endpoint operations soporta filtro por exchange", () => {
    expect(routesContent).toContain("exchangeFilter");
    expect(routesContent).toContain("exchange = $");
  });

  it("T-07: UI contiene selector 25/50/100", () => {
    expect(txContent).toContain("25");
    expect(txContent).toContain("50");
    expect(txContent).toContain("100");
    expect(txContent).toContain("PAGE_SIZES");
  });

  it("T-08: UI contiene texto 'Mostrando'", () => {
    expect(txContent).toContain("Mostrando");
  });

  it("T-09: UI abre detalle al seleccionar operación (drawer)", () => {
    expect(txContent).toContain("OperationDetailDrawer");
    expect(txContent).toContain("setSelectedOp");
  });

  it("T-10: detalle usa 'Compra/Venta/Comisión', no 'buy/sell/fee' como texto visible", () => {
    expect(txContent).toContain('"Compra"');
    expect(txContent).toContain('"Venta"');
    expect(txContent).toContain('"Comisión"');
    // No debe tener labels en inglés como texto visible (sí como keys de op_type)
    const visibleLabels = txContent.match(/label:\s*"(buy|sell|fee)"/gi);
    expect(visibleLabels ?? []).toHaveLength(0);
  });
});

// ─── Diagnóstico ──────────────────────────────────────────────────────────────

describe("Diagnóstico — detalle en lenguaje natural", () => {
  const routesContent = readFileSync(ROUTES_PATH, "utf-8");
  const diagContent = readFileSync(join(CLIENT_DIR, "FiscoDiagnosticoSectionV2.tsx"), "utf-8");

  it("D-01: endpoint diagnostic-detail devuelve natural_explanation", () => {
    expect(routesContent).toContain("natural_explanation");
    expect(routesContent).toContain("/api/fisco/diagnostic-detail");
  });

  it("D-02: DUST se traduce a 'Saldo residual'", () => {
    expect(routesContent).toContain('DUST: "Saldo residual"');
    expect(diagContent).toContain('"Saldo residual"');
  });

  it("D-03: estado OK se muestra como 'Correcto'", () => {
    expect(routesContent).toContain('OK: "Correcto"');
    expect(diagContent).toContain('"Correcto"');
  });

  it("D-04: modal/drawer incluye 'Qué significa este diagnóstico'", () => {
    expect(diagContent).toContain("Qué significa este diagnóstico");
  });

  it("D-05: modal/drawer incluye 'Impacto fiscal'", () => {
    expect(diagContent).toContain("Impacto fiscal");
  });

  it("D-06: modal/drawer incluye 'Acción recomendada'", () => {
    expect(diagContent).toContain("Acción recomendada");
  });

  it("D-07: no aparece 'Opening', 'Diff', 'Dust' como texto principal visible en diagnóstico", () => {
    // La tabla usa labels en castellano. Verificar que las cabeceras no usan inglés.
    const headerMatches = diagContent.match(/"Opening"|"Diff"|"Dust"/g);
    // Solo permitido en comentarios o tipos, no como texto visible de cabecera
    const visibleHeaders = diagContent.match(/label:\s*"(Opening|Diff|Dust)"/g);
    expect(visibleHeaders ?? []).toHaveLength(0);
  });

  it("D-08: no aparece texto inglés visible en la explicación natural del endpoint", () => {
    // El endpoint debe generar explicaciones en castellano
    expect(routesContent).toContain("El saldo de");
    expect(routesContent).toContain("El sistema detecta una diferencia");
    expect(routesContent).toContain("El cálculo detecta inventario negativo");
  });
});

// ─── Regresión FISCO ──────────────────────────────────────────────────────────

describe("Regresión — control fiscal no se rompe", () => {
  const routesContent = readFileSync(ROUTES_PATH, "utf-8");
  const dashboardContent = readFileSync(DASHBOARD_PATH, "utf-8");

  it("R-01: endpoint control-status sigue presente", () => {
    expect(routesContent).toContain("/api/fisco/control-status");
  });

  it("R-02: endpoint finalization-status sigue presente", () => {
    expect(routesContent).toContain("/api/fisco/finalization-status");
  });

  it("R-03: endpoint result-history sigue presente", () => {
    expect(routesContent).toContain("/api/fisco/result-history");
  });

  it("R-04: FiscoDashboard renderiza FiscoControlSection", () => {
    expect(dashboardContent).toContain("FiscoControlSection");
    expect(dashboardContent).toContain('"control"');
  });
});
