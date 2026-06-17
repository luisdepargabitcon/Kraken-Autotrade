import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format USD values with adaptive precision for small amounts.
 * - Values >= 0.01: 2 decimals (e.g., +$1.83, -$0.25)
 * - Values < 0.01 but not zero: 4 decimals (e.g., +$0.0032, -$0.0013)
 * - Exactly zero: $0.00
 * - Null/undefined/NaN: "N/A"
 */
export function formatSmallUsd(value: number | null | undefined, opts?: { signed?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";

  const n = Number(value);

  // Handle -0 and exact zero
  if (Object.is(n, -0) || Math.abs(n) === 0) {
    return "$0.00";
  }

  const sign = opts?.signed && n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const decimals = abs < 0.01 ? 4 : 2;

  return `${sign}$${abs.toFixed(decimals)}`;
}
