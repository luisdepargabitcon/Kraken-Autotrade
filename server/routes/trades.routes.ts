import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { krakenService } from "../services/kraken";

export const registerTradesRoutes: RegisterRoutes = (app, _deps) => {

  app.get("/api/trades", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = await storage.getTrades(limit);
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  app.get("/api/trades/closed", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const pair = req.query.pair as string | undefined;
      const exchange = (req.query.exchange as 'kraken' | 'revolutx' | undefined);
      const result = (req.query.result as 'winner' | 'loser' | 'all') || 'all';
      const type = (req.query.type as 'all' | 'buy' | 'sell') || 'all';
      
      const { trades, total } = await storage.getClosedTrades({ limit, offset, pair, exchange, result, type });

      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const normalizeExchange = (t: any): 'kraken' | 'revolutx' => {
        const raw = (t?.exchange ?? '').toString().toLowerCase();
        if (raw === 'kraken' || raw === 'revolutx') return raw;
        const id = (t?.tradeId ?? '').toString();
        if (id.startsWith('RX-') || uuidV4Regex.test(id)) return 'revolutx';
        if (id.startsWith('KRAKEN-')) return 'kraken';
        return 'kraken';
      };
      
      res.json({
        trades: trades.map(t => {
          const price = parseFloat(t.price);
          const amount = parseFloat(t.amount);
          const totalUsd = price * amount;
          const entryValueUsd = t.entryPrice ? parseFloat(t.entryPrice) * amount : null;
          
          return {
            ...t,
            exchange: normalizeExchange(t),
            totalUsd: totalUsd.toFixed(2),
            entryValueUsd: entryValueUsd?.toFixed(2) || null,
            realizedPnlUsd: t.type === 'sell' && t.realizedPnlUsd ? parseFloat(t.realizedPnlUsd).toFixed(2) : null,
            realizedPnlPct: t.type === 'sell' && t.realizedPnlPct ? parseFloat(t.realizedPnlPct).toFixed(2) : null,
          };
        }),
        total,
        limit,
        offset,
      });
    } catch (error) {
      console.error("[api/trades/closed] Error:", error);
      res.status(500).json({ error: "Failed to get closed trades" });
    }
  });

  app.get("/api/performance", async (req, res) => {
    try {
      // Use only FILLED trades with valid price & amount to avoid pending/invalid contamination
      const allTrades = await storage.getFilledTradesForPerformance(2000);
      
      const STARTING_EQUITY = 1000;
      
      const sortedTrades = [...allTrades].sort((a, b) => {
        const dateA = a.executedAt ? new Date(a.executedAt).getTime() : new Date(a.createdAt).getTime();
        const dateB = b.executedAt ? new Date(b.executedAt).getTime() : new Date(b.createdAt).getTime();
        return dateA - dateB;
      });

      // FIFO buy queues per pair+exchange (handles multiple partial buys correctly)
      const buyQueues: Record<string, { price: number; remaining: number }[]> = {};
      let currentEquity = STARTING_EQUITY;
      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      let maxEquity = STARTING_EQUITY;
      let maxDrawdown = 0;

      const firstTradeTime = sortedTrades.length > 0 
        ? new Date(sortedTrades[0].executedAt || sortedTrades[0].createdAt).toISOString()
        : new Date().toISOString();
      
      const curve: { time: string; equity: number; pnl?: number }[] = [
        { time: firstTradeTime, equity: STARTING_EQUITY }
      ];

      for (const trade of sortedTrades) {
        const pair = trade.pair;
        const exchange = (trade as any).exchange || 'kraken';
        const queueKey = `${pair}::${exchange}`;
        const price = parseFloat(trade.price);
        const amount = parseFloat(trade.amount);
        const time = trade.executedAt ? new Date(trade.executedAt).toISOString() : new Date(trade.createdAt).toISOString();

        if (price <= 0 || amount <= 0) continue; // extra guard

        if (trade.type === "buy") {
          if (!buyQueues[queueKey]) buyQueues[queueKey] = [];
          buyQueues[queueKey].push({ price, remaining: amount });
        } else if (trade.type === "sell") {
          let pnl: number | null = null;

          // Strategy A: Use realizedPnlUsd from DB if already calculated (most accurate, includes fees)
          if (trade.realizedPnlUsd != null && String(trade.realizedPnlUsd).length > 0) {
            const storedPnl = parseFloat(String(trade.realizedPnlUsd));
            if (Number.isFinite(storedPnl)) {
              pnl = storedPnl;
            }
          }

          // Strategy B: FIFO matching from buy queue (fallback)
          if (pnl === null) {
            const queue = buyQueues[queueKey];
            if (queue && queue.length > 0) {
              let sellRemaining = amount;
              let totalCost = 0;
              let totalMatched = 0;
              while (sellRemaining > 0.00000001 && queue.length > 0) {
                const buy = queue[0];
                const matchAmt = Math.min(buy.remaining, sellRemaining);
                totalCost += matchAmt * buy.price;
                totalMatched += matchAmt;
                sellRemaining -= matchAmt;
                buy.remaining -= matchAmt;
                if (buy.remaining <= 0.00000001) queue.shift();
              }
              if (totalMatched > 0.00000001) {
                pnl = (price * totalMatched) - totalCost;
              }
            }
          } else {
            // Still consume FIFO quantities so future sells match correctly
            const queue = buyQueues[queueKey];
            if (queue) {
              let toConsume = amount;
              while (toConsume > 0.00000001 && queue.length > 0) {
                const buy = queue[0];
                const matchAmt = Math.min(buy.remaining, toConsume);
                toConsume -= matchAmt;
                buy.remaining -= matchAmt;
                if (buy.remaining <= 0.00000001) queue.shift();
              }
            }
          }

          if (pnl !== null && Number.isFinite(pnl)) {
            totalPnl += pnl;
            currentEquity += pnl;

            if (pnl > 0) wins++;
            else if (pnl < 0) losses++;

            curve.push({ time, equity: currentEquity, pnl });

            if (currentEquity > maxEquity) maxEquity = currentEquity;
            const drawdown = ((maxEquity - currentEquity) / maxEquity) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
          }
        }
      }

      const totalTrades = wins + losses;
      const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const totalPnlPct = (totalPnl / STARTING_EQUITY) * 100;

      res.json({
        curve,
        summary: {
          startingEquity: STARTING_EQUITY,
          endingEquity: currentEquity,
          totalPnlUsd: totalPnl,
          totalPnlPct,
          maxDrawdownPct: maxDrawdown,
          winRatePct,
          totalTrades,
          wins,
          losses
        }
      });
    } catch (error) {
      console.error("Error calculating performance:", error);
      res.status(500).json({ error: "Failed to calculate performance" });
    }
  });

  // === PORTFOLIO SUMMARY (single source of truth) ===
  app.get("/api/portfolio-summary", async (req, res) => {
    try {
      // 1. Realized P&L: sum of all filled SELL trades' realizedPnlUsd
      const allTrades = await storage.getFilledTradesForPerformance(5000);
      const sells = allTrades.filter(t => t.type === 'sell');

      let realizedPnlUsd = 0;
      let wins = 0;
      let losses = 0;
      let todayRealizedPnl = 0;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      for (const sell of sells) {
        if (sell.realizedPnlUsd != null && String(sell.realizedPnlUsd).length > 0) {
          const pnl = parseFloat(String(sell.realizedPnlUsd));
          if (Number.isFinite(pnl)) {
            realizedPnlUsd += pnl;
            if (pnl > 0) wins++;
            else if (pnl < 0) losses++;

            const tradeDate = sell.executedAt ? new Date(sell.executedAt) : new Date(sell.createdAt);
            if (tradeDate >= todayStart) {
              todayRealizedPnl += pnl;
            }
          }
        }
      }

      // 2. Unrealized P&L: from open positions (current price vs entry)
      const rawPositions = await storage.getOpenPositions();
      const positions = rawPositions.filter((pos: any) => {
        const status = String(pos.status || 'OPEN');
        if (status === 'FAILED' || status === 'CANCELLED') return false;
        const amount = parseFloat(String(pos.amount ?? '0'));
        if (status === 'OPEN' && (!Number.isFinite(amount) || amount <= 0)) return false;
        return true;
      });

      let unrealizedPnlUsd = 0;
      for (const pos of positions) {
        try {
          let currentPrice = 0;
          if (krakenService.isInitialized()) {
            const krakenPair = krakenService.formatPair(pos.pair);
            const ticker = await krakenService.getTickerRaw(krakenPair);
            const tickerData: any = Object.values(ticker)[0];
            if (tickerData?.c?.[0]) {
              currentPrice = parseFloat(tickerData.c[0]);
            }
          }
          if (currentPrice > 0) {
            const entryPrice = parseFloat(pos.entryPrice);
            const amount = parseFloat(pos.amount);
            unrealizedPnlUsd += (currentPrice - entryPrice) * amount;
          }
        } catch (e: any) {
          console.error(`[portfolio-summary] Error precio ${pos.pair}:`, e.message);
        }
      }

      const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
      const totalSells = wins + losses;
      const winRatePct = totalSells > 0 ? (wins / totalSells) * 100 : 0;

      res.json({
        realizedPnlUsd: parseFloat(realizedPnlUsd.toFixed(2)),
        unrealizedPnlUsd: parseFloat(unrealizedPnlUsd.toFixed(2)),
        totalPnlUsd: parseFloat(totalPnlUsd.toFixed(2)),
        todayRealizedPnl: parseFloat(todayRealizedPnl.toFixed(2)),
        winRatePct: parseFloat(winRatePct.toFixed(2)),
        wins,
        losses,
        totalSells,
        openPositions: positions.length,
      });
    } catch (error) {
      console.error("[portfolio-summary] Error:", error);
      res.status(500).json({ error: "Failed to calculate portfolio summary" });
    }
  });

  // === REBUILD P&L FOR ALL SELLS ===
  app.post("/api/trades/rebuild-pnl", async (req, res) => {
    try {
      console.log("[rebuild-pnl] Starting P&L rebuild for all sells without P&L...");
      const result = await storage.rebuildPnlForAllSells();
      console.log(`[rebuild-pnl] Done: updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}`);
      res.json({
        success: true,
        ...result,
        message: `P&L recalculado: ${result.updated} actualizados, ${result.skipped} ya tenían P&L, ${result.errors} errores`,
      });
    } catch (error: any) {
      console.error("[rebuild-pnl] Error:", error);
      res.status(500).json({ error: "Failed to rebuild P&L", message: error.message });
    }
  });

  // === SYNC KRAKEN TRADES ===
  app.post("/api/trades/sync", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }

      // Obtener todo el historial de trades con paginación
      const tradesHistory = await krakenService.getTradesHistory({ fetchAll: true });
      const krakenTrades = tradesHistory.trades || {};
      
      let synced = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      // Agrupar trades por par para cálculo de P&L
      const tradesByPair: Record<string, { buys: any[]; sells: any[] }> = {};
      
      for (const [txid, trade] of Object.entries(krakenTrades)) {
        const t = trade as any;
        const pair = krakenService.formatPairReverse(t.pair);
        
        if (!tradesByPair[pair]) {
          tradesByPair[pair] = { buys: [], sells: [] };
        }
        
        const tradeData = {
          txid,
          pair,
          type: t.type,
          price: parseFloat(t.price),
          amount: parseFloat(t.vol),
          cost: parseFloat(t.cost),
          fee: parseFloat(t.fee),
          time: new Date(t.time * 1000),
        };
        
        if (t.type === 'buy') {
          tradesByPair[pair].buys.push(tradeData);
        } else {
          tradesByPair[pair].sells.push(tradeData);
        }
        
        try {
          // === FIX DUPLICADOS v2: Triple verificación ===
          const ordertxid = t.ordertxid;
          const executedAt = new Date(t.time * 1000);
          
          // === B2: UPSERT por kraken_order_id ===
          // 1. Verificar por ORDER ID (lo que guardó el bot)
          const orderIdToCheck = ordertxid || txid;
          const existingTrade = await storage.getTradeByKrakenOrderId(orderIdToCheck);
          
          if (existingTrade) {
            // B2: UPDATE - construir patch sin sobreescribir P&L existente
            const patch: any = {
              pair,
              price: t.price,
              amount: t.vol,
              status: "filled",
              executedAt,
            };
            
            // B3: Log discrepancias P&L si ambos valores existen y difieren > 1%
            // (no machacar el existente)
            if (existingTrade.realizedPnlUsd != null && existingTrade.entryPrice != null) {
              // Ya tiene P&L calculado, no actualizar campos P&L
            }
            
            await storage.updateTradeByKrakenOrderId(orderIdToCheck, patch);
            skipped++;
            continue;
          }
          
          // 2. Verificar por FILL ID (sync previo usó txid como krakenOrderId)
          if (!existingTrade) {
            const existingByFillId = await storage.getTradeByKrakenOrderId(txid);
            if (existingByFillId) {
              // B2: UPDATE por txid - misma lógica de patch
              const patchByFill: any = {
                pair,
                price: t.price,
                amount: t.vol,
                status: "filled",
                executedAt,
              };
              
              // No machacar P&L existente
              if (existingByFillId.realizedPnlUsd == null && existingByFillId.entryPrice == null) {
                // OK para actualizar P&L si viene de sync
              }
              
              await storage.updateTradeByKrakenOrderId(txid, patchByFill);
              skipped++;
              continue;
            }
          }
          
          // 3. Verificar por características (pair + amount + type + timestamp < 60s)
          const existingByTraits = await storage.findDuplicateTrade(pair, t.vol, t.type, executedAt);
          if (existingByTraits) {
            skipped++;
            continue;
          }
          
          // No existe duplicado, INSERT
          const insertResult = await storage.upsertTradeByKrakenId({
            tradeId: `KRAKEN-${txid}`,
            exchange: 'kraken',
            pair,
            type: t.type,
            price: t.price,
            amount: t.vol,
            status: "filled",
            krakenOrderId: txid,
            executedAt,
            origin: 'sync',
          });
          
          if (insertResult.inserted) {
            synced++;
          } else {
            skipped++;
          }
        } catch (e: any) {
          errors.push(`${txid}: ${e.message}`);
        }
      }
      
      // Calcular P&L para SELLs emparejándolos con BUYs (FIFO)
      let pnlCalculated = 0;
      for (const [pair, trades] of Object.entries(tradesByPair)) {
        // Ordenar por tiempo
        trades.buys.sort((a, b) => a.time.getTime() - b.time.getTime());
        trades.sells.sort((a, b) => a.time.getTime() - b.time.getTime());
        
        let buyIndex = 0;
        let buyRemaining = trades.buys[0]?.amount || 0;
        
        for (const sell of trades.sells) {
          let sellRemaining = sell.amount;
          let totalCost = 0;
          let totalAmount = 0;
          let totalBuyFees = 0; // Accumulated buy-side fees for matched portion
          
          // Emparejar con BUYs (FIFO)
          while (sellRemaining > 0 && buyIndex < trades.buys.length) {
            const buy = trades.buys[buyIndex];
            const matchAmount = Math.min(buyRemaining, sellRemaining);
            
            // Pro-rate buy fee based on matched portion
            const buyFeeForMatch = (matchAmount / buy.amount) * buy.fee;
            
            totalCost += matchAmount * buy.price;
            totalAmount += matchAmount;
            totalBuyFees += buyFeeForMatch;
            
            sellRemaining -= matchAmount;
            buyRemaining -= matchAmount;
            
            if (buyRemaining <= 0.00000001) {
              buyIndex++;
              buyRemaining = trades.buys[buyIndex]?.amount || 0;
            }
          }
          
          // Only calculate P&L for matched portion
          if (totalAmount > 0) {
            const avgEntryPrice = totalCost / totalAmount;
            // Use totalAmount (matched) not sell.amount for revenue calculation
            const revenue = totalAmount * sell.price;
            const cost = totalCost;
            // Include both buy and sell fees in net P&L
            const totalFees = totalBuyFees + sell.fee;
            const pnlGross = revenue - cost;
            const pnlNet = pnlGross - totalFees;
            const pnlPct = cost > 0 ? (pnlNet / cost) * 100 : 0;
            
            // Actualizar el trade SELL con P&L
            const existingSell = await storage.getTradeByKrakenOrderId(sell.txid);
            if (existingSell && (!existingSell.realizedPnlUsd || existingSell.realizedPnlUsd === null)) {
              await storage.updateTradePnl(
                existingSell.id,
                avgEntryPrice.toFixed(8),
                pnlNet.toFixed(8),  // Use net P&L (after all fees)
                pnlPct.toFixed(4)
              );
              pnlCalculated++;
            }
          }
        }
      }

      // Auto-rebuild P&L for any sells that still lack it (background, after response)
      let rebuildResult: { updated: number; skipped: number; errors: number } | null = null;
      try {
        rebuildResult = await storage.rebuildPnlForAllSells();
        if (rebuildResult.updated > 0) {
          console.log(`[sync-kraken] P&L rebuild: ${rebuildResult.updated} updated, ${rebuildResult.skipped} skipped`);
        }
      } catch (e: any) {
        console.warn(`[sync-kraken] P&L rebuild failed: ${e.message}`);
      }

      res.json({ 
        success: true, 
        synced, 
        skipped,
        pnlCalculated,
        pnlRebuilt: rebuildResult?.updated ?? 0,
        total: Object.keys(krakenTrades).length,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to sync trades" });
    }
  });

  // Endpoint para recalcular P&L de todos los trades existentes en BD
  app.post("/api/trades/recalculate-pnl", async (req, res) => {
    try {
      const allTrades = await storage.getTrades(1000);

      const feePctByExchange = (ex?: string | null) => {
        if (ex === 'revolutx') return 0.09;
        return 0.40;
      };
      
      // Agrupar trades por par + exchange (para no mezclar Kraken/RevolutX)
      const tradesByKey: Record<string, { pair: string; exchange: string; buys: any[]; sells: any[] }> = {};
      
      for (const trade of allTrades) {
        const pair = trade.pair;
        const ex = ((trade as any).exchange as string | undefined) || 'kraken';
        const key = `${pair}::${ex}`;
        if (!tradesByKey[key]) {
          tradesByKey[key] = { pair, exchange: ex, buys: [], sells: [] };
        }
        
        const tradeData = {
          id: trade.id,
          pair,
          type: trade.type,
          price: parseFloat(trade.price),
          amount: parseFloat(trade.amount),
          exchange: ex,
          time: trade.executedAt ? new Date(trade.executedAt) : new Date(trade.createdAt),
        };
        
        if (trade.type === 'buy') {
          tradesByKey[key].buys.push(tradeData);
        } else {
          tradesByKey[key].sells.push(tradeData);
        }
      }
      
      // Calcular P&L para cada SELL usando FIFO
      let pnlCalculated = 0;
      let totalPnlUsd = 0;
      const results: { pair: string; exchange: string; sellId: number; pnlUsd: number }[] = [];
      
      for (const { pair, exchange, buys, sells } of Object.values(tradesByKey)) {
        // Ordenar por tiempo
        buys.sort((a, b) => a.time.getTime() - b.time.getTime());
        sells.sort((a, b) => a.time.getTime() - b.time.getTime());
        
        let buyIndex = 0;
        let buyRemaining = buys[0]?.amount || 0;
        
        for (const sell of sells) {
          // Strategy 0: If we have lot_matches for this sell (lot-based), use them.
          try {
            const extId = (allTrades.find((t: any) => t.id === sell.id) as any)?.krakenOrderId;
            if (extId) {
              const matches = await storage.getLotMatchesBySellFillTxid(String(extId));
              if (matches.length > 0) {
                const agg = matches.reduce(
                  (acc, m) => {
                    const qty = parseFloat(String(m.matchedQty));
                    const buyPrice = parseFloat(String(m.buyPrice));
                    const pnlNet = parseFloat(String(m.pnlNet));
                    if (Number.isFinite(qty) && Number.isFinite(buyPrice)) {
                      acc.cost += qty * buyPrice;
                      acc.qty += qty;
                    }
                    if (Number.isFinite(pnlNet)) acc.pnl += pnlNet;
                    return acc;
                  },
                  { cost: 0, qty: 0, pnl: 0 }
                );
                if (agg.qty > 0 && agg.cost > 0) {
                  const avgEntryPrice = agg.cost / agg.qty;
                  const pnlPct = (agg.pnl / agg.cost) * 100;
                  await storage.updateTradePnl(sell.id, avgEntryPrice.toFixed(8), agg.pnl.toFixed(8), pnlPct.toFixed(4));
                  pnlCalculated++;
                  totalPnlUsd += agg.pnl;
                  results.push({ pair, exchange, sellId: sell.id, pnlUsd: agg.pnl });
                  continue;
                }
              }
            }
          } catch {
            // best-effort
          }

          // Strategy 1: engine bot sells with entryPrice should never use FIFO global
          try {
            const originalSell = allTrades.find((t: any) => t.id === sell.id) as any;
            const origin = String(originalSell?.origin ?? '').toLowerCase();
            const executedByBot = Boolean(originalSell?.executedByBot);
            const entryPriceNum = originalSell?.entryPrice != null ? parseFloat(String(originalSell.entryPrice)) : NaN;
            if (origin === 'engine' && executedByBot && Number.isFinite(entryPriceNum) && entryPriceNum > 0) {
              const entryValue = entryPriceNum * sell.amount;
              const exitValue = sell.price * sell.amount;
              const feePct = feePctByExchange(exchange);
              const pnlNet = (exitValue - entryValue) - (entryValue * feePct / 100) - (exitValue * feePct / 100);
              const pnlPct = entryValue > 0 ? (pnlNet / entryValue) * 100 : 0;
              await storage.updateTradePnl(sell.id, entryPriceNum.toFixed(8), pnlNet.toFixed(8), pnlPct.toFixed(4));
              pnlCalculated++;
              totalPnlUsd += pnlNet;
              results.push({ pair, exchange, sellId: sell.id, pnlUsd: pnlNet });
              continue;
            }
          } catch {
            // best-effort
          }

          let sellRemaining = sell.amount;
          let totalCost = 0;
          let totalAmount = 0;
          
          // Emparejar con BUYs (FIFO)
          while (sellRemaining > 0.00000001 && buyIndex < buys.length) {
            const buy = buys[buyIndex];
            const matchAmount = Math.min(buyRemaining, sellRemaining);
            
            totalCost += matchAmount * buy.price;
            totalAmount += matchAmount;
            
            sellRemaining -= matchAmount;
            buyRemaining -= matchAmount;
            
            if (buyRemaining <= 0.00000001) {
              buyIndex++;
              buyRemaining = buys[buyIndex]?.amount || 0;
            }
          }
          
          // Calcular P&L para matched portion
          if (totalAmount > 0.00000001) {
            const avgEntryPrice = totalCost / totalAmount;
            const revenue = totalAmount * sell.price;
            const cost = totalCost;
            const pnlGross = revenue - cost;
            const feePct = feePctByExchange(exchange);
            const entryFee = cost * (feePct / 100);
            const exitFee = revenue * (feePct / 100);
            const pnlNet = pnlGross - entryFee - exitFee;
            const pnlPct = cost > 0 ? (pnlNet / cost) * 100 : 0;
            
            // Actualizar el trade SELL con P&L
            await storage.updateTradePnl(
              sell.id,
              avgEntryPrice.toFixed(8),
              pnlNet.toFixed(8),
              pnlPct.toFixed(4)
            );
            pnlCalculated++;
            totalPnlUsd += pnlNet;
            results.push({ pair, exchange, sellId: sell.id, pnlUsd: pnlNet });
          }
        }
      }
      
      console.log(`[RECALCULATE_PNL] Recalculated ${pnlCalculated} trades, total P&L: $${totalPnlUsd.toFixed(2)}`);
      
      res.json({ 
        success: true, 
        pnlCalculated,
        totalPnlUsd: totalPnlUsd.toFixed(2),
        pairs: Object.keys(tradesByKey).length,
        details: results.slice(-20),
      });
    } catch (error: any) {
      console.error("[api/trades/recalculate-pnl] Error:", error);
      res.status(500).json({ error: error.message || "Failed to recalculate P&L" });
    }
  });

  // Endpoint para limpiar duplicados existentes
  app.post("/api/trades/cleanup-duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTradesByKrakenId();
      
      if (duplicates.length === 0) {
        return res.json({ success: true, message: "No hay duplicados", deleted: 0 });
      }
      
      const deleted = await storage.deleteDuplicateTrades();
      
      res.json({ 
        success: true, 
        duplicatesFound: duplicates.length,
        deleted,
        details: duplicates.slice(0, 20),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup duplicates" });
    }
  });

  // Endpoint para limpiar trades inválidos históricos (p.ej. RevolutX price=0)
  app.post("/api/trades/cleanup-invalid", async (req, res) => {
    try {
      const deleted = await storage.deleteInvalidFilledTrades();
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup invalid trades" });
    }
  });

  // Endpoint para ver duplicados sin eliminar
  app.get("/api/trades/duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTradesByKrakenId();
      res.json({ 
        count: duplicates.length,
        duplicates: duplicates.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get duplicates" });
    }
  });

  // FIFO Matcher endpoints
  app.post("/api/fifo/init-lots", async (req, res) => {
    try {
      const { fifoMatcher } = await import("../services/fifoMatcher");
      const initialized = await fifoMatcher.initializeLots();
      res.json({ success: true, lotsInitialized: initialized });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to initialize lots" });
    }
  });

  app.post("/api/fifo/process-sells", async (req, res) => {
    try {
      const { fifoMatcher } = await import("../services/fifoMatcher");
      const result = await fifoMatcher.processAllUnmatchedSells();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to process sells" });
    }
  });

  app.post("/api/fifo/ingest-fill", async (req, res) => {
    try {
      const { txid, orderId, pair, type, price, amount, cost, fee, executedAt, exchange } = req.body;
      
      if (!txid || !pair || !type || !price || !amount) {
        return res.status(400).json({ error: "Missing required fields: txid, pair, type, price, amount" });
      }

      const fillResult = await storage.upsertTradeFill({
        txid,
        orderId: orderId || txid,
        exchange: (exchange || 'kraken').toString().toLowerCase(),
        pair,
        type: type.toLowerCase(),
        price: price.toString(),
        amount: amount.toString(),
        cost: (cost || parseFloat(price) * parseFloat(amount)).toString(),
        fee: (fee || 0).toString(),
        matched: false,
        executedAt: new Date(executedAt || Date.now()),
      });

      if (!fillResult.inserted) {
        return res.json({ success: true, message: "Fill already exists", fill: fillResult.fill });
      }

      if (type.toUpperCase() === "SELL") {
        const { fifoMatcher } = await import("../services/fifoMatcher");
        const matchResult = await fifoMatcher.processSellFill(fillResult.fill!);
        return res.json({ success: true, fill: fillResult.fill, matchResult });
      }

      res.json({ success: true, fill: fillResult.fill });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to ingest fill" });
    }
  });

  app.get("/api/fifo/open-lots", async (req, res) => {
    try {
      const lots = await storage.getOpenPositionsWithQtyRemaining();
      res.json({
        count: lots.length,
        lots: lots.map(l => ({
          lotId: l.lotId,
          pair: l.pair,
          entryPrice: l.entryPrice,
          amount: l.amount,
          qtyRemaining: l.qtyRemaining || l.amount,
          qtyFilled: l.qtyFilled || "0",
          openedAt: l.openedAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get open lots" });
    }
  });

  app.get("/api/kraken/trades", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        const localTrades = await storage.getTrades(50);
        return res.json(localTrades.map(t => ({
          id: t.tradeId,
          krakenOrderId: t.krakenOrderId,
          pair: t.pair,
          type: t.type,
          price: t.price,
          amount: t.amount,
          time: t.executedAt?.toISOString() || t.createdAt.toISOString(),
          status: t.status,
        })));
      }

      const tradesHistory = await krakenService.getTradesHistory();
      const trades = tradesHistory.trades || {};
      
      const formattedTrades = Object.entries(trades).map(([txid, trade]) => {
        const t = trade as any;
        return {
          id: txid.substring(0, 10),
          krakenOrderId: txid,
          pair: krakenService.formatPairReverse(t.pair),
          type: t.type,
          price: t.price,
          amount: t.vol,
          cost: t.cost,
          fee: t.fee,
          time: new Date(t.time * 1000).toISOString(),
          status: "filled",
        };
      }).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      res.json(formattedTrades);
    } catch (error: any) {
      console.error("[api/kraken/trades] Error:", error.message);
      const localTrades = await storage.getTrades(50);
      res.json(localTrades.map(t => ({
        id: t.tradeId,
        krakenOrderId: t.krakenOrderId,
        pair: t.pair,
        type: t.type,
        price: t.price,
        amount: t.amount,
        time: t.executedAt?.toISOString() || t.createdAt.toISOString(),
        status: t.status,
      })));
    }
  });
};
