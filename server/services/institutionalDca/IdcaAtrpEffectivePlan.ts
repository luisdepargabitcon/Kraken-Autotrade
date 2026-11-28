/**
 * Helpers puros para interpretar un ladder ATRP como plan efectivo de compras.
 * Solo se usan en la variante v2_candidate; legacy conserva safetyOrdersJson.
 */
import type { LadderLevel } from "./IdcaTypes";

export function normalizeAtrpLevelWeightsTo100(levels: LadderLevel[]): LadderLevel[] {
  if (levels.length === 0) return [];
  const total = levels.reduce((sum, level) => sum + level.sizePct, 0);
  if (!(total > 0)) return levels.map(level => ({ ...level }));

  const normalized = levels.map(level => ({
    ...level,
    sizePct: Math.round(((level.sizePct / total) * 100) * 100) / 100,
  }));
  const roundedTotal = normalized.reduce((sum, level) => sum + level.sizePct, 0);
  const difference = Math.round((100 - roundedTotal) * 100) / 100;
  const last = normalized[normalized.length - 1];
  last.sizePct = Math.round((last.sizePct + difference) * 100) / 100;
  return normalized;
}

export function atrpLevelAtBuyCount(levels: LadderLevel[], buyCount: number): LadderLevel | undefined {
  return levels.find(level => level.level === buyCount);
}

export function nextAtrpLevelAfterBuyCount(levels: LadderLevel[], buyCount: number): LadderLevel | undefined {
  return levels.find(level => level.level === buyCount + 1);
}
