/**
 * FISCO Config Service: Manages FISCO V2 configuration from fisco_config table.
 * Handles engine mode (legacy/v2_shadow/v2_official) and validation of blockers.
 */

import { pool } from "../../db";

export type FiscoEngineMode = "legacy" | "v2_shadow" | "v2_official";

export interface FiscoConfig {
  fiscoEngineMode: FiscoEngineMode;
  transferMatchingTimeWindowDays: number;
  transferMatchingAmountTolerancePct: number;
  dustThresholdDefault: number;
  cryptoFeeTreatment: "inventory_reduction" | "explicit_disposal";
  blockIfRewardWithoutPrice: boolean;
  blockIfSellWithoutCostBasis: boolean;
  blockIfTransferMismatch: boolean;
  blockIfBalanceMismatchCritical: boolean;
}

const DEFAULT_CONFIG: FiscoConfig = {
  fiscoEngineMode: "v2_shadow",
  transferMatchingTimeWindowDays: 5,
  transferMatchingAmountTolerancePct: 5,
  dustThresholdDefault: 0.0001,
  cryptoFeeTreatment: "inventory_reduction",
  blockIfRewardWithoutPrice: false,
  blockIfSellWithoutCostBasis: true,
  blockIfTransferMismatch: false,
  blockIfBalanceMismatchCritical: true,
};

export async function getFiscoConfig(): Promise<FiscoConfig> {
  const result = await pool.query("SELECT key, value FROM fisco_config");
  const config: Partial<FiscoConfig> = { ...DEFAULT_CONFIG };

  for (const row of result.rows) {
    const { key, value } = row;
    switch (key) {
      case "fisco_engine_mode":
        config.fiscoEngineMode = value as FiscoEngineMode;
        break;
      case "transfer_matching_time_window_days":
        config.transferMatchingTimeWindowDays = parseInt(value);
        break;
      case "transfer_matching_amount_tolerance_pct":
        config.transferMatchingAmountTolerancePct = parseInt(value);
        break;
      case "dust_threshold_default":
        config.dustThresholdDefault = parseFloat(value);
        break;
      case "crypto_fee_treatment":
        config.cryptoFeeTreatment = value as "inventory_reduction" | "explicit_disposal";
        break;
      case "block_if_reward_without_price":
        config.blockIfRewardWithoutPrice = value === "true";
        break;
      case "block_if_sell_without_cost_basis":
        config.blockIfSellWithoutCostBasis = value === "true";
        break;
      case "block_if_transfer_mismatch":
        config.blockIfTransferMismatch = value === "true";
        break;
      case "block_if_balance_mismatch_critical":
        config.blockIfBalanceMismatchCritical = value === "true";
        break;
    }
  }

  return config as FiscoConfig;
}

export async function setFiscoConfigKey(key: string, value: string): Promise<void> {
  await pool.query(`
    INSERT INTO fisco_config (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
  `, [key, value]);
}

export async function setFiscoConfig(config: Partial<FiscoConfig>): Promise<void> {
  if (config.fiscoEngineMode !== undefined) {
    await setFiscoConfigKey("fisco_engine_mode", config.fiscoEngineMode);
  }
  if (config.transferMatchingTimeWindowDays !== undefined) {
    await setFiscoConfigKey("transfer_matching_time_window_days", String(config.transferMatchingTimeWindowDays));
  }
  if (config.transferMatchingAmountTolerancePct !== undefined) {
    await setFiscoConfigKey("transfer_matching_amount_tolerance_pct", String(config.transferMatchingAmountTolerancePct));
  }
  if (config.dustThresholdDefault !== undefined) {
    await setFiscoConfigKey("dust_threshold_default", String(config.dustThresholdDefault));
  }
  if (config.cryptoFeeTreatment !== undefined) {
    await setFiscoConfigKey("crypto_fee_treatment", config.cryptoFeeTreatment);
  }
  if (config.blockIfRewardWithoutPrice !== undefined) {
    await setFiscoConfigKey("block_if_reward_without_price", String(config.blockIfRewardWithoutPrice));
  }
  if (config.blockIfSellWithoutCostBasis !== undefined) {
    await setFiscoConfigKey("block_if_sell_without_cost_basis", String(config.blockIfSellWithoutCostBasis));
  }
  if (config.blockIfTransferMismatch !== undefined) {
    await setFiscoConfigKey("block_if_transfer_mismatch", String(config.blockIfTransferMismatch));
  }
  if (config.blockIfBalanceMismatchCritical !== undefined) {
    await setFiscoConfigKey("block_if_balance_mismatch_critical", String(config.blockIfBalanceMismatchCritical));
  }
}

export interface FinalizationStatus {
  year: number;
  status: "FINALIZABLE" | "FINALIZABLE_WITH_WARNINGS" | "NOT_FINALIZABLE";
  blockers: string[];
  warnings: string[];
  canBeFinalized: boolean;
  engineMode: FiscoEngineMode;
  generatedAt: string;
}

export async function getFinalizationStatus(year: number): Promise<FinalizationStatus> {
  const config = await getFiscoConfig();
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check inventory snapshot for critical issues
  const snapshotResult = await pool.query(
    "SELECT * FROM fisco_inventory_snapshots WHERE year = $1 ORDER BY generated_at DESC LIMIT 1",
    [year]
  );

  if (snapshotResult.rows.length > 0) {
    const snapshot = snapshotResult.rows[0];
    const balanceCheck = snapshot.balance_check;

    if (balanceCheck) {
      const criticalIssues = balanceCheck.issues?.filter((i: any) => i.severity === "CRITICAL") || [];
      const warningIssues = balanceCheck.issues?.filter((i: any) => i.severity === "WARNING") || [];

      for (const issue of criticalIssues) {
        blockers.push(`[${issue.code}] ${issue.asset}: ${issue.detail}`);
      }

      for (const issue of warningIssues) {
        warnings.push(`[${issue.code}] ${issue.asset}: ${issue.detail}`);
      }

      // Check for rewards without price
      if (balanceCheck.rewards_without_price?.length > 0) {
        if (config.blockIfRewardWithoutPrice) {
          blockers.push(`${balanceCheck.rewards_without_price.length} rewards sin precio EUR (bloqueante por config)`);
        } else {
          warnings.push(`${balanceCheck.rewards_without_price.length} rewards sin precio EUR (no bloqueante)`);
        }
      }

      // Check for sells without cost basis
      if (balanceCheck.sells_without_cost_basis?.length > 0) {
        if (config.blockIfSellWithoutCostBasis) {
          blockers.push(`${balanceCheck.sells_without_cost_basis.length} ventas sin base de coste (bloqueante por config)`);
        } else {
          warnings.push(`${balanceCheck.sells_without_cost_basis.length} ventas sin base de coste (no bloqueante)`);
        }
      }

      // Check for suspected duplicate transfers
      if (balanceCheck.suspected_duplicate_transfers?.length > 0) {
        if (config.blockIfTransferMismatch) {
          blockers.push(`${balanceCheck.suspected_duplicate_transfers.length} withdrawals sin transfer_link (bloqueante por config)`);
        } else {
          warnings.push(`${balanceCheck.suspected_duplicate_transfers.length} withdrawals sin transfer_link (no bloqueante)`);
        }
      }
    }
  }

  // Check if engine mode is v2_official and there are blockers
  if (config.fiscoEngineMode === "v2_official" && blockers.length > 0) {
    blockers.push("No se puede activar v2_official mientras haya blockers. Usa v2_shadow para validar primero.");
  }

  // Determine status
  let status: FinalizationStatus["status"];
  if (blockers.length > 0) {
    status = "NOT_FINALIZABLE";
  } else if (warnings.length > 0) {
    status = "FINALIZABLE_WITH_WARNINGS";
  } else {
    status = "FINALIZABLE";
  }

  return {
    year,
    status,
    blockers,
    warnings,
    canBeFinalized: blockers.length === 0,
    engineMode: config.fiscoEngineMode,
    generatedAt: new Date().toISOString(),
  };
}
