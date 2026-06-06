/**
 * FISCO FIFO Engine: Processes normalized operations to calculate
 * capital gains/losses using FIFO (First In, First Out) method.
 * All calculations in EUR as required by Spanish tax law (IRPF).
 *
 * FIXED (2026-06-06):
 * - Negative inventory generates a CRITICAL error (not a silent warning).
 * - Sales without lots generate CRITICAL error with UNKNOWN_BASIS.
 * - Operations with requiresEurPrice=true generate CRITICAL error.
 * - FifoResult now includes criticalErrors[] that block fiscal report generation.
 * - validateFifoResult() helper to check if result is safe for reporting.
 */

import type { NormalizedOperation } from "./normalizer";

// ============================================================
// Types
// ============================================================

export interface FifoLot {
  id: string;           // Unique lot ID
  operationIdx: number; // Index into operations array
  asset: string;
  quantity: number;
  remainingQty: number;
  costEur: number;      // Total cost in EUR
  unitCostEur: number;  // Cost per unit in EUR
  feeEur: number;
  acquiredAt: Date;
  isClosed: boolean;
  exchange: string;
  externalId: string;
}

export interface FifoDisposal {
  sellOperationIdx: number;
  lotId: string;
  asset: string;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  gainLossEur: number;
  disposedAt: Date;
}

export type FiscoCriticalErrorCode =
  | "NEGATIVE_INVENTORY"      // sell reduces asset balance below zero
  | "UNKNOWN_BASIS"           // sold quantity exceeds available lots
  | "REQUIRES_EUR_PRICE"      // crypto-to-crypto trade without EUR value
  | "SELL_WITHOUT_LOTS"       // sell operation with zero open lots
  | "UNCLASSIFIED_OPERATION"; // operation type cannot be determined

export interface FiscoCriticalError {
  code: FiscoCriticalErrorCode;
  exchange: string;
  externalId: string;
  asset: string;
  detail: string;
  executedAt: Date;
}

export interface FifoResult {
  lots: FifoLot[];
  disposals: FifoDisposal[];
  summary: AssetSummary[];
  yearSummary: YearSummary[];
  warnings: string[];          // non-blocking notices
  criticalErrors: FiscoCriticalError[]; // BLOCKS fiscal report generation
  isSafeForReport: boolean;    // true only if criticalErrors is empty
}

export interface AssetSummary {
  asset: string;
  totalBought: number;
  totalSold: number;
  totalCostEur: number;
  totalProceedsEur: number;
  totalGainLossEur: number;
  totalFeesEur: number;
  openLots: number;
  closedLots: number;
}

export interface YearSummary {
  year: number;
  asset: string;
  acquisitions: number;
  disposals: number;
  costBasisEur: number;
  proceedsEur: number;
  gainLossEur: number;
  feesEur: number;
}

// ============================================================
// FIFO Processing
// ============================================================

/**
 * Run FIFO calculation on sorted normalized operations.
 * Operations MUST be sorted chronologically before calling this.
 */
export function runFifo(operations: NormalizedOperation[]): FifoResult {
  const lots: FifoLot[] = [];
  const disposals: FifoDisposal[] = [];
  const warnings: string[] = [];
  const criticalErrors: FiscoCriticalError[] = [];

  const openLotsByAsset = new Map<string, FifoLot[]>();
  // Track running inventory to detect negative balances
  const inventoryByAsset = new Map<string, number>();

  let lotCounter = 0;

  const addCritical = (code: FiscoCriticalErrorCode, op: NormalizedOperation, detail: string) => {
    criticalErrors.push({ code, exchange: op.exchange, externalId: op.externalId, asset: op.asset, detail, executedAt: op.executedAt });
  };

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // --- Flag crypto-to-crypto operations that have no EUR value ---
    if (op.requiresEurPrice) {
      addCritical(
        "REQUIRES_EUR_PRICE", op,
        `${op.opType === "trade_sell" ? "Venta" : "Compra"} de ${op.asset} en operación cripto/cripto (${op.pair}) sin valor EUR disponible. Requiere precio histórico manual.`
      );
      // Continue processing to register the operation exists (for inventory tracking)
      // but skip FIFO lot/disposal creation since we have no EUR value
      if (op.opType === "trade_sell") {
        const inv = (inventoryByAsset.get(op.asset) || 0) - op.amount;
        inventoryByAsset.set(op.asset, inv);
        if (inv < -1e-8) {
          addCritical("NEGATIVE_INVENTORY", op,
            `Inventario negativo de ${op.asset}: ${inv.toFixed(8)} tras venta cripto/cripto`);
        }
      } else if (op.opType === "trade_buy") {
        inventoryByAsset.set(op.asset, (inventoryByAsset.get(op.asset) || 0) + op.amount);
      }
      continue;
    }

    // --- BUY: Create a new FIFO lot ---
    if (op.opType === "trade_buy") {
      if (!op.totalEur || !op.priceEur) {
        warnings.push(`[${op.exchange}:${op.externalId}] Compra sin precio EUR, omitida del FIFO`);
        continue;
      }

      const lot: FifoLot = {
        id: `LOT-${++lotCounter}`,
        operationIdx: i,
        asset: op.asset,
        quantity: op.amount,
        remainingQty: op.amount,
        costEur: op.totalEur + op.feeEur,
        unitCostEur: (op.totalEur + op.feeEur) / op.amount,
        feeEur: op.feeEur,
        acquiredAt: op.executedAt,
        isClosed: false,
        exchange: op.exchange,
        externalId: op.externalId,
      };

      lots.push(lot);
      const assetLots = openLotsByAsset.get(op.asset) || [];
      assetLots.push(lot);
      openLotsByAsset.set(op.asset, assetLots);
      inventoryByAsset.set(op.asset, (inventoryByAsset.get(op.asset) || 0) + op.amount);
    }

    // --- SELL: Consume lots FIFO ---
    else if (op.opType === "trade_sell") {
      if (!op.totalEur || !op.priceEur) {
        warnings.push(`[${op.exchange}:${op.externalId}] Venta sin precio EUR, omitida del FIFO`);
        continue;
      }

      // Check inventory before selling
      const currentInv = inventoryByAsset.get(op.asset) || 0;
      if (currentInv <= 1e-10) {
        addCritical("SELL_WITHOUT_LOTS", op,
          `Venta de ${op.amount.toFixed(8)} ${op.asset} sin ningún lote abierto (inventario actual: ${currentInv.toFixed(8)})`);
      }

      let remainingToSell = op.amount;
      const sellPriceEur = op.priceEur;
      const assetLots = openLotsByAsset.get(op.asset) || [];
      const totalSellFeeEur = op.feeEur;

      while (remainingToSell > 1e-10 && assetLots.length > 0) {
        const lot = assetLots[0];
        const consumed = Math.min(remainingToSell, lot.remainingQty);

        const proceedsEur = consumed * sellPriceEur;
        const costBasisEur = consumed * lot.unitCostEur;
        const feePortion = op.amount > 0 ? (consumed / op.amount) * totalSellFeeEur : 0;
        const gainLoss = proceedsEur - costBasisEur - feePortion;

        disposals.push({
          sellOperationIdx: i,
          lotId: lot.id,
          asset: op.asset,
          quantity: consumed,
          proceedsEur,
          costBasisEur,
          gainLossEur: gainLoss,
          disposedAt: op.executedAt,
        });

        lot.remainingQty -= consumed;
        remainingToSell -= consumed;

        if (lot.remainingQty < 1e-10) {
          lot.isClosed = true;
          lot.remainingQty = 0;
          assetLots.shift();
        }
      }

      // Update inventory
      const newInv = (inventoryByAsset.get(op.asset) || 0) - op.amount;
      inventoryByAsset.set(op.asset, newInv);

      if (remainingToSell > 1e-10) {
        // CRITICAL: sold more than available lots — UNKNOWN_BASIS
        addCritical("UNKNOWN_BASIS", op,
          `Vendido ${op.amount.toFixed(8)} ${op.asset} pero solo había lotes para ${(op.amount - remainingToSell).toFixed(8)}. ` +
          `Faltan ${remainingToSell.toFixed(8)} ${op.asset} sin base de coste. Inventario resultante: ${newInv.toFixed(8)}.`);

        // Record the zero-basis disposal for completeness (flagged as UNKNOWN)
        disposals.push({
          sellOperationIdx: i,
          lotId: "UNKNOWN_BASIS",
          asset: op.asset,
          quantity: remainingToSell,
          proceedsEur: remainingToSell * sellPriceEur,
          costBasisEur: 0,
          gainLossEur: remainingToSell * sellPriceEur,
          disposedAt: op.executedAt,
        });
      }

      if (newInv < -1e-8) {
        addCritical("NEGATIVE_INVENTORY", op,
          `Inventario negativo de ${op.asset}: ${newInv.toFixed(8)} tras venta de ${op.amount.toFixed(8)}`);
      }
    }
  }

  const summary = buildAssetSummary(operations, lots, disposals);
  const yearSummary = buildYearSummary(operations, disposals);

  return {
    lots, disposals, summary, yearSummary, warnings,
    criticalErrors,
    isSafeForReport: criticalErrors.length === 0,
  };
}

/**
 * Post-FIFO validation: checks for all critical conditions.
 * Returns the same criticalErrors array with additional cross-checks.
 */
export function validateFifoResult(result: FifoResult): FiscoCriticalError[] {
  const errors = [...result.criticalErrors];

  // Check for UNKNOWN_BASIS disposals in the disposals list
  const unknownDisposals = result.disposals.filter(d => d.lotId === "UNKNOWN_BASIS");
  for (const d of unknownDisposals) {
    const alreadyReported = errors.some(
      e => e.code === "UNKNOWN_BASIS" && e.asset === d.asset
    );
    if (!alreadyReported) {
      errors.push({
        code: "UNKNOWN_BASIS",
        exchange: "unknown",
        externalId: "UNKNOWN_BASIS",
        asset: d.asset,
        detail: `Disposal de ${d.quantity.toFixed(8)} ${d.asset} sin base de coste (${d.disposedAt.toISOString().split("T")[0]})`,
        executedAt: d.disposedAt,
      });
    }
  }

  // Check for negative final balances per asset
  const assetBalance = new Map<string, number>();
  for (const lot of result.lots) {
    assetBalance.set(lot.asset, (assetBalance.get(lot.asset) || 0) + lot.quantity);
  }
  for (const d of result.disposals) {
    assetBalance.set(d.asset, (assetBalance.get(d.asset) || 0) - d.quantity);
  }
  for (const [asset, balance] of assetBalance) {
    if (balance < -1e-6) {
      const alreadyReported = errors.some(
        e => e.code === "NEGATIVE_INVENTORY" && e.asset === asset
      );
      if (!alreadyReported) {
        errors.push({
          code: "NEGATIVE_INVENTORY",
          exchange: "computed",
          externalId: "balance_check",
          asset,
          detail: `Balance final negativo para ${asset}: ${balance.toFixed(8)}`,
          executedAt: new Date(),
        });
      }
    }
  }

  return errors;
}

// ============================================================
// Summary builders
// ============================================================

function buildAssetSummary(
  operations: NormalizedOperation[],
  lots: FifoLot[],
  disposals: FifoDisposal[]
): AssetSummary[] {
  const map = new Map<string, AssetSummary>();

  const getOrCreate = (asset: string): AssetSummary => {
    if (!map.has(asset)) {
      map.set(asset, {
        asset,
        totalBought: 0,
        totalSold: 0,
        totalCostEur: 0,
        totalProceedsEur: 0,
        totalGainLossEur: 0,
        totalFeesEur: 0,
        openLots: 0,
        closedLots: 0,
      });
    }
    return map.get(asset)!;
  };

  for (const lot of lots) {
    const s = getOrCreate(lot.asset);
    s.totalBought += lot.quantity;
    s.totalCostEur += lot.costEur;
    s.totalFeesEur += lot.feeEur;
    if (lot.isClosed) s.closedLots++;
    else s.openLots++;
  }

  for (const d of disposals) {
    const s = getOrCreate(d.asset);
    s.totalSold += d.quantity;
    s.totalProceedsEur += d.proceedsEur;
    s.totalGainLossEur += d.gainLossEur;
  }

  // Add sell fees
  for (const op of operations) {
    if (op.opType === "trade_sell" && op.feeEur > 0) {
      const s = getOrCreate(op.asset);
      s.totalFeesEur += op.feeEur;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.asset.localeCompare(b.asset));
}

function buildYearSummary(
  operations: NormalizedOperation[],
  disposals: FifoDisposal[]
): YearSummary[] {
  const map = new Map<string, YearSummary>();

  const key = (year: number, asset: string) => `${year}:${asset}`;
  const getOrCreate = (year: number, asset: string): YearSummary => {
    const k = key(year, asset);
    if (!map.has(k)) {
      map.set(k, {
        year, asset,
        acquisitions: 0, disposals: 0,
        costBasisEur: 0, proceedsEur: 0,
        gainLossEur: 0, feesEur: 0,
      });
    }
    return map.get(k)!;
  };

  // Count acquisitions
  for (const op of operations) {
    if (op.opType === "trade_buy" && op.totalEur) {
      const year = op.executedAt.getFullYear();
      const s = getOrCreate(year, op.asset);
      s.acquisitions++;
      s.feesEur += op.feeEur;
    }
  }

  // Count disposals
  for (const d of disposals) {
    const year = d.disposedAt.getFullYear();
    const s = getOrCreate(year, d.asset);
    s.disposals++;
    s.costBasisEur += d.costBasisEur;
    s.proceedsEur += d.proceedsEur;
    s.gainLossEur += d.gainLossEur;
  }

  // Add sell fees
  for (const op of operations) {
    if (op.opType === "trade_sell" && op.feeEur > 0) {
      const year = op.executedAt.getFullYear();
      const s = getOrCreate(year, op.asset);
      s.feesEur += op.feeEur;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.asset.localeCompare(b.asset);
  });
}
