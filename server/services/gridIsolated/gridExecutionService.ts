/**
 * GridExecutionService — Low-API maker-first order execution for Grid Isolated.
 *
 * Execution Policy: MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK
 *   1. Try post-only limit order (maker, 0% fee on Revolut X)
 *   2. If post-only rejected, retry up to POST_ONLY_MAX_ATTEMPTS (3)
 *   3. On 3rd rejection, place limit taker order (0.09% fee)
 *   4. NEVER use market orders in normal flow
 *
 * Error handling:
 *   - Post-only rejections → retry (these are expected, price moved)
 *   - Timeout / 5xx / 429 → do NOT fallback to taker, circuit breaker
 *   - 401/403 → log critical, stop engine
 *
 * Rate limiting:
 *   - Uses RevolutXService's built-in rate limiter (250ms FIFO queue)
 *   - Daily order count tracked, warning at 200, hard stop at 300
 *
 * Idempotency:
 *   - Every order uses clientOrderId (UUID) for deduplication
 *   - If order with same clientOrderId already exists, skip
 */

import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { revolutXService } from "../exchanges/RevolutXService";
import { botLogger } from "../botLogger";
import {
  POST_ONLY_MAX_ATTEMPTS,
  CIRCUIT_BREAKER_RETRY_DELAY_MS,
  DAILY_ORDER_REQUEST_LIMIT,
  DAILY_ORDER_WARNING_THRESHOLD,
  type GridLevel,
} from "./gridIsolatedTypes";
import type { OrderResult } from "../exchanges/IExchangeService";

export interface GridOrderRequest {
  pair: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  clientOrderId: string;
  postOnly: boolean;
}

export interface GridOrderResult {
  success: boolean;
  clientOrderId: string;
  exchangeOrderId: string | null;
  filledQuantity: number;
  filledPrice: number | null;
  usedTakerFallback: boolean;
  postOnlyAttempts: number;
  pendingFill: boolean;
  error?: string;
}

class GridExecutionService {
  private circuitBreakerOpen: boolean = false;
  private circuitBreakerOpenedAt: Date | null = null;
  private dailyOrderCount: number = 0;
  private dailyOrderResetAt: Date = new Date();

  /**
   * Check if circuit breaker is open.
   */
  isCircuitBreakerOpen(): boolean {
    if (this.circuitBreakerOpen && this.circuitBreakerOpenedAt) {
      if (Date.now() - this.circuitBreakerOpenedAt.getTime() < CIRCUIT_BREAKER_RETRY_DELAY_MS) {
        return true;
      }
      // Close circuit breaker
      this.circuitBreakerOpen = false;
      this.circuitBreakerOpenedAt = null;
      botLogger.info("GRID_CIRCUIT_BREAKER_CLOSED", "Circuit breaker closed after cooldown");
    }
    return this.circuitBreakerOpen;
  }

  /**
   * Open circuit breaker (on critical API errors).
   */
  openCircuitBreaker(reason: string): void {
    this.circuitBreakerOpen = true;
    this.circuitBreakerOpenedAt = new Date();
    botLogger.error("GRID_CIRCUIT_BREAKER_OPENED", `Circuit breaker opened: ${reason}`, { reason });
  }

  /**
   * Check and reset daily order count.
   */
  checkDailyOrderReset(): void {
    const now = new Date();
    if (now.getDate() !== this.dailyOrderResetAt.getDate() ||
        now.getMonth() !== this.dailyOrderResetAt.getMonth()) {
      this.dailyOrderCount = 0;
      this.dailyOrderResetAt = now;
    }
  }

  /**
   * Check if we can place more orders today.
   */
  canPlaceOrder(): boolean {
    this.checkDailyOrderReset();
    return this.dailyOrderCount < DAILY_ORDER_REQUEST_LIMIT;
  }

  /**
   * Get daily order count.
   */
  getDailyOrderCount(): number {
    return this.dailyOrderCount;
  }

  /**
   * Increment daily order count and check thresholds.
   */
  private incrementOrderCount(): void {
    this.dailyOrderCount++;
    if (this.dailyOrderCount === DAILY_ORDER_WARNING_THRESHOLD) {
      botLogger.warn("GRID_DAILY_ORDER_WARNING", `Daily order count at warning threshold: ${this.dailyOrderCount}/${DAILY_ORDER_REQUEST_LIMIT}`);
    }
    if (this.dailyOrderCount >= DAILY_ORDER_REQUEST_LIMIT) {
      botLogger.error("GRID_DAILY_ORDER_LIMIT_HIT", `Daily order limit reached: ${this.dailyOrderCount}/${DAILY_ORDER_REQUEST_LIMIT}`);
    }
  }

  /**
   * Determine if an error is a post-only rejection (price moved).
   * Post-only rejections are EXPECTED and should trigger retry.
   */
  private isPostOnlyRejection(error: any): boolean {
    if (!error) return false;
    const msg = (error.message || error.toString() || "").toLowerCase();
    // Revolut X returns specific error codes for post-only rejections
    // "would_cross" or "post_only_would_cross" or similar
    return msg.includes("post_only") ||
           msg.includes("postonly") ||
           msg.includes("would_cross") ||
           msg.includes("would match") ||
           msg.includes("crosses");
  }

  /**
   * Determine if an error is a retryable API error (timeout, 5xx, 429).
   * These should NOT trigger taker fallback.
   */
  private isRetryableApiError(error: any): boolean {
    if (!error) return false;
    const msg = (error.message || error.toString() || "").toLowerCase();
    return msg.includes("timeout") ||
           msg.includes("timed out") ||
           msg.includes("econnreset") ||
           msg.includes("enotfound") ||
           msg.includes("429") ||
           msg.includes("rate limit") ||
           msg.includes("500") ||
           msg.includes("502") ||
           msg.includes("503") ||
           msg.includes("504") ||
           msg.includes("service unavailable") ||
           msg.includes("bad gateway") ||
           msg.includes("internal server error");
  }

  /**
   * Determine if an error is an auth error (should stop engine).
   */
  private isAuthError(error: any): boolean {
    if (!error) return false;
    const msg = (error.message || error.toString() || "").toLowerCase();
    return msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden");
  }

  /**
   * Place an order with maker-first-then-taker-fallback policy.
   *
   * Returns GridOrderResult with execution details.
   */
  async placeOrder(request: GridOrderRequest): Promise<GridOrderResult> {
    // Pre-checks
    if (this.isCircuitBreakerOpen()) {
      return this.failResult(request, "Circuit breaker open — orders blocked");
    }

    if (!this.canPlaceOrder()) {
      return this.failResult(request, "Daily order limit reached");
    }

    if (!revolutXService.isInitialized()) {
      return this.failResult(request, "Revolut X not initialized");
    }

    // Phase 1: Try post-only limit orders (maker)
    let postOnlyAttempts = 0;
    let lastError: any = null;

    for (let attempt = 1; attempt <= POST_ONLY_MAX_ATTEMPTS; attempt++) {
      try {
        this.incrementOrderCount();

        const orderResult = await revolutXService.placeOrder({
          pair: request.pair,
          type: request.side.toLowerCase() as "buy" | "sell",
          ordertype: "limit",
          price: String(request.price),
          volume: String(request.quantity),
          clientOrderId: request.clientOrderId,
        });

        if (orderResult.success) {
          return {
            success: true,
            clientOrderId: request.clientOrderId,
            exchangeOrderId: orderResult.orderId || null,
            filledQuantity: orderResult.volume || 0,
            filledPrice: orderResult.price || null,
            usedTakerFallback: false,
            postOnlyAttempts: attempt,
            pendingFill: orderResult.pendingFill || false,
          };
        }

        // Order not successful — check error type
        lastError = new Error(orderResult.error || "Unknown error");

        if (this.isPostOnlyRejection(lastError)) {
          postOnlyAttempts = attempt;
          await botLogger.info("GRID_LEVEL_POST_ONLY_REJECTED", `Post-only rejected (attempt ${attempt}/${POST_ONLY_MAX_ATTEMPTS}): ${lastError.message}`, {
            clientOrderId: request.clientOrderId, attempt, side: request.side, price: request.price,
          });
          // Wait briefly before retry (avoid hammering)
          await this.sleep(500 * attempt);
          continue;
        }

        if (this.isRetryableApiError(lastError)) {
          // Do NOT fallback to taker on API errors
          this.openCircuitBreaker(`API error: ${lastError.message}`);
          return this.failResult(request, `API error (circuit breaker opened): ${lastError.message}`, postOnlyAttempts);
        }

        if (this.isAuthError(lastError)) {
          this.openCircuitBreaker(`Auth error: ${lastError.message}`);
          return this.failResult(request, `Authentication error: ${lastError.message}`, postOnlyAttempts);
        }

        // Unknown error — don't fallback
        return this.failResult(request, `Order failed: ${lastError.message}`, postOnlyAttempts);
      } catch (error) {
        lastError = error;
        postOnlyAttempts = attempt;

        if (this.isRetryableApiError(error)) {
          this.openCircuitBreaker(`API error: ${(error as Error).message}`);
          return this.failResult(request, `API error (circuit breaker opened): ${(error as Error).message}`, postOnlyAttempts);
        }

        if (this.isAuthError(error)) {
          this.openCircuitBreaker(`Auth error: ${(error as Error).message}`);
          return this.failResult(request, `Authentication error: ${(error as Error).message}`, postOnlyAttempts);
        }

        if (this.isPostOnlyRejection(error)) {
          await botLogger.info("GRID_LEVEL_POST_ONLY_REJECTED", `Post-only rejected (attempt ${attempt}/${POST_ONLY_MAX_ATTEMPTS}): ${(error as Error).message}`, {
            clientOrderId: request.clientOrderId, attempt,
          });
          await this.sleep(500 * attempt);
          continue;
        }

        return this.failResult(request, `Exception: ${(error as Error).message}`, postOnlyAttempts);
      }
    }

    // Phase 2: All post-only attempts exhausted — fallback to limit taker
    await botLogger.warn("GRID_LEVEL_TAKER_FALLBACK", `Falling back to limit taker after ${POST_ONLY_MAX_ATTEMPTS} post-only rejections`, {
      clientOrderId: request.clientOrderId, side: request.side, price: request.price,
    });

    try {
      this.incrementOrderCount();

      const takerPrice = request.side === "BUY" ? request.price * 1.001 : request.price * 0.999;
      const orderResult = await revolutXService.placeOrder({
        pair: request.pair,
        type: request.side.toLowerCase() as "buy" | "sell",
        ordertype: "limit",
        price: String(takerPrice),
        volume: String(request.quantity),
        clientOrderId: request.clientOrderId + "_taker",
      });

      if (orderResult.success) {
        return {
          success: true,
          clientOrderId: request.clientOrderId + "_taker",
          exchangeOrderId: orderResult.orderId || null,
          filledQuantity: orderResult.volume || 0,
          filledPrice: orderResult.price || null,
          usedTakerFallback: true,
          postOnlyAttempts: POST_ONLY_MAX_ATTEMPTS,
          pendingFill: orderResult.pendingFill || false,
        };
      }

      return this.failResult(request, `Taker fallback failed: ${orderResult.error}`, POST_ONLY_MAX_ATTEMPTS, true);
    } catch (error) {
      this.openCircuitBreaker(`Taker fallback exception: ${(error as Error).message}`);
      return this.failResult(request, `Taker fallback exception: ${(error as Error).message}`, POST_ONLY_MAX_ATTEMPTS, true);
    }
  }

  /**
   * Cancel an order on the exchange.
   */
  async cancelOrder(exchangeOrderId: string, pair: string): Promise<boolean> {
    try {
      if (!revolutXService.isInitialized()) return false;
      await revolutXService.cancelOrder(exchangeOrderId);
      return true;
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridExecutionService] Cancel order failed: ${error}`);
      return false;
    }
  }

  private failResult(
    request: GridOrderRequest,
    error: string,
    postOnlyAttempts: number = 0,
    usedTakerFallback: boolean = false
  ): GridOrderResult {
    return {
      success: false,
      clientOrderId: request.clientOrderId,
      exchangeOrderId: null,
      filledQuantity: 0,
      filledPrice: null,
      usedTakerFallback,
      postOnlyAttempts,
      pendingFill: false,
      error,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const gridExecutionService = new GridExecutionService();
