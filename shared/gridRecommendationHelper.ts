/**
 * gridRecommendationHelper.ts
 *
 * TYPE-ONLY module. All financial calculations are performed server-side
 * by gridRecommendationService.ts using canonical functions from
 * gridNetCalculator.ts and gridSpacingCalculator.ts.
 *
 * The UI must NOT compute financial alternatives. It receives a
 * ConfigurationRecommendation object from the server view model and
 * sends the selected alternativeId to the apply endpoint.
 */

export interface RecommendationAlternative {
  id: "A" | "B" | "C";
  title: string;
  explanation: string;
  proposedConfig: Record<string, any>;
  changedFields: string[];
  expectedBefore: {
    levels: number;
    spacingPct: number;
    rangePct: number;
    netProfitPct: number;
  };
  expectedAfter: {
    levels: number;
    spacingPct: number;
    rangePct: number;
    netProfitPct: number;
  };
  warnings: string[];
  safeToApply: boolean;
  blockingReason: string | null;
}

export interface RecommendationContext {
  pair: string;
  mode: string;
  activeRangeVersionId: string | null;
  regime: string | null;
  regimeMaxPct: number | null;
  bandPeriod: number | null;
  bandStdDevMultiplier: number | null;
  atrPeriod: number | null;
  atrTimeframe: string | null;
  bandSource: string | null;
  bandLower: number | null;
  bandCenter: number | null;
  bandUpper: number | null;
  bandWidthPct: number | null;
  atrPct: number | null;
  referencePrice: number | null;
}

export interface ConfigurationRecommendation {
  id: string;
  generatedAt: string;
  expiresAt: string;
  snapshotFingerprint: string;
  configFingerprint: string;
  marketFingerprint: string;
  activeRangeFingerprint: string;
  context: RecommendationContext;
  referencePrice: number | null;
  fresh: boolean;
  confidence: number;
  title: string;
  explanation: string;
  currentConfig: Record<string, any>;
  alternatives: RecommendationAlternative[];
  recommendedAlternativeId: "A" | "B" | "C" | null;
  warnings: string[];
  safeToApply: boolean;
  blockingReason: string | null;
}

export interface ActiveRangeSnapshot {
  rangeVersionId: string | null;
  lower: number | null;
  center: number | null;
  upper: number | null;
  totalWidthPct: number | null;
  semiRangePct: number | null;
  spacingPct: number | null;
  requestedBuyLevels: number | null;
  requestedSellLevels: number | null;
  generatedBuyLevels: number | null;
  generatedSellLevels: number | null;
  rangeControlMode: string | null;
  profile: string | null;
  regime: string | null;
  regimeMaxPct: number | null;
  configSnapshot: Record<string, any> | null;
  createdAt: string | null;
  source: string | null;
}

export interface CurrentConfigurationProjection {
  currentConfig: Record<string, any>;
  marketSnapshot: {
    price: number | null;
    bandLower: number | null;
    bandUpper: number | null;
    bandWidthPct: number | null;
    atrPct: number | null;
  };
  projectedRange: {
    lower: number | null;
    upper: number | null;
    totalWidthPct: number | null;
  } | null;
  projectedSpacing: number | null;
  projectedLevels: number | null;
}

export interface MarketBand {
  available: boolean;
  lower: number | null;
  center: number | null;
  upper: number | null;
  widthPct: number | null;
  calculatedWidthPct: number | null;
  atr: number | null;
  atrPct: number | null;
  period: number | null;
  stdDevMultiplier: number | null;
  timeframe: string | null;
  source: string | null;
  calculatedAt: string | null;
  internallyConsistent: boolean;
  inconsistencyReason: string | null;
  status: string;
}

export interface OperationalRange {
  available: boolean;
  rangeVersionId: string | null;
  sourceRangeVersionId: string | null;
  source: string | null;
  lower: number | null;
  center: number | null;
  upper: number | null;
  totalWidthPct: number | null;
  semiRangePct: number | null;
  spacingPct: number | null;
  requestedBuyLevels: number | null;
  requestedSellLevels: number | null;
  generatedBuyLevels: number | null;
  generatedSellLevels: number | null;
  regimeMaxPct: number | null;
  internallyConsistent: boolean;
  inconsistencyReason: string | null;
  calculatedAt: string | null;
}
