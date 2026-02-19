import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { krakenService } from "../services/kraken";
import { telegramService } from "../services/telegram";
import { botLogger } from "../services/botLogger";
import { environment } from "../services/environment";
import { ExchangeFactory } from "../services/exchanges/ExchangeFactory";
import { errorAlertService, ErrorAlertService } from "../services/ErrorAlertService";
import { z } from "zod";

export const registerTestRoutes: RegisterRoutes = (app, deps) => {

  // ============================================================
  // TEST ENDPOINT: Simular señal BUY para validar SMART_GUARD
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/signal", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      // SEGURIDAD: Solo permitir en REPLIT/DEV o dryRun=true
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este endpoint solo está disponible en entorno de desarrollo (REPLIT/DEV) o con dryRun activado",
          env: envInfo.env,
          dryRun,
        });
      }
      
      // Validar body
      const testSignalSchema = z.object({
        pair: z.string().min(1),
        signal: z.enum(["BUY"]),
        price: z.number().positive().optional(),
        forceOrderUsd: z.number().positive().optional(),
        forceHasPosition: z.boolean().optional(),
        forceOpenLots: z.number().int().min(0).optional(),
      });
      
      const parsed = testSignalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Parámetros inválidos",
          details: parsed.error.issues,
        });
      }
      
      const { pair, signal, price, forceOrderUsd, forceHasPosition, forceOpenLots } = parsed.data;
      const correlationId = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      // Obtener datos del mercado si no se proporciona precio
      let currentPrice = price;
      if (!currentPrice) {
        try {
          const ticker = await krakenService.getTicker(pair);
          currentPrice = ticker.last || 0;
        } catch {
          currentPrice = 100; // Fallback para test
        }
      }
      
      // Obtener configuración SMART_GUARD
      const positionMode = botConfig?.positionMode || "SINGLE";
      const sgMinEntryUsd = parseFloat(botConfig?.sgMinEntryUsd?.toString() || "100");
      const sgAllowUnderMin = botConfig?.sgAllowUnderMin ?? true;
      const sgMaxOpenLotsPerPair = 1; // Por defecto 1, se implementará en paso 3
      const SG_ABSOLUTE_MIN_USD = 20;
      
      // Obtener balance USD
      let usdBalance = 0;
      try {
        const balances = await krakenService.getBalance();
        usdBalance = balances?.ZUSD || balances?.USD || 0;
      } catch {
        usdBalance = 100; // Fallback para test
      }
      
      // Simular orderUsdFinal
      const orderUsdFinal = forceOrderUsd ?? Math.min(usdBalance * 0.95, sgMinEntryUsd);
      
      const tradingEngine = deps.getTradingEngine();
      // Simular si hay posición abierta
      const hasPosition = forceHasPosition ?? (tradingEngine?.getOpenPositions().has(pair) ?? false);
      const openLots = forceOpenLots ?? (hasPosition ? 1 : 0);
      
      // Construir meta base
      const baseMeta = {
        correlationId,
        pair,
        signal,
        env: envInfo.env,
        instanceId: envInfo.instanceId,
        testMode: true,
        positionMode,
        usdDisponible: usdBalance,
        orderUsdProposed: sgMinEntryUsd,
        orderUsdFinal,
        sgMinEntryUsd,
        sgAllowUnderMin,
        sgMaxOpenLotsPerPair,
        absoluteMinOrderUsd: SG_ABSOLUTE_MIN_USD,
        hasPosition,
        openLots,
        currentPrice,
      };
      
      let result: { decision: string; reason: string; message: string };
      
      // === VALIDACIÓN 1: Posición abierta en SMART_GUARD/SINGLE ===
      if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && hasPosition && openLots >= sgMaxOpenLotsPerPair) {
        const reason = positionMode === "SMART_GUARD" 
          ? (openLots >= sgMaxOpenLotsPerPair ? "SMART_GUARD_MAX_LOTS_REACHED" : "SMART_GUARD_POSITION_EXISTS")
          : "SINGLE_MODE_POSITION_EXISTS";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - ${reason}`, {
          ...baseMeta,
          reason,
          existingLots: openLots,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: reason === "SMART_GUARD_MAX_LOTS_REACHED"
            ? `Máximo de lotes abiertos alcanzado (${openLots}/${sgMaxOpenLotsPerPair})`
            : "Ya hay posición abierta en este par",
        };
      }
      // === VALIDACIÓN 2: Mínimo absoluto exchange (MIN_ORDER_ABSOLUTE) - Prioridad más alta ===
      else if (orderUsdFinal < SG_ABSOLUTE_MIN_USD) {
        const reason = "MIN_ORDER_ABSOLUTE";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - mínimo absoluto exchange`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: `Mínimo absoluto exchange no alcanzado: $${orderUsdFinal.toFixed(2)} < $${SG_ABSOLUTE_MIN_USD}`,
        };
      }
      // === VALIDACIÓN 3: Mínimo por orden (MIN_ORDER_USD) ===
      else if (positionMode === "SMART_GUARD" && !sgAllowUnderMin && orderUsdFinal < sgMinEntryUsd) {
        const reason = "MIN_ORDER_USD";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - mínimo por orden no alcanzado`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: `Mínimo por orden no alcanzado: $${orderUsdFinal.toFixed(2)} < $${sgMinEntryUsd.toFixed(2)} (allowUnderMin=OFF)`,
        };
      }
      // === CASO POSITIVO: Trade permitido (simulado) ===
      else {
        const reason = "TEST_TRADE_ALLOWED";
        
        await botLogger.info("TEST_TRADE_SIMULATED", `[TEST] Señal BUY pasaría todas las validaciones`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TEST_TRADE_SIMULATED",
          reason,
          message: `Trade de $${orderUsdFinal.toFixed(2)} pasaría todas las validaciones en ${positionMode}`,
        };
      }
      
      res.json({
        success: true,
        correlationId,
        ...result,
        meta: baseMeta,
      });
      
    } catch (error: any) {
      console.error("[api/test/signal] Error:", error.message);
      res.status(500).json({
        error: "TEST_SIGNAL_ERROR",
        message: `Error al procesar señal de prueba: ${error.message}`,
      });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Simular eventos SMART_GUARD para testing
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/sg-event", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      // SEGURIDAD: Solo permitir en REPLIT/DEV o dryRun=true
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este endpoint solo está disponible en entorno de desarrollo (REPLIT/DEV) o con dryRun activado",
        });
      }
      
      const testEventSchema = z.object({
        event: z.enum(["SG_BREAK_EVEN_ACTIVATED", "SG_TRAILING_ACTIVATED", "SG_TRAILING_STOP_UPDATED", "SG_SCALE_OUT_EXECUTED"]),
        pair: z.string().default("BTC/USD"),
        lotId: z.string().optional(),
        entryPrice: z.number().positive().default(100000),
        currentPrice: z.number().positive().optional(),
        profitPct: z.number().default(2.5),
        stopPrice: z.number().positive().optional(),
        scaleOutQty: z.number().positive().optional(),
        scaleOutUsd: z.number().positive().optional(),
      });
      
      const parsed = testEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { event, pair, entryPrice, profitPct } = parsed.data;
      const lotId = parsed.data.lotId || `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const currentPrice = parsed.data.currentPrice || entryPrice * (1 + profitPct / 100);
      const stopPrice = parsed.data.stopPrice || currentPrice * 0.98;
      
      const baseMeta = {
        pair,
        lotId,
        entryPrice,
        currentPrice,
        profitPct: profitPct.toFixed(2) + "%",
        env: envInfo.env,
        instanceId: envInfo.instanceId,
        testMode: true,
      };
      
      let message = "";
      let telegramMsg = "";
      const prefix = environment.getMessagePrefix(true); // Test events are always DRY_RUN
      
      switch (event) {
        case "SG_BREAK_EVEN_ACTIVATED":
          message = `SMART_GUARD Break-Even activado en ${pair}`;
          telegramMsg = `${prefix}⚖️ *Break-Even Activado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Entrada: $${entryPrice.toFixed(2)}\n` +
            `Precio actual: $${currentPrice.toFixed(2)}\n` +
            `Profit: +${profitPct.toFixed(2)}%\n` +
            `Stop movido a: $${stopPrice.toFixed(2)}`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_TRAILING_ACTIVATED":
          message = `SMART_GUARD Trailing Stop activado en ${pair}`;
          telegramMsg = `${prefix}🎯 *Trailing Stop Activado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Entrada: $${entryPrice.toFixed(2)}\n` +
            `Precio actual: $${currentPrice.toFixed(2)}\n` +
            `Profit: +${profitPct.toFixed(2)}%\n` +
            `Stop dinámico: $${stopPrice.toFixed(2)}`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_TRAILING_STOP_UPDATED":
          const oldStop = stopPrice * 0.99;
          message = `SMART_GUARD Trailing Stop actualizado en ${pair}`;
          telegramMsg = `${prefix}📈 *Trailing Stop Actualizado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Stop: $${oldStop.toFixed(2)} → $${stopPrice.toFixed(2)}\n` +
            `Profit actual: +${profitPct.toFixed(2)}%`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice, oldStop });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_SCALE_OUT_EXECUTED":
          const scaleOutQty = parsed.data.scaleOutQty || 0.001;
          const scaleOutUsd = parsed.data.scaleOutUsd || scaleOutQty * currentPrice;
          message = `SMART_GUARD Scale-Out ejecutado en ${pair}`;
          telegramMsg = `${prefix}📊 *Scale-Out Ejecutado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Vendido: ${scaleOutQty} ($${scaleOutUsd.toFixed(2)})\n` +
            `Profit: +${profitPct.toFixed(2)}%`;
          await botLogger.info(event, message, { ...baseMeta, scaleOutQty, scaleOutUsd });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
      }
      
      res.json({
        success: true,
        event,
        message,
        meta: baseMeta,
        telegramSent: true,
      });
      
    } catch (error: any) {
      console.error("[api/test/sg-event] Error:", error.message);
      res.status(500).json({ error: "TEST_SG_EVENT_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Probar multi-lot (crear posiciones de prueba)
  // ============================================================
  app.post("/api/test/create-position", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const schema = z.object({
        pair: z.string().default("BTC/USD"),
        amount: z.number().positive().default(0.001),
        entryPrice: z.number().positive().default(100000),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { pair, amount, entryPrice } = parsed.data;
      const lotId = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      
      const tradingEngine = deps.getTradingEngine();
      // Add to trading engine's open positions
      if (tradingEngine) {
        const position = {
          pair,
          amount,
          entryPrice,
          timestamp: new Date().toISOString(),
          lotId,
          strategy: "test",
          entryMode: "TEST",
          signalConfidence: 0.8,
          // SMART_GUARD flags
          sgBreakEvenActivated: false,
          sgTrailingActivated: false,
          sgCurrentStopPrice: null,
          sgScaleOutDone: false,
          configSnapshotJson: botConfig ? JSON.stringify({
            sgMinEntryUsd: botConfig.sgMinEntryUsd,
            sgBeAtPct: botConfig.sgBeAtPct,
            sgTrailStartPct: botConfig.sgTrailStartPct,
            sgTrailDistancePct: botConfig.sgTrailDistancePct,
          }) : null,
        };
        
        tradingEngine.getOpenPositions().set(lotId, position);

        let parsedSnapshot: any = null;
        try {
          parsedSnapshot = position.configSnapshotJson ? JSON.parse(position.configSnapshotJson) : null;
        } catch {
          parsedSnapshot = null;
        }

        const exchangeType = ExchangeFactory.getTradingExchangeType();
        const saved = await storage.saveOpenPositionByLotId({
          lotId,
          exchange: exchangeType,
          pair,
          entryPrice: entryPrice.toString(),
          amount: amount.toString(),
          highestPrice: entryPrice.toString(),
          entryFee: "0",
          entryStrategyId: "test",
          entrySignalTf: "test",
          signalConfidence: "0.8",
          entryMode: "TEST",
          configSnapshotJson: parsedSnapshot,
        } as any);

        const dbPosition = await storage.getOpenPositionByLotId(lotId);
        
        // Count lots for this pair
        const allPositions = tradingEngine.getOpenPositions();
        let pairLots = 0;
        Array.from(allPositions.values()).forEach((pos: any) => {
          if (pos.pair === pair) pairLots++;
        });
        
        await botLogger.info("TEST_POSITION_CREATED", `Posición de prueba creada: ${pair} x${amount}`, {
          pair, lotId, amount, entryPrice, pairLots, env: envInfo.env,
        });
        
        res.json({
          success: true,
          lotId,
          position,
          dbSaved: !!dbPosition,
          dbPosition: dbPosition || null,
          saved,
          pairLotsCount: pairLots,
        });
      } else {
        res.status(500).json({ error: "ENGINE_NOT_READY" });
      }
      
    } catch (error: any) {
      res.status(500).json({ error: "CREATE_POSITION_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Eliminar posición de prueba
  // ============================================================
  app.delete("/api/test/position/:lotId", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const { lotId } = req.params;
      
      const tradingEngine = deps.getTradingEngine();
      if (tradingEngine) {
        const deleted = tradingEngine.getOpenPositions().delete(lotId);
        let dbDeleted = false;
        try {
          await storage.deleteOpenPositionByLotId(lotId);
          dbDeleted = true;
        } catch {
          dbDeleted = false;
        }
        res.json({ success: true, deleted, dbDeleted, lotId });
      } else {
        res.status(500).json({ error: "ENGINE_NOT_READY" });
      }
      
    } catch (error: any) {
      res.status(500).json({ error: "DELETE_POSITION_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Simular sizing SMART_GUARD v2
  // Para validar la lógica: 469→200, 250→200, 150→150, 25→25, 19→block
  // ============================================================
  app.post("/api/test/sg-sizing", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const schema = z.object({
        availableUsd: z.number().min(0),
        sgMinEntryUsd: z.number().positive().default(200),
        minOrderExchangeUsd: z.number().positive().default(10), // mínimo del exchange en USD
        feeCushionPct: z.number().min(0).default(0),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { availableUsd, sgMinEntryUsd, minOrderExchangeUsd, feeCushionPct } = parsed.data;
      
      // Constantes
      const SG_ABSOLUTE_MIN_USD = 20;
      
      // SMART_GUARD v2: sin buffer de slippage para sizing exacto
      const usdDisponible = availableUsd;
      
      // floorUsd = max(minOrderExchangeUsd, MIN_ORDER_ABSOLUTE_USD)
      const floorUsd = Math.max(SG_ABSOLUTE_MIN_USD, minOrderExchangeUsd);
      
      // Fee cushion
      const cushionAmount = availableUsd * (feeCushionPct / 100);
      const availableAfterCushion = usdDisponible - cushionAmount;
      
      // === SMART_GUARD v2 SIZING LOGIC ===
      let orderUsd: number;
      let reasonCode: string;
      let blocked = false;
      
      if (availableAfterCushion >= sgMinEntryUsd) {
        // Caso A: Saldo suficiente → usar sgMinEntryUsd EXACTO
        orderUsd = sgMinEntryUsd;
        reasonCode = "SMART_GUARD_ENTRY_USING_CONFIG_MIN";
        
      } else if (availableAfterCushion >= floorUsd) {
        // Caso B: Fallback automático → usar saldo disponible
        orderUsd = availableAfterCushion;
        reasonCode = "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE";
        
      } else if (usdDisponible >= floorUsd && availableAfterCushion < floorUsd) {
        // Caso C: Fee cushion lo baja de floorUsd → BLOCKED
        orderUsd = availableAfterCushion;
        reasonCode = "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION";
        blocked = true;
        
      } else {
        // Caso D: Saldo < floorUsd → BLOCKED
        orderUsd = usdDisponible;
        reasonCode = "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN";
        blocked = true;
      }
      
      res.json({
        success: true,
        blocked,
        reasonCode,
        orderUsd: parseFloat(orderUsd.toFixed(2)),
        details: {
          input: {
            availableUsd,
            sgMinEntryUsd,
            minOrderExchangeUsd,
            feeCushionPct,
          },
          calculated: {
            usdDisponible: parseFloat(usdDisponible.toFixed(2)),
            floorUsd,
            cushionAmount: parseFloat(cushionAmount.toFixed(2)),
            availableAfterCushion: parseFloat(availableAfterCushion.toFixed(2)),
          },
          thresholds: {
            SG_ABSOLUTE_MIN_USD,
            minOrderExchangeUsd,
            floorUsd,
          },
        },
      });
      
    } catch (error: any) {
      res.status(500).json({ error: "SG_SIZING_TEST_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Probar filtro B3 (min señales SMART_GUARD)
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/b3", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (!envInfo.isReplit && !dryRun) {
        return res.status(403).json({ 
          error: "TEST_NOT_ALLOWED", 
          message: "Test endpoint solo disponible en Replit o con dryRunMode=true" 
        });
      }
      
      const { buySignals, sellSignals, regime, reasonFormat } = req.body;
      
      // Validar inputs
      const bSignals = parseInt(buySignals?.toString() || "4", 10);
      const sSignals = parseInt(sellSignals?.toString() || "1", 10);
      const testRegime = regime || "BASE"; // BASE, TREND, RANGE, TRANSITION
      
      // Determinar requiredSignals según régimen
      let requiredSignals = 5; // Base SMART_GUARD
      if (testRegime === "RANGE") requiredSignals = 6;
      else if (testRegime === "TREND") requiredSignals = 5;
      else if (testRegime === "TRANSITION") requiredSignals = 5; // pero pauseEntries = true
      
      // Simular formato de reason
      let testReason: string;
      if (reasonFormat === "old") {
        // Formato antiguo (no matchea regex)
        testReason = `Momentum alcista: RSI bajo | Señales: ${bSignals} compra vs ${sSignals} venta`;
      } else if (reasonFormat === "broken") {
        // Formato roto (deliberadamente no parseable)
        testReason = `Señal sin formato estándar`;
      } else {
        // Formato unificado (matchea regex)
        testReason = `Momentum Velas COMPRA: RSI bajo | Señales: ${bSignals}/${sSignals}`;
      }
      
      // Probar regex
      const regex = /Señales:\s*(\d+)\/(\d+)/;
      const match = testReason.match(regex);
      
      let decision: string;
      let reasonCode: string;
      let parsedBuySignals: number | null = null;
      
      if (match) {
        parsedBuySignals = parseInt(match[1], 10);
        if (testRegime === "TRANSITION") {
          decision = "BLOCKED";
          reasonCode = "REGIME_TRANSITION_PAUSE";
        } else if (parsedBuySignals < requiredSignals) {
          decision = "BLOCKED";
          reasonCode = "SMART_GUARD_INSUFFICIENT_SIGNALS";
        } else {
          decision = "ALLOWED";
          reasonCode = "B3_PASSED";
        }
      } else {
        // Fallback fail-closed en SMART_GUARD
        decision = "BLOCKED";
        reasonCode = "B3_REGEX_NO_MATCH";
        parsedBuySignals = null;
      }
      
      res.json({
        success: true,
        test: "B3_MIN_SIGNALS",
        input: {
          buySignals: bSignals,
          sellSignals: sSignals,
          regime: testRegime,
          reasonFormat: reasonFormat || "unified",
        },
        simulation: {
          testReason,
          regexUsed: regex.toString(),
          regexMatched: !!match,
          parsedBuySignals,
          requiredSignals,
          decision,
          reasonCode,
        },
        explanation: decision === "BLOCKED" 
          ? `BUY bloqueado: ${reasonCode} (got=${parsedBuySignals ?? 'N/A'}, required=${requiredSignals}, regime=${testRegime})`
          : `BUY permitido: señales suficientes (${parsedBuySignals} >= ${requiredSignals})`,
      });
      
    } catch (error: any) {
      res.status(500).json({ error: "B3_TEST_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Enviar alerta crítica para testing
  // Solo para verificar que el sistema de alertas funciona
  // ============================================================
  app.post("/api/test/critical-alert", async (req, res) => {
    try {
      const { type = "TEST_ERROR", message = "Alerta crítica de prueba", pair = "BTC/USD" } = req.body;
      
      const alert = ErrorAlertService.createFromError(
        new Error(message),
        type as any,
        'CRITICAL',
        'test-endpoint',
        'server/routes.ts',
        pair,
        { 
          endpoint: '/api/test/critical-alert',
          testMode: true,
          userAgent: req.headers['user-agent'],
          timestamp: new Date().toISOString()
        }
      );
      
      await errorAlertService.sendCriticalError(alert);
      
      res.json({ 
        success: true, 
        message: "Alerta crítica enviada",
        type,
        pair
      });
      
    } catch (error: any) {
      console.error("[api/test/critical-alert] Error:", error.message);
      res.status(500).json({ 
        error: "TEST_CRITICAL_ALERT_ERROR", 
        message: error.message 
      });
    }
  });

  // DEBUG: Forzar alertas de Time-Stop expiradas
  app.post("/api/debug/time-stop-alerts", async (req, res) => {
    try {
      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(400).json({ error: "Trading engine not initialized" });
      }
      
      console.log('[DEBUG] Forzando Time-Stop alerts check...');
      
      // Forzar la verificación de posiciones expiradas
      await (tradingEngine as any).checkExpiredTimeStopPositions();
      
      res.json({ 
        success: true, 
        message: "Time-Stop alerts check completed",
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[DEBUG] Error forcing Time-Stop alerts:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DEBUG: Forzar alertas de Time-Stop (incluso si ya fueron notificadas)
  app.post("/api/debug/time-stop-alerts-force", async (req, res) => {
    try {
      const tradingEngine = deps.getTradingEngine();
      if (!tradingEngine) {
        return res.status(400).json({ error: "Trading engine not initialized" });
      }
      
      console.log('[DEBUG] Forzando Time-Stop alerts (IGNORando notificaciones previas)...');
      
      // Forzar alertas ignorando si ya fueron notificadas - returns stats
      const stats = await (tradingEngine as any).forceTimeStopAlerts();
      
      res.json({ 
        success: true, 
        message: "Time-Stop alerts force completed",
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[DEBUG] Error forcing Time-Stop alerts:', error);
      res.status(500).json({ error: error.message });
    }
  });
};
