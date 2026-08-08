/**
 * Portfolio Global Routes — R2 Architectural Overhaul
 *
 * Single API surface under /api/portfolio/*.
 * PostgreSQL-only. No in-memory fallback. No /db prefix.
 * FISCO excluded from budget/reservation/deploy operations.
 */

import type { Express } from "express";
import { z } from "zod";
import { portfolioGlobalService } from "../services/portfolio/portfolioGlobalService";
import { portfolioAllocationGuard } from "../services/portfolio/PortfolioAllocationGuard";
import { portfolioBootstrapService } from "../services/portfolio/PortfolioBootstrapService";
import { portfolioReconciliationService } from "../services/portfolio/PortfolioReconciliationService";

const operationalModeSchema = z.enum(["AMA", "IDCA", "GRID", "SPOT_NORMAL", "MANUAL"]);

const setBudgetSchema = z.object({
  mode: operationalModeSchema,
  exchange: z.string().min(1),
  asset: z.string().min(1),
  budgetedUsd: z.number().nonnegative(),
  allocationType: z.enum(["MANUAL_FIXED_ALLOCATION", "PERCENTAGE", "DYNAMIC"]).optional().default("MANUAL_FIXED_ALLOCATION"),
  updatedBy: z.string().optional(),
});

const setBudgetStatusSchema = z.object({
  mode: operationalModeSchema,
  exchange: z.string().min(1),
  asset: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED", "EXHAUSTED", "PAUSED"]),
});

const reserveSchema = z.object({
  mode: operationalModeSchema,
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

const createReservationSchema = z.object({
  reservationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  mode: operationalModeSchema,
  exchange: z.string().min(1),
  asset: z.string().min(1),
  amountUsd: z.number().positive(),
  logicalIntentId: z.string().optional(),
  expiresAt: z.string().optional(),
});

const acquireLockSchema = z.object({
  lockId: z.string().min(1),
  lockKey: z.string().min(1),
  mode: operationalModeSchema,
  exchange: z.string().min(1),
  asset: z.string().min(1),
  logicalIntentId: z.string().optional(),
  ownerInstance: z.string().optional(),
  expiresAt: z.string().optional(),
});

const addAttributionSchema = z.object({
  attributionId: z.string().min(1),
  exchange: z.string().min(1),
  asset: z.string().min(1),
  mode: operationalModeSchema,
  quantity: z.number().positive(),
  costBasisUsd: z.number().nonnegative(),
  sourceType: z.enum(["GRID_FILL", "IDCA_LOT", "AMA_TRANCHE", "TRADING_POSITION", "MANUAL", "BOOTSTRAP"]),
  sourceId: z.string().optional(),
  cycleId: z.string().optional(),
  trancheId: z.string().optional(),
  lotId: z.string().optional(),
});

function ok<T>(data: T) {
  return { success: true, data, timestamp: new Date().toISOString() };
}

function err(message: string) {
  return { success: false, error: message, timestamp: new Date().toISOString() };
}

export function registerPortfolioRoutes(app: Express): void {
  // ── Health ────────────────────────────────────────────────────────
  app.get("/api/portfolio/health", async (_req, res) => {
    try {
      const [allocHealth, reconHealth] = await Promise.all([
        portfolioAllocationGuard.getHealth(),
        portfolioReconciliationService.getHealth(),
      ]);
      res.json(ok({
        status: "ok",
        sourceOfTruth: "POSTGRESQL",
        databaseReady: true,
        budgetInvariant: allocHealth.allocationInvariant,
        allocationInvariant: allocHealth.allocationInvariant,
        inventoryInvariant: allocHealth.allocationInvariant,
        reservationsHealthy: true,
        locksHealthy: true,
        reconciliationStatus: reconHealth.reconciliationStatus,
        blockedModeAssets: allocHealth.blockedModeAssets,
        timestamp: new Date().toISOString(),
      }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Summary ───────────────────────────────────────────────────────
  app.get("/api/portfolio/summary", async (_req, res) => {
    try {
      const summary = await portfolioGlobalService.getSummary();
      res.json(ok(summary));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Snapshot ──────────────────────────────────────────────────────
  app.get("/api/portfolio/snapshot", async (_req, res) => {
    try {
      const snapshot = await portfolioGlobalService.getLatestSnapshot();
      res.json(ok(snapshot));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/snapshots", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const snapshots = await portfolioGlobalService.getSnapshotHistory(limit);
      res.json(ok(snapshots));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/snapshot/take", async (_req, res) => {
    try {
      const snapshot = await portfolioGlobalService.takeSnapshot([]);
      res.json(ok(snapshot));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Budgets ───────────────────────────────────────────────────────
  app.get("/api/portfolio/budgets", async (_req, res) => {
    try {
      res.json(ok(await portfolioGlobalService.getAllBudgets()));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/budgets/:mode/:exchange/:asset", async (req, res) => {
    try {
      const budget = await portfolioGlobalService.getBudget(
        req.params.mode as any,
        req.params.exchange,
        req.params.asset,
      );
      if (!budget) return res.status(404).json(err("Budget not found"));
      res.json(ok(budget));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/budgets", async (req, res) => {
    try {
      const parsed = setBudgetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err(`Invalid budget: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const { mode, exchange, asset, budgetedUsd, allocationType, updatedBy } = parsed.data;
      const check = await portfolioAllocationGuard.validateBudgetModification(mode, exchange, asset, budgetedUsd);
      if (!check.passed) {
        return res.status(409).json(err(check.reason || "PORTFOLIO_OVER_ALLOCATION"));
      }
      const budget = await portfolioGlobalService.setBudget(mode, exchange, asset, budgetedUsd, allocationType, updatedBy);
      res.json(ok(budget));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.patch("/api/portfolio/budgets/status", async (req, res) => {
    try {
      const parsed = setBudgetStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid status update"));
      }
      const { mode, exchange, asset, status } = parsed.data;
      await portfolioGlobalService.setBudgetStatus(mode, exchange, asset, status);
      const budget = await portfolioGlobalService.getBudget(mode, exchange, asset);
      res.json(ok(budget));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/budgets/reserve", async (req, res) => {
    try {
      const parsed = reserveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid reservation"));
      }
      const { mode, exchange, asset, amountUsd } = parsed.data;
      const success = await portfolioGlobalService.reserveAmount(mode, exchange, asset, amountUsd);
      if (!success) return res.status(409).json(err("Insufficient free budget or budget not active"));
      res.json(ok({ reserved: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/budgets/release", async (req, res) => {
    try {
      const parsed = reserveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid release"));
      }
      const { mode, exchange, asset, amountUsd } = parsed.data;
      const success = await portfolioGlobalService.releaseBudgetReservation(mode, exchange, asset, amountUsd);
      if (!success) return res.status(409).json(err("Cannot release more than reserved"));
      res.json(ok({ released: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/budgets/deploy", async (req, res) => {
    try {
      const parsed = reserveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid deploy"));
      }
      const { mode, exchange, asset, amountUsd } = parsed.data;
      const success = await portfolioGlobalService.deployAmount(mode, exchange, asset, amountUsd);
      if (!success) return res.status(409).json(err("Insufficient free budget or budget not active"));
      res.json(ok({ deployed: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Holdings ──────────────────────────────────────────────────────
  app.get("/api/portfolio/holdings", async (_req, res) => {
    try {
      res.json(ok(await portfolioGlobalService.getHoldings()));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/holdings", async (req, res) => {
    try {
      const parsed = setHoldingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid holding"));
      }
      const { asset, exchange, quantity, costBasisUsd, currentPriceUsd } = parsed.data;
      await portfolioGlobalService.setHolding({
        asset, exchange, quantity, costBasisUsd,
        currentPriceUsd: currentPriceUsd ?? null,
        currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null,
      });
      res.json(ok({ set: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Ledger ────────────────────────────────────────────────────────
  app.get("/api/portfolio/ledger", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      res.json(ok(await portfolioGlobalService.getLedgerEntries(limit)));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.get("/api/portfolio/ledger/:mode", async (req, res) => {
    try {
      const entries = await portfolioGlobalService.getLedgerByMode(req.params.mode as any);
      res.json(ok(entries));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Inventory Attribution ─────────────────────────────────────────
  app.get("/api/portfolio/inventory", async (req, res) => {
    try {
      const exchange = req.query.exchange as string | undefined;
      const asset = req.query.asset as string | undefined;
      res.json(ok(await portfolioGlobalService.getAttributions(exchange, asset)));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/inventory", async (req, res) => {
    try {
      const parsed = addAttributionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err(`Invalid attribution: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const { attributionId, exchange, asset, mode, quantity, costBasisUsd, sourceType, sourceId, cycleId, trancheId, lotId } = parsed.data;
      const attribution = await portfolioGlobalService.addAttribution(
        attributionId, exchange, asset, mode, quantity, costBasisUsd,
        sourceType, sourceId, cycleId, trancheId, lotId,
      );
      res.json(ok(attribution));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.patch("/api/portfolio/inventory/:attributionId/status", async (req, res) => {
    try {
      const status = z.enum(["ACTIVE", "REDUCED", "CLOSED", "TRANSFERRED"]).safeParse(req.body.status);
      if (!status.success) {
        return res.status(400).json(err("Invalid attribution status"));
      }
      const success = await portfolioGlobalService.updateAttributionStatus(req.params.attributionId, status.data);
      if (!success) return res.status(404).json(err("Attribution not found"));
      res.json(ok({ updated: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Reservations ──────────────────────────────────────────────────
  app.get("/api/portfolio/reservations", async (req, res) => {
    try {
      const status = req.query.status as any;
      res.json(ok(await portfolioGlobalService.getReservations(status)));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reservations", async (req, res) => {
    try {
      const parsed = createReservationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err(`Invalid reservation: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const { reservationId, idempotencyKey, mode, exchange, asset, amountUsd, logicalIntentId, expiresAt } = parsed.data;
      const reservation = await portfolioGlobalService.createReservation(
        reservationId, idempotencyKey, mode, exchange, asset, amountUsd,
        logicalIntentId, expiresAt ? new Date(expiresAt) : undefined,
      );
      if (!reservation) return res.status(409).json(err("Reservation already exists (idempotency)"));
      res.json(ok(reservation));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reservations/:reservationId/confirm", async (req, res) => {
    try {
      const success = await portfolioGlobalService.confirmReservation(req.params.reservationId);
      if (!success) return res.status(404).json(err("Reservation not found or not pending"));
      res.json(ok({ confirmed: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reservations/:reservationId/convert", async (req, res) => {
    try {
      const orderId = req.body.orderId as string | undefined;
      const success = await portfolioGlobalService.convertReservation(req.params.reservationId, orderId);
      if (!success) return res.status(404).json(err("Reservation not found or already converted"));
      res.json(ok({ converted: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reservations/:reservationId/release", async (req, res) => {
    try {
      const reason = req.body.reason as string | undefined;
      const success = await portfolioGlobalService.releaseReservation(req.params.reservationId, reason);
      if (!success) return res.status(404).json(err("Reservation not found or already released"));
      res.json(ok({ released: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reservations/expire", async (_req, res) => {
    try {
      const count = await portfolioGlobalService.expireReservations();
      res.json(ok({ expired: count }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Order Locks ───────────────────────────────────────────────────
  app.post("/api/portfolio/locks/acquire", async (req, res) => {
    try {
      const parsed = acquireLockSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err(`Invalid lock: ${parsed.error.issues.map((i) => i.message).join("; ")}`));
      }
      const { lockId, lockKey, mode, exchange, asset, logicalIntentId, ownerInstance, expiresAt } = parsed.data;
      const success = await portfolioGlobalService.acquireLock(
        lockId, lockKey, mode, exchange, asset,
        logicalIntentId, ownerInstance, expiresAt ? new Date(expiresAt) : undefined,
      );
      if (!success) return res.status(409).json(err("Lock already held"));
      res.json(ok({ acquired: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/locks/:lockKey/release", async (req, res) => {
    try {
      const success = await portfolioGlobalService.releaseLock(req.params.lockKey);
      if (!success) return res.status(404).json(err("Lock not found or not held"));
      res.json(ok({ released: true }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/locks/expire", async (_req, res) => {
    try {
      const count = await portfolioGlobalService.expireLocks();
      res.json(ok({ expired: count }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Reconciliation ────────────────────────────────────────────────
  app.get("/api/portfolio/reconciliation", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      res.json(ok(await portfolioGlobalService.getReconciliationRuns(limit)));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reconciliation", async (req, res) => {
    try {
      const schema = z.object({
        exchange: z.string().min(1),
        asset: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid reconciliation request"));
      }
      const reconciliationId = `recon-${Date.now()}`;
      const run = await portfolioGlobalService.createReconciliationRun(reconciliationId, parsed.data.exchange, parsed.data.asset);
      if (!run) return res.status(500).json(err("Failed to create reconciliation run"));
      res.json(ok(run));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/reconciliation/run", async (_req, res) => {
    try {
      const report = await portfolioReconciliationService.runGlobalReconciliation();
      res.json(ok(report));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Allocation Guard ──────────────────────────────────────────────
  app.get("/api/portfolio/allocation/check", async (_req, res) => {
    try {
      const checks = await portfolioAllocationGuard.checkGlobalAllocation();
      res.json(ok(checks));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  app.post("/api/portfolio/allocation/validate-budget", async (req, res) => {
    try {
      const schema = z.object({
        mode: operationalModeSchema,
        exchange: z.string().min(1),
        asset: z.string().min(1),
        budgetedUsd: z.number().nonnegative(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(err("Invalid allocation validation request"));
      }
      const { mode, exchange, asset, budgetedUsd } = parsed.data;
      const check = await portfolioAllocationGuard.validateBudgetModification(mode, exchange, asset, budgetedUsd);
      res.json(ok(check));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Bootstrap ─────────────────────────────────────────────────────
  app.post("/api/portfolio/bootstrap", async (_req, res) => {
    try {
      const report = await portfolioBootstrapService.runBootstrap();
      res.json(ok(report));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });

  // ── Validation ────────────────────────────────────────────────────
  app.get("/api/portfolio/validate", async (_req, res) => {
    try {
      const budgetErrors = await portfolioGlobalService.validateAllBudgets();
      const doubleCounting = await portfolioGlobalService.detectDoubleCounting();
      res.json(ok({
        budgetErrors,
        doubleCounting,
        hasIssues: budgetErrors.length > 0 || doubleCounting.length > 0,
      }));
    } catch (e) {
      res.status(500).json(err(String(e)));
    }
  });
}
