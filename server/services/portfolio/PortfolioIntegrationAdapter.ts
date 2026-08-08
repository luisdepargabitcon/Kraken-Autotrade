/**
 * PortfolioIntegrationAdapter — R2.17-R2.21
 *
 * Provides the standard integration points for all operational modes
 * to interact with the Global Portfolio.
 *
 * Flow per mode:
 *   beforeOrder: reserve() + acquireLock()
 *   onFill:      convertReservation() + ledger PURCHASE + addAttribution()
 *   onSell:      ledger SALE + reduceAttribution() + updateBudget
 *   onFailure:   releaseReservation() + releaseLock()
 *
 * FISCO is reporting-only: no budget, no reservation, no deployment.
 */

import { portfolioGlobalService } from "./portfolioGlobalService";
import { portfolioAllocationGuard } from "./PortfolioAllocationGuard";
import type { OperationalMode, LedgerEntry, LedgerEnvironment } from "./portfolioTypes";

export interface ReserveParams {
  mode: OperationalMode;
  exchange: string;
  asset: string;
  amountUsd: number;
  logicalIntentId?: string;
  cycleId?: string;
  trancheId?: string;
}

export interface FillParams {
  mode: OperationalMode;
  exchange: string;
  asset: string;
  amountUsd: number;
  quantity: number;
  priceUsd: number;
  orderId: string;
  reservationId: string;
  logicalIntentId?: string;
  cycleId?: string;
  trancheId?: string;
  lotId?: string;
  environment?: LedgerEnvironment;
}

export interface SellParams {
  mode: OperationalMode;
  exchange: string;
  asset: string;
  amountUsd: number;
  quantity: number;
  priceUsd: number;
  orderId: string;
  attributionId: string;
  cycleId?: string;
  environment?: LedgerEnvironment;
}

export interface FailureParams {
  reservationId: string;
  lockKey?: string;
  mode: OperationalMode;
  exchange: string;
  asset: string;
  amountUsd: number;
  reason: string;
}

class PortfolioIntegrationAdapterService {

  /**
   * R2.17-R2.20: Before an order, reserve capital and acquire lock.
   * Returns reservationId + lockId on success, null on failure.
   */
  async beforeOrder(params: ReserveParams): Promise<{
    reservationId: string;
    lockId: string;
  } | null> {
    const { mode, exchange, asset, amountUsd, logicalIntentId, cycleId, trancheId } = params;

    // Check for discrepancy blocks
    const blocked = await portfolioAllocationGuard.isModeAssetBlocked(mode, exchange, asset);
    if (blocked) {
      console.warn(`[PortfolioIntegration] ${mode} ${exchange}:${asset} blocked by discrepancy`);
      return null;
    }

    // Create persistent reservation
    const reservationId = `res-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = `idemp-${mode}-${exchange}-${asset}-${amountUsd}-${Date.now()}`;
    const reservation = await portfolioGlobalService.createReservation(
      reservationId,
      idempotencyKey,
      mode,
      exchange,
      asset,
      amountUsd,
      logicalIntentId,
    );

    if (!reservation) {
      console.warn(`[PortfolioIntegration] Reservation failed for ${mode} ${exchange}:${asset} amount=${amountUsd}`);
      return null;
    }

    // Acquire order lock
    const lockId = `lock-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lockKey = `${mode}:${exchange}:${asset}:${logicalIntentId || cycleId || "default"}`;
    const lockAcquired = await portfolioGlobalService.acquireLock(
      lockId,
      lockKey,
      mode,
      exchange,
      asset,
      logicalIntentId,
    );

    if (!lockAcquired) {
      // Release reservation if lock failed
      await portfolioGlobalService.releaseReservation(reservationId, "LOCK_FAILED");
      console.warn(`[PortfolioIntegration] Lock failed for ${lockKey}`);
      return null;
    }

    return { reservationId, lockId };
  }

  /**
   * R2.17-R2.20: On fill, convert reservation to deployed + ledger + attribution.
   */
  async onFill(params: FillParams): Promise<boolean> {
    const {
      mode, exchange, asset, amountUsd, quantity, priceUsd,
      orderId, reservationId, logicalIntentId, cycleId, trancheId, lotId,
      environment = "LIVE",
    } = params;

    // Convert reservation → deployed
    const converted = await portfolioGlobalService.convertReservation(reservationId, orderId);
    if (!converted) {
      console.error(`[PortfolioIntegration] Failed to convert reservation ${reservationId}`);
      return false;
    }

    // Append ledger PURCHASE entry
    const ledgerEntry: LedgerEntry = {
      eventId: `ledger-${mode}-${orderId}-${Date.now()}`,
      idempotencyKey: `idemp-ledger-${mode}-${orderId}-${reservationId}`,
      entryType: "PURCHASE",
      exchange,
      asset,
      quantity,
      amountUsd,
      priceUsd,
      feeUsd: 0,
      fromBucket: "RESERVED",
      toBucket: "DEPLOYED",
      mode,
      cycleId: cycleId ?? null,
      trancheId: trancheId ?? null,
      reservationId,
      orderId,
      realizedPnlUsd: null,
      environment,
      simulationSource: environment !== "LIVE" ? environment : null,
      source: "PORTFOLIO_INTEGRATION",
      metadataHash: null,
      createdAt: new Date().toISOString(),
    };
    await portfolioGlobalService.appendLedgerEntry(ledgerEntry);

    // Add inventory attribution
    const attributionId = `attr-${mode}-${orderId}-${Date.now()}`;
    const sourceType = this.getAttributionSourceType(mode);
    await portfolioGlobalService.addAttribution(
      attributionId,
      exchange,
      asset,
      mode,
      quantity,
      amountUsd,
      sourceType,
      orderId,
      cycleId,
      trancheId,
      lotId,
    );

    // Release the order lock
    const lockKey = `${mode}:${exchange}:${asset}:${logicalIntentId || cycleId || "default"}`;
    await portfolioGlobalService.releaseLock(lockKey);

    return true;
  }

  /**
   * R2.17-R2.20: On sell, ledger SALE + reduce attribution.
   */
  async onSell(params: SellParams): Promise<boolean> {
    const {
      mode, exchange, asset, amountUsd, quantity, priceUsd,
      orderId, attributionId, cycleId,
      environment = "LIVE",
    } = params;

    // Append ledger SALE entry
    const realizedPnl = amountUsd - (quantity > 0 ? amountUsd / quantity * quantity : 0);
    const ledgerEntry: LedgerEntry = {
      eventId: `ledger-${mode}-sell-${orderId}-${Date.now()}`,
      idempotencyKey: `idemp-ledger-${mode}-sell-${orderId}-${attributionId}`,
      entryType: "SALE",
      exchange,
      asset,
      quantity,
      amountUsd,
      priceUsd,
      feeUsd: 0,
      fromBucket: "DEPLOYED",
      toBucket: "REALIZED",
      mode,
      cycleId: cycleId ?? null,
      trancheId: null,
      reservationId: null,
      orderId,
      realizedPnlUsd: realizedPnl,
      environment,
      simulationSource: environment !== "LIVE" ? environment : null,
      source: "PORTFOLIO_INTEGRATION",
      metadataHash: null,
      createdAt: new Date().toISOString(),
    };
    await portfolioGlobalService.appendLedgerEntry(ledgerEntry);

    // Reduce attribution (mark as REDUCED or CLOSED)
    await portfolioGlobalService.updateAttributionStatus(attributionId, "REDUCED");

    return true;
  }

  /**
   * R2.17-R2.20: On failure (reject, cancel, expire), release reservation + lock.
   */
  async onFailure(params: FailureParams): Promise<boolean> {
    const { reservationId, lockKey, mode, exchange, asset, amountUsd, reason } = params;

    // Release reservation
    const released = await portfolioGlobalService.releaseReservation(reservationId, reason);
    if (!released) {
      console.warn(`[PortfolioIntegration] Failed to release reservation ${reservationId}`);
    }

    // Release lock if provided
    if (lockKey) {
      await portfolioGlobalService.releaseLock(lockKey);
    }

    // Append ledger RELEASE entry
    const ledgerEntry: LedgerEntry = {
      eventId: `ledger-${mode}-release-${reservationId}-${Date.now()}`,
      idempotencyKey: `idemp-ledger-${mode}-release-${reservationId}`,
      entryType: "RELEASE",
      exchange,
      asset,
      quantity: 0,
      amountUsd,
      priceUsd: null,
      feeUsd: 0,
      fromBucket: "RESERVED",
      toBucket: "FREE",
      mode,
      cycleId: null,
      trancheId: null,
      reservationId,
      orderId: null,
      realizedPnlUsd: null,
      environment: "LIVE",
      simulationSource: null,
      source: "PORTFOLIO_INTEGRATION",
      metadataHash: null,
      createdAt: new Date().toISOString(),
    };
    await portfolioGlobalService.appendLedgerEntry(ledgerEntry);

    return released;
  }

  /**
   * R2.21: Verify FISCO is reporting-only.
   * FISCO cannot: setBudget, reserve, deploy, own inventory, obtain order lock.
   */
  isFiscoAllowed(operation: string): boolean {
    const fiscoAllowed = ["READ_LEDGER", "READ_TRADES", "READ_REALIZED_PNL"];
    return fiscoAllowed.includes(operation);
  }

  /**
   * Map mode to attribution source type.
   */
  private getAttributionSourceType(mode: OperationalMode): "AMA_TRANCHE" | "GRID_FILL" | "IDCA_LOT" | "TRADING_POSITION" | "MANUAL" | "BOOTSTRAP" {
    switch (mode) {
      case "AMA": return "AMA_TRANCHE";
      case "GRID": return "GRID_FILL";
      case "IDCA": return "IDCA_LOT";
      case "SPOT_NORMAL": return "TRADING_POSITION";
      default: return "MANUAL";
    }
  }
}

export const portfolioIntegrationAdapter = new PortfolioIntegrationAdapterService();
