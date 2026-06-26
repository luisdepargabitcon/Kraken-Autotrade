/**
 * FiscoV2Normalizer — Convierte operaciones de fisco_operations en eventos V2
 * con tratamiento de comisiones AEAT (integrado y trazado).
 *
 * Reglas:
 * - Compra: fee_treatment = integrated_in_acquisition, fiscal_value = gross + fee
 * - Venta: fee_treatment = integrated_in_transmission, fiscal_value = gross - fee
 * - Deposit/Withdrawal: fee_treatment = inventory_reduction (fee reduce saldo)
 * - Staking/Reward: sin fee directo, fiscal_value = valor EUR
 * - Conversion (crypto/crypto): genera SELL del entregado + BUY del recibido
 */

import type { V2Event, V2EventType, FeeTreatment, FeeMode } from "./FiscoV2Types";

interface DbOperation {
  id: number;
  exchange: string;
  external_id: string;
  op_type: string;
  asset: string;
  amount: string;
  price_eur: string | null;
  total_eur: string | null;
  fee_eur: string | null;
  counter_asset: string | null;
  pair: string | null;
  executed_at: Date;
  raw_data: any;
}

const FIAT_ASSETS = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);
const CRYPTO_STABLES = new Set(["USDC", "USDT", "USDE", "DAI", "BUSD"]);

function isFiat(a: string): boolean {
  return FIAT_ASSETS.has(a.toUpperCase());
}

function isCrypto(a: string): boolean {
  return !isFiat(a) && !CRYPTO_STABLES.has(a.toUpperCase());
}

function determineFeeTreatment(
  opType: string,
  feeAsset: string | null,
  opAsset: string,
  feeMode: FeeMode
): FeeTreatment {
  // No fee or fee in fiat → integrated
  if (feeMode === "AEAT_INTEGRATED_TRACEABLE") {
    if (opType === "trade_buy") return "integrated_in_acquisition";
    if (opType === "trade_sell") return "integrated_in_transmission";
    if (opType === "deposit" || opType === "withdrawal") return "inventory_reduction";
    if (opType === "conversion") return "integrated_in_acquisition";
    if (opType === "staking") return "inventory_reduction";
  }
  // EXPLICIT_DISPOSAL mode: if fee is paid in a different crypto, it's explicit
  if (feeAsset && isCrypto(feeAsset) && feeAsset !== opAsset) {
    return "explicit_fee_disposal";
  }
  if (opType === "trade_buy") return "integrated_in_acquisition";
  if (opType === "trade_sell") return "integrated_in_transmission";
  return "inventory_reduction";
}

function mapEventType(opType: string): V2EventType {
  switch (opType) {
    case "trade_buy": return "BUY";
    case "trade_sell": return "SELL";
    case "conversion": return "SWAP";
    case "deposit": return "DEPOSIT";
    case "withdrawal": return "WITHDRAWAL";
    case "staking": return "REWARD";
    default: return "DEPOSIT";
  }
}

export function normalizeToV2Events(
  operations: DbOperation[],
  feeMode: FeeMode = "AEAT_INTEGRATED_TRACEABLE"
): V2Event[] {
  const events: V2Event[] = [];

  for (const op of operations) {
    const amount = parseFloat(op.amount);
    const priceEur = op.price_eur ? parseFloat(op.price_eur) : null;
    const totalEur = op.total_eur ? parseFloat(op.total_eur) : null;
    const feeEur = op.fee_eur ? parseFloat(op.fee_eur) : 0;

    const grossValueEur = totalEur ?? (priceEur !== null ? amount * priceEur : null);

    // Determine fee treatment
    const feeTreatment = determineFeeTreatment(
      op.op_type,
      op.counter_asset ?? null,
      op.asset,
      feeMode
    );

    // Calculate fiscal value based on fee treatment
    let fiscalValueEur: number | null = grossValueEur;
    if (grossValueEur !== null) {
      if (feeTreatment === "integrated_in_acquisition") {
        fiscalValueEur = grossValueEur + feeEur;
      } else if (feeTreatment === "integrated_in_transmission") {
        fiscalValueEur = grossValueEur - feeEur;
      }
      // inventory_reduction and explicit_fee_disposal: fiscal_value = gross_value
    }

    const eventType = mapEventType(op.op_type);

    // Check if needs manual review
    const needsManualReview = grossValueEur === null && isCrypto(op.asset);
    const blockers: string[] = [];
    if (needsManualReview) {
      blockers.push("REQUIRES_EUR_PRICE");
    }

    const event: V2Event = {
      event_id: `EVT-${op.id}`,
      source_operation_id: op.id,
      exchange: op.exchange,
      event_type: eventType,
      asset: op.asset,
      quantity: amount,
      counter_asset: op.counter_asset,
      gross_value_eur: grossValueEur,
      direct_fee_eur: feeEur,
      fee_asset: null, // fisco_operations does not have fee_asset column
      fee_quantity: 0,
      fee_treatment: feeTreatment,
      fiscal_value_eur: fiscalValueEur,
      executed_at: op.executed_at,
      external_id: op.external_id,
      pair: op.pair,
      needs_manual_review: needsManualReview,
      blockers,
      transfer_link_id: null,
    };

    events.push(event);

    // For conversions (crypto/crypto), generate a complementary BUY event
    // for the counter_asset if it's a crypto
    if (op.op_type === "conversion" && op.counter_asset && isCrypto(op.counter_asset)) {
      const counterGrossEur = grossValueEur; // Same EUR value for both sides
      const counterEvent: V2Event = {
        event_id: `EVT-${op.id}-COUNTER`,
        source_operation_id: op.id,
        exchange: op.exchange,
        event_type: "BUY",
        asset: op.counter_asset,
        quantity: 0, // Counter amount not stored in fisco_operations
        counter_asset: op.asset,
        gross_value_eur: counterGrossEur,
        direct_fee_eur: 0, // Fee already assigned to the SELL side
        fee_asset: null,
        fee_quantity: 0,
        fee_treatment: "integrated_in_acquisition",
        fiscal_value_eur: counterGrossEur,
        executed_at: op.executed_at,
        external_id: `${op.external_id}-COUNTER`,
        pair: op.pair,
        needs_manual_review: counterGrossEur === null,
        blockers: counterGrossEur === null ? ["REQUIRES_EUR_PRICE"] : [],
        transfer_link_id: null,
      };
      events.push(counterEvent);
    }
  }

  return events;
}

/**
 * Detect potential fee double-counting.
 * Returns blockers if the same fee appears to be counted multiple times.
 */
export function detectFeeDoubleCount(events: V2Event[]): string[] {
  const blockers: string[] = [];
  const feeByOperation = new Map<number, number>();

  for (const evt of events) {
    const opId = evt.source_operation_id;
    const current = feeByOperation.get(opId) ?? 0;
    feeByOperation.set(opId, current + evt.direct_fee_eur);
  }

  // If an operation has fee events that sum to more than the original fee,
  // it might indicate double-counting
  // This is a heuristic — the normalizer assigns fee to one side only
  for (const [opId, totalFee] of feeByOperation.entries()) {
    if (totalFee > 0) {
      // Check if multiple events for same op all have fees
      const opEvents = events.filter(e => e.source_operation_id === opId && e.direct_fee_eur > 0);
      if (opEvents.length > 1) {
        blockers.push(`FEE_DOUBLE_COUNT_RISK:operation_${opId}`);
      }
    }
  }

  return blockers;
}
