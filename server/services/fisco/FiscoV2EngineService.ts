/**
 * FiscoV2EngineService — Motor FIFO V2 independiente.
 *
 * Calcula desde eventos V2 normalizados, NO desde fisco_disposals legacy.
 * - Crea lotes V2 con acquisition_value_eur (gross + fee integrado)
 * - Crea disposiciones V2 con transmission_value_eur (gross - fee integrado)
 * - Transferencias internas: arrastra coste, no genera ganancia/pérdida
 * - Rewards: crea lote con valor EUR fiscal
 * - Fee explícita: consume FIFO del activo usado para pagar
 * - Determinista: orden estable por executed_at, external_id, id
 *
 * Criterio comisiones: AEAT_INTEGRATED_TRACEABLE
 */

import type {
  V2Event,
  V2Lot,
  V2Disposal,
  V2EngineResult,
  V2Blocker,
  V2BlockerCode,
  V2TransferCarryover,
  FeeEvent,
  V2AuditEntry,
  FeeTreatment,
} from "./FiscoV2Types";
import { detectFeeDoubleCount } from "./FiscoV2Normalizer";

const FIFO_STABLES = new Set(["USDC", "USDT", "USDE", "DAI", "BUSD"]);
const FIAT_ASSETS = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);

function isFiat(a: string): boolean {
  return FIAT_ASSETS.has(a.toUpperCase());
}

export function runFifoV2(
  events: V2Event[],
  options?: {
    transferCarryovers?: V2TransferCarryover[];
    blockIfRewardWithoutPrice?: boolean;
    blockIfSellWithoutCostBasis?: boolean;
  }
): V2EngineResult {
  const lots: V2Lot[] = [];
  const disposals: V2Disposal[] = [];
  const feeEvents: FeeEvent[] = [];
  const blockers: V2Blocker[] = [];
  const warnings: string[] = [];
  const auditTrail: V2AuditEntry[] = [];
  const rewardEvents: V2Event[] = [];

  // Sort events deterministically: executed_at, external_id, source_operation_id
  const sortedEvents = [...events].sort((a, b) => {
    const timeDiff = a.executed_at.getTime() - b.executed_at.getTime();
    if (timeDiff !== 0) return timeDiff;
    if (a.external_id < b.external_id) return -1;
    if (a.external_id > b.external_id) return 1;
    return a.source_operation_id - b.source_operation_id;
  });

  // Track open lots by asset
  const openLotsByAsset = new Map<string, V2Lot[]>();
  const inventoryByAsset = new Map<string, number>();
  const assetsWithAnyBuy = new Set<string>();

  let lotCounter = 0;
  let disposalCounter = 0;

  const addBlocker = (
    code: V2BlockerCode,
    evt: V2Event,
    detail: string
  ) => {
    const evtYear = evt.executed_at.getFullYear();
    blockers.push({
      code,
      message: getBlockerMessage(code),
      asset: evt.asset,
      operation_id: evt.source_operation_id,
      external_id: evt.external_id,
      detail,
      executed_at: evt.executed_at.toISOString(),
      tax_year: evtYear,
      whether_affects_requested_year: false,
      whether_blocks_activation: false,
    });
  };

  // Check for fee double-counting
  const feeDoubleCountBlockers = detectFeeDoubleCount(sortedEvents);
  for (const b of feeDoubleCountBlockers) {
    const opId = parseInt(b.split("operation_")[1]);
    const evt = sortedEvents.find(e => e.source_operation_id === opId);
    if (evt) {
      addBlocker("FEE_DOUBLE_COUNT_RISK", evt,
        "La misma comisión parece estar computada más de una vez. Revise la operación antes de activar FISCO V2 oficial.");
    }
  }

  for (const evt of sortedEvents) {
    // Skip fiat events
    if (isFiat(evt.asset)) continue;

    // Skip events that require EUR price
    if (evt.fiscal_value_eur === null && evt.event_type !== "WITHDRAWAL" && evt.event_type !== "DEPOSIT") {
      if (evt.event_type === "REWARD" && options?.blockIfRewardWithoutPrice) {
        addBlocker("REWARD_PRICE_MISSING", evt,
          `Reward de ${evt.asset} sin precio EUR. No se puede valorar el ingreso.`);
      } else if (evt.event_type === "SELL" || evt.event_type === "SWAP") {
        addBlocker("REQUIRES_EUR_PRICE", evt,
          `${evt.event_type === "SELL" ? "Venta" : "Permuta"} de ${evt.asset} sin valor EUR disponible.`);
      }
      continue;
    }

    // ── BUY / DEPOSIT / REWARD: Create lot ──
    if (evt.event_type === "BUY" || evt.event_type === "DEPOSIT" || evt.event_type === "REWARD") {
      const grossAcquisition = evt.gross_value_eur ?? 0;
      const directFee = evt.direct_fee_eur;
      const acquisitionValue = evt.fiscal_value_eur ?? grossAcquisition;

      // Validate stablecoin cost basis
      if (FIFO_STABLES.has(evt.asset) && acquisitionValue > 0) {
        const unitCost = evt.quantity > 0 ? acquisitionValue / evt.quantity : 0;
        if (unitCost < 0.70 && evt.quantity > 0) {
          warnings.push(`Lote ${evt.asset} (${evt.exchange}/${evt.external_id}) con unit_cost_eur=${unitCost.toFixed(6)} — verificar total_eur.`);
        }
      }

      assetsWithAnyBuy.add(evt.asset);

      const lot: V2Lot = {
        v2_lot_id: `V2LOT-${++lotCounter}`,
        source_event_id: evt.event_id,
        source_operation_id: evt.source_operation_id,
        asset: evt.asset,
        quantity_acquired: evt.quantity,
        quantity_remaining: evt.quantity,
        gross_acquisition_eur: grossAcquisition,
        direct_fee_eur: directFee,
        acquisition_value_eur: acquisitionValue,
        fee_treatment: evt.fee_treatment,
        acquired_at: evt.executed_at,
        exchange: evt.exchange,
        transfer_link_id: evt.transfer_link_id,
      };

      lots.push(lot);
      const assetLots = openLotsByAsset.get(evt.asset) || [];
      assetLots.push(lot);
      openLotsByAsset.set(evt.asset, assetLots);
      inventoryByAsset.set(evt.asset, (inventoryByAsset.get(evt.asset) || 0) + evt.quantity);

      // Record fee event
      if (directFee > 0) {
        feeEvents.push({
          fee_id: `FEE-${evt.event_id}`,
          source_operation_id: evt.source_operation_id,
          fee_eur: directFee,
          fee_asset: evt.fee_asset,
          fee_quantity: evt.fee_quantity,
          fee_treatment: evt.fee_treatment,
          linked_operation_id: evt.source_operation_id,
          included_in_acquisition_value: evt.fee_treatment === "integrated_in_acquisition",
          included_in_transmission_value: false,
          creates_explicit_disposal: evt.fee_treatment === "explicit_fee_disposal",
          is_network_fee: evt.fee_treatment === "inventory_reduction",
          is_third_asset_fee: evt.fee_asset !== null && evt.fee_asset !== evt.asset,
          executed_at: evt.executed_at.toISOString(),
        });
      }

      if (evt.event_type === "REWARD") {
        rewardEvents.push(evt);
      }

      auditTrail.push({
        step: "create_lot",
        event_id: evt.event_id,
        action: `Created lot ${lot.v2_lot_id} for ${evt.quantity} ${evt.asset} at ${acquisitionValue.toFixed(2)} EUR`,
        detail: `fee_treatment=${evt.fee_treatment}, gross=${grossAcquisition.toFixed(2)}, fee=${directFee.toFixed(2)}`,
        timestamp: new Date().toISOString(),
      });
    }

    // ── SELL / SWAP: Consume lots FIFO ──
    else if (evt.event_type === "SELL" || evt.event_type === "SWAP") {
      const grossTransmission = evt.gross_value_eur ?? 0;
      const directFee = evt.direct_fee_eur;
      const transmissionValue = evt.fiscal_value_eur ?? grossTransmission;

      // Check inventory
      const currentInv = inventoryByAsset.get(evt.asset) || 0;
      if (currentInv <= 1e-10) {
        if (!assetsWithAnyBuy.has(evt.asset)) {
          addBlocker("SELL_WITHOUT_LOTS", evt,
            `Venta de ${evt.quantity.toFixed(8)} ${evt.asset} sin ninguna compra registrada previa. Saldo inicial o histórico incompleto.`);
        } else if (options?.blockIfSellWithoutCostBasis) {
          addBlocker("UNKNOWN_BASIS", evt,
            `Venta de ${evt.quantity.toFixed(8)} ${evt.asset} sin lotes abiertos (inventario: ${currentInv.toFixed(8)}).`);
        }
      }

      let remainingToSell = evt.quantity;
      const assetLots = openLotsByAsset.get(evt.asset) || [];
      const lotsConsumed: { v2_lot_id: string; quantity: number; cost_basis_eur: number }[] = [];

      let totalCostBasis = 0;
      let totalProceeds = 0;

      while (remainingToSell > 1e-10 && assetLots.length > 0) {
        const lot = assetLots[0];
        const consumed = Math.min(remainingToSell, lot.quantity_remaining);
        const proportion = lot.quantity_acquired > 0 ? consumed / lot.quantity_acquired : 0;
        const lotCostBasis = lot.acquisition_value_eur * proportion;
        const proceedsEur = (transmissionValue / evt.quantity) * consumed;

        const gainLoss = proceedsEur - lotCostBasis;

        const disposal: V2Disposal = {
          v2_disposal_id: `V2DISP-${++disposalCounter}`,
          source_event_id: evt.event_id,
          sell_operation_id: evt.source_operation_id,
          asset: evt.asset,
          quantity_disposed: consumed,
          gross_transmission_eur: (grossTransmission / evt.quantity) * consumed,
          direct_fee_eur: (directFee / evt.quantity) * consumed,
          transmission_value_eur: proceedsEur,
          cost_basis_eur: lotCostBasis,
          gain_loss_eur: gainLoss,
          fee_treatment: evt.fee_treatment,
          lots_consumed: [{ v2_lot_id: lot.v2_lot_id, quantity: consumed, cost_basis_eur: lotCostBasis }],
          executed_at: evt.executed_at,
          exchange: evt.exchange,
        };

        disposals.push(disposal);
        lotsConsumed.push({ v2_lot_id: lot.v2_lot_id, quantity: consumed, cost_basis_eur: lotCostBasis });

        lot.quantity_remaining -= consumed;
        remainingToSell -= consumed;
        totalCostBasis += lotCostBasis;
        totalProceeds += proceedsEur;

        if (lot.quantity_remaining < 1e-10) {
          lot.quantity_remaining = 0;
          assetLots.shift();
        }
      }

      // Update inventory
      const newInv = (inventoryByAsset.get(evt.asset) || 0) - evt.quantity;
      inventoryByAsset.set(evt.asset, newInv);

      if (remainingToSell > 1e-10) {
        addBlocker("UNKNOWN_BASIS", evt,
          `Vendido ${evt.quantity.toFixed(8)} ${evt.asset} pero solo había lotes para ${(evt.quantity - remainingToSell).toFixed(8)}. ` +
          `Faltan ${remainingToSell.toFixed(8)} sin base de coste.`);
      }

      if (newInv < -1e-8) {
        addBlocker("NEGATIVE_INVENTORY", evt,
          `Inventario negativo de ${evt.asset}: ${newInv.toFixed(8)} tras venta.`);
      }

      // Record fee event for sell
      if (directFee > 0) {
        feeEvents.push({
          fee_id: `FEE-${evt.event_id}`,
          source_operation_id: evt.source_operation_id,
          fee_eur: directFee,
          fee_asset: evt.fee_asset,
          fee_quantity: evt.fee_quantity,
          fee_treatment: evt.fee_treatment,
          linked_operation_id: evt.source_operation_id,
          included_in_acquisition_value: false,
          included_in_transmission_value: evt.fee_treatment === "integrated_in_transmission",
          creates_explicit_disposal: evt.fee_treatment === "explicit_fee_disposal",
          is_network_fee: false,
          is_third_asset_fee: evt.fee_asset !== null && evt.fee_asset !== evt.asset,
          executed_at: evt.executed_at.toISOString(),
        });
      }

      auditTrail.push({
        step: "create_disposal",
        event_id: evt.event_id,
        action: `Disposal of ${evt.quantity.toFixed(8)} ${evt.asset}, proceeds=${totalProceeds.toFixed(2)}, cost=${totalCostBasis.toFixed(2)}`,
        detail: `fee_treatment=${evt.fee_treatment}, lots_consumed=${lotsConsumed.length}`,
        timestamp: new Date().toISOString(),
      });
    }

    // ── WITHDRAWAL: Reduce inventory (transfer or fee) ──
    else if (evt.event_type === "WITHDRAWAL") {
      // Withdrawals to own wallets are transfers — reduce inventory but no gain/loss
      const newInv = (inventoryByAsset.get(evt.asset) || 0) - evt.quantity;
      inventoryByAsset.set(evt.asset, newInv);

      if (evt.direct_fee_eur > 0) {
        feeEvents.push({
          fee_id: `FEE-${evt.event_id}`,
          source_operation_id: evt.source_operation_id,
          fee_eur: evt.direct_fee_eur,
          fee_asset: evt.fee_asset,
          fee_quantity: evt.fee_quantity,
          fee_treatment: "inventory_reduction",
          linked_operation_id: evt.source_operation_id,
          included_in_acquisition_value: false,
          included_in_transmission_value: false,
          creates_explicit_disposal: false,
          is_network_fee: true,
          is_third_asset_fee: false,
          executed_at: evt.executed_at.toISOString(),
        });
      }

      if (newInv < -1e-8) {
        addBlocker("NEGATIVE_INVENTORY", evt,
          `Inventario negativo de ${evt.asset}: ${newInv.toFixed(8)} tras retirada.`);
      }

      auditTrail.push({
        step: "withdrawal",
        event_id: evt.event_id,
        action: `Withdrawal of ${evt.quantity.toFixed(8)} ${evt.asset}`,
        detail: `new_inventory=${newInv.toFixed(8)}`,
        timestamp: new Date().toISOString(),
      });
    }

    // ── TRANSFER_IN: Receive from own wallet ──
    else if (evt.event_type === "TRANSFER_IN") {
      // Transfer in from own wallet — create lot with carried cost basis
      // The cost basis should come from transfer carryover data
      const carryover = options?.transferCarryovers?.find(
        tc => tc.to_operation_id === evt.source_operation_id
      );
      const acquisitionValue = carryover?.cost_basis_carried_eur ?? evt.fiscal_value_eur ?? 0;

      const lot: V2Lot = {
        v2_lot_id: `V2LOT-${++lotCounter}`,
        source_event_id: evt.event_id,
        source_operation_id: evt.source_operation_id,
        asset: evt.asset,
        quantity_acquired: evt.quantity,
        quantity_remaining: evt.quantity,
        gross_acquisition_eur: acquisitionValue,
        direct_fee_eur: 0,
        acquisition_value_eur: acquisitionValue,
        fee_treatment: "inventory_reduction",
        acquired_at: evt.executed_at,
        exchange: evt.exchange,
        transfer_link_id: evt.transfer_link_id,
      };

      lots.push(lot);
      const assetLots = openLotsByAsset.get(evt.asset) || [];
      assetLots.push(lot);
      openLotsByAsset.set(evt.asset, assetLots);
      inventoryByAsset.set(evt.asset, (inventoryByAsset.get(evt.asset) || 0) + evt.quantity);

      auditTrail.push({
        step: "transfer_in",
        event_id: evt.event_id,
        action: `Transfer in of ${evt.quantity.toFixed(8)} ${evt.asset}, cost_basis=${acquisitionValue.toFixed(2)}`,
        detail: carryover ? `carryover from op ${carryover.from_operation_id}` : "no carryover data",
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Check for unresolved transfer carryovers
  if (options?.transferCarryovers) {
    for (const tc of options.transferCarryovers) {
      if (tc.cost_basis_carried_eur === 0 && tc.amount_sent > 0) {
        const evt = sortedEvents.find(e => e.source_operation_id === tc.from_operation_id);
        if (evt) {
          const evtYear = evt.executed_at.getFullYear();
          blockers.push({
            code: "TRANSFER_COST_CARRYOVER_UNRESOLVED",
            message: getBlockerMessage("TRANSFER_COST_CARRYOVER_UNRESOLVED"),
            asset: tc.asset,
            operation_id: tc.from_operation_id,
            external_id: evt.external_id,
            detail: `Transferencia de ${tc.asset} sin arrastre de coste resuelto entre op ${tc.from_operation_id} y op ${tc.to_operation_id}.`,
            executed_at: evt.executed_at.toISOString(),
            tax_year: evtYear,
            whether_affects_requested_year: false,
            whether_blocks_activation: false,
          });
        }
      }
    }
  }

  const isSafeForOfficial = blockers.length === 0;

  return {
    lots,
    disposals,
    fee_events: feeEvents,
    transfer_carryovers: options?.transferCarryovers ?? [],
    reward_events: rewardEvents,
    blockers,
    warnings,
    audit_trail: auditTrail,
    is_safe_for_official: isSafeForOfficial,
  };
}

function getBlockerMessage(code: V2BlockerCode): string {
  const messages: Record<V2BlockerCode, string> = {
    FEE_DOUBLE_COUNT_RISK: "La misma comisión parece estar computada más de una vez. Revise la operación antes de activar FISCO V2 oficial.",
    FEE_EUR_PRICE_MISSING: "Falta precio EUR para valorar una comisión. No se puede completar el cálculo fiscal.",
    THIRD_ASSET_FEE_REVIEW_REQUIRED: "Comisión pagada con un activo distinto requiere revisión manual de trazabilidad.",
    TRANSFER_COST_CARRYOVER_UNRESOLVED: "Transferencia interna con arrastre de coste no resuelto.",
    REWARD_PRICE_MISSING: "Reward sin precio EUR. No se puede valorar el ingreso.",
    SELL_WITHOUT_LOTS: "Venta sin lotes de adquisición previos.",
    NEGATIVE_INVENTORY: "Inventario negativo tras operación.",
    UNKNOWN_BASIS: "Base de coste desconocida para parte de la venta.",
    REQUIRES_EUR_PRICE: "Operación requiere precio EUR manual.",
    HISTORICAL_DATA_GAP: "Faltan datos históricos previos al año fiscal para calcular FIFO correctamente.",
  };
  return messages[code] ?? code;
}

// ============================================================
// Summary helpers
// ============================================================

/**
 * Summarize V2 result, optionally filtering disposals to a specific fiscal year.
 * When year is provided, only disposals with executed_at in [year-01-01, year+1-01-01) are summed.
 * This is essential for historical processing: the engine processes ALL events but
 * we only report disposals belonging to the requested fiscal year.
 */
export function summarizeV2Result(result: V2EngineResult, year?: number) {
  const yearDisposals = year
    ? result.disposals.filter(d => {
        const y = d.executed_at.getFullYear();
        return y === year;
      })
    : result.disposals;

  const gains = yearDisposals
    .filter(d => d.gain_loss_eur > 0)
    .reduce((sum, d) => sum + d.gain_loss_eur, 0);
  const losses = Math.abs(
    yearDisposals
      .filter(d => d.gain_loss_eur < 0)
      .reduce((sum, d) => sum + d.gain_loss_eur, 0)
  );
  const net = gains - losses;

  const byAsset = new Map<string, { gain_loss: number; proceeds: number; cost_basis: number; count: number }>();
  for (const d of yearDisposals) {
    const existing = byAsset.get(d.asset) ?? { gain_loss: 0, proceeds: 0, cost_basis: 0, count: 0 };
    existing.gain_loss += d.gain_loss_eur;
    existing.proceeds += d.transmission_value_eur;
    existing.cost_basis += d.cost_basis_eur;
    existing.count += 1;
    byAsset.set(d.asset, existing);
  }

  return {
    net_gain_loss_eur: net,
    gains_eur: gains,
    losses_eur: losses,
    disposals_count: yearDisposals.length,
    by_asset: Object.fromEntries(byAsset),
  };
}

/**
 * Build fee treatment summary, optionally filtering to a specific fiscal year.
 * When year is provided, only fee_events with executed_at in year Y are summed.
 * This is essential for historical processing: the engine processes ALL events but
 * we only report fees belonging to the requested fiscal year.
 */
export function buildFeeTreatmentSummary(result: V2EngineResult, year?: number) {
  const yearFees = year
    ? result.fee_events.filter(fe => {
        const y = new Date(fe.executed_at).getFullYear();
        return y === year;
      })
    : result.fee_events;

  const summary = {
    integrated_in_acquisition: { count: 0, total_eur: 0 },
    integrated_in_transmission: { count: 0, total_eur: 0 },
    inventory_reduction: { count: 0, total_eur: 0 },
    explicit_fee_disposal: { count: 0, total_eur: 0 },
  };

  for (const fe of yearFees) {
    summary[fe.fee_treatment].count += 1;
    summary[fe.fee_treatment].total_eur += fe.fee_eur;
  }

  return summary;
}

/**
 * Extract opening lots at year start: lots acquired before 01/01/Y
 * with quantity_remaining > 0 AT THE POINT BEFORE year Y events are processed.
 * This represents the inventory carried into year Y from previous years.
 *
 * Since the engine processes all events chronologically, we need to reconstruct
 * the lot state at the start of year Y. We do this by checking which lots
 * were acquired before year start and had not been fully consumed by
 * disposals before year start.
 */
export function extractOpeningLots(result: V2EngineResult, year: number) {
  const yearStart = new Date(year, 0, 1);

  // For each lot acquired before year start, calculate how much was consumed
  // by disposals that also occurred before year start.
  const consumptionBeforeYear = new Map<string, number>();
  for (const disposal of result.disposals) {
    if (disposal.executed_at < yearStart) {
      for (const consumed of disposal.lots_consumed) {
        const current = consumptionBeforeYear.get(consumed.v2_lot_id) ?? 0;
        consumptionBeforeYear.set(consumed.v2_lot_id, current + consumed.quantity);
      }
    }
  }

  return result.lots
    .filter(lot => lot.acquired_at < yearStart)
    .map(lot => {
      const consumed = consumptionBeforeYear.get(lot.v2_lot_id) ?? 0;
      const remainingAtYearStart = lot.quantity_acquired - consumed;
      if (remainingAtYearStart <= 1e-10) return null;
      return {
        asset: lot.asset,
        quantity_remaining: remainingAtYearStart,
        acquisition_value_eur: lot.acquisition_value_eur * (remainingAtYearStart / lot.quantity_acquired),
        acquired_at: lot.acquired_at.toISOString(),
        source: lot.exchange,
      };
    })
    .filter((lot): lot is NonNullable<typeof lot> => lot !== null);
}

/**
 * Extract closing lots at year end: lots with quantity_remaining > 0
 * after ALL events (including year Y) have been processed.
 * This represents the inventory at the end of year Y.
 */
export function extractClosingLots(result: V2EngineResult, year: number) {
  const yearEnd = new Date(year + 1, 0, 1);
  return result.lots
    .filter(lot => lot.quantity_remaining > 1e-10 && lot.acquired_at < yearEnd)
    .map(lot => ({
      asset: lot.asset,
      quantity_remaining: lot.quantity_remaining,
      acquisition_value_eur: lot.acquisition_value_eur * (lot.quantity_remaining / lot.quantity_acquired),
      acquired_at: lot.acquired_at.toISOString(),
      source: lot.exchange,
    }));
}

/**
 * Filter blockers to those relevant for a specific fiscal year.
 * Returns { yearBlockers, historicalBlockers } where yearBlockers are those
 * whose operation occurred in the requested year, and historicalBlockers
 * are those from previous years (diagnostic only, should not block activation).
 */
export function filterBlockersByYear(result: V2EngineResult, year: number) {
  const yearBlockers: V2Blocker[] = [];
  const historicalBlockers: V2Blocker[] = [];

  for (const b of result.blockers) {
    const blockerYear = b.tax_year;
    const affectsYear = blockerYear === year;
    const enriched = {
      ...b,
      whether_affects_requested_year: affectsYear,
      whether_blocks_activation: affectsYear,
    };
    if (affectsYear) {
      yearBlockers.push(enriched);
    } else {
      historicalBlockers.push(enriched);
    }
  }

  return { yearBlockers, historicalBlockers };
}
