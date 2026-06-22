/**
 * IdcaGridOverlay — Intelligent lateral grid as IDCA sub-layer.
 *
 * RULES (non-negotiable):
 *   - Only activates when regime === 'lateral'
 *   - Never modifies anchor, basePrice, basePriceType or avgEntryPrice
 *   - Never closes the main IDCA cycle on a partial grid sell
 *   - Grid capital is bounded by maxGridCapitalPctOfCycle
 *   - Default: observer_only = true (grid real disabled until explicitly enabled)
 *   - Does NOT operate as an independent strategy
 *
 * Grid levels are spaced dynamically by ATRP so they self-adjust to volatility.
 */

import type { IdcaRegimeSnapshot } from "./IdcaRegimeAdapter";
import type { MeanReversionDecision } from "./IdcaMeanReversionOverlay";

export type GridState =
  | "inactive"
  | "armed"
  | "active"
  | "paused_breakout_down"
  | "paused_spread_high"
  | "paused_bear_trend"
  | "paused_cycle_overloaded"
  | "closed";

export interface GridLeg {
  legIndex: number;
  side: "buy" | "sell";
  plannedPrice: number;
  reason: string;
  observerOnly: boolean;
}

export interface GridDecision {
  gridAllowed: boolean;
  gridState: GridState;
  levels: GridLeg[];
  capitalBudget: number;       // USD budgeted for grid
  levelsCount: number;
  atrSpacingPct: number;       // spacing used between levels
  reason: string;
  naturalReason: string;
}

export interface GridConfig {
  gridEnabled: boolean;
  maxGridCapitalPctOfCycle: number;   // default 10
  maxGridLevels: number;              // default 3
  gridCapitalPolicy: string;
  gridLevelPolicy: string;
  gridProfitPolicy: string;
  doNotRewriteAnchor: boolean;
  allowGridWithoutActiveCycle: boolean;
  executionScope: string;
}

// Minimum spread required for profitable grid (ATR x multiplier must cover fees)
const MIN_FEES_ASSUMED_PCT = 0.20; // 0.10% each side
const ATRP_SPACING_MULTIPLIER = 0.60; // grid step = ATRP * 0.60
const MIN_GRID_STEP_PCT = 0.50;
const MAX_GRID_STEP_PCT = 3.00;

export function evaluateGridOverlay(
  regimeSnapshot: IdcaRegimeSnapshot,
  meanReversionDecision: MeanReversionDecision,
  config: GridConfig,
  cycleCapitalUsd: number,     // current cycle capital for sizing
  activeCycleId: number | null,
  mode: "off" | "observer" | "real"
): GridDecision {

  const inactiveDecision = (state: GridState, reason: string, naturalReason: string): GridDecision => ({
    gridAllowed: false,
    gridState: state,
    levels: [],
    capitalBudget: 0,
    levelsCount: 0,
    atrSpacingPct: 0,
    reason,
    naturalReason,
  });

  if (!config.gridEnabled || mode === "off") {
    return inactiveDecision("inactive", "grid_disabled_or_mode_off", "Grid desactivado en configuración.");
  }

  // Grid requires an active IDCA cycle by default
  if (!activeCycleId && !config.allowGridWithoutActiveCycle) {
    return inactiveDecision("inactive", "no_active_cycle", "Grid solo opera dentro de un ciclo IDCA activo.");
  }

  // Only in lateral regime
  if (regimeSnapshot.regime !== "lateral") {
    const state: GridState = regimeSnapshot.regime === "bearish"
      ? "paused_bear_trend"
      : regimeSnapshot.regime === "high_volatility"
        ? "paused_spread_high"
        : "paused_breakout_down";
    return inactiveDecision(
      state,
      `regime=${regimeSnapshot.regime}`,
      `Grid pausado: régimen ${regimeSnapshot.regime === "bearish" ? "bajista" : regimeSnapshot.regime === "high_volatility" ? "volátil" : "no lateral"} detectado.`
    );
  }

  // Block if mean reversion signals bearish/volatility
  if (meanReversionDecision.action === "block_buy" &&
    (meanReversionDecision.state === "blocked_by_bear_trend" ||
      meanReversionDecision.state === "blocked_by_high_volatility")) {
    return inactiveDecision("paused_bear_trend", "mean_reversion_block", meanReversionDecision.naturalReason);
  }

  const { price, atrPct } = regimeSnapshot;

  if (!price || price <= 0) {
    return inactiveDecision("inactive", "no_price", "Sin precio disponible para calcular niveles grid.");
  }

  // Grid step size based on ATRP
  const rawStep = atrPct !== null
    ? atrPct * ATRP_SPACING_MULTIPLIER
    : 1.0; // fallback
  const atrSpacingPct = Math.min(MAX_GRID_STEP_PCT, Math.max(MIN_GRID_STEP_PCT, rawStep));

  // Check if grid spread covers fees
  if (atrSpacingPct < MIN_FEES_ASSUMED_PCT * 2) {
    return inactiveDecision(
      "paused_spread_high",
      `atrSpacingPct=${atrSpacingPct.toFixed(3)}% < min_required=${(MIN_FEES_ASSUMED_PCT * 2).toFixed(3)}%`,
      "Spread estimado insuficiente para cubrir comisiones. Grid pausado."
    );
  }

  // Capital budget
  const capitalBudget = cycleCapitalUsd > 0
    ? (cycleCapitalUsd * config.maxGridCapitalPctOfCycle) / 100
    : 0;

  const nLevels = Math.min(config.maxGridLevels, 3);
  const capitalPerLevel = nLevels > 0 ? capitalBudget / nLevels : 0;

  // Determine if observer-only
  const observerOnly = config.executionScope !== "real" || mode !== "real";

  // Build grid legs: nLevels buy levels below price, each with a matching sell above
  const levels: GridLeg[] = [];
  for (let i = 1; i <= nLevels; i++) {
    const buyPrice  = price * (1 - (atrSpacingPct * i) / 100);
    const sellPrice = price * (1 + (atrSpacingPct * 0.5) / 100); // sell half ATR above center

    levels.push({
      legIndex: i * 2 - 1,
      side: "buy",
      plannedPrice: Math.round(buyPrice * 1e6) / 1e6,
      reason: `grid_buy_level_${i} spacing=${atrSpacingPct.toFixed(2)}% budget=$${capitalPerLevel.toFixed(2)}`,
      observerOnly,
    });
    levels.push({
      legIndex: i * 2,
      side: "sell",
      plannedPrice: Math.round(sellPrice * 1e6) / 1e6,
      reason: `grid_sell_level_${i}`,
      observerOnly,
    });
  }

  return {
    gridAllowed: true,
    gridState: "armed",
    levels,
    capitalBudget,
    levelsCount: nLevels,
    atrSpacingPct,
    reason: `regime=lateral atrPct=${atrPct?.toFixed(2)}% spacing=${atrSpacingPct.toFixed(2)}% levels=${nLevels} capital=$${capitalBudget.toFixed(2)} observer=${observerOnly}`,
    naturalReason: observerOnly
      ? `Grid inteligente preparado (modo observador). ${nLevels} niveles × $${capitalPerLevel.toFixed(0)} dentro del rango lateral detectado.`
      : `Grid inteligente armado en modo real. ${nLevels} niveles dentro del rango lateral.`,
  };
}
