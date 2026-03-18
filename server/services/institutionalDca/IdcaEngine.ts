/**
 * IdcaEngine — Main engine for the Institutional DCA module.
 * Independent scheduler, entry/safety/TP/trailing/breakeven/emergency engines.
 * Completely isolated from the main bot's TradingEngine.
 */
import * as repo from "./IdcaRepository";
import * as smart from "./IdcaSmartLayer";
import * as telegram from "./IdcaTelegramNotifier";
import { formatIdcaMessage, formatOrderReason, type FormatContext } from "./IdcaMessageFormatter";
import {
  INSTITUTIONAL_DCA_ALLOWED_PAIRS,
  type InstitutionalDcaCycle,
  type InstitutionalDcaConfigRow,
  type InstitutionalDcaAssetConfigRow,
} from "@shared/schema";
import type {
  IdcaMode,
  IdcaEntryCheckResult,
  IdcaBlockReason,
  SafetyOrderLevel,
  IdcaSizeProfile,
} from "./IdcaTypes";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";

const TAG = "[IDCA]";

// ─── Engine State ──────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastTickAt: Date | null = null;
let lastError: string | null = null;
let tickCount = 0;

// Cache for market data
const priceCache = new Map<string, number>();
const ohlcCache = new Map<string, smart.OhlcCandle[]>();

// ─── Human Event Helper ───────────────────────────────────────────

async function createHumanEvent(
  base: { cycleId?: number; pair?: string; mode?: string; eventType: string; severity: string; message: string; payloadJson?: any },
  fmtCtx: FormatContext
) {
  const hm = formatIdcaMessage(fmtCtx);
  return repo.createEvent({
    ...base,
    reasonCode: fmtCtx.reasonCode || fmtCtx.eventType,
    humanTitle: hm.humanTitle,
    humanMessage: hm.humanMessage,
    technicalSummary: hm.technicalSummary,
  });
}

// ─── Public API ────────────────────────────────────────────────────

export function getHealthStatus() {
  return {
    isRunning,
    lastTickAt,
    lastError,
    tickCount,
    schedulerActive: schedulerInterval !== null,
  };
}

export async function startScheduler(): Promise<void> {
  if (schedulerInterval) return;
  const config = await repo.getIdcaConfig();
  const intervalMs = (config.schedulerIntervalSeconds || 60) * 1000;

  console.log(`${TAG} Scheduler starting (interval: ${intervalMs / 1000}s)`);
  isRunning = true;

  // Initial tick
  setTimeout(() => runTick().catch(e => console.error(`${TAG}[ERROR]`, e.message)), 2000);

  schedulerInterval = setInterval(() => {
    runTick().catch(e => console.error(`${TAG}[ERROR]`, e.message));
  }, intervalMs);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isRunning = false;
  console.log(`${TAG} Scheduler stopped`);
}

export async function emergencyCloseAll(): Promise<number> {
  const config = await repo.getIdcaConfig();
  const mode = config.mode as IdcaMode;
  if (mode === "disabled") return 0;

  console.log(`${TAG}[EMERGENCY_CLOSE] Closing all positions for mode=${mode}`);

  // Get current prices
  const prices: Record<string, number> = {};
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    prices[pair] = await getCurrentPrice(pair);
  }

  const closed = await repo.closeCyclesBulk(mode, "emergency_close_all", prices);

  // If live mode, attempt market sells
  if (mode === "live") {
    const activeCycles = await repo.getAllActiveCycles("live");
    for (const cycle of activeCycles) {
      if (parseFloat(String(cycle.totalQuantity)) > 0) {
        try {
          await executeRealSell(cycle, "emergency_sell", parseFloat(String(cycle.totalQuantity)));
        } catch (e: any) {
          console.error(`${TAG}[EMERGENCY_CLOSE] Error selling ${cycle.pair}:`, e.message);
        }
      }
    }
  }

  await createHumanEvent({
    eventType: "emergency_close_all",
    severity: "critical",
    mode,
    message: `Emergency close: ${closed} cycles closed`,
    payloadJson: { closedCount: closed },
  }, { eventType: "emergency_close_all", mode, closedCount: closed, triggerSource: "manual" });

  await telegram.alertEmergencyClose(mode, closed);
  return closed;
}

// ─── Main Tick ─────────────────────────────────────────────────────

async function runTick(): Promise<void> {
  try {
    tickCount++;
    lastTickAt = new Date();

    // Load controls
    const controls = await repo.getTradingEngineControls();

    // Global pause check
    if (controls.globalTradingPause) {
      console.log(`${TAG}[GLOBAL][TRADING_PAUSED]`);
      return;
    }

    // IDCA toggle check
    if (!controls.institutionalDcaEnabled) {
      console.log(`${TAG}[PAUSED_BY_TOGGLE]`);
      return;
    }

    // Load config
    const config = await repo.getIdcaConfig();
    const mode = config.mode as IdcaMode;

    if (mode === "disabled") return;

    // Check max drawdown
    const drawdownOk = await checkModuleDrawdown(config, mode);
    if (!drawdownOk) return;

    // Update OHLCV cache
    await updateOhlcvCache();

    // Evaluate each allowed pair
    for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
      try {
        await evaluatePair(pair, config, mode);
      } catch (e: any) {
        console.error(`${TAG}[ERROR] ${pair}:`, e.message);
        lastError = `${pair}: ${e.message}`;
      }
    }
  } catch (e: any) {
    lastError = e.message;
    console.error(`${TAG}[ERROR] Tick failed:`, e.message);
  }
}

// ─── Pair Evaluation ───────────────────────────────────────────────

async function evaluatePair(
  pair: string,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const assetConfig = await repo.getAssetConfig(pair);
  if (!assetConfig || !assetConfig.enabled) return;

  const currentPrice = await getCurrentPrice(pair);
  if (currentPrice <= 0) return;

  // Check for existing active cycle
  const activeCycle = await repo.getActiveCycle(pair, mode);

  if (activeCycle) {
    // Manage existing cycle
    await manageCycle(activeCycle, currentPrice, config, assetConfig, mode);
  } else {
    // Look for new entry
    await checkEntry(pair, currentPrice, config, assetConfig, mode);
  }
}

// ─── Entry Check ───────────────────────────────────────────────────

async function checkEntry(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const check = await performEntryCheck(pair, currentPrice, config, assetConfig, mode);

  if (!check.allowed) {
    for (const reason of check.blockReasons) {
      console.log(`${TAG}[ENTRY_BLOCKED] ${pair}: ${reason.code} - ${reason.message}`);
    }
    if (check.blockReasons.length > 0) {
      await createHumanEvent({
        pair,
        mode,
        eventType: "entry_check_blocked",
        severity: "info",
        message: check.blockReasons.map(r => r.code).join(", "),
        payloadJson: { blockReasons: check.blockReasons },
      }, {
        eventType: "entry_check_blocked",
        reasonCode: check.blockReasons[0]?.code || "entry_check_blocked",
        pair, mode,
        blockReasons: check.blockReasons,
        dipPct: check.dipPct,
        marketScore: check.marketScore,
        sizeProfile: check.sizeProfile,
      });
    }
    return;
  }

  // Entry allowed — create cycle and execute base buy
  console.log(`${TAG}[ENTRY_CHECK] ${pair}: Entry allowed, score=${check.marketScore}, dip=${check.dipPct?.toFixed(2)}%`);

  await createHumanEvent({
    pair, mode,
    eventType: "entry_check_passed",
    severity: "info",
    message: `Entry check passed: score=${check.marketScore}, dip=${check.dipPct?.toFixed(2)}%`,
    payloadJson: { marketScore: check.marketScore, dipPct: check.dipPct, sizeProfile: check.sizeProfile },
  }, { eventType: "entry_check_passed", pair, mode, dipPct: check.dipPct, marketScore: check.marketScore, sizeProfile: check.sizeProfile });

  // Calculate capital for this cycle
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct));
  const capitalForCycle = allocatedCapital * (maxAssetPct / 100);

  // Create cycle
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
  const sizeWeights = check.sizeProfile
    ? smart.getSizeWeights(check.sizeProfile, safetyOrders.length + 1)
    : smart.getSizeWeights("balanced", safetyOrders.length + 1);

  const baseBuyPct = sizeWeights[0];
  const baseBuyUsd = capitalForCycle * (baseBuyPct / 100);
  const quantity = baseBuyUsd / currentPrice;

  // Compute TP
  const tpPct = config.adaptiveTpEnabled
    ? smart.computeAdaptiveTp({
        pair,
        buyCount: 1,
        volatilityPct: getVolatility(pair),
        minTpPct: parseFloat(String(pair === "BTC/USD" ? config.minTpPctBtc : config.minTpPctEth)),
        maxTpPct: parseFloat(String(pair === "BTC/USD" ? config.maxTpPctBtc : config.maxTpPctEth)),
      })
    : parseFloat(String(assetConfig.takeProfitPct));

  const tpPrice = currentPrice * (1 + tpPct / 100);

  // Compute trailing
  let trailingPct = parseFloat(String(assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  // Next safety buy level
  const nextLevel = safetyOrders.length > 0 ? safetyOrders[0].dipPct : null;
  const nextBuyPrice = nextLevel ? currentPrice * (1 - nextLevel / 100) : null;

  // Apply simulation fees
  let fees = 0;
  let slippage = 0;
  let netValue = baseBuyUsd;
  if (mode === "simulation") {
    fees = baseBuyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = baseBuyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = baseBuyUsd + fees + slippage;
  }

  const cycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1",
    mode,
    status: "active",
    capitalReservedUsd: capitalForCycle.toFixed(2),
    capitalUsedUsd: netValue.toFixed(2),
    totalQuantity: quantity.toFixed(8),
    avgEntryPrice: currentPrice.toFixed(8),
    currentPrice: currentPrice.toFixed(8),
    buyCount: 1,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    trailingPct: trailingPct.toFixed(2),
    nextBuyLevelPct: nextLevel?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    marketScore: (check.marketScore || 0).toFixed(2),
    volatilityScore: (check.volatilityScore || 0).toFixed(2),
    adaptiveSizeProfile: check.sizeProfile || "balanced",
    lastBuyAt: new Date(),
  });

  // Create order record
  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: baseBuyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Entry dip ${check.dipPct?.toFixed(2)}%, score=${check.marketScore}`,
    humanReason: formatOrderReason("base_buy"),
  });

  // Execute real order if live
  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  // Update simulation wallet
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
      totalCyclesSimulated: wallet.totalCyclesSimulated + 1,
    });
  }

  const baseFmtCtx: FormatContext = {
    eventType: "cycle_started", pair, mode,
    price: currentPrice, quantity, capitalUsed: netValue,
    dipPct: check.dipPct, marketScore: check.marketScore,
    buyCount: 1, sizeProfile: check.sizeProfile,
  };

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "cycle_started",
    severity: "info",
    message: `Cycle started: baseBuy=${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
    payloadJson: { price: currentPrice, quantity, capital: netValue, sizeProfile: check.sizeProfile },
  }, baseFmtCtx);

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "base_buy_executed",
    severity: "info",
    message: `Base buy #1: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, { ...baseFmtCtx, eventType: "base_buy_executed" });

  await telegram.alertCycleStarted(cycle, check.dipPct || 0, check.marketScore || 0);
  await telegram.alertBuyExecuted(cycle, order, "base_buy");
}

// ─── Cycle Management ──────────────────────────────────────────────

async function manageCycle(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  if (avgEntry <= 0 || totalQty <= 0) return;

  // Update current price and PnL
  const marketValue = totalQty * currentPrice;
  const unrealizedPnlUsd = marketValue - capitalUsed;
  const unrealizedPnlPct = capitalUsed > 0 ? (unrealizedPnlUsd / capitalUsed) * 100 : 0;

  // Track max drawdown
  const currentDD = unrealizedPnlPct < 0 ? Math.abs(unrealizedPnlPct) : 0;
  const prevMaxDD = parseFloat(String(cycle.maxDrawdownPct || "0"));
  const maxDD = Math.max(currentDD, prevMaxDD);

  await repo.updateCycle(cycle.id, {
    currentPrice: currentPrice.toFixed(8),
    unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
    unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
    maxDrawdownPct: maxDD.toFixed(2),
  });

  // Branch by cycle status
  switch (cycle.status) {
    case "active":
      await handleActiveState(cycle, currentPrice, unrealizedPnlPct, config, assetConfig, mode);
      break;
    case "tp_armed":
      await handleTpArmedState(cycle, currentPrice, config, assetConfig, mode);
      break;
    case "trailing_active":
      await handleTrailingState(cycle, currentPrice, config, assetConfig, mode);
      break;
    case "paused":
    case "blocked":
      // Just update price, don't act
      break;
  }
}

// ─── TP Armed State: transition to trailing ────────────────────────

async function handleTpArmedState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  // TP Armed is a brief transitional state before trailing activates.
  // If partial sell already happened, move to trailing_active.
  if (cycle.tpArmedAt) {
    await repo.updateCycle(cycle.id, { status: "trailing_active", trailingActiveAt: new Date() });
    await handleTrailingState(cycle, currentPrice, config, assetConfig, mode);
  }
}

// ─── Active State: Check safety buys + TP trigger ──────────────────

async function handleActiveState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  pnlPct: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;

  // Check if TP reached
  const tpPct = parseFloat(String(cycle.tpTargetPct || assetConfig.takeProfitPct));
  if (pnlPct >= tpPct) {
    await armTakeProfit(cycle, currentPrice, config, assetConfig, mode);
    return;
  }

  // Check breakeven protection
  if (assetConfig.breakevenEnabled && pnlPct > 0.5) {
    // Check if losing structure — simplified: if price drops from recent high
    const recentHigh = priceCache.get(`${pair}_recent_high`) || currentPrice;
    const dropFromHigh = ((recentHigh - currentPrice) / recentHigh) * 100;
    if (dropFromHigh > 1.5 && pnlPct < 1.0) {
      await executeBreakevenExit(cycle, currentPrice, config, mode);
      return;
    }
  }

  // Check safety buy levels
  await checkSafetyBuy(cycle, currentPrice, config, assetConfig, mode);

  // Update recent high
  const currentHigh = priceCache.get(`${pair}_recent_high`) || 0;
  if (currentPrice > currentHigh) {
    priceCache.set(`${pair}_recent_high`, currentPrice);
  }
}

// ─── Safety Buy Check ──────────────────────────────────────────────

async function checkSafetyBuy(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const buyCount = cycle.buyCount;
  const maxOrders = assetConfig.maxSafetyOrders;
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);

  // Already at max buys
  if (buyCount >= safetyOrders.length + 1) return;

  // Cooldown check
  if (cycle.lastBuyAt) {
    const cooldownMs = assetConfig.cooldownMinutesBetweenBuys * 60 * 1000;
    if (Date.now() - new Date(cycle.lastBuyAt).getTime() < cooldownMs) {
      return; // Cooldown active
    }
  }

  // Check next buy level
  const nextBuyPrice = parseFloat(String(cycle.nextBuyPrice || "0"));
  if (nextBuyPrice <= 0 || currentPrice > nextBuyPrice) return;

  // Price has reached the next safety buy level
  // Check rebound if required
  if (assetConfig.requireReboundConfirmation) {
    const candles = ohlcCache.get(pair) || [];
    const recentCandles = candles.slice(-5).map(c => ({
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const localLow = Math.min(...recentCandles.map(c => c.low), currentPrice);
    if (!smart.detectRebound({ recentCandles, currentPrice, localLow })) {
      return; // No rebound confirmed yet
    }
  }

  // Exposure checks
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const totalCapitalUsed = parseFloat(String(cycle.capitalUsedUsd));
  const maxModulePct = parseFloat(String(config.maxModuleExposurePct));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct));
  const capitalReserved = parseFloat(String(cycle.capitalReservedUsd));

  if (totalCapitalUsed / allocatedCapital * 100 >= maxModulePct) {
    await logBlock(pair, mode, "module_exposure_max_reached", cycle);
    return;
  }
  if (totalCapitalUsed / capitalReserved * 100 >= maxAssetPct) {
    await logBlock(pair, mode, "asset_exposure_max_reached", cycle);
    return;
  }

  // Execute safety buy
  const safetyIndex = buyCount; // 0-indexed in safetyOrders, but buyCount starts at 1 (base buy)
  const safetyOrder = safetyOrders[safetyIndex - 1];
  if (!safetyOrder) return;

  const sizeProfile = (cycle.adaptiveSizeProfile as IdcaSizeProfile) || "balanced";
  const weights = smart.getSizeWeights(sizeProfile, safetyOrders.length + 1);
  const buyPct = weights[buyCount] || 25;
  const buyUsd = capitalReserved * (buyPct / 100);
  const quantity = buyUsd / currentPrice;

  // Simulation fees
  let fees = 0, slippage = 0, netValue = buyUsd;
  if (mode === "simulation") {
    fees = buyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = buyUsd + fees + slippage;
  }

  // Recalculate average
  const prevQty = parseFloat(String(cycle.totalQuantity));
  const prevCost = parseFloat(String(cycle.capitalUsedUsd));
  const newTotalQty = prevQty + quantity;
  const newTotalCost = prevCost + netValue;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  // Next level
  const nextSafety = safetyOrders[safetyIndex]; // next after current
  const nextLevelPct = nextSafety ? nextSafety.dipPct : null;
  const avgForNextBuy = newAvgPrice; // Reference from new avg
  const nextBuyPriceCalc = nextLevelPct ? newAvgPrice * (1 - nextLevelPct / 100) : null;

  // Adaptive TP
  let tpPct = parseFloat(String(assetConfig.takeProfitPct));
  if (config.adaptiveTpEnabled) {
    tpPct = smart.computeAdaptiveTp({
      pair,
      buyCount: newBuyCount,
      volatilityPct: getVolatility(pair),
      minTpPct: parseFloat(String(pair === "BTC/USD" ? config.minTpPctBtc : config.minTpPctEth)),
      maxTpPct: parseFloat(String(pair === "BTC/USD" ? config.maxTpPctBtc : config.maxTpPctEth)),
    });
  }
  const tpPrice = newAvgPrice * (1 + tpPct / 100);

  await repo.updateCycle(cycle.id, {
    capitalUsedUsd: newTotalCost.toFixed(2),
    totalQuantity: newTotalQty.toFixed(8),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount: newBuyCount,
    nextBuyLevelPct: nextLevelPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPriceCalc?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    lastBuyAt: new Date(),
  });

  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: buyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Safety buy #${newBuyCount} at -${safetyOrder.dipPct}%`,
    humanReason: formatOrderReason("safety_buy"),
  });

  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "safety_buy_executed",
    severity: "info",
    message: `Safety buy #${newBuyCount}: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "safety_buy_executed", pair, mode,
    price: currentPrice, quantity, avgEntry: newAvgPrice,
    capitalUsed: newTotalCost, buyCount: newBuyCount,
  });

  // Re-fetch cycle for telegram alert
  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertBuyExecuted(updatedCycle, order, "safety_buy");
  }
}

// ─── Take Profit Arm ───────────────────────────────────────────────

async function armTakeProfit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const totalQty = parseFloat(String(cycle.totalQuantity));
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd));

  // Calculate partial sell amount
  const pnlPct = ((currentPrice * totalQty - capitalUsed) / capitalUsed) * 100;
  const partialPct = smart.computeDynamicPartialPct(
    pnlPct,
    parseFloat(String(config.partialTpMinPct)),
    parseFloat(String(config.partialTpMaxPct))
  );
  const partialQty = totalQty * (partialPct / 100);
  const partialValueUsd = partialQty * currentPrice;

  // Execute partial sell
  let fees = 0, slippage = 0, netValue = partialValueUsd;
  if (mode === "simulation") {
    fees = partialValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = partialValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = partialValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "partial_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: partialQty.toFixed(8),
    grossValueUsd: partialValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `TP armed at ${pnlPct.toFixed(2)}%, partial sell ${partialPct.toFixed(0)}%`,
    humanReason: formatOrderReason("partial_sell"),
  });

  if (mode === "live") {
    await executeRealSell(cycle, "partial_sell", partialQty);
  }

  const remainingQty = totalQty - partialQty;

  // Get trailing pct
  let trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  await repo.updateCycle(cycle.id, {
    status: "trailing_active",
    tpArmedAt: new Date(),
    trailingActiveAt: new Date(),
    highestPriceAfterTp: currentPrice.toFixed(8),
    totalQuantity: remainingQty.toFixed(8),
    realizedPnlUsd: netValue.toFixed(2),
    trailingPct: trailingPct.toFixed(2),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) - partialValueUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "tp_armed",
    severity: "info",
    message: `TP armed: sold ${partialPct.toFixed(0)}%, trailing ${trailingPct.toFixed(2)}% on remaining ${remainingQty.toFixed(6)}`,
  }, {
    eventType: "tp_armed", pair, mode,
    pnlPct, tpPct: parseFloat(String(cycle.tpTargetPct || "0")), trailingPct, partialPct,
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    price: currentPrice,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertTpArmed(updatedCycle, partialPct);
  }
}

// ─── Trailing State ────────────────────────────────────────────────

async function handleTrailingState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const highestPrice = parseFloat(String(cycle.highestPriceAfterTp || currentPrice));
  const trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingPct));

  // Update highest price
  if (currentPrice > highestPrice) {
    await repo.updateCycle(cycle.id, {
      highestPriceAfterTp: currentPrice.toFixed(8),
    });
    return; // Price still rising
  }

  // Check trailing stop trigger
  const dropFromHigh = ((highestPrice - currentPrice) / highestPrice) * 100;
  if (dropFromHigh >= trailingPct) {
    // Trailing exit — sell remaining
    await executeTrailingExit(cycle, currentPrice, config, mode);
  }
}

// ─── Trailing Exit ─────────────────────────────────────────────────

async function executeTrailingExit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const remainingQty = parseFloat(String(cycle.totalQuantity));
  const sellValueUsd = remainingQty * currentPrice;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "final_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: remainingQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: "trailing_exit",
    humanReason: formatOrderReason("final_sell"),
  });

  if (mode === "live") {
    await executeRealSell(cycle, "final_sell", remainingQty);
  }

  const prevRealized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const totalRealized = prevRealized + netValue;
  const capitalUsedForPnl = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const pnlPctTrailing = capitalUsedForPnl > 0 ? ((totalRealized - capitalUsedForPnl) / capitalUsedForPnl) * 100 : 0;

  const closedAt = new Date();
  const startedAt = cycle.startedAt ? new Date(cycle.startedAt) : closedAt;
  const durMs = closedAt.getTime() - startedAt.getTime();
  const durH = Math.floor(durMs / 3600000);
  const durM = Math.floor((durMs % 3600000) / 60000);
  const durationStr = durH > 24 ? `${Math.floor(durH / 24)}d ${durH % 24}h` : `${durH}h ${durM}m`;

  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "trailing_exit",
    totalQuantity: "0",
    realizedPnlUsd: totalRealized.toFixed(2),
    closedAt,
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + totalRealized - capitalUsedForPnl).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "trailing_exit",
    severity: "info",
    message: `Trailing exit: sold ${remainingQty.toFixed(6)} @ ${currentPrice.toFixed(2)}, realized=${totalRealized.toFixed(2)}`,
  }, {
    eventType: "trailing_exit", pair, mode,
    price: currentPrice, pnlPct: pnlPctTrailing,
    pnlUsd: totalRealized - capitalUsedForPnl,
    buyCount: cycle.buyCount, durationStr,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertTrailingExit(updatedCycle);
  }
}

// ─── Breakeven Exit ────────────────────────────────────────────────

async function executeBreakevenExit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const totalQty = parseFloat(String(cycle.totalQuantity));
  const sellValueUsd = totalQty * currentPrice;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "breakeven_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: totalQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: "breakeven_protection",
    humanReason: formatOrderReason("breakeven_sell"),
  });

  if (mode === "live") {
    await executeRealSell(cycle, "breakeven_sell", totalQty);
  }

  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "breakeven_exit",
    totalQuantity: "0",
    realizedPnlUsd: netValue.toFixed(2),
    closedAt: new Date(),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "breakeven_exit",
    severity: "warn",
    message: `Breakeven exit: ${totalQty.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, {
    eventType: "breakeven_exit", pair, mode,
    price: currentPrice, quantity: totalQty, buyCount: cycle.buyCount,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertBreakevenExit(updatedCycle);
  }
}

// ─── Entry Check Logic ─────────────────────────────────────────────

async function performEntryCheck(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<IdcaEntryCheckResult> {
  const blocks: IdcaBlockReason[] = [];
  const now = new Date();

  // Check pair allowed
  if (!INSTITUTIONAL_DCA_ALLOWED_PAIRS.includes(pair as any)) {
    blocks.push({ code: "pair_not_allowed", message: `${pair} not allowed`, timestamp: now });
    return { allowed: false, blockReasons: blocks };
  }

  // Check no existing active cycle
  const existing = await repo.getActiveCycle(pair, mode);
  if (existing) {
    return { allowed: false, blockReasons: [{ code: "cycle_already_active", message: "Active cycle exists", timestamp: now }] };
  }

  // Check exposure
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const allCycles = await repo.getAllActiveCycles(mode);
  let totalUsed = 0;
  for (const c of allCycles) {
    totalUsed += parseFloat(String(c.capitalUsedUsd || "0"));
  }
  const modulePct = (totalUsed / allocatedCapital) * 100;
  if (modulePct >= parseFloat(String(config.maxModuleExposurePct))) {
    blocks.push({ code: "module_exposure_max_reached", message: `Module exposure ${modulePct.toFixed(1)}% >= max`, timestamp: now });
  }

  // Check simulation wallet balance
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    const available = parseFloat(String(wallet.availableBalanceUsd));
    if (available < 50) {
      blocks.push({ code: "insufficient_simulation_balance", message: `Simulation balance too low: $${available.toFixed(2)}`, timestamp: now });
    }
  }

  // Calculate dip from local high
  const localHigh = await getLocalHigh(pair, config.localHighLookbackMinutes);
  const dipPct = localHigh > 0 ? ((localHigh - currentPrice) / localHigh) * 100 : 0;
  const minDip = parseFloat(String(assetConfig.minDipPct));

  if (dipPct < minDip) {
    blocks.push({ code: "insufficient_dip", message: `Dip ${dipPct.toFixed(2)}% < min ${minDip}%`, timestamp: now });
  }

  // BTC gate for ETH
  if (pair === "ETH/USD" && config.btcMarketGateForEthEnabled) {
    const btcPrice = await getCurrentPrice("BTC/USD");
    const btcHigh = await getLocalHigh("BTC/USD", config.localHighLookbackMinutes);
    const btcDip = btcHigh > 0 ? ((btcHigh - btcPrice) / btcHigh) * 100 : 0;
    if (btcDip > 10) {
      blocks.push({ code: "btc_breakdown_blocks_eth", message: `BTC dip ${btcDip.toFixed(1)}% > 10%`, pair: "BTC/USD", timestamp: now });
    }
  }

  // Market score
  let marketScore = 60;
  let volatilityScore = 0;
  let sizeProfile: IdcaSizeProfile = "balanced";

  if (config.smartModeEnabled) {
    const candles = ohlcCache.get(pair) || [];
    if (candles.length >= 20) {
      const closes = candles.map(c => c.close);
      const ema20 = smart.computeEMA(closes, 20);
      const ema50 = smart.computeEMA(closes, Math.min(50, closes.length));
      const rsi = smart.computeRSI(closes);
      const atrPct = smart.computeATRPct(candles);
      volatilityScore = atrPct;

      const weights = (config.marketScoreWeightsJson || {}) as smart.MarketScoreInput & Record<string, number>;

      // Get BTC score for ETH
      let btcScore: number | undefined;
      if (pair === "ETH/USD") {
        const btcCandles = ohlcCache.get("BTC/USD") || [];
        if (btcCandles.length >= 20) {
          const btcCloses = btcCandles.map(c => c.close);
          const btcEma20 = smart.computeEMA(btcCloses, 20);
          const btcRsi = smart.computeRSI(btcCloses);
          btcScore = smart.computeMarketScore({
            currentPrice: btcCloses[btcCloses.length - 1],
            ema20: btcEma20[btcEma20.length - 1],
            ema50: btcEma20[Math.max(0, btcEma20.length - 2)],
            prevEma20: btcEma20[Math.max(0, btcEma20.length - 2)],
            prevEma50: btcEma20[Math.max(0, btcEma20.length - 3)],
            rsi: btcRsi,
            currentVolume: 1,
            avgVolume: 1,
            localHigh: Math.max(...btcCloses.slice(-60)),
          }, config.marketScoreWeightsJson as any);
        }
      }

      marketScore = smart.computeMarketScore({
        currentPrice,
        ema20: ema20[ema20.length - 1],
        ema50: ema50[ema50.length - 1],
        prevEma20: ema20[Math.max(0, ema20.length - 2)],
        prevEma50: ema50[Math.max(0, ema50.length - 2)],
        rsi,
        currentVolume: 1, // Simplified — would use actual volume
        avgVolume: 1,
        localHigh,
        btcScore,
      }, config.marketScoreWeightsJson as any);

      if (marketScore < 50) {
        blocks.push({ code: "market_score_too_low", message: `Score ${marketScore} < 50`, timestamp: now });
      }

      sizeProfile = config.adaptivePositionSizingEnabled
        ? smart.selectSizeProfile(marketScore)
        : "balanced";
    }
  }

  // Rebound confirmation
  let reboundConfirmed = true;
  if (assetConfig.requireReboundConfirmation && dipPct >= minDip) {
    const candles = ohlcCache.get(pair) || [];
    const recentCandles = candles.slice(-5);
    const localLow = recentCandles.length > 0
      ? Math.min(...recentCandles.map(c => c.low))
      : currentPrice;
    reboundConfirmed = smart.detectRebound({ recentCandles, currentPrice, localLow });
    if (!reboundConfirmed) {
      blocks.push({ code: "no_rebound_confirmed", message: "Waiting for rebound confirmation", timestamp: now });
    }
  }

  return {
    allowed: blocks.length === 0,
    blockReasons: blocks,
    marketScore,
    volatilityScore,
    sizeProfile,
    dipPct,
    reboundConfirmed,
  };
}

// ─── Module Drawdown Check ─────────────────────────────────────────

async function checkModuleDrawdown(config: InstitutionalDcaConfigRow, mode: IdcaMode): Promise<boolean> {
  const maxDD = parseFloat(String(config.maxModuleDrawdownPct));
  if (maxDD <= 0) return true;

  const activeCycles = await repo.getAllActiveCycles(mode);
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  let totalUsed = 0;
  let totalUnrealized = 0;

  for (const c of activeCycles) {
    totalUsed += parseFloat(String(c.capitalUsedUsd || "0"));
    totalUnrealized += parseFloat(String(c.unrealizedPnlUsd || "0"));
  }

  if (totalUsed <= 0) return true;

  const ddPct = Math.abs(Math.min(0, totalUnrealized) / allocatedCapital * 100);
  if (ddPct >= maxDD) {
    console.log(`${TAG}[MODULE_DRAWDOWN] ${ddPct.toFixed(2)}% >= ${maxDD}% — pausing module`);
    await createHumanEvent({
      mode,
      eventType: "module_max_drawdown_reached",
      severity: "critical",
      message: `Module drawdown ${ddPct.toFixed(2)}% exceeded max ${maxDD}%`,
      payloadJson: { drawdownPct: ddPct, maxPct: maxDD },
    }, { eventType: "module_max_drawdown_reached", mode, drawdownPct: ddPct, maxDrawdownPct: maxDD });
    await telegram.alertModuleDrawdownBreached(mode, ddPct, maxDD);
    return false;
  }

  return true;
}

// ─── Market Data Helpers ───────────────────────────────────────────

async function getCurrentPrice(pair: string): Promise<number> {
  try {
    const dataExchange = ExchangeFactory.getDataExchange();
    if (dataExchange.isInitialized()) {
      const ticker = await dataExchange.getTicker(pair);
      const price = ticker.last;
      priceCache.set(pair, price);
      return price;
    }
  } catch (e: any) {
    // Fallback to cached price
  }
  return priceCache.get(pair) || 0;
}

async function getLocalHigh(pair: string, lookbackMinutes: number): Promise<number> {
  const candles = ohlcCache.get(pair) || [];
  if (candles.length === 0) return 0;

  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  // Use all cached candles as approximation
  let high = 0;
  for (const c of candles) {
    if (c.high > high) high = c.high;
  }
  return high;
}

function getVolatility(pair: string): number {
  const candles = ohlcCache.get(pair) || [];
  if (candles.length < 5) return 2.0; // Default
  return smart.computeATRPct(candles);
}

async function updateOhlcvCache(): Promise<void> {
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    try {
      const dataExchange = ExchangeFactory.getDataExchange();
      if (!dataExchange.isInitialized()) continue;

      // Get 1h candles for analysis (last 100)
      const candles = await (dataExchange as any).getOHLC?.(pair, 60);
      if (candles && Array.isArray(candles) && candles.length > 0) {
        const mapped: smart.OhlcCandle[] = candles.map((c: any) => ({
          high: parseFloat(String(c.high || c[2] || 0)),
          low: parseFloat(String(c.low || c[3] || 0)),
          close: parseFloat(String(c.close || c[4] || 0)),
        }));
        ohlcCache.set(pair, mapped);

        // Store in DB cache
        for (const c of candles.slice(-10)) {
          try {
            await repo.upsertOhlcv({
              pair,
              timeframe: "1h",
              ts: new Date(c.time || c[0] * 1000 || Date.now()),
              open: String(c.open || c[1] || 0),
              high: String(c.high || c[2] || 0),
              low: String(c.low || c[3] || 0),
              close: String(c.close || c[4] || 0),
              volume: String(c.volume || c[5] || 0),
            });
          } catch { /* ignore duplicate */ }
        }
      }
    } catch (e: any) {
      console.error(`${TAG}[OHLCV] Error updating ${pair}:`, e.message);
    }
  }
}

// ─── Order Execution (Live) ────────────────────────────────────────

async function executeRealBuy(pair: string, quantity: number, price: number): Promise<void> {
  try {
    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      console.error(`${TAG}[LIVE] Trading exchange not initialized for buy`);
      return;
    }
    console.log(`${TAG}[LIVE][BUY] ${pair} qty=${quantity.toFixed(8)} @ ~${price.toFixed(2)}`);
    // In a real implementation, this would call tradingExchange.createOrder()
    // For safety, we log but don't execute yet until live mode is thoroughly tested
  } catch (e: any) {
    console.error(`${TAG}[LIVE][BUY] Error:`, e.message);
  }
}

async function executeRealSell(cycle: InstitutionalDcaCycle, orderType: string, quantity: number): Promise<void> {
  try {
    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      console.error(`${TAG}[LIVE] Trading exchange not initialized for sell`);
      return;
    }
    console.log(`${TAG}[LIVE][SELL] ${cycle.pair} type=${orderType} qty=${quantity.toFixed(8)}`);
    // Same safety as buy — log but wait for live validation
  } catch (e: any) {
    console.error(`${TAG}[LIVE][SELL] Error:`, e.message);
  }
}

// ─── Block Logger ──────────────────────────────────────────────────

async function logBlock(pair: string, mode: string, code: string, cycle?: InstitutionalDcaCycle): Promise<void> {
  console.log(`${TAG}[BUY_BLOCKED] ${pair}: ${code}`);
  const pnlPct = cycle ? parseFloat(String(cycle.unrealizedPnlPct || "0")) : 0;
  const buyCount = cycle?.buyCount || 0;
  await createHumanEvent({
    cycleId: cycle?.id,
    pair, mode,
    eventType: "buy_blocked",
    severity: "warn",
    message: code,
    payloadJson: { blockCode: code },
  }, {
    eventType: "buy_blocked", reasonCode: code, pair, mode,
    pnlPct, buyCount,
    blockReasons: [{ code, message: code }],
  });
  await telegram.alertBuyBlocked(pair, mode, code, pnlPct, buyCount);
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseSafetyOrders(json: unknown): SafetyOrderLevel[] {
  if (Array.isArray(json)) {
    return json.map((o: any) => ({
      dipPct: parseFloat(String(o.dipPct || o.dip_pct || 0)),
      sizePctOfAssetBudget: parseFloat(String(o.sizePctOfAssetBudget || o.size_pct || 25)),
    }));
  }
  return [];
}

// ─── Mode Transition ───────────────────────────────────────────────

export async function handleModeTransition(newMode: IdcaMode): Promise<void> {
  const config = await repo.getIdcaConfig();
  const oldMode = config.mode as IdcaMode;

  if (oldMode === newMode) return;

  console.log(`${TAG}[MODE_TRANSITION] ${oldMode} -> ${newMode}`);

  // Get current prices for closing cycles
  const prices: Record<string, number> = {};
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    prices[pair] = await getCurrentPrice(pair);
  }

  // Apply transition rules
  if (oldMode === "simulation" && (newMode === "live" || newMode === "disabled")) {
    // Close all simulation cycles
    const closed = await repo.closeCyclesBulk("simulation", `mode_transition_${oldMode}_to_${newMode}`, prices);
    console.log(`${TAG}[MODE_TRANSITION] Closed ${closed} simulation cycles`);
  }

  if (oldMode === "live" && newMode !== "live") {
    // Pause live cycles (don't close automatically)
    const liveCycles = await repo.getAllActiveCycles("live");
    for (const cycle of liveCycles) {
      await repo.updateCycle(cycle.id, { status: "paused" });
    }
    console.log(`${TAG}[MODE_TRANSITION] Paused ${liveCycles.length} live cycles`);
  }

  // Update config
  await repo.updateIdcaConfig({ mode: newMode });

  await createHumanEvent({
    eventType: "mode_transition",
    severity: "info",
    mode: newMode,
    message: `Mode changed: ${oldMode} -> ${newMode}`,
    payloadJson: { oldMode, newMode },
  }, { eventType: "mode_transition", mode: newMode, oldMode, newMode });

  // Restart scheduler if needed
  if (newMode === "disabled") {
    stopScheduler();
  } else if (!schedulerInterval) {
    await startScheduler();
  }
}
