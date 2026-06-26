/**
 * Helpers de presentación para FISCO V2 — todo en castellano de España.
 * Ningún string técnico en inglés debe aparecer en la UI sin pasar por aquí.
 */

export type FiscoEngineMode = "legacy" | "v2_shadow" | "v2_official";

const ENGINE_MODE_LABELS: Record<FiscoEngineMode, string> = {
  legacy: "Motor actual",
  v2_shadow: "V2 en sombra",
  v2_official: "V2 oficial",
};

const ENGINE_MODE_DESCRIPTIONS: Record<FiscoEngineMode, string> = {
  legacy: "Motor FIFO actual en uso. Calcula el resultado fiscal oficial.",
  v2_shadow: "Simulación V2 en paralelo. Calcula sin sustituir el resultado oficial.",
  v2_official: "Motor V2 activo como cálculo oficial. Solo disponible sin bloqueos.",
};

const BLOCKER_LABELS: Record<string, string> = {
  GROSS_GAINS_LOSSES_DIFF_EXCESSIVE: "Diferencia bruta excesiva entre motores",
  ENGINE_NOT_FULL_V2: "El motor V2 aún no es completo",
  DISPOSALS_COUNT_DIFF: "Diferencia en número de disposiciones",
  COMPARISON_NUMERIC_INVALID: "Campos numéricos inválidos en la comparación",
  MISSING_OPENING_BALANCE_OR_PREHISTORY: "Falta saldo inicial o histórico previo",
  UNKNOWN_BASIS: "Base de coste desconocida",
  NEGATIVE_INVENTORY: "Inventario negativo",
  PENDING_OPERATIONS: "Operaciones pendientes",
  ORPHAN_SELLS: "Ventas sin base de coste",
  EXTERNAL_WITHDRAWAL_REVIEW: "Retirada externa pendiente de revisar",
  INTERNAL_TRANSFER_CANDIDATE: "Posible transferencia interna",
  SELL_WITHOUT_COST_BASIS: "Venta sin base de coste",
  REWARD_WITHOUT_PRICE: "Recompensa sin precio EUR",
  TRANSFER_MISMATCH: "Discrepancia en transferencia",
  BALANCE_MISMATCH_CRITICAL: "Discrepancia crítica de balance",
};

const WARNING_LABELS: Record<string, string> = {
  GROSS_GAINS_LOSSES_DIFF: "Diferencia en ganancias/pérdidas brutas",
  MULTI_YEAR_CSV: "CSV con múltiples años fiscales",
  PENDING_OPERATIONS: "Operaciones pendientes de recalcular",
};

const STATUS_LABELS: Record<string, string> = {
  FINALIZABLE: "Finalizable",
  FINALIZABLE_CON_AVISOS: "Finalizable con avisos",
  NO_FINALIZABLE: "No finalizable",
  V2_OFICIAL_BLOQUEADO: "V2 oficial bloqueado",
  FINALIZABLE_CON_MOTOR_ACTUAL: "Finalizable con motor actual",
  V2_OFICIAL_NO_ACTIVADO: "V2 oficial no activado",
};

const IMPORT_STATUS_LABELS: Record<string, string> = {
  ok: "Correcto",
  warning: "Aviso",
  error: "Error",
  duplicate: "Duplicado",
  skipped: "Saltado",
};

const TRANSFER_DATE_BASIS_LABELS: Record<string, string> = {
  economic: "Fecha económica",
  created: "Fecha de creación",
};

const COMPARISON_METRIC_LABELS: Record<string, string> = {
  net_gain_loss_eur: "Ganancia/pérdida neta",
  gains_eur: "Ganancias brutas",
  losses_eur: "Pérdidas brutas",
  disposals_count: "Número de disposiciones",
  diff_eur: "Diferencia neta",
  diff_pct: "Diferencia porcentual",
  gross_gains_diff_eur: "Diferencia en ganancias brutas",
  gross_losses_diff_eur: "Diferencia en pérdidas brutas",
  disposals_count_diff: "Diferencia en número de disposiciones",
};

const DIFF_CAUSE_LABELS: Record<string, string> = {
  rounding_or_fee: "Redondeo o comisiones",
  gross_classification_diff: "Clasificación de disposiciones distinta",
  cost_basis_diff: "Base de coste FIFO distinta",
  missing_opening_balance: "Falta saldo inicial",
  unsupported_event: "Evento no soportado",
  transfer_carryover_diff: "Diferencia por transferencia entre cuentas",
  v2_higher_gain: "V2 calcula mayor ganancia",
  v2_higher_loss: "V2 calcula mayor pérdida",
  unknown: "Causa desconocida",
};

export function formatFiscoEngineModeLabel(mode: string): string {
  return ENGINE_MODE_LABELS[mode as FiscoEngineMode] ?? mode;
}

export function formatFiscoEngineModeDescription(mode: string): string {
  return ENGINE_MODE_DESCRIPTIONS[mode as FiscoEngineMode] ?? mode;
}

export function formatFiscoBlockerLabel(code: string): string {
  if (BLOCKER_LABELS[code]) return BLOCKER_LABELS[code];
  if (code.startsWith("DISPOSALS_COUNT_DIFF:")) {
    return `${BLOCKER_LABELS["DISPOSALS_COUNT_DIFF"]}: ${code.split(":")[1]?.trim() ?? ""}`;
  }
  return code;
}

export function formatFiscoWarningLabel(code: string): string {
  if (WARNING_LABELS[code]) return WARNING_LABELS[code];
  if (code.startsWith("GROSS_GAINS_LOSSES_DIFF:")) {
    return `${WARNING_LABELS["GROSS_GAINS_LOSSES_DIFF"]}: ${code.split(":")[1]?.trim() ?? ""}`;
  }
  if (code.startsWith("MULTI_YEAR_CSV:")) {
    return `${WARNING_LABELS["MULTI_YEAR_CSV"]}: ${code.split(":")[1]?.trim() ?? ""}`;
  }
  return code;
}

export function formatFiscoStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatFiscoImportStatusLabel(status: string): string {
  return IMPORT_STATUS_LABELS[status] ?? status;
}

export function formatFiscoTransferDateBasisLabel(basis: string): string {
  return TRANSFER_DATE_BASIS_LABELS[basis] ?? basis;
}

export function formatFiscoComparisonMetricLabel(metric: string): string {
  return COMPARISON_METRIC_LABELS[metric] ?? metric;
}

export function formatFiscoDiffCauseLabel(cause: string): string {
  return DIFF_CAUSE_LABELS[cause] ?? cause;
}

export function formatEur(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatEurSigned(amount: number): string {
  const formatted = formatEur(Math.abs(amount));
  return amount >= 0 ? `+${formatted}` : `-${formatted}`;
}

export const FORBIDDEN_VISIBLE_STRINGS = [
  "Shadow", "shadow", "Official", "official",
  "blocker", "warning", "safe", "dry run", "preview",
  "matching", "gross", "engine", "dust", "fees",
] as const;

const TECHNICAL_MESSAGE_LABELS: Record<string, string> = {
  skipFiatDepositsWithdrawals: "Fila omitida: depósito fiat EUR. Los depósitos fiat no generan operación fiscal cripto en esta configuración.",
  "skipFiatDepositsWithdrawals=true": "Fila omitida: depósito fiat EUR. Los depósitos fiat no generan operación fiscal cripto en esta configuración.",
  GROSS_DIFF_NOT_TRACEABLE: "Diferencia bruta no trazable por operación. El sistema no puede vincular todavía cada disposición del motor actual con su equivalente en V2.",
  ORPHAN_SELLS: "Ventas sin base de coste. Hay operaciones de venta sin lotes de compra asociados.",
  PENDING_OPERATIONS: "Operaciones pendientes de recalcular.",
  EXTERNAL_WITHDRAWAL_REVIEW: "Retirada externa pendiente de revisar.",
  INTERNAL_TRANSFER_CANDIDATE: "Posible transferencia interna entre exchanges.",
};

export function formatFiscoTechnicalMessage(code: string): string {
  if (TECHNICAL_MESSAGE_LABELS[code]) return TECHNICAL_MESSAGE_LABELS[code];
  if (code.startsWith("skipFiatDepositsWithdrawals")) {
    return TECHNICAL_MESSAGE_LABELS["skipFiatDepositsWithdrawals"];
  }
  return formatFiscoBlockerLabel(code);
}
