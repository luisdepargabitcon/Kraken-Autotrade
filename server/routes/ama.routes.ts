/**
 * AMA Routes — Phase 1 (contracts and domain).
 *
 * Registers all /api/ama/* endpoints as stubs.
 * Real logic will be implemented in subsequent phases.
 *
 * Safety:
 * - REAL_LIMITED and REAL_FULL are blocked at BOTH route and service layers.
 * - analyze-now is strictly side-effect free.
 * - No stack traces or secrets are sent to the client.
 */

import type { Express } from "express";
import { z } from "zod";
import { amaService } from "../services/ama/amaService";
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
  mode: z.enum(["OFF", "REPLAY", "SHADOW", "REAL_LIMITED", "REAL_FULL"]),
});

const mandateDraftSchema = z.object({
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
  app.get("/api/ama/status", (_req, res) => {
    res.json(ok(amaService.getStatus()));
  });

  app.post("/api/ama/mode", (req, res) => {
    const parsed = modeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid mode. Valid: ${AMA_MODE_VALUES.join(", ")}`));
    }
    const { mode } = parsed.data;

    // Gate 1 (route layer): block REAL modes
    if (isModeReal(mode)) {
      return res.status(403).json(err(`${mode} requires explicit authorization. Gate locked.`));
    }

    // Gate 2 (service layer): setMode throws if REAL
    try {
      amaService.setMode(mode as AmaMode);
    } catch (e) {
      return res.status(403).json(err(sanitizeError(e)));
    }
    res.json(ok(amaService.getStatus()));
  });

  // ── Market View ─────────────────────────────────────────────────
  app.get("/api/ama/market-view", (_req, res) => {
    res.json(ok(amaService.getMarketView()));
  });

  // ── Mandate ─────────────────────────────────────────────────────
  app.get("/api/ama/mandate", (_req, res) => {
    const mandate = amaService.getMandate();
    res.json(ok(mandate));
  });

  app.post("/api/ama/mandate/drafts", (req, res) => {
    const parsed = mandateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid mandate input: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    const input: AmaMandateInput = parsed.data;
    const result = amaService.saveMandateDraft(input);
    res.json(ok(result));
  });

  // ── Policy ───────────────────────────────────────────────────────
  app.get("/api/ama/policy/active", (_req, res) => {
    res.json(ok(amaService.getActivePolicy()));
  });

  // ── Tranche Plan ────────────────────────────────────────────────
  app.get("/api/ama/tranche-plan/current", (_req, res) => {
    res.json(ok(amaService.getTranchePlan()));
  });

  // ── Cycles ──────────────────────────────────────────────────────
  app.get("/api/ama/cycles", (_req, res) => {
    res.json(ok(amaService.getCycles()));
  });

  app.get("/api/ama/cycles/:id", (req, res) => {
    const cycles = amaService.getCycles();
    const cycle = cycles.find((c) => c.cycleId === req.params.id);
    if (!cycle) return res.status(404).json(err("Cycle not found"));
    res.json(ok(cycle));
  });

  app.get("/api/ama/cycles/:id/tranches", (req, res) => {
    const tranches = amaService.getTranches(req.params.id);
    res.json(ok(tranches));
  });

  // ── Portfolio ───────────────────────────────────────────────────
  app.get("/api/ama/portfolio", (_req, res) => {
    res.json(ok(amaService.getPortfolioSummary()));
  });

  // ── Kill Switch ──────────────────────────────────────────────────
  app.post("/api/ama/kill-switch", (req, res) => {
    const parsed = killSwitchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("active must be boolean"));
    }
    amaService.setKillSwitch(parsed.data.active);
    res.json(ok({ killSwitchActive: amaService.isKillSwitchActive() }));
  });

  // ── Analysis (on-demand, no execution) ──────────────────────────
  // STRICTLY side-effect free: no orders, no reservations, no mode change,
  // no exchange calls, no cycle activation, no policy modification.
  app.post("/api/ama/analyze-now", (_req, res) => {
    res.json(ok({
      analysisRunId: `run-${Date.now()}`,
      message: "Analysis requested. No orders, no reservations, no mode change.",
    }));
  });

  // ── Replay ───────────────────────────────────────────────────────
  app.post("/api/ama/replay/run", (req, res) => {
    const parsed = replaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid replay config: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    res.json(ok({
      replayRunId: `replay-${Date.now()}`,
      status: "QUEUED",
      message: "Replay queued. No real orders will be placed.",
    }));
  });

  // ── AI ──────────────────────────────────────────────────────────
  app.get("/api/ama/ai/status", (_req, res) => {
    res.json(ok({
      available: false,
      state: "AI_PROVIDER_UNAVAILABLE",
      message: "AI not configured in Phase 1",
    }));
  });

  // ── Meta ─────────────────────────────────────────────────────────
  app.get("/api/ama/meta", (_req, res) => {
    res.json(ok({
      displayName: amaService.getDisplayName(),
      shortName: amaService.getShortName(),
      strategyCode: amaService.getStrategyCode(),
      strategyVersion: AMA_STRATEGY_VERSION,
      modes: AMA_MODE_VALUES,
    }));
  });
}
