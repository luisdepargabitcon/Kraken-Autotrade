import type { Express } from "express";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";
import type { RouterDeps } from "./types";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort, type NormalizedOperation } from "../services/fisco/normalizer";
import { runFifo } from "../services/fisco/fifo-engine";
import { getUsdToEurRate, getCachedUsdEurRate } from "../services/fisco/eur-rates";
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
        const orders = await revolutXService.getHistoricalOrders({
          startMs: twoWeeksAgo,
          states: ['filled'],
        });

        const sampleOrders = orders.slice(0, 5).map(o => ({
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

        const orders = await revolutXService.getHistoricalOrders({
          startMs,
          states: ['filled'],
        });

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

      if (krakenService.isInitialized()) {
        console.log("[fisco/run] Fetching Kraken ledger (FULL HISTORY - NO LIMIT)...");
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
        console.log(`[fisco/run] Kraken: ${krakenLedgerEntries.length} ledger entries (FULL HISTORY)`);
      }

      if (revolutXService.isInitialized()) {
        console.log("[fisco/run] Fetching RevolutX orders (FULL HISTORY - NO LIMIT)...");
        // Remove startMs to get ALL history, not just from a date
        revolutxOrders = await revolutXService.getHistoricalOrders({
          states: ["filled"],
          // No startMs - get complete history
        });
        console.log(`[fisco/run] RevolutX: ${revolutxOrders.length} orders (FULL HISTORY)`);
      }

      // 3. Normalize
      console.log("[fisco/run] Normalizing...");
      const krakenOps = await normalizeKrakenLedger(krakenLedgerEntries);
      const revxOps = await normalizeRevolutXOrders(revolutxOrders);
      const allOps = mergeAndSort(krakenOps, revxOps);
      console.log(`[fisco/run] Normalized: ${allOps.length} operations (${krakenOps.length} Kraken + ${revxOps.length} RevolutX)`);

      // 4. Run FIFO
      console.log("[fisco/run] Running FIFO engine...");
      const fifo = runFifo(allOps);
      console.log(`[fisco/run] FIFO: ${fifo.lots.length} lots, ${fifo.disposals.length} disposals, ${fifo.warnings.length} warnings`);

      // 5. Save to DB (upsert operations)
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

      res.json({
        status: "ok",
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
          COALESCE(SUM(d.gain_loss_eur::numeric), 0) as ganancia_perdida_eur
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
      // Include ALL exchange assets, not just bot operations
      // Get current balances from exchanges to ensure all assets are included
      let allExchangeAssets: string[] = [];
      
      try {
        // Get Kraken balance — normalize raw tickers (EUR.HOLD → EUR, XXBT → BTC, etc.)
        if (krakenService.isInitialized()) {
          const krakenBalance = await krakenService.getBalance();
          allExchangeAssets.push(...Object.keys(krakenBalance).map(k => krakenService.normalizeAsset(k)));
        }
        
        // Get RevolutX balance (if available)
        if (revolutXService.isInitialized()) {
          try {
            const revolutxBalance = await revolutXService.getBalance();
            allExchangeAssets.push(...Object.keys(revolutxBalance));
          } catch (e) {
            console.log('[fisco] RevolutX balance not available, using operations only');
          }
        }
      } catch (e) {
        console.log('[fisco] Could not fetch live balances, using operations only');
      }
      
      // Get assets from operations as fallback
      const opsAssetsQ = await pool.query(`
        SELECT DISTINCT asset FROM fisco_operations
      `);
      const opsAssets = opsAssetsQ.rows.map((r: any) => r.asset);
      
      // Combine and deduplicate all assets
      const allAssets = [...new Set([...allExchangeAssets, ...opsAssets])].sort();
      
      // Compute running balances from all operations
      const balanceQ = await pool.query(`
        SELECT asset, exchange, op_type, amount::numeric as amount, executed_at
        FROM fisco_operations
        WHERE executed_at < $1::date + interval '1 year'
          ${exchWhereOps}
        ORDER BY executed_at ASC
      `, [`${year}-01-01`]);

      // Build per-asset balances - initialize for ALL assets
      const assetBalances = new Map<string, {
        saldo_inicio: number;
        entradas: number;
        salidas: number;
        saldo_fin: number;
        exchanges: Set<string>;
      }>();
      
      // Initialize all assets to ensure they appear even with zero activity
      for (const asset of allAssets) {
        assetBalances.set(asset, { saldo_inicio: 0, entradas: 0, salidas: 0, saldo_fin: 0, exchanges: new Set() });
      }

      const yearStart = new Date(`${year}-01-01T00:00:00Z`);
      const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`);

      for (const r of balanceQ.rows) {
        const asset = r.asset;
        if (!assetBalances.has(asset)) {
          assetBalances.set(asset, { saldo_inicio: 0, entradas: 0, salidas: 0, saldo_fin: 0, exchanges: new Set() });
        }
        const b = assetBalances.get(asset)!;
        b.exchanges.add(r.exchange);
        const amt = parseFloat(r.amount);
        const date = new Date(r.executed_at);
        const isInflow = ['trade_buy', 'deposit', 'staking', 'reward', 'distribution'].includes(r.op_type);
        const isOutflow = ['trade_sell', 'withdrawal'].includes(r.op_type);

        if (date < yearStart) {
          // Before year: contributes to saldo_inicio
          if (isInflow) b.saldo_inicio += amt;
          else if (isOutflow) b.saldo_inicio -= amt;
        } else if (date < yearEnd) {
          // During year
          if (isInflow) b.entradas += amt;
          else if (isOutflow) b.salidas += amt;
        }
      }

      // Compute saldo_fin
      const sectionD: any[] = [];
      for (const [asset, b] of assetBalances) {
        b.saldo_fin = b.saldo_inicio + b.entradas - b.salidas;
        // Only include if there's any activity or non-zero balance
        if (Math.abs(b.saldo_inicio) > 1e-10 || Math.abs(b.entradas) > 1e-10 || Math.abs(b.salidas) > 1e-10) {
          sectionD.push({
            asset,
            exchanges: Array.from(b.exchanges),
            saldo_inicio: Math.round(b.saldo_inicio * 1e8) / 1e8,
            entradas: Math.round(b.entradas * 1e8) / 1e8,
            salidas: Math.round(b.salidas * 1e8) / 1e8,
            saldo_fin: Math.round(b.saldo_fin * 1e8) / 1e8,
          });
        }
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

      res.json({
        year,
        exchange_filter: exchangeFilter || 'all',
        last_sync: lastSyncQ.rows[0]?.last_sync || null,
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
