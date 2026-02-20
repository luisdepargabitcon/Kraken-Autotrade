import type { Express } from "express";
import { krakenService } from "../services/kraken";
import { revolutXService } from "../services/exchanges/RevolutXService";
import type { RouterDeps } from "./types";

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
}
