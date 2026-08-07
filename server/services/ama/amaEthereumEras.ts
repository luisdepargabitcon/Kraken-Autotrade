/**
 * AMA Ethereum Eras — Fase 2F
 *
 * 7 active eras + GLAMSTERDAM (PLANNED, NOT_ACTIVE).
 * No totalStakedEth = validatorCount × 32 post-Pectra.
 * ETH/BTC filter: stress reduce risk. ETH does not inherit BTC promotion.
 */

import {
  type EthereumEra,
  ETHEREUM_ERAS,
  GLAMSTERDAM_STATUS,
  isEraActive,
  type EthBtcFilterState,
  applyEthBtcFilter,
} from "./amaSeedTypes";

export { ETHEREUM_ERAS, GLAMSTERDAM_STATUS, isEraActive, applyEthBtcFilter };
export type { EthereumEra, EthBtcFilterState };

export interface EthereumNetworkData {
  era: EthereumEra;
  blockNumber: number;
  validatorCount: number | null;
  totalStakedEth: number | null;
  timestamp: string;
}

export function shouldCalculateTotalStaked(era: EthereumEra): boolean {
  // Do NOT calculate totalStakedEth = validatorCount × 32 post-Pectra
  if (era === "PECTRA" || era === "POST_FUSAKA" || era === "GLAMSTERDAM") {
    return false;
  }
  return true;
}

export function computeTotalStakedEth(
  validatorCount: number,
  era: EthereumEra,
): number | null {
  if (!shouldCalculateTotalStaked(era)) return null;
  return validatorCount * 32;
}

export function getEraByBlockNumber(
  blockNumber: number,
  eraBoundaries: Record<EthereumEra, number>,
): EthereumEra {
  let currentEra: EthereumEra = "PRE_EIP1559";
  for (const era of ETHEREUM_ERAS) {
    if (blockNumber >= eraBoundaries[era]) {
      currentEra = era;
    }
  }
  return currentEra;
}

export function isEthResearchOnly(): boolean {
  return true; // ETH is always RESEARCH_ONLY in V2.2
}

export function canEthPromoteToReal(): boolean {
  return false; // ETH cannot transit to REAL automatically
}

export function doesEthInheritBtcPromotion(): boolean {
  return false; // ETH does not inherit BTC promotion
}
