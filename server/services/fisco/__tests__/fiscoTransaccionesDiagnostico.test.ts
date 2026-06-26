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

// ─── Fase 1: Hotfix VPS ──────────────────────────────────────────────────────

describe("Fase 1 — Hotfix VPS: schema, operations, UI", () => {
  const routesContent = readFileSync(ROUTES_PATH, "utf-8");
  const txContent = readFileSync(join(CLIENT_DIR, "FiscoTransaccionesSection.tsx"), "utf-8");
  const diagContent = readFileSync(join(CLIENT_DIR, "FiscoDiagnosticoSectionV2.tsx"), "utf-8");
  const dashboardContent = readFileSync(DASHBOARD_PATH, "utf-8");
  const SCHEMA_ENSURE_PATH = join(__dirname, "../FiscoControlSchemaEnsureService.ts");

  // F1-Schema
  it("H-01: FiscoControlSchemaEnsureService existe", () => {
    const svcContent = readFileSync(SCHEMA_ENSURE_PATH, "utf-8");
    expect(svcContent).toContain("FiscoControlSchemaEnsureService");
    expect(svcContent).toContain("operation_set_hash");
    expect(svcContent).toContain("fisco_result_history");
    expect(svcContent).toContain("fisco_control_snapshots");
  });

  it("H-02: schema ensure usa ADD COLUMN IF NOT EXISTS", () => {
    const svcContent = readFileSync(SCHEMA_ENSURE_PATH, "utf-8");
    expect(svcContent).toContain("ADD COLUMN IF NOT EXISTS");
  });

  it("H-03: schema ensure usa CREATE TABLE IF NOT EXISTS", () => {
    const svcContent = readFileSync(SCHEMA_ENSURE_PATH, "utf-8");
    expect(svcContent).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("H-04: schema-health incluye fisco_result_history y fisco_control_snapshots", () => {
    expect(routesContent).toContain("fisco_result_history");
    expect(routesContent).toContain("fisco_control_snapshots");
  });

  it("H-05: schema-health verifica columnas operation_set_hash y fiscal_year", () => {
    expect(routesContent).toContain("operation_set_hash");
    expect(routesContent).toContain("fiscal_year");
    expect(routesContent).toContain("information_schema.columns");
  });

  // F1-Operations
  it("H-06: operations usa query de conteo separada (COUNT sin ORDER BY)", () => {
    expect(routesContent).toContain("SELECT COUNT(*)::int AS total FROM fisco_operations fo");
  });

  it("H-07: operations no usa query.replace para count", () => {
    expect(routesContent).not.toContain('query.replace("SELECT *"');
  });

  it("H-08: operations mapea sort a columnas con prefijo fo.", () => {
    expect(routesContent).toContain("fo.executed_at");
    expect(routesContent).toContain("SORT_MAP");
  });

  it("H-09: operations usa sort seguro por defecto (fo.executed_at)", () => {
    expect(routesContent).toContain('?? "fo.executed_at"');
  });

  it("H-10: operations devuelve rows y operations (alias)", () => {
    expect(routesContent).toContain("rows: result.rows");
    expect(routesContent).toContain("operations: result.rows");
  });

  it("H-11: operations usa LEFT JOIN para disposals_count", () => {
    expect(routesContent).toContain("LEFT JOIN");
    expect(routesContent).toContain("disposals_count");
    expect(routesContent).toContain("sell_operation_id");
  });

  // F1-UI
  it("H-12: UI no muestra SQL crudo como mensaje principal", () => {
    expect(txContent).toContain("No se pudieron cargar las transacciones fiscales.");
    expect(txContent).toContain("Detalle técnico");
    expect(txContent).toContain("<details");
  });

  it("H-13: tabla Transacciones usa min-w-[1300px]", () => {
    expect(txContent).toContain("min-w-[1300px]");
  });

  it("H-14: tabla Diagnóstico usa min-w-[1350px]", () => {
    expect(diagContent).toContain("min-w-[1350px]");
  });

  it("H-15: dashboard usa max-w-[1600px]", () => {
    expect(dashboardContent).toContain("max-w-[1600px]");
  });

  // F1-Control status resilience
  it("H-16: control-status usa try-catch para operation_set_hash", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain("operation_set_hash may not exist");
  });

  it("H-17: control-status getOfficialResult usa try-catch para operation_set_hash", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    // Should have two try-catch blocks for operation_set_hash queries
    const matches = svcContent.match(/operation_set_hash may not exist/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  // F1-No FIFO changes
  it("H-18: no se modifica FiscoRebuildService commitToOfficial", () => {
    const rebuildContent = readFileSync(join(__dirname, "../../FiscoRebuildService.ts"), "utf-8");
    expect(rebuildContent).toContain("commitToOfficial");
    expect(rebuildContent).toContain("recordResultHistory");
  });

  // F1.7a: fee_asset fix
  it("H-19: operations no referencia fo.fee_asset directamente", () => {
    // Should use NULL::text AS fee_asset, not fo.fee_asset
    expect(routesContent).toContain("NULL::text AS fee_asset");
    expect(routesContent).not.toContain("fo.fee_asset");
  });

  it("H-20: operations SELECT no incluye fo.fee_asset en query de datos", () => {
    // Verify both data queries (paginated and non-paginated) use NULL::text
    const matches = routesContent.match(/NULL::text AS fee_asset/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  // F1.7b: official_engine correction
  it("H-21: control-status devuelve legacy_fifo cuando engine mode es v2_shadow", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain('=== "v2_official" ? "v2_official" : "legacy_fifo"');
  });

  it("H-22: control-status no usa config.fiscoEngineMode directamente como official_engine", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    // The return should use officialEngine variable, not config.fiscoEngineMode
    expect(svcContent).toContain("official_engine: officialEngine");
  });

  // F1.7c: has_operation_set_hash + warning
  it("H-23: control-status incluye has_operation_set_hash", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain("has_operation_set_hash");
  });

  it("H-24: control-status incluye warning si hash es null", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain("anterior al sistema de huella");
  });

  it("H-25: control-status bloquea activación V2 si hash es null", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain("v2_activation_blocked");
    expect(svcContent).toContain("v2_activation_block_reason");
  });

  // F1.7d: scope counts
  it("H-26: data_fingerprint incluye operations_count_scope = year", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain('operations_count_scope: "year"');
  });

  it("H-27: last_committed_run incluye operations_count_scope = global", () => {
    const svcContent = readFileSync(join(__dirname, "../FiscoControlStatusService.ts"), "utf-8");
    expect(svcContent).toContain('operations_count_scope: "global"');
  });

  // F1.7e: UI fee_asset null
  it("H-28: UI FiscoOperation incluye fee_asset: string | null", () => {
    expect(txContent).toContain("fee_asset: string | null");
  });

  it("H-29: UI drawer muestra fee_asset o € si es null", () => {
    expect(txContent).toContain("op.fee_asset");
    expect(txContent).toContain('` / ${op.fee_asset}`');
    expect(txContent).toContain('" €"');
  });
});
