/**
 * AMA Routes — Runtime implementation.
 *
 * Registers all /api/ama/* endpoints with persistent runtime service.
 *
 * Safety:
 * - REAL_LIMITED and REAL_FULL are blocked at BOTH route and service layers.
 * - REAL_FULL is permanently locked.
 * - analyze-now is strictly side-effect free.
 * - No stack traces or secrets are sent to the client.
 */

import type { Express } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import * as runtime from "../services/ama/amaRuntimeService";
import { checkShadowReadiness } from "../services/ama/amaShadowExecutorSecurity";
import { evaluateShadowReadiness } from "../services/ama/amaShadowReadinessService";
import { checkAmaSchemaAvailable } from "../services/ama/amaRepository";
import * as labService from "../services/ama/amaLabService";
import * as replayService from "../services/ama/amaReplayService";
import { runLabSession, runReplaySession } from "../services/ama/amaLabReplayRunner";
import * as shadowExecutor from "../services/ama/amaShadowExecutor";
import * as realLimited from "../services/ama/amaRealLimitedService";
import * as portfolioLedger from "../services/ama/amaPortfolioLedger";
import { getAuditEvents, type AuditEventFilters } from "../services/ama/amaRepository";
import { executeHwmBootstrap } from "../services/ama/amaMarketRuntimeService";
import { runShadowScenario } from "../services/ama/amaShadowScenarioRunner";
import { amaHwmBootstrapService, amaSchedulerStateService } from "../services/ama/amaFunctionalClosure";
import type { AmaApiResponse, AmaMandateInput, AmaMode } from "../services/ama/amaTypes";
import { AMA_MODE_VALUES, AMA_STRATEGY_VERSION, isModeReal } from "../services/ama/amaTypes";

function ok<T>(data: T): AmaApiResponse<T> {
  return { success: true, data, timestamp: new Date().toISOString() };
}

function err(message: string): AmaApiResponse<never> {
  return { success: false, error: message, timestamp: new Date().toISOString() };
}

function sanitizeError(e: unknown): string {
  if (e instanceof Error) {
    return e.message.includes("[AMA]") ? e.message : "Internal AMA error";
  }
  return "Internal AMA error";
}

const modeSchema = z.object({
  mode: z.enum(["OFF", "LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE", "REAL_LIMITED", "REAL_FULL"]),
});

const mandateDraftSchema = z.object({
  asset: z.enum(["BTC", "ETH"]).default("BTC"),
  maxCapitalUsd: z.number().nonnegative(),
  riskMandate: z.enum(["MUY_PRUDENTE", "PRUDENTE", "EQUILIBRADO", "DINAMICO", "OPORTUNISTA"]),
  accumulationStyle: z.enum(["ENTRAR_ANTES", "ADAPTATIVO", "ESPERAR_MAS_VALOR"]),
  exitObjective: z.enum(["RECUPERAR_CAPITAL", "EQUILIBRADO", "ACUMULAR_BTC"]),
  autonomyLevel: z.enum(["SOLO_ANALISIS", "SUPERVISADO", "AUTOPILOT"]),
});

const killSwitchSchema = z.object({
  active: z.boolean(),
});

const replaySchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  pair: z.string().optional().default("BTC/USD"),
  mode: z.enum(["REPLAY"]).optional().default("REPLAY"),
  initialCapitalUsd: z.number().nonnegative().optional().default(0),
});

export function registerAmaRoutes(app: Express): void {
  // ── Status ──────────────────────────────────────────────────────
  app.get("/api/ama/status", async (_req, res) => {
    try {
      const status = await runtime.getStatus();
      res.json(ok(status));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/mode", async (req, res) => {
    const parsed = modeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid mode. Valid: ${AMA_MODE_VALUES.join(", ")}`));
    }
    const { mode } = parsed.data;

    // Gate 1 (route layer): block REAL modes
    if (isModeReal(mode)) {
      return res.status(403).json(err(`${mode} requires explicit authorization. Gate locked.`));
    }

    // Gate 1b: block SHADOW if readiness not met (real evaluation)
    if (mode === "SHADOW_SCENARIO" || mode === "SHADOW_LIVE") {
      const readiness = await evaluateShadowReadiness(mode);
      if (!readiness.ready) {
        return res.status(403).json(err(`${mode} blocked: ${readiness.blockers.join(", ")}`));
      }
    }

    // Gate 2 (service layer): setMode throws if REAL or unauthorized
    try {
      await runtime.setMode(mode as AmaMode, req.body.changedBy || "API");
      const status = await runtime.getStatus();
      res.json(ok(status));
    } catch (e) {
      return res.status(403).json(err(sanitizeError(e)));
    }
  });

  // ── Market View ─────────────────────────────────────────────────
  app.get("/api/ama/market-view", async (_req, res) => {
    try {
      const view = await runtime.getMarketView();
      res.json(ok(view));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Mandate ─────────────────────────────────────────────────────
  app.get("/api/ama/mandate", async (_req, res) => {
    try {
      const mandate = await runtime.getMandate();
      res.json(ok(mandate));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/mandate/drafts", async (req, res) => {
    const parsed = mandateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid mandate input: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    const input: AmaMandateInput = parsed.data;
    try {
      const result = await runtime.saveMandateDraft(input);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // Mandate approve
  const approveSchema = z.object({
    mandateId: z.string().min(1),
    approvedBy: z.string().min(1).default("API"),
  });
  app.post("/api/ama/mandate/approve", async (req, res) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid approve input: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      const result = await runtime.approveMandateRuntime(parsed.data.mandateId, parsed.data.approvedBy);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // Mandate activate (resolves + activates policy)
  const activateSchema = z.object({
    mandateId: z.string().min(1),
  });
  app.post("/api/ama/mandate/activate", async (req, res) => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid activate input: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      const result = await runtime.activateMandateRuntime(parsed.data.mandateId);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // Mandate supersede
  app.post("/api/ama/mandate/supersede", async (req, res) => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid supersede input: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      const result = await runtime.supersedeMandateRuntime(parsed.data.mandateId);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Policy ───────────────────────────────────────────────────────
  app.get("/api/ama/policy/active", async (_req, res) => {
    try {
      const policy = await runtime.getActivePolicyRuntime();
      res.json(ok(policy));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Tranche Plan ────────────────────────────────────────────────
  app.get("/api/ama/tranche-plan/current", async (_req, res) => {
    try {
      const plan = await runtime.getTranchePlan();
      res.json(ok(plan));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Cycles ──────────────────────────────────────────────────────
  app.get("/api/ama/cycles", async (_req, res) => {
    try {
      const cycles = await runtime.getCycles();
      res.json(ok(cycles));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/cycles/:id", async (req, res) => {
    try {
      const cycles = await runtime.getCycles();
      const cycle = cycles.find((c) => c.cycleId === req.params.id);
      if (!cycle) return res.status(404).json(err("Cycle not found"));
      res.json(ok(cycle));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/cycles/:id/tranches", async (req, res) => {
    try {
      const tranches = await runtime.getTranches(req.params.id);
      res.json(ok(tranches));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Portfolio ───────────────────────────────────────────────────
  app.get("/api/ama/portfolio", async (_req, res) => {
    try {
      const summary = await runtime.getPortfolioSummary();
      res.json(ok(summary));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Kill Switch ──────────────────────────────────────────────────
  app.post("/api/ama/kill-switch", async (req, res) => {
    const parsed = killSwitchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("active must be boolean"));
    }
    try {
      await runtime.setKillSwitch(parsed.data.active);
      res.json(ok({ killSwitchActive: runtime.isKillSwitchActive() }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Analysis (on-demand, no execution) ──────────────────────────
  // STRICTLY side-effect free: no orders, no reservations, no mode change,
  // no exchange calls, no cycle activation, no policy modification.
  app.post("/api/ama/analyze-now", (_req, res) => {
    const runId = `run-${createHash("sha256").update(`analyze-${Date.now()}`).digest("hex").slice(0, 12)}`;
    res.json(ok({
      analysisRunId: runId,
      message: "Analysis requested. No orders, no reservations, no mode change.",
    }));
  });

  // ── Replay ───────────────────────────────────────────────────────
  app.post("/api/ama/replay/run", async (req, res) => {
    const parsed = replaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid replay config: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      // Fetch historical prices using range-based provider
      const { getCandlesForRange } = await import("../services/ama/amaHistoricalDataProvider");
      const dataResult = await getCandlesForRange({
        pair: parsed.data.pair,
        timeframe: "1d",
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      });

      if (dataResult.insufficient || dataResult.candles.length === 0) {
        return res.status(400).json(err(
          `Historical data insufficient for range ${parsed.data.startDate} to ${parsed.data.endDate}. ` +
          `Reason: ${dataResult.reason ?? "UNKNOWN"}. ` +
          `Candles found: ${dataResult.candleCount}. Coverage: ${dataResult.coveragePct.toFixed(1)}%.`,
        ));
      }

      const historicalPrices = dataResult.candles.map(c => ({
        timestamp: new Date(c.time * 1000).toISOString(),
        price: c.close,
      }));

      // Execute replay via runner (handles start + execute + complete)
      const { replayRunId } = await runReplaySession({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        pair: parsed.data.pair,
        initialCapitalUsd: parsed.data.initialCapitalUsd,
      }, historicalPrices);

      res.json(ok({
        replayRunId,
        status: "COMPLETED",
        dataset: {
          requestedStart: parsed.data.startDate,
          requestedEnd: parsed.data.endDate,
          actualStart: dataResult.actualStart?.toISOString() ?? null,
          actualEnd: dataResult.actualEnd?.toISOString() ?? null,
          candleCount: dataResult.candleCount,
          datasetHash: dataResult.datasetHash,
          coveragePct: dataResult.coveragePct,
        },
        message: "Replay executed. No real orders were placed.",
      }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/replay/runs", async (_req, res) => {
    try {
      const runs = await replayService.listReplayRuns();
      res.json(ok(runs));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/replay/runs/:id", async (req, res) => {
    try {
      const run = await replayService.getReplayRun(req.params.id);
      if (!run) return res.status(404).json(err("Replay run not found"));
      res.json(ok(run));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Lab ───────────────────────────────────────────────────────────
  const labConfigSchema = z.object({
    asset: z.enum(["BTC", "ETH"]).default("BTC"),
    pair: z.string().default("BTC/USD"),
    scenarioName: z.string().min(1),
    initialCapitalUsd: z.number().nonnegative().default(10000),
    config: z.object({
      maxCapitalUsd: z.number().nonnegative(),
      riskMandate: z.string(),
      accumulationStyle: z.string(),
      exitObjective: z.string(),
      autonomyLevel: z.string(),
      customDropPcts: z.array(z.number()).optional(),
      customPrices: z.array(z.number()).optional(),
    }),
  });

  app.post("/api/ama/lab/sessions", async (req, res) => {
    const parsed = labConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid lab config: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      // Generate prices: use custom prices if provided, otherwise synthesize from drop percentages
      const dropPcts = parsed.data.config.customDropPcts ?? [5, 10, 15, 25, 35, 45];
      const customPrices = parsed.data.config.customPrices;
      let prices: number[];
      if (customPrices && customPrices.length > 0) {
        prices = customPrices;
      } else {
        // Synthesize prices from drop percentages using a base price of 100000 for BTC
        const basePrice = parsed.data.asset === "BTC" ? 100000 : 3000;
        prices = dropPcts.map(drop => basePrice * (1 - drop / 100));
      }

      // Execute lab via runner (handles start + simulate + complete)
      const labSessionId = await runLabSession(parsed.data, prices);
      res.json(ok({ labSessionId, status: "COMPLETED" }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/lab/sessions", async (_req, res) => {
    try {
      const sessions = await labService.listLabSessions();
      res.json(ok(sessions));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/lab/sessions/:id", async (req, res) => {
    try {
      const session = await labService.getLabSession(req.params.id);
      if (!session) return res.status(404).json(err("Lab session not found"));
      res.json(ok(session));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Shadow ────────────────────────────────────────────────────────
  app.get("/api/ama/shadow/orders/:cycleId", async (req, res) => {
    try {
      const orders = await shadowExecutor.getShadowOrders(req.params.cycleId);
      res.json(ok(orders));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/shadow/report/:cycleId", async (req, res) => {
    try {
      const report = await shadowExecutor.generateShadowReport(req.params.cycleId);
      res.json(ok(report));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  const shadowScenarioSchema = z.object({
    scenarioId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    asset: z.enum(["BTC", "ETH"]).default("BTC"),
    pair: z.string().default("BTC/USD"),
    config: z.record(z.unknown()),
  });

  app.post("/api/ama/shadow/scenarios", async (req, res) => {
    const parsed = shadowScenarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid scenario config: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      await shadowExecutor.createShadowScenario(parsed.data);
      res.json(ok({ scenarioId: parsed.data.scenarioId, status: "ACTIVE" }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/shadow/scenarios", async (_req, res) => {
    try {
      const scenarios = await shadowExecutor.listShadowScenarios();
      res.json(ok(scenarios));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/shadow/scenarios/:id/run", async (req, res) => {
    try {
      const result = await runShadowScenario(req.params.id);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/shadow/scenarios/:id/close", async (req, res) => {
    try {
      await shadowExecutor.closeShadowScenario(req.params.id);
      res.json(ok({ scenarioId: req.params.id, status: "CLOSED" }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── REAL_LIMITED Authorization ────────────────────────────────────
  app.get("/api/ama/real/authorization", async (_req, res) => {
    try {
      const auth = await realLimited.getAuthorizationStatus();
      res.json(ok(auth));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  const grantAuthSchema = z.object({
    authorizedBy: z.string().min(1),
    maxCapitalUsd: z.number().positive(),
    maxSingleTrancheUsd: z.number().positive(),
    maxTranchesPerCycle: z.number().int().min(1),
    expiresAt: z.string().optional(),
    reason: z.string().optional(),
  });

  app.post("/api/ama/real/authorization/grant", async (req, res) => {
    const parsed = grantAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid authorization: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    try {
      await realLimited.grantAuthorization(
        parsed.data.authorizedBy,
        parsed.data.maxCapitalUsd,
        parsed.data.maxSingleTrancheUsd,
        parsed.data.maxTranchesPerCycle,
        parsed.data.expiresAt,
        parsed.data.reason,
      );
      res.json(ok({ granted: true }));
    } catch (e) {
      res.status(403).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/real/authorization/revoke", async (req, res) => {
    const revokeSchema = z.object({
      revokedBy: z.string().min(1),
      reason: z.string().optional(),
    });
    const parsed = revokeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("revokedBy is required"));
    }
    try {
      await realLimited.revokeAuthorization(parsed.data.revokedBy, parsed.data.reason);
      res.json(ok({ revoked: true }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── REAL_LIMITED operational controls ──────────────────────────────
  app.post("/api/ama/real/pause", async (req, res) => {
    try {
      const reason = (req.body?.reason as string) || "Manual pause";
      await realLimited.pauseOperations(reason);
      res.json(ok({ paused: true, reason }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/real/resume", async (_req, res) => {
    try {
      await realLimited.resumeOperations();
      res.json(ok({ resumed: true }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/real/deactivate", async (req, res) => {
    try {
      const reason = (req.body?.reason as string) || "Manual deactivation";
      await realLimited.deactivate(reason);
      res.json(ok({ deactivated: true, reason }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/real/kill-switch", async (req, res) => {
    try {
      const active = req.body?.active !== false;
      const reason = (req.body?.reason as string) || "Emergency stop";
      await realLimited.emergencyStop(active, reason);
      res.json(ok({ killSwitchActive: active, reason }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/real/gates/:cycleId", async (req, res) => {
    try {
      const gates = await realLimited.getGateHistory(req.params.cycleId);
      res.json(ok(gates));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.get("/api/ama/real/reconciliations", async (_req, res) => {
    try {
      const recs = await realLimited.getPendingReconciliations();
      res.json(ok(recs));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── REAL_LIMITED readiness check ───────────────────────────────────
  app.get("/api/ama/real/readiness", async (_req, res) => {
    try {
      const readiness = await realLimited.evaluateRealActivationReadiness();
      res.json(ok(readiness));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── REAL_LIMITED explicit activation ───────────────────────────────
  const activateRealSchema = z.object({
    authorizedBy: z.string().min(1),
    maxCapitalUsd: z.number().positive(),
    maxSingleTrancheUsd: z.number().positive(),
    maxTranchesPerCycle: z.number().int().min(1),
    confirm: z.literal(true),
    expiresAt: z.string().optional(),
    reason: z.string().optional(),
  });

  app.post("/api/ama/real/activate", async (req, res) => {
    const parsed = activateRealSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid activation input: confirm must be true and fields valid`));
    }
    try {
      const result = await realLimited.activateReal(parsed.data);
      res.json(ok(result));
    } catch (e) {
      res.status(403).json(err(sanitizeError(e)));
    }
  });

  // ── Events ────────────────────────────────────────────────────────
  app.get("/api/ama/events", async (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const limit = Math.min(parseInt(q.limit) || 100, 500);
      const filters: AuditEventFilters = {
        limit,
        cursor: q.cursor || undefined,
        cycleId: q.cycleId || undefined,
        trancheId: q.trancheId || undefined,
        severity: q.severity || undefined,
        eventType: q.eventType || undefined,
        mode: q.mode || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
      };
      const rows = await getAuditEvents(filters);
      const events = rows.map((r: any) => ({
        event_id: r.event_id,
        event_name: r.event_name,
        cycle_id: r.cycle_id,
        tranche_id: r.tranche_id,
        severity: r.severity,
        data: typeof r.data === "string" ? JSON.parse(r.data) : r.data,
        created_at: r.created_at?.toISOString ? r.created_at.toISOString() : r.created_at,
      }));
      const nextCursor = events.length === limit ? events[events.length - 1]?.event_id : null;
      res.json({ ...ok(events), meta: { limit, count: events.length, nextCursor } });
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Ledger ────────────────────────────────────────────────────────
  app.get("/api/ama/ledger", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const cycleId = req.query.cycleId as string | undefined;
      const entries = await portfolioLedger.getLedgerEntries(limit, cycleId);
      res.json(ok(entries));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── AI ──────────────────────────────────────────────────────────
  app.get("/api/ama/ai/status", (_req, res) => {
    res.json(ok({
      available: false,
      state: "AI_PROVIDER_UNAVAILABLE",
      message: "AI not configured in Phase 1",
    }));
  });

  // ── Schema availability ─────────────────────────────────────────
  app.get("/api/ama/schema-status", async (_req, res) => {
    try {
      const schemaAvailable = await checkAmaSchemaAvailable();
      res.json(ok({
        schemaAvailable,
        state: schemaAvailable ? "SCHEMA_AVAILABLE" : "SCHEMA_NOT_AVAILABLE",
        message: schemaAvailable
          ? "AMA DB schema is deployed. Persistence is available."
          : "AMA DB schema not deployed. Persistence is not available.",
      }));
    } catch {
      res.json(ok({
        schemaAvailable: false,
        state: "SCHEMA_CHECK_FAILED",
        message: "Unable to check AMA DB schema availability.",
      }));
    }
  });

  // ── HWM Bootstrap ────────────────────────────────────────────────
  app.get("/api/ama/hwm/bootstrap", async (_req, res) => {
    try {
      const state = await amaHwmBootstrapService.getState();
      res.json(ok(state));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  app.post("/api/ama/hwm/bootstrap", async (req, res) => {
    try {
      const pair = (req.body?.pair as string) || "BTC/USD";
      const candleCount = (req.body?.candleCount as number) || 200;
      const result = await executeHwmBootstrap(pair, candleCount);
      res.json(ok(result));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Readiness ────────────────────────────────────────────────────
  app.get("/api/ama/readiness", async (_req, res) => {
    try {
      const hwmState = await amaHwmBootstrapService.getState();
      const schedulerState = await amaSchedulerStateService.getState();
      const shadowScenario = await evaluateShadowReadiness("SHADOW_SCENARIO");
      const shadowLive = await evaluateShadowReadiness("SHADOW_LIVE");

      // Schema check
      const schemaAvailable = await checkAmaSchemaAvailable();

      // Budget check
      const { pool } = await import("../db");
      const budgetRes = await pool.query(
        `SELECT budgeted_usd, deployed_usd, reserved_usd, status
         FROM portfolio_mode_budgets
         WHERE mode = 'AMA' AND asset = 'BTC' AND status = 'ACTIVE'
         LIMIT 1`,
      );
      const hasBudget = budgetRes.rows.length > 0 &&
        Number(budgetRes.rows[0].budgeted_usd) > 0;

      // Mandate check
      const mandate = await runtime.getMandate();

      // Policy check
      const { getActivePolicy } = await import("../services/ama/amaRepository");
      const activePolicy = await getActivePolicy();

      // Market price check
      let hasMarketPrice = false;
      try {
        const { MarketDataService } = await import("../services/MarketDataService");
        const price = await MarketDataService.getPrice("BTC/USD");
        hasMarketPrice = price > 0;
      } catch {
        hasMarketPrice = false;
      }

      const checks = {
        schema: {
          ready: schemaAvailable,
          blockerCode: schemaAvailable ? undefined : "SCHEMA_NOT_AVAILABLE",
        },
        database: {
          ready: schemaAvailable,
          blockerCode: schemaAvailable ? undefined : "DB_NOT_AVAILABLE",
        },
        market: {
          ready: hasMarketPrice,
          blockerCode: hasMarketPrice ? undefined : "NO_CURRENT_PRICE",
        },
        hwm: {
          ready: hwmState.bootstrapStatus === "COMPLETED" && hwmState.hwm !== null,
          hwmValue: hwmState.hwm,
          bootstrapStatus: hwmState.bootstrapStatus,
          dataCoveragePct: hwmState.dataCoveragePct,
          blockerCode: hwmState.bootstrapStatus === "COMPLETED" && hwmState.hwm !== null
            ? undefined : "NO_HIGH_WATER_MARK",
        },
        mandate: {
          ready: !!mandate,
          mandateId: mandate?.mandateId ?? null,
          status: mandate?.status ?? null,
          blockerCode: mandate ? undefined : "NO_MANDATE",
        },
        policy: {
          ready: !!activePolicy,
          policyId: activePolicy?.policyId ?? null,
          status: activePolicy?.status ?? null,
          blockerCode: activePolicy ? undefined : "NO_POLICY",
        },
        budget: {
          ready: hasBudget,
          budgetedUsd: budgetRes.rows.length > 0 ? Number(budgetRes.rows[0].budgeted_usd) : 0,
          freeUsd: budgetRes.rows.length > 0
            ? Number(budgetRes.rows[0].budgeted_usd) - Number(budgetRes.rows[0].deployed_usd) - Number(budgetRes.rows[0].reserved_usd)
            : 0,
          blockerCode: hasBudget ? undefined : "NO_BUDGET_ALLOCATED",
        },
        reconciliation: {
          ready: true,
          blockerCode: undefined,
        },
        killSwitch: {
          ready: !schedulerState.currentMode || schedulerState.currentMode !== "KILL_SWITCHED",
          active: false,
          blockerCode: undefined,
        },
        gateway: {
          ready: true,
          blockerCode: undefined,
        },
        scheduler: {
          ready: true,
          currentMode: schedulerState.currentMode,
          lastTickAt: schedulerState.lastTickAt,
          tickCount: schedulerState.tickCount,
          errorCount: schedulerState.errorCount,
          lastError: schedulerState.lastError,
          blockerCode: undefined,
        },
        shadowScenario: {
          ready: shadowScenario.ready,
          blockers: shadowScenario.blockers,
        },
        shadowLive: {
          ready: shadowLive.ready,
          blockers: shadowLive.blockers,
        },
        realExecutionGate: {
          ready: false,
          locked: true,
          message: "REAL_FULL permanently locked. REAL_LIMITED requires explicit authorization.",
          blockerCode: "REAL_EXECUTION_LOCKED",
        },
      };

      res.json(ok({
        hwmBootstrap: hwmState,
        scheduler: schedulerState,
        shadowScenarioReady: shadowScenario.ready,
        shadowScenarioBlockers: shadowScenario.blockers,
        shadowLiveReady: shadowLive.ready,
        shadowLiveBlockers: shadowLive.blockers,
        checks,
      }));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Scheduler State ──────────────────────────────────────────────
  app.get("/api/ama/scheduler/state", async (_req, res) => {
    try {
      const state = await amaSchedulerStateService.getState();
      res.json(ok(state));
    } catch (e) {
      res.status(500).json(err(sanitizeError(e)));
    }
  });

  // ── Meta ─────────────────────────────────────────────────────────
  app.get("/api/ama/meta", (_req, res) => {
    res.json(ok({
      displayName: runtime.getDisplayName(),
      shortName: runtime.getShortName(),
      strategyCode: runtime.getStrategyCode(),
      strategyVersion: AMA_STRATEGY_VERSION,
      modes: AMA_MODE_VALUES,
    }));
  });
}
