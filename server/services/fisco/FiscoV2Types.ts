/**
 * FISCO V2 Types — Eventos normalizados V2, tratamiento de comisiones AEAT,
 * lotes y disposiciones V2 independientes del motor legacy.
 *
 * Criterio fiscal de comisiones: AEAT_INTEGRATED_TRACEABLE
 * - Compra: comisión integra al valor de adquisición (suma)
 * - Venta: comisión integra al valor de transmisión (resta)
 * - Comisión en columna informativa, sin duplicar cálculo
 */

// ============================================================
// Fee Treatment (criterio AEAT)
// ============================================================

export type FeeTreatment =
  | "integrated_in_acquisition"   // Compra: fee suma al coste del lote
  | "integrated_in_transmission"  // Venta: fee resta del valor de transmisión
  | "inventory_reduction"         // Fee de red/transferencia: reduce inventario
  | "explicit_fee_disposal";      // Fee pagada con cripto distinta: consume FIFO

export type FeeMode = "AEAT_INTEGRATED_TRACEABLE" | "EXPLICIT_DISPOSAL";

export interface FeeEvent {
  fee_id: string;
  source_operation_id: number;
  fee_eur: number;
  fee_asset: string | null;
  fee_quantity: number;
  fee_treatment: FeeTreatment;
  linked_operation_id: number | null;
  included_in_acquisition_value: boolean;
  included_in_transmission_value: boolean;
  creates_explicit_disposal: boolean;
  is_network_fee: boolean;
  is_third_asset_fee: boolean;
  executed_at: string;
}

// ============================================================
// V2 Normalized Event
// ============================================================

export type V2EventType =
  | "BUY"
  | "SELL"
  | "SWAP"
  | "FEE"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "REWARD";

export interface V2Event {
  event_id: string;
  source_operation_id: number;
  exchange: string;
  event_type: V2EventType;
  asset: string;
  quantity: number;
  counter_asset: string | null;
  gross_value_eur: number | null;
  direct_fee_eur: number;
  fee_asset: string | null;
  fee_quantity: number;
  fee_treatment: FeeTreatment;
  fiscal_value_eur: number | null;
  executed_at: Date;
  external_id: string;
  pair: string | null;
  needs_manual_review: boolean;
  blockers: string[];
  transfer_link_id: number | null;
}

// ============================================================
// V2 FIFO Lot
// ============================================================

export interface V2Lot {
  v2_lot_id: string;
  source_event_id: string;
  source_operation_id: number;
  asset: string;
  quantity_acquired: number;
  quantity_remaining: number;
  gross_acquisition_eur: number;
  direct_fee_eur: number;
  acquisition_value_eur: number;
  fee_treatment: FeeTreatment;
  acquired_at: Date;
  exchange: string;
  transfer_link_id: number | null;
}

// ============================================================
// V2 Disposal
// ============================================================

export interface V2Disposal {
  v2_disposal_id: string;
  source_event_id: string;
  sell_operation_id: number;
  asset: string;
  quantity_disposed: number;
  gross_transmission_eur: number;
  direct_fee_eur: number;
  transmission_value_eur: number;
  cost_basis_eur: number;
  gain_loss_eur: number;
  fee_treatment: FeeTreatment;
  lots_consumed: { v2_lot_id: string; quantity: number; cost_basis_eur: number }[];
  executed_at: Date;
  exchange: string;
}

// ============================================================
// V2 Transfer Carryover
// ============================================================

export interface V2TransferCarryover {
  from_operation_id: number;
  to_operation_id: number;
  asset: string;
  amount_sent: number;
  amount_received: number;
  fee_amount: number;
  fee_asset: string | null;
  confidence: number;
  match_reason: string;
  source_lot_ids: string[];
  target_lot_ids: string[];
  cost_basis_carried_eur: number;
  taxable: boolean;
  fee_treatment: FeeTreatment;
}

// ============================================================
// V2 Engine Result
// ============================================================

export interface V2EngineResult {
  lots: V2Lot[];
  disposals: V2Disposal[];
  fee_events: FeeEvent[];
  transfer_carryovers: V2TransferCarryover[];
  reward_events: V2Event[];
  blockers: V2Blocker[];
  warnings: string[];
  audit_trail: V2AuditEntry[];
  is_safe_for_official: boolean;
}

export type V2BlockerCode =
  | "FEE_DOUBLE_COUNT_RISK"
  | "FEE_EUR_PRICE_MISSING"
  | "THIRD_ASSET_FEE_REVIEW_REQUIRED"
  | "TRANSFER_COST_CARRYOVER_UNRESOLVED"
  | "REWARD_PRICE_MISSING"
  | "SELL_WITHOUT_LOTS"
  | "NEGATIVE_INVENTORY"
  | "UNKNOWN_BASIS"
  | "REQUIRES_EUR_PRICE"
  | "HISTORICAL_DATA_GAP";

export interface V2Blocker {
  code: V2BlockerCode;
  message: string;
  asset: string;
  operation_id: number;
  external_id: string;
  detail: string;
  executed_at: string;
  tax_year: number;
  whether_affects_requested_year: boolean;
  whether_blocks_activation: boolean;
}

export interface V2AuditEntry {
  step: string;
  event_id: string;
  action: string;
  detail: string;
  timestamp: string;
}

// ============================================================
// V2 Historical Scope & Opening Lots
// ============================================================

export interface V2HistoricalScope {
  year: number;
  operations_from: string;
  operations_to: string;
  total_operations_loaded: number;
  operations_before_year: number;
  operations_in_year: number;
  opening_balances_loaded: number;
  has_historical_data: boolean;
}

export interface V2OpeningLot {
  asset: string;
  quantity_remaining: number;
  acquisition_value_eur: number;
  acquired_at: string;
  source: string;
}

// ============================================================
// V2 Comparison Result (extended)
// ============================================================

export interface V2ComparisonResult {
  year: number;
  baseline: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: string;
  };
  v2: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: string;
    is_full_v2_engine: boolean;
    limitations: string[];
  };
  diff_eur: number;
  gross_gains_diff_eur: number;
  gross_losses_diff_eur: number;
  disposals_count_diff: number;
  safe_for_official_switch: boolean;
  official_switch_blockers: string[];
  gross_diff_detail: Record<string, number> | null;
  operation_mapping: OperationMapping[];
  unmapped_legacy_disposals: number[];
  unmapped_v2_disposals: number[];
  asset_diffs: AssetDiffV2[];
  fee_diff_detail: FeeDiffDetail | null;
  fee_treatment_summary: FeeTreatmentSummary;
  blockers: string[];
  warnings: string[];
  v2_historical_scope: V2HistoricalScope;
  opening_lots: V2OpeningLot[];
  closing_lots: V2OpeningLot[];
  historical_blockers: string[];
  historical_warnings: string[];
  generated_at: string;
}

export interface OperationMapping {
  legacy_disposal_id: number;
  v2_disposal_id: string;
  sell_operation_id: number;
  asset: string;
  legacy_gain_loss_eur: number;
  v2_gain_loss_eur: number;
  diff_eur: number;
}

export interface AssetDiffV2 {
  asset: string;
  baseline_gain_loss_eur: number;
  v2_gain_loss_eur: number;
  diff_eur: number;
  baseline_disposals_count: number;
  v2_disposals_count: number;
  baseline_proceeds_eur: number;
  v2_proceeds_eur: number;
  baseline_cost_basis_eur: number;
  v2_cost_basis_eur: number;
}

export interface FeeDiffDetail {
  legacy_total_fees_eur: number;
  v2_total_fees_eur: number;
  fee_diff_total_eur: number;
  by_treatment: Record<FeeTreatment, { count: number; total_eur: number }>;
  trading: {
    legacy_total_fees_eur: number;
    v2_total_fees_eur: number;
    diff_eur: number;
    blocks_activation: boolean;
  };
  inventory_reduction: {
    v2_total_eur: number;
    count: number;
    blocks_activation: boolean;
    explanation_es: string;
  };
  explicit_fee_disposal: {
    v2_total_eur: number;
    count: number;
    blocks_activation: boolean;
  };
}

export interface FeeTreatmentSummary {
  integrated_in_acquisition: { count: number; total_eur: number };
  integrated_in_transmission: { count: number; total_eur: number };
  inventory_reduction: { count: number; total_eur: number };
  explicit_fee_disposal: { count: number; total_eur: number };
}

// ============================================================
// Activation / Rollback
// ============================================================

export interface V2ActivationRequest {
  year: number;
  confirm: boolean;
  expected_operation_set_hash: string;
  expected_v2_net_gain_loss_eur: number;
  expected_v2_rounded_eur: number;
}

export interface V2ActivationResult {
  activated: boolean;
  year: number;
  engine: string;
  backup_id: string;
  rollback_available: boolean;
  audit_log_id: string;
}

export interface V2RollbackRequest {
  year: number;
  backup_id: string;
  confirm: boolean;
}

export interface V2RollbackResult {
  rolled_back: boolean;
  year: number;
  engine: string;
  backup_id: string;
}

export interface V2AuditLog {
  id: string;
  action: "activate" | "rollback" | "controlled_commit";
  year: number;
  timestamp: string;
  operation_set_hash: string | null;
  legacy_result: Record<string, any>;
  v2_result: Record<string, any>;
  differences: Record<string, any>;
  fee_treatment_summary: FeeTreatmentSummary | null;
  backup_id: string | null;
  details: Record<string, any>;
}
