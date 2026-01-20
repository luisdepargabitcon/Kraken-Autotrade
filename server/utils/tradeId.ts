import { createHash } from "crypto";

export type CanonicalTradeInput = {
  exchange: string;
  pair: string;
  executedAt: Date;
  type: "buy" | "sell" | string;
  price: string | number;
  amount: string | number;
  externalId?: string | null;
};

function normalizeDecimal(value: string | number, decimals: number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "NaN";
  return n.toFixed(decimals);
}

function toIsoDate(value: Date): string {
  if (!(value instanceof Date)) {
    throw new Error("executedAt must be a Date instance");
  }
  const ts = value.getTime();
  if (!Number.isFinite(ts)) {
    throw new Error("Invalid executedAt provided for trade id generation");
  }
  return new Date(ts).toISOString();
}

function canonicalize(input: CanonicalTradeInput): string {
  const executedAtIso = toIsoDate(input.executedAt);
  const exchangeNorm = input.exchange?.toString().trim().toLowerCase() || "";
  const pairNorm = input.pair?.toString().trim().toUpperCase() || "";
  const typeNorm = String(input.type ?? "").trim().toLowerCase();
  const priceNorm = normalizeDecimal(input.price, 8);
  const amountNorm = normalizeDecimal(input.amount, 8);
  const externalIdNorm = input.externalId ? input.externalId.toString().trim().toLowerCase() : "";
  return `${exchangeNorm}|${pairNorm}|${executedAtIso}|${typeNorm}|${priceNorm}|${amountNorm}|${externalIdNorm}`;
}

export function computeDeterministicTradeId(input: CanonicalTradeInput): string {
  const raw = canonicalize(input);
  return createHash("sha256").update(raw).digest("hex");
}

export function buildTradeId(input: CanonicalTradeInput): string {
  return computeDeterministicTradeId(input);
}
