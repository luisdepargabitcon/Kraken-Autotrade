/**
 * GridCapitalAllocator — Intelligent capital allocation for the Isolated Grid.
 *
 * Responsibilities:
 *   - Read total available balance from Revolut X (via ExchangeFactory)
 *   - Apply capital profile reserve (conservative 30%, balanced 20%, aggressive 10%)
 *   - Check existing reservations for other strategies (IDCA, Spot Normal)
 *   - Compute available capital for Grid Isolated
 *   - Allocate capital across grid levels (planned vs financed)
 *   - Reserve capital in strategy_capital_reservations table
 *
 * This module ISOLATES Grid capital from IDCA and Spot Normal.
 * It does NOT share inventories or capital pools.
 */

import { db } from "../../db";
import { strategyCapitalReservations } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { botLogger } from "../botLogger";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import {
  CAPITAL_PROFILES,
  type CapitalProfile,
  type CapitalProfileConfig,
  type CapitalReservation,
  type AllocationMode,
  type CapitalDeploymentMode,
} from "./gridIsolatedTypes";
import { computeEffectiveBuyBudget } from "./gridAllocationEngine";

export interface GridCapitalConstraints {
  maxCapitalPerCycleUsd?: number;
  allocationMode?: AllocationMode;
  deploymentMode?: CapitalDeploymentMode;
  progressiveIntensity?: number;
  maxLevelPct?: number;
  minLevelUsd?: number;
}

export interface CapitalAllocationResult {
  totalBalanceUsd: number;
  reservePct: number;
  reservedAmountUsd: number;
  availableForGridUsd: number;
  maxCapitalPctOfBalance: number;
  maxGridCapitalUsd: number;
  finalGridBudgetUsd: number;
  capitalPerLevelUsd: number;
  levelsCount: number;
  profile: CapitalProfileConfig;
  maxCapitalPerCycleUsd: number;
  deploymentMode: CapitalDeploymentMode;
  allocationMode: AllocationMode;
}

class GridCapitalAllocator {
  private currentReservationId: string | null = null;

  /**
   * Get total available USD balance from the trading exchange (Revolut X).
   * Falls back to 0 if exchange not initialized.
   */
  async getTotalBalanceUsd(): Promise<number> {
    try {
      const exchange = ExchangeFactory.getTradingExchange();
      if (!exchange.isInitialized()) return 0;

      const balance = await exchange.getBalance();
      const usdBalance = balance["USD"] || 0;
      const btcBalance = balance["BTC"] || 0;

      // Convert BTC to USD using current ticker if available
      let btcValueUsd = 0;
      if (btcBalance > 0) {
        try {
          const ticker = await exchange.getTicker("BTC/USD");
          btcValueUsd = btcBalance * ticker.last;
        } catch {
          // If ticker fails, just use USD balance
        }
      }

      return usdBalance + btcValueUsd;
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridCapitalAllocator] Failed to get balance: ${error}`);
      return 0;
    }
  }

  /**
   * Get existing reservations for other strategies (to exclude from available capital).
   */
  async getOtherStrategiesReservedUsd(): Promise<number> {
    try {
      const reservations = await db
        .select()
        .from(strategyCapitalReservations)
        .where(
          and(
            isNull(strategyCapitalReservations.releasedAt),
            eq(strategyCapitalReservations.strategyType, "IDCA")
          )
        );

      const idcaReserved = reservations.reduce(
        (sum, r) => sum + parseFloat(r.reservedUsd || "0"),
        0
      );

      // Also check Spot Normal reservations if any
      const spotReservations = await db
        .select()
        .from(strategyCapitalReservations)
        .where(
          and(
            isNull(strategyCapitalReservations.releasedAt),
            eq(strategyCapitalReservations.strategyType, "SPOT_NORMAL")
          )
        );

      const spotReserved = spotReservations.reduce(
        (sum, r) => sum + parseFloat(r.reservedUsd || "0"),
        0
      );

      return idcaReserved + spotReserved;
    } catch {
      return 0;
    }
  }

  /**
   * Compute the capital allocation for a grid range based on profile and balance.
   */
  async allocate(
    profile: CapitalProfile,
    levelsCount: number,
    netProfitTargetPct: number,
    constraints?: GridCapitalConstraints
  ): Promise<CapitalAllocationResult> {
    const profileConfig = CAPITAL_PROFILES[profile];
    const totalBalanceUsd = await this.getTotalBalanceUsd();
    const otherReservedUsd = await this.getOtherStrategiesReservedUsd();

    // Apply profile reserve
    const reservePct = profileConfig.reservePct;
    const reservedAmountUsd = totalBalanceUsd * (reservePct / 100);

    // Available after reserve and other strategy reservations
    const availableForGridUsd = Math.max(0, totalBalanceUsd - reservedAmountUsd - otherReservedUsd);

    // Apply max capital percentage of balance
    const maxGridCapitalUsd = totalBalanceUsd * (profileConfig.maxCapitalPctOfBalance / 100);

    // Profile-based budget ceiling
    let finalGridBudgetUsd = Math.min(availableForGridUsd, maxGridCapitalUsd);

    // Apply gridMaxCapitalPerCycleUsd as a hard cap if provided
    const maxCapPerCycle = constraints?.maxCapitalPerCycleUsd ?? 0;
    const deploymentMode: CapitalDeploymentMode = constraints?.deploymentMode ?? "capped";
    const allocationMode: AllocationMode = constraints?.allocationMode ?? "uniform";
    const minLevelUsd = constraints?.minLevelUsd ?? profileConfig.minNotionalPerLevelUsd;

    const effectiveLevels = Math.min(levelsCount, profileConfig.maxLevelsPerRange);

    finalGridBudgetUsd = computeEffectiveBuyBudget(
      finalGridBudgetUsd,
      maxCapPerCycle,
      deploymentMode,
      effectiveLevels,
      minLevelUsd
    );

    // Per-level allocation (uniform baseline)
    let capitalPerLevelUsd = effectiveLevels > 0 ? finalGridBudgetUsd / effectiveLevels : 0;

    // Clamp to profile min/max
    capitalPerLevelUsd = Math.max(
      minLevelUsd,
      Math.min(capitalPerLevelUsd, profileConfig.maxNotionalPerLevelUsd)
    );

    const actualBudget = capitalPerLevelUsd * effectiveLevels;

    return {
      totalBalanceUsd,
      reservePct,
      reservedAmountUsd,
      availableForGridUsd,
      maxCapitalPctOfBalance: profileConfig.maxCapitalPctOfBalance,
      maxGridCapitalUsd,
      finalGridBudgetUsd: actualBudget,
      capitalPerLevelUsd,
      levelsCount: effectiveLevels,
      profile: profileConfig,
      maxCapitalPerCycleUsd: maxCapPerCycle,
      deploymentMode,
      allocationMode,
    };
  }

  /**
   * Reserve capital in the database for Grid Isolated.
   */
  async reserveCapital(
    pair: string,
    amountUsd: number,
    reason: string
  ): Promise<CapitalReservation> {
    const id = randomUUID();

    // Release any existing reservation first
    if (this.currentReservationId) {
      await this.releaseCapital(this.currentReservationId);
    }

    const availableUsd = await this.getTotalBalanceUsd();

    await db.insert(strategyCapitalReservations).values({
      id,
      strategyType: "GRID_ISOLATED",
      pair,
      reservedUsd: amountUsd.toFixed(2),
      availableUsd: availableUsd.toFixed(2),
      reason,
    });

    this.currentReservationId = id;

    await botLogger.info(
      "GRID_CAPITAL_RESERVED",
      `Capital reserved for Grid Isolated: $${amountUsd.toFixed(2)} for ${pair}`,
      { pair, reservedUsd: amountUsd, availableUsd, reservationId: id }
    );

    return {
      id,
      strategyType: "GRID_ISOLATED",
      pair,
      reservedUsd: amountUsd,
      availableUsd,
      reservedAt: new Date(),
      releasedAt: null,
      reason,
    };
  }

  /**
   * Release a capital reservation.
   */
  async releaseCapital(reservationId: string): Promise<void> {
    try {
      await db
        .update(strategyCapitalReservations)
        .set({ releasedAt: new Date() })
        .where(eq(strategyCapitalReservations.id, reservationId));

      if (this.currentReservationId === reservationId) {
        this.currentReservationId = null;
      }

      await botLogger.info(
        "GRID_CAPITAL_RELEASED",
        `Capital reservation released: ${reservationId}`,
        { reservationId }
      );
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridCapitalAllocator] Failed to release capital: ${error}`);
    }
  }

  /**
   * Get current active reservation.
   */
  getCurrentReservationId(): string | null {
    return this.currentReservationId;
  }
}

export const gridCapitalAllocator = new GridCapitalAllocator();
