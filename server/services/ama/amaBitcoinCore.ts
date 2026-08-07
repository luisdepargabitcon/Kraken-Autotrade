/**
 * AMA Bitcoin Core — Fase 2E
 *
 * On-chain Bitcoin Core RPC data: block height, difficulty, hashrate, subsidy era.
 */

export interface BitcoinCoreData {
  blockHeight: number;
  difficulty: number;
  hashrate: number; // TH/s
  subsidyEra: number;
  timestamp: string;
}

export function getSubsidyEra(blockHeight: number): number {
  return Math.floor(blockHeight / 210000);
}

export function getBlockSubsidy(blockHeight: number): number {
  const era = getSubsidyEra(blockHeight);
  return Math.floor(50 * 100000000 / Math.pow(2, era)); // satoshis
}

export function validateBitcoinCoreData(data: BitcoinCoreData): string[] {
  const errors: string[] = [];

  if (data.blockHeight < 0) errors.push("NEGATIVE_BLOCK_HEIGHT");
  if (data.difficulty < 0) errors.push("NEGATIVE_DIFFICULTY");
  if (data.hashrate < 0) errors.push("NEGATIVE_HASHRATE");
  if (data.subsidyEra < 0) errors.push("NEGATIVE_SUBSIDY_ERA");

  return errors;
}

export function isBlockHeightValid(blockHeight: number): boolean {
  return blockHeight > 0 && blockHeight < 10000000; // sanity upper bound
}
