import { createHash } from "crypto";

function normalizeDecimal(value: string | number, decimals: number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'NaN';
  return n.toFixed(decimals);
}

export function computeDeterministicTradeId(input: {
  exchange: string;
  pair: string;
  executedAt: Date;
  type: 'buy' | 'sell' | string;
  price: string | number;
  amount: string | number;
}): string {
  const executedAtIso = input.executedAt.toISOString();
  const priceNorm = normalizeDecimal(input.price, 8);
  const amountNorm = normalizeDecimal(input.amount, 8);
  const raw = `${input.exchange}|${input.pair}|${executedAtIso}|${String(input.type).toLowerCase()}|${priceNorm}|${amountNorm}`;
  return createHash('sha256').update(raw).digest('hex');
}
