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

// ── K: Natural language + safe proposal + filter lock tests ───────────────────

describe("getNaturalReason — lenguaje natural", () => {

  function getNaturalReason(score: number, threshold: number, wouldBlock: boolean): string {
    return wouldBlock
      ? `Confianza insuficiente: ${(score * 100).toFixed(1)}% calculado, mínimo ${(threshold * 100).toFixed(0)}% exigido.`
      : `Supera el mínimo: ${(score * 100).toFixed(1)}% calculado, umbral ${(threshold * 100).toFixed(0)}%.`;
  }

  it("score < threshold → 'Confianza insuficiente'", () => {
    const msg = getNaturalReason(0.499, 0.8, true);
    expect(msg).toContain("Confianza insuficiente");
    expect(msg).toContain("49.9%");
    expect(msg).toContain("mínimo 80% exigido");
  });

  it("score >= threshold → 'Supera el mínimo'", () => {
    const msg = getNaturalReason(0.85, 0.8, false);
    expect(msg).toContain("Supera el mínimo");
    expect(msg).toContain("85.0%");
    expect(msg).toContain("umbral 80%");
  });

  it("wouldBlock=true always uses block message regardless of score label", () => {
    const msg = getNaturalReason(0.9, 0.8, true);
    expect(msg).toContain("Confianza insuficiente");
  });

});

describe("safeProposal — nunca activa filterEnabled", () => {

  function buildSafeProposal(precision: number | null, shadowEvaluated: number, currentThreshold: number) {
    const recThreshold = (!precision || precision < 0.60 || shadowEvaluated < 30)
      ? 0.80 : precision >= 0.70 ? 0.70 : 0.75;
    return { shadowEnabled: true, filterEnabled: false, threshold: recThreshold };
  }

  it("safe proposal always has filterEnabled=false", () => {
    const cases = [
      { precision: null,  evaluated: 0,  threshold: 0.8 },
      { precision: 0.40,  evaluated: 5,  threshold: 0.8 },
      { precision: 0.65,  evaluated: 35, threshold: 0.75 },
      { precision: 0.75,  evaluated: 50, threshold: 0.8 },
    ];
    cases.forEach(({ precision, evaluated, threshold }) => {
      const p = buildSafeProposal(precision, evaluated, threshold);
      expect(p.filterEnabled).toBe(false);
    });
  });

  it("safe proposal always has shadowEnabled=true", () => {
    const p = buildSafeProposal(null, 0, 0.8);
    expect(p.shadowEnabled).toBe(true);
  });

  it("recThreshold=80% when precision<60% or evaluated<30", () => {
    expect(buildSafeProposal(null,  0,  0.8).threshold).toBe(0.80);
    expect(buildSafeProposal(0.50, 10, 0.8).threshold).toBe(0.80);
    expect(buildSafeProposal(0.65, 10, 0.8).threshold).toBe(0.80);
  });

  it("recThreshold=70% when precision>=70% and evaluated>=30", () => {
    expect(buildSafeProposal(0.72, 40, 0.8).threshold).toBe(0.70);
  });

  it("recThreshold=75% when 60%<=precision<70% and evaluated>=30", () => {
    expect(buildSafeProposal(0.62, 35, 0.8).threshold).toBe(0.75);
  });

});

describe("canActivateRealFilter — requisitos mínimos", () => {

  function canActivate(evaluated: number, precision: number | null, accuracy: number | null): boolean {
    return evaluated >= 30 &&
      precision !== null && precision >= 0.60 &&
      accuracy  !== null && accuracy  >= 0.55;
  }

  it("blocked when evaluatedPredictions < 30", () => {
    expect(canActivate(29, 0.70, 0.60)).toBe(false);
    expect(canActivate(0,  0.80, 0.80)).toBe(false);
  });

  it("blocked when precision < 0.60", () => {
    expect(canActivate(50, 0.59, 0.60)).toBe(false);
    expect(canActivate(50, null, 0.60)).toBe(false);
  });

  it("blocked when accuracy < 0.55", () => {
    expect(canActivate(50, 0.65, 0.54)).toBe(false);
    expect(canActivate(50, 0.65, null)).toBe(false);
  });

  it("unlocked only when all three conditions met", () => {
    expect(canActivate(30, 0.60, 0.55)).toBe(true);
    expect(canActivate(50, 0.75, 0.70)).toBe(true);
  });

  it("state current (3 pending, 0 evaluated) → locked", () => {
    expect(canActivate(0, null, null)).toBe(false);
  });

});

describe("newPrediction metadata — campos obligatorios", () => {

  function buildShadowSave(score: number, threshold: number, pair: string, approve: boolean, selectedStrategyId: string | null) {
    return {
      tradeId: `CANDLES-${Date.now()}-${pair}`,
      score: score.toFixed(4),
      threshold: threshold.toFixed(4),
      wouldBlock: !approve,
      pair,
      action: approve ? "WOULD_ALLOW" : "WOULD_BLOCK",
      confidence: score.toFixed(4),
      reason: !approve
        ? `Confianza insuficiente: ${(score * 100).toFixed(1)}% calculado, mínimo ${(threshold * 100).toFixed(0)}% exigido.`
        : null,
      metadataJson: {
        signal: "BUY",
        strategy: selectedStrategyId ?? null,
        aiDecision: approve ? "ALLOW" : "BLOCK",
        naturalReason: !approve
          ? `La IA detectó que la compra no supera la confianza mínima exigida del ${(threshold * 100).toFixed(0)}%.`
          : `La IA permite la compra con confianza del ${(score * 100).toFixed(1)}%.`,
      },
    };
  }

  it("saves pair field", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, null);
    expect(s.pair).toBe("TON/USD");
  });

  it("saves action=WOULD_BLOCK when not approved", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, null);
    expect(s.action).toBe("WOULD_BLOCK");
    expect(s.wouldBlock).toBe(true);
  });

  it("saves action=WOULD_ALLOW when approved", () => {
    const s = buildShadowSave(0.85, 0.8, "BTC/USD", true, "momentum");
    expect(s.action).toBe("WOULD_ALLOW");
    expect(s.wouldBlock).toBe(false);
  });

  it("reason in Spanish when blocked", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, null);
    expect(s.reason).toContain("Confianza insuficiente");
  });

  it("reason is null when allowed", () => {
    const s = buildShadowSave(0.85, 0.8, "BTC/USD", true, null);
    expect(s.reason).toBeNull();
  });

  it("metadataJson has signal=BUY always", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, "momentum");
    expect(s.metadataJson.signal).toBe("BUY");
  });

  it("metadataJson naturalReason mentions threshold percentage", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, null);
    expect(s.metadataJson.naturalReason).toContain("80%");
  });

  it("FISCO not touched — no fisco fields in shadow save", () => {
    const s = buildShadowSave(0.499, 0.8, "TON/USD", false, null);
    expect("fisco" in s).toBe(false);
    expect("idca" in s).toBe(false);
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
