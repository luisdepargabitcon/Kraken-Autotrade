// ─── Shared FISCO types (extracted from Fisco.tsx for component reuse) ────────

export type SnapshotStatus =
  | "OK"
  | "DUST"
  | "NEGATIVE"
  | "NO_DATA"
  | "NEEDS_REVIEW"
  | "DIFF_EXPLAINED";

export interface InventorySnapshotRow {
  asset: string;
  exchanges: string[];
  openingQty: number;
  acquiredQtyInYear: number;
  disposedQtyInYear: number;
  closingQtyAsOfYearEnd: number;
  closingCostBasisEurAsOfYearEnd: number;
  closingUnitCostEurAsOfYearEnd: number;
  currentRemainingQty: number;
  currentVsYearEndDiff: number;
  proceedsEurInYear: number;
  costBasisUsedEurInYear: number;
  gainLossEurInYear: number;
  status: SnapshotStatus;
  hasPostYearOps: boolean;
  warnings: string[];
}

export interface BalanceCheckIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  code: string;
  asset: string;
  detail: string;
  estimatedImpactEur?: number;
}

export interface BalanceCheckResult {
  year: number;
  checkedAt: string;
  overallStatus: "OK" | "WARNINGS" | "CRITICAL";
  issues: BalanceCheckIssue[];
  rewards_without_price: Array<{ asset: string; count: number; total_amount: number }>;
  deposits_without_cost: Array<{ asset: string; exchange: string; count: number; total_amount: number }>;
  suspected_duplicate_transfers: Array<{
    asset: string;
    from_exchange: string;
    to_exchange: string | null;
    detail: string;
    classification: "INTERNAL_TRANSFER_CANDIDATE" | "EXTERNAL_WITHDRAWAL_REVIEW";
    has_compatible_deposit: boolean;
  }>;
  crypto_fees_unaccounted: Array<{ asset: string; total_fee_amount: number; note: string }>;
  dust_positions: Array<{ asset: string; closing_qty: number; threshold: number }>;
  sells_without_cost_basis: Array<{ asset: string; count: number; total_proceeds_eur: number }>;
}

export interface InventorySnapshotResult {
  year: number;
  generatedAt: string;
  rows: InventorySnapshotRow[];
  balanceCheck: BalanceCheckResult;
  summary: {
    totalAssets: number;
    okAssets: number;
    dustAssets: number;
    negativeAssets: number;
    needsReviewAssets: number;
    totalClosingValueEur: number;
    totalGainLossEurInYear: number;
  };
}

export interface TransferLink {
  id: number;
  asset: string;
  from_exchange: string;
  to_exchange: string | null;
  amount_sent: string;
  amount_received: string | null;
  fee_amount: string | null;
  fee_asset: string | null;
  network: string | null;
  tx_hash: string | null;
  confidence: "high" | "medium" | "low";
  status: string;
  match_reason: string | null;
  matched_at: string | null;
  created_at: string;
  from_executed_at: string | null;
  from_external_id: string | null;
  to_executed_at: string | null;
  to_exchange_confirmed: string | null;
}

export interface TransferLinksResult {
  year: number;
  count: number;
  links: TransferLink[];
}

export interface ImportPreviewRow {
  row_number: number;
  exchange: string;
  raw_type: string;
  normalized_type: string | null;
  buy_amount: number | null;
  buy_asset: string | null;
  sell_amount: number | null;
  sell_asset: string | null;
  fee_amount: number | null;
  fee_asset: string | null;
  executed_at: string | null;
  external_id: string | null;
  status: "ok" | "warning" | "error" | "duplicate" | "skipped";
  message: string | null;
}

export interface ImportPreviewResult {
  import_batch_id: string;
  exchange: string;
  year: number;
  fiscal_year_detected: number;
  raw_rows: number;
  parsed_rows: number;
  normalized_rows: number;
  skipped_rows: number;
  duplicate_rows: number;
  warning_rows: number;
  error_rows: number;
  total_rows: number;
  normalized: number;
  duplicates: number;
  skipped: number;
  date_errors: number;
  value_warnings: number;
  errors: number;
  rows: ImportPreviewRow[];
  dry_run: boolean;
  warnings: string[];
}

export interface FiscoV2ComparisonResult {
  year: number;
  baseline: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: "legacy";
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
  diff_pct: number | null;
  gross_gains_diff_eur: number;
  gross_losses_diff_eur: number;
  disposals_count_diff: number;
  by_asset: Array<{
    asset: string;
    baseline_gain_loss_eur: number;
    v2_gain_loss_eur: number;
    diff_eur: number;
    cause: string;
    explanation: string;
  }>;
  blockers: string[];
  warnings: string[];
  official_switch_blockers: string[];
  is_safe_for_report: boolean;
  is_safe_for_shadow_report: boolean;
  safe_for_official_switch: boolean;
  comparison_quality: {
    baseline_valid: boolean;
    v2_valid: boolean;
    diff_valid: boolean;
    numeric_fields_valid: boolean;
  };
  gross_diff_detail: Record<string, number> | null;
  operation_mapping: Array<{
    legacy_disposal_id: number;
    v2_disposal_id: string;
    sell_operation_id: number;
    asset: string;
    legacy_gain_loss_eur: number;
    v2_gain_loss_eur: number;
    diff_eur: number;
  }>;
  unmapped_legacy_disposals: number[];
  unmapped_v2_disposals: string[];
  asset_diffs: Array<{
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
  }>;
  fee_diff_detail: {
    legacy_total_fees_eur: number;
    v2_total_fees_eur: number;
    fee_diff_total_eur: number;
    by_treatment: {
      integrated_in_acquisition: { count: number; total_eur: number };
      integrated_in_transmission: { count: number; total_eur: number };
      inventory_reduction: { count: number; total_eur: number };
      explicit_fee_disposal: { count: number; total_eur: number };
    };
  } | null;
  fee_treatment_summary: {
    integrated_in_acquisition: { count: number; total_eur: number };
    integrated_in_transmission: { count: number; total_eur: number };
    inventory_reduction: { count: number; total_eur: number };
    explicit_fee_disposal: { count: number; total_eur: number };
  };
  generated_at: string;
}

export const ISSUE_ACTIONS: Record<string, string> = {
  EXTERNAL_WITHDRAWAL_REVIEW:   "Revisar destino de retirada",
  UNLINKED_WITHDRAWAL:          "Revisar depósito compatible y crear transfer_link si procede",
  INTERNAL_TRANSFER_CANDIDATE:  "Revisar depósito compatible y crear transfer_link si procede",
  CRYPTO_FEE_ZERO:              "Comprobar si hubo comisión en cripto",
  DEPOSIT_WITHOUT_COST:         "Añadir coste o clasificar depósito",
  SELL_WITHOUT_COST_BASIS:      "Bloqueante: venta sin base de coste — corregir antes de declarar",
  REWARD_WITHOUT_PRICE:         "Añadir precio EUR de recepción para calcular income fiscal",
  DUST_POSITION:                "Posición residual por debajo del umbral mínimo",
};
