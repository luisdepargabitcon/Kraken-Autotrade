import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { krakenService } from "../services/kraken";
import { telegramService } from "../services/telegram";
import { botLogger } from "../services/botLogger";
import { environment } from "../services/environment";
import { errorAlertService, ErrorAlertService } from "../services/ErrorAlertService";

export const registerPositionsRoutes: RegisterRoutes = (app, deps) => {

  app.get("/api/open-positions", async (req, res) => {
    try {
      const rawPositions = await storage.getOpenPositions();
      const positions = rawPositions.filter((pos: any) => {
        const status = String(pos.status || 'OPEN');
        if (status === 'FAILED' || status === 'CANCELLED') return false;
        const amount = parseFloat(String(pos.amount ?? '0'));
        if (status === 'OPEN' && (!Number.isFinite(amount) || amount <= 0)) return false;
        return true;
      });
      
      const botConfig = await storage.getBotConfig();
      const krakenFeePct = parseFloat(botConfig?.takerFeePct || "0.40") / 100;
      
      // Fee % según exchange (RevolutX 0.09%, Kraken según config)
      const feePctForExchange = (exchange: string) => {
        if (exchange === 'revolutx') return 0.09 / 100;  // 0.09%
        return krakenFeePct;
      };
      
      const positionsWithPnl = await Promise.all(positions.map(async (pos) => {
        let currentPrice = 0;
        let unrealizedPnlUsd = 0;
        let unrealizedPnlPct = 0;

        const ex = ((pos as any).exchange as string | undefined) || 'kraken';
        try {
          // RevolutX no tiene endpoint de ticker - usar Kraken para precio actual
          if (krakenService.isInitialized()) {
            const krakenPair = krakenService.formatPair(pos.pair);
            const ticker = await krakenService.getTickerRaw(krakenPair);
            const tickerData: any = Object.values(ticker)[0];
            if (tickerData?.c?.[0]) {
              currentPrice = parseFloat(tickerData.c[0]);
              console.log(`[open-positions] ${pos.pair} (${ex}): precio actual de Kraken = $${currentPrice}`);
            } else {
              console.warn(`[open-positions] ${pos.pair} (${ex}): ticker sin precio válido`, tickerData);
            }
          } else {
            console.warn(`[open-positions] ${pos.pair}: Kraken no inicializado, no se puede obtener precio`);
          }

          if (currentPrice > 0) {
            const entryPrice = parseFloat(pos.entryPrice);
            const amount = parseFloat(pos.amount);
            unrealizedPnlUsd = (currentPrice - entryPrice) * amount;
            unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            console.warn(`[open-positions] ${pos.pair}: precio actual = 0, no se puede calcular PnL`);
          }
        } catch (e: any) {
          console.error(`[open-positions] Error obteniendo precio para ${pos.pair} (${ex}):`, e.message || e);
        }
        
        const amount = parseFloat(pos.amount);
        const entryPrice = parseFloat(pos.entryPrice);
        const entryValueUsd = entryPrice * amount;
        const currentValueUsd = currentPrice * amount;
        
        const feePct = feePctForExchange(ex);  // Fee según exchange (RevolutX 0.09%, Kraken ~0.40%)
        const storedEntryFee = pos.entryFee != null ? parseFloat(pos.entryFee.toString()) : null;
        const entryFeeUsd = storedEntryFee != null && !isNaN(storedEntryFee) ? storedEntryFee : (entryValueUsd * feePct);
        const exitFeeUsd = currentValueUsd * feePct;
        const netPnlUsd = currentPrice > 0 ? (unrealizedPnlUsd - entryFeeUsd - exitFeeUsd) : 0;
        const netPnlPct = entryValueUsd > 0 && currentPrice > 0 ? (netPnlUsd / entryValueUsd) * 100 : 0;
        
        // Smart Exit Engine: attach decision state if available
        let smartExitState: any = undefined;
        try {
          const tradingEngine = deps.getTradingEngine();
          if (tradingEngine) {
            const decisions = tradingEngine.getSmartExitDecisions();
            const decision = decisions.get(pos.lotId);
            if (decision) {
              smartExitState = {
                score: decision.score,
                threshold: decision.threshold,
                regime: decision.regime,
                shouldExit: decision.shouldExit,
                confirmationProgress: decision.confirmationProgress,
                confirmationRequired: decision.confirmationRequired,
                reasons: decision.reasons,
              };
            }
          }
        } catch { /* smartExit state is optional */ }

        return {
          ...pos,
          currentPrice: currentPrice.toString(),
          unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
          unrealizedPnlPct: unrealizedPnlPct.toFixed(2),
          netPnlUsd: netPnlUsd.toFixed(2),
          netPnlPct: netPnlPct.toFixed(2),
          entryValueUsd: entryValueUsd.toFixed(2),
          currentValueUsd: currentValueUsd.toFixed(2),
          smartExitState,
        };
      }));
      
      res.json(positionsWithPnl);
    } catch (error) {
      console.error("[api/open-positions] Error:", error);
      res.status(500).json({ error: "Failed to get open positions" });
    }
  });

  // Refresh SmartGuard snapshots for all open positions with current config
  app.post("/api/positions/refresh-snapshots", async (req, res) => {
    try {
      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(503).json({ error: "Motor de trading no inicializado" });
      }

      const result = await tradingEngine.refreshSmartGuardSnapshots();
      res.json({
        success: true,
        message: `Snapshots actualizados: ${result.updated} posiciones, ${result.skipped} omitidas`,
        ...result,
      });
    } catch (error: any) {
      console.error("[api/positions/refresh-snapshots] Error:", error);
      res.status(500).json({ error: error.message || "Failed to refresh snapshots" });
    }
  });

  // Smart Exit Engine diagnostics — returns current Smart Exit state per position
  app.get("/api/positions/smart-exit-diagnostics", async (req, res) => {
    try {
      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(503).json({ error: "Motor de trading no inicializado" });
      }

      const decisions = tradingEngine.getSmartExitDecisions();
      const result: Record<string, any> = {};
      for (const [lotId, decision] of decisions.entries()) {
        result[lotId] = {
          score: decision.score,
          threshold: decision.threshold,
          regime: decision.regime,
          shouldExit: decision.shouldExit,
          confirmationProgress: decision.confirmationProgress,
          confirmationRequired: decision.confirmationRequired,
          reasons: decision.reasons,
          contributions: decision.contributions,
          pnlPct: decision.pnlPct,
          positionAgeSec: decision.positionAgeSec,
        };
      }

      res.json({ smartExitEnabled: true, positions: result, count: decisions.size });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Smart Exit diagnostics failed" });
    }
  });

  app.post("/api/positions/:pair/buy", async (req, res) => {
    try {
      const pair = req.params.pair.replace("-", "/");
      const { usdAmount, reason, confirm } = req.body;

      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(503).json({ error: "Motor de trading no inicializado" });
      }

      if (!confirm) {
        return res.status(400).json({
          error: "CONFIRM_REQUIRED",
          message: "Operación REAL: envía confirm=true para ejecutar la compra",
        });
      }

      const usdAmountNum = typeof usdAmount === "number" ? usdAmount : parseFloat(String(usdAmount || "0"));
      if (!Number.isFinite(usdAmountNum) || usdAmountNum <= 0) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "usdAmount inválido" });
      }

      const correlationId = `MANUAL-BUY-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const reasonWithCorrelation = `${reason || "Compra manual (API)"} [${correlationId}]`;
      const result = await tradingEngine.manualBuyForTest(pair, usdAmountNum, reasonWithCorrelation);
      if (!result.success) {
        return res.status(400).json({ error: result.error || "BUY failed" });
      }

      res.json({ ...result, correlationId });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to execute manual buy" });
    }
  });

  // === CIERRE MANUAL DE POSICIÓN ===
  app.post("/api/positions/:pair/close", async (req, res) => {
    try {
      const pair = req.params.pair.replace("-", "/"); // Convert BTC-USD back to BTC/USD
      const { reason, lotId } = req.body; // Optional lotId for multi-lot support
      
      const correlationId = `MANUAL-CLOSE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // Verificar que la posición existe
      const positions = await storage.getOpenPositions();
      let position;
      if (lotId) {
        // Specific lot requested
        position = positions.find(p => p.lotId === lotId && p.status === 'OPEN');
      } else {
        // Close first position for the pair
        position = positions.find(p => p.pair === pair && p.status === 'OPEN');
      }
      
      if (!position) {
        await botLogger.warn("MANUAL_CLOSE_FAILED", `Intento de cierre manual fallido - posición no encontrada`, {
          pair,
          lotId: lotId || "not_specified",
          correlationId,
          reason: reason || "Usuario solicitó cierre manual",
        });
        
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición OPEN para ${pair}`,
        });
      }
      
      // Obtener precio actual (con fallback para DRY_RUN)
      let currentPrice: number;
      const botConfig = await storage.getBotConfig();
      const isDryRun = botConfig?.dryRunMode || environment.isReplit;
      
      if (krakenService.isInitialized()) {
        try {
          const krakenPair = krakenService.formatPair(pair);
          const ticker = await krakenService.getTickerRaw(krakenPair);
          const tickerData: any = Object.values(ticker)[0];
          
          if (tickerData?.c?.[0]) {
            currentPrice = parseFloat(tickerData.c[0]);
          } else {
            throw new Error("No ticker data");
          }
        } catch (e) {
          if (!isDryRun) {
            return res.status(500).json({
              success: false,
              error: "PRICE_UNAVAILABLE",
              message: "No se pudo obtener el precio actual",
            });
          }
          // En DRY_RUN, usar precio de entrada como fallback
          currentPrice = parseFloat(position.entryPrice);
        }
      } else {
        if (!isDryRun) {
          return res.status(503).json({
            success: false,
            error: "KRAKEN_NOT_INITIALIZED",
            message: "Kraken API no está conectada",
          });
        }
        // En DRY_RUN, usar precio de entrada como fallback (simulación)
        currentPrice = parseFloat(position.entryPrice);
      }
      const amount = parseFloat(position.amount);
      const entryPrice = parseFloat(position.entryPrice);
      const pnlUsd = (currentPrice - entryPrice) * amount;
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      const positionLotId = position.lotId;
      
      // Log el intento de cierre manual
      await botLogger.info("MANUAL_CLOSE_INITIATED", `Cierre manual iniciado por usuario`, {
        correlationId,
        pair,
        lotId: positionLotId,
        amount,
        entryPrice,
        currentPrice,
        estimatedPnlUsd: pnlUsd.toFixed(2),
        estimatedPnlPct: pnlPct.toFixed(2),
        reason: reason || "Usuario solicitó cierre manual",
      });
      
      // Ejecutar la venta a través del trading engine
      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(503).json({
          success: false,
          error: "ENGINE_NOT_RUNNING",
          message: "Motor de trading no está activo",
        });
      }
      
      const closeResult = await tradingEngine.forceClosePosition(pair, currentPrice, correlationId, reason || "Cierre manual por usuario", positionLotId);
      
      if (closeResult.success) {
        await botLogger.info("MANUAL_CLOSE_SUCCESS", `Posición cerrada manualmente`, {
          correlationId,
          pair,
          lotId: closeResult.lotId || positionLotId,
          amount,
          exitPrice: currentPrice,
          realizedPnlUsd: closeResult.pnlUsd?.toFixed(2),
          realizedPnlPct: closeResult.pnlPct?.toFixed(2),
          krakenOrderId: closeResult.orderId,
          dryRun: closeResult.dryRun,
        });
        
        res.json({
          success: true,
          correlationId,
          pair,
          lotId: closeResult.lotId || positionLotId,
          amount,
          exitPrice: currentPrice,
          realizedPnlUsd: closeResult.pnlUsd?.toFixed(2),
          realizedPnlPct: closeResult.pnlPct?.toFixed(2),
          orderId: closeResult.orderId,
          message: closeResult.dryRun 
            ? `[DRY_RUN] Cierre simulado de ${pair}`
            : `Posición ${pair} cerrada exitosamente`,
        });
      } else {
        // Caso DUST: devolver 200 con flag isDust para que UI ofrezca "Eliminar huérfana"
        if (closeResult.isDust) {
          await botLogger.warn("MANUAL_CLOSE_DUST", `Posición DUST detectada - no se puede cerrar`, {
            correlationId,
            pair,
            lotId: positionLotId,
            error: closeResult.error,
          });
          
          return res.json({
            success: false,
            correlationId,
            error: "DUST_POSITION",
            isDust: true,
            lotId: positionLotId,
            message: closeResult.error || "Balance real menor al mínimo de Kraken",
          });
        }
        
        await botLogger.error("MANUAL_CLOSE_FAILED", `Error al cerrar posición manualmente`, {
          correlationId,
          pair,
          lotId: positionLotId,
          error: closeResult.error,
        });
        
        res.status(500).json({
          success: false,
          correlationId,
          error: "CLOSE_FAILED",
          message: closeResult.error || "Error al cerrar la posición",
        });
      }
      
    } catch (error: any) {
      const pair = req.params.pair?.replace("-", "/") || "UNKNOWN";
      const { lotId } = req.body || {};
      const botConfigErr = await storage.getBotConfig();
      const isDryRunErr = botConfigErr?.dryRunMode || environment.isReplit;
      
      console.error("[api/positions/close] FULL ERROR:", {
        message: error.message,
        stack: error.stack,
        pair,
        lotId: lotId || "not_specified",
        isDryRun: isDryRunErr,
        timestamp: new Date().toISOString(),
      });
      
      // Enviar alerta crítica de error en API de trading
      const alert = ErrorAlertService.createFromError(
        error,
        'TRADING_ERROR',
        'CRITICAL',
        'closePosition',
        'server/routes.ts',
        pair,
        { 
          endpoint: '/api/positions/close',
          lotId: lotId || "not_specified",
          isDryRun: isDryRunErr,
          userAgent: req.headers['user-agent']
        }
      );
      await errorAlertService.sendCriticalError(alert);
      
      await botLogger.error("MANUAL_CLOSE_EXCEPTION", `Excepción no controlada en cierre manual`, {
        pair,
        lotId: lotId || "not_specified",
        isDryRun: isDryRunErr,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: `Error al procesar cierre: ${error.message}`,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // === ELIMINAR POSICIÓN HUÉRFANA (DUST) ===
  // Solo elimina el registro interno de DB/memoria, NO envía orden a Kraken
  app.delete("/api/positions/:lotId/orphan", async (req, res) => {
    try {
      const lotId = req.params.lotId;
      const { reason } = req.body || {};
      
      // Verificar que la posición existe en DB
      const dbPosition = await storage.getOpenPositionByLotId(lotId);
      if (!dbPosition) {
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición con lotId: ${lotId}`,
        });
      }
      
      const pair = dbPosition.pair;
      
      // Eliminar de DB
      await storage.deleteOpenPositionByLotId(lotId);
      
      // Eliminar de memoria del trading engine
      const tradingEngine = deps.getTradingEngine();
      if (tradingEngine) {
        const positions = tradingEngine.getOpenPositions();
        positions.delete(lotId);
      }
      
      await botLogger.info("ORPHAN_POSITION_DELETED", `Posición huérfana eliminada manualmente`, {
        pair,
        lotId,
        amount: dbPosition.amount,
        entryPrice: dbPosition.entryPrice,
        reason: reason || "orphan_dust_cleanup",
        env: environment.isReplit ? "REPLIT" : "NAS",
      });
      
      // Notificar por Telegram
      if (telegramService?.isInitialized()) {
        await telegramService.sendMessage(`
🗑️ *Posición Huérfana Eliminada*

*Par:* ${pair}
*Lot:* \`${lotId.substring(0, 8)}...\`
*Cantidad:* ${dbPosition.amount}

_Eliminada manualmente desde dashboard (sin orden a Kraken)_
        `.trim());
      }
      
      res.json({
        success: true,
        lotId,
        pair,
        deleted: true,
        message: `Posición huérfana eliminada de BD`,
      });
      
    } catch (error: any) {
      console.error("[api/positions/orphan] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: error.message,
      });
    }
  });

  // === TOGGLE TIME-STOP POR POSICIÓN ===
  // Nota: Este endpoint asume acceso seguro via red local o VPN, igual que otras rutas críticas
  app.patch("/api/positions/:lotId/time-stop", async (req, res) => {
    try {
      const lotId = req.params.lotId;
      const { disabled } = req.body;
      
      // Validación del body
      if (typeof disabled !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "INVALID_REQUEST",
          message: "El campo 'disabled' debe ser un booleano (true/false)",
        });
      }
      
      const position = await storage.getOpenPositionByLotId(lotId);
      if (!position) {
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición con lotId: ${lotId}`,
        });
      }
      
      // DB primero para garantizar persistencia - si falla, no actualizamos memoria
      const updatedPosition = await storage.updateOpenPositionByLotId(lotId, { 
        timeStopDisabled: disabled 
      });
      
      if (!updatedPosition) {
        return res.status(500).json({
          success: false,
          error: "UPDATE_FAILED",
          message: "No se pudo actualizar la posición en la base de datos",
        });
      }
      
      // Solo actualizamos memoria después de confirmar persistencia en DB
      const tradingEngine = deps.getTradingEngine();
      if (tradingEngine) {
        const positions = tradingEngine.getOpenPositions();
        const memPos = positions.get(lotId) as any;
        if (memPos) {
          memPos.timeStopDisabled = disabled;
        }
      }
      
      console.log(`[TIME_STOP_TOGGLE] lotId=${lotId} pair=${position.pair} disabled=${disabled}`);
      
      res.json({
        success: true,
        lotId,
        pair: position.pair,
        timeStopDisabled: disabled,
        message: disabled ? "Time-stop desactivado para esta posición" : "Time-stop reactivado",
      });
      
    } catch (error: any) {
      console.error("[api/positions/time-stop] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: error.message,
      });
    }
  });
};
