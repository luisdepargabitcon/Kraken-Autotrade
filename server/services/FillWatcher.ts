/**
 * FillWatcher Service
 * 
 * Monitors order fills in real-time (or near real-time via polling)
 * Updates positions with fill data and calculates average entry price
 * 
 * Flow:
 * 1. placeOrder() -> creates PENDING_FILL position -> starts FillWatcher
 * 2. FillWatcher polls exchange API for fills every 3-5 seconds
 * 3. When fills arrive -> update position aggregates -> emit POSITION_UPDATED
 * 4. Timeout after 120s with no fills -> mark FAILED or CANCELLED
 */

import { storage } from '../storage';
import { botLogger } from './botLogger';
import { positionsWs } from './positionsWebSocket';
import { fifoMatcher } from './fifoMatcher';

async function tryRecalculatePnlForPairExchange(params: { pair: string; exchange: string; sinceMs?: number }): Promise<void> {
  const { pair, exchange, sinceMs = 30 * 24 * 60 * 60 * 1000 } = params;

  if (exchange !== 'kraken' && exchange !== 'revolutx') return;

  const feePctByExchange = (ex: string) => {
    if (ex === 'revolutx') return 0.09;
    return 0.40;
  };

  const since = new Date(Date.now() - sinceMs);
  const allTrades = await storage.getTrades(1000);
  const recentTrades = allTrades
    .filter((t: any) => {
      const ex = ((t?.exchange ?? 'kraken') as string).toLowerCase();
      if (ex !== exchange) return false;
      if (String(t?.pair ?? '') !== pair) return false;
      if (String(t?.status ?? 'filled').toLowerCase() !== 'filled') return false;
      const ts = new Date(t.executedAt ?? t.createdAt);
      return ts.getTime() >= since.getTime();
    })
    .sort((a: any, b: any) => {
      const ta = new Date(a.executedAt ?? a.createdAt).getTime();
      const tb = new Date(b.executedAt ?? b.createdAt).getTime();
      return ta - tb;
    });

  const byTimeAsc = recentTrades;

  const allBuys = byTimeAsc.filter((t: any) => String(t.type).toLowerCase() === 'buy');
  const sells  = byTimeAsc.filter((t: any) => String(t.type).toLowerCase() === 'sell');

  // Separate FIFO queues: bot trades never mix with sync/external trades
  const botBuys = allBuys.filter((t: any) => Boolean(t.executedByBot));
  const extBuys = allBuys.filter((t: any) => !Boolean(t.executedByBot));

  let botBuyIdx = 0;
  let botBuyRem = botBuys[0] ? parseFloat(String(botBuys[0].amount)) : 0;
  let extBuyIdx = 0;
  let extBuyRem = extBuys[0] ? parseFloat(String(extBuys[0].amount)) : 0;

  const consumeFifo = (
    buys: any[], buyIdx: number, buyRem: number, qty: number
  ): [number, number] => {
    let remaining = qty;
    while (remaining > 0.00000001 && buyIdx < buys.length) {
      const match = Math.min(buyRem, remaining);
      remaining -= match;
      buyRem -= match;
      if (buyRem <= 0.00000001) {
        buyIdx++;
        buyRem = buys[buyIdx] ? parseFloat(String(buys[buyIdx].amount)) : 0;
      }
    }
    return [buyIdx, buyRem];
  };

  for (const sell of sells) {
    const isBotSell = Boolean((sell as any).executedByBot);
    const activeBuys = isBotSell ? botBuys : extBuys;
    let activeBuyIdx = isBotSell ? botBuyIdx : extBuyIdx;
    let activeBuyRem = isBotSell ? botBuyRem : extBuyRem;

    const needsPnl = sell.realizedPnlUsd == null || String(sell.realizedPnlUsd).length === 0;
    if (!needsPnl) {
      // Consume the correct FIFO so later sells are priced correctly.
      [activeBuyIdx, activeBuyRem] = consumeFifo(activeBuys, activeBuyIdx, activeBuyRem, parseFloat(String(sell.amount)));
      if (isBotSell) { botBuyIdx = activeBuyIdx; botBuyRem = activeBuyRem; }
      else { extBuyIdx = activeBuyIdx; extBuyRem = activeBuyRem; }
      continue;
    }

    // Strategy 0: lot_matches-based P&L (if present)
    try {
      const extId = (sell as any)?.krakenOrderId ? String((sell as any).krakenOrderId) : null;
      if (extId) {
        const matches = await storage.getLotMatchesBySellFillTxid(extId);
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
            [activeBuyIdx, activeBuyRem] = consumeFifo(activeBuys, activeBuyIdx, activeBuyRem, parseFloat(String(sell.amount)));
            if (isBotSell) { botBuyIdx = activeBuyIdx; botBuyRem = activeBuyRem; }
            else { extBuyIdx = activeBuyIdx; extBuyRem = activeBuyRem; }
            continue;
          }
        }
      }
    } catch {
      // best-effort
    }

    // Strategy 1: engine sells with stored entryPrice — use it directly (no FIFO)
    try {
      const origin = String((sell as any).origin ?? '').toLowerCase();
      const entryPriceRaw = (sell as any).entryPrice;
      const entryPriceNum = entryPriceRaw != null ? parseFloat(String(entryPriceRaw)) : NaN;
      if (origin === 'engine' && isBotSell && Number.isFinite(entryPriceNum) && entryPriceNum > 0) {
        const sellPrice = parseFloat(String(sell.price));
        const qty = parseFloat(String(sell.amount));
        const entryValue = entryPriceNum * qty;
        const exitValue = sellPrice * qty;
        const feePct = feePctByExchange(exchange);
        const pnlNet = (exitValue - entryValue) - (entryValue * feePct / 100) - (exitValue * feePct / 100);
        const pnlPct = entryValue > 0 ? (pnlNet / entryValue) * 100 : 0;
        await storage.updateTradePnl(sell.id, entryPriceNum.toFixed(8), pnlNet.toFixed(8), pnlPct.toFixed(4));
        [activeBuyIdx, activeBuyRem] = consumeFifo(activeBuys, activeBuyIdx, activeBuyRem, qty);
        if (isBotSell) { botBuyIdx = activeBuyIdx; botBuyRem = activeBuyRem; }
        else { extBuyIdx = activeBuyIdx; extBuyRem = activeBuyRem; }
        continue;
      }
    } catch {
      // best-effort
    }

    // Strategy 2: bot-isolated FIFO (for bot sells without stored entryPrice)
    // Uses ONLY bot buys — never mixes with sync'd external trades
    let sellRemaining = parseFloat(String(sell.amount));
    let totalCost = 0;
    let totalAmount = 0;

    while (sellRemaining > 0.00000001 && activeBuyIdx < activeBuys.length) {
      const buy = activeBuys[activeBuyIdx];
      const matchAmount = Math.min(activeBuyRem, sellRemaining);
      totalCost += matchAmount * parseFloat(String(buy.price));
      totalAmount += matchAmount;
      sellRemaining -= matchAmount;
      activeBuyRem -= matchAmount;
      if (activeBuyRem <= 0.00000001) {
        activeBuyIdx++;
        activeBuyRem = activeBuys[activeBuyIdx] ? parseFloat(String(activeBuys[activeBuyIdx].amount)) : 0;
      }
    }

    if (isBotSell) { botBuyIdx = activeBuyIdx; botBuyRem = activeBuyRem; }
    else { extBuyIdx = activeBuyIdx; extBuyRem = activeBuyRem; }

    if (totalAmount > 0.00000001) {
      const avgEntryPrice = totalCost / totalAmount;
      const sellPrice = parseFloat(String(sell.price));
      const revenue = totalAmount * sellPrice;
      const pnlGross = revenue - totalCost;
      const feePct = feePctByExchange(exchange);
      const entryFee = totalCost * (feePct / 100);
      const exitFee = revenue * (feePct / 100);
      const pnlNet = pnlGross - entryFee - exitFee;
      const pnlPct = totalCost > 0 ? (pnlNet / totalCost) * 100 : 0;

      await storage.updateTradePnl(
        sell.id,
        avgEntryPrice.toFixed(8),
        pnlNet.toFixed(8),
        pnlPct.toFixed(4)
      );
    }
  }
}

interface WatcherConfig {
  clientOrderId: string;
  exchangeOrderId?: string;
  exchange: string;
  pair: string;
  expectedAmount: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  // Sell context: entry price and fee for accurate P&L calculation (prevents FIFO contamination)
  sellEntryPrice?: number;
  sellEntryFee?: number;
  onFillReceived?: (fill: Fill, position: any) => void;
  onPositionOpen?: (position: any) => void;
  onTimeout?: (clientOrderId: string) => void;
  onError?: (error: Error) => void;
  /** Called once when a SELL order is fully filled. Use this to send the final SELL Telegram snapshot. */
  onSellCompleted?: (summary: {
    exitPrice: number;
    totalAmount: number;
    totalCostUsd: number;
    pnlUsd: number | null;
    pnlPct: number | null;
    feeUsd: number;
    entryPrice: number | null;
    executedAt: Date;
  }) => void;
}

interface Fill {
  fillId: string;
  orderId: string;
  pair: string;
  side: string;
  price: number;
  amount: number;
  cost: number;
  fee?: number;
  executedAt: Date;
}

// Active watchers registry
const activeWatchers = new Map<string, NodeJS.Timeout>();

// Processed fills cache (to avoid duplicates)
const processedFills = new Set<string>();

/**
 * Start watching for fills on a specific order
 */
export async function startFillWatcher(config: WatcherConfig): Promise<void> {
  const {
    clientOrderId,
    exchangeOrderId,
    exchange,
    pair,
    expectedAmount,
    pollIntervalMs = 3000, // Poll every 3 seconds
    timeoutMs = 120000, // Timeout after 2 minutes
    sellEntryPrice,
    sellEntryFee,
    onFillReceived,
    onPositionOpen,
    onTimeout,
    onError,
    onSellCompleted,
  } = config;

  // Helper: calculate PnL for a sell given fill price and amount
  const calcSellPnl = (fillPrice: number, fillAmount: number): { entryPrice: string; pnlUsd: string; pnlPct: string } | null => {
    if (!sellEntryPrice || sellEntryPrice <= 0) return null;
    const entryValue = sellEntryPrice * fillAmount;
    const exitValue = fillPrice * fillAmount;
    const feePct = exchange === 'revolutx' ? 0.09 : 0.40;
    const entryFeeUsd = sellEntryFee ?? (entryValue * feePct / 100);
    const exitFeeUsd = exitValue * feePct / 100;
    const pnlUsd = (exitValue - entryValue) - entryFeeUsd - exitFeeUsd;
    const pnlPct = entryValue > 0 ? (pnlUsd / entryValue) * 100 : 0;
    return {
      entryPrice: sellEntryPrice.toString(),
      pnlUsd: pnlUsd.toFixed(8),
      pnlPct: pnlPct.toFixed(4),
    };
  };

  // Use a stable, non-optional order-level id for SELL aggregation and lot-matching.
  // Prefer real exchange order id; fallback to clientOrderId if missing.
  const orderLevelId = exchangeOrderId || clientOrderId;

  // MANDATORY LOGGING: Track all IDs for debugging
  console.log(`[FillWatcher] Starting watcher for ${pair} (clientOrderId: ${clientOrderId}, exchangeOrderId: ${exchangeOrderId || 'NOT_PROVIDED'})`);

  // Check if watcher already exists
  if (activeWatchers.has(clientOrderId)) {
    console.log(`[FillWatcher] Watcher already exists for ${clientOrderId}`);
    return;
  }

  const startTime = Date.now();
  let totalFilledAmount = 0;
  let pollCount = 0;
  let pnlReconciled = false;

  // Get exchange service
  const exchangeService = await getExchangeService(exchange);
  if (!exchangeService) {
    console.error(`[FillWatcher] Exchange service not found for: ${exchange}`);
    onError?.(new Error(`Exchange service not found: ${exchange}`));
    return;
  }

  const orderIntent = await storage.getOrderIntentByClientOrderId(clientOrderId).catch(() => undefined);
  const orderIntentSide = typeof orderIntent?.side === 'string' ? orderIntent.side.toLowerCase() : undefined;
  const initialPosition = await storage.getPositionByClientOrderId(clientOrderId).catch(() => undefined);
  const hasPosition = Boolean(initialPosition);

  // Polling function
  const pollForFills = async () => {
    pollCount++;
    const elapsed = Date.now() - startTime;

    // Check timeout
    if (elapsed > timeoutMs) {
      console.log(`[FillWatcher] Timeout reached for ${pair} (${clientOrderId})`);
      stopFillWatcher(clientOrderId);
      
      // CRITICAL FIX: Before marking as FAILED, verify actual order status from exchange
      // The order may have been filled but fills not yet visible in API
      if (totalFilledAmount === 0 && exchangeOrderId) {
        console.log(`[FillWatcher] Timeout with no fills detected - verifying order status from exchange`);
        try {
          // Try to get order status directly from exchange
          if (typeof exchangeService.getOrder === 'function') {
            const order = await exchangeService.getOrder(exchangeOrderId);
            if (order && order.status) {
              const normalizedStatus = typeof order.status === 'string' ? order.status.toUpperCase() : String(order.status || 'UNKNOWN');
              console.log(`[FillWatcher] Order ${exchangeOrderId} status: ${normalizedStatus}, filledSize: ${order.filledSize || 0}`);
              
              // If order was FILLED, process it now (late fill detection)
              if ((normalizedStatus === 'FILLED' || normalizedStatus === 'CLOSED' || normalizedStatus === 'COMPLETED') && 
                  order.filledSize && order.filledSize > 0) {
                console.log(`[FillWatcher] LATE FILL DETECTED: Order was filled but fills not captured. Processing now.`);
                
                // Derive price if not available
                let price = order.averagePrice || 0;
                if (price <= 0 && order.executedValue && order.filledSize > 0) {
                  price = order.executedValue / order.filledSize;
                  console.log(`[FillWatcher] Derived price from executedValue: ${price}`);
                }
                
                if (price > 0) {
                  // Create synthetic fill from order data
                  const syntheticFill: Fill = {
                    fillId: `${exchangeOrderId}-late-fill`,
                    orderId: exchangeOrderId,
                    pair: exchangeService.normalizePairFromExchange?.(order.symbol) || order.symbol || pair,
                    side: order.side?.toLowerCase() || 'buy',
                    price,
                    amount: order.filledSize,
                    cost: price * order.filledSize,
                    fee: 0,
                    executedAt: order.createdAt || new Date(),
                  };
                  
                  // Always persist trade for late fill (even if there is no pending position, e.g. SELL pendingFill)
                  let persistedTradeId: number | undefined;
                  try {
                    const latePnl = syntheticFill.side === 'sell' ? calcSellPnl(syntheticFill.price, syntheticFill.amount) : null;
                    const { trade } = await storage.insertTradeIgnoreDuplicate({
                      tradeId: syntheticFill.fillId,
                      exchange,
                      pair,
                      type: syntheticFill.side === 'sell' ? 'sell' : 'buy',
                      price: syntheticFill.price.toString(),
                      amount: syntheticFill.amount.toString(),
                      executedAt: syntheticFill.executedAt,
                      origin: 'engine',
                      executedByBot: true,
                      status: 'filled',
                      orderIntentId: orderIntent?.id,
                      ...(latePnl ? { entryPrice: latePnl.entryPrice, realizedPnlUsd: latePnl.pnlUsd, realizedPnlPct: latePnl.pnlPct } : {}),
                    } as any);
                    persistedTradeId = trade?.id;
                  } catch {
                    // best-effort
                  }

                  if (orderIntent && persistedTradeId) {
                    try {
                      await storage.matchOrderIntentToTrade(orderIntent.clientOrderId, persistedTradeId);
                      await storage.markTradeAsExecutedByBot(persistedTradeId, orderIntent.id);
                    } catch {
                      // best-effort
                    }
                  }

                  // Process the fill (only if a pending position exists)
                  const updatedPosition = hasPosition
                    ? await storage.updatePositionWithFill(clientOrderId, {
                        fillId: syntheticFill.fillId,
                        price: syntheticFill.price,
                        amount: syntheticFill.amount,
                        executedAt: syntheticFill.executedAt,
                      })
                    : undefined;
                  
                  if (updatedPosition) {
                    await botLogger.info('ORDER_FILLED_LATE',
                      `Late fill detected and processed: ${pair} +${syntheticFill.amount} @ $${syntheticFill.price.toFixed(2)}`,
                      { fillId: syntheticFill.fillId, source: 'timeout_verification' });

                    // Emit WebSocket events
                    positionsWs.emitFillReceived(clientOrderId, syntheticFill, parseFloat(updatedPosition.averageEntryPrice || '0'));
                    positionsWs.emitPositionUpdated(updatedPosition);

                    onFillReceived?.(syntheticFill, updatedPosition);
                    onPositionOpen?.(updatedPosition);

                    console.log(`[FillWatcher] Successfully processed late fill for ${pair}`);
                    return; // Success - don't mark as failed
                  }

                  await botLogger.info('ORDER_FILLED',
                    `Fill received (no position): ${pair} ${syntheticFill.side} ${syntheticFill.amount} @ $${syntheticFill.price.toFixed(2)}`,
                    { fillId: syntheticFill.fillId, clientOrderId });
                  onFillReceived?.(syntheticFill, null);

                  // Late fill was real and trade persisted; treat as success even without a pending position.
                  console.log(`[FillWatcher] Successfully processed late fill for ${pair} (no position)`);

                  if (!pnlReconciled && syntheticFill.side === 'sell') {
                    pnlReconciled = true;
                    try {
                      await tryRecalculatePnlForPairExchange({ pair, exchange });
                    } catch (e: any) {
                      console.warn(`[FillWatcher] P&L reconcile note for ${pair}: ${e?.message ?? String(e)}`);
                    }
                  }
                  return; // Success - don't mark as failed
                }
              }
            }
          }
        } catch (verifyErr: any) {
          console.error(`[FillWatcher] Error verifying order status on timeout: ${verifyErr.message}`);
        }
        
        // Only mark as FAILED if verification confirms no fills
        console.log(`[FillWatcher] No fills received and verification did not find filled order - marking as FAILED`);
        if (orderIntentSide === 'sell') {
          await storage.updateOrderIntentStatus(clientOrderId, 'failed', exchangeOrderId);
        } else {
          await storage.markPositionFailed(clientOrderId, 'Timeout: No fills received after verification');
        }
        await botLogger.warn('FILL_WATCHER_TIMEOUT',
          `FillWatcher timeout: No fills for ${pair}`, { clientOrderId });
      }
      
      onTimeout?.(clientOrderId);
      return;
    }

    try {
      // Get recent fills from exchange
      const fills = await fetchFillsForOrder(exchangeService, exchange, exchangeOrderId, clientOrderId, pair);
      
      // Process new fills
      for (const fill of fills) {
        const fillKey = `${exchange}:${fill.fillId}`;
        
        // Skip already processed fills
        if (processedFills.has(fillKey)) {
          continue;
        }

        // Guard: ignore invalid fills (prevents +0 @ $0 and corrupting aggregates)
        if (!Number.isFinite(fill.price) || fill.price <= 0 || !Number.isFinite(fill.amount) || fill.amount <= 0) {
          console.warn(`[FillWatcher] Ignoring invalid fill for ${pair}: amount=${fill.amount}, price=${fill.price}, fillId=${fill.fillId}`);
          continue;
        }

        console.log(`[FillWatcher] New fill for ${pair}: ${fill.amount} @ ${fill.price}`);
        processedFills.add(fillKey);

        // Update position with fill (only if a pending position exists)
        const updatedPosition = hasPosition
          ? await storage.updatePositionWithFill(clientOrderId, {
              fillId: fill.fillId,
              price: fill.price,
              amount: fill.amount,
              executedAt: fill.executedAt,
            })
          : undefined;

        // Insert trade record:
        // - BUY: keep per-fill trades (used for monitoring)
        // - SELL: DO NOT persist per-fill trade rows (avoids FIFO contamination); we persist a single order-level SELL when fully filled.
        if (fill.side !== 'sell') {
          let persistedTradeId: number | undefined;
          try {
            const { trade } = await storage.insertTradeIgnoreDuplicate({
              tradeId: fill.fillId,
              exchange,
              pair,
              type: 'buy',
              price: fill.price.toString(),
              amount: fill.amount.toString(),
              executedAt: fill.executedAt,
              origin: 'engine',
              executedByBot: true,
              status: 'filled',
              orderIntentId: orderIntent?.id,
            } as any);
            persistedTradeId = trade?.id;
          } catch (err: any) {
            if (!err.message?.includes('duplicate') && !err.message?.includes('unique')) {
              console.error(`[FillWatcher] Error inserting trade:`, err);
            }
          }

          if (orderIntent && persistedTradeId) {
            try {
              await storage.matchOrderIntentToTrade(orderIntent.clientOrderId, persistedTradeId);
              await storage.markTradeAsExecutedByBot(persistedTradeId, orderIntent.id);
            } catch {
              // best-effort
            }
          }
        }

        totalFilledAmount += fill.amount;

        if (updatedPosition) {
          // Log event
          await botLogger.info('ORDER_FILLED',
            `Fill received: ${pair} +${fill.amount} @ $${fill.price.toFixed(2)}`,
            { fillId: fill.fillId, avgPrice: updatedPosition.averageEntryPrice });

          // Emit WebSocket events for real-time UI update
          try {
            positionsWs.emitFillReceived(clientOrderId, fill, parseFloat(updatedPosition.averageEntryPrice || '0'));
            positionsWs.emitPositionUpdated(updatedPosition);
          } catch (wsErr: any) {
            console.warn(`[FillWatcher] Error emitting WS event: ${wsErr.message}`);
          }

          // Callback
          onFillReceived?.(fill, updatedPosition);

          // Check if position is fully filled
          if (totalFilledAmount >= expectedAmount * 0.99) {
            console.log(`[FillWatcher] Position fully filled for ${pair}`);

            if (!pnlReconciled && fill.side === 'sell') {
              pnlReconciled = true;
              // Prefer lot-based accounting: create an aggregated sell fill keyed by exchangeOrderId and run fifoMatcher.
              let orderPnl: ReturnType<typeof calcSellPnl> = null;
              try {
                const avgPrice = totalFilledAmount > 0 ? ((fills.reduce((acc, f) => acc + (f.price * f.amount), 0)) / totalFilledAmount) : fill.price;
                const feeTotal = fills.reduce((acc, f) => acc + (f.fee || 0), 0);

                // Persist ORDER-LEVEL SELL trade (single row) so P&L can be updated via lot_matches.
                orderPnl = calcSellPnl(avgPrice, totalFilledAmount);
                try {
                  const { trade } = await storage.insertTradeIgnoreDuplicate({
                    tradeId: orderLevelId,
                    exchange,
                    pair,
                    type: 'sell',
                    price: avgPrice.toString(),
                    amount: totalFilledAmount.toFixed(8),
                    executedAt: fill.executedAt,
                    origin: 'engine',
                    executedByBot: true,
                    status: 'filled',
                    orderIntentId: orderIntent?.id,
                    krakenOrderId: orderLevelId,
                    ...(orderPnl ? { entryPrice: orderPnl.entryPrice, realizedPnlUsd: orderPnl.pnlUsd, realizedPnlPct: orderPnl.pnlPct } : {}),
                  } as any);
                  if (orderIntent && trade?.id) {
                    try {
                      await storage.matchOrderIntentToTrade(orderIntent.clientOrderId, trade.id);
                      await storage.markTradeAsExecutedByBot(trade.id, orderIntent.id);
                    } catch {
                      // best-effort
                    }
                  }
                } catch {
                  // best-effort
                }

                await storage.upsertTradeFill({
                  txid: orderLevelId,
                  orderId: orderLevelId,
                  exchange,
                  pair,
                  type: 'sell',
                  price: avgPrice.toString(),
                  amount: totalFilledAmount.toFixed(8),
                  cost: (avgPrice * totalFilledAmount).toFixed(8),
                  fee: feeTotal.toFixed(8),
                  executedAt: fill.executedAt,
                  matched: false,
                } as any);
                // Only run fifoMatcher if we DON'T have a direct entryPrice (prevents FIFO contamination)
                if (!orderPnl) {
                  const sellFill = await storage.getTradeFillByTxid(orderLevelId);
                  if (sellFill) {
                    await fifoMatcher.processSellFill(sellFill);
                  }
                }
              } catch (e: any) {
                console.warn(`[FillWatcher] FIFO lot-match failed for sell ${pair}: ${e?.message ?? String(e)}`);
              }

              // Fallback reconcile only when no direct entryPrice available
              if (!orderPnl) {
                try {
                  await tryRecalculatePnlForPairExchange({ pair, exchange });
                } catch (e: any) {
                  console.warn(`[FillWatcher] P&L reconcile note for ${pair}: ${e?.message ?? String(e)}`);
                }
              }
            }
            if (fill.side === 'sell' && onSellCompleted) {
              const avgPx = totalFilledAmount > 0 ? ((fills.reduce((acc, f) => acc + (f.price * f.amount), 0)) / totalFilledAmount) : fill.price;
              const feeTot = fills.reduce((acc, f) => acc + (f.fee || 0), 0);
              const completedPnl = calcSellPnl(avgPx, totalFilledAmount);
              onSellCompleted({
                exitPrice: avgPx,
                totalAmount: totalFilledAmount,
                totalCostUsd: avgPx * totalFilledAmount,
                pnlUsd: completedPnl ? parseFloat(completedPnl.pnlUsd) : null,
                pnlPct: completedPnl ? parseFloat(completedPnl.pnlPct) : null,
                feeUsd: feeTot,
                entryPrice: sellEntryPrice ?? null,
                executedAt: fill.executedAt,
              });
            }
            stopFillWatcher(clientOrderId);
            onPositionOpen?.(updatedPosition);
            return;
          }
        } else {
          await botLogger.info('ORDER_FILLED',
            `Fill received (no position): ${pair} ${fill.side} ${fill.amount} @ $${fill.price.toFixed(2)}`,
            { fillId: fill.fillId, clientOrderId });
          onFillReceived?.(fill, null);

          // For SELL pendingFill we may have no position; still stop watcher once filled.
          if (totalFilledAmount >= expectedAmount * 0.99) {
            console.log(`[FillWatcher] Order fully filled for ${pair} (no position)`);

            if (!pnlReconciled && fill.side === 'sell') {
              pnlReconciled = true;
              try {
                const avgPrice = totalFilledAmount > 0 ? ((fills.reduce((acc, f) => acc + (f.price * f.amount), 0)) / totalFilledAmount) : fill.price;
                const feeTotal = fills.reduce((acc, f) => acc + (f.fee || 0), 0);

                // Persist ORDER-LEVEL SELL trade (single row)
                const noPosPnl = calcSellPnl(avgPrice, totalFilledAmount);
                try {
                  const { trade } = await storage.insertTradeIgnoreDuplicate({
                    tradeId: orderLevelId,
                    exchange,
                    pair,
                    type: 'sell',
                    price: avgPrice.toString(),
                    amount: totalFilledAmount.toFixed(8),
                    executedAt: fill.executedAt,
                    origin: 'engine',
                    executedByBot: true,
                    status: 'filled',
                    orderIntentId: orderIntent?.id,
                    krakenOrderId: orderLevelId,
                    ...(noPosPnl ? { entryPrice: noPosPnl.entryPrice, realizedPnlUsd: noPosPnl.pnlUsd, realizedPnlPct: noPosPnl.pnlPct } : {}),
                  } as any);
                  if (orderIntent && trade?.id) {
                    try {
                      await storage.matchOrderIntentToTrade(orderIntent.clientOrderId, trade.id);
                      await storage.markTradeAsExecutedByBot(trade.id, orderIntent.id);
                    } catch {
                      // best-effort
                    }
                  }
                } catch {
                  // best-effort
                }

                await storage.upsertTradeFill({
                  txid: orderLevelId,
                  orderId: orderLevelId,
                  exchange,
                  pair,
                  type: 'sell',
                  price: avgPrice.toString(),
                  amount: totalFilledAmount.toFixed(8),
                  cost: (avgPrice * totalFilledAmount).toFixed(8),
                  fee: feeTotal.toFixed(8),
                  executedAt: fill.executedAt,
                  matched: false,
                } as any);
                const sellFill = await storage.getTradeFillByTxid(orderLevelId);
                if (sellFill) {
                  await fifoMatcher.processSellFill(sellFill);
                }
              } catch (e: any) {
                console.warn(`[FillWatcher] FIFO lot-match failed for sell ${pair} (no position): ${e?.message ?? String(e)}`);
              }
              try {
                await tryRecalculatePnlForPairExchange({ pair, exchange });
              } catch (e: any) {
                console.warn(`[FillWatcher] P&L reconcile note for ${pair}: ${e?.message ?? String(e)}`);
              }
            }
            if (onSellCompleted) {
              const avgPx2 = totalFilledAmount > 0 ? ((fills.reduce((acc, f) => acc + (f.price * f.amount), 0)) / totalFilledAmount) : fill.price;
              const feeTot2 = fills.reduce((acc, f) => acc + (f.fee || 0), 0);
              const noPosCompletedPnl = calcSellPnl(avgPx2, totalFilledAmount);
              onSellCompleted({
                exitPrice: avgPx2,
                totalAmount: totalFilledAmount,
                totalCostUsd: avgPx2 * totalFilledAmount,
                pnlUsd: noPosCompletedPnl ? parseFloat(noPosCompletedPnl.pnlUsd) : null,
                pnlPct: noPosCompletedPnl ? parseFloat(noPosCompletedPnl.pnlPct) : null,
                feeUsd: feeTot2,
                entryPrice: sellEntryPrice ?? null,
                executedAt: fill.executedAt,
              });
            }
            stopFillWatcher(clientOrderId);
            return;
          }
        }
      }

      // Log progress periodically
      if (pollCount % 10 === 0) {
        console.log(`[FillWatcher] Polling ${pair}: ${pollCount} polls, ${totalFilledAmount}/${expectedAmount} filled, ${Math.round(elapsed/1000)}s elapsed`);
      }

    } catch (error: any) {
      console.error(`[FillWatcher] Error polling fills:`, error.message);
      onError?.(error);
    }
  };

  // Start polling
  const intervalId = setInterval(pollForFills, pollIntervalMs);
  activeWatchers.set(clientOrderId, intervalId);

  // Run first poll immediately
  await pollForFills();
}

/**
 * Stop watching for fills on a specific order
 */
export function stopFillWatcher(clientOrderId: string): void {
  const intervalId = activeWatchers.get(clientOrderId);
  if (intervalId) {
    clearInterval(intervalId);
    activeWatchers.delete(clientOrderId);
    console.log(`[FillWatcher] Stopped watcher for ${clientOrderId}`);
  }
}

/**
 * Stop all active watchers (for shutdown)
 */
export function stopAllFillWatchers(): void {
  for (const [clientOrderId, intervalId] of activeWatchers) {
    clearInterval(intervalId);
    console.log(`[FillWatcher] Stopped watcher for ${clientOrderId}`);
  }
  activeWatchers.clear();
}

/**
 * Get count of active watchers
 */
export function getActiveWatcherCount(): number {
  return activeWatchers.size;
}

/**
 * Fetch fills for a specific order from exchange
 * IMPROVED: Uses getOrder for direct order status check + getFills with symbol filtering
 */
async function fetchFillsForOrder(
  exchangeService: any,
  exchange: string,
  exchangeOrderId?: string,
  clientOrderId?: string,
  pair?: string
): Promise<Fill[]> {
  try {
    if (exchange === 'revolutx') {
      // STRATEGY 1: If we have exchangeOrderId, check order status directly
      if (exchangeOrderId && typeof exchangeService.getOrder === 'function') {
        const order = await exchangeService.getOrder(exchangeOrderId);
        if (order && order.filledSize && order.filledSize > 0) {
          // CRITICAL FIX: Derive price if averagePrice not available but executedValue is
          let price = order.averagePrice || 0;
          if (price <= 0 && order.executedValue && order.filledSize > 0) {
            price = order.executedValue / order.filledSize;
            console.log(`[FillWatcher] Derived price from executedValue: ${price}`);
          }
          
          if (price > 0) {
            console.log(`[FillWatcher] Found fill via getOrder: ${order.filledSize} @ ${price}`);
            return [{
              fillId: `${exchangeOrderId}-fill`,
              orderId: exchangeOrderId,
              pair: exchangeService.normalizePairFromExchange?.(order.symbol) || order.symbol || pair || '',
              side: order.side?.toLowerCase() || 'buy',
              price,
              amount: order.filledSize,
              cost: price * order.filledSize,
              fee: 0,
              executedAt: order.createdAt || new Date(),
            }];
          } else {
            console.warn(`[FillWatcher] Order ${exchangeOrderId} has filledSize=${order.filledSize} but price could not be determined`);
          }
        }
      }

      // STRATEGY 2: Get fills by symbol and filter by time
      if (pair && typeof exchangeService.getFills === 'function') {
        const recentCutoff = Date.now() - 5 * 60 * 1000; // Last 5 minutes
        const fills = await exchangeService.getFills({ 
          symbol: pair,
          startMs: recentCutoff,
          limit: 50 
        });
        
        if (fills && fills.length > 0) {
          console.log(`[FillWatcher] Found ${fills.length} fills for ${pair} via getFills`);
          return fills
            .filter((f: any) => {
              const fillTime = new Date(f.created_at).getTime();
              const side = (f.side ?? '').toString().toLowerCase();
              return fillTime > recentCutoff && (side === 'buy' || side === 'sell');
            })
            .map((f: any) => ({
              fillId: f.fill_id || `${exchange}-${f.created_at}-${f.price}`,
              orderId: f.order_id || exchangeOrderId || '',
              pair: exchangeService.normalizePairFromExchange?.(f.symbol) || f.symbol || pair || '',
              side: f.side?.toLowerCase() === 'sell' ? 'sell' : 'buy',
              price: parseFloat(f.price || '0'),
              amount: parseFloat(f.quantity || '0'),
              cost: parseFloat(f.price || '0') * parseFloat(f.quantity || '0'),
              fee: f.fee || 0,
              executedAt: new Date(f.created_at),
            }));
        }
      }

      // STRATEGY 3: Legacy fallback - generic getFills without params
      const fills = await exchangeService.getFills?.({ limit: 50 });
      if (!fills || fills.length === 0) return [];

      const recentCutoff = Date.now() - 5 * 60 * 1000;
      const normalizedPair = pair?.replace('/', '-').toUpperCase();
      const altPair = pair?.replace('-', '/').toUpperCase();
      
      return fills
        .filter((f: any) => {
          const fillTime = new Date(f.created_at).getTime();
          const fillSymbol = f.symbol?.toUpperCase();
          const matchesPair = !pair || fillSymbol === normalizedPair || fillSymbol === altPair;
          const side = (f.side ?? '').toString().toLowerCase();
          return fillTime > recentCutoff && matchesPair && (side === 'buy' || side === 'sell');
        })
        .map((f: any) => ({
          fillId: f.fill_id || `${exchange}-${f.created_at}-${f.price}`,
          orderId: f.order_id || exchangeOrderId || '',
          pair: exchangeService.normalizePairFromExchange?.(f.symbol) || f.symbol || pair || '',
          side: f.side?.toLowerCase() === 'sell' ? 'sell' : 'buy',
          price: parseFloat(f.price || '0'),
          amount: parseFloat(f.quantity || '0'),
          cost: parseFloat(f.price || '0') * parseFloat(f.quantity || '0'),
          fee: f.fee || 0,
          executedAt: new Date(f.created_at),
        }));
    }

    if (exchange === 'kraken') {
      // Kraken: Use tradesHistory or queryTrades
      const trades = await exchangeService.getTradesHistory?.({ limit: 50 });
      if (!trades) return [];

      return Object.entries(trades).map(([txid, t]: [string, any]) => ({
        fillId: txid,
        orderId: t.ordertxid || exchangeOrderId || '',
        pair: t.pair || pair || '',
        side: t.type || 'buy',
        price: parseFloat(t.price),
        amount: parseFloat(t.vol),
        cost: parseFloat(t.cost),
        fee: parseFloat(t.fee || '0'),
        executedAt: new Date(t.time * 1000),
      }));
    }

    return [];
  } catch (error) {
    console.error(`[FillWatcher] Error fetching fills from ${exchange}:`, error);
    return [];
  }
}

/**
 * Get exchange service dynamically
 */
async function getExchangeService(exchange: string): Promise<any> {
  try {
    if (exchange === 'revolutx') {
      const { RevolutXService } = await import('./exchanges/RevolutXService');
      return RevolutXService.getInstance();
    }
    if (exchange === 'kraken') {
      // Kraken not supported for FillWatcher yet
      console.warn('[FillWatcher] Kraken FillWatcher not implemented yet');
      return null;
    }
    return null;
  } catch (error) {
    console.error(`[FillWatcher] Error getting exchange service:`, error);
    return null;
  }
}

/**
 * Clean up old processed fills (memory management)
 * Call periodically or on startup
 */
export function cleanupProcessedFills(maxAgeMs: number = 3600000): void {
  // For simplicity, clear all if set is too large
  if (processedFills.size > 10000) {
    processedFills.clear();
    console.log(`[FillWatcher] Cleared processed fills cache (was too large)`);
  }
}

export default {
  startFillWatcher,
  stopFillWatcher,
  stopAllFillWatchers,
  getActiveWatcherCount,
  cleanupProcessedFills,
};
