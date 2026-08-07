/**
 * AMA L2 and DeFi Source — Fase 2J
 *
 * L2: settlement volume, batch frequency.
 * DeFi: TVL, protocol revenue.
 */

export interface L2SettlementData {
  network: string;
  batchFrequencySeconds: number;
  settlementVolumeUsd: number;
  timestamp: string;
}

export interface DefiTvlData {
  protocol: string;
  chain: string;
  tvlUsd: number;
  protocolRevenueUsd: number;
  timestamp: string;
}

export function validateL2Data(data: L2SettlementData): string[] {
  const errors: string[] = [];
  if (data.batchFrequencySeconds <= 0) errors.push("INVALID_BATCH_FREQUENCY");
  if (data.settlementVolumeUsd < 0) errors.push("NEGATIVE_SETTLEMENT_VOLUME");
  return errors;
}

export function validateDefiData(data: DefiTvlData): string[] {
  const errors: string[] = [];
  if (data.tvlUsd < 0) errors.push("NEGATIVE_TVL");
  if (data.protocolRevenueUsd < 0) errors.push("NEGATIVE_PROTOCOL_REVENUE");
  return errors;
}
