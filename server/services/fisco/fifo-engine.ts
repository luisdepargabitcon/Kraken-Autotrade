/**
 * FISCO FIFO Engine: Processes normalized operations to calculate
 * capital gains/losses using FIFO (First In, First Out) method.
 * All calculations in EUR as required by Spanish tax law (IRPF).
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

export interface FifoResult {
  lots: FifoLot[];
  disposals: FifoDisposal[];
  summary: AssetSummary[];
  yearSummary: YearSummary[];
  warnings: string[];
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

  // Index lots by asset for quick FIFO lookup
  const openLotsByAsset = new Map<string, FifoLot[]>();

  let lotCounter = 0;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // --- BUY: Create a new lot ---
    if (op.opType === "trade_buy") {
      if (!op.totalEur || !op.priceEur) {
        warnings.push(`[${op.exchange}:${op.externalId}] Buy without EUR price, skipped for FIFO`);
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
    }

    // --- SELL: Consume lots FIFO ---
    else if (op.opType === "trade_sell") {
      if (!op.totalEur || !op.priceEur) {
        warnings.push(`[${op.exchange}:${op.externalId}] Sell without EUR price, skipped for FIFO`);
        continue;
      }

      let remainingToSell = op.amount;
      const sellPriceEur = op.priceEur;
      const assetLots = openLotsByAsset.get(op.asset) || [];

      // Allocate sell fee proportionally across disposals
      const totalSellFeeEur = op.feeEur;

      while (remainingToSell > 1e-10 && assetLots.length > 0) {
        const lot = assetLots[0]; // FIFO: oldest first
        const consumed = Math.min(remainingToSell, lot.remainingQty);

        const proceedsEur = consumed * sellPriceEur;
        const costBasisEur = consumed * lot.unitCostEur;
        const feePortion = (consumed / op.amount) * totalSellFeeEur;
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
          assetLots.shift(); // Remove closed lot from open list
        }
      }

      if (remainingToSell > 1e-10) {
        warnings.push(
          `[${op.exchange}:${op.externalId}] Sold ${op.amount} ${op.asset} but only had lots for ${(op.amount - remainingToSell).toFixed(8)}. ` +
          `Remaining ${remainingToSell.toFixed(8)} has no cost basis (possible pre-existing holdings or deposits).`
        );
        // Create a zero-cost-basis disposal for the remainder
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
    }

    // Deposits and withdrawals don't create taxable events by themselves
    // but deposits of crypto COULD establish cost basis if from external wallet.
    // For now we skip them — the user trades within exchanges only.
  }

  // Build summaries
  const summary = buildAssetSummary(operations, lots, disposals);
  const yearSummary = buildYearSummary(operations, disposals);

  return { lots, disposals, summary, yearSummary, warnings };
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
