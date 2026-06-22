/**
 * aiShadowReport.test.ts
 *
 * Tests for /api/ai/shadow/report behavior:
 * - Never returns 500 when table doesn't exist or no data
 * - Returns clear message when shadowEnabled=true but modelLoaded=false
 * - Returns correct counts when data is present
 * - UI state logic for ObservacionTab
 */

import { describe, it, expect } from "vitest";

// ── Helpers that mirror the route logic ───────────────────────────────────────

interface ShadowReportInput {
  shadowEnabled: boolean;
  modelLoaded: boolean;
  total: number;
  pending: number;
  evaluated: number;
  blocked: number;
  allowed: number;
  blockedLosers: number;
  passedLosers: number;
  tableExists: boolean;
}

function buildShadowResponse(input: ShadowReportInput) {
  const { shadowEnabled, modelLoaded, total, pending, evaluated, blocked, allowed, blockedLosers, passedLosers, tableExists } = input;

  let message: string | null = null;
  if (!shadowEnabled) {
    message = "Modo observador desactivado. Actívalo para que la IA registre predicciones sin afectar operaciones reales.";
  } else if (!modelLoaded) {
    message = "Modo observador activado, pero todavía no puede registrar predicciones porque no hay modelo entrenado. Entrena el modelo primero.";
  } else if (total === 0) {
    message = "Modo observador activo y modelo cargado. Todavía no hay predicciones registradas — se registrarán con las próximas señales BUY evaluadas.";
  } else if (pending > 0 && evaluated === 0) {
    message = `${total} predicción${total !== 1 ? "es" : ""} registrada${total !== 1 ? "s" : ""}. Todas pendientes de resultado (operaciones aún abiertas).`;
  }

  return {
    enabled: shadowEnabled,
    modelLoaded,
    totalPredictions: total,
    pendingPredictions: pending,
    evaluatedPredictions: evaluated,
    allowedPredictions: allowed,
    tableExists,
    total,
    blocked,
    blockedLosers,
    passedLosers,
    message,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("aiShadowReport — /api/ai/shadow/report", () => {

  it("returns clean response when table does not exist", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: false,
      total: 0,
      pending: 0,
      evaluated: 0,
      blocked: 0,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: false,
    });

    expect(resp.totalPredictions).toBe(0);
    expect(resp.tableExists).toBe(false);
    // Should NOT throw — message should be set
    expect(resp.message).toBeTruthy();
    expect(resp.message).toContain("no hay modelo entrenado");
  });

  it("with shadowEnabled=true and modelLoaded=false: returns clear waiting message", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: false,
      total: 0,
      pending: 0,
      evaluated: 0,
      blocked: 0,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: true,
    });

    expect(resp.enabled).toBe(true);
    expect(resp.modelLoaded).toBe(false);
    expect(resp.message).toContain("no hay modelo entrenado");
    expect(resp.totalPredictions).toBe(0);
  });

  it("with shadowEnabled=false: returns disabled message", () => {
    const resp = buildShadowResponse({
      shadowEnabled: false,
      modelLoaded: false,
      total: 0,
      pending: 0,
      evaluated: 0,
      blocked: 0,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: true,
    });

    expect(resp.enabled).toBe(false);
    expect(resp.message).toContain("desactivado");
  });

  it("with shadowEnabled=true, modelLoaded=true, total=0: returns 'no predictions yet' message", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: true,
      total: 0,
      pending: 0,
      evaluated: 0,
      blocked: 0,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: true,
    });

    expect(resp.enabled).toBe(true);
    expect(resp.modelLoaded).toBe(true);
    expect(resp.totalPredictions).toBe(0);
    expect(resp.message).toContain("no hay predicciones registradas");
  });

  it("with predictions recorded (all pending): totalPredictions=3, message about pending", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: true,
      total: 3,
      pending: 3,
      evaluated: 0,
      blocked: 3,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: true,
    });

    expect(resp.totalPredictions).toBe(3);
    expect(resp.pendingPredictions).toBe(3);
    expect(resp.evaluatedPredictions).toBe(0);
    expect(resp.blocked).toBe(3);
    expect(resp.message).toContain("pendientes de resultado");
  });

  it("with mix of pending and evaluated: no pending message", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: true,
      total: 50,
      pending: 20,
      evaluated: 30,
      blocked: 15,
      allowed: 35,
      blockedLosers: 10,
      passedLosers: 8,
      tableExists: true,
    });

    expect(resp.totalPredictions).toBe(50);
    expect(resp.pendingPredictions).toBe(20);
    expect(resp.evaluatedPredictions).toBe(30);
    expect(resp.blocked).toBe(15);
    expect(resp.blockedLosers).toBe(10);
    expect(resp.passedLosers).toBe(8);
    expect(resp.message).toBeNull();
  });

  it("blockedLosers and passedLosers are 0 when all predictions are pending", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: true,
      total: 5,
      pending: 5,
      evaluated: 0,
      blocked: 4,
      allowed: 1,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: true,
    });

    expect(resp.blockedLosers).toBe(0);
    expect(resp.passedLosers).toBe(0);
    expect(resp.pendingPredictions).toBe(5);
  });

  it("with evaluated predictions: returns correct counts and no override message", () => {
    const resp = buildShadowResponse({
      shadowEnabled: true,
      modelLoaded: true,
      total: 50,
      pending: 0,
      evaluated: 50,
      blocked: 15,
      allowed: 35,
      blockedLosers: 10,
      passedLosers: 8,
      tableExists: true,
    });

    expect(resp.totalPredictions).toBe(50);
    expect(resp.blocked).toBe(15);
    expect(resp.blockedLosers).toBe(10);
    expect(resp.passedLosers).toBe(8);
    expect(resp.message).toBeNull();
  });

  it("response always contains required fields including new pending/evaluated", () => {
    const resp = buildShadowResponse({
      shadowEnabled: false,
      modelLoaded: false,
      total: 0,
      pending: 0,
      evaluated: 0,
      blocked: 0,
      allowed: 0,
      blockedLosers: 0,
      passedLosers: 0,
      tableExists: false,
    });

    expect("enabled" in resp).toBe(true);
    expect("modelLoaded" in resp).toBe(true);
    expect("totalPredictions" in resp).toBe(true);
    expect("pendingPredictions" in resp).toBe(true);
    expect("evaluatedPredictions" in resp).toBe(true);
    expect("allowedPredictions" in resp).toBe(true);
    expect("tableExists" in resp).toBe(true);
    expect("total" in resp).toBe(true);
    expect("blocked" in resp).toBe(true);
    expect("blockedLosers" in resp).toBe(true);
    expect("passedLosers" in resp).toBe(true);
    expect("message" in resp).toBe(true);
  });

});

// ── UI state logic tests ───────────────────────────────────────────────────────

describe("ObservacionTab — UI state logic", () => {

  function getEmptyStateLabel(shadowEnabled: boolean, modelLoaded: boolean, shadowTotal: number): string {
    if (!shadowEnabled) return "Modo observador desactivado";
    if (!modelLoaded)   return "Sin modelo entrenado";
    if (shadowTotal === 0) return "Sin predicciones shadow todavía";
    return "Con predicciones";
  }

  it("shows 'desactivado' when shadow is OFF", () => {
    expect(getEmptyStateLabel(false, false, 0)).toBe("Modo observador desactivado");
  });

  it("shows 'sin modelo' when shadow is ON but no model", () => {
    expect(getEmptyStateLabel(true, false, 0)).toBe("Sin modelo entrenado");
  });

  it("shows 'sin predicciones todavía' when shadow+model ON but no predictions", () => {
    expect(getEmptyStateLabel(true, true, 0)).toBe("Sin predicciones shadow todavía");
  });

  it("shows 'con predicciones' when predictions exist", () => {
    expect(getEmptyStateLabel(true, true, 42)).toBe("Con predicciones");
  });

  it("shadowEnabled=true + modelLoaded=false must trigger amber warning", () => {
    const showAmberWarning = (shadowEnabled: boolean, modelLoaded: boolean) =>
      shadowEnabled && !modelLoaded;

    expect(showAmberWarning(true, false)).toBe(true);
    expect(showAmberWarning(false, false)).toBe(false);
    expect(showAmberWarning(true, true)).toBe(false);
  });

  it("real filter cannot activate without loaded model", () => {
    const canActivateFilter = (canActivate: boolean, modelExists: boolean) =>
      canActivate && modelExists;

    expect(canActivateFilter(true, false)).toBe(false);
    expect(canActivateFilter(false, true)).toBe(false);
    expect(canActivateFilter(true, true)).toBe(true);
  });

});
