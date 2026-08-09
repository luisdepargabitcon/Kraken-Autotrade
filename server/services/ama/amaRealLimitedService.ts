/**
 * AMA REAL_LIMITED Service — Real execution with strict limits.
 *
 * REAL_LIMITED mode executes real orders on the exchange but with
 * persistent authorization, pre-trade gates, and hard limits.
 *
 * SAFETY:
 * - REAL_FULL is permanently locked. No service exists for it.
 * - REAL_LIMITED requires active authorization from ama_real_authorization table.
 * - Every order passes through pre-trade gates before execution.
 * - All gates are persisted (append-only) for auditability.
 * - Reconciliation runs after each order to verify exchange state.
 * - Kill switch blocks all REAL execution immediately.
 */

import {
  isRealLimitedAuthorized,
  getRealAuthorization,
  grantRealLimitedAuthorization,
  revokeRealAuthorization,
  restoreRealAuthorizationSnapshot,
  insertPreTradeGate,
  getPreTradeGatesByCycle,
  insertReconciliation,
  resolveReconciliation,
  getUnresolvedReconciliations,
  type RealAuthorizationRow,
  type PreTradeGateRow,
} from "./amaRealAuthorizationRepository";
import { amaRealStateService, amaHwmBootstrapService, amaSchedulerStateService } from "./amaFunctionalClosure";
import * as runtime from "./amaRuntimeService";
import { insertAuditEvent, checkAmaSchemaAvailable, getActivePolicy } from "./amaRepository";
import { AMA_PAIR } from "./amaTypes";
import { BTC_ASSET_PROFILE } from "./amaSeedTypes";
import { createHash } from "crypto";

// ─── Authorization Management ────────────────────────────────────────

export async function getAuthorizationStatus(): Promise<RealAuthorizationRow & { operationalState: string }> {
  const [auth, realState] = await Promise.all([
    getRealAuthorization(),
    amaRealStateService.getState().catch(() => ({ operationalState: "NOT_READY" as const })),
  ]);
  return { ...auth, operationalState: realState.operationalState };
}

export async function grantAuthorization(
  authorizedBy: string,
  maxCapitalUsd: number,
  maxSingleTrancheUsd: number,
  maxTranchesPerCycle: number,
  expiresAt?: string,
  reason?: string,
): Promise<void> {
  if (maxCapitalUsd <= 0) throw new Error("[AMA] maxCapitalUsd must be positive");
  if (maxSingleTrancheUsd <= 0) throw new Error("[AMA] maxSingleTrancheUsd must be positive");
  if (maxSingleTrancheUsd > maxCapitalUsd) throw new Error("[AMA] maxSingleTrancheUsd cannot exceed maxCapitalUsd");
  if (maxTranchesPerCycle < 1) throw new Error("[AMA] maxTranchesPerCycle must be at least 1");

  await grantRealLimitedAuthorization(
    authorizedBy,
    maxCapitalUsd,
    maxSingleTrancheUsd,
    maxTranchesPerCycle,
    expiresAt,
    reason,
  );

  await insertAuditEvent("REAL_AUTHORIZATION_GRANTED", "WARN", {
    authorizedBy,
    maxCapitalUsd,
    maxSingleTrancheUsd,
    maxTranchesPerCycle,
    expiresAt,
  });
}

export async function revokeAuthorization(
  revokedBy: string,
  reason?: string,
): Promise<void> {
  await revokeRealAuthorization(revokedBy, reason);
  await insertAuditEvent("REAL_AUTHORIZATION_REVOKED", "WARN", {
    revokedBy,
    reason,
  });
}

export async function isAuthorized(): Promise<boolean> {
  return await isRealLimitedAuthorized();
}

// ─── REAL_LIMITED Readiness Evaluation ───────────────────────────────

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

export interface RealActivationReadiness {
  ready: boolean;
  checks: Record<string, ReadinessCheck>;
  blockers: string[];
}

export async function evaluateRealActivationReadiness(): Promise<RealActivationReadiness> {
  const checks: Record<string, ReadinessCheck> = {};
  const blockers: string[] = [];

  // ── 1. Feature flag ───────────────────────────────────────────────
  const featureEnabled = process.env.AMA_REAL_EXECUTION_ENABLED === "true";
  checks.featureFlag = { ok: featureEnabled, detail: featureEnabled ? "enabled" : "disabled in this environment" };
  if (!featureEnabled) blockers.push("FEATURE_FLAG_DISABLED");

  // ── 2. Kill switch ────────────────────────────────────────────────
  try {
    const ks = runtime.isKillSwitchActive();
    checks.killSwitch = { ok: !ks, detail: ks ? "kill switch is active" : "not active" };
    if (ks) blockers.push("KILL_SWITCH_ACTIVE");
  } catch {
    checks.killSwitch = { ok: false, detail: "could not read kill switch state" };
    blockers.push("KILL_SWITCH_UNREADABLE");
  }

  // ── 3. Schema / database ──────────────────────────────────────────
  try {
    const schemaOk = await checkAmaSchemaAvailable();
    checks.schema = { ok: schemaOk, detail: schemaOk ? "available" : "AMA schema tables not found" };
    if (!schemaOk) blockers.push("SCHEMA_NOT_AVAILABLE");
  } catch {
    checks.schema = { ok: false, detail: "could not query schema availability" };
    blockers.push("SCHEMA_UNAVAILABLE");
  }

  // ── 4 & 5. Market freshness + valid price (single fetch, shared) ──
  try {
    const { getRealMarketView } = await import("./amaMarketRuntimeService");
    const mv = await getRealMarketView();
    const marketOk = mv.dataQuality !== "UNAVAILABLE";
    const STALE_MS = 5 * 60 * 1000;
    const fresh = mv.analysisTimestamp !== null
      ? Date.now() - new Date(mv.analysisTimestamp).getTime() < STALE_MS
      : false;
    checks.marketFresh = {
      ok: marketOk && fresh,
      detail: !marketOk
        ? "market data unavailable from gateway"
        : !fresh
          ? `stale: last=${mv.analysisTimestamp}`
          : `quality=${mv.dataQuality}, ts=${mv.analysisTimestamp}`,
    };
    if (!marketOk || !fresh) blockers.push("MARKET_STALE");

    const priceOk = mv.analysisPrice !== null && mv.analysisPrice > 0;
    checks.validPrice = {
      ok: priceOk,
      detail: priceOk ? `price=${mv.analysisPrice}` : "no valid analysis price",
    };
    if (!priceOk) blockers.push("NO_VALID_PRICE");
  } catch {
    checks.marketFresh = { ok: false, detail: "market data fetch failed" };
    checks.validPrice = { ok: false, detail: "market data fetch failed" };
    blockers.push("MARKET_STALE");
    blockers.push("NO_VALID_PRICE");
  }

  // ── 6. HWM bootstrap completed ───────────────────────────────────
  try {
    const hwm = await amaHwmBootstrapService.getState();
    const hwmOk = hwm.bootstrapStatus === "COMPLETED" && hwm.hwm !== null;
    checks.hwm = {
      ok: hwmOk,
      detail: hwmOk
        ? `hwm=${hwm.hwm}, coverage=${hwm.dataCoveragePct}%`
        : `bootstrapStatus=${hwm.bootstrapStatus}, hwm=${hwm.hwm}`,
    };
    if (!hwmOk) blockers.push("NO_HIGH_WATER_MARK");
  } catch {
    checks.hwm = { ok: false, detail: "could not read HWM state" };
    blockers.push("HWM_UNAVAILABLE");
  }

  // ── 7. Mandate active ─────────────────────────────────────────────
  try {
    const mandate = await runtime.getMandate();
    const mandateOk = mandate !== null && mandate.status === "ACTIVE";
    checks.mandateActive = {
      ok: mandateOk,
      detail: mandate === null
        ? "no mandate found"
        : `status=${mandate.status}, id=${mandate.mandateId}`,
    };
    if (!mandateOk) blockers.push("NO_ACTIVE_MANDATE");
  } catch {
    checks.mandateActive = { ok: false, detail: "could not read mandate" };
    blockers.push("MANDATE_UNAVAILABLE");
  }

  // ── 8. Policy active ──────────────────────────────────────────────
  try {
    const policy = await getActivePolicy();
    const policyOk = policy !== null;
    checks.policyActive = {
      ok: policyOk,
      detail: policyOk ? `policyId=${policy!.policyId}` : "no active policy",
    };
    if (!policyOk) blockers.push("NO_ACTIVE_POLICY");
  } catch {
    checks.policyActive = { ok: false, detail: "could not read active policy" };
    blockers.push("POLICY_UNAVAILABLE");
  }

  // ── 9 & 10. Portfolio budget + free capital ───────────────────────
  try {
    const { pool } = await import("../../db");
    const budgetRes = await pool.query(
      `SELECT budgeted_usd, deployed_usd, reserved_usd
       FROM portfolio_mode_budgets
       WHERE mode = 'AMA' AND asset = 'BTC' AND status = 'ACTIVE'
       LIMIT 1`,
    );
    if (budgetRes.rows.length === 0) {
      checks.portfolioBudget = { ok: false, detail: "no AMA/BTC budget row found" };
      checks.freeCapital = { ok: false, detail: "no AMA/BTC budget row found" };
      blockers.push("NO_BUDGET_ALLOCATED");
      blockers.push("NO_FREE_CAPITAL");
    } else {
      const r = budgetRes.rows[0];
      const budgeted = Number(r.budgeted_usd);
      const deployed = Number(r.deployed_usd);
      const reserved = Number(r.reserved_usd);
      const free = budgeted - deployed - reserved;
      const budgetOk = budgeted > 0;
      const freeOk = free > 0;
      checks.portfolioBudget = {
        ok: budgetOk,
        detail: `budgeted=${budgeted}`,
      };
      checks.freeCapital = {
        ok: freeOk,
        detail: `free=${free} (budgeted=${budgeted}, deployed=${deployed}, reserved=${reserved})`,
      };
      if (!budgetOk) blockers.push("NO_BUDGET_ALLOCATED");
      if (!freeOk) blockers.push("NO_FREE_CAPITAL");
    }
  } catch {
    checks.portfolioBudget = { ok: false, detail: "could not query portfolio budget" };
    checks.freeCapital = { ok: false, detail: "could not query portfolio budget" };
    blockers.push("BUDGET_UNAVAILABLE");
    blockers.push("FREE_CAPITAL_UNAVAILABLE");
  }

  // ── 11. Reconciliation — FAIL-CLOSED ────────────────────────────
  try {
    const unresolved = await getUnresolvedReconciliations();
    const reconcOk = unresolved.length === 0;
    checks.reconciliation = {
      ok: reconcOk,
      detail: reconcOk ? "none pending" : `${unresolved.length} unresolved reconciliations`,
    };
    if (!reconcOk) blockers.push("UNRESOLVED_RECONCILIATION");
  } catch {
    // FAIL-CLOSED: never authorize REAL if reconciliation cannot be verified
    checks.reconciliation = { ok: false, detail: "reconciliation query failed — cannot verify" };
    blockers.push("RECONCILIATION_UNAVAILABLE");
  }

  // ── 12. Gateway available ─────────────────────────────────────────
  try {
    const { MarketDataService } = await import("../MarketDataService");
    const ticker = await MarketDataService.getTicker(AMA_PAIR);
    const gwOk = ticker !== null && Number.isFinite(ticker.bid) && Number.isFinite(ticker.ask)
      && ticker.bid! > 0 && ticker.ask! > 0;
    checks.gatewayAvailable = {
      ok: gwOk,
      detail: gwOk
        ? `bid=${ticker.bid}, ask=${ticker.ask}`
        : "gateway returned invalid or missing bid/ask",
    };
    if (!gwOk) blockers.push("GATEWAY_UNAVAILABLE");
  } catch {
    checks.gatewayAvailable = { ok: false, detail: "gateway unreachable" };
    blockers.push("GATEWAY_UNAVAILABLE");
  }

  // ── 13. Maker-only enforcement (asset profile invariant) ──────────
  const makerOnlyOk = BTC_ASSET_PROFILE.makerOnly;
  checks.makerOnly = {
    ok: makerOnlyOk,
    detail: makerOnlyOk
      ? "enforced via pre-trade gate (Gate 8)"
      : "asset profile does not enforce maker-only",
  };
  if (!makerOnlyOk) blockers.push("MAKER_ONLY_NOT_ENFORCED");

  // ── 14. Post-only enforcement (asset profile invariant) ───────────
  const postOnlyOk = BTC_ASSET_PROFILE.postOnly;
  checks.postOnly = {
    ok: postOnlyOk,
    detail: postOnlyOk
      ? "enforced via pre-trade gate (Gate 9)"
      : "asset profile does not enforce post-only",
  };
  if (!postOnlyOk) blockers.push("POST_ONLY_NOT_ENFORCED");

  // ── 15. Scheduler operational ─────────────────────────────────────
  try {
    const sched = await amaSchedulerStateService.getState();
    const SCHED_STALE_MS = 10 * 60 * 1000;
    const schedFresh = sched.lastTickAt !== null
      ? Date.now() - new Date(sched.lastTickAt).getTime() < SCHED_STALE_MS
      : true; // never ticked yet — acceptable pre-launch
    const schedOk = schedFresh && sched.currentMode !== "KILL_SWITCHED";
    checks.schedulerOperational = {
      ok: schedOk,
      detail: `mode=${sched.currentMode}, lastTickAt=${sched.lastTickAt}, errorCount=${sched.errorCount}`,
    };
    if (!schedOk) blockers.push("SCHEDULER_STALE");
  } catch {
    checks.schedulerOperational = { ok: false, detail: "could not read scheduler state" };
    blockers.push("SCHEDULER_UNAVAILABLE");
  }

  // ── 16. Real state compatibility ──────────────────────────────────
  try {
    const realState = await amaRealStateService.getState();
    const incompatible = ["KILL_SWITCHED", "AUTO_BLOCKED", "ACTIVE", "ARMED"];
    const compatible = !incompatible.includes(realState.operationalState);
    checks.realStateCompatible = {
      ok: compatible,
      detail: compatible
        ? `state=${realState.operationalState}`
        : `incompatible state: ${realState.operationalState}`,
    };
    if (!compatible) blockers.push("REAL_STATE_INCOMPATIBLE");
  } catch {
    checks.realStateCompatible = { ok: false, detail: "could not read real operational state" };
    blockers.push("REAL_STATE_UNREADABLE");
  }

  // ── 17. REAL_FULL permanently locked ─────────────────────────────
  try {
    const mode = runtime.getMode();
    const modeOk = mode !== "REAL_FULL";
    checks.realFullLocked = { ok: modeOk, detail: `currentMode=${mode}` };
    if (!modeOk) blockers.push("REAL_FULL_BLOCKED");
  } catch {
    checks.realFullLocked = { ok: false, detail: "could not read current mode" };
    blockers.push("MODE_UNREADABLE");
  }

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}

// ─── REAL_LIMITED Activation Flow ────────────────────────────────────

export interface ActivateRealInput {
  authorizedBy: string;
  maxCapitalUsd: number;
  maxSingleTrancheUsd: number;
  maxTranchesPerCycle: number;
  confirm: boolean;
  expiresAt?: string;
  reason?: string;
}

export async function activateReal(input: ActivateRealInput): Promise<{ activated: boolean; mode: string; operationalState: string }> {
  // Gate A: Explicit confirmation — no mutations without it
  if (!input.confirm) {
    throw new Error("[AMA] Activation requires explicit user confirmation");
  }

  // Gate B: Staging / environment block — no mutations if flag is off
  if (process.env.AMA_REAL_EXECUTION_ENABLED !== "true") {
    throw new Error("[AMA] Operación real deshabilitada en este entorno.");
  }

  // Gate C: Full readiness evaluation — no mutations if any check fails
  const readiness = await evaluateRealActivationReadiness();
  if (!readiness.ready) {
    await insertAuditEvent("REAL_ACTIVATION_BLOCKED", "WARN", {
      blockers: readiness.blockers,
      checks: readiness.checks,
      authorizedBy: input.authorizedBy,
    }).catch(() => undefined);
    throw new Error(`[AMA] Activation blocked: ${readiness.blockers.join(", ")}`);
  }

  // Gate D: Full state snapshot for exact rollback
  let authSnapshot: RealAuthorizationRow | null = null;
  let previousMode: string = "OFF";
  let previousRealState: string = "NOT_READY";

  try {
    const [auth, realState] = await Promise.all([
      getRealAuthorization().catch(() => null),
      amaRealStateService.getState().catch(() => null),
    ]);
    authSnapshot = auth;
    previousMode = runtime.getMode();
    previousRealState = realState?.operationalState ?? "NOT_READY";
  } catch {
    // Snapshot read failed — proceed but rollback will be best-effort
  }

  let authGranted = false;
  let modeChanged = false;
  let stateTransitioned = false;

  try {
    // Step E: Grant authorization (first mutation — all others depend on this)
    await grantRealLimitedAuthorization(
      input.authorizedBy,
      input.maxCapitalUsd,
      input.maxSingleTrancheUsd,
      input.maxTranchesPerCycle,
      input.expiresAt,
      input.reason,
    );
    authGranted = true;

    // Step F: Set mode to REAL_LIMITED (setMode validates auth internally)
    if (previousMode !== "REAL_LIMITED") {
      await runtime.setMode("REAL_LIMITED", input.authorizedBy, input.reason || "Manual activation");
      modeChanged = true;
    }

    // Step G: Transition real operational state to ARMED
    await amaRealStateService.transition("ARMED", input.reason || "Manual activation", input.authorizedBy);
    stateTransitioned = true;

    // Step H: Audit success — non-fatal if this fails (everything else succeeded)
    await insertAuditEvent(
      "REAL_LIMITED_ACTIVATED",
      "WARN",
      {
        authorizedBy: input.authorizedBy,
        maxCapitalUsd: input.maxCapitalUsd,
        maxSingleTrancheUsd: input.maxSingleTrancheUsd,
        maxTranchesPerCycle: input.maxTranchesPerCycle,
        reason: input.reason,
      },
    ).catch(() => undefined);

    const state = await amaRealStateService.getState();
    return { activated: true, mode: "REAL_LIMITED", operationalState: state.operationalState };
  } catch (err) {
    // Rollback: compensating actions in strict reverse order (G → F → E)
    const rollbackErrors: string[] = [];

    if (stateTransitioned) {
      try {
        await amaRealStateService.transition(
          previousRealState as Parameters<typeof amaRealStateService.transition>[0],
          "REAL_ACTIVATION_FAILED rollback",
          "SYSTEM",
        );
      } catch (re) {
        rollbackErrors.push(`state rollback: ${(re as Error).message}`);
      }
    }

    if (modeChanged) {
      try {
        await runtime.setMode(previousMode as Parameters<typeof runtime.setMode>[0], "SYSTEM", "REAL_ACTIVATION_FAILED rollback");
      } catch (re) {
        rollbackErrors.push(`mode rollback: ${(re as Error).message}`);
      }
    }

    if (authGranted) {
      try {
        if (authSnapshot !== null && authSnapshot.isActive) {
          // Restore exact previous authorization
          await restoreRealAuthorizationSnapshot(authSnapshot);
        } else {
          // No previous active auth — revoke the newly granted one
          await revokeRealAuthorization("SYSTEM", "REAL_ACTIVATION_FAILED rollback");
        }
      } catch (re) {
        rollbackErrors.push(`auth rollback: ${(re as Error).message}`);
      }
    }

    await insertAuditEvent("REAL_ACTIVATION_FAILED", "ERROR", {
      authorizedBy: input.authorizedBy,
      error: (err as Error).message,
      rollbackErrors,
      authGranted,
      modeChanged,
      stateTransitioned,
      hadPreviousAuth: authSnapshot?.isActive ?? false,
    }).catch(() => undefined);

    throw err;
  }
}

// ─── Pre-Trade Gates ─────────────────────────────────────────────────

export interface PreTradeGateContext {
  cycleId: string;
  trancheId: string;
  trancheAmountUsd: number;
  cycleDeployedUsd: number;
  cycleBudgetUsd: number;
  cycleTrancheCount: number;
  killSwitchActive: boolean;
  currentPrice: number | null;
  orderType: "maker" | "taker";
  isPostOnly: boolean;
}

export interface PreTradeGateResult {
  passed: boolean;
  gates: PreTradeGateRow[];
  blockers: string[];
}

export async function runPreTradeGates(
  ctx: PreTradeGateContext,
): Promise<PreTradeGateResult> {
  const gates: PreTradeGateRow[] = [];
  const blockers: string[] = [];
  const now = new Date().toISOString();

  // Gate 1: Kill switch
  const killSwitchPassed = !ctx.killSwitchActive;
  const gate1Id = `gate-${createHash("sha256").update(`kill-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate1: PreTradeGateRow = {
    gateId: gate1Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "KILL_SWITCH",
    passed: killSwitchPassed,
    reason: killSwitchPassed ? null : "Kill switch is active",
    details: { killSwitchActive: ctx.killSwitchActive },
    evaluatedAt: now,
  };
  gates.push(gate1);
  await insertPreTradeGate(gate1);
  if (!killSwitchPassed) blockers.push("KILL_SWITCH_ACTIVE");

  // Gate 2: Authorization
  const authorized = await isRealLimitedAuthorized();
  const gate2Id = `gate-${createHash("sha256").update(`auth-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate2: PreTradeGateRow = {
    gateId: gate2Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "AUTHORIZATION",
    passed: authorized,
    reason: authorized ? null : "REAL_LIMITED authorization not active or expired",
    details: { authorized },
    evaluatedAt: now,
  };
  gates.push(gate2);
  await insertPreTradeGate(gate2);
  if (!authorized) blockers.push("NOT_AUTHORIZED");

  // Gate 3: Single tranche limit
  const auth = await getRealAuthorization();
  const trancheLimitPassed = ctx.trancheAmountUsd <= auth.maxSingleTrancheUsd;
  const gate3Id = `gate-${createHash("sha256").update(`tranche-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate3: PreTradeGateRow = {
    gateId: gate3Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "SINGLE_TRANCHE_LIMIT",
    passed: trancheLimitPassed,
    reason: trancheLimitPassed ? null : `Tranche ${ctx.trancheAmountUsd} exceeds max ${auth.maxSingleTrancheUsd}`,
    details: {
      trancheAmountUsd: ctx.trancheAmountUsd,
      maxSingleTrancheUsd: auth.maxSingleTrancheUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate3);
  await insertPreTradeGate(gate3);
  if (!trancheLimitPassed) blockers.push("SINGLE_TRANCHE_LIMIT_EXCEEDED");

  // Gate 4: Total capital limit
  const totalAfter = ctx.cycleDeployedUsd + ctx.trancheAmountUsd;
  const capitalLimitPassed = totalAfter <= auth.maxCapitalUsd;
  const gate4Id = `gate-${createHash("sha256").update(`capital-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate4: PreTradeGateRow = {
    gateId: gate4Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "CAPITAL_LIMIT",
    passed: capitalLimitPassed,
    reason: capitalLimitPassed ? null : `Total ${totalAfter} would exceed max ${auth.maxCapitalUsd}`,
    details: {
      cycleDeployedUsd: ctx.cycleDeployedUsd,
      trancheAmountUsd: ctx.trancheAmountUsd,
      totalAfter,
      maxCapitalUsd: auth.maxCapitalUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate4);
  await insertPreTradeGate(gate4);
  if (!capitalLimitPassed) blockers.push("CAPITAL_LIMIT_EXCEEDED");

  // Gate 5: Tranche count limit
  const trancheCountPassed = ctx.cycleTrancheCount < auth.maxTranchesPerCycle;
  const gate5Id = `gate-${createHash("sha256").update(`count-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate5: PreTradeGateRow = {
    gateId: gate5Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "TRANCHE_COUNT_LIMIT",
    passed: trancheCountPassed,
    reason: trancheCountPassed ? null : `Tranche count ${ctx.cycleTrancheCount} would exceed max ${auth.maxTranchesPerCycle}`,
    details: {
      cycleTrancheCount: ctx.cycleTrancheCount,
      maxTranchesPerCycle: auth.maxTranchesPerCycle,
    },
    evaluatedAt: now,
  };
  gates.push(gate5);
  await insertPreTradeGate(gate5);
  if (!trancheCountPassed) blockers.push("TRANCHE_COUNT_LIMIT_EXCEEDED");

  // Gate 6: Price availability
  const pricePassed = ctx.currentPrice !== null && ctx.currentPrice > 0;
  const gate6Id = `gate-${createHash("sha256").update(`price-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate6: PreTradeGateRow = {
    gateId: gate6Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "PRICE_AVAILABLE",
    passed: pricePassed,
    reason: pricePassed ? null : "No valid current price",
    details: { currentPrice: ctx.currentPrice },
    evaluatedAt: now,
  };
  gates.push(gate6);
  await insertPreTradeGate(gate6);
  if (!pricePassed) blockers.push("NO_VALID_PRICE");

  // Gate 7: Budget consistency
  const budgetPassed = totalAfter <= ctx.cycleBudgetUsd;
  const gate7Id = `gate-${createHash("sha256").update(`budget-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate7: PreTradeGateRow = {
    gateId: gate7Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "BUDGET_CONSISTENCY",
    passed: budgetPassed,
    reason: budgetPassed ? null : `Total ${totalAfter} would exceed cycle budget ${ctx.cycleBudgetUsd}`,
    details: {
      totalAfter,
      cycleBudgetUsd: ctx.cycleBudgetUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate7);
  await insertPreTradeGate(gate7);
  if (!budgetPassed) blockers.push("BUDGET_EXCEEDED");

  // Gate 8: Taker rejection — REAL_LIMITED only allows maker orders
  const takerPassed = ctx.orderType !== "taker";
  const gate8Id = `gate-${createHash("sha256").update(`taker-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate8: PreTradeGateRow = {
    gateId: gate8Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "MAKER_ONLY",
    passed: takerPassed,
    reason: takerPassed ? null : "Taker orders not allowed in REAL_LIMITED",
    details: { orderType: ctx.orderType },
    evaluatedAt: now,
  };
  gates.push(gate8);
  await insertPreTradeGate(gate8);
  if (!takerPassed) blockers.push("TAKER_NOT_ALLOWED");

  // Gate 9: Post-only requirement — all REAL_LIMITED orders must be post-only
  const postOnlyPassed = ctx.isPostOnly;
  const gate9Id = `gate-${createHash("sha256").update(`postonly-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate9: PreTradeGateRow = {
    gateId: gate9Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "POST_ONLY_REQUIRED",
    passed: postOnlyPassed,
    reason: postOnlyPassed ? null : "Post-only flag is required for REAL_LIMITED orders",
    details: { isPostOnly: ctx.isPostOnly },
    evaluatedAt: now,
  };
  gates.push(gate9);
  await insertPreTradeGate(gate9);
  if (!postOnlyPassed) blockers.push("POST_ONLY_REQUIRED");

  const passed = blockers.length === 0;

  await insertAuditEvent(
    passed ? "PRE_TRADE_GATES_PASSED" : "PRE_TRADE_GATES_FAILED",
    passed ? "INFO" : "WARN",
    { cycleId: ctx.cycleId, trancheId: ctx.trancheId, blockers },
    { cycleId: ctx.cycleId, trancheId: ctx.trancheId },
  );

  return { passed, gates, blockers };
}

export async function getGateHistory(cycleId: string): Promise<PreTradeGateRow[]> {
  return await getPreTradeGatesByCycle(cycleId);
}

// ─── Reconciliation ──────────────────────────────────────────────────

export interface ReconciliationInput {
  cycleId: string;
  expectedState: Record<string, unknown>;
  actualState: Record<string, unknown>;
}

export async function runReconciliation(
  input: ReconciliationInput,
): Promise<string> {
  const reconciliationId = `recon-${createHash("sha256")
    .update(`${input.cycleId}-${Date.now()}`)
    .digest("hex")
    .slice(0, 12)}`;

  const discrepancies: unknown[] = [];

  // Compare expected vs actual for key fields
  const expectedKeys = Object.keys(input.expectedState);
  for (const key of expectedKeys) {
    const expected = input.expectedState[key];
    const actual = input.actualState[key];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      discrepancies.push({ key, expected, actual });
    }
  }

  const status = discrepancies.length === 0 ? "MATCH" : "MISMATCH";

  await insertReconciliation({
    reconciliationId,
    cycleId: input.cycleId,
    status,
    expectedState: input.expectedState,
    actualState: input.actualState,
    discrepancies,
    resolved: discrepancies.length === 0,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  });

  await insertAuditEvent(
    status === "MATCH" ? "RECONCILIATION_MATCH" : "RECONCILIATION_MISMATCH",
    status === "MATCH" ? "INFO" : "ERROR",
    { reconciliationId, cycleId: input.cycleId, discrepancyCount: discrepancies.length },
    { cycleId: input.cycleId },
  );

  return reconciliationId;
}

export async function resolveReconciliationIssue(
  reconciliationId: string,
  resolvedBy: string,
): Promise<void> {
  await resolveReconciliation(reconciliationId, resolvedBy);
  await insertAuditEvent("RECONCILIATION_RESOLVED", "INFO", {
    reconciliationId,
    resolvedBy,
  });
}

export async function getPendingReconciliations() {
  return await getUnresolvedReconciliations();
}

// ─── Operational Controls ────────────────────────────────────────────

export async function pauseOperations(reason: string): Promise<void> {
  await insertAuditEvent("REAL_PAUSED_BY_USER", "WARN", { reason });
}

export async function resumeOperations(): Promise<void> {
  await insertAuditEvent("REAL_RESUMED_BY_USER", "INFO", {});
}

export async function deactivate(reason: string): Promise<void> {
  await revokeRealAuthorization("UI", reason);
  await insertAuditEvent("REAL_DEACTIVATED_BY_USER", "WARN", { reason });
}

export async function emergencyStop(active: boolean, reason: string): Promise<void> {
  if (active) {
    await revokeRealAuthorization("EMERGENCY_STOP", reason);
  }
  await insertAuditEvent("REAL_KILL_SWITCH", "ERROR", { active, reason });
}
