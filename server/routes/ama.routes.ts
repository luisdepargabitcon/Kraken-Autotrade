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
import { checkAmaSchemaAvailable } from "../services/ama/amaRepository";
import * as labService from "../services/ama/amaLabService";
import * as replayService from "../services/ama/amaReplayService";
import * as shadowExecutor from "../services/ama/amaShadowExecutor";
import * as realLimited from "../services/ama/amaRealLimitedService";
import * as portfolioLedger from "../services/ama/amaPortfolioLedger";
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

    // Gate 1b: block SHADOW if readiness not met
    if (mode === "SHADOW_SCENARIO" || mode === "SHADOW_LIVE") {
      const readiness = checkShadowReadiness(
        mode,
        false, // no HWM in stub
        false, // no budget in stub
        false, // no current price in stub
        0,     // no data coverage in stub
        90,    // minimum data coverage
      );
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
  app.get("/api/ama/market-view", (_req, res) => {
    res.json(ok(runtime.getMarketView()));
  });

  // ── Mandate ─────────────────────────────────────────────────────
  app.get("/api/ama/mandate", (_req, res) => {
    res.json(ok(runtime.getMandate()));
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
      const replayRunId = await replayService.startReplayRun({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        pair: parsed.data.pair,
        initialCapitalUsd: parsed.data.initialCapitalUsd,
      });
      res.json(ok({
        replayRunId,
        status: "QUEUED",
        message: "Replay queued. No real orders will be placed.",
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
      const labSessionId = await labService.startLabSession(parsed.data);
      res.json(ok({ labSessionId, status: "RUNNING" }));
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
