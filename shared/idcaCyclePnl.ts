/**
 * IDCA PnL Calculator — Canonical PnL computation for IDCA cycles.
 *
 * Pure function compatible with both frontend and backend.
 * Handles legacy/imported cycles where realizedPnlUsd may store SELL PROCEEDS
 * instead of NET PROFIT (pre-bee8391).
 *
 * PRIORITY: Always calculate from real orders when available.
 */

export interface IdcaCyclePnlResult {
  capitalInvestedUsd: number;
  totalBuyQty: number;
  totalBuyCostUsd: number;
  avgCostUsd: number;
  totalSellQty: number;
  totalSellValueUsd: number;
  soldCostBasisUsd: number;
  realizedGrossUsd: number;
  totalFeesUsd: number;
  realizedNetUsd: number;
  realizedPnlPct: number;
  pnlSource: "orders" | "orders_cycle_capital" | "orders_avg_entry" | "cycle_realized" | "cycle_realized_fallback" | "insufficient" | "cost_basis_missing";
  warnings: string[];
  importedOpeningLot?: {
    quantity: number;
    avgPrice: number;
    costUsd: number;
    source: string;
  };
}

export interface IdcaCyclePnlOrder {
  side?: string;
  status?: string;
  type?: string;
  order_type?: string;
  reason?: string;
  label?: string;
  title?: string;
  price?: number | string | null;
  executionPrice?: number | string | null;
  execution_price?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  amount?: number | string | null;
  baseAmount?: number | string | null;
  base_amount?: number | string | null;
  executedQty?: number | string | null;
  executed_qty?: number | string | null;
  valueUsd?: number | string | null;
  value_usd?: number | string | null;
  gross_value_usd?: number | string | null;
  net_value_usd?: number | string | null;
  valueUSD?: number | string | null;
  totalValueUsd?: number | string | null;
  total_value_usd?: number | string | null;
  value?: number | string | null;
  notionalUsd?: number | string | null;
  notional_usd?: number | string | null;
  amountUsd?: number | string | null;
  amount_usd?: number | string | null;
  feesUsd?: number | string | null;
  feeUsd?: number | string | null;
  fee_usd?: number | string | null;
  fees_usd?: number | string | null;
  fee?: number | string | null;
  fees?: number | string | null;
  fee_amount_usd?: number | string | null;
}

export interface IdcaCyclePnlInput {
  id?: number | string | null;
  capitalUsedUsd?: number | string | null;
  totalQuantity?: number | string | null;
  avgEntryPrice?: number | string | null;
  realizedPnlUsd?: number | string | null;
  pair?: string | null;
  status?: string;
  isImported?: boolean;
  is_imported?: boolean;
  sourceType?: string;
  source_type?: string;
  isManualCycle?: boolean;
  is_manual_cycle?: boolean;
  managedBy?: string;
  managed_by?: string;
  basePrice?: number | string | null;
  base_price?: number | string | null;
  basePriceType?: string;
  base_price_type?: string;
  importSnapshotJson?: any;
  import_snapshot_json?: any;
}

/**
 * Read number from multiple possible field variants.
 */
function readNumber(...values: (number | string | null | undefined)[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(String(value).replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Get order value USD from multiple field variants.
 */
function getOrderValueUsd(order: IdcaCyclePnlOrder): number {
  return readNumber(
    order.valueUsd,
    order.value_usd,
    order.gross_value_usd,
    order.net_value_usd,
    order.valueUSD,
    order.totalValueUsd,
    order.total_value_usd,
    order.value,
    order.notionalUsd,
    order.notional_usd,
    order.amountUsd,
    order.amount_usd
  );
}

/**
 * Get order quantity from multiple field variants.
 */
function getOrderQuantity(order: IdcaCyclePnlOrder): number {
  return readNumber(
    order.quantity,
    order.qty,
    order.amount,
    order.baseAmount,
    order.base_amount,
    order.executedQty,
    order.executed_qty
  );
}

/**
 * Get order fee USD from multiple field variants.
 */
function getOrderFeeUsd(order: IdcaCyclePnlOrder): number {
  return readNumber(
    order.feeUsd,
    order.feesUsd,
    order.fee_usd,
    order.fees_usd,
    order.fee,
    order.fees,
    order.fee_amount_usd
  );
}

/**
 * Get order price from multiple field variants.
 */
function getOrderPrice(order: IdcaCyclePnlOrder): number {
  return readNumber(order.price, order.executionPrice, order.execution_price);
}

/**
 * Normalize order side/type to "buy" | "sell" | "unknown"
 * Handles English and Spanish variants.
 * Does NOT depend on 'type' column (DB uses 'order_type').
 */
function normalizeOrderSide(order: IdcaCyclePnlOrder): "buy" | "sell" | "unknown" {
  const raw = [
    order.side,
    order.order_type,
    order.reason,
    order.label,
    order.title
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    raw.includes("buy") ||
    raw.includes("compra") ||
    raw.includes("entrada") ||
    raw.includes("initial")
  ) return "buy";

  if (
    raw.includes("sell") ||
    raw.includes("venta") ||
    raw.includes("salida") ||
    raw.includes("trailing") ||
    raw.includes("close") ||
    raw.includes("cerró") ||
    raw.includes("cerro")
  ) return "sell";

  return "unknown";
}

/**
 * Check if cycle is imported or manual.
 * Detects imported/manual cycles from multiple field variants.
 */
function isImportedOrManualCycle(cycle: IdcaCyclePnlInput): boolean {
  return Boolean(
    cycle.isImported ||
    cycle.is_imported ||
    cycle.isManualCycle ||
    cycle.is_manual_cycle ||
    cycle.sourceType === "manual" ||
    cycle.source_type === "manual" ||
    cycle.managedBy === "manual" ||
    cycle.managed_by === "manual" ||
    String(cycle.basePriceType || cycle.base_price_type || "").toLowerCase().includes("imported") ||
    String(cycle.sourceType || cycle.source_type || "").toLowerCase().includes("import")
  );
}

/**
 * Build imported opening lot from cycle data.
 * Returns the cost basis for the initial imported position.
 * Uses originalQty/originalCapital/originalAvgPrice from snapshot if available.
 */
function buildImportedOpeningLot(
  cycle: IdcaCyclePnlInput,
  totalSellQty: number,
  totalBuyQty: number
): {
  quantity: number;
  avgPrice: number;
  costUsd: number;
  source: string;
  valid: boolean;
  warning?: string;
} {
  const warnings: string[] = [];
  let importedQty = 0;
  let importedAvgPrice = 0;
  let importedCapital = 0;
  let source = "";

  // Try to get imported data from importSnapshotJson
  const snapshot = cycle.importSnapshotJson || cycle.import_snapshot_json;
  if (snapshot && typeof snapshot === "object") {
    // Priority 1: originalQty + originalCapital (most accurate)
    importedQty = readNumber(
      snapshot.originalQty,
      snapshot.original_qty,
      snapshot.quantity,
      snapshot.totalQuantity,
      snapshot.total_quantity,
      snapshot.baseQuantity,
      snapshot.base_quantity,
      snapshot.importedQuantity,
      snapshot.imported_quantity
    );
    importedCapital = readNumber(
      snapshot.originalCapital,
      snapshot.original_capital,
      snapshot.costUsd,
      snapshot.cost_usd,
      snapshot.valueUsd,
      snapshot.value_usd
    );
    importedAvgPrice = readNumber(
      snapshot.originalAvgPrice,
      snapshot.original_avg_price,
      snapshot.avgEntryPrice,
      snapshot.avg_entry_price,
      snapshot.averagePrice,
      snapshot.average_price,
      snapshot.price
    );

    // If we have originalQty and originalCapital, use them directly
    if (importedQty > 0 && importedCapital > 0) {
      importedAvgPrice = importedCapital / importedQty;
      source = "import_snapshot_original_capital";
    } else if (importedQty > 0 && importedAvgPrice > 0) {
      importedCapital = importedQty * importedAvgPrice;
      source = "import_snapshot_qty_avg";
    } else if (importedQty > 0 || importedAvgPrice > 0) {
      source = "import_snapshot_partial";
    }
  }

  // Fallback to cycle fields
  if (importedQty <= 0) {
    importedQty = readNumber(cycle.totalQuantity);
    if (importedQty > 0) {
      source = source || "cycle_total_quantity";
    }
  }

  if (importedAvgPrice <= 0) {
    importedAvgPrice = readNumber(cycle.avgEntryPrice);
    if (importedAvgPrice > 0) {
      source = source || "cycle_avg_entry_price";
    }
  }

  // If basePriceType contains imported_avg, use basePrice
  const basePriceType = String(cycle.basePriceType || cycle.base_price_type || "").toLowerCase();
  if (basePriceType.includes("imported_avg") || basePriceType.includes("imported")) {
    const basePrice = readNumber(cycle.basePrice, cycle.base_price);
    if (basePrice > 0) {
      importedAvgPrice = basePrice;
      source = source || "base_price_imported_avg";
    }
  }

  // If sell qty > buy qty, we need imported quantity to cover the difference
  const importedQtyNeeded = Math.max(0, totalSellQty - totalBuyQty);
  if (importedQtyNeeded > 0 && importedQty <= 0) {
    importedQty = importedQtyNeeded;
    source = source || "calculated_from_sell_buy_diff";
    warnings.push(`Imported quantity calculated from sell-buy diff: ${importedQty}`);
  }

  // Calculate cost if not set
  if (importedCapital <= 0 && importedQty > 0 && importedAvgPrice > 0) {
    importedCapital = importedQty * importedAvgPrice;
  }

  const valid = importedQty > 0 && importedAvgPrice > 0;

  if (!valid) {
    if (importedQty <= 0) {
      warnings.push("Cannot determine imported quantity");
    }
    if (importedAvgPrice <= 0) {
      warnings.push("Cannot determine imported average price");
    }
  }

  return {
    quantity: importedQty,
    avgPrice: importedAvgPrice,
    costUsd: importedCapital,
    source,
    valid,
    warning: warnings.length > 0 ? warnings.join("; ") : undefined,
  };
}

/**
 * Check if realizedPnlUsd looks like SELL PROCEEDS (not net profit).
 * Legacy/imported cycles may store sell proceeds in realizedPnlUsd.
 */
function looksLikeSellProceeds(
  realizedPnlUsd: number,
  capitalUsedUsd: number,
  totalSellValueUsd: number
): { isSellProceeds: boolean; reason: string } {
  if (realizedPnlUsd <= 0) {
    return { isSellProceeds: false, reason: "Negative or zero, not sell proceeds" };
  }

  // If totalSellValue is available and realizedPnlUsd is close to it, it's sell proceeds
  if (totalSellValueUsd > 0) {
    const diff = Math.abs(realizedPnlUsd - totalSellValueUsd);
    const diffPct = diff / totalSellValueUsd;
    if (diffPct < 0.03) {
      return { isSellProceeds: true, reason: "realizedPnlUsd ≈ totalSellValue (within 3%)" };
    }
  }

  // If realizedPnlUsd > 50% of capital, it's likely sell proceeds
  if (capitalUsedUsd > 0 && realizedPnlUsd / capitalUsedUsd > 0.50) {
    return { isSellProceeds: true, reason: "realizedPnlUsd > 50% of capital, likely sell proceeds" };
  }

  return { isSellProceeds: false, reason: "Plausible as net profit" };
}

/**
 * Calculate PnL for an IDCA cycle using canonical rules.
 *
 * PRIORITY:
 * 1. Calculate from BUY/SELL orders when available (always preferred)
 * 2. If SELL but no BUY: use capitalUsedUsd/avgEntry as cost basis
 * 3. Only if no orders sufficient: use realizedPnlUsd as fallback (with validation)
 * 4. Validate realizedPnlUsd before using (detect sell proceeds)
 */
export function calculateIdcaCycleRealizedPnl(
  cycle: IdcaCyclePnlInput,
  orders: IdcaCyclePnlOrder[] = []
): IdcaCyclePnlResult {
  const warnings: string[] = [];
  let pnlSource: IdcaCyclePnlResult["pnlSource"] = "insufficient";

  // Extract cycle data
  const capitalUsedUsd = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const totalQuantity = parseFloat(String(cycle.totalQuantity || "0"));
  const avgEntryPrice = parseFloat(String(cycle.avgEntryPrice || "0"));
  const realizedPnlUsd = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const status = cycle.status || "active";
  const pair = cycle.pair || "";

  // Normalize orders (read all field variants, reconstruct value if missing)
  const normalizedOrders = orders.map((o: IdcaCyclePnlOrder) => {
    const valueUsd = getOrderValueUsd(o);
    const price = getOrderPrice(o);
    const quantity = getOrderQuantity(o);

    // Reconstruct value from price * quantity if missing
    let finalValueUsd = valueUsd;
    if (finalValueUsd <= 0 && price > 0 && quantity > 0) {
      finalValueUsd = price * quantity;
      warnings.push(`Reconstructed value from price*quantity: ${finalValueUsd}`);
    }

    return {
      side: normalizeOrderSide(o),
      quantity,
      price,
      valueUsd: finalValueUsd,
      feeUsd: getOrderFeeUsd(o),
    };
  });

  // Separate BUY and SELL orders (normalized)
  const buyOrders = normalizedOrders.filter((o: any) => {
    const normalizedSide = normalizeOrderSide(o);
    const isFilled = !o.status || o.status.toLowerCase() === "filled";
    return normalizedSide === "buy" && isFilled;
  });
  const sellOrders = normalizedOrders.filter((o: any) => {
    const normalizedSide = normalizeOrderSide(o);
    const isFilled = !o.status || o.status.toLowerCase() === "filled";
    return normalizedSide === "sell" && isFilled;
  });

  // Calculate BUY stats
  let totalBuyQty = 0;
  let totalBuyCostUsd = 0;
  let avgCostUsd = 0;

  if (buyOrders.length > 0) {
    totalBuyQty = buyOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);
    totalBuyCostUsd = buyOrders.reduce((sum, o) => sum + (o.valueUsd || 0), 0);
    const buyFeesUsd = buyOrders.reduce((sum, o) => sum + (o.feeUsd || 0), 0);
    totalBuyCostUsd += buyFeesUsd; // Include fees in cost basis
    avgCostUsd = totalBuyQty > 0 ? totalBuyCostUsd / totalBuyQty : 0;
  }

  // Calculate SELL stats
  const totalSellQty = sellOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);
  const totalSellValueUsd = sellOrders.reduce((sum, o) => sum + (o.valueUsd || 0), 0);
  const totalSellFeesUsd = sellOrders.reduce((sum, o) => sum + (o.feeUsd || 0), 0);

  const hasSellOrders = sellOrders.length > 0 && totalSellValueUsd > 0;
  const hasBuyOrders = buyOrders.length > 0 && totalBuyCostUsd > 0 && totalBuyQty > 0;

  // Guardrail: if sell orders detected but totalSellValueUsd is 0, warn
  if (sellOrders.length > 0 && totalSellValueUsd <= 0) {
    warnings.push("Sell orders detected but totalSellValueUsd is 0 - check order fields");
  }

  // PRIORITY 1: Calculate from orders when SELL orders exist
  if (hasSellOrders) {
    const isImported = isImportedOrManualCycle(cycle);
    let soldCostBasisUsd = 0;
    let calculatedPnlSource: IdcaCyclePnlResult["pnlSource"] = "orders";
    let importedOpeningLot: IdcaCyclePnlResult["importedOpeningLot"] = undefined;
    let costBasisMissing = false;

    // For imported/manual cycles, use FIFO calculation with imported opening lot
    if (isImported) {
      const importedLot = buildImportedOpeningLot(cycle, totalSellQty, totalBuyQty);
      if (importedLot.warning) {
        warnings.push(`Imported lot: ${importedLot.warning}`);
      }

      // Build cost lots for FIFO calculation
      interface CostLot {
        source: string;
        quantity: number;
        remainingQty: number;
        costUsd: number;
        avgPrice: number;
      }

      const lots: CostLot[] = [];

      // Add imported opening lot if valid
      if (importedLot.valid) {
        lots.push({
          source: "imported_opening",
          quantity: importedLot.quantity,
          remainingQty: importedLot.quantity,
          costUsd: importedLot.costUsd,
          avgPrice: importedLot.avgPrice,
        });
        importedOpeningLot = {
          quantity: importedLot.quantity,
          avgPrice: importedLot.avgPrice,
          costUsd: importedLot.costUsd,
          source: importedLot.source,
        };
      }

      // Add BUY orders as lots
      for (const buy of buyOrders) {
        const buyQty = buy.quantity || 0;
        const buyValue = buy.valueUsd || 0;
        const buyFee = buy.feeUsd || 0;
        const buyCost = buyValue + buyFee;
        lots.push({
          source: "buy_order",
          quantity: buyQty,
          remainingQty: buyQty,
          costUsd: buyCost,
          avgPrice: buyQty > 0 ? buyCost / buyQty : 0,
        });
      }

      // Consume lots FIFO for each SELL
      let totalSoldCostBasis = 0;
      const dustTolerance = pair.includes("BTC") ? 0.00001 : pair.includes("ETH") ? 0.0001 : 0.001;

      for (const sell of sellOrders) {
        let sellQtyRemaining = sell.quantity || 0;

        for (const lot of lots) {
          if (sellQtyRemaining <= 0) break;
          if (lot.remainingQty <= 0) continue;

          const consumeQty = Math.min(lot.remainingQty, sellQtyRemaining);
          totalSoldCostBasis += consumeQty * lot.avgPrice;
          lot.remainingQty -= consumeQty;
          sellQtyRemaining -= consumeQty;
        }

        // If we still have quantity to sell but no lots left, cost basis is missing
        if (sellQtyRemaining > dustTolerance) {
          costBasisMissing = true;
          warnings.push(`Missing cost basis for ${sellQtyRemaining.toFixed(6)} sold units (imported position not fully accounted)`);
        }
      }

      soldCostBasisUsd = totalSoldCostBasis;
      calculatedPnlSource = "orders";

      // Guardrail: if cost basis is missing for imported cycle, check for negative realizedPnlUsd fallback
      if (costBasisMissing) {
        const hasPersistedNegativePnl =
          status === "closed" &&
          isImported &&
          Number.isFinite(realizedPnlUsd) &&
          realizedPnlUsd < 0;

        if (hasPersistedNegativePnl) {
          warnings.push("Using negative realizedPnlUsd fallback for imported/manual cycle with incomplete order cost basis");
          return {
            capitalInvestedUsd: importedOpeningLot?.costUsd || capitalUsedUsd || 0,
            totalBuyQty: importedOpeningLot?.quantity || totalBuyQty || totalQuantity || 0,
            totalBuyCostUsd: importedOpeningLot?.costUsd || totalBuyCostUsd || capitalUsedUsd || 0,
            avgCostUsd: importedOpeningLot?.avgPrice || avgCostUsd || avgEntryPrice || 0,
            totalSellQty,
            totalSellValueUsd,
            soldCostBasisUsd: importedOpeningLot?.costUsd || capitalUsedUsd || 0,
            realizedGrossUsd: realizedPnlUsd,
            totalFeesUsd: totalSellFeesUsd,
            realizedNetUsd: realizedPnlUsd,
            realizedPnlPct: (importedOpeningLot?.costUsd || capitalUsedUsd) > 0 ? (realizedPnlUsd / (importedOpeningLot?.costUsd || capitalUsedUsd)) * 100 : 0,
            pnlSource: "cycle_realized_fallback",
            warnings,
            importedOpeningLot,
          };
        }

        warnings.push("Imported/manual cycle has missing cost basis - cannot calculate accurate PnL");
        return {
          capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
          totalBuyQty: totalBuyQty || totalQuantity,
          totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
          avgCostUsd: avgCostUsd || avgEntryPrice,
          totalSellQty,
          totalSellValueUsd,
          soldCostBasisUsd: 0,
          realizedGrossUsd: 0,
          totalFeesUsd: totalSellFeesUsd,
          realizedNetUsd: 0,
          realizedPnlPct: 0,
          pnlSource: "cost_basis_missing",
          warnings,
          importedOpeningLot,
        };
      }

      // Guardrail: implausible PnL for imported cycles (>50%)
      const realizedGrossUsd = totalSellValueUsd - soldCostBasisUsd;
      const realizedNetUsd = realizedGrossUsd - totalSellFeesUsd;
      const realizedPnlPct = soldCostBasisUsd > 0 ? (realizedNetUsd / soldCostBasisUsd) * 100 : 0;

      if (realizedPnlPct > 50) {
        warnings.push(`Imported/manual cycle PnL implausible (${realizedPnlPct.toFixed(2)}%) - missing opening cost basis`);
        return {
          capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
          totalBuyQty: totalBuyQty || totalQuantity,
          totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
          avgCostUsd: avgCostUsd || avgEntryPrice,
          totalSellQty,
          totalSellValueUsd,
          soldCostBasisUsd: 0,
          realizedGrossUsd: 0,
          totalFeesUsd: totalSellFeesUsd,
          realizedNetUsd: 0,
          realizedPnlPct: 0,
          pnlSource: "cost_basis_missing",
          warnings,
          importedOpeningLot,
        };
      }

      // Debug log for imported cycles
      console.debug(`[IDCA][PNL_HISTORY_CALC] cycleId=${cycle.id || 'unknown'} pair=${pair} isImported=true source=fifo_imported importedQty=${importedLot.quantity} importedAvg=${importedLot.avgPrice} importedCost=${importedLot.costUsd} buyQty=${totalBuyQty} buyCost=${totalBuyCostUsd} sellQty=${totalSellQty} sellValue=${totalSellValueUsd} soldCostBasis=${soldCostBasisUsd} realizedNet=${realizedNetUsd} pnlPct=${realizedPnlPct} warnings=${warnings.join(', ')}`);

      return {
        capitalInvestedUsd: totalBuyCostUsd + (importedOpeningLot?.costUsd || 0),
        totalBuyQty: totalBuyQty + (importedOpeningLot?.quantity || 0),
        totalBuyCostUsd: totalBuyCostUsd + (importedOpeningLot?.costUsd || 0),
        avgCostUsd: soldCostBasisUsd > 0 && totalSellQty > 0 ? soldCostBasisUsd / totalSellQty : avgCostUsd,
        totalSellQty,
        totalSellValueUsd,
        soldCostBasisUsd,
        realizedGrossUsd,
        totalFeesUsd: totalSellFeesUsd,
        realizedNetUsd,
        realizedPnlPct,
        pnlSource: calculatedPnlSource,
        warnings,
        importedOpeningLot,
      };
    }

    // Normal cycles (non-imported): use existing logic
    if (hasBuyOrders) {
      // Use BUY orders for cost basis
      soldCostBasisUsd = avgCostUsd * totalSellQty;
      calculatedPnlSource = "orders";

      // Dust tolerance
      if (totalSellQty > 0 && totalBuyQty > 0) {
        const diffQty = totalBuyQty - totalSellQty;
        const diffPct = (diffQty / totalBuyQty) * 100;
        const isBtc = pair.includes("BTC");
        const isEth = pair.includes("ETH");

        if (isBtc && diffQty <= 0.00001) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (BTC dust tolerance)");
        } else if (isEth && diffQty <= 0.0001) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (ETH dust tolerance)");
        } else if (diffPct <= 0.20) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (within 0.20% tolerance)");
        }
      }
    } else if (capitalUsedUsd > 0) {
      // Use capitalUsedUsd as cost basis (no BUY orders)
      soldCostBasisUsd = capitalUsedUsd;
      calculatedPnlSource = "orders_cycle_capital";
      warnings.push("Using capitalUsedUsd as cost basis (no BUY orders)");
    } else if (avgEntryPrice > 0 && totalSellQty > 0) {
      // Use avgEntryPrice as cost basis
      soldCostBasisUsd = avgEntryPrice * totalSellQty;
      calculatedPnlSource = "orders_avg_entry";
      warnings.push("Using avgEntryPrice as cost basis (no BUY orders or capitalUsedUsd)");
    } else {
      // Cannot calculate cost basis
      warnings.push("Cannot calculate cost basis from orders");
      return {
        capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
        totalBuyQty: totalBuyQty || totalQuantity,
        totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
        avgCostUsd: avgCostUsd || avgEntryPrice,
        totalSellQty,
        totalSellValueUsd,
        soldCostBasisUsd: 0,
        realizedGrossUsd: 0,
        totalFeesUsd: totalSellFeesUsd,
        realizedNetUsd: 0,
        realizedPnlPct: 0,
        pnlSource: "insufficient",
        warnings,
      };
    }

    const realizedGrossUsd = totalSellValueUsd - soldCostBasisUsd;
    const realizedNetUsd = realizedGrossUsd - totalSellFeesUsd;
    const realizedPnlPct = soldCostBasisUsd > 0 ? (realizedNetUsd / soldCostBasisUsd) * 100 : 0;

    // Debug log
    console.debug(`[IDCA][PNL_HISTORY_CALC] source=${calculatedPnlSource} buyQty=${totalBuyQty} buyCost=${totalBuyCostUsd} sellQty=${totalSellQty} sellValue=${totalSellValueUsd} soldCostBasis=${soldCostBasisUsd} realizedNet=${realizedNetUsd} pnlPct=${realizedPnlPct}`);

    return {
      capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
      totalBuyQty: totalBuyQty || totalQuantity,
      totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
      avgCostUsd: avgCostUsd || avgEntryPrice,
      totalSellQty,
      totalSellValueUsd,
      soldCostBasisUsd,
      realizedGrossUsd,
      totalFeesUsd: totalSellFeesUsd,
      realizedNetUsd,
      realizedPnlPct,
      pnlSource: calculatedPnlSource,
      warnings,
    };
  }

  // PRIORITY 2: Fallback to realizedPnlUsd (only if no orders sufficient)
  const isImported = isImportedOrManualCycle(cycle);
  const sellProceedsCheck = looksLikeSellProceeds(realizedPnlUsd, capitalUsedUsd, 0);

  // For imported/manual cycles with negative realizedPnlUsd, allow fallback
  if (status === "closed" && isImported && realizedPnlUsd < 0) {
    const realizedPnlPct = capitalUsedUsd > 0 ? (realizedPnlUsd / capitalUsedUsd) * 100 : 0;
    warnings.push(`Using realizedPnlUsd as fallback for imported cycle (negative): ${realizedPnlUsd}`);
    return {
      capitalInvestedUsd: capitalUsedUsd,
      totalBuyQty: totalQuantity,
      totalBuyCostUsd: capitalUsedUsd,
      avgCostUsd: capitalUsedUsd > 0 && totalQuantity > 0 ? capitalUsedUsd / totalQuantity : 0,
      totalSellQty: totalQuantity,
      totalSellValueUsd: capitalUsedUsd + realizedPnlUsd,
      soldCostBasisUsd: capitalUsedUsd,
      realizedGrossUsd: realizedPnlUsd,
      totalFeesUsd: 0,
      realizedNetUsd: realizedPnlUsd,
      realizedPnlPct,
      pnlSource: "cycle_realized_fallback",
      warnings,
    };
  }

  // For normal cycles, only use realizedPnlUsd if it's plausible as net profit
  if (status === "closed" && !sellProceedsCheck.isSellProceeds && realizedPnlUsd !== 0) {
    const realizedPnlPct = capitalUsedUsd > 0 ? (realizedPnlUsd / capitalUsedUsd) * 100 : 0;
    warnings.push(`Using realizedPnlUsd as fallback: ${sellProceedsCheck.reason}`);
    return {
      capitalInvestedUsd: capitalUsedUsd,
      totalBuyQty: totalQuantity,
      totalBuyCostUsd: capitalUsedUsd,
      avgCostUsd: capitalUsedUsd > 0 && totalQuantity > 0 ? capitalUsedUsd / totalQuantity : 0,
      totalSellQty: totalQuantity,
      totalSellValueUsd: capitalUsedUsd + realizedPnlUsd,
      soldCostBasisUsd: capitalUsedUsd,
      realizedGrossUsd: realizedPnlUsd,
      totalFeesUsd: 0,
      realizedNetUsd: realizedPnlUsd,
      realizedPnlPct,
      pnlSource: "cycle_realized",
      warnings,
    };
  }

  // PRIORITY 3: Insufficient data
  if (sellProceedsCheck.isSellProceeds) {
    warnings.push(`realizedPnlUsd looks like sell proceeds: ${sellProceedsCheck.reason}`);
  }
  warnings.push("Insufficient data to calculate PnL");
  return {
    capitalInvestedUsd: capitalUsedUsd,
    totalBuyQty: totalQuantity,
    totalBuyCostUsd: capitalUsedUsd,
    avgCostUsd: capitalUsedUsd > 0 && totalQuantity > 0 ? capitalUsedUsd / totalQuantity : 0,
    totalSellQty: 0,
    totalSellValueUsd: 0,
    soldCostBasisUsd: 0,
    realizedGrossUsd: 0,
    totalFeesUsd: 0,
    realizedNetUsd: 0,
    realizedPnlPct: 0,
    pnlSource: "insufficient",
    warnings,
  };
}
