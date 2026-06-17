import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { db } from "../db";
import { dryRunTrades, botEvents } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { classifyExitReason, type NormalizedExitReason } from "../utils/exitReasonClassifier";
import { MarketDataService } from "../services/MarketDataService";

export const registerDryRunRoutes: RegisterRoutes = (app, deps) => {

  // GET /api/dryrun/positions - Open dry run positions (status = 'open')
  app.get("/api/dryrun/positions", async (_req, res) => {
    try {
      const positions = await db.select().from(dryRunTrades)
        .where(and(eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")))
        .orderBy(desc(dryRunTrades.createdAt));
      
      res.json(positions);
    } catch (error: any) {
      console.error("[dryrun] Error fetching positions:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run positions" });
    }
  });

  // GET /api/dryrun/history - Closed dry run trades (sells with optional excluded filter)
  app.get("/api/dryrun/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const pair = req.query.pair as string | undefined;
      const excludedFilter = req.query.excludedFilter as string | undefined; // 'included' | 'excluded' | 'all'

      const conditions: any[] = [eq(dryRunTrades.type, "sell")];
      
      // Filter by pair
      if (pair && pair !== "all") {
        conditions.push(eq(dryRunTrades.pair, pair));
      }

      // Filter by excluded status (default: 'included' = only non-excluded trades)
      if (excludedFilter === "excluded") {
        conditions.push(eq(dryRunTrades.excludedFromPnl, true));
      } else if (excludedFilter === "all") {
        // No additional filter - show all sells
      } else {
        // Default: 'included' - only trades included in PnL calculation
        conditions.push(eq(dryRunTrades.excludedFromPnl, false));
      }

      const trades = await db.select().from(dryRunTrades)
        .where(and(...conditions))
        .orderBy(desc(dryRunTrades.createdAt))
        .limit(limit)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(dryRunTrades)
        .where(and(...conditions));

      const total = Number(countResult[0]?.count || 0);

      // Also return counts by category for the filter UI
      const includedConditions = [eq(dryRunTrades.type, "sell"), eq(dryRunTrades.excludedFromPnl, false)];
      if (pair && pair !== "all") {
        includedConditions.push(eq(dryRunTrades.pair, pair));
      }
      const includedCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(dryRunTrades)
        .where(and(...includedConditions));

      const excludedConditions = [eq(dryRunTrades.type, "sell"), eq(dryRunTrades.excludedFromPnl, true)];
      if (pair && pair !== "all") {
        excludedConditions.push(eq(dryRunTrades.pair, pair));
      }
      const excludedCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(dryRunTrades)
        .where(and(...excludedConditions));

      res.json({ 
        trades, 
        total, 
        limit, 
        offset,
        filter: excludedFilter || "included",
        counts: {
          included: Number(includedCountResult[0]?.count || 0),
          excluded: Number(excludedCountResult[0]?.count || 0),
          total: Number(includedCountResult[0]?.count || 0) + Number(excludedCountResult[0]?.count || 0),
        }
      });
    } catch (error: any) {
      console.error("[dryrun] Error fetching history:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run history" });
    }
  });

  // GET /api/dryrun/summary - Smart Strategy Score + comprehensive metrics
  app.get("/api/dryrun/summary", async (_req, res) => {
    try {
      // 1. Open positions (for floating PnL and capital calculation)
      const openPositions = await db.select().from(dryRunTrades)
        .where(and(eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")));

      // 2. All sells (gross) - for historical context
      const closedSells = await db.select().from(dryRunTrades)
        .where(eq(dryRunTrades.type, "sell"));

      // 3. Clean sells (excluded_from_pnl = false) - MAIN METRICS
      const cleanSells = await db.select().from(dryRunTrades)
        .where(and(
          eq(dryRunTrades.type, "sell"),
          eq(dryRunTrades.excludedFromPnl, false)
        ));

      // 4. Excluded sells (excluded_from_pnl = true) - audit only
      const excludedSells = await db.select().from(dryRunTrades)
        .where(and(
          eq(dryRunTrades.type, "sell"),
          eq(dryRunTrades.excludedFromPnl, true)
        ));

      // ============ BASIC CALCULATIONS ============
      const totalOpenValue = openPositions.reduce((sum, p) => sum + parseFloat(p.totalUsd || "0"), 0);

      // Gross PnL: all sells (includes legacy data)
      const grossSellPnl = closedSells.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0);

      // Clean PnL: only non-excluded sells (PRIMARY METRIC)
      const cleanSellPnl = cleanSells.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0);

      // Excluded PnL: legacy timestop losses
      const excludedSellPnl = excludedSells.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0);

      // Win/loss stats for clean sells
      const cleanWins = cleanSells.filter(t => parseFloat(t.realizedPnlUsd || "0") > 0);
      const cleanLosses = cleanSells.filter(t => parseFloat(t.realizedPnlUsd || "0") <= 0);
      const cleanWinCount = cleanWins.length;
      const cleanLossCount = cleanLosses.length;
      const includedSells = cleanSells.length;
      const cleanWinRate = includedSells > 0 ? (cleanWinCount / includedSells) * 100 : 0;

      // ============ ADVANCED CLEAN METRICS ============
      // Gross profit (sum of all positive clean trades)
      const grossProfit = cleanWins.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0);

      // Gross loss (absolute sum of all negative clean trades)
      const grossLossAbs = Math.abs(cleanLosses.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0));

      // Profit Factor
      let profitFactor: number | string = "N/A";
      if (grossLossAbs === 0) {
        profitFactor = grossProfit > 0 ? "∞" : "N/A";
      } else {
        profitFactor = parseFloat((grossProfit / grossLossAbs).toFixed(2));
      }

      // Avg Win
      const avgWin = cleanWinCount > 0
        ? parseFloat((grossProfit / cleanWinCount).toFixed(2))
        : 0;

      // Avg Loss (shown as negative)
      const avgLoss = cleanLossCount > 0
        ? parseFloat((-grossLossAbs / cleanLossCount).toFixed(2))
        : 0;

      // Avg Win/Loss Ratio
      const avgWinLossRatio = (avgWin > 0 && Math.abs(avgLoss) > 0)
        ? parseFloat((avgWin / Math.abs(avgLoss)).toFixed(2))
        : 0;

      // Expectancy (average PnL per trade)
      const expectancy = includedSells > 0
        ? parseFloat((cleanSellPnl / includedSells).toFixed(2))
        : 0;

      // ============ FLOATING PnL (Unrealized) ============
      // Use MarketDataService.getPrice() — the correct in-memory price cache
      let unrealizedPnl: number | null = null;
      let unrealizedPnlStatus: "ok" | "partial" | "unavailable" = "unavailable";
      const unrealizedPnlWarnings: string[] = [];

      if (openPositions.length > 0) {
        let runningPnl = 0;
        let positionsWithPrice = 0;

        for (const pos of openPositions) {
          try {
            const currentPrice = await MarketDataService.getPrice(pos.pair);
            const entryPrice = parseFloat(pos.price || "0");
            const amount = parseFloat(pos.amount || "0");

            if (currentPrice > 0 && entryPrice > 0 && amount > 0) {
              runningPnl += (currentPrice - entryPrice) * amount;
              positionsWithPrice++;
            } else {
              unrealizedPnlWarnings.push(`${pos.pair}: sin precio actual`);
            }
          } catch {
            unrealizedPnlWarnings.push(`${pos.pair}: error obteniendo precio`);
          }
        }

        if (positionsWithPrice === openPositions.length) {
          unrealizedPnlStatus = "ok";
          unrealizedPnl = parseFloat(runningPnl.toFixed(2));
        } else if (positionsWithPrice > 0) {
          unrealizedPnlStatus = "partial";
          unrealizedPnl = parseFloat(runningPnl.toFixed(2));
        } else {
          unrealizedPnlStatus = "unavailable";
          unrealizedPnl = null;
        }
      }

      // Total Simulated PnL (realized + floating)
      const totalSimulatedPnl = unrealizedPnl !== null
        ? parseFloat((cleanSellPnl + unrealizedPnl).toFixed(2))
        : cleanSellPnl;

      // ============ RISK LEVEL ============
      let strategyRiskLevel: "Bajo" | "Medio" | "Alto" | "Crítico" = "Bajo";
      if (totalOpenValue > 0 && unrealizedPnl !== null) {
        const floatingPct = (unrealizedPnl / totalOpenValue) * 100;
        if (floatingPct >= -1) {
          strategyRiskLevel = "Bajo";
        } else if (floatingPct >= -3) {
          strategyRiskLevel = "Medio";
        } else if (floatingPct >= -6) {
          strategyRiskLevel = "Alto";
        } else {
          strategyRiskLevel = "Crítico";
        }
      }
      // Check for emergency stops in recent clean trades
      const recentEmergency = cleanSells.some(t => {
        const reason = (t.normalizedReason || t.reason || "").toLowerCase();
        return reason.includes("emergency") || reason.includes("stop_loss");
      });
      if (recentEmergency && strategyRiskLevel !== "Crítico") {
        strategyRiskLevel = strategyRiskLevel === "Bajo" ? "Medio" : "Alto";
      }

      // ============ PnL BY EXIT REASON ============
      const reasonGroups: Record<string, { count: number; pnl: number }> = {};
      for (const trade of cleanSells) {
        const reason = trade.normalizedReason || trade.reason || "UNKNOWN";
        if (!reasonGroups[reason]) {
          reasonGroups[reason] = { count: 0, pnl: 0 };
        }
        reasonGroups[reason].count++;
        reasonGroups[reason].pnl += parseFloat(trade.realizedPnlUsd || "0");
      }
      const pnlByReason = Object.entries(reasonGroups).map(([reason, data]) => ({
        reason,
        count: data.count,
        pnl: parseFloat(data.pnl.toFixed(2)),
      })).sort((a, b) => b.pnl - a.pnl);

      // ============ SMART STRATEGY SCORE (0-100) ============
      let strategyScore = 0;
      const pros: string[] = [];
      const cons: string[] = [];

      // A) Rentabilidad limpia — 25 puntos
      if (cleanSellPnl > 0) {
        strategyScore += 10;
        pros.push("PnL limpio positivo");
      } else if (cleanSellPnl < 0) {
        cons.push("PnL limpio negativo");
      }
      if (expectancy > 0) {
        strategyScore += 8;
        pros.push("Expectancy positiva");
      } else if (expectancy < 0) {
        cons.push("Expectancy negativa - pérdida media por operación");
      }
      if (totalSimulatedPnl > 0 && cleanSellPnl > 0) {
        strategyScore += 7;
      } else if (totalSimulatedPnl < 0 && cleanSellPnl > 0) {
        // Good realized but floating is dragging down total
        strategyScore -= 5;
        cons.push("PnL flotante negativo arrastra rendimiento total");
      }

      // B) Riesgo / drawdown flotante — 25 puntos
      switch (strategyRiskLevel) {
        case "Bajo":
          strategyScore += 25;
          pros.push("Riesgo actual bajo");
          break;
        case "Medio":
          strategyScore += 15;
          break;
        case "Alto":
          strategyScore += 5;
          cons.push("Riesgo alto - pérdidas flotantes significativas");
          break;
        case "Crítico":
          strategyScore += 0;
          cons.push("Riesgo crítico - revisar posiciones abiertas inmediatamente");
          break;
      }

      // C) Calidad de salidas — 20 puntos
      const goodExits = ["TRAILING_STOP", "BREAK_EVEN", "SCALE_OUT", "SMART_EXIT"];
      const badExits = ["STOP_LOSS", "EMERGENCY_SL", "EMERGENCY_STOP_LOSS"];
      const goodExitPnL = pnlByReason
        .filter(r => goodExits.some(ge => r.reason.toUpperCase().includes(ge)))
        .reduce((sum, r) => sum + r.pnl, 0);
      const badExitPnL = pnlByReason
        .filter(r => badExits.some(be => r.reason.toUpperCase().includes(be)))
        .reduce((sum, r) => sum + r.pnl, 0);
      
      if (goodExitPnL > 0 && goodExitPnL > Math.abs(badExitPnL)) {
        strategyScore += 15;
        pros.push("Buena calidad de salidas (trailing, break-even, scale-out)");
      } else if (goodExitPnL > 0) {
        strategyScore += 10;
        pros.push("Salidas positivas detectadas");
      }
      if (badExitPnL < 0 && Math.abs(badExitPnL) > goodExitPnL * 0.5) {
        strategyScore -= 10;
        cons.push("Demasiadas salidas por stop-loss/emergency");
      } else if (badExitPnL < 0) {
        strategyScore -= 5;
      }
      strategyScore += 5; // Base points for exit quality

      // D) Calidad estadística — 15 puntos
      if (typeof profitFactor === "number" && profitFactor > 1) {
        strategyScore += 5;
        if (profitFactor > 1.5) {
          strategyScore += 5;
          pros.push("Profit factor superior a 1.5");
        }
      } else if (typeof profitFactor === "number" && profitFactor < 1) {
        cons.push("Profit factor inferior a 1 - pierde más de lo que gana");
      }
      if (cleanWinRate >= 45 && cleanWinRate <= 70 && expectancy > 0) {
        strategyScore += 5;
        pros.push("Win rate saludable (45-70%) con expectancy positiva");
      } else if (cleanWinRate > 70) {
        strategyScore -= 3;
        cons.push("Win rate muy alto - revisar sobreoptimización");
      }

      // E) Salud operativa — 10 puntos
      // Default healthy - will check bot_events for errors in future
      strategyScore += 10;

      // F) Tamaño de muestra / consistencia — 5 puntos
      if (includedSells >= 100) {
        strategyScore += 5;
        pros.push("Tamaño de muestra robusto (100+ operaciones)");
      } else if (includedSells >= 50) {
        strategyScore += 3;
      } else if (includedSells >= 30) {
        strategyScore += 1;
      } else {
        strategyScore -= 5;
        cons.push("Muestra pequeña (<30 operaciones) - estadísticas poco fiables");
      }

      // Clamp score between 0-100
      strategyScore = Math.max(0, Math.min(100, strategyScore));

      // ============ STRATEGY STATUS ============
      let strategyStatus: string;
      let strategySummary: string;
      let scoreColor: string;

      if (strategyScore <= 20) {
        strategyStatus = "PARAR";
        strategySummary = "La estrategia no es apta para operar. Revisar entradas, salidas y riesgo.";
        scoreColor = "red";
      } else if (strategyScore <= 40) {
        strategyStatus = "MALA";
        strategySummary = "La estrategia muestra deterioro. Conviene reducir actividad o seguir solo en simulación.";
        scoreColor = "red";
      } else if (strategyScore <= 60) {
        strategyStatus = "NEUTRA / SIN VENTAJA CLARA";
        strategySummary = "La estrategia no demuestra ventaja suficiente. Necesita más datos o ajustes.";
        scoreColor = "yellow";
      } else if (strategyScore <= 75) {
        strategyStatus = "EN MARCHA, PERO VIGILAR";
        strategySummary = "La estrategia funciona moderadamente, pero debe vigilarse riesgo, flotante y calidad de salidas.";
        scoreColor = "blue";
      } else if (strategyScore <= 90) {
        strategyStatus = "BUENA";
        strategySummary = "La estrategia muestra ventaja positiva con riesgo controlado.";
        scoreColor = "green";
      } else {
        strategyStatus = "EXCELENTE";
        strategySummary = "La estrategia muestra resultados muy fuertes. Revisar posible sobreoptimización antes de pasar a real.";
        scoreColor = "gold";
      }

      // Limit pros/cons to top 3 each
      const strategyPros = pros.slice(0, 3);
      const strategyCons = cons.slice(0, 3);

      // ============ ARCHIVED DUPLICATES ============
      let archivedDuplicates = 0;
      try {
        const archiveResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM dry_run_trades_archive`);
        archivedDuplicates = Number(archiveResult.rows[0]?.cnt || 0);
      } catch {
        archivedDuplicates = 0;
      }

      // ============ LEGEND ============
      const legend: Record<string, string> = {
        cleanSellPnl: "Beneficio/pérdida de las ventas válidas del modo simulación. Excluye operaciones antiguas marcadas como legacy.",
        unrealizedPnl: "Beneficio/pérdida estimada de posiciones simuladas que siguen abiertas. Puede cambiar con el mercado.",
        totalSimulatedPnl: "Suma del PnL limpio realizado y el PnL flotante abierto.",
        totalOpenValue: "Capital simulado actualmente bloqueado en posiciones abiertas.",
        cleanWinRate: "Porcentaje de operaciones válidas cerradas en positivo.",
        profitFactor: "Relación entre beneficios brutos y pérdidas brutas. Mayor de 1 indica que gana más de lo que pierde.",
        expectancy: "Resultado medio esperado por operación válida.",
        avgWin: "Ganancia media de las operaciones ganadoras.",
        avgLoss: "Pérdida media de las operaciones perdedoras.",
        strategyRiskLevel: "Estimación del riesgo según pérdidas flotantes, capital abierto, salidas de emergencia y salud de datos.",
        grossSellPnl: "Resultado total de todas las ventas del historial, incluyendo operaciones antiguas legacy. Sirve para auditoría, no como métrica principal.",
        excludedSellPnl: "Resultado de operaciones antiguas excluidas del PnL limpio, principalmente TimeStop en pérdida anteriores al fix.",
        includedSells: "Ventas válidas usadas para calcular las métricas limpias.",
        excludedSells: "Ventas antiguas auditadas que se conservan en histórico, pero no cuentan para el PnL limpio.",
        archivedDuplicates: "Operaciones duplicadas exactas movidas a archivo y retiradas del histórico activo.",
        strategyScore: "Puntuación de 0 a 100 que resume si la estrategia va bien encaminada. Combina PnL limpio, flotante, riesgo, calidad de salidas, profit factor, win rate, salud operativa y tamaño de muestra.",
      };

      // ============ RESPONSE ============
      res.json({
        // Legacy fields (backward compatibility)
        openCount: openPositions.length,
        totalOpenValue,
        closedCount: closedSells.length,
        realizedPnl: cleanSellPnl,
        wins: cleanWinCount,
        losses: cleanLossCount,
        winRate: parseFloat(cleanWinRate.toFixed(2)),

        // Clean breakdown
        grossSellPnl: parseFloat(grossSellPnl.toFixed(2)),
        cleanSellPnl: parseFloat(cleanSellPnl.toFixed(2)),
        excludedSellPnl: parseFloat(excludedSellPnl.toFixed(2)),
        totalSells: closedSells.length,
        includedSells,
        excludedSells: excludedSells.length,
        archivedDuplicates,

        // New advanced metrics
        unrealizedPnl,
        unrealizedPnlStatus,
        unrealizedPnlWarnings,
        totalSimulatedPnl,
        cleanWins: cleanWinCount,
        cleanLosses: cleanLossCount,
        cleanWinRate: parseFloat(cleanWinRate.toFixed(2)),
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        grossLoss: parseFloat((-grossLossAbs).toFixed(2)),
        profitFactor,
        avgWin,
        avgLoss,
        avgWinLossRatio,
        expectancy,

        // PnL by reason
        pnlByReason,

        // Smart Strategy Score
        strategyScore,
        strategyStatus,
        strategyRiskLevel,
        strategySummary,
        strategyColor: scoreColor,
        strategyPros,
        strategyCons,

        // Legend
        legend,
      });
    } catch (error: any) {
      console.error("[dryrun] Error fetching summary:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run summary" });
    }
  });

  // DELETE /api/dryrun/clear - Clear all dry run trades (reset DB + in-memory positions)
  app.delete("/api/dryrun/clear", async (_req, res) => {
    try {
      await db.delete(dryRunTrades);
      // Also clear in-memory positions so ExitManager doesn't try to sell ghost positions
      const engine = deps.getTradingEngine();
      if (engine) {
        engine.resetDryRunPositions();
      }
      res.json({ success: true, message: "All dry run trades cleared (DB + memory)" });
    } catch (error: any) {
      console.error("[dryrun] Error clearing trades:", error?.message);
      res.status(500).json({ error: "Failed to clear dry run trades" });
    }
  });

  // POST /api/dryrun/backfill - Recover historical dry run trades from bot_events
  app.post("/api/dryrun/backfill", async (req, res) => {
    try {
      // Defensive filters: only recent events (last 30 days by default)
      const daysBack = parseInt(req.body?.daysBack as string) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      // Find all DRY_RUN_TRADE events from bot_events (recent only)
      const events = await db.select().from(botEvents)
        .where(and(
          eq(botEvents.type, "DRY_RUN_TRADE"),
          sql`${botEvents.timestamp} >= ${cutoffDate}`
        ))
        .orderBy(botEvents.timestamp);

      let imported = 0;
      let skipped = 0;
      const skipReasons: Record<string, number> = {
        duplicate: 0,
        missingData: 0,
        invalidPrice: 0,
        invalidVolume: 0,
        invalidPair: 0,
      };

      for (const event of events) {
        try {
          const meta = event.meta ? JSON.parse(event.meta) : null;
          
          // Defensive validation: require all critical fields
          if (!meta || !meta.pair || !meta.type || !meta.simTxid) {
            skipped++;
            skipReasons.missingData++;
            continue;
          }

          // Validate pair format (must be XXX/YYY)
          if (!meta.pair.includes('/')) {
            skipped++;
            skipReasons.invalidPair++;
            continue;
          }

          // Check if already exists (idempotency)
          const existing = await db.select({ id: dryRunTrades.id }).from(dryRunTrades)
            .where(eq(dryRunTrades.simTxid, meta.simTxid))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            skipReasons.duplicate++;
            continue;
          }

          const price = parseFloat(meta.price || "0");
          const volume = parseFloat(meta.volume || meta.amount || "0");
          
          // Defensive validation: reject invalid numbers
          if (price <= 0 || isNaN(price)) {
            skipped++;
            skipReasons.invalidPrice++;
            continue;
          }
          
          if (volume <= 0 || isNaN(volume)) {
            skipped++;
            skipReasons.invalidVolume++;
            continue;
          }
          
          const totalUsd = parseFloat(meta.totalUsd || String(price * volume));

          if (meta.type === "buy") {
            await db.insert(dryRunTrades).values({
              simTxid: meta.simTxid,
              pair: meta.pair,
              type: "buy",
              price: price.toFixed(8),
              amount: volume.toFixed(8),
              totalUsd: totalUsd.toFixed(2),
              reason: meta.reason || null,
              status: "open",
              strategyId: meta.strategyId || null,
              regime: meta.regime || null,
              confidence: meta.confidence != null ? String(meta.confidence) : null,
              createdAt: event.timestamp,
            });
            imported++;
          } else if (meta.type === "sell") {
            // Find matching open buy for this pair (FIFO)
            const openBuys = await db.select().from(dryRunTrades)
              .where(and(eq(dryRunTrades.pair, meta.pair), eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")))
              .orderBy(dryRunTrades.createdAt)
              .limit(1);

            const matchedBuy = openBuys[0];
            const entryPriceNum = matchedBuy ? parseFloat(matchedBuy.price) : price;
            const pnlUsd = (price - entryPriceNum) * volume;
            const pnlPct = entryPriceNum > 0 ? ((price - entryPriceNum) / entryPriceNum) * 100 : 0;

            await db.insert(dryRunTrades).values({
              simTxid: meta.simTxid,
              pair: meta.pair,
              type: "sell",
              price: price.toFixed(8),
              amount: volume.toFixed(8),
              totalUsd: totalUsd.toFixed(2),
              reason: meta.reason || null,
              status: "closed",
              entrySimTxid: matchedBuy?.simTxid || null,
              entryPrice: entryPriceNum.toFixed(8),
              realizedPnlUsd: pnlUsd.toFixed(2),
              realizedPnlPct: pnlPct.toFixed(4),
              closedAt: event.timestamp,
              strategyId: meta.strategyId || null,
              regime: meta.regime || null,
              confidence: meta.confidence != null ? String(meta.confidence) : null,
              createdAt: event.timestamp,
            });

            if (matchedBuy) {
              await db.update(dryRunTrades)
                .set({ status: "closed", closedAt: event.timestamp, realizedPnlUsd: pnlUsd.toFixed(2), realizedPnlPct: pnlPct.toFixed(4) })
                .where(eq(dryRunTrades.id, matchedBuy.id));
            }
            imported++;
          }
        } catch (e: any) {
          console.error("[dryrun] Backfill event error:", e?.message);
          skipped++;
        }
      }

      res.json({ 
        success: true, 
        totalEvents: events.length, 
        imported, 
        skipped,
        skipReasons,
        daysBack,
        cutoffDate: cutoffDate.toISOString()
      });
    } catch (error: any) {
      console.error("[dryrun] Error backfilling:", error?.message);
      res.status(500).json({ error: "Failed to backfill dry run trades" });
    }
  });

  // GET /api/dryrun/exit-audit - Exit audit: stats grouped by reason, pair, duplicates
  // FASE 2/3/8 — Provides data for the SmartGuard exit audit dashboard
  app.get("/api/dryrun/exit-audit", async (_req, res) => {
    try {
      // Fetch all sell records
      const sells = await db.select().from(dryRunTrades)
        .where(eq(dryRunTrades.type, "sell"))
        .orderBy(desc(dryRunTrades.createdAt));

      if (sells.length === 0) {
        return res.json({
          totalSells: 0,
          byReason: [],
          byPair: [],
          duplicates: [],
          summary: { totalPnlUsd: 0, wins: 0, losses: 0, winRate: 0, worstLoss: 0, bestGain: 0 },
        });
      }

      // ── Classify reasons (use stored normalizedReason if present, else classify on-the-fly)
      interface EnrichedSell {
        id: number;
        pair: string;
        normalizedReason: NormalizedExitReason;
        reason: string | null;
        pnlUsd: number;
        pnlPct: number;
        entrySimTxid: string | null;
        closedAt: Date | null;
        createdAt: Date;
      }

      const enriched: EnrichedSell[] = sells.map(s => ({
        id: s.id,
        pair: s.pair,
        normalizedReason: (s.normalizedReason as NormalizedExitReason | null) ?? classifyExitReason(s.reason),
        reason: s.reason ?? null,
        pnlUsd: parseFloat(s.realizedPnlUsd ?? "0"),
        pnlPct: parseFloat(s.realizedPnlPct ?? "0"),
        entrySimTxid: s.entrySimTxid ?? null,
        closedAt: s.closedAt ?? null,
        createdAt: s.createdAt,
      }));

      // ── Stats by normalized reason ──────────────────────────────────────────
      const reasonMap = new Map<NormalizedExitReason, EnrichedSell[]>();
      for (const s of enriched) {
        const arr = reasonMap.get(s.normalizedReason) ?? [];
        arr.push(s);
        reasonMap.set(s.normalizedReason, arr);
      }

      const byReason = Array.from(reasonMap.entries()).map(([reason, trades]) => {
        const pnls = trades.map(t => t.pnlUsd);
        const wins = pnls.filter(p => p > 0).length;
        const losses = pnls.filter(p => p <= 0).length;
        const total = pnls.reduce((a, b) => a + b, 0);
        const avg = total / pnls.length;
        const sorted = [...pnls].sort((a, b) => a - b);
        const median = pnls.length % 2 === 0
          ? (sorted[pnls.length / 2 - 1] + sorted[pnls.length / 2]) / 2
          : sorted[Math.floor(pnls.length / 2)];
        const pnlPcts = trades.map(t => t.pnlPct);
        const avgPct = pnlPcts.reduce((a, b) => a + b, 0) / pnlPcts.length;
        return {
          reason,
          count: trades.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          avgPnlUsd: parseFloat(avg.toFixed(2)),
          medianPnlUsd: parseFloat(median.toFixed(2)),
          winRate: parseFloat(((wins / trades.length) * 100).toFixed(1)),
          wins,
          losses,
          worstLossUsd: parseFloat(Math.min(...pnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...pnls).toFixed(2)),
          avgPnlPct: parseFloat(avgPct.toFixed(3)),
          isProblematic: total < 0 && losses > wins,
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd); // worst first

      // ── Stats by pair ───────────────────────────────────────────────────────
      const pairMap = new Map<string, EnrichedSell[]>();
      for (const s of enriched) {
        const arr = pairMap.get(s.pair) ?? [];
        arr.push(s);
        pairMap.set(s.pair, arr);
      }

      const byPair = Array.from(pairMap.entries()).map(([pair, trades]) => {
        const pnls = trades.map(t => t.pnlUsd);
        const wins = pnls.filter(p => p > 0).length;
        const total = pnls.reduce((a, b) => a + b, 0);
        // Find most common reason and worst reason
        const reasonCounts = new Map<string, number>();
        trades.forEach(t => reasonCounts.set(t.normalizedReason, (reasonCounts.get(t.normalizedReason) ?? 0) + 1));
        const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";
        const worstReason = trades.filter(t => t.pnlUsd <= 0)
          .reduce<{ reason: string; pnl: number } | null>((acc, t) => (!acc || t.pnlUsd < acc.pnl) ? { reason: t.normalizedReason, pnl: t.pnlUsd } : acc, null);
        return {
          pair,
          count: trades.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((wins / trades.length) * 100).toFixed(1)),
          worstLossUsd: parseFloat(Math.min(...pnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...pnls).toFixed(2)),
          topExitReason: topReason,
          worstExitReason: worstReason?.reason ?? null,
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // ── Duplicate detection ─────────────────────────────────────────────────
      // FASE 3 — same entrySimTxid appearing in multiple sell rows = potential duplicate
      const entryTxidCount = new Map<string, number>();
      for (const s of enriched) {
        if (s.entrySimTxid) {
          entryTxidCount.set(s.entrySimTxid, (entryTxidCount.get(s.entrySimTxid) ?? 0) + 1);
        }
      }
      const duplicates = Array.from(entryTxidCount.entries())
        .filter(([, count]) => count > 1)
        .map(([entrySimTxid, count]) => {
          const dupeRows = enriched.filter(s => s.entrySimTxid === entrySimTxid);
          const totalPnl = dupeRows.reduce((a, s) => a + s.pnlUsd, 0);
          return { entrySimTxid, count, pairs: [...new Set(dupeRows.map(s => s.pair))], totalPnlUsd: parseFloat(totalPnl.toFixed(2)) };
        });

      // ── Global summary ──────────────────────────────────────────────────────
      const allPnls = enriched.map(s => s.pnlUsd);
      const totalPnlUsd = allPnls.reduce((a, b) => a + b, 0);
      const wins = allPnls.filter(p => p > 0).length;
      const losses = allPnls.filter(p => p <= 0).length;

      res.json({
        totalSells: enriched.length,
        byReason,
        byPair,
        duplicates,
        duplicateCount: duplicates.length,
        summary: {
          totalPnlUsd: parseFloat(totalPnlUsd.toFixed(2)),
          wins,
          losses,
          winRate: parseFloat(((wins / enriched.length) * 100).toFixed(1)),
          worstLoss: parseFloat(Math.min(...allPnls).toFixed(2)),
          bestGain: parseFloat(Math.max(...allPnls).toFixed(2)),
        },
        alerts: {
          timeStopNegative: (byReason.find(r => r.reason === "TIME_STOP")?.totalPnlUsd ?? 0) < 0,
          emergencySlExcessive: (byReason.find(r => r.reason === "EMERGENCY_SL")?.count ?? 0) > 5,
          duplicatesDetected: duplicates.length > 0,
        },
      });
    } catch (error: any) {
      console.error("[dryrun] Error in exit-audit:", error?.message);
      res.status(500).json({ error: "Failed to compute exit audit" });
    }
  });
};
