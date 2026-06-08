import type { Express } from "express";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";
import type { RouterDeps } from "./types";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort, type NormalizedOperation } from "../services/fisco/normalizer";
import { runFifo, validateFifoResult } from "../services/fisco/fifo-engine";
import { getUsdToEurRate, getCachedUsdEurRate } from "../services/fisco/eur-rates";
import { fiscoRebuildService } from "../services/FiscoRebuildService";
import { isFiscoRebuildActive } from "../services/fisco/rebuild-state";
import { pool } from "../db";

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
      const gainsQ = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric > 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) as ganancias,
          COALESCE(SUM(CASE WHEN d.gain_loss_eur::numeric < 0 THEN d.gain_loss_eur::numeric ELSE 0 END), 0) as perdidas,
          COALESCE(SUM(d.gain_loss_eur::numeric), 0) as total
        FROM fisco_disposals d
        JOIN fisco_operations o ON o.id = d.sell_operation_id
        WHERE EXTRACT(YEAR FROM d.disposed_at) = $1 ${exchWhere}
      `, [year]);

      const sectionA = {
        year,
        ganancias_eur: Math.round((gainsQ.rows[0]?.ganancias || 0) * 100) / 100,
        perdidas_eur: Math.round((gainsQ.rows[0]?.perdidas || 0) * 100) / 100,
        total_eur: Math.round((gainsQ.rows[0]?.total || 0) * 100) / 100,
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

      const sectionD: any[] = [];
      for (const r of lotsBalanceQ.rows) {
        const saldo_fin = Math.round(parseFloat(r.saldo_fin) * 1e8) / 1e8;
        const entradas  = Math.round((yearInflows.get(r.asset) ?? 0) * 1e8) / 1e8;
        const salidas   = Math.round((yearOutflows.get(r.asset) ?? 0) * 1e8) / 1e8;
        // Backcompute saldo_inicio from FIFO ground-truth saldo_fin (never negative)
        const saldo_inicio = Math.max(0, Math.round((saldo_fin - entradas + salidas) * 1e8) / 1e8);
        const exchFromLots: string[] = r.exchanges ?? [];
        const exchFromOps = Array.from(yearExchanges.get(r.asset) ?? []);
        const exchanges = [...new Set([...exchFromLots, ...exchFromOps])];
        sectionD.push({ asset: r.asset, exchanges, saldo_inicio, entradas, salidas, saldo_fin });
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
      const exchClause = exchange ? `AND so.exchange = '${exchange}'` : "";

      const disposals = await pool.query(`
        SELECT
          d.id                      AS disposal_id,
          so.id                     AS sell_operation_id,
          so.exchange               AS sell_exchange,
          so.external_id            AS sell_external_id,
          so.executed_at            AS sold_at,
          so.asset,
          d.quantity::numeric       AS quantity,
          d.proceeds_eur::numeric   AS proceeds_eur,
          d.cost_basis_eur::numeric AS cost_basis_eur,
          d.gain_loss_eur::numeric  AS gain_loss_eur,
          d.fee_eur::numeric        AS fee_eur,
          d.lot_id,
          fl.acquired_at            AS lot_acquired_at,
          fl.quantity::numeric      AS lot_quantity,
          fl.remaining_qty::numeric AS lot_remaining_qty,
          fl.cost_eur::numeric      AS lot_cost_eur,
          fl.unit_cost_eur::numeric AS lot_unit_cost_eur,
          bo.exchange               AS buy_exchange,
          bo.external_id            AS buy_external_id,
          bo.op_type                AS buy_op_type,
          bo.amount::numeric        AS buy_amount,
          bo.price_eur::numeric     AS buy_price_eur,
          bo.total_eur::numeric     AS buy_total_eur,
          bo.executed_at            AS buy_executed_at
        FROM fisco_disposals d
        JOIN fisco_operations so ON so.id = d.sell_operation_id
        LEFT JOIN fisco_lots fl ON fl.id = d.lot_id
        LEFT JOIN fisco_operations bo ON bo.id = fl.operation_id
        WHERE so.asset = 'USDC'
          AND so.executed_at >= $1::date
          AND so.executed_at < ($1::date + interval '1 year')
          ${exchClause}
        ORDER BY so.executed_at, d.id
      `, [`${year}-01-01`]);

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
}
