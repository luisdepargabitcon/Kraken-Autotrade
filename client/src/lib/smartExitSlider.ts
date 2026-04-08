/**
 * Slider Maestro — Smart Exit
 *
 * 0  = MENOS SALIDAS: bot aguanta más, umbrales altos, pocas señales activas
 * 100 = MÁS SALIDAS:  bot vende antes, umbrales bajos, todas las señales activas
 */

export interface SmartExitSignals {
  emaReversal: boolean;
  macdReversal: boolean;
  volumeDrop: boolean;
  mtfAlignmentLoss: boolean;
  orderbookImbalance: boolean;
  exchangeFlows: boolean;
  entrySignalDeterioration: boolean;
  stagnationExit: boolean;
  marketRegimeAdjustment: boolean;
}

export interface SliderDerivedParams {
  exitScoreThresholdBase: number;
  confirmationCycles: number;
  minPositionAgeSec: number;
  extraLossThresholdPenalty: number;
  regimeThresholds: { TREND: number; CHOP: number; VOLATILE: number };
  signals: SmartExitSignals;
}

/** Interpolación lineal redondeada. v=0 → atZero, v=100 → atHundred */
function lerp(v: number, atZero: number, atHundred: number): number {
  const t = Math.min(100, Math.max(0, v));
  return Math.round(atZero + (t / 100) * (atHundred - atZero));
}

/**
 * Ciclos de confirmación — escalonado.
 * v=0 (MENOS SALIDAS) → 10 ciclos (difícil salir)
 * v=100 (MÁS SALIDAS) → 3 ciclos (fácil salir)
 */
function getCycles(v: number): number {
  if (v <= 20) return 10;
  if (v <= 40) return 9;
  if (v <= 60) return 7;
  if (v <= 80) return 5;
  return 3;
}

/** Etiqueta descriptiva del nivel del slider */
export function getSliderLabel(v: number): string {
  if (v <= 20) return "Muy pocas salidas";
  if (v <= 40) return "Pocas salidas";
  if (v <= 60) return "Equilibrado";
  if (v <= 80) return "Bastantes salidas";
  return "Muchas salidas";
}

/** Clase de color Tailwind para el nivel del slider */
export function getSliderColorClass(v: number): string {
  if (v <= 20) return "text-emerald-400";
  if (v <= 40) return "text-green-400";
  if (v <= 60) return "text-yellow-400";
  if (v <= 80) return "text-orange-400";
  return "text-red-400";
}

/** Color de la barra del slider según nivel */
export function getSliderTrackClass(v: number): string {
  if (v <= 20) return "bg-emerald-500";
  if (v <= 40) return "bg-green-500";
  if (v <= 60) return "bg-yellow-500";
  if (v <= 80) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * Derivar parámetros de Smart Exit a partir del slider maestro.
 *
 * @param value          - valor del slider 0-100
 * @param currentConfig  - config actual (para preservar overrides manuales)
 * @param manualOverrides - keys marcadas como override manual (no se recalculan)
 */
export function deriveSmartExitConfigFromMasterSlider(
  value: number,
  currentConfig: Partial<SliderDerivedParams & {
    regimeThresholds?: Record<string, number>;
    signals?: Record<string, boolean>;
  }> = {},
  manualOverrides: Record<string, boolean> = {}
): SliderDerivedParams {
  const isAggressive = value > 60;   // MÁS SALIDAS — señales ruidosas activas
  const isBalanced   = value > 40 && value <= 60;

  const derived: SliderDerivedParams = {
    // Numéricos: v=0 (MENOS) → valor alto; v=100 (MÁS) → valor bajo
    exitScoreThresholdBase:    lerp(value, 10, 4),
    extraLossThresholdPenalty: lerp(value, 3, 0),
    minPositionAgeSec:         lerp(value, 1800, 900),  // 30 min → 15 min
    confirmationCycles:        getCycles(value),
    regimeThresholds: {
      TREND:    lerp(value, 10, 4),
      CHOP:     lerp(value, 9,  4),
      VOLATILE: lerp(value, 10, 5),
    },
    signals: {
      // Señales core — siempre ON
      emaReversal:               true,
      macdReversal:              true,
      mtfAlignmentLoss:          true,
      entrySignalDeterioration:  true,
      marketRegimeAdjustment:    true,
      // Señales ruidosas — solo en zona agresiva
      volumeDrop:        isAggressive || isBalanced,
      stagnationExit:    isAggressive || isBalanced,
      orderbookImbalance: isAggressive,
      exchangeFlows:     false,  // Siempre OFF — datos no fiables
    },
  };

  // Respetar overrides manuales — mantener valor actual del usuario
  if (manualOverrides["exitScoreThresholdBase"] && currentConfig.exitScoreThresholdBase !== undefined) {
    derived.exitScoreThresholdBase = currentConfig.exitScoreThresholdBase;
  }
  if (manualOverrides["confirmationCycles"] && currentConfig.confirmationCycles !== undefined) {
    derived.confirmationCycles = currentConfig.confirmationCycles;
  }
  if (manualOverrides["minPositionAgeSec"] && currentConfig.minPositionAgeSec !== undefined) {
    derived.minPositionAgeSec = currentConfig.minPositionAgeSec;
  }
  if (manualOverrides["extraLossThresholdPenalty"] && currentConfig.extraLossThresholdPenalty !== undefined) {
    derived.extraLossThresholdPenalty = currentConfig.extraLossThresholdPenalty;
  }
  if (manualOverrides["regimeThresholds"] && currentConfig.regimeThresholds) {
    derived.regimeThresholds = currentConfig.regimeThresholds as { TREND: number; CHOP: number; VOLATILE: number };
  }

  // Overrides por señal individual: key = "signals.emaReversal" etc.
  if (currentConfig.signals) {
    const sigKeys = Object.keys(derived.signals) as (keyof SmartExitSignals)[];
    for (const k of sigKeys) {
      if (manualOverrides[`signals.${k}`]) {
        derived.signals[k] = (currentConfig.signals as Record<string, boolean>)[k] ?? derived.signals[k];
      }
    }
  }

  return derived;
}
