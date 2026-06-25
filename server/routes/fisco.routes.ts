import type { Express } from "express";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";
import type { RouterDeps } from "./types";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort, type NormalizedOperation } from "../services/fisco/normalizer";
import { runFifo, validateFifoResult } from "../services/fisco/fifo-engine";
import { getUsdToEurRate, getCachedUsdEurRate } from "../services/fisco/eur-rates";
import { fiscoRebuildService } from "../services/FiscoRebuildService";
import { isFiscoRebuildActive } from "../services/fisco/rebuild-state";
import { TransferMatchingService } from "../services/fisco/TransferMatchingService";
import { ConservativeDisposalService, type Classification } from "../services/fisco/ConservativeDisposalService";
import { FiscoValidationService } from "../services/fisco/FiscoValidationService";
import { KrakenReconciliationService } from "../services/fisco/KrakenReconciliationService";
import { MultiYearReportService } from "../services/fisco/MultiYearReportService";
import { FiscoExportService } from "../services/fisco/FiscoExportService";
import { FiscoHtmlRenderer } from "../services/fisco/FiscoHtmlRenderer";
import JSZip from "jszip";
import { pool } from "../db";
import { FiscoAutoSyncService } from "../services/fisco/FiscoAutoSyncService";
import { FiscoPendingDetector } from "../services/fisco/FiscoPendingDetector";
import { FiscoInventorySnapshotService } from "../services/fisco/FiscoInventorySnapshotService";
import { createImportPreview, confirmImport, getImportBatches, getImportBatch, type ImportOptions } from "../services/fisco/FiscoImportService";
import { getFiscoConfig, setFiscoConfig, getFinalizationStatus } from "../services/fisco/FiscoConfigService";
import { runComparison } from "../services/fisco/FiscoComparisonService";
import multer from "multer";

// Configure multer for memory storage (no disk writes)
const upload = multer({ storage: multer.memoryStorage() });

/**
 * FISCO (Fiscal Control) routes.
 * These endpoints pull data DIRECTLY from exchange APIs — never from the bot DB.
 * This ensures all operations (including manual trades outside the bot) are captured.
 */
export function registerFiscoRoutes(app: Express, deps: RouterDeps): void {

  // ============================================================
  // TEST ENDPOINT: Verify both exchange APIs return usable data
  // ============================================================
  app.get("/api/fisco/test-apis", async (req, res) => {
    const results: any = {
      timestamp: new Date().toISOString(),
      kraken: { trades: null, ledger: null, error: null },
      revolutx: { orders: null, error: null },
    };

    // --- KRAKEN: Trades History (first page only for test) ---
    try {
      if (!krakenService.isInitialized()) {
        results.kraken.error = "Kraken not initialized";
      } else {
        const tradesResp = await krakenService.getTradesHistory({ fetchAll: false });
        const trades = tradesResp?.trades || {};
        const tradeIds = Object.keys(trades);
        const sampleTrades = tradeIds.slice(0, 3).map(id => {
          const t = trades[id];
          return {
            id,
            pair: t.pair,
            type: t.type, // buy/sell
            price: t.price,
            vol: t.vol,
            cost: t.cost,
            fee: t.fee,
            time: t.time,
            time_iso: new Date(t.time * 1000).toISOString(),
            ordertxid: t.ordertxid,
          };
        });
        results.kraken.trades = {
          total_in_page: tradeIds.length,
          count: tradesResp?.count || tradeIds.length,
          sample: sampleTrades,
          fields_available: tradeIds.length > 0 ? Object.keys(trades[tradeIds[0]]) : [],
        };
      }
    } catch (e: any) {
      results.kraken.error = e.message;
    }

    // --- KRAKEN: Ledger (first page only for test) ---
    try {
      if (krakenService.isInitialized()) {
        const ledgerResp = await krakenService.getLedgers({ fetchAll: false });
        const ledger = ledgerResp?.ledger || {};
        const entryIds = Object.keys(ledger);
        const sampleEntries = entryIds.slice(0, 5).map(id => {
          const e = ledger[id];
          return {
            id,
            refid: e.refid,
            type: e.type,
            subtype: e.subtype,
            asset: e.asset,
            amount: e.amount,
            fee: e.fee,
            balance: e.balance,
            time: e.time,
            time_iso: new Date(e.time * 1000).toISOString(),
          };
        });

        // Count by type
        const typeCounts: Record<string, number> = {};
        for (const id of entryIds) {
          const type = ledger[id].type || 'unknown';
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        }

        results.kraken.ledger = {
          total_in_page: entryIds.length,
          count: ledgerResp?.count || entryIds.length,
          type_counts: typeCounts,
          sample: sampleEntries,
          fields_available: entryIds.length > 0 ? Object.keys(ledger[entryIds[0]]) : [],
        };
      }
    } catch (e: any) {
      results.kraken.ledger_error = e.message;
    }

    // --- REVOLUTX: Historical Orders (last 2 weeks for test) ---
    try {
      if (!revolutXService.isInitialized()) {
        results.revolutx.error = "RevolutX not initialized";
      } else {
        const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
        const { orders: revolutOrders } = await revolutXService.getHistoricalOrders({
          startMs: twoWeeksAgo,
          states: ['filled'],
        });
        const orders = revolutOrders;

        const sampleOrders = orders.slice(0, 5).map((o: any) => ({
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          filled_quantity: o.filled_quantity,
          average_fill_price: o.average_fill_price,
          status: o.status,
          created_date_iso: o.created_date ? new Date(o.created_date).toISOString() : null,
          filled_date_iso: o.filled_date ? new Date(o.filled_date).toISOString() : null,
        }));

        results.revolutx.orders = {
          total: orders.length,
          sample: sampleOrders,
          fields_available: orders.length > 0 ? Object.keys(orders[0]) : [],
          has_side: orders.length > 0 ? !!orders[0].side : 'no_data',
        };
      }
    } catch (e: any) {
      results.revolutx.error = e.message;
    }

    res.json(results);
  });

  // ============================================================
  // FULL FETCH: Get ALL trades/orders from an exchange
  // Use ?exchange=kraken or ?exchange=revolutx
  // WARNING: Can take minutes for large histories
  // ============================================================
  app.get("/api/fisco/fetch-all", async (req, res) => {
    const exchange = (req.query.exchange as string || '').toLowerCase();

    if (exchange === 'kraken') {
      try {
        if (!krakenService.isInitialized()) {
          return res.status(503).json({ error: "Kraken not initialized" });
        }

        console.log("[fisco] Starting full Kraken fetch (trades then ledger, sequential to avoid rate limit)...");
        const startTime = Date.now();

        // SEQUENTIAL — Kraken has strict rate limits (15 calls/min for private endpoints)
        // Running trades + ledger in parallel doubles the call rate and triggers EAPI:Rate limit exceeded
        const tradesResp = await krakenService.getTradesHistory({ fetchAll: true });
        const ledgerResp = await krakenService.getLedgers({ fetchAll: true });

        const trades = tradesResp?.trades || {};
        const ledger = ledgerResp?.ledger || {};
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Summarize trades
        const tradesList = Object.entries(trades).map(([id, t]: [string, any]) => ({
          id,
          pair: t.pair,
          type: t.type,
          price: parseFloat(t.price),
          vol: parseFloat(t.vol),
          cost: parseFloat(t.cost),
          fee: parseFloat(t.fee),
          time: t.time,
          time_iso: new Date(t.time * 1000).toISOString(),
          ordertxid: t.ordertxid,
        }));

        // Summarize ledger by type
        const ledgerTypeCounts: Record<string, number> = {};
        const ledgerList = Object.entries(ledger).map(([id, e]: [string, any]) => {
          const type = e.type || 'unknown';
          ledgerTypeCounts[type] = (ledgerTypeCounts[type] || 0) + 1;
          return {
            id,
            refid: e.refid,
            type: e.type,
            subtype: e.subtype,
            asset: krakenService.normalizeAsset(e.asset),
            asset_raw: e.asset,
            amount: e.amount,
            fee: e.fee,
            balance: e.balance,
            time: e.time,
            time_iso: new Date(e.time * 1000).toISOString(),
          };
        });

        // Sort by time
        tradesList.sort((a, b) => a.time - b.time);
        ledgerList.sort((a, b) => a.time - b.time);

        // Unique pairs
        const uniquePairs = [...new Set(tradesList.map(t => t.pair))];
        // Unique assets in ledger
        const uniqueAssets = [...new Set(ledgerList.map(l => l.asset))];

        res.json({
          exchange: 'kraken',
          elapsed_seconds: parseFloat(elapsed),
          trades: {
            count: tradesList.length,
            unique_pairs: uniquePairs,
            date_range: tradesList.length > 0 ? {
              from: tradesList[0].time_iso,
              to: tradesList[tradesList.length - 1].time_iso,
            } : null,
            data: tradesList,
          },
          ledger: {
            count: ledgerList.length,
            type_counts: ledgerTypeCounts,
            unique_assets: uniqueAssets,
            date_range: ledgerList.length > 0 ? {
              from: ledgerList[0].time_iso,
              to: ledgerList[ledgerList.length - 1].time_iso,
            } : null,
            data: ledgerList,
          },
        });
      } catch (e: any) {
        console.error("[fisco] Kraken fetch-all error:", e.message);
        res.status(500).json({ error: e.message });
      }

    } else if (exchange === 'revolutx') {
      try {
        if (!revolutXService.isInitialized()) {
          return res.status(503).json({ error: "RevolutX not initialized" });
        }

        // Support ?start=2025-01-01 query param (ISO date string)
        const startParam = req.query.start as string | undefined;
        const startMs = startParam ? new Date(startParam).getTime() : undefined;

        console.log(`[fisco] Starting full RevolutX fetch (historical orders)${startMs ? ` from ${startParam}` : ''}...`);
        const startTime = Date.now();

        const revolutResult = await revolutXService.getHistoricalOrders({
          startMs,
          states: ['filled'],
        });
        const orders = revolutResult.orders;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Sort by created_date
        orders.sort((a, b) => a.created_date - b.created_date);

        // Unique symbols
        const uniqueSymbols = [...new Set(orders.map(o => o.symbol))];

        // Count by side
        const sideCounts = { buy: 0, sell: 0 };
        for (const o of orders) {
          if (o.side === 'buy') sideCounts.buy++;
          else if (o.side === 'sell') sideCounts.sell++;
        }

        res.json({
          exchange: 'revolutx',
          elapsed_seconds: parseFloat(elapsed),
          orders: {
            count: orders.length,
            unique_symbols: uniqueSymbols,
            side_counts: sideCounts,
            date_range: orders.length > 0 ? {
              from: new Date(orders[0].created_date).toISOString(),
              to: new Date(orders[orders.length - 1].created_date).toISOString(),
            } : null,
            data: orders.map(o => ({
              ...o,
              created_date_iso: o.created_date ? new Date(o.created_date).toISOString() : null,
              filled_date_iso: o.filled_date ? new Date(o.filled_date).toISOString() : null,
            })),
          },
        });
      } catch (e: any) {
        console.error("[fisco] RevolutX fetch-all error:", e.message);
        res.status(500).json({ error: e.message });
      }

    } else {
      res.status(400).json({
        error: "Missing or invalid 'exchange' query param. Use ?exchange=kraken or ?exchange=revolutx",
      });
    }
  });

  // ============================================================
  // KRAKEN-ONLY SYNC: usado por FiscoKrakenRetryWorker
  // Sincroniza solo Kraken (ledger → normalize → insert)
  // ============================================================
  app.get("/api/fisco/run-kraken", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(503).json({ status: "error", errorCode: "NOT_INITIALIZED", message: "Kraken not initialized" });
      }

      console.log("[fisco/run-kraken] Starting Kraken-only fiscal sync...");
      const t0 = Date.now();

      const usdEurRate = await getUsdToEurRate();
      let krakenLedgerEntries: any[] = [];

      try {
        const ledgerResp = await krakenService.getLedgers({ fetchAll: true });
        const ledger = ledgerResp?.ledger || {};
        krakenLedgerEntries = Object.entries(ledger).map(([id, e]: [string, any]) => ({
          id, refid: e.refid, type: e.type, subtype: e.subtype, asset: e.asset,
          amount: typeof e.amount === "string" ? parseFloat(e.amount) : e.amount,
          fee: typeof e.fee === "string" ? parseFloat(e.fee) : e.fee,
          balance: typeof e.balance === "string" ? parseFloat(e.balance) : e.balance,
          time: e.time,
        }));
      } catch (err: any) {
        const isRateLimit = err.message?.includes("EAPI:Rate limit") || err.message?.includes("Rate limit exceed");
        const errorCode = isRateLimit ? "RATE_LIMIT" : "SYNC_ERROR";
        console.error(`[fisco/run-kraken] Kraken fetch failed (${errorCode}): ${err.message}`);
        return res.status(isRateLimit ? 429 : 500).json({ status: "error", errorCode, message: err.message });
      }

      const krakenOps = await normalizeKrakenLedger(krakenLedgerEntries);

      let inserted = 0;
      for (const op of krakenOps) {
        try {
          await pool.query(
            `INSERT INTO fisco_operations (exchange, external_id, op_type, asset, amount, price_eur, total_eur, fee_eur, counter_asset, pair, executed_at, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (exchange, external_id) DO NOTHING`,
            ['kraken', op.externalId, op.opType, op.asset, op.amount.toString(),
             op.priceEur?.toString() ?? null, op.totalEur?.toString() ?? null,
             op.feeEur?.toString() || '0', op.counterAsset ?? null, op.pair ?? null,
             op.executedAt, JSON.stringify(op.rawData ?? {})]
          );
          inserted++;
        } catch {}
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[fisco/run-kraken] Done in ${elapsed}s — ${inserted} ops upserted`);

      res.json({
        status: "ok",
        elapsed_seconds: parseFloat(elapsed),
        usd_eur_rate: usdEurRate,
        raw_kraken_entries: krakenLedgerEntries.length,
        normalized: krakenOps.length,
        inserted,
      });
    } catch (err: any) {
      console.error("[fisco/run-kraken] Unexpected error:", err.message);
      res.status(500).json({ status: "error", errorCode: "UNEXPECTED", message: err.message });
    }
  });

  // ============================================================
  // FULL PIPELINE: Fetch → Normalize → FIFO → Summary
  // Single endpoint that does everything. Can take several minutes.
  // Optional: ?year=2026 to filter summary by year
  // ============================================================
  app.get("/api/fisco/run", async (req, res) => {
    try {
      const yearFilter = req.query.year ? parseInt(req.query.year as string) : undefined;
      const startParam = req.query.start as string | undefined;
      const startMs = startParam ? new Date(startParam).getTime() : undefined;

      console.log("[fisco/run] Starting full fiscal pipeline...");
      const t0 = Date.now();

      // 1. Fetch EUR rate
      const usdEurRate = await getUsdToEurRate();
      console.log(`[fisco/run] USD/EUR rate: ${usdEurRate.toFixed(6)}`);

      // 2. Fetch raw data from both exchanges (sequential for rate limits)
      let krakenLedgerEntries: any[] = [];
      let revolutxOrders: any[] = [];

      const exchangeErrors: Array<{ exchange: string; errorCode: string; message: string }> = [];

      if (krakenService.isInitialized()) {
        console.log("[fisco/run] Fetching Kraken ledger (FULL HISTORY)...");
        try {
          const ledgerResp = await krakenService.getLedgers({ fetchAll: true });
          const ledger = ledgerResp?.ledger || {};
          krakenLedgerEntries = Object.entries(ledger).map(([id, e]: [string, any]) => ({
            id,
            refid: e.refid,
            type: e.type,
            subtype: e.subtype,
            asset: e.asset,
            amount: typeof e.amount === "string" ? parseFloat(e.amount) : e.amount,
            fee: typeof e.fee === "string" ? parseFloat(e.fee) : e.fee,
            balance: typeof e.balance === "string" ? parseFloat(e.balance) : e.balance,
            time: e.time,
          }));
          console.log(`[fisco/run] Kraken: ${krakenLedgerEntries.length} ledger entries`);
        } catch (krakenErr: any) {
          const isRateLimit = krakenErr.message?.includes("EAPI:Rate limit") || krakenErr.message?.includes("Rate limit exceed");
          const errorCode = isRateLimit ? "RATE_LIMIT" : "SYNC_ERROR";
          console.error(`[fisco/run] Kraken fetch failed (${errorCode}): ${krakenErr.message}`);
          exchangeErrors.push({ exchange: "Kraken", errorCode, message: krakenErr.message });
        }
      }

      if (revolutXService.isInitialized()) {
        console.log("[fisco/run] Fetching RevolutX orders (FULL HISTORY)...");
        try {
          const revolutResult = await revolutXService.getHistoricalOrders({ states: ["filled"] });
          revolutxOrders = revolutResult.orders;
          console.log(`[fisco/run] RevolutX: ${revolutxOrders.length} orders`);
        } catch (revxErr: any) {
          console.error(`[fisco/run] RevolutX fetch failed: ${revxErr.message}`);
          exchangeErrors.push({ exchange: "RevolutX", errorCode: "SYNC_ERROR", message: revxErr.message });
        }
      }

      // Abortar si algún exchange configurado falló — evita borrar datos existentes del otro exchange
      if (exchangeErrors.length > 0) {
        console.error(`[fisco/run] Aborting pipeline: ${exchangeErrors.map(e => e.exchange + ': ' + e.errorCode).join(', ')}. Existing DB data preserved.`);
        return res.status(207).json({
          status: "partial_error",
          message: `No se guardaron datos porque hubo errores en: ${exchangeErrors.map(e => e.exchange).join(', ')}. Los datos existentes se han preservado. Corrija el error y vuelva a sincronizar.`,
          exchange_errors: exchangeErrors,
          kraken_entries_fetched: krakenLedgerEntries.length,
          revolutx_orders_fetched: revolutxOrders.length,
        });
      }

      // 3. Normalize
      console.log("[fisco/run] Normalizing...");
      const krakenOps = await normalizeKrakenLedger(krakenLedgerEntries);
      const revxOps = await normalizeRevolutXOrders(revolutxOrders);
      const allOps = mergeAndSort(krakenOps, revxOps);
      console.log(`[fisco/run] Normalized: ${allOps.length} operations (${krakenOps.length} Kraken + ${revxOps.length} RevolutX)`);

      // 4. Run FIFO + post-validation
      console.log("[fisco/run] Running FIFO engine...");
      const fifo = runFifo(allOps);
      const postValidationErrors = validateFifoResult(fifo);
      fifo.criticalErrors.push(...postValidationErrors.filter(e =>
        !fifo.criticalErrors.some(x => x.code === e.code && x.externalId === e.externalId)
      ));
      fifo.isSafeForReport = fifo.criticalErrors.length === 0;
      console.log(`[fisco/run] FIFO: ${fifo.lots.length} lots, ${fifo.disposals.length} disposals, ${fifo.warnings.length} warnings, ${fifo.criticalErrors.length} critical errors, safe=${fifo.isSafeForReport}`);

      // 4b. BLOCK if critical errors — never overwrite official data with invalid FIFO results
      if (!fifo.isSafeForReport) {
        console.error(`[fisco/run] BLOCKED: ${fifo.criticalErrors.length} critical errors detected. Official data NOT modified.`);
        return res.status(422).json({
          status: "blocked",
          message: `Pipeline bloqueado: ${fifo.criticalErrors.length} errores críticos. Los datos oficiales NO han sido modificados. Corrija los errores y vuelva a ejecutar.`,
          critical_errors: fifo.criticalErrors,
          is_safe_for_report: false,
          fifo_stats: {
            lots: fifo.lots.length,
            disposals: fifo.disposals.length,
            warnings: fifo.warnings.length,
          },
        });
      }

      // 5. Save to DB — only reached when isSafeForReport=true
      console.log("[fisco/run] Saving to database...");
      await saveFiscoToDB(allOps, fifo);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[fisco/run] Pipeline complete in ${elapsed}s`);

      // 6. Build response
      const yearSummary = yearFilter
        ? fifo.yearSummary.filter(s => s.year === yearFilter)
        : fifo.yearSummary;

      // Operations summary by type
      const opTypeCounts: Record<string, number> = {};
      for (const op of allOps) {
        opTypeCounts[op.opType] = (opTypeCounts[op.opType] || 0) + 1;
      }

      // Total P&L
      const totalGainLoss = fifo.disposals.reduce((sum, d) => sum + d.gainLossEur, 0);

      const httpStatus = exchangeErrors.length > 0 ? 207 : 200;
      res.status(httpStatus).json({
        status: exchangeErrors.length > 0 ? "partial_success" : "ok",
        is_safe_for_report: fifo.isSafeForReport,
        critical_errors_count: fifo.criticalErrors.length,
        exchange_errors: exchangeErrors.length > 0 ? exchangeErrors : undefined,
        elapsed_seconds: parseFloat(elapsed),
        usd_eur_rate: usdEurRate,
        raw_counts: {
          kraken_ledger: krakenLedgerEntries.length,
          revolutx_orders: revolutxOrders.length,
        },
        normalized: {
          total: allOps.length,
          by_type: opTypeCounts,
          by_exchange: {
            kraken: krakenOps.length,
            revolutx: revxOps.length,
          },
          date_range: allOps.length > 0 ? {
            from: allOps[0].executedAt.toISOString(),
            to: allOps[allOps.length - 1].executedAt.toISOString(),
          } : null,
        },
        fifo: {
          total_lots: fifo.lots.length,
          open_lots: fifo.lots.filter(l => !l.isClosed).length,
          closed_lots: fifo.lots.filter(l => l.isClosed).length,
          total_disposals: fifo.disposals.length,
          total_gain_loss_eur: Math.round(totalGainLoss * 100) / 100,
          warnings: fifo.warnings,
        },
        asset_summary: fifo.summary.map(s => ({
          ...s,
          totalCostEur: Math.round(s.totalCostEur * 100) / 100,
          totalProceedsEur: Math.round(s.totalProceedsEur * 100) / 100,
          totalGainLossEur: Math.round(s.totalGainLossEur * 100) / 100,
          totalFeesEur: Math.round(s.totalFeesEur * 100) / 100,
        })),
        year_summary: yearSummary.map(s => ({
          ...s,
          costBasisEur: Math.round(s.costBasisEur * 100) / 100,
          proceedsEur: Math.round(s.proceedsEur * 100) / 100,
          gainLossEur: Math.round(s.gainLossEur * 100) / 100,
          feesEur: Math.round(s.feesEur * 100) / 100,
        })),
      });
    } catch (e: any) {
      console.error("[fisco/run] Pipeline error:", e);
      res.status(500).json({ error: e.message, stack: e.stack?.split("\n").slice(0, 5) });
    }
  });

  // ============================================================
  // GET saved operations from DB (fast, no API calls)
  // ============================================================
  app.get("/api/fisco/operations", async (req, res) => {
    try {
      const yearFilter = req.query.year ? parseInt(req.query.year as string) : undefined;
      const assetFilter = req.query.asset as string | undefined;
      const typeFilter = req.query.type as string | undefined;
      const exchangeFilter = req.query.exchange as string | undefined;
      const fromFilter = req.query.from as string | undefined;
      const toFilter = req.query.to as string | undefined;

      let query = `SELECT * FROM fisco_operations WHERE 1=1`;
      const params: any[] = [];
      let paramIdx = 1;

      if (yearFilter) {
        query += ` AND EXTRACT(YEAR FROM executed_at) = $${paramIdx++}`;
        params.push(yearFilter);
      }
      if (assetFilter) {
        query += ` AND asset = $${paramIdx++}`;
        params.push(assetFilter.toUpperCase());
      }
      if (typeFilter) {
        query += ` AND op_type = $${paramIdx++}`;
        params.push(typeFilter);
      }
      if (exchangeFilter) {
        query += ` AND exchange = $${paramIdx++}`;
        params.push(exchangeFilter.toLowerCase());
      }
      if (fromFilter) {
        query += ` AND executed_at >= $${paramIdx++}`;
        params.push(new Date(fromFilter));
      }
      if (toFilter) {
        query += ` AND executed_at <= $${paramIdx++}`;
        params.push(new Date(toFilter + 'T23:59:59.999Z'));
      }
      query += ` ORDER BY executed_at DESC`;

      const result = await pool.query(query, params);

      // Extract unique assets & exchanges for filter dropdowns
      const uniqueAssets = [...new Set(result.rows.map((r: any) => r.asset))].sort();
      const uniqueExchanges = [...new Set(result.rows.map((r: any) => r.exchange))].sort();

      res.json({
        count: result.rows.length,
        unique_assets: uniqueAssets,
        unique_exchanges: uniqueExchanges,
        operations: result.rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET filter metadata (assets, exchanges, date range) — lightweight
  // ============================================================
  app.get("/api/fisco/meta", async (req, res) => {
    try {
      const assetsQ = await pool.query(`SELECT DISTINCT asset FROM fisco_operations ORDER BY asset`);
      const exchangesQ = await pool.query(`SELECT DISTINCT exchange FROM fisco_operations ORDER BY exchange`);
      const rangeQ = await pool.query(`SELECT MIN(executed_at) as min_date, MAX(executed_at) as max_date FROM fisco_operations`);
      const yearsQ = await pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM executed_at)::int as year FROM fisco_operations ORDER BY year DESC`);

      res.json({
        assets: assetsQ.rows.map((r: any) => r.asset),
        exchanges: exchangesQ.rows.map((r: any) => r.exchange),
        years: yearsQ.rows.map((r: any) => r.year),
        date_range: rangeQ.rows[0] ? {
          from: rangeQ.rows[0].min_date,
          to: rangeQ.rows[0].max_date,
        } : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET FIFO lots from DB
  // ============================================================
  app.get("/api/fisco/lots", async (req, res) => {
    try {
      const assetFilter = req.query.asset as string | undefined;
      const exchangeFilter = req.query.exchange as string | undefined;
      const openOnly = req.query.open === "true";

      let query = `SELECT l.*, o.exchange FROM fisco_lots l JOIN fisco_operations o ON o.id = l.operation_id WHERE 1=1`;
      const params: any[] = [];
      let paramIdx = 1;

      if (assetFilter) {
        query += ` AND l.asset = $${paramIdx++}`;
        params.push(assetFilter.toUpperCase());
      }
      if (exchangeFilter) {
        query += ` AND o.exchange = $${paramIdx++}`;
        params.push(exchangeFilter.toLowerCase());
      }
      if (openOnly) {
        query += ` AND NOT l.is_closed`;
      }
      query += ` ORDER BY l.acquired_at ASC`;

      const result = await pool.query(query, params);
      res.json({
        count: result.rows.length,
        lots: result.rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET disposals / gain-loss from DB
  // ============================================================
  app.get("/api/fisco/disposals", async (req, res) => {
    try {
      const yearFilter = req.query.year ? parseInt(req.query.year as string) : undefined;

      let query = `SELECT d.*, o.asset, o.pair, o.exchange 
                   FROM fisco_disposals d
                   JOIN fisco_operations o ON o.id = d.sell_operation_id
                   WHERE 1=1`;
      const params: any[] = [];
      let paramIdx = 1;

      if (yearFilter) {
        query += ` AND EXTRACT(YEAR FROM d.disposed_at) = $${paramIdx++}`;
        params.push(yearFilter);
      }
      const assetFilter = req.query.asset as string | undefined;
      if (assetFilter) {
        query += ` AND o.asset = $${paramIdx++}`;
        params.push(assetFilter.toUpperCase());
      }
      query += ` ORDER BY d.disposed_at ASC`;

      const result = await pool.query(query, params);

      const totalGainLoss = result.rows.reduce(
        (sum: number, r: any) => sum + parseFloat(r.gain_loss_eur || "0"), 0
      );

      res.json({
        count: result.rows.length,
        total_gain_loss_eur: Math.round(totalGainLoss * 100) / 100,
        disposals: result.rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ANNUAL REPORT: Bit2Me-style comprehensive fiscal report
  // Single endpoint returns all 4 sections for a given year
  // ============================================================
  app.get("/api/fisco/annual-report", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const exchangeFilter = req.query.exchange as string | undefined;

      const exchWhere = exchangeFilter ? ` AND o.exchange = '${exchangeFilter.toLowerCase()}'` : '';
      const exchWhereOps = exchangeFilter ? ` AND exchange = '${exchangeFilter.toLowerCase()}'` : '';

      // --- Latest committed run context (for report validation banner) ---
      const committedRunQ = await pool.query(
        `SELECT id, status, is_safe_for_report, critical_errors_count,
                operations_count, lots_count, disposals_count, completed_at
         FROM fisco_rebuild_runs
         WHERE mode='commit' AND status='committed'
         ORDER BY is_safe_for_report DESC, started_at DESC LIMIT 1`
      );
      const committedRunRow = committedRunQ.rows[0] ?? null;
      const committedRun = committedRunRow ? {
        runId: committedRunRow.id,
        status: committedRunRow.status,
        isSafeForReport: committedRunRow.is_safe_for_report,
        criticalErrorsCount: committedRunRow.critical_errors_count ?? 0,
        operationsCount: committedRunRow.operations_count ?? 0,
        lotsCount: committedRunRow.lots_count ?? 0,
        disposalsCount: committedRunRow.disposals_count ?? 0,
        completedAt: committedRunRow.completed_at ?? null,
      } : null;

      // --- Section A: Resumen de ganancias y pérdidas derivadas de transmisiones ---
      // Query 1: FIFO ordinary disposals (from fisco_disposals)
      const gainsQ = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) as ganancias,
          COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric < 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) as perdidas,
          COALESCE(SUM(d.gain_loss_eur::numeric), 0) as total
        FROM fisco_disposals d
        JOIN fisco_operations o ON o.id = d.sell_operation_id
        WHERE EXTRACT(YEAR FROM d.disposed_at) = $1 ${exchWhere}
      `, [year]);

      // Query 2: Conservative external disposals (from fisco_external_statement_items)
      // These are NOT in fisco_disposals (lots not touched), so we aggregate them separately.
      const conservQ = await pool.query(`
        SELECT
          COUNT(*)                             AS count,
          COALESCE(SUM(gain_loss_eur::numeric), 0) AS total_gain_loss,
          COALESCE(SUM(CASE WHEN gain_loss_eur::numeric > 0 THEN gain_loss_eur::numeric ELSE 0 END), 0) AS ganancias,
          COALESCE(SUM(CASE WHEN gain_loss_eur::numeric < 0 THEN gain_loss_eur::numeric ELSE 0 END), 0) AS perdidas
        FROM fisco_external_statement_items
        WHERE year = $1
          AND classification = 'conservative_external_disposal'
          AND gain_loss_eur IS NOT NULL
      `, [year]);

      const fifoTotal        = Math.round((parseFloat(gainsQ.rows[0]?.total    || '0')) * 100) / 100;
      const conservGain      = Math.round((parseFloat(conservQ.rows[0]?.ganancias || '0')) * 100) / 100;
      const conservLoss      = Math.round((parseFloat(conservQ.rows[0]?.perdidas  || '0')) * 100) / 100;
      const conservTotal     = Math.round((parseFloat(conservQ.rows[0]?.total_gain_loss || '0')) * 100) / 100;
      const conservCount     = parseInt(conservQ.rows[0]?.count || '0', 10);
      const finalTotal       = Math.round((fifoTotal + conservTotal) * 100) / 100;

      const sectionA = {
        year,
        // FIFO-only fields (backward-compatible)
        ganancias_eur: Math.round((parseFloat(gainsQ.rows[0]?.ganancias || '0')) * 100) / 100,
        perdidas_eur:  Math.round((parseFloat(gainsQ.rows[0]?.perdidas  || '0')) * 100) / 100,
        total_eur:     fifoTotal,                         // FIFO only — kept for backward compat
        // Conservative disposal breakdown (new)
        ordinary_fifo_gain_loss_eur:                    fifoTotal,
        conservative_external_disposals_gain_loss_eur:  conservTotal,
        conservative_external_disposals_ganancias_eur:  conservGain,
        conservative_external_disposals_perdidas_eur:   conservLoss,
        conservative_disposals_count:                   conservCount,
        has_conservative_disposals:                     conservCount > 0,
        // Final total to declare (FIFO + conservative)
        final_taxable_gain_loss_eur:                    finalTotal,
      };

      // --- Section B: Resumen de ganancias y pérdidas por activo ---
      const perAssetQ = await pool.query(`
        SELECT
          o.asset,
          o.exchange,
          COUNT(DISTINCT d.id) as num_transmisiones,
          COALESCE(SUM(d.proceeds_eur::numeric), 0) as valor_transmision_eur,
          COALESCE(SUM(d.cost_basis_eur::numeric), 0) as valor_adquisicion_eur,
          COALESCE(SUM(d.gain_loss_eur::numeric), 0) as ganancia_perdida_eur,
          COALESCE(SUM(
            d.proceeds_eur::numeric - d.cost_basis_eur::numeric - d.gain_loss_eur::numeric
          ), 0) as comisiones_eur
        FROM fisco_disposals d
        JOIN fisco_operations o ON o.id = d.sell_operation_id
        WHERE EXTRACT(YEAR FROM d.disposed_at) = $1 ${exchWhere}
        GROUP BY o.asset, o.exchange
        ORDER BY o.asset, o.exchange
      `, [year]);

      const sectionB = perAssetQ.rows.map((r: any) => ({
        asset: r.asset,
        exchange: r.exchange,
        tipo: 'Venta',
        num_transmisiones: parseInt(r.num_transmisiones),
        valor_transmision_eur: Math.round(parseFloat(r.valor_transmision_eur) * 100) / 100,
        valor_adquisicion_eur: Math.round(parseFloat(r.valor_adquisicion_eur) * 100) / 100,
        ganancia_perdida_eur: Math.round(parseFloat(r.ganancia_perdida_eur) * 100) / 100,
        comisiones_eur: Math.round(parseFloat(r.comisiones_eur) * 100) / 100,
      }));

      // --- Section C: Resumen de rendimiento de capital mobiliario ---
      const stakingQ = await pool.query(`
        SELECT
          op_type,
          COALESCE(SUM(
            CASE
              WHEN total_eur IS NOT NULL THEN total_eur::numeric
              WHEN price_eur IS NOT NULL THEN (amount::numeric * price_eur::numeric)
              ELSE 0
            END
          ), 0) as total_eur
        FROM fisco_operations
        WHERE EXTRACT(YEAR FROM executed_at) = $1
          AND op_type IN ('staking', 'lending', 'distribution', 'reward')
          ${exchWhereOps}
        GROUP BY op_type
      `, [year]);

      const capitalMob: Record<string, number> = {
        staking: 0,
        masternodes: 0,
        lending: 0,
        distribuciones: 0,
      };
      for (const r of stakingQ.rows) {
        const val = Math.round(parseFloat(r.total_eur) * 100) / 100;
        if (r.op_type === 'staking') capitalMob.staking = val;
        else if (r.op_type === 'lending') capitalMob.lending = val;
        else if (r.op_type === 'distribution' || r.op_type === 'reward') capitalMob.distribuciones += val;
      }
      const sectionC = {
        ...capitalMob,
        total_eur: Math.round((capitalMob.staking + capitalMob.masternodes + capitalMob.lending + capitalMob.distribuciones) * 100) / 100,
      };

      // --- Section D: Visión general de cartera (balance 01/01 vs 31/12) ---
      // saldo_fin is sourced from fisco_lots.remaining_qty (FIFO ground truth).
      // This avoids negative balances for stablecoins (USDC etc.) which are not
      // tracked as FIFO lots. Only assets with actual FIFO lots are shown.
      const lotsBalanceQ = await pool.query(`
        SELECT fl.asset,
               SUM(fl.remaining_qty)::numeric AS saldo_fin,
               ARRAY_AGG(DISTINCT fo.exchange) AS exchanges
        FROM fisco_lots fl
        JOIN fisco_operations fo ON fo.id = fl.operation_id
        WHERE fl.remaining_qty > 0
        GROUP BY fl.asset
        ORDER BY fl.asset
      `);

      // Per-asset year flows from official operations
      const yearFlowsQ = await pool.query(`
        SELECT asset, exchange, op_type, amount::numeric AS amount
        FROM fisco_operations
        WHERE EXTRACT(YEAR FROM executed_at) = $1
          AND op_type IN ('trade_buy','deposit','staking','reward','distribution','trade_sell','withdrawal')
          ${exchWhereOps}
      `, [year]);

      const yearInflows = new Map<string, number>();
      const yearOutflows = new Map<string, number>();
      const yearExchanges = new Map<string, Set<string>>();
      for (const r of yearFlowsQ.rows) {
        const isIn = ['trade_buy', 'deposit', 'staking', 'reward', 'distribution'].includes(r.op_type);
        const isOut = ['trade_sell', 'withdrawal'].includes(r.op_type);
        const amt = parseFloat(r.amount);
        if (isIn) yearInflows.set(r.asset, (yearInflows.get(r.asset) ?? 0) + amt);
        if (isOut) yearOutflows.set(r.asset, (yearOutflows.get(r.asset) ?? 0) + amt);
        if (!yearExchanges.has(r.asset)) yearExchanges.set(r.asset, new Set());
        yearExchanges.get(r.asset)!.add(r.exchange);
      }

      // IMPORTANT: lotsBalanceQ.saldo_fin = current remaining_qty (ALL years, global).
      // yearFlows are filtered by year AND optionally by exchange.
      // When exchangeFilter is set, entradas/salidas are for that exchange only,
      // but saldo_fin is still global. This is the root cause of the arithmetic diff.
      // We expose this clearly via portfolio_scope and arithmetic_check.
      const portfolioScope = exchangeFilter ? "exchange_flows_global_balance" : "global";
      const portfolioNote = exchangeFilter
        ? `Entradas/salidas filtradas por exchange=${exchangeFilter}, pero saldo_fin es global multi-exchange. Para cuadre exacto usar GET /api/fisco/validate/portfolio?year=${year}&exchange=${exchangeFilter}`
        : `Cartera global consolidada (FIFO multi-exchange). Para validación aritmética exacta usar GET /api/fisco/validate/portfolio?year=${year}`;

      const sectionD: any[] = [];
      for (const r of lotsBalanceQ.rows) {
        const saldo_fin = Math.round(parseFloat(r.saldo_fin) * 1e8) / 1e8;
        const entradas  = Math.round((yearInflows.get(r.asset) ?? 0) * 1e8) / 1e8;
        const salidas   = Math.round((yearOutflows.get(r.asset) ?? 0) * 1e8) / 1e8;
        // Backcompute saldo_inicio from FIFO ground-truth saldo_fin (never negative)
        const saldo_inicio = Math.max(0, Math.round((saldo_fin - entradas + salidas) * 1e8) / 1e8);
        const expected_end = Math.round((saldo_inicio + entradas - salidas) * 1e8) / 1e8;
        const diff = Math.round((expected_end - saldo_fin) * 1e8) / 1e8;
        const exchFromLots: string[] = r.exchanges ?? [];
        const exchFromOps = Array.from(yearExchanges.get(r.asset) ?? []);
        const exchanges = [...new Set([...exchFromLots, ...exchFromOps])];
        sectionD.push({
          asset: r.asset,
          exchanges,
          saldo_inicio,
          entradas,
          salidas,
          saldo_fin,
          // Arithmetic check fields (diagnosis)
          expected_end_qty: expected_end,
          diff_qty: diff,
          arithmetic_ok: Math.abs(diff) <= 0.001,
          portfolio_scope: portfolioScope,
        });
      }
      sectionD.sort((a, b) => a.asset.localeCompare(b.asset));

      // --- Counters ---
      const countersQ = await pool.query(`
        SELECT
          COUNT(*) as total_ops,
          COUNT(*) FILTER (WHERE total_eur IS NULL AND op_type LIKE 'trade_%') as pending_valuation
        FROM fisco_operations
        WHERE EXTRACT(YEAR FROM executed_at) = $1 ${exchWhereOps}
      `, [year]);

      const counters = {
        total_operations: parseInt(countersQ.rows[0]?.total_ops || '0'),
        pending_valuation: parseInt(countersQ.rows[0]?.pending_valuation || '0'),
      };

      // --- Last sync ---
      const lastSyncQ = await pool.query(`SELECT MAX(created_at) as last_sync FROM fisco_operations`);

      // --- Critical errors (DB-based validation for the report year) ---
      const [unknownBasisQ, requiresEurQ, stablecoinAnomalyQ] = await Promise.all([
        pool.query(
          `SELECT o.asset, COUNT(*) AS cnt FROM fisco_disposals d
           JOIN fisco_operations o ON d.sell_operation_id = o.id
           WHERE d.cost_basis_eur::numeric = 0
           AND EXTRACT(YEAR FROM d.disposed_at) = $1 ${exchWhere}
           GROUP BY o.asset`, [year]
        ),
        pool.query(
          `SELECT asset, COUNT(*) AS cnt FROM fisco_operations
           WHERE total_eur IS NULL AND op_type IN ('trade_buy','trade_sell')
           AND EXTRACT(YEAR FROM executed_at) = $1 ${exchWhereOps}
           GROUP BY asset`, [year]
        ),
        pool.query(`
          SELECT fl.id AS lot_id, fl.asset,
                 fl.quantity::numeric, fl.remaining_qty::numeric,
                 fl.unit_cost_eur::numeric, fl.cost_eur::numeric,
                 fl.acquired_at, fo.exchange, fo.op_type, fo.external_id
          FROM fisco_lots fl
          JOIN fisco_operations fo ON fo.id = fl.operation_id
          WHERE fl.asset IN ('USDC','USDT')
            AND fl.unit_cost_eur IS NOT NULL
            AND fl.quantity > 0
            AND (fl.unit_cost_eur::numeric < 0.70 OR fl.unit_cost_eur::numeric > 1.20)
          ORDER BY fl.acquired_at
        `),
      ]);
      const stablecoinAnomalies = stablecoinAnomalyQ.rows.map((r: any) => ({
        code: "STABLECOIN_COST_BASIS_ANOMALY",
        lot_id: r.lot_id,
        asset: r.asset,
        quantity: parseFloat(r.quantity),
        remaining_qty: parseFloat(r.remaining_qty),
        unit_cost_eur: parseFloat(r.unit_cost_eur),
        cost_eur: parseFloat(r.cost_eur),
        exchange: r.exchange,
        acquired_at: r.acquired_at,
        op_type: r.op_type,
        detail: `Lote ${r.lot_id} ${r.asset} (${r.exchange}/${r.op_type}): unit_cost_eur=${parseFloat(r.unit_cost_eur).toFixed(4)} — esperado 0.70–1.20`,
      }));
      const annualCriticalErrors = [
        ...unknownBasisQ.rows.map((r: any) => ({
          code: "UNKNOWN_BASIS",
          asset: r.asset,
          detail: `${r.cnt} disposals con base de coste cero para ${r.asset}`,
        })),
        ...requiresEurQ.rows.map((r: any) => ({
          code: "REQUIRES_EUR_PRICE",
          asset: r.asset,
          detail: `${r.cnt} operaciones de ${r.asset} sin valoración EUR`,
        })),
      ];

      res.json({
        year,
        exchange_filter: exchangeFilter || 'all',
        committed_run: committedRun,
        last_sync: lastSyncQ.rows[0]?.last_sync || null,
        is_safe_for_report: annualCriticalErrors.length === 0 && stablecoinAnomalies.length === 0,
        critical_errors_count: annualCriticalErrors.length,
        critical_errors: annualCriticalErrors,
        stablecoin_anomalies: stablecoinAnomalies,
        counters,
        section_a: sectionA,
        section_b: sectionB,
        section_c: sectionC,
        section_d: sectionD,
        // Portfolio scope metadata — explains mixing when exchange filter is active
        portfolio_scope: portfolioScope,
        portfolio_note:  portfolioNote,
      });
    } catch (e: any) {
      console.error("[fisco/annual-report] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET summary per year from DB
  // ============================================================
  app.get("/api/fisco/summary", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM fisco_summary ORDER BY fiscal_year DESC, asset ASC`
      );

      // Group by year
      const byYear: Record<number, any[]> = {};
      for (const row of result.rows) {
        const year = row.fiscal_year;
        if (!byYear[year]) byYear[year] = [];
        byYear[year].push(row);
      }

      const yearTotals = Object.entries(byYear).map(([year, rows]) => ({
        year: parseInt(year),
        assets: rows,
        total_gain_loss_eur: Math.round(
          rows.reduce((s: number, r: any) => s + parseFloat(r.total_gain_loss_eur || "0"), 0) * 100
        ) / 100,
        total_fees_eur: Math.round(
          rows.reduce((s: number, r: any) => s + parseFloat(r.total_fees_eur || "0"), 0) * 100
        ) / 100,
      }));

      res.json({
        usd_eur_rate: getCachedUsdEurRate(),
        years: yearTotals,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

// ============================================================
// DB persistence helper
// ============================================================

async function saveFiscoToDB(
  operations: NormalizedOperation[],
  fifo: ReturnType<typeof runFifo>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Clear existing data (full refresh approach)
    await client.query("DELETE FROM fisco_disposals");
    await client.query("DELETE FROM fisco_lots");
    await client.query("DELETE FROM fisco_operations");
    await client.query("DELETE FROM fisco_summary");

    // Insert operations and build ID map
    const opIdMap = new Map<number, number>(); // operationIdx → DB id

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const result = await client.query(
        `INSERT INTO fisco_operations 
         (exchange, external_id, op_type, asset, amount, price_eur, total_eur, fee_eur, counter_asset, pair, executed_at, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          op.exchange, op.externalId, op.opType, op.asset,
          op.amount, op.priceEur, op.totalEur, op.feeEur,
          op.counterAsset, op.pair, op.executedAt,
          JSON.stringify(op.rawData),
        ]
      );
      opIdMap.set(i, result.rows[0].id);
    }

    // Insert lots and build lot ID map
    const lotIdMap = new Map<string, number>(); // lot.id → DB id

    for (const lot of fifo.lots) {
      const opDbId = opIdMap.get(lot.operationIdx);
      if (!opDbId) continue;

      const result = await client.query(
        `INSERT INTO fisco_lots
         (operation_id, asset, quantity, remaining_qty, cost_eur, unit_cost_eur, fee_eur, acquired_at, is_closed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          opDbId, lot.asset, lot.quantity, lot.remainingQty,
          lot.costEur, lot.unitCostEur, lot.feeEur,
          lot.acquiredAt, lot.isClosed,
        ]
      );
      lotIdMap.set(lot.id, result.rows[0].id);
    }

    // Insert disposals
    for (const d of fifo.disposals) {
      const sellOpDbId = opIdMap.get(d.sellOperationIdx);
      const lotDbId = lotIdMap.get(d.lotId);
      if (!sellOpDbId) continue;

      await client.query(
        `INSERT INTO fisco_disposals
         (sell_operation_id, lot_id, quantity, proceeds_eur, cost_basis_eur, gain_loss_eur, disposed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sellOpDbId, lotDbId || null, d.quantity,
          d.proceedsEur, d.costBasisEur, d.gainLossEur,
          d.disposedAt,
        ]
      );
    }

    // Insert yearly summaries
    for (const s of fifo.yearSummary) {
      await client.query(
        `INSERT INTO fisco_summary
         (fiscal_year, asset, total_acquisitions, total_disposals, total_cost_basis_eur, total_proceeds_eur, total_gain_loss_eur, total_fees_eur)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          s.year, s.asset, s.acquisitions, s.disposals,
          s.costBasisEur, s.proceedsEur, s.gainLossEur, s.feesEur,
        ]
      );
    }

    await client.query("COMMIT");
    console.log(`[fisco/db] Saved ${operations.length} ops, ${fifo.lots.length} lots, ${fifo.disposals.length} disposals`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================
// REBUILD endpoints
// ============================================================

export function registerFiscoRebuildRoutes(app: Express): void {

  /**
   * POST /api/fisco/rebuild
   * Body: { mode: 'dry_run' | 'commit', exchangeFilter?: string, fullSync?: boolean }
   * Runs the full FISCO rebuild pipeline.
   */
  app.post("/api/fisco/rebuild", async (req, res) => {
    try {
      const { mode = "dry_run", exchangeFilter = null, fullSync = true } = req.body || {};
      if (mode !== "dry_run" && mode !== "commit") {
        return res.status(400).json({ error: "mode must be 'dry_run' or 'commit'" });
      }

      // Guard: block commit if latest dry-run is unsafe
      if (mode === "commit") {
        const latestRuns = await pool.query(
          `SELECT id, is_safe_for_report, critical_errors_count, errors_json, warnings_json
           FROM fisco_rebuild_runs
           WHERE mode = 'dry_run' AND status = 'completed_dry'
           ORDER BY started_at DESC LIMIT 1`
        );
        if (latestRuns.rows.length === 0) {
          return res.status(400).json({
            error: "COMMIT_BLOCKED",
            reason: "No completed dry-run found. Run a dry-run first.",
          });
        }
        const latest = latestRuns.rows[0];
        if (!latest.is_safe_for_report || latest.critical_errors_count > 0) {
          const errors: any[] = latest.errors_json || [];
          const byCode: Record<string, number> = {};
          for (const e of errors) byCode[e.code] = (byCode[e.code] || 0) + 1;
          return res.status(400).json({
            error: "COMMIT_BLOCKED",
            reason: `Latest dry-run has ${latest.critical_errors_count} critical error(s). Fix them before committing.`,
            criticalErrorsByCode: byCode,
          });
        }
        // Block if RevolutX history is partial
        const warnings: string[] = latest.warnings_json || [];
        if (warnings.some((w: string) => w.includes('REVOLUT_PARTIAL_HISTORY'))) {
          return res.status(400).json({
            error: "COMMIT_BLOCKED",
            reason: "RevolutX historical data is incomplete (REVOLUT_PARTIAL_HISTORY). Ensure full history before committing.",
          });
        }
        // Block if any ops still need EUR price
        const requiresEurPriceQ = await pool.query(
          `SELECT COUNT(*) AS cnt FROM fisco_staging_operations so
           JOIN fisco_rebuild_runs rr ON rr.id = so.rebuild_run_id
           WHERE rr.id = $1 AND so.requires_eur_price = TRUE`,
          [latest.id]
        );
        if (parseInt(requiresEurPriceQ.rows[0]?.cnt ?? '0') > 0) {
          return res.status(400).json({
            error: "COMMIT_BLOCKED",
            reason: `Latest dry-run has ${requiresEurPriceQ.rows[0].cnt} operations with missing EUR price (REQUIRES_EUR_PRICE).`,
          });
        }
      }

      const result = await fiscoRebuildService.rebuild({
        mode,
        triggeredBy: "ui_button",
        exchangeFilter,
        fullSync,
      });
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/state
   * Returns whether a FISCO rebuild is currently active.
   * Useful for UI polling and debugging rate-limit competition.
   */
  app.get("/api/fisco/rebuild/state", (_req, res) => {
    return res.json({ active: isFiscoRebuildActive() });
  });

  // ============================================================
  // Opening Balances (saldo inicial fiscal)
  // ============================================================

  app.get("/api/fisco/opening-balances", async (_req, res) => {
    try {
      const rows = await pool.query(
        `SELECT id, asset, quantity::float, acquisition_date, cost_basis_eur::float,
                exchange, note, created_at, is_active
         FROM fisco_opening_balances ORDER BY acquisition_date ASC`
      );
      return res.json({ openingBalances: rows.rows });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/fisco/opening-balances", async (req, res) => {
    try {
      const { asset, quantity, acquisitionDate, costBasisEur, exchange = 'manual', note } = req.body || {};
      if (!asset || !quantity || !acquisitionDate || costBasisEur == null)
        return res.status(400).json({ error: "asset, quantity, acquisitionDate, costBasisEur required" });
      if (quantity <= 0) return res.status(400).json({ error: "quantity must be > 0" });
      if (costBasisEur < 0) return res.status(400).json({ error: "costBasisEur must be >= 0" });
      const row = await pool.query(
        `INSERT INTO fisco_opening_balances (asset, quantity, acquisition_date, cost_basis_eur, exchange, note)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [asset, quantity, acquisitionDate, costBasisEur, exchange, note ?? null]
      );
      return res.status(201).json({ openingBalance: row.rows[0] });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.put("/api/fisco/opening-balances/:id", async (req, res) => {
    try {
      const { asset, quantity, acquisitionDate, costBasisEur, exchange, note, isActive } = req.body || {};
      const fields: string[] = [];
      const vals: any[] = [];
      const add = (col: string, val: any) => { if (val !== undefined) { fields.push(`${col} = $${vals.length + 2}`); vals.push(val); } };
      add('asset', asset); add('quantity', quantity); add('acquisition_date', acquisitionDate);
      add('cost_basis_eur', costBasisEur); add('exchange', exchange);
      add('note', note); add('is_active', isActive);
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      fields.push(`updated_at = NOW()`);
      const row = await pool.query(
        `UPDATE fisco_opening_balances SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
        [req.params.id, ...vals]
      );
      if (!row.rows[0]) return res.status(404).json({ error: "Opening balance not found" });
      return res.json({ openingBalance: row.rows[0] });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/fisco/opening-balances/:id", async (req, res) => {
    try {
      const row = await pool.query(
        `UPDATE fisco_opening_balances SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!row.rows[0]) return res.status(404).json({ error: "Opening balance not found" });
      return res.json({ deleted: true, id: row.rows[0].id });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  /**
   * GET /api/fisco/rebuild/runs
   * Returns the list of rebuild runs (latest first).
   */
  app.get("/api/fisco/rebuild/runs", async (_req, res) => {
    try {
      const runs = await fiscoRebuildService.getRebuildRuns(30);
      return res.json({ runs });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/runs/:runId
   * Returns detail of a specific rebuild run.
   */
  app.get("/api/fisco/rebuild/runs/:runId", async (req, res) => {
    try {
      const run = await fiscoRebuildService.getRebuildRunById(req.params.runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      return res.json(run);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/reconciliation/latest
   * Returns the latest reconciliation run.
   */
  app.get("/api/fisco/rebuild/reconciliation/latest", async (_req, res) => {
    try {
      const recon = await fiscoRebuildService.getLatestReconciliation();
      return res.json({ reconciliation: recon });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/runs/:runId/export
   * Returns all normalized operations from a dry-run staging table as JSON.
   * Use for auditing ledger entries → normalized ops (e.g. 535 entries → 284 ops).
   */
  app.get("/api/fisco/rebuild/runs/:runId/export", async (req, res) => {
    try {
      const { runId } = req.params;
      const result = await pool.query(`
        SELECT
          rebuild_run_id   AS "runId",
          exchange,
          external_id      AS "externalId",
          op_type          AS "opType",
          asset,
          amount::float    AS amount,
          price_eur::float AS "priceEur",
          total_eur::float AS "totalEur",
          fee_eur::float   AS "feeEur",
          counter_asset    AS "counterAsset",
          pair,
          executed_at      AS "executedAt",
          requires_eur_price AS "requiresEurPrice"
        FROM fisco_staging_operations
        WHERE rebuild_run_id = $1
        ORDER BY executed_at ASC
      `, [runId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "No staging operations found for this runId" });
      }

      const criticalCount = result.rows.filter(r => r.requiresEurPrice).length;
      return res.json({
        runId,
        total: result.rows.length,
        requiresEurPriceCount: criticalCount,
        operations: result.rows,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/runs/latest/export
   * Shorthand: exports staging operations for the latest dry-run.
   */
  app.get("/api/fisco/rebuild/runs/latest/export", async (_req, res) => {
    try {
      const runRow = await pool.query(
        `SELECT id FROM fisco_rebuild_runs WHERE mode='dry_run' AND status='completed_dry'
         ORDER BY started_at DESC LIMIT 1`
      );
      if (!runRow.rows[0]) return res.status(404).json({ error: "No completed dry-run found" });
      const runId = runRow.rows[0].id;
      const result = await pool.query(`
        SELECT rebuild_run_id AS "runId", exchange, external_id AS "externalId",
               op_type AS "opType", asset, amount::float, price_eur::float AS "priceEur",
               total_eur::float AS "totalEur", fee_eur::float AS "feeEur",
               counter_asset AS "counterAsset", pair, executed_at AS "executedAt",
               requires_eur_price AS "requiresEurPrice"
        FROM fisco_staging_operations WHERE rebuild_run_id = $1 ORDER BY executed_at ASC
      `, [runId]);
      return res.json({
        runId, total: result.rows.length,
        requiresEurPriceCount: result.rows.filter(r => r.requiresEurPrice).length,
        operations: result.rows,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/runs/latest/audit-summary
   * Full diagnostic breakdown of the latest dry-run.
   * Returns semaphore, grouped errors, affected assets, date range, recommendations.
   */
  app.get("/api/fisco/rebuild/runs/latest/audit-summary", async (_req, res) => {
    try {
      // ── 1. Get latest completed dry-run ──────────────────────────────
      const runRow = await pool.query(
        `SELECT * FROM fisco_rebuild_runs
         WHERE mode='dry_run' AND status='completed_dry'
         ORDER BY started_at DESC LIMIT 1`
      );
      if (!runRow.rows[0]) return res.status(404).json({ error: "No completed dry-run found" });
      const run = runRow.rows[0];
      const runId: string = run.id;
      const criticalErrors: any[] = run.errors_json || [];

      // ── 2. Aggregate critical errors ─────────────────────────────────
      const byCode: Record<string, number> = {};
      const byAsset: Record<string, number> = {};
      for (const e of criticalErrors) {
        byCode[e.code] = (byCode[e.code] || 0) + 1;
        if (e.asset) byAsset[e.asset] = (byAsset[e.asset] || 0) + 1;
      }

      // Categorise root causes
      const requiresEurPriceErrors = criticalErrors.filter(e => e.code === "REQUIRES_EUR_PRICE");
      const negativeInventory = criticalErrors.filter(e => e.code === "NEGATIVE_INVENTORY");
      const unknownBasis = criticalErrors.filter(e => e.code === "UNKNOWN_BASIS");
      const sellWithoutLots = criticalErrors.filter(e => e.code === "SELL_WITHOUT_LOTS");
      const unclassified = criticalErrors.filter(e => e.code === "UNCLASSIFIED_OPERATION");
      const missingOpeningBalance = criticalErrors.filter(e => e.code === "MISSING_OPENING_BALANCE_OR_PREHISTORY");

      const negativeByAsset: Record<string, number> = {};
      for (const e of negativeInventory) negativeByAsset[e.asset] = (negativeByAsset[e.asset] || 0) + 1;
      const unknownByAsset: Record<string, number> = {};
      for (const e of unknownBasis) unknownByAsset[e.asset] = (unknownByAsset[e.asset] || 0) + 1;
      const sellNoLotByAsset: Record<string, number> = {};
      for (const e of sellWithoutLots) sellNoLotByAsset[e.asset] = (sellNoLotByAsset[e.asset] || 0) + 1;
      const missingObByAsset: Record<string, number> = {};
      for (const e of missingOpeningBalance) missingObByAsset[e.asset] = (missingObByAsset[e.asset] || 0) + 1;

      // ── 3. Staging operations stats ───────────────────────────────────
      const [opsStats, exchangeStats, assetStats, typeStats, eurPriceStats, dateRange] =
        await Promise.all([
          pool.query(`SELECT COUNT(*) AS total FROM fisco_staging_operations WHERE rebuild_run_id=$1`, [runId]),
          pool.query(`SELECT exchange, COUNT(*) AS cnt FROM fisco_staging_operations WHERE rebuild_run_id=$1 GROUP BY exchange`, [runId]),
          pool.query(`SELECT asset, COUNT(*) AS cnt FROM fisco_staging_operations WHERE rebuild_run_id=$1 GROUP BY asset ORDER BY cnt DESC LIMIT 20`, [runId]),
          pool.query(`SELECT op_type, COUNT(*) AS cnt FROM fisco_staging_operations WHERE rebuild_run_id=$1 GROUP BY op_type`, [runId]),
          pool.query(`SELECT COUNT(*) AS cnt, array_agg(DISTINCT asset) AS assets FROM fisco_staging_operations WHERE rebuild_run_id=$1 AND requires_eur_price=TRUE`, [runId]),
          pool.query(`SELECT MIN(executed_at) AS from_date, MAX(executed_at) AS to_date FROM fisco_staging_operations WHERE rebuild_run_id=$1`, [runId]),
        ]);

      const toObj = (rows: any[], keyCol: string, valCol: string) =>
        Object.fromEntries(rows.map(r => [r[keyCol], parseInt(r[valCol])]));

      // ── 4. Build recommendation ───────────────────────────────────────
      const recommendations: string[] = [];
      if (requiresEurPriceErrors.length > 0) {
        const affectedPairs = [...new Set(requiresEurPriceErrors.map((e: any) => e.detail?.match(/\(([^)]+)\)/)?.[1]).filter(Boolean))];
        recommendations.push(
          `REQUIRES_EUR_PRICE (${requiresEurPriceErrors.length}): Operaciones cripto→cripto sin precio EUR. ` +
          `Pares afectados: ${affectedPairs.join(", ") || "ver firstCriticalErrors"}. ` +
          `Solución: CoinGecko debe tener histórico para esos activos en esas fechas, o introducir precios manuales.`
        );
      }
      if (negativeInventory.length > 0) {
        recommendations.push(
          `NEGATIVE_INVENTORY (${negativeInventory.length}): Ventas antes de compras detectadas en ${Object.keys(negativeByAsset).join(", ")}. ` +
          `Causa probable: historial incompleto (falta fullSync) o transferencias entre exchanges no registradas.`
        );
      }
      if (unknownBasis.length > 0) {
        recommendations.push(
          `UNKNOWN_BASIS (${unknownBasis.length}): Ventas sin lote de compra en ${Object.keys(unknownByAsset).join(", ")}. ` +
          `Causa: compras no importadas o activos recibidos externamente sin registro.`
        );
      }
      if (missingOpeningBalance.length > 0) {
        const assets = Object.keys(missingObByAsset).join(", ");
        recommendations.push(
          `MISSING_OPENING_BALANCE_OR_PREHISTORY (${missingOpeningBalance.length}): Ventas sin ninguna compra previa en ${assets}. ` +
          `El activo fue adquirido antes del histórico disponible o transferido desde otro exchange. ` +
          `Solución: registra un saldo inicial (opening balance) via POST /api/fisco/opening-balances.`
        );
      }
      if (sellWithoutLots.length > 0) {
        recommendations.push(
          `SELL_WITHOUT_LOTS (${sellWithoutLots.length}): Ventas sin ningún lote abierto en ${Object.keys(sellNoLotByAsset).join(", ")}.`
        );
      }
      if (unclassified.length > 0) {
        recommendations.push(`UNCLASSIFIED (${unclassified.length}): Operaciones con tipo desconocido — revisar normalizer.ts.`);
      }
      if (criticalErrors.length === 0) {
        recommendations.push("OK Sin errores criticos — puede proceder con mode=commit cuando este listo.");
      }

      // Check RevolutX partial-history warning in warnings_json
      const warnings: string[] = run.warnings_json || [];
      const revolutPartial = warnings.some((w: string) => w.includes("REVOLUT_PARTIAL_HISTORY"));

      // Fetch stats from stored JSON (populated since migration 044)
      const fs: Record<string, any> = run.fetch_stats_json || {};

      return res.json({
        runId,
        status: run.status,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        isSafeForReport: run.is_safe_for_report,
        operationsCount: run.operations_count,
        lotsCount: run.lots_count,
        disposalsCount: run.disposals_count,
        criticalErrorsCount: run.critical_errors_count,
        criticalErrorsSummaryByCode: byCode,
        criticalErrorsSummaryByAsset: byAsset,
        firstCriticalErrors: criticalErrors.slice(0, 10),
        requiresEurPriceCount: parseInt(eurPriceStats.rows[0]?.cnt ?? '0'),
        requiresEurPriceAssets: eurPriceStats.rows[0]?.assets ?? [],
        negativeInventoryByAsset: negativeByAsset,
        unknownBasisByAsset: unknownByAsset,
        sellWithoutLotsByAsset: sellNoLotByAsset,
        missingOpeningBalanceByAsset: missingObByAsset,
        operationsByExchange: toObj(exchangeStats.rows, "exchange", "cnt"),
        operationsByAsset: toObj(assetStats.rows, "asset", "cnt"),
        operationsByType: toObj(typeStats.rows, "op_type", "cnt"),
        dateRange: {
          from: dateRange.rows[0]?.from_date ?? null,
          to: dateRange.rows[0]?.to_date ?? null,
        },
        krakenHistory: {
          ledgerCount: fs.krakenLedgerCount ?? null,
          opCount: fs.krakenOpCount ?? null,
          firstDate: fs.krakenFirstLedgerDate ?? null,
          lastDate: fs.krakenLastLedgerDate ?? null,
          fullSync: fs.krakenFullSync ?? null,
        },
        revolutHistory: {
          orderCount: fs.revolutOrderCount ?? null,
          opCount: fs.revolutOpCount ?? null,
          firstDate: fs.revolutFirstOrderDate ?? null,
          lastDate: fs.revolutLastOrderDate ?? null,
          completedWindows: fs.revolutCompletedWindows ?? null,
          skippedWindows: fs.revolutSkippedWindows ?? null,
          skippedWindowsList: fs.revolutSkippedWindowsList ?? [],
          partialHistory: fs.revolutPartialHistory ?? false,
          startFetchedFrom: fs.revolutStartMs ? new Date(fs.revolutStartMs).toISOString() : null,
        },
        openingBalancesInjected: fs.openingBalancesCount ?? 0,
        revolutRateLimitWarnings: revolutPartial,
        recommendation: recommendations,
        semaphore: (run.is_safe_for_report && !revolutPartial) ? "green" : (criticalErrors.length > 0) ? "red" : "yellow",
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/rebuild/runs/latest-committed/audit-summary
   * Returns the latest run with mode=commit, status=committed (safe first).
   */
  app.get("/api/fisco/rebuild/runs/latest-committed/audit-summary", async (_req, res) => {
    try {
      const runRow = await pool.query(
        `SELECT * FROM fisco_rebuild_runs
         WHERE mode='commit' AND status='committed'
         ORDER BY is_safe_for_report DESC, started_at DESC LIMIT 1`
      );
      if (!runRow.rows[0]) return res.status(404).json({ error: "No committed run found" });
      const run = runRow.rows[0];
      const criticalErrors: any[] = run.errors_json || [];

      // Validate official tables match the committed run
      const [opsCount, lotsCount, dispCount] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_operations`),
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_lots`),
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_disposals`),
      ]);

      return res.json({
        runId: run.id,
        mode: run.mode,
        status: run.status,
        isSafeForReport: run.is_safe_for_report,
        criticalErrorsCount: run.critical_errors_count ?? 0,
        operationsCount: run.operations_count ?? 0,
        lotsCount: run.lots_count ?? 0,
        disposalsCount: run.disposals_count ?? 0,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        officialTables: {
          operationsCount: parseInt(opsCount.rows[0].cnt),
          lotsCount: parseInt(lotsCount.rows[0].cnt),
          disposalsCount: parseInt(dispCount.rows[0].cnt),
        },
        firstCriticalErrors: criticalErrors.slice(0, 5),
        semaphore: run.is_safe_for_report ? "green" : (criticalErrors.length > 0 ? "red" : "yellow"),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/validate
   * Runs post-FIFO validation on the current official data.
   * Returns criticalErrors and isSafeForReport.
   */
  app.get("/api/fisco/validate", async (_req, res) => {
    try {
      // Quick validation on existing official data
      const [opsRes, lotsRes, dispRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_operations`),
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_lots`),
        pool.query(`SELECT COUNT(*) AS cnt FROM fisco_disposals`),
      ]);
      const unknownBasis = await pool.query(
        `SELECT fo.asset, COUNT(*) AS cnt
         FROM fisco_disposals d
         JOIN fisco_operations fo ON fo.id = d.sell_operation_id
         WHERE d.lot_id IS NULL
         GROUP BY fo.asset`
      );
      const negBalance = await pool.query(`
        SELECT fl.asset,
          (SELECT SUM(quantity) FROM fisco_lots fl2 WHERE fl2.asset = fl.asset) -
          (SELECT COALESCE(SUM(fd.quantity),0) FROM fisco_disposals fd
            JOIN fisco_operations fo ON fd.sell_operation_id = fo.id
            WHERE fo.asset = fl.asset) AS bal
        FROM (SELECT DISTINCT asset FROM fisco_lots) fl
        WHERE (
          (SELECT SUM(quantity) FROM fisco_lots fl2 WHERE fl2.asset = fl.asset) -
          (SELECT COALESCE(SUM(fd.quantity),0) FROM fisco_disposals fd
            JOIN fisco_operations fo ON fd.sell_operation_id = fo.id
            WHERE fo.asset = fl.asset)
        ) < -0.000001
      `);
      const stablecoinAnomalyQ = await pool.query(`
        SELECT fl.id AS lot_id, fl.asset,
               fl.quantity::numeric, fl.remaining_qty::numeric,
               fl.unit_cost_eur::numeric, fl.cost_eur::numeric,
               fl.acquired_at, fo.exchange, fo.op_type, fo.external_id
        FROM fisco_lots fl
        JOIN fisco_operations fo ON fo.id = fl.operation_id
        WHERE fl.asset IN ('USDC','USDT')
          AND fl.unit_cost_eur IS NOT NULL
          AND fl.quantity > 0
          AND (fl.unit_cost_eur::numeric < 0.70 OR fl.unit_cost_eur::numeric > 1.20)
        ORDER BY fl.acquired_at
      `);
      const criticalErrors = [
        ...unknownBasis.rows.map((r: any) => ({
          code: "UNKNOWN_BASIS",
          asset: r.asset,
          detail: `${r.cnt} disposals sin base de coste para ${r.asset}`,
        })),
        ...negBalance.rows.map((r: any) => ({
          code: "NEGATIVE_INVENTORY",
          asset: r.asset,
          detail: `Balance negativo para ${r.asset}: ${parseFloat(r.bal).toFixed(8)}`,
        })),
        ...stablecoinAnomalyQ.rows.map((r: any) => ({
          code: "STABLECOIN_COST_BASIS_ANOMALY",
          asset: r.asset,
          lot_id: r.lot_id,
          unit_cost_eur: parseFloat(r.unit_cost_eur),
          exchange: r.exchange,
          acquired_at: r.acquired_at,
          detail: `Lote ${r.lot_id} ${r.asset} (${r.exchange} / ${r.op_type}): unit_cost_eur=${parseFloat(r.unit_cost_eur).toFixed(4)} — esperado 0.70–1.20`,
        })),
      ];
      return res.json({
        isSafeForReport: criticalErrors.length === 0,
        criticalErrors,
        stablecoinAnomalies: stablecoinAnomalyQ.rows.map((r: any) => ({
          lot_id: r.lot_id,
          asset: r.asset,
          quantity: parseFloat(r.quantity),
          remaining_qty: parseFloat(r.remaining_qty),
          unit_cost_eur: parseFloat(r.unit_cost_eur),
          cost_eur: parseFloat(r.cost_eur),
          exchange: r.exchange,
          acquired_at: r.acquired_at,
          op_type: r.op_type,
        })),
        operationsCount: parseInt(opsRes.rows[0].cnt),
        lotsCount: parseInt(lotsRes.rows[0].cnt),
        disposalsCount: parseInt(dispRes.rows[0].cnt),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/debug/usdc-disposals?year=2026
   * Returns all USDC disposals with full lot+operation detail for cost-basis audit.
   */
  app.get("/api/fisco/debug/usdc-disposals", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || 2026;
      const exchange = (req.query.exchange as string) || null;
      const disposalParams: any[] = [`${year}-01-01`];
      let exchClause = "";
      if (exchange) {
        disposalParams.push(exchange);
        exchClause = `AND so.exchange = $${disposalParams.length}`;
      }

      const disposals = await pool.query(`
        SELECT
          d.id                                     AS disposal_id,
          so.id                                    AS sell_operation_id,
          so.exchange                              AS sell_exchange,
          so.external_id                           AS sell_external_id,
          so.executed_at                           AS sold_at,
          so.asset,
          d.quantity::numeric                      AS quantity,
          d.proceeds_eur::numeric                  AS proceeds_eur,
          d.cost_basis_eur::numeric                AS cost_basis_eur,
          d.gain_loss_eur::numeric                 AS gain_loss_eur,
          COALESCE(so.fee_eur, 0)::numeric         AS fee_eur,
          d.lot_id,
          fl.acquired_at                           AS lot_acquired_at,
          fl.quantity::numeric                     AS lot_quantity,
          fl.remaining_qty::numeric                AS lot_remaining_qty,
          fl.cost_eur::numeric                     AS lot_cost_eur,
          fl.unit_cost_eur::numeric                AS lot_unit_cost_eur,
          bo.exchange                              AS buy_exchange,
          bo.external_id                           AS buy_external_id,
          bo.op_type                               AS buy_op_type,
          bo.amount::numeric                       AS buy_amount,
          bo.price_eur::numeric                    AS buy_price_eur,
          bo.total_eur::numeric                    AS buy_total_eur,
          bo.executed_at                           AS buy_executed_at
        FROM fisco_disposals d
        JOIN fisco_operations so ON so.id = d.sell_operation_id
        LEFT JOIN fisco_lots fl ON fl.id = d.lot_id
        LEFT JOIN fisco_operations bo ON bo.id = fl.operation_id
        WHERE so.asset = 'USDC'
          AND so.executed_at >= $1::date
          AND so.executed_at < ($1::date + interval '1 year')
          ${exchClause}
        ORDER BY so.executed_at, d.id
      `, disposalParams);

      const allOps = await pool.query(`
        SELECT
          id, exchange, external_id, op_type, asset,
          amount::numeric AS amount,
          price_eur::numeric AS price_eur,
          total_eur::numeric AS total_eur,
          fee_eur::numeric AS fee_eur,
          counter_asset, pair, executed_at, raw_data
        FROM fisco_operations
        WHERE asset = 'USDC'
        ORDER BY executed_at
      `);

      const lots = await pool.query(`
        SELECT
          fl.id, fl.asset, fl.quantity::numeric, fl.remaining_qty::numeric,
          fl.cost_eur::numeric, fl.unit_cost_eur::numeric, fl.acquired_at,
          fo.exchange, fo.op_type, fo.external_id, fo.executed_at
        FROM fisco_lots fl
        JOIN fisco_operations fo ON fo.id = fl.operation_id
        WHERE fl.asset = 'USDC'
        ORDER BY fl.acquired_at
      `);

      const anomalousLots = lots.rows.filter(
        (r: any) => r.unit_cost_eur !== null && (parseFloat(r.unit_cost_eur) < 0.70 || parseFloat(r.unit_cost_eur) > 1.20)
      );

      res.json({
        year,
        disposals: disposals.rows,
        all_usdc_operations: allOps.rows,
        usdc_lots: lots.rows,
        anomalous_lots: anomalousLots,
        summary: {
          disposal_count: disposals.rows.length,
          total_qty: disposals.rows.reduce((s: number, r: any) => s + parseFloat(r.quantity || 0), 0),
          total_proceeds_eur: disposals.rows.reduce((s: number, r: any) => s + parseFloat(r.proceeds_eur || 0), 0),
          total_cost_basis_eur: disposals.rows.reduce((s: number, r: any) => s + parseFloat(r.cost_basis_eur || 0), 0),
          total_gain_loss_eur: disposals.rows.reduce((s: number, r: any) => s + parseFloat(r.gain_loss_eur || 0), 0),
          lots_count: lots.rows.length,
          anomalous_lots_count: anomalousLots.length,
        },
      });
    } catch (e: any) {
      console.error("[fisco/debug/usdc-disposals]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/reconciliation/revolut?year=2025
   * Reconciles bot-imported RevolutX data vs official Revolut PDF annual tax extract.
   * Reference data is hardcoded from the official Revolut statements.
   */
  app.get("/api/fisco/reconciliation/revolut", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || 2025;
      const dateFrom = `${year}-01-01`;
      const dateTo   = `${year + 1}-01-01`;

      // ── Hardcoded Revolut PDF reference data ────────────────────────────────
      const REVOLUT_REFERENCE: Record<number, Record<string, any>> = {
        2025: {
          USDC: {
            source: "Revolut Annual Tax Statement 2025",
            total_sold_quantity: 469.787168,
            gross_proceeds_usd: 469.22,
            cost_basis_usd: 469.91,
            gross_pnl_usd: -0.69,
            fees_usd: 4.59,
            net_pnl_usd: -5.28,
            transactions: [
              { date: "2025-12-12", quantity: 105.72524,   cost_basis_usd: 105.85, gross_proceeds_usd: 105.45, fees_usd: 0.20, net_pnl_usd: -0.60 },
              { date: "2025-12-14", quantity: 364.061928,  cost_basis_usd: 364.06, gross_proceeds_usd: 363.77, fees_usd: 4.39, net_pnl_usd: -4.68 },
            ],
          },
        },
        2026: {
          // Source: Revolut Annual Tax Statement 2026 (official Revolut PDF)
          // Gross proceeds = $20,658.69 | Cost basis = $21,750.71 | Fees = $34.97 | Net PnL = -$1,126.99
          // NOTE: Revolut reports in USD; bot uses EUR (FIFO global multi-exchange).
          // Expected differences: FX USD/EUR + FIFO global vs FIFO internal Revolut.
          _AGGREGATE: {
            source: "Revolut Annual Tax Statement 2026",
            gross_proceeds_usd: 20658.69,
            cost_basis_usd: 21750.71,
            fees_usd: 34.97,
            net_pnl_usd: -1126.99,
            note: "Aggregate across all assets. Per-asset breakdown not yet available.",
            transactions: [],
          },
        },
      };

      // ── Query bot: all RevolutX trade_sell operations in year ────────────────
      const sellOpsQ = await pool.query(`
        SELECT id, external_id, op_type, asset,
               amount::numeric    AS amount,
               price_eur::numeric AS price_eur,
               total_eur::numeric AS total_eur,
               fee_eur::numeric   AS fee_eur,
               counter_asset, pair, executed_at, raw_data
        FROM fisco_operations
        WHERE exchange = 'revolutx'
          AND op_type = 'trade_sell'
          AND executed_at >= $1::date
          AND executed_at < $2::date
        ORDER BY executed_at
      `, [dateFrom, dateTo]);

      // ── Query bot: all RevolutX disposals in year ────────────────────────────
      const disposalsQ = await pool.query(`
        SELECT
          d.id                    AS disposal_id,
          so.id                   AS sell_operation_id,
          so.external_id,
          so.asset,
          so.amount::numeric      AS sell_amount,
          so.executed_at          AS sold_at,
          so.total_eur::numeric   AS op_total_eur,
          so.fee_eur::numeric     AS op_fee_eur,
          d.quantity::numeric     AS quantity,
          d.proceeds_eur::numeric AS proceeds_eur,
          d.cost_basis_eur::numeric AS cost_basis_eur,
          d.gain_loss_eur::numeric  AS gain_loss_eur,
          d.lot_id
        FROM fisco_disposals d
        JOIN fisco_operations so ON so.id = d.sell_operation_id
        WHERE so.exchange = 'revolutx'
          AND so.executed_at >= $1::date
          AND so.executed_at < $2::date
        ORDER BY so.executed_at, d.id
      `, [dateFrom, dateTo]);

      // ── Aggregate bot totals by asset ────────────────────────────────────────
      const botByAsset: Record<string, {
        sell_count: number; total_qty_sold: number;
        total_proceeds_eur: number; total_fee_eur: number;
        first_sell_date: string | null; last_sell_date: string | null;
        operations: any[];
      }> = {};

      for (const row of sellOpsQ.rows) {
        const asset: string = row.asset;
        if (!botByAsset[asset]) {
          botByAsset[asset] = {
            sell_count: 0, total_qty_sold: 0,
            total_proceeds_eur: 0, total_fee_eur: 0,
            first_sell_date: null, last_sell_date: null,
            operations: [],
          };
        }
        const t = botByAsset[asset];
        t.sell_count++;
        t.total_qty_sold    += parseFloat(row.amount    ?? 0);
        t.total_proceeds_eur += parseFloat(row.total_eur ?? 0);
        t.total_fee_eur      += parseFloat(row.fee_eur   ?? 0);
        const dt = row.executed_at ? new Date(row.executed_at).toISOString().split("T")[0] : null;
        if (dt) {
          if (!t.first_sell_date || dt < t.first_sell_date) t.first_sell_date = dt;
          if (!t.last_sell_date  || dt > t.last_sell_date)  t.last_sell_date  = dt;
        }
        t.operations.push({
          id: row.id, external_id: row.external_id, asset: row.asset,
          amount: parseFloat(row.amount ?? 0),
          total_eur: row.total_eur != null ? parseFloat(row.total_eur) : null,
          fee_eur:   row.fee_eur   != null ? parseFloat(row.fee_eur)   : null,
          executed_at: row.executed_at,
        });
      }

      // ── Pre-query: ALL RevolutX ops (any type) on expected transaction dates ───
      const referenceForYear: Record<string, any> = REVOLUT_REFERENCE[year] ?? {};
      const allExpectedDates = Object.values(referenceForYear)
        .flatMap((ref: any) => ref.transactions.map((tx: any) => tx.date as string));
      const uniqueExpectedDates = [...new Set(allExpectedDates)];

      const STABLE_ASSETS_SET = ["USDC", "USDT", "USDE", "DAI", "BUSD"];

      const allOpsOnDatesQ = uniqueExpectedDates.length > 0
        ? await pool.query(`
          SELECT op_type, asset, amount::numeric, counter_asset, pair,
                 executed_at, external_id
          FROM fisco_operations
          WHERE exchange = 'revolutx'
            AND executed_at::date = ANY($1::date[])
          ORDER BY executed_at
        `, [uniqueExpectedDates])
        : { rows: [] as any[] };

      const allOpsByDate: Record<string, any[]> = {};
      for (const row of allOpsOnDatesQ.rows) {
        const d = new Date(row.executed_at).toISOString().split("T")[0];
        if (!allOpsByDate[d]) allOpsByDate[d] = [];
        allOpsByDate[d].push(row);
      }

      // ── Pre-query: external statement items for this exchange+year ────────────
      const stmtItemsQ = await pool.query(`
        SELECT
          si.id, si.asset, si.statement_type, si.event_at,
          si.amount_sent::numeric, si.fee_amount::numeric, si.total_out::numeric,
          si.network, si.gross_proceeds_usd::numeric,
          si.reconciliation_status,
          si.matched_transfer_link_id,
          si.matched_operation_id,
          -- Classification & taxable (from migration 046, default to 'pending' if column missing)
          COALESCE(si.classification, 'pending')        AS classification,
          COALESCE(si.classification_source, '')        AS classification_source,
          COALESCE(si.taxable, 'pending_review')        AS taxable,
          -- Conservative disposal fields (null if not yet computed)
          si.market_price_eur::numeric                  AS market_price_eur,
          si.proceeds_eur::numeric                      AS proceeds_eur,
          si.cost_basis_eur::numeric                    AS cost_basis_eur,
          si.gain_loss_eur::numeric                     AS gain_loss_eur,
          si.finalized_note,
          -- Transfer link fields
          tl.status       AS link_status,
          tl.confidence   AS link_confidence,
          tl.to_exchange  AS link_to_exchange,
          tl.to_operation_id AS link_to_op_id,
          tl.match_reason AS link_reason,
          fo.external_id  AS deposit_external_id,
          fo.executed_at  AS deposit_at
        FROM fisco_external_statement_items si
        LEFT JOIN fisco_transfer_links tl ON tl.id = si.matched_transfer_link_id
        LEFT JOIN fisco_operations fo     ON fo.id = tl.to_operation_id
        WHERE si.exchange = 'revolutx'
          AND si.year = $1
        ORDER BY si.event_at
      `, [year]);

      // Index statement items by date
      const stmtByDate: Record<string, any[]> = {};
      for (const row of stmtItemsQ.rows) {
        const d = new Date(row.event_at).toISOString().split("T")[0];
        if (!stmtByDate[d]) stmtByDate[d] = [];
        stmtByDate[d].push(row);
      }

      // ── Diff bot vs reference ────────────────────────────────────────────────
      const USD_EUR: Record<number, number> = { 2025: 0.92, 2026: 0.88 };
      const usdEurRate = USD_EUR[year] ?? 0.92;

      const diffs: Record<string, any> = {};
      const transactionChecks: Record<string, any[]> = {};

      for (const [asset, ref] of Object.entries(referenceForYear)) {
        const bot = botByAsset[asset];
        const botQty     = bot?.total_qty_sold    ?? 0;
        const botCount   = bot?.sell_count         ?? 0;
        const botProEur  = bot?.total_proceeds_eur ?? 0;
        const botFeeEur  = bot?.total_fee_eur      ?? 0;

        const refProEurEst = ref.gross_proceeds_usd * usdEurRate;
        const refFeeEurEst = ref.fees_usd           * usdEurRate;
        const qtyDiff      = botQty - ref.total_sold_quantity;
        const prosDiff     = botProEur - refProEurEst;
        const feeDiff      = botFeeEur - refFeeEurEst;

        const status = Math.abs(qtyDiff) <= 0.01 && Math.abs(prosDiff) <= 5 ? "OK" : "DIFFERENCES";

        diffs[asset] = {
          bot_qty:              botQty,
          ref_qty:              ref.total_sold_quantity,
          qty_diff:             qtyDiff,
          bot_proceeds_eur:     botProEur,
          ref_proceeds_eur_est: refProEurEst,
          proceeds_diff_eur:    prosDiff,
          bot_fee_eur:          botFeeEur,
          ref_fee_eur_est:      refFeeEurEst,
          fee_diff_eur:         feeDiff,
          bot_sell_count:       botCount,
          ref_tx_count:         ref.transactions.length,
          sell_count_diff:      botCount - ref.transactions.length,
          usd_eur_rate_used:    usdEurRate,
          status,
        };

        // ── Transaction-level checks ─────────────────────────────────────────
        transactionChecks[asset] = ref.transactions.map((tx: any) => {
          // 1) Check trade_sell ops on that date
          const matchOps = (bot?.operations ?? []).filter((op: any) => {
            const opDate = op.executed_at
              ? new Date(op.executed_at).toISOString().split("T")[0]
              : null;
            return opDate === tx.date;
          });
          const qtyOnDate = matchOps.reduce((s: number, op: any) => s + (op.amount ?? 0), 0);
          const qtyOk = Math.abs(qtyOnDate - tx.quantity) < 0.01;

          if (matchOps.length > 0 && qtyOk) {
            return {
              expected_date:         tx.date,
              expected_quantity:     tx.quantity,
              expected_proceeds_usd: tx.gross_proceeds_usd,
              expected_fees_usd:     tx.fees_usd,
              bot_ops_on_date:       matchOps.length,
              bot_qty_on_date:       qtyOnDate,
              qty_match:             true,
              status:                "OK_ORDER_SELL",
            };
          }

          // 2) Check external statement items on that date
          const stmtItems = (stmtByDate[tx.date] ?? []).filter((s: any) => s.asset === asset);
          if (stmtItems.length > 0) {
            const bestStmt = stmtItems[0];
            const reconcStatus = bestStmt.reconciliation_status as string;

            const classif = (bestStmt.classification ?? "pending") as string;

            let txStatus: string;
            if (reconcStatus === "matched_internal_transfer") {
              txStatus = "OK_INTERNAL_TRANSFER";
            } else if (classif === "conservative_external_disposal") {
              txStatus = "CONSERVATIVE_EXTERNAL_DISPOSAL";
            } else if (reconcStatus === "matched_external_disposal") {
              txStatus = "EXTERNAL_DISPOSAL";
            } else {
              txStatus = bestStmt.statement_type === "withdrawal_crypto"
                ? "WITHDRAWAL_UNMATCHED"
                : "STATEMENT_ONLY_UNMATCHED";
            }

            return {
              expected_date:         tx.date,
              expected_quantity:     tx.quantity,
              expected_proceeds_usd: tx.gross_proceeds_usd,
              expected_fees_usd:     tx.fees_usd,
              bot_ops_on_date:       matchOps.length,
              bot_qty_on_date:       qtyOnDate,
              qty_match:             qtyOk,
              status:                txStatus,
              statement_item: {
                id:                   bestStmt.id,
                statement_type:       bestStmt.statement_type,
                classification:       classif,
                classification_source: bestStmt.classification_source ?? null,
                taxable:              bestStmt.taxable ?? "pending_review",
                amount_sent:          parseFloat(bestStmt.amount_sent   ?? 0),
                fee_amount:           parseFloat(bestStmt.fee_amount    ?? 0),
                total_out:            parseFloat(bestStmt.total_out     ?? 0),
                network:              bestStmt.network,
                reconciliation_status: reconcStatus,
                // Conservative disposal fields
                market_price_eur:     bestStmt.market_price_eur  != null ? parseFloat(bestStmt.market_price_eur)  : null,
                proceeds_eur:         bestStmt.proceeds_eur      != null ? parseFloat(bestStmt.proceeds_eur)      : null,
                cost_basis_eur:       bestStmt.cost_basis_eur    != null ? parseFloat(bestStmt.cost_basis_eur)    : null,
                gain_loss_eur:        bestStmt.gain_loss_eur     != null ? parseFloat(bestStmt.gain_loss_eur)     : null,
                finalized_note:       bestStmt.finalized_note    ?? null,
                // Transfer link fields
                link_status:          bestStmt.link_status          ?? null,
                link_confidence:      bestStmt.link_confidence       ?? null,
                link_to_exchange:     bestStmt.link_to_exchange      ?? null,
                deposit_external_id:  bestStmt.deposit_external_id   ?? null,
                deposit_at:           bestStmt.deposit_at            ?? null,
                link_reason:          bestStmt.link_reason           ?? null,
              },
            };
          }

          // 3) No trade_sell AND no statement item — classify root cause
          const allOpsOnDate = allOpsByDate[tx.date] ?? [];
          let unresolved: string;
          if (allOpsOnDate.length === 0) {
            unresolved = "MISSING_API_WINDOW_NOT_FETCHED";
          } else {
            const hasCryptoBuyWithStable = allOpsOnDate.some((op: any) =>
              op.op_type === "trade_buy" && STABLE_ASSETS_SET.includes(op.counter_asset)
            );
            unresolved = hasCryptoBuyWithStable
              ? "MISSING_STABLECOIN_DISPOSAL_LEG"
              : matchOps.length > 0 ? "QTY_MISMATCH" : "MISSING_MOVEMENT_SYNC";
          }

          return {
            expected_date:         tx.date,
            expected_quantity:     tx.quantity,
            expected_proceeds_usd: tx.gross_proceeds_usd,
            expected_fees_usd:     tx.fees_usd,
            bot_ops_on_date:       matchOps.length,
            bot_qty_on_date:       qtyOnDate,
            qty_match:             qtyOk,
            all_ops_on_date: allOpsOnDate.map((op: any) => ({
              op_type: op.op_type, asset: op.asset,
              amount: parseFloat(op.amount ?? 0),
              counter_asset: op.counter_asset,
              external_id: op.external_id,
              executed_at: op.executed_at,
            })),
            hint: unresolved === "MISSING_MOVEMENT_SYNC"
              ? "Importa el movimiento manualmente via POST /api/fisco/statement-items"
              : undefined,
            status: unresolved,
          };
        });
      }

      // ── Overall status ────────────────────────────────────────────────────────
      // OK only if ALL transaction checks are OK_ORDER_SELL or OK_INTERNAL_TRANSFER
      const OK_STATUSES   = new Set(["OK_ORDER_SELL", "OK_INTERNAL_TRANSFER", "EXTERNAL_DISPOSAL", "CONSERVATIVE_EXTERNAL_DISPOSAL"]);
      const WARN_STATUSES = new Set(["WITHDRAWAL_UNMATCHED", "STATEMENT_ONLY_UNMATCHED", "QTY_MISMATCH"]);
      const allChecks = Object.values(transactionChecks).flat();
      const hasError = allChecks.some((c: any) => !OK_STATUSES.has(c.status) && !WARN_STATUSES.has(c.status));
      const allOk    = allChecks.every((c: any) => OK_STATUSES.has(c.status));
      const hasConservative = allChecks.some((c: any) => c.status === "CONSERVATIVE_EXTERNAL_DISPOSAL");

      const overallStatus = Object.keys(referenceForYear).length === 0
        ? "NO_REFERENCE_DATA"
        : allOk ? "OK"
        : hasError ? "DIFFERENCES"
        : "WARNINGS"; // all resolved but some are unmatched withdrawals (need manual review)

      res.json({
        year,
        overall_status: overallStatus,
        warning: overallStatus === "DIFFERENCES"
          ? "Diferencias entre extracto Revolut oficial y operaciones importadas en el bot. Verificar sincronización RevolutX para el año."
          : overallStatus === "WARNINGS"
          ? "FIFO sin errores críticos, pero existen movimientos externos (withdrawals) pendientes de conciliación completa."
          : overallStatus === "NO_REFERENCE_DATA"
          ? `No hay datos de referencia Revolut configurados para el año ${year}.`
          : null,
        note: "Los proceeds/fees se comparan en EUR usando tasa USD/EUR estimada. El PnL del exchange puede diferir del PnL fiscal FIFO global del bot.",
        report_can_be_finalized: !allChecks.some((c: any) => c.status === "WITHDRAWAL_UNMATCHED" || c.status === "STATEMENT_ONLY_UNMATCHED"),
        has_conservative_disposals: hasConservative,
        statement_items_summary: {
          total: stmtItemsQ.rows.length,
          matched_internal:       stmtItemsQ.rows.filter((r: any) => r.reconciliation_status === "matched_internal_transfer").length,
          conservative_disposal:  stmtItemsQ.rows.filter((r: any) => (r.classification ?? "") === "conservative_external_disposal").length,
          unmatched:              stmtItemsQ.rows.filter((r: any) => r.reconciliation_status === "unmatched").length,
          manual_review:          stmtItemsQ.rows.filter((r: any) => r.reconciliation_status === "manual_review").length,
        },
        revolut_reference: referenceForYear,
        bot_totals_by_asset: Object.fromEntries(
          Object.entries(botByAsset).map(([k, v]) => [k, {
            sell_count: v.sell_count,
            total_qty_sold:     v.total_qty_sold,
            total_proceeds_eur: v.total_proceeds_eur,
            total_fee_eur:      v.total_fee_eur,
            first_sell_date:    v.first_sell_date,
            last_sell_date:     v.last_sell_date,
          }])
        ),
        diffs,
        transaction_checks: transactionChecks,
        all_bot_operations: sellOpsQ.rows.map((r: any) => ({
          id: r.id, external_id: r.external_id, asset: r.asset,
          amount:    parseFloat(r.amount   ?? 0),
          total_eur: r.total_eur != null ? parseFloat(r.total_eur) : null,
          fee_eur:   r.fee_eur   != null ? parseFloat(r.fee_eur)   : null,
          price_eur: r.price_eur != null ? parseFloat(r.price_eur) : null,
          pair: r.pair, counter_asset: r.counter_asset,
          executed_at: r.executed_at,
        })),
        all_disposals: disposalsQ.rows.map((r: any) => ({
          disposal_id:      r.disposal_id,
          sell_operation_id: r.sell_operation_id,
          external_id:      r.external_id,
          asset:            r.asset,
          sell_amount:      parseFloat(r.sell_amount   ?? 0),
          sold_at:          r.sold_at,
          op_total_eur:     r.op_total_eur   != null ? parseFloat(r.op_total_eur)   : null,
          op_fee_eur:       r.op_fee_eur     != null ? parseFloat(r.op_fee_eur)     : null,
          quantity:         parseFloat(r.quantity      ?? 0),
          proceeds_eur:     parseFloat(r.proceeds_eur  ?? 0),
          cost_basis_eur:   parseFloat(r.cost_basis_eur ?? 0),
          gain_loss_eur:    parseFloat(r.gain_loss_eur  ?? 0),
          lot_id:           r.lot_id,
        })),
      });
    } catch (e: any) {
      console.error("[fisco/reconciliation/revolut]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // STATEMENT ITEMS — manual import of non-API movements
  // ============================================================

  /**
   * POST /api/fisco/statement-items
   * Manually import a non-order movement (e.g. RevolutX withdrawal not available via API).
   * Automatically runs TransferMatchingService to try to link with a deposit on another exchange.
   *
   * Body example (2025-12-14 RevolutX USDC withdrawal):
   * {
   *   "exchange": "revolutx", "year": 2025, "asset": "USDC",
   *   "statement_type": "withdrawal_crypto",
   *   "event_at": "2025-12-14T11:01:00Z",
   *   "amount_sent": 360, "fee_amount": 4.061928, "fee_asset": "USDC",
   *   "total_out": 364.061928, "network": "ethereum",
   *   "gross_proceeds_usd": 363.77, "cost_basis_usd": 364.06,
   *   "fees_usd": 4.39, "net_pnl_usd": -4.68,
   *   "transaction_identifier": "5243f5...142a4a",
   *   "source_document": "revolut_fiscal_statement_2025+screenshot"
   * }
   */
  app.post("/api/fisco/statement-items", async (req, res) => {
    try {
      const {
        exchange, year, asset, statement_type, event_at,
        amount_sent, fee_amount, fee_asset, total_out, network,
        gross_proceeds_usd, cost_basis_usd, fees_usd, net_pnl_usd,
        transaction_identifier, source_document, notes, raw_data_json,
      } = req.body;

      if (!exchange || !year || !asset || !statement_type || !event_at) {
        return res.status(400).json({ error: "Required: exchange, year, asset, statement_type, event_at" });
      }

      const insertR = await pool.query(`
        INSERT INTO fisco_external_statement_items (
          exchange, year, asset, statement_type, event_at,
          amount_sent, fee_amount, fee_asset, total_out, network,
          gross_proceeds_usd, cost_basis_usd, fees_usd, net_pnl_usd,
          transaction_identifier, source_document, notes, raw_data_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *
      `, [
        exchange, year, asset, statement_type, new Date(event_at),
        amount_sent ?? null, fee_amount ?? null, fee_asset ?? null,
        total_out ?? null, network ?? null,
        gross_proceeds_usd ?? null, cost_basis_usd ?? null,
        fees_usd ?? null, net_pnl_usd ?? null,
        transaction_identifier ?? null, source_document ?? null,
        notes ?? null, raw_data_json ?? null,
      ]);

      const item = insertR.rows[0];

      // Auto-run transfer matching for withdrawal types
      let matchResult: any = null;
      let linkId: number | null = null;

      if (
        statement_type === "withdrawal_crypto" &&
        amount_sent != null
      ) {
        try {
          const svc = new TransferMatchingService(pool);
          const w = {
            asset,
            amountSent: parseFloat(amount_sent),
            feeAmount:  parseFloat(fee_amount ?? 0),
            totalOut:   parseFloat(total_out ?? amount_sent),
            executedAt: new Date(event_at),
            network:    network ?? undefined,
            fromExchange: exchange,
            fromStatementItemId: item.id,
          };
          const { linkId: lid, result } = await svc.matchAndPersist(w);
          linkId = lid;
          matchResult = {
            matched:           result.matched,
            confidence:        result.confidence ?? null,
            time_diff_minutes: result.timeDiffMinutes ?? null,
            amount_delta:      result.amountDelta ?? null,
            reason:            result.reason,
            to_exchange:       result.candidate?.exchange ?? null,
            to_operation_id:   result.candidate?.operationId ?? null,
            to_external_id:    result.candidate?.externalId ?? null,
          };
        } catch (matchErr: any) {
          console.warn("[fisco/statement-items] auto-match failed (non-fatal):", matchErr.message);
          matchResult = { error: matchErr.message };
        }
      }

      // Re-fetch updated item
      const updatedR = await pool.query(
        `SELECT * FROM fisco_external_statement_items WHERE id = $1`, [item.id]
      );

      res.status(201).json({
        statement_item: updatedR.rows[0],
        transfer_link_id: linkId,
        auto_match: matchResult,
      });
    } catch (e: any) {
      console.error("[fisco/statement-items POST]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/statement-items?year=2025&exchange=revolutx&asset=USDC
   * List external statement items with optional filters.
   */
  app.get("/api/fisco/statement-items", async (req, res) => {
    try {
      const { year, exchange, asset, status } = req.query as Record<string, string>;
      const conds: string[] = [];
      const params: any[] = [];
      let p = 1;
      if (year)     { conds.push(`year = $${p++}`);                  params.push(parseInt(year)); }
      if (exchange) { conds.push(`exchange = $${p++}`);               params.push(exchange); }
      if (asset)    { conds.push(`asset = $${p++}`);                  params.push(asset); }
      if (status)   { conds.push(`reconciliation_status = $${p++}`);  params.push(status); }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

      const itemsQ = await pool.query(`
        SELECT si.*,
          tl.id AS link_id, tl.to_exchange, tl.to_operation_id,
          tl.confidence, tl.status AS link_status, tl.match_reason,
          fo.external_id AS deposit_external_id, fo.executed_at AS deposit_at
        FROM fisco_external_statement_items si
        LEFT JOIN fisco_transfer_links tl ON tl.id = si.matched_transfer_link_id
        LEFT JOIN fisco_operations fo      ON fo.id = tl.to_operation_id
        ${where}
        ORDER BY si.event_at DESC
      `, params);

      res.json({
        count: itemsQ.rows.length,
        items: itemsQ.rows,
      });
    } catch (e: any) {
      console.error("[fisco/statement-items GET]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/statement-items/:id/rematch
   * Re-run TransferMatchingService for an existing statement item.
   * Useful after importing new Kraken deposits.
   */
  app.post("/api/fisco/statement-items/:id/rematch", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const itemQ = await pool.query(
        `SELECT * FROM fisco_external_statement_items WHERE id = $1`, [id]
      );
      if (itemQ.rows.length === 0) {
        return res.status(404).json({ error: "Statement item not found" });
      }
      const item = itemQ.rows[0];

      if (item.statement_type !== "withdrawal_crypto" || !item.amount_sent) {
        return res.status(400).json({ error: "Only withdrawal_crypto items with amount_sent can be rematched" });
      }

      const svc = new TransferMatchingService(pool);
      const w = {
        asset:               item.asset,
        amountSent:          parseFloat(item.amount_sent),
        feeAmount:           parseFloat(item.fee_amount ?? 0),
        totalOut:            parseFloat(item.total_out ?? item.amount_sent),
        executedAt:          new Date(item.event_at),
        network:             item.network ?? undefined,
        fromExchange:        item.exchange,
        fromStatementItemId: item.id,
      };

      // Clear old link if exists
      if (item.matched_transfer_link_id) {
        await pool.query(`DELETE FROM fisco_transfer_links WHERE id = $1`, [item.matched_transfer_link_id]);
        await pool.query(`
          UPDATE fisco_external_statement_items
          SET reconciliation_status = 'unmatched', matched_transfer_link_id = NULL, matched_operation_id = NULL
          WHERE id = $1
        `, [id]);
        w.fromStatementItemId = id;
      }

      const { linkId, result } = await svc.matchAndPersist(w);

      res.json({
        link_id:    linkId,
        matched:    result.matched,
        confidence: result.confidence ?? null,
        reason:     result.reason,
        to_exchange: result.candidate?.exchange ?? null,
        to_operation_id: result.candidate?.operationId ?? null,
      });
    } catch (e: any) {
      console.error("[fisco/statement-items rematch]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/statement-items/:id/close-conservative
   * Closes an unmatched withdrawal as a CONSERVATIVE_EXTERNAL_DISPOSAL:
   *   - Computes proceeds_eur from market price at withdrawal date
   *   - Computes cost_basis_eur from FIFO lots (read-only, no lot modification)
   *   - Marks taxable = true, classification_source = conservative_assumption
   */
  app.post("/api/fisco/statement-items/:id/close-conservative", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const svc = new ConservativeDisposalService(pool);
      const result = await svc.closeAsConservative(id);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/close-conservative]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/statement-items/:id/reclassify
   * Reclassifies a statement item to any valid classification.
   * If previous classification was conservative_external_disposal, reverses the disposal:
   *   - Nulls out proceeds_eur, cost_basis_eur, gain_loss_eur
   *   - Sets conservative_reversed_at, conservative_reversed_to
   * Body: { classification: Classification, note?: string }
   */
  app.post("/api/fisco/statement-items/:id/reclassify", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const VALID_CLASSIFICATIONS: Classification[] = [
        "pending", "internal_transfer", "own_wallet", "external_disposal",
        "conservative_external_disposal", "payment", "gift",
      ];

      const { classification, note } = req.body as { classification?: Classification; note?: string };
      if (!classification || !VALID_CLASSIFICATIONS.includes(classification)) {
        return res.status(400).json({
          error: `classification must be one of: ${VALID_CLASSIFICATIONS.join(", ")}`,
        });
      }

      const svc = new ConservativeDisposalService(pool);
      const result = await svc.reclassify(id, classification, note);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/reclassify]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/conservative-close-all
   * Closes ALL unmatched withdrawals for a year as conservative_external_disposal.
   * Body: { year: number }
   * Returns: array of ConservativeResult
   */
  app.post("/api/fisco/conservative-close-all", async (req, res) => {
    try {
      const year = parseInt(req.body?.year ?? req.query.year as string);
      if (isNaN(year)) return res.status(400).json({ error: "year is required" });
      const svc = new ConservativeDisposalService(pool);
      const results = await svc.closeAllUnmatched(year);
      const summary = await svc.getSummary(year);
      res.json({
        year,
        processed: results.length,
        results,
        summary,
      });
    } catch (e: any) {
      console.error("[fisco/conservative-close-all]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/conservative-disposals?year=2025
   * Returns all conservative_external_disposal items for the year,
   * with computed proceeds/cost/gain_loss for the report section.
   */
  app.get("/api/fisco/conservative-disposals", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string ?? String(new Date().getFullYear()));
      const svc = new ConservativeDisposalService(pool);

      const [itemsQ, summary] = await Promise.all([
        pool.query(
          `SELECT id, exchange, year, asset, event_at, amount_sent, fee_amount, fee_asset,
                  total_out, network, market_price_eur, proceeds_eur, cost_basis_eur,
                  gain_loss_eur, finalized_at, finalized_note, classification_source,
                  conservative_reversed_at, conservative_reversed_to, notes
           FROM fisco_external_statement_items
           WHERE year = $1
             AND classification = 'conservative_external_disposal'
           ORDER BY event_at ASC`,
          [year]
        ),
        svc.getSummary(year),
      ]);

      res.json({
        year,
        count: itemsQ.rows.length,
        disposals: itemsQ.rows,
        summary,
      });
    } catch (e: any) {
      console.error("[fisco/conservative-disposals]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET /api/fisco/validate/portfolio
  // Portfolio arithmetic: start + entries - exits = end
  // ============================================================
  app.get("/api/fisco/validate/portfolio", async (req, res) => {
    try {
      const year     = parseInt(req.query.year as string) || new Date().getFullYear();
      const exchange = (req.query.exchange as string | undefined) || (req.query.scope === "global" ? null : null);
      const svc = new FiscoValidationService(pool);
      const result = await svc.validatePortfolio(year, exchange || null);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET /api/fisco/finalization-status
  // Composite finalization check: FIFO + portfolio + withdrawals + conservative + pending-changes
  // ============================================================
  app.get("/api/fisco/finalization-status", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const svc = new FiscoValidationService(pool);
      const result = await svc.getFinalizationStatus(year);

      // Include pending-changes check
      const detector = FiscoPendingDetector.getInstance();
      const pendingChanges = await detector.detectPendingFiscalChanges(year);

      // If there are pending operations or orphan sells, mark as not finalizable
      if (pendingChanges.pending_operations_count > 0) {
        result.report_can_be_finalized = false;
        result.warnings.push({
          code: "PENDING_OPERATIONS",
          asset: "multiple",
          detail: `${pendingChanges.pending_operations_count} operaciones pendientes de rebuild FIFO`,
          severity: "WARNING",
        } as any);
      }
      if (pendingChanges.orphan_sells_count > 0) {
        result.report_can_be_finalized = false;
        result.blockers.push({
          code: "ORPHAN_SELLS",
          asset: "multiple",
          detail: `${pendingChanges.orphan_sells_count} ventas huérfanas (sin base de coste)`,
          severity: "CRITICAL",
        } as any);
      }

      // Add pending-changes to result
      (result as any).pending_changes = pendingChanges;

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET /api/fisco/reconciliation/kraken
  // Validates Kraken-specific data (counts, lots, missing EUR, staking)
  // ============================================================
  app.get("/api/fisco/reconciliation/kraken", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const svc = new KrakenReconciliationService(pool);
      const result = await svc.reconcile(year);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // GET /api/fisco/reconciliation/summary
  // Global summary: Kraken + RevolutX + finalization status
  // ============================================================
  app.get("/api/fisco/reconciliation/summary", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const summaryYearStart = `${year}-01-01`;
      const summaryYearEnd   = `${year + 1}-01-01`;

      const [krakenResult, finalizationResult, revStmtQ, revOpsQ] = await Promise.all([
        new KrakenReconciliationService(pool).reconcile(year),
        new FiscoValidationService(pool).getFinalizationStatus(year),
        // RevolutX statement items — withdrawal% covers withdrawal_crypto too
        pool.query(`
          SELECT
            COUNT(*) FILTER (
              WHERE statement_type LIKE 'withdrawal%'
                AND COALESCE(classification,'pending') NOT IN ('internal_transfer','conservative_external_disposal')
            ) AS unmatched_withdrawals,
            COUNT(*) FILTER (WHERE classification = 'internal_transfer')             AS internal_transfers,
            COUNT(*) FILTER (WHERE classification = 'conservative_external_disposal') AS conservative_disposals,
            COUNT(*)                                                                   AS total_statement_items
          FROM fisco_external_statement_items
          WHERE year = $1 AND exchange = 'revolutx'
        `, [year]),
        // RevolutX op counts — independent from Kraken data
        pool.query(`
          SELECT
            COUNT(*)                                              AS total_operations,
            COUNT(*) FILTER (WHERE op_type = 'trade_buy')        AS trade_buy_count,
            COUNT(*) FILTER (WHERE op_type = 'trade_sell')       AS trade_sell_count,
            COUNT(*) FILTER (WHERE op_type = 'deposit')          AS deposits_count,
            COUNT(*) FILTER (WHERE op_type = 'withdrawal')       AS withdrawals_count
          FROM fisco_operations
          WHERE exchange = 'revolutx'
            AND executed_at >= $1::date
            AND executed_at <  $2::date
        `, [summaryYearStart, summaryYearEnd]),
      ]);

      const revRow    = revStmtQ.rows[0] ?? {};
      const revOpsRow = revOpsQ.rows[0]  ?? {};

      const revolutxSummary = {
        status:
          parseInt(revRow.unmatched_withdrawals ?? "0", 10) > 0 ? "WARNINGS" :
          finalizationResult.withdrawals_status === "CONSERVATIVE" ? "WARNINGS" : "OK",
        // RevolutX operation counts (correct — separate from Kraken)
        operations_count:               parseInt(revOpsRow.total_operations  ?? "0", 10),
        trade_buy_count:                parseInt(revOpsRow.trade_buy_count   ?? "0", 10),
        trade_sell_count:               parseInt(revOpsRow.trade_sell_count  ?? "0", 10),
        deposits_count:                 parseInt(revOpsRow.deposits_count    ?? "0", 10),
        withdrawals_count:              parseInt(revOpsRow.withdrawals_count ?? "0", 10),
        // Statement item metrics
        statement_items_count:          parseInt(revRow.total_statement_items  ?? "0", 10),
        internal_transfers_count:       parseInt(revRow.internal_transfers     ?? "0", 10),
        conservative_disposals_count:   parseInt(revRow.conservative_disposals ?? "0", 10),
        unmatched_withdrawals_count:    parseInt(revRow.unmatched_withdrawals   ?? "0", 10),
        statement_reconciliation_status:
          parseInt(revRow.unmatched_withdrawals ?? "0", 10) > 0 ? "PENDING" : "OK",
        warnings:
          parseInt(revRow.unmatched_withdrawals ?? "0", 10) > 0
            ? [`${revRow.unmatched_withdrawals} retira(s) sin clasificar — usar conservative-close-all`]
            : [],
      };

      // global_status reflects both finalization blockers AND Kraken WARNINGS
      const hasKrakenWarnings = krakenResult.status === "WARNINGS" || krakenResult.status === "DIFFERENCES";
      const hasKrakenDiff     = krakenResult.status === "DIFFERENCES";
      const globalStatus =
        !finalizationResult.report_can_be_finalized || hasKrakenDiff ? "NOT_FINALIZABLE" :
        hasKrakenWarnings                                             ? "OK_WITH_WARNINGS" :
                                                                        "OK";

      res.json({
        year,
        exchanges: {
          kraken:   krakenResult,
          revolutx: revolutxSummary,
        },
        global_status:            globalStatus,
        report_can_be_finalized:  finalizationResult.report_can_be_finalized && !hasKrakenDiff,
        kraken_warnings:          krakenResult.warnings,
        finalization_detail:      finalizationResult,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/debug/revolutx-ops?dateFrom=2025-12-14&dateTo=2025-12-15
   * Returns ALL fisco_operations for RevolutX in a given date range (any op_type).
   * Use to diagnose whether a specific order was fetched from the RevolutX API at all.
   */
  app.get("/api/fisco/debug/revolutx-ops", async (req, res) => {
    try {
      const { dateFrom, dateTo, year } = req.query as Record<string, string>;
      let fromDate: string;
      let toDate: string;
      if (year) {
        fromDate = `${year}-01-01`;
        toDate   = `${parseInt(year) + 1}-01-01`;
      } else {
        fromDate = dateFrom || "2025-01-01";
        toDate   = dateTo   || "2026-01-01";
      }

      const opsQ = await pool.query(`
        SELECT
          id,
          external_id,
          op_type,
          asset,
          amount::numeric         AS amount,
          price_eur::numeric      AS price_eur,
          total_eur::numeric      AS total_eur,
          fee_eur::numeric        AS fee_eur,
          counter_asset,
          pair,
          executed_at,
          raw_data
        FROM fisco_operations
        WHERE exchange = 'revolutx'
          AND executed_at >= $1::date
          AND executed_at < $2::date
        ORDER BY executed_at
      `, [fromDate, toDate]);

      const byDate: Record<string, any[]> = {};
      for (const r of opsQ.rows) {
        const d = new Date(r.executed_at).toISOString().split("T")[0];
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push({
          id:            r.id,
          external_id:   r.external_id,
          op_type:       r.op_type,
          asset:         r.asset,
          amount:        parseFloat(r.amount   ?? 0),
          price_eur:     r.price_eur  != null ? parseFloat(r.price_eur)  : null,
          total_eur:     r.total_eur  != null ? parseFloat(r.total_eur)  : null,
          fee_eur:       r.fee_eur    != null ? parseFloat(r.fee_eur)    : null,
          counter_asset: r.counter_asset,
          pair:          r.pair,
          executed_at:   r.executed_at,
          raw_data:      r.raw_data,
        });
      }

      // Summary: count by date and op_type
      const summary = Object.entries(byDate).map(([date, ops]) => ({
        date,
        op_count: ops.length,
        by_type: ops.reduce((acc: Record<string, number>, op) => {
          acc[op.op_type] = (acc[op.op_type] || 0) + 1;
          return acc;
        }, {}),
        assets: [...new Set(ops.map((op) => op.asset))],
      }));

      res.json({
        date_range: { from: fromDate, to: toDate },
        total_ops:  opsQ.rows.length,
        summary,
        ops_by_date: byDate,
      });
    } catch (e: any) {
      console.error("[fisco/debug/revolutx-ops]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/transactions-report?year=&exchange=&asset=
   * Returns detailed transaction list for HTML report generation.
   */
  app.get("/api/fisco/transactions-report", async (req, res) => {
    try {
      const { year, exchange, asset, type } = req.query as Record<string, string>;
      const conditions: string[] = [];
      const params: any[] = [];
      let pIdx = 1;
      if (year) {
        conditions.push(`EXTRACT(YEAR FROM o.executed_at) = $${pIdx++}`);
        params.push(parseInt(year));
      }
      if (exchange) {
        conditions.push(`o.exchange = $${pIdx++}`);
        params.push(exchange);
      }
      if (asset) {
        conditions.push(`o.asset = $${pIdx++}`);
        params.push(asset);
      }
      if (type) {
        conditions.push(`o.op_type = $${pIdx++}`);
        params.push(type);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const ops = await pool.query(`
        SELECT
          o.id, o.exchange, o.external_id, o.op_type, o.asset, o.amount,
          o.price_eur, o.total_eur, o.fee_eur, o.counter_asset, o.pair, o.executed_at,
          COALESCE(
            (SELECT SUM(d.gain_loss_eur) FROM fisco_disposals d WHERE d.sell_operation_id = o.id),
            NULL
          ) AS realized_gain_eur,
          COALESCE(
            (SELECT COUNT(*) FROM fisco_disposals d WHERE d.sell_operation_id = o.id
             AND d.lot_id IS NULL),
            0
          ) AS unknown_basis_count
        FROM fisco_operations o
        ${where}
        ORDER BY o.executed_at ASC
      `, params);
      return res.json({ count: ops.rows.length, transactions: ops.rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Debug: inspect Kraken ledger refid
  // ============================================================

  /**
   * GET /api/fisco/debug/kraken-ledger-ref/:refid
   * Returns all staging operations whose external_id matches the given refid prefix,
   * plus their raw_data (original ledger entries) from the latest dry-run.
   * Useful to diagnose receive/spend/deposit misclassifications.
   */
  app.get("/api/fisco/debug/kraken-ledger-ref/:refid", async (req, res) => {
    try {
      const { refid } = req.params;
      if (!refid || refid.length < 3) return res.status(400).json({ error: "refid too short" });

      // Latest dry-run id for context
      const runRow = await pool.query(
        `SELECT id, started_at FROM fisco_rebuild_runs
         WHERE mode='dry_run' AND status='completed_dry'
         ORDER BY started_at DESC LIMIT 1`
      );
      const runId: string | null = runRow.rows[0]?.id ?? null;

      // Query staging ops across all runs that match the refid prefix
      const stagingQ = await pool.query(
        `SELECT
           so.external_id, so.exchange, so.op_type, so.asset,
           so.amount::float, so.price_eur::float, so.total_eur::float,
           so.fee_eur::float, so.counter_asset, so.pair,
           so.executed_at, so.requires_eur_price,
           so.raw_data,
           rr.started_at AS run_started_at,
           rr.mode AS run_mode
         FROM fisco_staging_operations so
         JOIN fisco_rebuild_runs rr ON rr.id = so.rebuild_run_id
         WHERE so.external_id LIKE $1
         ORDER BY rr.started_at DESC, so.executed_at ASC
         LIMIT 50`,
        [`${refid}%`]
      );

      const ops = stagingQ.rows;

      // Annotate with parsed raw_data
      const annotated = ops.map((op: any) => {
        const rawEntries: any[] = Array.isArray(op.raw_data) ? op.raw_data : [op.raw_data];
        return {
          externalId: op.external_id,
          exchange: op.exchange,
          opType: op.op_type,
          asset: op.asset,
          amount: op.amount,
          priceEur: op.price_eur,
          totalEur: op.total_eur,
          feeEur: op.fee_eur,
          counterAsset: op.counter_asset,
          pair: op.pair,
          executedAt: op.executed_at,
          requiresEurPrice: op.requires_eur_price,
          runStartedAt: op.run_started_at,
          runMode: op.run_mode,
          rawLedgerEntries: rawEntries.map((e: any) => ({
            id: e.id,
            refid: e.refid,
            type: e.type,
            subtype: e.subtype,
            asset: e.asset,
            amount: e.amount,
            fee: e.fee,
            balance: e.balance,
            time: e.time,
            timeISO: e.time ? new Date(e.time * 1000).toISOString() : null,
          })),
        };
      });

      // Human-readable diagnosis
      const diagnosis: string[] = [];
      if (ops.length === 0) {
        diagnosis.push(
          `No staging operations found for refid prefix "${refid}". ` +
          `Possible causes: (1) normalizer skipped it (e.g. internal same-asset transfer), ` +
          `(2) unhandled ledger type, (3) no completed dry-run exists yet.`
        );
      } else {
        for (const op of annotated) {
          const entries = op.rawLedgerEntries;
          const types = [...new Set(entries.map((e: any) => e.type as string))].join("/");
          const assets = entries
            .map((e: any) => `${e.asset}(${e.amount > 0 ? "+" : ""}${e.amount})`)
            .join(", ");
          diagnosis.push(
            `${op.externalId}: ledgerType=${types} raw=[${assets}]` +
            ` → normalizedAs=${op.opType} ${op.asset} ${op.amount}`
          );
        }
      }

      return res.json({
        refid,
        latestRunId: runId,
        latestRunStartedAt: runRow.rows[0]?.started_at ?? null,
        matchedOpsCount: ops.length,
        diagnosis,
        operations: annotated,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CENTRO DE INFORMES Y EXPORTACIONES FISCALES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/fisco/report/multi-year
   * Multi-year fiscal audit report (JSON or HTML).
   * Query params: years=2024,2025,2026 | exchanges=kraken,revolutx | includeGlobal=true |
   *               includeExchangeBreakdown=true | includeOperations=false | format=json|html
   */
  app.get("/api/fisco/report/multi-year", async (req, res) => {
    try {
      const {
        years:     yearsParam     = "2025,2026",
        exchanges: exchangesParam = "kraken,revolutx",
        includeGlobal           = "true",
        includeExchangeBreakdown = "false",
        format                  = "json",
      } = req.query as Record<string, string>;

      const years     = yearsParam.split(",").map(y => parseInt(y.trim(), 10)).filter(y => !isNaN(y));
      const exchanges = exchangesParam.split(",").map(e => e.trim().toLowerCase());

      const svc    = new MultiYearReportService(pool);
      const report = await svc.generate({
        years,
        exchanges,
        includeGlobal:            includeGlobal === "true",
        includeExchangeBreakdown: includeExchangeBreakdown === "true",
      });

      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(svc.renderHtml(report));
      }
      return res.json(report);
    } catch (e: any) {
      console.error("[fisco/report/multi-year]", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── CSV Exports ──────────────────────────────────────────────────────────

  function parseExportParams(query: Record<string, string>) {
    const years     = query.years     ? query.years.split(",").map(y => parseInt(y.trim(), 10)).filter(y => !isNaN(y)) : undefined;
    const exchanges = query.exchanges ? query.exchanges.split(",").map(e => e.trim().toLowerCase()) : undefined;
    const delimiter = (query.delimiter === "semicolon" ? "semicolon" : "comma") as "comma" | "semicolon";
    const includeRaw = query.includeRaw === "true";
    return { years, exchanges, delimiter, includeRaw };
  }

  /**
   * GET /api/fisco/export/operations.csv
   * Exports fisco_operations as CSV.
   */
  app.get("/api/fisco/export/operations.csv", async (req, res) => {
    try {
      const opts = parseExportParams(req.query as Record<string, string>);
      const csv  = await new FiscoExportService(pool).exportOperationsCsv(opts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fisco_operations.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/export/disposals.csv
   * Exports fisco_disposals as CSV.
   */
  app.get("/api/fisco/export/disposals.csv", async (req, res) => {
    try {
      const opts = parseExportParams(req.query as Record<string, string>);
      const csv  = await new FiscoExportService(pool).exportDisposalsCsv(opts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fisco_disposals.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/export/lots.csv
   * Exports fisco_lots as CSV.
   */
  app.get("/api/fisco/export/lots.csv", async (req, res) => {
    try {
      const opts = parseExportParams(req.query as Record<string, string>);
      const csv  = await new FiscoExportService(pool).exportLotsCsv(opts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fisco_lots.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/export/statement-items.csv
   * Exports fisco_external_statement_items as CSV.
   */
  app.get("/api/fisco/export/statement-items.csv", async (req, res) => {
    try {
      const opts = parseExportParams(req.query as Record<string, string>);
      const csv  = await new FiscoExportService(pool).exportStatementItemsCsv(opts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fisco_statement_items.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/export/conservative-disposals.csv
   * Exports conservative_external_disposal items as CSV.
   */
  app.get("/api/fisco/export/conservative-disposals.csv", async (req, res) => {
    try {
      const opts = parseExportParams(req.query as Record<string, string>);
      const csv  = await new FiscoExportService(pool).exportConservativeDisposalsCsv(opts);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fisco_conservative_disposals.csv"');
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/report/annual/html
   * Returns a complete, interactive annual fiscal HTML report in Spanish.
   * Query params: year=YYYY | exchange=kraken|revolutx|all
   */
  app.get("/api/fisco/report/annual/html", async (req, res) => {
    try {
      const year      = parseInt((req.query.year as string) || "2025", 10);
      const exchParam = (req.query.exchange as string) || "all";
      const exchanges = exchParam === "all" ? ["kraken", "revolutx"] :
                        exchParam === "global" ? ["kraken", "revolutx"] :
                        exchParam.split(",").map(e => e.trim()).filter(Boolean);

      const { buildAnnualHtmlReportData } = await import("../services/fisco/FiscoHtmlRenderer");
      const renderer = new FiscoHtmlRenderer(pool);

      const reportData = await buildAnnualHtmlReportData(pool, year, exchanges);
      const html = await renderer.renderAnnualHtml(reportData);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[fisco/report/annual/html]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/export/audit-pack.zip
   * Generates a ZIP with HTML reports + all CSVs + JSON metadata.
   * Query params: years=2024,2025,2026 | exchanges=kraken,revolutx | includeRaw=false
   */
  app.get("/api/fisco/export/audit-pack.zip", async (req, res) => {
    try {
      const opts       = parseExportParams(req.query as Record<string, string>);
      const years      = opts.years      ?? [2025, 2026];
      const exchanges  = opts.exchanges  ?? ["kraken", "revolutx"];
      const exportSvc  = new FiscoExportService(pool);
      const reportSvc  = new MultiYearReportService(pool);
      const validSvc   = new FiscoValidationService(pool);

      // Generate all data in parallel
      const [opscsv, dispCsv, lotsCsv, stmtCsv, consDisCsv, multiReport, counts] = await Promise.all([
        exportSvc.exportOperationsCsv({ years, exchanges, delimiter: opts.delimiter }),
        exportSvc.exportDisposalsCsv({ years, exchanges, delimiter: opts.delimiter }),
        exportSvc.exportLotsCsv({ exchanges, delimiter: opts.delimiter }),
        exportSvc.exportStatementItemsCsv({ years, exchanges, delimiter: opts.delimiter }),
        exportSvc.exportConservativeDisposalsCsv({ years, exchanges, delimiter: opts.delimiter }),
        reportSvc.generate({ years, exchanges, includeGlobal: true, includeExchangeBreakdown: false }),
        exportSvc.getCounts({ years, exchanges }),
      ]);

      // Per-year HTML reports + finalization
      const yearHtmls: Record<number, string> = {};
      const finByYear: Record<number, any>    = {};
      const portByYear: Record<number, any>   = {};
      for (const yr of years) {
        const [fin, port] = await Promise.all([
          validSvc.getFinalizationStatus(yr),
          validSvc.validatePortfolio(yr, null),
        ]);
        finByYear[yr]  = fin;
        portByYear[yr] = port;
      }

      const renderer  = new FiscoHtmlRenderer(pool);
      const { buildAnnualHtmlReportData } = await import("../services/fisco/FiscoHtmlRenderer");
      const multiHtml = reportSvc.renderHtml(multiReport);
      // Per-year full HTML reports using canonical data builder
      for (const yr of years) {
        const reportData = await buildAnnualHtmlReportData(pool, yr, exchanges);
        const annualHtml = await renderer.renderAnnualHtml(reportData);
        yearHtmls[yr] = annualHtml;
      }

      // audit_metadata.json
      const auditMeta = {
        generated_at:    new Date().toISOString(),
        years,
        exchanges,
        filters_applied: { years, exchanges, includeRaw: opts.includeRaw },
        counts,
        report_can_be_finalized_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.report_can_be_finalized]),
        ),
        ordinary_fifo_gain_loss_eur_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.ordinary_fifo_gain_loss_eur]),
        ),
        conservative_external_disposals_gain_loss_eur_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.conservative_external_disposals_gain_loss_eur]),
        ),
        final_taxable_gain_loss_eur_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.final_taxable_gain_loss_eur]),
        ),
        blockers_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.blockers]),
        ),
        warnings_by_year: Object.fromEntries(
          multiReport.global_summary.totals_by_year.map(y => [y.year, y.kraken_warnings]),
        ),
        accumulated_total_for_audit_only: multiReport.global_summary.accumulated_total_for_audit_only,
      };

      // Build ZIP with JSZip (pure JS, works in all bundled environments)
      const zip = new JSZip();
      zip.file("reports/informe_multi_year.html", multiHtml);
      for (const yr of years) {
        zip.file(`reports/informe_anual_${yr}.html`, yearHtmls[yr] ?? "");
        zip.file(`json/finalization_status_${yr}.json`, JSON.stringify(finByYear[yr], null, 2));
        zip.file(`json/portfolio_validation_${yr}.json`, JSON.stringify(portByYear[yr], null, 2));
      }
      zip.file("csv/fisco_operations.csv",              opscsv);
      zip.file("csv/fisco_disposals.csv",               dispCsv);
      zip.file("csv/fisco_lots.csv",                    lotsCsv);
      zip.file("csv/fisco_statement_items.csv",         stmtCsv);
      zip.file("csv/fisco_conservative_disposals.csv",  consDisCsv);
      zip.file("json/reconciliation_summary.json",      JSON.stringify(multiReport, null, 2));
      zip.file("json/audit_metadata.json",              JSON.stringify(auditMeta, null, 2));

      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="fisco_audit_${years.join("-")}.zip"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (e: any) {
      console.error("[fisco/export/audit-pack.zip]", e);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // AUTO-SYNC ENDPOINTS
  // ============================================================

  const autoSyncService = FiscoAutoSyncService.getInstance();

  /**
   * GET /api/fisco/auto-sync/status
   * Get current auto-sync status (last job, next scheduled, next retry)
   */
  app.get("/api/fisco/auto-sync/status", async (req, res) => {
    try {
      const status = await autoSyncService.getStatus();
      res.json(status);
    } catch (e: any) {
      console.error("[fisco/auto-sync/status]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/auto-sync/history
   * Get history of auto-sync jobs
   */
  app.get("/api/fisco/auto-sync/history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const jobs = await autoSyncService.getLatestJobs(limit);
      res.json(jobs);
    } catch (e: any) {
      console.error("[fisco/auto-sync/history]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/auto-sync/jobs/:id
   * Get specific job by ID with running time and phase info
   */
  app.get("/api/fisco/auto-sync/jobs/:id", async (req, res) => {
    try {
      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) {
        return res.status(400).json({ error: "Invalid job ID" });
      }

      const job = await autoSyncService.getJobById(jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Calculate running time if job is running
      let runningForSeconds = null;
      if (job.status === "running" && job.started_at) {
        runningForSeconds = Math.floor((Date.now() - job.started_at.getTime()) / 1000);
      }

      res.json({
        ...job,
        runningForSeconds,
      });
    } catch (e: any) {
      console.error("[fisco/auto-sync/jobs/:id]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/auto-sync/run-now
   * Trigger auto-sync immediately (useful for testing or manual trigger)
   * Returns 202 Accepted immediately, processes job in background
   */
  app.post("/api/fisco/auto-sync/run-now", async (req, res) => {
    try {
      const { year, timezone, forceSync } = req.body || {};
      const { jobId, status } = await autoSyncService.runAutoSync({ year, timezone, forceSync });

      // Process job in background
      setImmediate(async () => {
        try {
          await autoSyncService.processAutoSyncJob(jobId, { year, timezone, forceSync });
        } catch (error: any) {
          console.error(`[fisco/auto-sync/run-now] Background processing failed for job ${jobId}:`, error);
        }
      });

      res.status(202).json({
        accepted: true,
        jobId,
        status,
        message: "Auto-sync started in background",
      });
    } catch (e: any) {
      console.error("[fisco/auto-sync/run-now]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/pending-changes
   * Detects operations pending FIFO rebuild and orphan sells for the given year.
   * Safe read-only endpoint used by the manual rebuild UI to warn before commit.
   */
  app.get("/api/fisco/pending-changes", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const detector = FiscoPendingDetector.getInstance();
      const result = await detector.detectPendingFiscalChanges(year);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/pending-changes]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // LOTE 1 — DIAGNÓSTICO: Inventory Snapshot + Balance Check
  // ============================================================

  /**
   * GET /api/fisco/inventory-snapshot?year=2025
   * Calcula inventario histórico correcto a cierre de año.
   * closing_qty = opening + acquired_in_year - disposed_in_year
   * (no usa fl.remaining_qty que incluye disposals de años futuros)
   */
  app.get("/api/fisco/inventory-snapshot", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      if (isNaN(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }
      const svc = new FiscoInventorySnapshotService(pool);
      const result = await svc.getInventorySnapshot(year);
      return res.json(result);
    } catch (e: any) {
      console.error("[fisco/inventory-snapshot]", e);
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/balance-check?year=2025
   * Diagnóstico de coherencia fiscal:
   *   - rewards sin precio EUR
   *   - deposits sin cost basis
   *   - ventas sin base de coste (CRITICAL)
   *   - withdrawals sin transfer_link
   *   - crypto fees no descontadas
   *   - dust positions
   */
  app.get("/api/fisco/balance-check", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      if (isNaN(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }
      const svc = new FiscoInventorySnapshotService(pool);
      const result = await svc.getInventorySnapshot(year);
      return res.json(result.balanceCheck);
    } catch (e: any) {
      console.error("[fisco/balance-check]", e);
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/transfer-links?year=YYYY&dateBasis=economic|created
   * Lista transfer links del año con columnas reales de fisco_transfer_links.
   * dateBasis=economic (default): filtra por from_executed_at o to_executed_at
   * dateBasis=created: filtra por created_at/matched_at
   * Schema-safe: no usa columna "amount" (no existe), usa amount_sent/amount_received/fee_amount.
   */
  app.get("/api/fisco/transfer-links", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      if (isNaN(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }
      const dateBasis = (req.query.dateBasis as string) || "economic";
      if (dateBasis !== "economic" && dateBasis !== "created") {
        return res.status(400).json({ error: "dateBasis must be 'economic' or 'created'" });
      }
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year + 1}-01-01`;

      let whereClause = "";
      if (dateBasis === "economic") {
        // Filter by economic dates (COALESCE of from_executed_at or to_executed_at)
        // Only use created_at as fallback if BOTH from_executed_at and to_executed_at are NULL
        whereClause = `
          WHERE (
            CASE
              WHEN fo_from.executed_at IS NOT NULL THEN fo_from.executed_at
              WHEN fo_to.executed_at IS NOT NULL THEN fo_to.executed_at
              ELSE NULL
            END
          ) >= $1::date
          AND (
            CASE
              WHEN fo_from.executed_at IS NOT NULL THEN fo_from.executed_at
              WHEN fo_to.executed_at IS NOT NULL THEN fo_to.executed_at
              ELSE NULL
            END
          ) < $2::date
        `;
      } else {
        // Filter by created/matched dates
        whereClause = `
          WHERE (
            ftl.matched_at >= $1::date AND ftl.matched_at < $2::date
            OR
            (ftl.matched_at IS NULL AND ftl.created_at >= $1::date AND ftl.created_at < $2::date)
          )
        `;
      }

      const result = await pool.query(`
        SELECT
          ftl.id,
          ftl.asset,
          ftl.from_exchange,
          ftl.to_exchange,
          ftl.amount_sent,
          ftl.amount_received,
          ftl.fee_amount,
          ftl.fee_asset,
          ftl.network,
          ftl.tx_hash,
          ftl.confidence,
          ftl.status,
          ftl.match_reason,
          ftl.matched_at,
          ftl.created_at,
          -- Source operation info
          fo_from.executed_at AS from_executed_at,
          fo_from.external_id AS from_external_id,
          -- Destination operation info
          fo_to.executed_at   AS to_executed_at,
          fo_to.exchange      AS to_exchange_confirmed
        FROM fisco_transfer_links ftl
        LEFT JOIN fisco_operations fo_from ON fo_from.id = ftl.from_operation_id
        LEFT JOIN fisco_operations fo_to   ON fo_to.id   = ftl.to_operation_id
        ${whereClause}
        ORDER BY ftl.created_at DESC
      `, [yearStart, yearEnd]);

      return res.json({
        year,
        dateBasisUsed: dateBasis,
        count: result.rows.length,
        links: result.rows,
      });
    } catch (e: any) {
      console.error("[fisco/transfer-links]", e);
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/auto-sync/retry-failed
   * Retry a failed job
   */
  app.post("/api/fisco/auto-sync/retry-failed", async (req, res) => {
    try {
      const { jobId } = req.body;
      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }
      const result = await autoSyncService.retryFailedJob(jobId);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/auto-sync/retry-failed]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // FISCO V2: Import Preview / Confirm
  // ============================================================

  /**
   * POST /api/fisco/import-preview
   * Parse CSV (Kraken Ledger or RevolutX orders), normalize, dedupe, and preview.
   * Dry-run: stores in fisco_import_batches with status='preview'.
   * Accepts multipart/form-data with 'file' field.
   */
  app.post("/api/fisco/import-preview", upload.single("file"), async (req, res) => {
    try {
      const { exchange, options, dry_run } = req.body;
      const file = req.file;

      if (!exchange) {
        return res.status(400).json({ error: "exchange is required" });
      }
      if (!file) {
        return res.status(400).json({ error: "file is required (multipart/form-data)" });
      }
      if (exchange !== "kraken" && exchange !== "revolutx") {
        return res.status(400).json({ error: "exchange must be 'kraken' or 'revolutx'" });
      }

      // Convert buffer to string
      const csvContent = file.buffer.toString("utf-8");

      const importOptions: ImportOptions = options ? JSON.parse(options) : {
        includeNormal: true,
        includeThirdFees: true,
        includeStaking: true,
        includeDeposits: true,
        includeWithdrawals: true,
        skipFiatDepositsWithdrawals: true,
        detectDuplicates: true,
        reconcileTransfers: true,
      };

      const result = await createImportPreview(exchange, csvContent, importOptions, dry_run !== false);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/import-preview]", e);
      if (e.code === "FISCO_IMPORT_SCHEMA_MISSING") {
        return res.status(503).json({ error: e.message, code: "FISCO_IMPORT_SCHEMA_MISSING" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/import-confirm
   * Confirm a preview batch: insert normalized operations into fisco_operations.
   */
  app.post("/api/fisco/import-confirm", async (req, res) => {
    try {
      const { import_batch_id, exchange, options } = req.body;
      if (!import_batch_id || !exchange) {
        return res.status(400).json({ error: "import_batch_id and exchange are required" });
      }

      const importOptions: ImportOptions = options || {
        includeNormal: true,
        includeThirdFees: true,
        includeStaking: true,
        includeDeposits: true,
        includeWithdrawals: true,
        skipFiatDepositsWithdrawals: true,
        detectDuplicates: true,
        reconcileTransfers: true,
      };

      const result = await confirmImport(import_batch_id, exchange, importOptions);
      res.json(result);
    } catch (e: any) {
      console.error("[fisco/import-confirm]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/import-batches?year=YYYY
   * List import batches for a year.
   */
  app.get("/api/fisco/import-batches", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const batches = await getImportBatches(year);
      res.json({ batches });
    } catch (e: any) {
      console.error("[fisco/import-batches]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/import-batches/:id
   * Get a single import batch with rows.
   */
  app.get("/api/fisco/import-batches/:id", async (req, res) => {
    try {
      const batch = await getImportBatch(req.params.id);
      const rowsResult = await pool.query(
        "SELECT * FROM fisco_import_rows WHERE import_batch_id = $1 ORDER BY row_number",
        [req.params.id]
      );
      res.json({ batch, rows: rowsResult.rows });
    } catch (e: any) {
      console.error("[fisco/import-batches/:id]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // FISCO V2: Config & Finalization Status
  // ============================================================

  /**
   * GET /api/fisco/config
   * Get current FISCO V2 configuration.
   */
  app.get("/api/fisco/config", async (req, res) => {
    try {
      const config = await getFiscoConfig();
      res.json(config);
    } catch (e: any) {
      console.error("[fisco/config]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PUT /api/fisco/config
   * Update FISCO V2 configuration (partial update).
   */
  app.put("/api/fisco/config", async (req, res) => {
    try {
      await setFiscoConfig(req.body);
      const updated = await getFiscoConfig();
      res.json(updated);
    } catch (e: any) {
      console.error("[fisco/config PUT]", e);
      if (e.code === "FISCO_CONFIG_SCHEMA_MISSING") {
        return res.status(503).json({ error: e.message, code: "FISCO_CONFIG_SCHEMA_MISSING" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/comparison?year=YYYY
   * Compare baseline (legacy) vs V2 (shadow) results.
   */
  app.get("/api/fisco/comparison", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      if (isNaN(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }
      const comparison = await runComparison(year);
      res.json(comparison);
    } catch (e: any) {
      console.error("[fisco/comparison]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/fisco/rebuild-v2
   * Run FIFO V2 shadow rebuild (dry-run, does not modify official data).
   */
  app.post("/api/fisco/rebuild-v2", async (req, res) => {
    try {
      const { year, mode } = req.body;
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      if (isNaN(targetYear) || targetYear < 2020 || targetYear > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }

      const rebuildMode = mode || "dry_run";
      if (rebuildMode !== "dry_run" && rebuildMode !== "shadow") {
        return res.status(400).json({ error: "mode must be 'dry_run' or 'shadow'" });
      }

      // Run comparison (which executes FIFO V2)
      const comparison = await runComparison(targetYear);

      res.json({
        year: targetYear,
        mode: rebuildMode,
        engine: "v2_shadow",
        result: comparison,
        is_safe_for_report: comparison.is_safe_for_report,
        generated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[fisco/rebuild-v2]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/withdrawal-review?year=YYYY
   * List withdrawals without transfer_link for manual review.
   */
  app.get("/api/fisco/withdrawal-review", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      if (isNaN(year) || year < 2020 || year > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }

      // Get withdrawals without transfer_link
      const withdrawalsResult = await pool.query(`
        SELECT
          id as operation_id,
          exchange,
          asset,
          amount,
          fee_eur,
          total_eur,
          executed_at,
          external_id
        FROM fisco_operations
        WHERE op_type = 'withdrawal'
          AND executed_at >= $1
          AND executed_at < $2
          AND id NOT IN (SELECT from_operation_id FROM fisco_transfer_links WHERE from_operation_id IS NOT NULL)
        ORDER BY executed_at DESC
      `, [`${year}-01-01`, `${year + 1}-01-01`]);

      const withdrawals = withdrawalsResult.rows.map((w: any) => ({
        operation_id: w.operation_id,
        exchange: w.exchange,
        asset: w.asset,
        amount: parseFloat(w.amount),
        fee_eur: w.fee_eur ? parseFloat(w.fee_eur) : 0,
        total_eur: w.total_eur ? parseFloat(w.total_eur) : null,
        executed_at: w.executed_at,
        external_id: w.external_id,
        compatible_deposit_candidates: [], // TODO: Find compatible deposits (async query)
        classification: "EXTERNAL_WITHDRAWAL_REVIEW",
        recommended_action: "Revisar destino externo; documentar si fue wallet propia, gasto, pérdida o transferencia a exchange no importado.",
      }));

      res.json({
        year,
        withdrawals,
        count: withdrawals.length,
        generated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[fisco/withdrawal-review]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/fisco/schema-health
   * Verifica que las tablas FISCO V2 existan.
   */
  app.get("/api/fisco/schema-health", async (req, res) => {
    try {
      const tables = [
        "fisco_import_batches",
        "fisco_import_rows",
        "fisco_config",
        "fisco_operations",
        "fisco_disposals",
        "fisco_transfer_links",
      ];

      const results: Record<string, boolean> = {};
      for (const table of tables) {
        const result = await pool.query(
          "SELECT to_regclass($1) as exists",
          [`public.${table}`]
        );
        results[table] = result.rows[0].exists !== null;
      }

      const allExist = Object.values(results).every(v => v);

      res.json({
        healthy: allExist,
        tables: results,
        missing_tables: Object.entries(results)
          .filter(([_, exists]) => !exists)
          .map(([table]) => table),
        generated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[fisco/schema-health]", e);
      res.status(500).json({ error: e.message });
    }
  });
}
