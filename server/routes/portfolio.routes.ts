/**
 * Portfolio Global Routes — Fase 3
 *
 * API endpoints for global portfolio management.
 * Read-only by default. Budget modifications require explicit calls.
 */

import type { Express } from "express";
import { z } from "zod";
import { portfolioGlobalService } from "../services/portfolio/portfolioGlobalService";

const setBudgetSchema = z.object({
  mode: z.enum(["AMA", "IDCA", "GRID", "FISCO", "SPOT_NORMAL", "MANUAL"]),
  exchange: z.string().min(1),
  asset: z.string().min(1),
  budgetedUsd: z.number().nonnegative(),
  allocationType: z.enum(["MANUAL_FIXED_ALLOCATION", "PERCENTAGE", "DYNAMIC"]).optional().default("MANUAL_FIXED_ALLOCATION"),
});

const setBudgetStatusSchema = z.object({
  mode: z.enum(["AMA", "IDCA", "GRID", "FISCO", "SPOT_NORMAL", "MANUAL"]),
  exchange: z.string().min(1),
  asset: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED", "EXHAUSTED", "PAUSED"]),
});

const reserveSchema = z.object({
  mode: z.enum(["AMA", "IDCA", "GRID", "FISCO", "SPOT_NORMAL", "MANUAL"]),
  exchange: z.string().min(1),
  asset: z.string().min(1),
  amountUsd: z.number().positive(),
});

const setHoldingSchema = z.object({
  asset: z.string().min(1),
  exchange: z.string().min(1),
  quantity: z.number().nonnegative(),
  costBasisUsd: z.number().nonnegative(),
  currentPriceUsd: z.number().positive().optional(),
});

function ok<T>(data: T) {
  return { success: true, data, timestamp: new Date().toISOString() };
}

function err(message: string) {
  return { success: false, error: message, timestamp: new Date().toISOString() };
}

export function registerPortfolioRoutes(app: Express): void {
  // ── Snapshot ─────────────────────────────────────────────────────
  app.get("/api/portfolio/snapshot", (_req, res) => {
    const snapshot = portfolioGlobalService.getLatestSnapshot();
    if (!snapshot) return res.json(ok(null));
    res.json(ok(snapshot));
  });

  app.get("/api/portfolio/snapshots", (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const snapshots = portfolioGlobalService.getSnapshotHistory(limit);
    res.json(ok(snapshots));
  });

  app.post("/api/portfolio/snapshot/take", (_req, res) => {
    const snapshot = portfolioGlobalService.takeSnapshot([]);
    res.json(ok(snapshot));
  });

  // ── Budgets ──────────────────────────────────────────────────────
  app.get("/api/portfolio/budgets", (_req, res) => {
    res.json(ok(portfolioGlobalService.getAllBudgets()));
  });

  app.get("/api/portfolio/budgets/:mode/:exchange/:asset", (req, res) => {
    const budget = portfolioGlobalService.getBudget(
      req.params.mode as any,
      req.params.exchange,
      req.params.asset,
    );
    if (!budget) return res.status(404).json(err("Budget not found"));
    res.json(ok(budget));
  });

  app.post("/api/portfolio/budgets", (req, res) => {
    const parsed = setBudgetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err(`Invalid budget: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
    }
    const { mode, exchange, asset, budgetedUsd, allocationType } = parsed.data;
    const budget = portfolioGlobalService.setBudget(mode, exchange, asset, budgetedUsd, allocationType);
    res.json(ok(budget));
  });

  app.patch("/api/portfolio/budgets/status", (req, res) => {
    const parsed = setBudgetStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("Invalid status update"));
    }
    const { mode, exchange, asset, status } = parsed.data;
    portfolioGlobalService.setBudgetStatus(mode, exchange, asset, status);
    const budget = portfolioGlobalService.getBudget(mode, exchange, asset);
    res.json(ok(budget));
  });

  app.post("/api/portfolio/budgets/reserve", (req, res) => {
    const parsed = reserveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("Invalid reservation"));
    }
    const { mode, exchange, asset, amountUsd } = parsed.data;
    const success = portfolioGlobalService.reserveAmount(mode, exchange, asset, amountUsd);
    if (!success) return res.status(409).json(err("Insufficient free budget or budget not active"));
    res.json(ok({ reserved: true }));
  });

  app.post("/api/portfolio/budgets/release", (req, res) => {
    const parsed = reserveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("Invalid release"));
    }
    const { mode, exchange, asset, amountUsd } = parsed.data;
    const success = portfolioGlobalService.releaseReservation(mode, exchange, asset, amountUsd);
    if (!success) return res.status(409).json(err("Cannot release more than reserved"));
    res.json(ok({ released: true }));
  });

  // ── Holdings ─────────────────────────────────────────────────────
  app.get("/api/portfolio/holdings", (_req, res) => {
    res.json(ok(portfolioGlobalService.getHoldings()));
  });

  app.post("/api/portfolio/holdings", (req, res) => {
    const parsed = setHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(err("Invalid holding"));
    }
    const { asset, exchange, quantity, costBasisUsd, currentPriceUsd } = parsed.data;
    portfolioGlobalService.setHolding({
      asset,
      exchange,
      quantity,
      costBasisUsd,
      currentPriceUsd: currentPriceUsd ?? null,
      currentValueUsd: null,
      unrealizedPnlUsd: null,
      unrealizedPnlPct: null,
    });
    res.json(ok({ set: true }));
  });

  // ── Ledger ───────────────────────────────────────────────────────
  app.get("/api/portfolio/ledger", (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json(ok(portfolioGlobalService.getLedgerEntries(limit)));
  });

  app.get("/api/portfolio/ledger/:mode", (req, res) => {
    const entries = portfolioGlobalService.getLedgerByMode(req.params.mode as any);
    res.json(ok(entries));
  });

  // ── Validation ───────────────────────────────────────────────────
  app.get("/api/portfolio/validate", (_req, res) => {
    const budgetErrors = portfolioGlobalService.validateAllBudgets();
    const doubleCounting = portfolioGlobalService.detectDoubleCounting();
    res.json(ok({
      budgetErrors,
      doubleCounting,
      hasIssues: budgetErrors.length > 0 || doubleCounting.length > 0,
    }));
  });

  // ── DB-backed endpoints (PostgreSQL source of truth) ──────────────

  app.get("/api/portfolio/db/snapshot", async (_req, res) => {
    try {
      const snapshot = await portfolioGlobalService.dbGetLatestSnapshot();
      res.json(ok(snapshot));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/db/budgets", async (_req, res) => {
    try {
      const budgets = await portfolioGlobalService.dbGetAllBudgets();
      res.json(ok(budgets));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/db/budgets", async (req, res) => {
    try {
      const parsed = setBudgetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err(`Invalid budget: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const { mode, exchange, asset, budgetedUsd, allocationType } = parsed.data;
      const budget = await portfolioGlobalService.dbSetBudget(mode, exchange, asset, budgetedUsd, allocationType);
      res.json(ok(budget));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/db/holdings", async (_req, res) => {
    try {
      const holdings = await portfolioGlobalService.dbGetHoldings();
      res.json(ok(holdings));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/db/ledger", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const entries = await portfolioGlobalService.dbGetLedgerEntries(limit);
      res.json(ok(entries));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/db/snapshot/take", async (_req, res) => {
    try {
      const snapshot = await portfolioGlobalService.dbTakeSnapshot([]);
      res.json(ok(snapshot));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/db/snapshots", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const snapshots = await portfolioGlobalService.dbGetSnapshotHistory(limit);
      res.json(ok(snapshots));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });
}
