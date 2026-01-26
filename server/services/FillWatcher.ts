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

interface WatcherConfig {
  clientOrderId: string;
  exchangeOrderId?: string;
  exchange: string;
  pair: string;
  expectedAmount: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onFillReceived?: (fill: Fill, position: any) => void;
  onPositionOpen?: (position: any) => void;
  onTimeout?: (clientOrderId: string) => void;
  onError?: (error: Error) => void;
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
    onFillReceived,
    onPositionOpen,
    onTimeout,
    onError,
  } = config;

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

  // Get exchange service
  const exchangeService = await getExchangeService(exchange);
  if (!exchangeService) {
    console.error(`[FillWatcher] Exchange service not found for: ${exchange}`);
    onError?.(new Error(`Exchange service not found: ${exchange}`));
    return;
  }

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
                  
                  // Process the fill
                  const updatedPosition = await storage.updatePositionWithFill(clientOrderId, {
                    fillId: syntheticFill.fillId,
                    price: syntheticFill.price,
                    amount: syntheticFill.amount,
                    executedAt: syntheticFill.executedAt,
                  });
                  
                  if (updatedPosition) {
                    // Insert trade record
                    await storage.createTrade({
                      tradeId: syntheticFill.fillId,
                      exchange,
                      pair,
                      type: 'buy',
                      price: syntheticFill.price.toString(),
                      amount: syntheticFill.amount.toString(),
                      executedAt: syntheticFill.executedAt,
                      origin: 'engine',
                      executedByBot: true,
                    }).catch(() => {}); // Ignore duplicate errors
                    
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
                }
              }
            }
          }
        } catch (verifyErr: any) {
          console.error(`[FillWatcher] Error verifying order status on timeout: ${verifyErr.message}`);
        }
        
        // Only mark as FAILED if verification confirms no fills
        console.log(`[FillWatcher] No fills received and verification did not find filled order - marking as FAILED`);
        await storage.markPositionFailed(clientOrderId, 'Timeout: No fills received after verification');
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

        // Update position with fill
        const updatedPosition = await storage.updatePositionWithFill(clientOrderId, {
          fillId: fill.fillId,
          price: fill.price,
          amount: fill.amount,
          executedAt: fill.executedAt,
        });

        if (updatedPosition) {
          totalFilledAmount += fill.amount;

          // Insert trade record (idempotent via unique constraint)
          try {
            await storage.createTrade({
              tradeId: fill.fillId,
              exchange,
              pair,
              type: 'buy',
              price: fill.price.toString(),
              amount: fill.amount.toString(),
              executedAt: fill.executedAt,
              origin: 'engine',
              executedByBot: true,
            });
          } catch (err: any) {
            // Ignore duplicate key errors (idempotent)
            if (!err.message?.includes('duplicate') && !err.message?.includes('unique')) {
              console.error(`[FillWatcher] Error inserting trade:`, err);
            }
          }

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

          // Check if order is fully filled
          if (totalFilledAmount >= expectedAmount * 0.99) { // 99% tolerance
            console.log(`[FillWatcher] Order fully filled for ${pair}`);
            stopFillWatcher(clientOrderId);
            onPositionOpen?.(updatedPosition);
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
              fillId: `${exchangeOrderId}-fill-${Date.now()}`,
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
              return fillTime > recentCutoff && 
                     (f.side?.toLowerCase() === 'buy');
            })
            .map((f: any) => ({
              fillId: f.fill_id || `${exchange}-${f.created_at}-${f.price}`,
              orderId: f.order_id || exchangeOrderId || '',
              pair: exchangeService.normalizePairFromExchange?.(f.symbol) || f.symbol || pair || '',
              side: f.side?.toLowerCase() || 'buy',
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
          return fillTime > recentCutoff && matchesPair && f.side?.toLowerCase() === 'buy';
        })
        .map((f: any) => ({
          fillId: f.fill_id || `${exchange}-${f.created_at}-${f.price}`,
          orderId: f.order_id || exchangeOrderId || '',
          pair: exchangeService.normalizePairFromExchange?.(f.symbol) || f.symbol || pair || '',
          side: f.side?.toLowerCase() || 'buy',
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
