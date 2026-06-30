/**
 * Capital Efficiency Gate — prevents dust/micro entries that waste Smart Guard slots.
 *
 * Executed BEFORE creating a BUY, both in DRY RUN and live mode.
 * Returns a structured decision: ALLOW or BLOCK with reason code + human-readable message.
 */

export type CapitalEfficiencyBlockReason =
  | "ENTRY_BLOCKED_MIN_NOTIONAL"
  | "ENTRY_BLOCKED_DUST_ORDER"
  | "ENTRY_BLOCKED_LOW_EXPECTED_PROFIT"
  | "ENTRY_BLOCKED_INSUFFICIENT_USEFUL_CAPITAL"
  | "ENTRY_BLOCKED_SLOT_EFFICIENCY";

export interface CapitalEfficiencyGateInput {
  pair: string;
  computedOrderUsd: number;
  currentPrice: number;
  minEntryUsd: number;
  allowUnderMin: boolean;
  absoluteDustUsd: number;
  minExpectedProfitUsd: number;
  slotEfficiencyEnabled: boolean;
  maxLotsPerPair: number;
  openLotsThisPair: number;
  exposureAvailableUsd?: number;
  expectedExitPct?: number;
  estimatedFeesPct?: number;
  dryRun: boolean;
}

export interface CapitalEfficiencyGateResult {
  allowed: boolean;
  reason?: CapitalEfficiencyBlockReason;
  message?: string;
  meta: Record<string, any>;
}

export function checkCapitalEfficiencyGate(
  input: CapitalEfficiencyGateInput
): CapitalEfficiencyGateResult {
  const {
    pair,
    computedOrderUsd,
    minEntryUsd,
    allowUnderMin,
    absoluteDustUsd,
    minExpectedProfitUsd,
    slotEfficiencyEnabled,
    maxLotsPerPair,
    openLotsThisPair,
    exposureAvailableUsd,
    expectedExitPct,
    estimatedFeesPct,
    dryRun,
  } = input;

  const meta = {
    pair,
    computedOrderUsd,
    minEntryUsd,
    allowUnderMin,
    absoluteDustUsd,
    minExpectedProfitUsd,
    dryRun,
    openLotsThisPair,
    maxLotsPerPair,
  };

  // Rule A: Hard minimum notional — if allowUnderMin=false and order < minEntryUsd
  if (!allowUnderMin && computedOrderUsd < minEntryUsd) {
    return {
      allowed: false,
      reason: "ENTRY_BLOCKED_MIN_NOTIONAL",
      message: `Compra bloqueada: tamaño $${computedOrderUsd.toFixed(2)} inferior al mínimo configurado $${minEntryUsd.toFixed(2)}. No merece ocupar un lote.`,
      meta,
    };
  }

  // Rule B: Absolute dust block — even if allowUnderMin=true, block if < absoluteDustUsd
  if (computedOrderUsd < absoluteDustUsd) {
    return {
      allowed: false,
      reason: "ENTRY_BLOCKED_DUST_ORDER",
      message: `Compra bloqueada: operación residual/dust sin valor operativo. $${computedOrderUsd.toFixed(2)} < mínimo absoluto $${absoluteDustUsd.toFixed(2)}.`,
      meta,
    };
  }

  // Rule C: Minimum expected profit — if we can estimate it
  if (expectedExitPct !== undefined && estimatedFeesPct !== undefined) {
    const netProfitPct = expectedExitPct - estimatedFeesPct;
    const expectedProfitUsd = computedOrderUsd * (netProfitPct / 100);
    if (expectedProfitUsd < minExpectedProfitUsd) {
      return {
        allowed: false,
        reason: "ENTRY_BLOCKED_LOW_EXPECTED_PROFIT",
        message: `Compra bloqueada: la ganancia esperada ($${expectedProfitUsd.toFixed(2)}) no compensa comisiones, spread ni ocupar un slot. Mínimo: $${minExpectedProfitUsd.toFixed(2)}.`,
        meta: { ...meta, expectedProfitUsd, netProfitPct },
      };
    }
  }

  // Rule D: Slot efficiency — if slots are limited and order is small relative to minEntryUsd
  if (slotEfficiencyEnabled && maxLotsPerPair > 0 && openLotsThisPair < maxLotsPerPair) {
    const remainingSlots = maxLotsPerPair - openLotsThisPair;
    if (remainingSlots <= 2 && computedOrderUsd < minEntryUsd * 0.5) {
      return {
        allowed: false,
        reason: "ENTRY_BLOCKED_SLOT_EFFICIENCY",
        message: `Compra bloqueada: operación pequeña ($${computedOrderUsd.toFixed(2)}) ocupa slot (${openLotsThisPair}/${maxLotsPerPair}) que podría usarse para entrada mejor.`,
        meta: { ...meta, remainingSlots },
      };
    }
  }

  // Rule E: Capital unavailable — if exposure < minEntryUsd and allowUnderMin=false
  if (!allowUnderMin && exposureAvailableUsd !== undefined && exposureAvailableUsd < minEntryUsd) {
    return {
      allowed: false,
      reason: "ENTRY_BLOCKED_INSUFFICIENT_USEFUL_CAPITAL",
      message: `Capital disponible insuficiente para una entrada útil ($${exposureAvailableUsd.toFixed(2)} < $${minEntryUsd.toFixed(2)}). No se abre una microposición.`,
      meta: { ...meta, exposureAvailableUsd },
    };
  }

  return { allowed: true, meta };
}
