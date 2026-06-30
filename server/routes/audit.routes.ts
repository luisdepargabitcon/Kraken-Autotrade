/**
 * audit.routes.ts
 * Unified audit API for Trading Normal/Dry Run and IDCA.
 * READ-ONLY — no real orders, no config changes, no engine mutations.
 *
 * Trading:
 *   GET /api/audit/trading/summary
 *   GET /api/audit/trading/operations
 *   GET /api/audit/trading/operations/:id
 *   GET /api/audit/trading/export
 *   GET /api/audit/trading/chatgpt-summary
 *
 * IDCA:
 *   GET /api/audit/idca/summary
 *   GET /api/audit/idca/cycles
 *   GET /api/audit/idca/cycles/:id
 *   GET /api/audit/idca/cycles/:id/timeline
 *   GET /api/audit/idca/cycles/:id/grid-mean-reversion
 *   GET /api/audit/idca/export
 *   GET /api/audit/idca/chatgpt-summary
 *
 * Retention (safe, preview-first):
 *   GET  /api/audit/retention/status
 *   POST /api/audit/retention/preview-cleanup
 *   POST /api/audit/retention/run-cleanup
 */

import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  buildTradeEfficiencyMetrics,
  generateTradeDiagnostics,
  generateIdcaDiagnostics,
  generateTradingChatGptSummary,
  generateIdcaChatGptSummary,
  computeProfitFactor,
  computeExpectancy,
  durationMinutes,
  formatDuration,
  classifyExitEfficiency,
  computeProfitCapturePct,
  classifyProfitCaptureQuality,
  type OhlcPoint,
  type TradeEfficiencyMetrics,
  type ProfitCaptureQuality,
} from "../services/auditMetrics";
import { classifyExitReason } from "../utils/exitReasonClassifier";
import {
  classifyEventRetention,
  getCleanableTypes,
  buildSqlInList,
  type EventRetentionTier,
} from "../services/audit/botEventClassification";
import { calculateIdcaCycleRealizedPnl, type IdcaCyclePnlResult } from "../../shared/idcaCyclePnl";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  const f = parseFloat(String(v ?? "0"));
  return isNaN(f) ? 0 : f;
}

function nullableN(v: unknown): number | null {
  if (v == null) return null;
  const f = parseFloat(String(v));
  return isNaN(f) ? null : f;
}

function fmtUsd(v: number | null): string {
  if (v === null) return "N/A";
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}$${v.toFixed(2)}`;
}

/**
 * Load orders for an IDCA cycle and compute canonical PnL using shared/idcaCyclePnl.ts.
 * This ensures the audit uses the same PnL logic as IDCA → Historial.
 */
async function computeCanonicalIdcaPnl(cycleRow: any): Promise<{
  pnlResult: IdcaCyclePnlResult;
  orders: any[];
}> {
  const orderRows = await db.execute(sql`
    SELECT * FROM institutional_dca_orders WHERE cycle_id = ${cycleRow.id} ORDER BY executed_at ASC
  `);
  const orders = (orderRows.rows ?? []) as any[];

  const pnlResult = calculateIdcaCycleRealizedPnl(
    {
      id: cycleRow.id,
      capitalUsedUsd: cycleRow.capital_used_usd,
      totalQuantity: cycleRow.total_quantity,
      avgEntryPrice: cycleRow.avg_entry_price,
      realizedPnlUsd: cycleRow.realized_pnl_usd,
      pair: cycleRow.pair,
      status: cycleRow.status,
      isImported: cycleRow.is_imported,
      isManualCycle: cycleRow.is_manual_cycle,
      sourceType: cycleRow.source_type,
      managedBy: cycleRow.managed_by,
      basePrice: cycleRow.base_price,
      basePriceType: cycleRow.base_price_type,
      importSnapshotJson: cycleRow.import_snapshot_json,
    },
    orders
  );

  return { pnlResult, orders };
}

/** Determine if canonical PnL is calculable (not insufficient or cost_basis_missing) */
function isPnlCalculable(pnlSource: string): boolean {
  return pnlSource !== "insufficient" && pnlSource !== "cost_basis_missing";
}

/** Fetch OHLC candles for a pair between two timestamps (1h timeframe) */
async function fetchCandlesForPeriod(
  pair: string,
  from: Date | null,
  to: Date | null
): Promise<OhlcPoint[]> {
  if (!from || !to) return [];
  try {
    const rows = await db.execute(sql`
      SELECT high, low FROM market_candles
      WHERE pair = ${pair}
        AND timeframe = '1h'
        AND open_time >= ${from.toISOString()}
        AND open_time <= ${to.toISOString()}
      ORDER BY open_time ASC
      LIMIT 500
    `);
    return (rows.rows ?? []).map((r: any) => ({
      high: n(r.high),
      low: n(r.low),
    }));
  } catch {
    return [];
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerAuditRoutes(app: Express): void {

  // ══════════════════════════════════════════════════════════════════════════
  // TRADING AUDIT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/audit/trading/summary
   * Aggregated trading audit: PnL by reason, by pair, by regime, by strategy.
   * Extends the existing exit-audit with profit factor, expectancy, per-strategy stats.
   */
  app.get("/api/audit/trading/summary", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const since = req.query.since as string | undefined;
      const mode = req.query.mode as string | undefined; // 'real' | 'dry_run' | undefined

      let where = `type = 'sell' AND excluded_from_pnl = false`;
      if (pair && pair !== "all") where += ` AND pair = ${sql.placeholder("pair")}`;
      if (since) where += ` AND created_at >= '${since}'::timestamptz`;

      const rows = await db.execute(sql`
        SELECT
          pair, reason, strategy_id, regime,
          realized_pnl_usd, realized_pnl_pct,
          entry_price, amount, total_usd, created_at, closed_at
        FROM dry_run_trades
        WHERE type = 'sell' AND excluded_from_pnl = false
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND created_at >= ${since}::timestamptz` : sql``}
        ORDER BY created_at DESC
        LIMIT 5000
      `);

      const sells = (rows.rows ?? []) as any[];
      if (sells.length === 0) {
        return res.json({
          success: true, data: {
            totalSells: 0, totalPnlUsd: 0, wins: 0, losses: 0, winRate: 0,
            profitFactor: null, expectancy: 0,
            byReason: [], byPair: [], byRegime: [], byStrategy: [],
            alerts: [],
          },
        });
      }

      const pnls = sells.map(s => n(s.realized_pnl_usd));
      const totalPnl = pnls.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(p => p > 0).length;
      const losses = pnls.filter(p => p <= 0).length;
      const winRate = (wins / sells.length) * 100;

      // By reason
      const reasonMap = new Map<string, any[]>();
      for (const s of sells) {
        const r = classifyExitReason(s.reason) as string;
        const arr = reasonMap.get(r) ?? [];
        arr.push(s);
        reasonMap.set(r, arr);
      }
      const byReason = Array.from(reasonMap.entries()).map(([reason, trades]) => {
        const rPnls = trades.map(t => n(t.realized_pnl_usd));
        const rWins = rPnls.filter(p => p > 0).length;
        const total = rPnls.reduce((a, b) => a + b, 0);
        return {
          reason,
          count: trades.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((rWins / trades.length) * 100).toFixed(1)),
          avgPnlUsd: parseFloat((total / trades.length).toFixed(2)),
          worstLossUsd: parseFloat(Math.min(...rPnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...rPnls).toFixed(2)),
          isProblematic: total < 0 && rPnls.filter(p => p <= 0).length > rWins,
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // By pair
      const pairMap = new Map<string, number[]>();
      for (const s of sells) {
        const arr = pairMap.get(s.pair) ?? [];
        arr.push(n(s.realized_pnl_usd));
        pairMap.set(s.pair, arr);
      }
      const byPair = Array.from(pairMap.entries()).map(([p, pairPnls]) => {
        const total = pairPnls.reduce((a, b) => a + b, 0);
        const pWins = pairPnls.filter(x => x > 0).length;
        return {
          pair: p,
          count: pairPnls.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((pWins / pairPnls.length) * 100).toFixed(1)),
          bestGainUsd: parseFloat(Math.max(...pairPnls).toFixed(2)),
          worstLossUsd: parseFloat(Math.min(...pairPnls).toFixed(2)),
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // By regime
      const regimeMap = new Map<string, number[]>();
      for (const s of sells) {
        const r = s.regime ?? "unknown";
        const arr = regimeMap.get(r) ?? [];
        arr.push(n(s.realized_pnl_usd));
        regimeMap.set(r, arr);
      }
      const byRegime = Array.from(regimeMap.entries()).map(([regime, regPnls]) => {
        const total = regPnls.reduce((a, b) => a + b, 0);
        return {
          regime,
          count: regPnls.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((regPnls.filter(x => x > 0).length / regPnls.length) * 100).toFixed(1)),
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // By strategy
      const stratMap = new Map<string, number[]>();
      for (const s of sells) {
        const strat = s.strategy_id ?? "default";
        const arr = stratMap.get(strat) ?? [];
        arr.push(n(s.realized_pnl_usd));
        stratMap.set(strat, arr);
      }
      const byStrategy = Array.from(stratMap.entries()).map(([strategy, sPnls]) => {
        const total = sPnls.reduce((a, b) => a + b, 0);
        return {
          strategy,
          count: sPnls.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((sPnls.filter(x => x > 0).length / sPnls.length) * 100).toFixed(1)),
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // Alerts
      const alerts: string[] = [];
      const tsReason = byReason.find(r => r.reason === "TIME_STOP");
      if (tsReason && tsReason.totalPnlUsd < 0) {
        alerts.push("TimeStop cerrando con PnL neto negativo. Revisar softMode y minProfitPctToExit.");
      }
      const emergReason = byReason.find(r => r.reason === "EMERGENCY_SL");
      if (emergReason && emergReason.count > 5) {
        alerts.push(`${emergReason.count} cierres por Stop-Loss emergencia. Revisar parámetros de entrada.`);
      }
      const worstPair = byPair[0];
      if (worstPair && worstPair.totalPnlUsd < -100) {
        alerts.push(`${worstPair.pair} tiene pérdida total de $${worstPair.totalPnlUsd.toFixed(2)}. Razón dominante: ${byReason[0]?.reason ?? "—"}.`);
      }

      res.json({
        success: true,
        data: {
          totalSells: sells.length,
          totalPnlUsd: parseFloat(totalPnl.toFixed(2)),
          wins, losses,
          winRate: parseFloat(winRate.toFixed(1)),
          worstLossUsd: parseFloat(Math.min(...pnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...pnls).toFixed(2)),
          profitFactor: computeProfitFactor(pnls),
          expectancy: computeExpectancy(pnls),
          byReason, byPair, byRegime, byStrategy, alerts,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/trading/operations?pair=&limit=&offset=&since=
   * List dry-run operations (sells) with derived efficiency metrics.
   * MFE/MAE from candles when available.
   */
  app.get("/api/audit/trading/operations", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
      const offset = parseInt(req.query.offset as string || "0", 10);
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT
          s.id, s.pair, s.price AS exit_price, s.amount, s.total_usd,
          s.reason, s.realized_pnl_usd, s.realized_pnl_pct,
          s.entry_price, s.entry_sim_txid, s.closed_at, s.created_at,
          s.strategy_id, s.regime,
          b.created_at AS entry_created_at
        FROM dry_run_trades s
        LEFT JOIN dry_run_trades b
          ON b.sim_txid = s.entry_sim_txid AND b.type = 'buy'
        WHERE s.type = 'sell'
          AND s.excluded_from_pnl = false
          ${pair && pair !== "all" ? sql`AND s.pair = ${pair}` : sql``}
          ${since ? sql`AND s.created_at >= ${since}::timestamptz` : sql``}
        ORDER BY s.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const ops = [];
      for (const row of (rows.rows ?? []) as any[]) {
        const entryPrice = n(row.entry_price);
        const qty = n(row.amount);
        const capital = entryPrice * qty;
        const finalPnlUsd = n(row.realized_pnl_usd);
        const entryDate = row.entry_created_at ?? null;
        const exitDate = row.closed_at ?? row.created_at ?? null;

        const candles = await fetchCandlesForPeriod(
          row.pair,
          entryDate ? new Date(entryDate) : null,
          exitDate ? new Date(exitDate) : null
        );

        const metrics = buildTradeEfficiencyMetrics({
          entryPrice, quantity: qty, capitalUsd: capital, finalPnlUsd, candles,
        });

        const diagnostics = generateTradeDiagnostics(metrics, row.reason, capital);
        const durMin = durationMinutes(entryDate, exitDate);

        ops.push({
          id: row.id,
          pair: row.pair,
          entryDate: entryDate ? new Date(entryDate).toISOString() : null,
          exitDate: exitDate ? new Date(exitDate).toISOString() : null,
          entryPrice, exitPrice: n(row.exit_price),
          quantity: qty, capitalUsd: parseFloat(capital.toFixed(2)),
          finalPnlUsd: parseFloat(finalPnlUsd.toFixed(2)),
          finalPnlPct: n(row.realized_pnl_pct),
          exitReason: row.reason ?? null,
          strategyId: row.strategy_id ?? null,
          regime: row.regime ?? null,
          durationMinutes: durMin,
          durationLabel: formatDuration(durMin),
          metrics,
          exitEfficiency: metrics.exitEfficiency,
          diagnostics,
        });
      }

      const countRow = await db.execute(sql`
        SELECT count(*) as c FROM dry_run_trades
        WHERE type = 'sell' AND excluded_from_pnl = false
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND created_at >= ${since}::timestamptz` : sql``}
      `);
      const total = parseInt((countRow.rows?.[0] as any)?.c ?? "0", 10);

      res.json({ success: true, data: ops, total, limit, offset });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/trading/operations/:id
   * Detail for a single dry-run operation.
   */
  app.get("/api/audit/trading/operations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const rows = await db.execute(sql`
        SELECT s.*, b.created_at AS entry_created_at, b.total_usd AS buy_total_usd
        FROM dry_run_trades s
        LEFT JOIN dry_run_trades b ON b.sim_txid = s.entry_sim_txid AND b.type = 'buy'
        WHERE s.id = ${id} AND s.type = 'sell'
      `);
      const row = (rows.rows ?? [])[0] as any;
      if (!row) return res.status(404).json({ success: false, error: "Operation not found" });

      const entryPrice = n(row.entry_price);
      const qty = n(row.amount);
      const capital = entryPrice * qty;
      const finalPnlUsd = n(row.realized_pnl_usd);
      const entryDate = row.entry_created_at ?? null;
      const exitDate = row.closed_at ?? row.created_at ?? null;

      const candles = await fetchCandlesForPeriod(
        row.pair,
        entryDate ? new Date(entryDate) : null,
        exitDate ? new Date(exitDate) : null
      );

      const metrics = buildTradeEfficiencyMetrics({
        entryPrice, quantity: qty, capitalUsd: capital, finalPnlUsd, candles,
      });

      const diagnostics = generateTradeDiagnostics(metrics, row.reason, capital);
      const durMin = durationMinutes(entryDate, exitDate);

      const chatgpt = generateTradingChatGptSummary({
        id: row.id, pair: row.pair, mode: "dry_run",
        entryDate: entryDate ? new Date(entryDate).toLocaleString("es-ES") : "—",
        exitDate: exitDate ? new Date(exitDate).toLocaleString("es-ES") : null,
        entryPrice, exitPrice: n(row.price),
        quantity: qty, capitalUsd: capital, finalPnlUsd, finalPnlPct: n(row.realized_pnl_pct),
        metrics, entryReason: null, exitReason: row.reason ?? null,
        smartExitActive: (row.reason ?? "").includes("SMART"),
        timeStopActive: (row.reason ?? "").includes("TIME"),
        beActive: (row.reason ?? "").includes("BREAK"),
        trailingActive: (row.reason ?? "").includes("TRAILING"),
        durationMinutes: durMin, diagnostics,
      });

      res.json({
        success: true, data: {
          id: row.id, pair: row.pair,
          entryDate, exitDate, entryPrice, exitPrice: n(row.price),
          quantity: qty, capitalUsd: capital, finalPnlUsd, finalPnlPct: n(row.realized_pnl_pct),
          exitReason: row.reason ?? null, strategyId: row.strategy_id ?? null, regime: row.regime ?? null,
          durationMinutes: durMin, durationLabel: formatDuration(durMin),
          candlesUsedForMFE: candles.length, metrics, diagnostics, chatgptSummary: chatgpt,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/trading/chatgpt-summary?pair=&since=
   * Copyable text summary of trading stats for ChatGPT analysis.
   */
  app.get("/api/audit/trading/chatgpt-summary", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT pair, reason, realized_pnl_usd, realized_pnl_pct, strategy_id
        FROM dry_run_trades
        WHERE type = 'sell' AND excluded_from_pnl = false
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND created_at >= ${since}::timestamptz` : sql``}
        LIMIT 5000
      `);
      const sells = (rows.rows ?? []) as any[];
      if (sells.length === 0) {
        return res.json({ success: true, text: "Sin operaciones dry-run cerradas." });
      }

      const pnls = sells.map(s => n(s.realized_pnl_usd));
      const total = pnls.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(p => p > 0).length;
      const pf = computeProfitFactor(pnls);
      const exp = computeExpectancy(pnls);
      const byReason = new Map<string, number[]>();
      for (const s of sells) {
        const r = classifyExitReason(s.reason) as string;
        const arr = byReason.get(r) ?? [];
        arr.push(n(s.realized_pnl_usd));
        byReason.set(r, arr);
      }

      const lines = [
        `AUDITORÍA TRADING DRY RUN`,
        pair ? `Par: ${pair}` : "Todos los pares",
        since ? `Desde: ${since}` : "Todo el historial",
        `───────────────────────────────────`,
        `Total operaciones: ${sells.length}`,
        `PnL total: ${fmtUsd(total)}`,
        `Win Rate: ${((wins / sells.length) * 100).toFixed(1)}% (${wins}G / ${sells.length - wins}P)`,
        `Profit Factor: ${pf != null && isFinite(pf) ? pf.toFixed(2) : "N/A"}`,
        `Expectancy: ${fmtUsd(exp)}`,
        `Mejor ganancia: ${fmtUsd(Math.max(...pnls))}`,
        `Peor pérdida: ${fmtUsd(Math.min(...pnls))}`,
        `───────────────────────────────────`,
        `Por razón de salida:`,
        ...Array.from(byReason.entries()).map(([r, ps]) => {
          const t = ps.reduce((a, b) => a + b, 0);
          const w = ps.filter(p => p > 0).length;
          return `  ${r}: ${ps.length} ops · PnL ${fmtUsd(t)} · WR ${((w / ps.length) * 100).toFixed(0)}%`;
        }),
        `───────────────────────────────────`,
        `Generado: ${new Date().toLocaleString("es-ES")}`,
      ];

      res.json({ success: true, text: lines.join("\n") });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/trading/export?format=csv|json&pair=&since=
   * Export trading operations.
   */
  app.get("/api/audit/trading/export", async (req, res) => {
    try {
      const format = (req.query.format as string) || "json";
      const pair = req.query.pair as string | undefined;
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT id, pair, entry_price, price AS exit_price, amount, realized_pnl_usd,
               realized_pnl_pct, reason, strategy_id, regime, created_at, closed_at
        FROM dry_run_trades
        WHERE type = 'sell' AND excluded_from_pnl = false
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND created_at >= ${since}::timestamptz` : sql``}
        ORDER BY created_at DESC
        LIMIT 10000
      `);

      const data = (rows.rows ?? []) as any[];

      if (format === "csv") {
        const header = "id,pair,entry_price,exit_price,amount,pnl_usd,pnl_pct,reason,strategy_id,regime,created_at,closed_at";
        const csvRows = data.map(r =>
          [r.id, r.pair, r.entry_price, r.exit_price, r.amount, r.realized_pnl_usd,
            r.realized_pnl_pct, r.reason, r.strategy_id, r.regime, r.created_at, r.closed_at
          ].join(",")
        );
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="audit_trading_${Date.now()}.csv"`);
        return res.send([header, ...csvRows].join("\n"));
      }

      res.json({ success: true, data, total: data.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // IDCA AUDIT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/audit/idca/summary
   * Summary of all IDCA cycles.
   */
  app.get("/api/audit/idca/summary", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;

      const rows = await db.execute(sql`
        SELECT
          id, pair, status, mode, buy_count,
          capital_used_usd, realized_pnl_usd, unrealized_pnl_usd,
          avg_entry_price, tp_target_price, tp_target_pct,
          highest_price_after_tp, max_drawdown_pct,
          trailing_active_at, tp_armed_at, close_reason,
          started_at, closed_at, total_quantity,
          is_imported, is_manual_cycle, source_type, managed_by,
          base_price, base_price_type, import_snapshot_json
        FROM institutional_dca_cycles
        ${pair && pair !== "all" ? sql`WHERE pair = ${pair}` : sql``}
        ORDER BY started_at DESC
        LIMIT 1000
      `);

      const cycles = (rows.rows ?? []) as any[];
      const closed = cycles.filter(c => c.status === "closed");
      const open = cycles.filter(c => c.status !== "closed");

      // Compute canonical PnL for closed cycles (loads orders per cycle)
      const closedPnlResults: { pnl: number; source: string; calculable: boolean }[] = [];
      for (const c of closed) {
        const { pnlResult } = await computeCanonicalIdcaPnl(c);
        closedPnlResults.push({
          pnl: pnlResult.realizedNetUsd,
          source: pnlResult.pnlSource,
          calculable: isPnlCalculable(pnlResult.pnlSource),
        });
      }

      const openPnls = open.map(c => n(c.unrealized_pnl_usd));
      const calculableClosed = closedPnlResults.filter(r => r.calculable);
      const totalRealizedPnl = calculableClosed.reduce((a, r) => a + r.pnl, 0);
      const totalUnrealizedPnl = openPnls.reduce((a, b) => a + b, 0);
      const closedWins = calculableClosed.filter(r => r.pnl > 0).length;
      const closedLosses = calculableClosed.filter(r => r.pnl < 0).length;
      const closedNeutral = calculableClosed.filter(r => Math.abs(r.pnl) < 0.01).length;

      // Compute per-cycle profit capture with quality classification
      let totalMfeUsd = 0;
      let totalGivebackUsd = 0;
      let mfeCount = 0;
      const perCycleCapture: number[] = [];
      let cyclesWithProfitCaptureData = 0;
      let cyclesWithoutProfitCaptureData = 0;

      for (let i = 0; i < closed.length; i++) {
        const c = closed[i];
        const pnlResult = closedPnlResults[i];
        const pnl = pnlResult.pnl;
        const mfePrice = nullableN(c.highest_price_after_tp);
        const avgEntry = nullableN(c.avg_entry_price);
        const capital = n(c.capital_used_usd);
        if (mfePrice != null && avgEntry != null && avgEntry > 0) {
          const qty = capital / avgEntry;
          const mfe = (mfePrice - avgEntry) * qty;
          const giveback = Math.max(mfe - pnl, 0);
          totalMfeUsd += mfe;
          totalGivebackUsd += giveback;
          mfeCount++;

          // Use quality classifier — IDCA highest_price_after_tp is NOT reliable snapshots
          const pcResult = classifyProfitCaptureQuality(mfe, pnl, false);
          if (pcResult.displayProfitCapturePct !== null && pcResult.profitCaptureQuality !== "insufficient_data") {
            perCycleCapture.push(pcResult.displayProfitCapturePct);
            cyclesWithProfitCaptureData++;
          } else {
            cyclesWithoutProfitCaptureData++;
          }
        } else {
          cyclesWithoutProfitCaptureData++;
        }
      }

      // avgProfitCapturePct only from reliable/estimated cycles (0-100 range)
      const avgProfitCapture = perCycleCapture.length > 0
        ? parseFloat((perCycleCapture.reduce((a, b) => a + b, 0) / perCycleCapture.length).toFixed(1))
        : null;
      const profitCaptureDataQuality: "complete" | "partial" | "none" =
        cyclesWithProfitCaptureData === 0 ? "none" :
        cyclesWithoutProfitCaptureData > 0 ? "partial" : "complete";

      // By close reason — use canonical PnL
      const reasonMap = new Map<string, number[]>();
      for (let i = 0; i < closed.length; i++) {
        const c = closed[i];
        const pnlResult = closedPnlResults[i];
        if (!pnlResult.calculable) continue;
        const r = c.close_reason ?? "unknown";
        const arr = reasonMap.get(r) ?? [];
        arr.push(pnlResult.pnl);
        reasonMap.set(r, arr);
      }
      const byCloseReason = Array.from(reasonMap.entries()).map(([reason, ps]) => ({
        reason, count: ps.length,
        totalPnlUsd: parseFloat(ps.reduce((a, b) => a + b, 0).toFixed(2)),
        winRate: parseFloat(((ps.filter(p => p > 0).length / ps.length) * 100).toFixed(1)),
      })).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      const alerts: string[] = [];
      if (totalRealizedPnl < 0 && closed.length > 5) {
        alerts.push(`PnL realizado total negativo (${fmtUsd(totalRealizedPnl)}). Revisar configuración TP y compras adicionales.`);
      }
      const beReason = byCloseReason.find(r => r.reason === "BREAK_EVEN");
      if (beReason && beReason.totalPnlUsd < 1) {
        alerts.push("Break Even activa pero captura casi sin beneficio. Ajustar trailing después de BE.");
      }
      if (cyclesWithoutProfitCaptureData > 0 && closed.length > 0) {
        alerts.push(`${cyclesWithoutProfitCaptureData} ciclo(s) sin datos suficientes de Profit Capture. La métrica media se calcula solo con ciclos con datos fiables/estimados.`);
      }

      res.json({
        success: true,
        data: {
          totalCycles: cycles.length,
          openCycles: open.length,
          closedCycles: closed.length,
          totalRealizedPnlUsd: parseFloat(totalRealizedPnl.toFixed(2)),
          totalUnrealizedPnlUsd: parseFloat(totalUnrealizedPnl.toFixed(2)),
          closedWins, closedLosses,
          closedWinRate: calculableClosed.length > 0 ? parseFloat(((closedWins / calculableClosed.length) * 100).toFixed(1)) : 0,
          totalMfeUsd: mfeCount > 0 ? parseFloat(totalMfeUsd.toFixed(2)) : null,
          totalGivebackUsd: mfeCount > 0 ? parseFloat(totalGivebackUsd.toFixed(2)) : null,
          avgProfitCapturePct: avgProfitCapture,
          cyclesWithProfitCaptureData,
          cyclesWithoutProfitCaptureData,
          profitCaptureDataQuality,
          byCloseReason, alerts,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/cycles?pair=&status=&limit=&offset=&since=
   * List IDCA cycles with derived efficiency metrics.
   */
  app.get("/api/audit/idca/cycles", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const rawStatus = req.query.status as string | undefined;
      // Normalize status: "open" is an alias for "active" in IDCA
      const status = rawStatus === "open" ? "active" : rawStatus;
      const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
      const offset = parseInt(req.query.offset as string || "0", 10);
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT * FROM institutional_dca_cycles
        WHERE 1=1
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${status ? sql`AND status = ${status}` : sql``}
          ${since ? sql`AND started_at >= ${since}::timestamptz` : sql``}
        ORDER BY started_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const cycles = [];
      for (const c of (rows.rows ?? []) as any[]) {
        const avgEntry = nullableN(c.avg_entry_price);
        const capital = n(c.capital_used_usd);
        const rawPnl = n(c.status === "closed" ? c.realized_pnl_usd : c.unrealized_pnl_usd);

        // Compute canonical PnL using shared helper (same as IDCA Historial)
        const { pnlResult } = await computeCanonicalIdcaPnl(c);
        const canonicalPnl = c.status === "closed"
          ? (isPnlCalculable(pnlResult.pnlSource) ? pnlResult.realizedNetUsd : rawPnl)
          : rawPnl;
        const pnl = canonicalPnl;

        const mfePrice = nullableN(c.highest_price_after_tp);
        const maePct = nullableN(c.max_drawdown_pct);

        const metrics = buildTradeEfficiencyMetrics({
          entryPrice: avgEntry ?? 0,
          quantity: avgEntry && avgEntry > 0 ? capital / avgEntry : 0,
          capitalUsd: capital, finalPnlUsd: pnl,
          mfePriceOverride: mfePrice,
          maePctOverride: maePct != null ? -maePct : null,
          hasReliableMfe: false, // IDCA highest_price_after_tp is a fallback, not snapshots
        });

        const durMin = durationMinutes(c.started_at, c.closed_at);

        // Check grid observer state
        const gridRows = await db.execute(sql`
          SELECT grid_state, natural_reason FROM idca_hybrid_state
          WHERE pair = ${c.pair} AND cycle_id = ${c.id}
          LIMIT 1
        `);
        const gridState = (gridRows.rows?.[0] as any)?.grid_state ?? null;

        const gridLegRow = await db.execute(sql`
          SELECT grid_plan_id FROM idca_grid_legs
          WHERE pair = ${c.pair} AND cycle_id = ${c.id}
          LIMIT 1
        `);
        const gridPlanId = (gridLegRow.rows?.[0] as any)?.grid_plan_id ?? null;

        const diagnostics = generateIdcaDiagnostics({
          buyCount: n(c.buy_count),
          closeReason: c.close_reason ?? null,
          profitCapturePct: metrics.displayProfitCapturePct,
          mfePnlUsd: metrics.mfePnlUsd,
          givebackUsd: metrics.givebackUsd,
          maePnlUsd: metrics.maePnlUsd,
          capitalUsd: capital,
          gridPlanCreated: gridPlanId != null,
          gridState,
          profitCaptureQuality: metrics.profitCaptureQuality,
        });

        cycles.push({
          id: c.id, pair: c.pair, status: c.status, mode: c.mode,
          buyCount: n(c.buy_count),
          capitalUsedUsd: capital,
          avgEntryPrice: avgEntry,
          tpTargetPrice: nullableN(c.tp_target_price),
          tpTargetPct: nullableN(c.tp_target_pct),
          closeReason: c.close_reason ?? null,
          startedAt: c.started_at, closedAt: c.closed_at ?? null,
          durationMinutes: durMin, durationLabel: formatDuration(durMin),
          finalPnlUsd: parseFloat(pnl.toFixed(2)),
          canonicalPnlUsd: parseFloat(pnlResult.realizedNetUsd.toFixed(2)),
          canonicalPnlPct: parseFloat(pnlResult.realizedPnlPct.toFixed(2)),
          pnlSource: pnlResult.pnlSource,
          pnlIsCalculable: isPnlCalculable(pnlResult.pnlSource),
          rawRealizedPnlUsd: parseFloat(rawPnl.toFixed(2)),
          rawRealizedPnlWarning: Math.abs(rawPnl - pnlResult.realizedNetUsd) > 0.50 ? "El valor bruto de DB no se usa porque parece valor de venta o dato importado contaminado." : null,
          auditRealizedNetUsd: pnlResult.auditRealizedNetUsd != null ? parseFloat(pnlResult.auditRealizedNetUsd.toFixed(2)) : null,
          pnlDiscrepancyUsd: pnlResult.pnlDiscrepancyUsd != null ? parseFloat(pnlResult.pnlDiscrepancyUsd.toFixed(2)) : null,
          beActive: c.tp_armed_at != null,
          trailingActive: c.trailing_active_at != null,
          gridPlanId, gridState,
          metrics, exitEfficiency: metrics.exitEfficiency,
          profitCaptureQuality: metrics.profitCaptureQuality,
          profitCaptureWarning: metrics.profitCaptureWarning,
          diagnostics,
        });
      }

      const countRow = await db.execute(sql`
        SELECT count(*) as c FROM institutional_dca_cycles
        WHERE 1=1
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${status ? sql`AND status = ${status}` : sql``}
          ${since ? sql`AND started_at >= ${since}::timestamptz` : sql``}
      `);
      const total = parseInt((countRow.rows?.[0] as any)?.c ?? "0", 10);

      res.json({ success: true, data: cycles, total, limit, offset });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/cycles/:id
   * Full detail for one IDCA cycle including orders + grid/MR + metrics + ChatGPT summary.
   */
  app.get("/api/audit/idca/cycles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const cycleRows = await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id = ${id}`);
      const cycle = (cycleRows.rows ?? [])[0] as any;
      if (!cycle) return res.status(404).json({ success: false, error: `Cycle #${id} not found` });

      const orderRows = await db.execute(sql`
        SELECT * FROM institutional_dca_orders WHERE cycle_id = ${id} ORDER BY executed_at ASC
      `);
      const orders = (orderRows.rows ?? []) as any[];

      const hybridRows = await db.execute(sql`
        SELECT * FROM idca_hybrid_state WHERE pair = ${cycle.pair} AND cycle_id = ${id} LIMIT 1
      `);
      const hybridState = (hybridRows.rows ?? [])[0] as any ?? null;

      const gridLegRows = await db.execute(sql`
        SELECT * FROM idca_grid_legs WHERE pair = ${cycle.pair} AND cycle_id = ${id} ORDER BY leg_index ASC
      `);
      const gridLegs = (gridLegRows.rows ?? []) as any[];

      const eventRows = await db.execute(sql`
        SELECT * FROM idca_hybrid_events
        WHERE pair = ${cycle.pair} AND cycle_id = ${id}
        ORDER BY ts DESC LIMIT 50
      `);
      const gridEvents = (eventRows.rows ?? []) as any[];

      const avgEntry = nullableN(cycle.avg_entry_price);
      const capital = n(cycle.capital_used_usd);
      const rawPnl = n(cycle.status === "closed" ? cycle.realized_pnl_usd : cycle.unrealized_pnl_usd);

      // Compute canonical PnL (same as IDCA Historial)
      const { pnlResult } = await computeCanonicalIdcaPnl(cycle);
      const canonicalPnl = cycle.status === "closed"
        ? (isPnlCalculable(pnlResult.pnlSource) ? pnlResult.realizedNetUsd : rawPnl)
        : rawPnl;
      const pnl = canonicalPnl;

      const mfePrice = nullableN(cycle.highest_price_after_tp);
      const maePct = nullableN(cycle.max_drawdown_pct);

      const metrics = buildTradeEfficiencyMetrics({
        entryPrice: avgEntry ?? 0,
        quantity: avgEntry && avgEntry > 0 ? capital / avgEntry : 0,
        capitalUsd: capital, finalPnlUsd: pnl,
        mfePriceOverride: mfePrice,
        maePctOverride: maePct != null ? -maePct : null,
        hasReliableMfe: false,
      });

      const diagnostics = generateIdcaDiagnostics({
        buyCount: n(cycle.buy_count),
        closeReason: cycle.close_reason ?? null,
        profitCapturePct: metrics.displayProfitCapturePct,
        mfePnlUsd: metrics.mfePnlUsd,
        givebackUsd: metrics.givebackUsd,
        maePnlUsd: metrics.maePnlUsd,
        capitalUsd: capital,
        gridPlanCreated: gridLegs.length > 0,
        gridState: hybridState?.grid_state ?? null,
        profitCaptureQuality: metrics.profitCaptureQuality,
      });

      const durMin = durationMinutes(cycle.started_at, cycle.closed_at);
      const gridPlanId = gridLegs[0]?.grid_plan_id ?? null;

      const chatgpt = generateIdcaChatGptSummary({
        id: cycle.id, pair: cycle.pair,
        startDate: new Date(cycle.started_at).toLocaleString("es-ES"),
        closeDate: cycle.closed_at ? new Date(cycle.closed_at).toLocaleString("es-ES") : null,
        buyCount: n(cycle.buy_count),
        capitalUsd: capital,
        avgEntryInitial: orders.find(o => o.buy_index === 0 || o.side === "buy")
          ? nullableN(orders.find(o => o.side === "buy")?.price) : null,
        avgEntryFinal: avgEntry,
        tpPrice: nullableN(cycle.tp_target_price),
        finalPnlUsd: pnl, metrics,
        pnlSource: pnlResult.pnlSource,
        beActive: cycle.tp_armed_at != null,
        trailingActive: cycle.trailing_active_at != null,
        gridPlanId, mrDecision: hybridState?.mean_reversion_state ?? null,
        mrRegime: hybridState?.regime ?? null,
        closeReason: cycle.close_reason ?? null,
        durationMinutes: durMin, diagnostics,
      });

      res.json({
        success: true, data: {
          cycle, orders,
          hybridState, gridLegs, gridEvents,
          metrics, diagnostics, durationLabel: formatDuration(durMin),
          chatgptSummary: chatgpt,
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/cycles/:id/timeline
   * Timeline events for a cycle (from audit_timeline_events if available, or derived from orders).
   */
  app.get("/api/audit/idca/cycles/:id/timeline", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      // Try audit_timeline_events first, fall back to deriving from orders
      const timelineRows = await db.execute(sql`
        SELECT * FROM audit_timeline_events
        WHERE entity_type = 'idca_cycle' AND entity_id = ${id}
        ORDER BY ts ASC
        LIMIT 200
      `).catch(() => ({ rows: [] }));

      let events: any[] = timelineRows.rows ?? [];

      // If no dedicated timeline events, derive from orders
      if (events.length === 0) {
        const orderRows = await db.execute(sql`
          SELECT o.*, c.pair FROM institutional_dca_orders o
          JOIN institutional_dca_cycles c ON c.id = o.cycle_id
          WHERE o.cycle_id = ${id}
          ORDER BY o.executed_at ASC
        `);
        events = (orderRows.rows ?? []).map((o: any) => ({
          ts: o.executed_at,
          event_type: o.side === "buy" ? (o.buy_index === 0 ? "ENTRY" : "ADDITIONAL_BUY") : "SELL",
          description: `${o.side === "buy" ? "Compra" : "Venta"} ${o.order_type ?? ""} @ $${parseFloat(o.price).toFixed(4)} × ${parseFloat(o.quantity).toFixed(6)}`,
          price: o.price,
          pnl_usd: null,
        }));

        // Add hybrid events
        const hybridEvRows = await db.execute(sql`
          SELECT ts, event_type, natural_reason, price, expected_pnl_usd
          FROM idca_hybrid_events WHERE cycle_id = ${id}
          ORDER BY ts ASC LIMIT 50
        `).catch(() => ({ rows: [] }));

        for (const ev of (hybridEvRows.rows ?? []) as any[]) {
          events.push({
            ts: ev.ts,
            event_type: ev.event_type,
            description: ev.natural_reason,
            price: ev.price,
            pnl_usd: ev.expected_pnl_usd,
          });
        }
        events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      }

      res.json({ success: true, data: events });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/cycles/:id/grid-mean-reversion
   * Grid observer and mean reversion state for a cycle.
   */
  app.get("/api/audit/idca/cycles/:id/grid-mean-reversion", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      const cycleRow = await db.execute(sql`SELECT pair FROM institutional_dca_cycles WHERE id = ${id}`);
      const pair = (cycleRow.rows?.[0] as any)?.pair;
      if (!pair) return res.status(404).json({ success: false, error: "Cycle not found" });

      const [hybridRows, legRows, eventRows] = await Promise.all([
        db.execute(sql`SELECT * FROM idca_hybrid_state WHERE pair = ${pair} AND cycle_id = ${id} LIMIT 1`),
        db.execute(sql`SELECT * FROM idca_grid_legs WHERE pair = ${pair} AND cycle_id = ${id} ORDER BY leg_index`),
        db.execute(sql`SELECT * FROM idca_hybrid_events WHERE pair = ${pair} AND cycle_id = ${id} ORDER BY ts DESC LIMIT 30`),
      ]);

      const hs = (hybridRows.rows?.[0] as any) ?? null;
      const legs = (legRows.rows ?? []) as any[];
      const events = (eventRows.rows ?? []) as any[];

      const buyLegs = legs.filter(l => l.leg_role === "buy_entry" || l.side === "buy");
      const sellLegs = legs.filter(l => l.leg_role === "sell_tp" || l.side === "sell");
      const capitalGrid = buyLegs.reduce((sum, l) => sum + n(l.planned_notional_usd), 0);
      const pnlSimulated = buyLegs.reduce((sum, l) => sum + n(l.expected_net_profit_usd), 0);

      res.json({
        success: true, data: {
          hybridMode: hs?.mode ?? "unknown",
          gridState: hs?.grid_state ?? null,
          observerOnly: legs.length > 0 ? Boolean(legs[0].observer_only) : true,
          mrState: hs?.mean_reversion_state ?? null,
          regime: hs?.regime ?? null,
          naturalReason: hs?.natural_reason ?? null,
          lastPrice: hs?.last_price ?? null,
          vwap: hs?.vwap ?? null,
          zScore: hs?.z_score ?? null,
          atrPct: hs?.atr_pct ?? null,
          gridPlanId: legs[0]?.grid_plan_id ?? null,
          buyLevelsCount: buyLegs.length,
          tpLegsCount: sellLegs.length,
          capitalGridUsd: parseFloat(capitalGrid.toFixed(2)),
          pnlSimulatedUsd: parseFloat(pnlSimulated.toFixed(2)),
          levelsTriggered: buyLegs.filter(l => l.status === "triggered" || l.status === "closed").length,
          levelsClosed: buyLegs.filter(l => l.status === "closed").length,
          legs, events,
          diagnosis: hs?.grid_state === "GRID_PLAN_SIMULATED"
            ? "Grid Observer simulado. No se han ejecutado órdenes reales."
            : hs?.grid_state?.startsWith("GRID_BLOCKED")
              ? `Grid bloqueado: ${hs.natural_reason ?? hs.grid_state}`
              : "Grid no activo para este ciclo.",
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/chatgpt-summary?pair=&since=
   * Copyable IDCA summary text.
   */
  app.get("/api/audit/idca/chatgpt-summary", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT id, pair, status, capital_used_usd, realized_pnl_usd, unrealized_pnl_usd,
               buy_count, close_reason, started_at, closed_at, total_quantity,
               avg_entry_price, is_imported, is_manual_cycle, source_type, managed_by,
               base_price, base_price_type, import_snapshot_json
        FROM institutional_dca_cycles
        WHERE 1=1
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND started_at >= ${since}::timestamptz` : sql``}
        ORDER BY started_at DESC LIMIT 200
      `);

      const cycles = (rows.rows ?? []) as any[];
      const closed = cycles.filter(c => c.status === "closed");
      const open = cycles.filter(c => c.status !== "closed");

      // Compute canonical PnL for closed cycles
      const closedCanonical: { cycle: any; pnl: number; source: string; calculable: boolean }[] = [];
      for (const c of closed) {
        const { pnlResult } = await computeCanonicalIdcaPnl(c);
        closedCanonical.push({
          cycle: c,
          pnl: pnlResult.realizedNetUsd,
          source: pnlResult.pnlSource,
          calculable: isPnlCalculable(pnlResult.pnlSource),
        });
      }

      const calculableClosed = closedCanonical.filter(r => r.calculable);
      const totalPnl = calculableClosed.reduce((a, r) => a + r.pnl, 0);
      const openPnl = open.reduce((a, c) => a + n(c.unrealized_pnl_usd), 0);

      const lines = [
        `AUDITORÍA IDCA`,
        pair ? `Par: ${pair}` : "Todos los pares",
        since ? `Desde: ${since}` : "Todo el historial",
        `───────────────────────────────────`,
        `Ciclos totales: ${cycles.length} (${open.length} abiertos · ${closed.length} cerrados)`,
        `PnL realizado (cerrados): ${fmtUsd(totalPnl)}`,
        `PnL flotante (abiertos): ${fmtUsd(openPnl)}`,
        `Win Rate ciclos cerrados: ${calculableClosed.length > 0 ? ((calculableClosed.filter(r => r.pnl > 0).length / calculableClosed.length * 100).toFixed(0)) : "N/A"}%`,
        `───────────────────────────────────`,
        `Por motivo de cierre:`,
        ...Array.from(new Map<string, number[]>(
          closedCanonical.filter(r => r.calculable).reduce((map, r) => {
            const reason = r.cycle.close_reason ?? "unknown";
            if (!map.has(reason)) map.set(reason, []);
            map.get(reason)!.push(r.pnl);
            return map;
          }, new Map<string, number[]>())
        ).entries()).map(([r, ps]) => {
          const t = ps.reduce((a, b) => a + b, 0);
          const w = ps.filter(p => p > 0).length;
          return `  ${r}: ${ps.length} ciclos · PnL ${fmtUsd(t)} · WR ${((w / ps.length) * 100).toFixed(0)}%`;
        }),
        `───────────────────────────────────`,
        `Generado: ${new Date().toLocaleString("es-ES")}`,
      ];

      res.json({ success: true, text: lines.join("\n") });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * GET /api/audit/idca/export?format=csv|json&pair=&since=
   */
  app.get("/api/audit/idca/export", async (req, res) => {
    try {
      const format = (req.query.format as string) || "json";
      const pair = req.query.pair as string | undefined;
      const since = req.query.since as string | undefined;

      const rows = await db.execute(sql`
        SELECT id, pair, status, mode, buy_count, capital_used_usd,
               realized_pnl_usd, unrealized_pnl_usd, avg_entry_price,
               tp_target_price, close_reason, started_at, closed_at, total_quantity,
               is_imported, is_manual_cycle, source_type, managed_by,
               base_price, base_price_type, import_snapshot_json
        FROM institutional_dca_cycles
        WHERE 1=1
          ${pair && pair !== "all" ? sql`AND pair = ${pair}` : sql``}
          ${since ? sql`AND started_at >= ${since}::timestamptz` : sql``}
        ORDER BY started_at DESC LIMIT 10000
      `);
      const rawData = (rows.rows ?? []) as any[];

      // Compute canonical PnL for each cycle
      const data: any[] = [];
      for (const r of rawData) {
        const { pnlResult } = await computeCanonicalIdcaPnl(r);
        const rawPnl = n(r.status === "closed" ? r.realized_pnl_usd : r.unrealized_pnl_usd);
        const canonicalPnl = r.status === "closed"
          ? (isPnlCalculable(pnlResult.pnlSource) ? pnlResult.realizedNetUsd : rawPnl)
          : rawPnl;
        data.push({
          ...r,
          canonical_pnl_usd: parseFloat(canonicalPnl.toFixed(2)),
          pnl_source: pnlResult.pnlSource,
          pnl_is_calculable: isPnlCalculable(pnlResult.pnlSource),
          raw_realized_pnl_usd: parseFloat(rawPnl.toFixed(2)),
        });
      }

      if (format === "csv") {
        const header = "id,pair,status,mode,buy_count,capital_usd,canonical_pnl,pnl_source,raw_realized_pnl,unrealized_pnl,avg_entry,tp_price,close_reason,started_at,closed_at";
        const csvRows = data.map(r =>
          [r.id, r.pair, r.status, r.mode, r.buy_count, r.capital_used_usd,
            r.canonical_pnl_usd, r.pnl_source, r.raw_realized_pnl_usd,
            r.unrealized_pnl_usd, r.avg_entry_price,
            r.tp_target_price, r.close_reason, r.started_at, r.closed_at].join(",")
        );
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="audit_idca_${Date.now()}.csv"`);
        return res.send([header, ...csvRows].join("\n"));
      }

      res.json({ success: true, data, total: data.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RETENTION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/audit/retention/status
   * Table sizes and row counts for all audit-related tables.
   */
  app.get("/api/audit/retention/status", async (_req, res) => {
    try {
      const tables = [
        "dry_run_trades", "institutional_dca_cycles", "institutional_dca_orders",
        "idca_hybrid_state", "idca_grid_legs", "idca_hybrid_events",
        "market_candles", "audit_trade_snapshots", "audit_timeline_events",
        "bot_events",
      ];

      const results: Record<string, any> = {};
      for (const table of tables) {
        try {
          const countRow = await db.execute(sql.raw(`SELECT count(*) AS c FROM ${table}`));
          const sizeRow = await db.execute(sql.raw(
            `SELECT pg_size_pretty(pg_total_relation_size('${table}')) AS size`
          ));
          results[table] = {
            rows: parseInt((countRow.rows?.[0] as any)?.c ?? "0", 10),
            size: (sizeRow.rows?.[0] as any)?.size ?? "—",
          };
        } catch {
          results[table] = { rows: null, size: "N/A (table missing)" };
        }
      }

      // Add bot_events breakdown (top event types by count)
      try {
        const breakdownRows = await db.execute(sql`
          SELECT type, level, count(*) AS c,
                 min(timestamp) AS oldest, max(timestamp) AS newest
          FROM bot_events
          GROUP BY type, level
          ORDER BY c DESC
          LIMIT 30
        `);
        const botEventsBreakdown = (breakdownRows.rows ?? []).map((r: any) => ({
          type: r.type,
          level: r.level,
          count: parseInt(r.c, 10),
          oldest: r.oldest,
          newest: r.newest,
          retentionTier: classifyEventRetention(r.type, r.level),
        }));
        results.bot_events_breakdown = botEventsBreakdown;

        // Count cleanable vs protected
        let cleanable = 0;
        let protected_ = 0;
        for (const b of botEventsBreakdown) {
          if (b.retentionTier === "permanent") protected_ += b.count;
          else cleanable += b.count;
        }
        results.bot_events_summary = {
          totalRows: results.bot_events?.rows ?? null,
          totalSize: results.bot_events?.size ?? "—",
          cleanableApprox: cleanable,
          protectedApprox: protected_,
          topTypes: botEventsBreakdown.slice(0, 10),
        };
      } catch { /* bot_events may not exist */ }

      res.json({ success: true, data: results });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * POST /api/audit/retention/preview-cleanup
   * Preview what would be deleted. Does NOT delete anything.
   */
  app.post("/api/audit/retention/preview-cleanup", async (req, res) => {
    try {
      const snapshotDays = parseInt(req.body?.snapshotRetentionDays ?? "365", 10);
      const timelineDays = parseInt(req.body?.timelineNonCriticalDays ?? "90", 10);

      const snapshotCount = await db.execute(sql`
        SELECT count(*) AS c FROM audit_trade_snapshots
        WHERE ts < NOW() - (${snapshotDays} || ' days')::interval
      `).catch(() => ({ rows: [{ c: 0 }] }));

      const timelineCount = await db.execute(sql`
        SELECT count(*) AS c FROM audit_timeline_events
        WHERE is_critical = false AND ts < NOW() - (${timelineDays} || ' days')::interval
      `).catch(() => ({ rows: [{ c: 0 }] }));

      const hybridEventCount = await db.execute(sql`
        SELECT count(*) AS c FROM idca_hybrid_events
        WHERE ts < NOW() - INTERVAL '90 days'
      `).catch(() => ({ rows: [{ c: 0 }] }));

      // bot_events preview — classify by tier and count candidates
      let botEventsPreview: Record<string, number> = {};
      let botEventsTotalCleanable = 0;
      try {
        const cleanable = getCleanableTypes();
        for (const tierInfo of cleanable.tiers) {
          if (tierInfo.types.length === 0) {
            // 30d tier: anything NOT in permanent or 12mo or 90d sets, INFO only
            const knownTypes = [
              ...Array.from(getCleanableTypes().types),
            ];
            // Build NOT IN list from known types + permanent types
            const allKnown = knownTypes;
            const notInList = allKnown.length > 0 ? buildSqlInList(allKnown) : "''";
            const r = await db.execute(sql.raw(`
              SELECT count(*) AS c FROM bot_events
              WHERE timestamp < NOW() - INTERVAL '30 days'
                AND level = 'INFO'
                AND type NOT IN (${notInList})
            `));
            const cnt = parseInt((r.rows?.[0] as any)?.c ?? "0", 10);
            botEventsPreview["30d_fallback"] = cnt;
            botEventsTotalCleanable += cnt;
          } else {
            const inList = buildSqlInList(tierInfo.types);
            const r = await db.execute(sql.raw(`
              SELECT count(*) AS c FROM bot_events
              WHERE timestamp < NOW() - INTERVAL '${tierInfo.days} days'
                AND level = 'INFO'
                AND type IN (${inList})
            `));
            const cnt = parseInt((r.rows?.[0] as any)?.c ?? "0", 10);
            botEventsPreview[tierInfo.tier] = cnt;
            botEventsTotalCleanable += cnt;
          }
        }
      } catch { /* bot_events may not exist */ }

      res.json({
        success: true,
        preview: true,
        wouldDelete: {
          audit_trade_snapshots: parseInt((snapshotCount.rows?.[0] as any)?.c ?? "0", 10),
          audit_timeline_events_noncritical: parseInt((timelineCount.rows?.[0] as any)?.c ?? "0", 10),
          idca_hybrid_events_old: parseInt((hybridEventCount.rows?.[0] as any)?.c ?? "0", 10),
          bot_events_by_tier: botEventsPreview,
          bot_events_total_cleanable: botEventsTotalCleanable,
        },
        neverDeletes: [
          "dry_run_trades (operaciones reales preservadas)",
          "institutional_dca_cycles (ciclos cerrados preservados)",
          "institutional_dca_orders (órdenes reales preservadas)",
          "fisco_* (datos fiscales preservados)",
          "audit_timeline_events con is_critical=true",
          "bot_events con level=ERROR o level=WARN (siempre permanentes)",
          "bot_events de tipo TRADE_EXECUTED, ORDER_FILLED, POSITION_CLOSED, CONFIG_UPDATED, etc.",
        ],
        params: { snapshotDays, timelineDays },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  /**
   * POST /api/audit/retention/run-cleanup
   * Execute safe cleanup. Never touches real trades, cycles, or fiscal data.
   */
  app.post("/api/audit/retention/run-cleanup", async (req, res) => {
    try {
      const snapshotDays = Math.max(parseInt(req.body?.snapshotRetentionDays ?? "365", 10), 90);
      const timelineDays = Math.max(parseInt(req.body?.timelineNonCriticalDays ?? "90", 10), 30);
      const target = req.body?.target as string | undefined; // "bot_events" | undefined (all)
      const confirmed = req.body?.confirm === true;

      // If targeting bot_events, require explicit confirm
      if (target === "bot_events" && !confirmed) {
        return res.status(400).json({
          success: false,
          error: "Confirmation required: set confirm=true to clean bot_events. Use preview-cleanup first.",
        });
      }

      let snapshotsDeleted = 0;
      let timelineDeleted = 0;
      let hybridEventsDeleted = 0;
      let botEventsDeleted = 0;
      const botEventsByTier: Record<string, number> = {};

      if (target !== "bot_events") {
        try {
          const r = await db.execute(sql`
            DELETE FROM audit_trade_snapshots
            WHERE ts < NOW() - (${snapshotDays} || ' days')::interval
            RETURNING id
          `);
          snapshotsDeleted = (r.rows ?? []).length;
        } catch { /* table may not exist yet */ }

        try {
          const r = await db.execute(sql`
            DELETE FROM audit_timeline_events
            WHERE is_critical = false AND ts < NOW() - (${timelineDays} || ' days')::interval
            RETURNING id
          `);
          timelineDeleted = (r.rows ?? []).length;
        } catch { /* table may not exist yet */ }

        try {
          const r = await db.execute(sql`
            DELETE FROM idca_hybrid_events WHERE ts < NOW() - INTERVAL '90 days'
            RETURNING id
          `);
          hybridEventsDeleted = (r.rows ?? []).length;
        } catch { /* table may not exist yet */ }
      }

      // bot_events cleanup — only if target includes bot_events (or no target = all)
      if (target === "bot_events" || !target) {
        try {
          const cleanable = getCleanableTypes();
          for (const tierInfo of cleanable.tiers) {
            if (tierInfo.types.length === 0) {
              // 30d fallback: INFO events not in any known set
              const allKnown = cleanable.types;
              const notInList = allKnown.length > 0 ? buildSqlInList(allKnown) : "''";
              const r = await db.execute(sql.raw(`
                DELETE FROM bot_events
                WHERE timestamp < NOW() - INTERVAL '30 days'
                  AND level = 'INFO'
                  AND type NOT IN (${notInList})
                RETURNING id
              `));
              const cnt = (r.rows ?? []).length;
              botEventsByTier["30d_fallback"] = cnt;
              botEventsDeleted += cnt;
            } else {
              const inList = buildSqlInList(tierInfo.types);
              const r = await db.execute(sql.raw(`
                DELETE FROM bot_events
                WHERE timestamp < NOW() - INTERVAL '${tierInfo.days} days'
                  AND level = 'INFO'
                  AND type IN (${inList})
                RETURNING id
              `));
              const cnt = (r.rows ?? []).length;
              botEventsByTier[tierInfo.tier] = cnt;
              botEventsDeleted += cnt;
            }
          }
        } catch (e: any) { /* bot_events may not exist */ }

        // Log cleanup to audit_timeline_events
        try {
          await db.execute(sql`
            INSERT INTO audit_timeline_events
              (entity_type, entity_id, pair, event_type, description, is_critical, raw_json)
            VALUES
              ('system', 0, 'SYSTEM', 'CLEANUP_BOT_EVENTS_RUN',
               ${`Cleaned ${botEventsDeleted} bot_events. Tiers: ${JSON.stringify(botEventsByTier)}`},
               true,
               ${JSON.stringify({ botEventsDeleted, botEventsByTier, target: target ?? "all", timestamp: new Date().toISOString() })}::jsonb)
          `);
        } catch { /* audit_timeline_events may not exist yet */ }
      }

      res.json({
        success: true,
        deleted: {
          snapshotsDeleted, timelineDeleted, hybridEventsDeleted,
          botEventsDeleted, botEventsByTier,
        },
        preserved: [
          "dry_run_trades", "institutional_dca_cycles", "institutional_dca_orders",
          "fisco_*", "bot_events ERROR/WARN (permanent)", "bot_events trades/orders/config (permanent)",
        ],
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });
}
