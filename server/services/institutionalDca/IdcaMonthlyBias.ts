import type { IdcaSizeProfile } from "./IdcaTypes";

export function resolveMonthlyBiasSizeProfile(
  currentPrice: number,
  vwapMonthly: number | undefined,
  currentProfile: IdcaSizeProfile,
): { monthlyBias: "aggressive" | "balanced" | "defensive" | "unknown"; sizeProfile: IdcaSizeProfile } {
  if (!(vwapMonthly && vwapMonthly > 0)) {
    return { monthlyBias: "unknown", sizeProfile: currentProfile };
  }
  if (currentPrice < vwapMonthly * 0.95) {
    return { monthlyBias: "aggressive", sizeProfile: "aggressive_quality" };
  }
  if (currentPrice < vwapMonthly) {
    return { monthlyBias: "balanced", sizeProfile: currentProfile };
  }
  return { monthlyBias: "defensive", sizeProfile: "defensive" };
}
