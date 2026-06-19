/**
 * Autotuning Routes — Phases 6, 7, 8, 10, 11, 12
 *
 * Endpoints:
 *   GET  /api/autotuning/metrics          — aggregated metrics by sourceMode
 *   GET  /api/autotuning/dataset/counts   — dataset counts per source
 *   GET  /api/autotuning/snapshots/count  — trade_snapshots count
 *   GET  /api/autotuning/profiles         — list strategy profiles
 *   POST /api/autotuning/profiles         — create profile
 *   PATCH /api/autotuning/profiles/:id    — update profile
 *   GET  /api/autotuning/proposals        — list tuning proposals
 *   POST /api/autotuning/proposals        — create proposal
 *   PATCH /api/autotuning/proposals/:id/status — update proposal status
 *   POST /api/autotuning/proposals/:id/approve — approve proposal (APPROVED)
 *   POST /api/autotuning/proposals/:id/reject  — reject proposal (REJECTED)
 *   POST /api/autotuning/proposals/:id/rollback — rollback to previous profile
 *   GET  /api/autotuning/autoapply        — get autoapply status (always OFF unless manually enabled)
 */

import type { Express } from "express";
import type { RouterDeps } from "./types";
import { storage } from "../storage";

export function registerAutotuningRoutes(app: Express, _deps: RouterDeps): void {

  // ─── Aggregated metrics ────────────────────────────────────────────────────
  app.get("/api/autotuning/metrics", async (req, res) => {
    try {
      const { sourceMode, strategyType, pair, regime } = req.query as Record<string, string | undefined>;
      const metrics = await storage.getAutotuningMetrics({ sourceMode, strategyType, pair, regime });
      res.json(metrics);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ─── Dataset counts ────────────────────────────────────────────────────────
  app.get("/api/autotuning/dataset/counts", async (_req, res) => {
    try {
      const [realCount, dryRunCount, shadowCount, totalLabeled, snapshotCount] = await Promise.all([
        storage.getTrainingTradesCount({ closed: true, labeled: true }).catch(() => 0),
        (async () => {
          const metrics = await storage.getAutotuningMetrics({ sourceMode: 'DRY_RUN' });
          return metrics.dryRunTrades;
        })(),
        (async () => {
          const metrics = await storage.getAutotuningMetrics({ sourceMode: 'SHADOW' });
          return metrics.shadowTrades;
        })(),
        storage.getTrainingTradesCount({ closed: true, labeled: true }).catch(() => 0),
        storage.getTradeSnapshotCount().catch(() => 0),
      ]);
      res.json({
        real:          realCount,
        dryRun:        dryRunCount,
        shadow:        shadowCount,
        totalLabeled,
        snapshots:     snapshotCount,
        evidenceWeights: { REAL: 1.0, DRY_RUN: 0.5, SHADOW: 0.3, IDCA_SIMULATION: 0.4 },
        minSamplesForFilter: 300,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ─── Snapshot count ────────────────────────────────────────────────────────
  app.get("/api/autotuning/snapshots/count", async (req, res) => {
    try {
      const { sourceMode, strategyType } = req.query as Record<string, string | undefined>;
      const count = await storage.getTradeSnapshotCount({ sourceMode, strategyType });
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ─── Strategy Profiles ─────────────────────────────────────────────────────
  app.get("/api/autotuning/profiles", async (req, res) => {
    try {
      const { strategyType, mode, isActive } = req.query as Record<string, string | undefined>;
      const profiles = await storage.getStrategyProfiles({
        strategyType,
        mode,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      });
      res.json(profiles);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.post("/api/autotuning/profiles", async (req, res) => {
    try {
      const { strategyType, pair, profileName, mode, configJson, notes } = req.body;
      if (!strategyType || !profileName) {
        return res.status(400).json({ error: "strategyType and profileName are required" });
      }
      const profile = await storage.saveStrategyProfile({
        strategyType, pair: pair ?? null, profileName,
        mode: mode ?? "ACTIVE", configJson: configJson ?? {},
        notes: notes ?? null, isActive: false,
      });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.patch("/api/autotuning/profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const updated = await storage.updateStrategyProfile(id, req.body);
      if (!updated) return res.status(404).json({ error: "Profile not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ─── Tuning Proposals ──────────────────────────────────────────────────────
  app.get("/api/autotuning/proposals", async (req, res) => {
    try {
      const { status, strategyType, pair } = req.query as Record<string, string | undefined>;
      const proposals = await storage.getTuningProposals({ status, strategyType, pair });
      res.json(proposals);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.post("/api/autotuning/proposals", async (req, res) => {
    try {
      const { strategyType, pair, recommendation, confidenceScore, riskScore, parameterChangesJson } = req.body;
      if (!strategyType) return res.status(400).json({ error: "strategyType is required" });
      const proposal = await storage.saveTuningProposal({
        strategyType, pair: pair ?? null,
        status: "OBSERVING",
        recommendation: recommendation ?? null,
        confidenceScore: confidenceScore ?? null,
        riskScore: riskScore ?? null,
        parameterChangesJson: parameterChangesJson ?? null,
      });
      res.json(proposal);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.patch("/api/autotuning/proposals/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { status, rejectionReason, metricsAfterJson } = req.body;
      if (!status) return res.status(400).json({ error: "status is required" });
      const VALID = ['OBSERVING', 'TESTING', 'READY', 'APPROVED', 'ACTIVE', 'REJECTED', 'ROLLBACK'];
      if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
      const updated = await storage.updateTuningProposalStatus(id, status, {
        rejectionReason: rejectionReason ?? null,
        metricsAfterJson: metricsAfterJson ?? undefined,
        approvedAt: status === 'APPROVED' ? new Date() : undefined,
        appliedAt:  status === 'ACTIVE'   ? new Date() : undefined,
        rolledBackAt: status === 'ROLLBACK' ? new Date() : undefined,
      });
      if (!updated) return res.status(404).json({ error: "Proposal not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // Approve shortcut
  app.post("/api/autotuning/proposals/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { approvedBy } = req.body;
      const updated = await storage.updateTuningProposalStatus(id, "APPROVED", {
        approvedBy: approvedBy ?? "manual",
        approvedAt: new Date(),
      });
      if (!updated) return res.status(404).json({ error: "Proposal not found" });
      res.json({ success: true, proposal: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // Reject shortcut
  app.post("/api/autotuning/proposals/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { reason } = req.body;
      const updated = await storage.updateTuningProposalStatus(id, "REJECTED", {
        rejectionReason: reason ?? "Rejected manually",
      });
      if (!updated) return res.status(404).json({ error: "Proposal not found" });
      res.json({ success: true, proposal: updated });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // Rollback: creates a rollback proposal pointing to parent profile
  app.post("/api/autotuning/proposals/:id/rollback", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const proposal = (await storage.getTuningProposals()).find(p => p.id === id);
      if (!proposal) return res.status(404).json({ error: "Proposal not found" });

      // Mark original as ROLLBACK
      await storage.updateTuningProposalStatus(id, "ROLLBACK", { rolledBackAt: new Date() });

      // If there's a profileId, reactivate the previous profile
      if (proposal.profileId) {
        await storage.updateStrategyProfile(proposal.profileId, {
          isActive:   true,
          mode:       "ACTIVE",
          archivedAt: null as any,
        });
      }

      res.json({ success: true, message: "Rollback applied. Review active profiles." });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ─── Autoapply status (Phase 12 — always OFF by default) ──────────────────
  app.get("/api/autotuning/autoapply", async (_req, res) => {
    res.json({
      enabled:  false,
      message:  "Autoapply está DESACTIVADO por defecto. Requiere aprobación manual.",
      minSamples: 300,
    });
  });
}
