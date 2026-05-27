/**
 * React hooks for the Institutional DCA module.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const PREFIX = "/api/institutional-dca";

/** Truncate a Date to second precision → stable string for React Query keys.
 *  Without this, Date.now() changes by ms on every render, creating new
 *  query keys each time and preventing React Query from caching results. */
function truncDateToSec(d: Date): string {
  return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString();
}

// ─── Types ─────────────────────────────────────────────────────────

export interface IdcaControls {
  id: number;
  normalBotEnabled: boolean;
  institutionalDcaEnabled: boolean;
  globalTradingPause: boolean;
  updatedAt: string;
}

export interface IdcaConfig {
  id: number;
  enabled: boolean;
  mode: "disabled" | "simulation" | "live";
  allocatedCapitalUsd: string;
  protectPrincipal: boolean;
  reinvestMode: string;
  maxModuleExposurePct: string;
  maxAssetExposurePct: string;
  maxModuleDrawdownPct: string;
  maxCombinedBtcExposurePct: string;
  maxCombinedEthExposurePct: string;
  blockOnBreakdown: boolean;
  blockOnHighSpread: boolean;
  blockOnSellPressure: boolean;
  schedulerIntervalSeconds: number;
  localHighLookbackMinutes: number;
  smartModeEnabled: boolean;
  volatilityTrailingEnabled: boolean;
  adaptiveTpEnabled: boolean;
  adaptivePositionSizingEnabled: boolean;
  btcMarketGateForEthEnabled: boolean;
  learningWindowCycles: number;
  learningAutoApply: boolean;
  telegramEnabled: boolean;
  telegramChatId: string | null;
  telegramThreadId: string | null;
  telegramSummaryMode: string;
  telegramCooldownSeconds: number;
  telegramAlertTogglesJson: Record<string, boolean>;
  simulationInitialBalanceUsd: string;
  simulationFeePct: string;
  simulationSlippagePct: string;
  simulationTelegramEnabled: boolean;
  eventRetentionDays: number;
  orderArchiveDays: number;
  dynamicTpConfigJson: Record<string, any>;
  plusConfigJson: Record<string, any>;
  entryUiJson: Record<string, number> | null;
  telegramUiJson: Record<string, number> | null;
  executionFeesJson: Record<string, any> | null;
  [key: string]: any;
}

export interface IdcaAssetConfig {
  id: number;
  pair: string;
  enabled: boolean;
  minDipPct: string;
  dipReference: string;
  requireReboundConfirmation: boolean;
  reboundMinPct: string;
  trailingBuyEnabled: boolean;
  vwapEnabled: boolean;
  vwapDynamicSafetyEnabled: boolean;
  safetyOrdersJson: { dipPct: number; sizePctOfAssetBudget: number }[];
  maxSafetyOrders: number;
  takeProfitPct: string;
  dynamicTakeProfit: boolean;
  trailingPct: string;
  partialTakeProfitPct: string;
  breakevenEnabled: boolean;
  protectionActivationPct: string;
  beNetBufferPct: string;
  trailingActivationPct: string;
  trailingMarginPct: string;
  cooldownMinutesBetweenBuys: number;
  maxCycleDurationHours: number;
  // Ladder ATRP config
  ladderAtrpConfigJson?: {
    enabled: boolean;
    profile: "aggressive" | "balanced" | "conservative" | "custom";
    sliderIntensity: number;
    baseMultiplier: number;
    stepMultiplier: number;
    maxMultiplier: number;
    effectiveMultipliers: number[];
    sizeDistribution: number[];
    minDipPct: number;
    maxDipPct: number;
    maxLevels: number;
    adaptiveScaling: boolean;
    volatilityScaling: number;
    rebalanceOnVwap: boolean;
    // Deep ladder settings
    depthMode?: "normal" | "deep" | "manual";
    targetCoveragePct?: number;
    minStepPct?: number;
    allowDeepExtension?: boolean;
    // Manual level settings
    manualLevelEnabled?: boolean;
    manualMultipliers?: number[];
    manualSizeDistribution?: number[];
  };
  ladderAtrpEnabled: boolean;
  // Trailing Buy Level 1 config
  trailingBuyLevel1ConfigJson?: {
    enabled: boolean;
    triggerLevel: number;
    triggerMode: "dip_pct" | "atrp_multiplier";
    trailingMode: "rebound_pct" | "atrp_fraction";
    trailingValue: number;
    maxWaitMinutes: number;
    cancelOnRecovery: boolean;
    minVolumeCheck: boolean;
    confirmWithVwap: boolean;
  };
  // Dynamic Distance config
  dynamicDistanceConfigJson?: Record<string, any> | null;
  // Entry Mode: assisted_entry | dynamic_intelligent_entry
  entryMode?: string;
}

export interface IdcaCycle {
  id: number;
  pair: string;
  strategy: string;
  mode: string;
  status: string;
  capitalReservedUsd: string;
  capitalUsedUsd: string;
  totalQuantity: string;
  avgEntryPrice: string | null;
  currentPrice: string | null;
  unrealizedPnlUsd: string | null;
  unrealizedPnlPct: string | null;
  realizedPnlUsd: string | null;
  buyCount: number;
  highestPriceAfterTp: string | null;
  tpTargetPct: string | null;
  tpTargetPrice: string | null;
  trailingPct: string | null;
  marketScore: string | null;
  volatilityScore: string | null;
  adaptiveSizeProfile: string | null;
  lastBuyAt: string | null;
  closeReason: string | null;
  maxDrawdownPct: string | null;
  nextBuyLevelPct: string | null;
  nextBuyPrice: string | null;
  tpBreakdownJson: any;
  cycleType: string;
  parentCycleId: number | null;
  plusCyclesCompleted: number;
  isImported: boolean;
  importedAt: string | null;
  sourceType: string | null;
  managedBy: string | null;
  soloSalida: boolean;
  importNotes: string | null;
  importSnapshotJson: any;
  isManualCycle: boolean;
  exchangeSource: string | null;
  estimatedFeePct: string | null;
  estimatedFeeUsd: string | null;
  feesOverrideManual: boolean;
  importWarningAcknowledged: boolean;
  skippedSafetyLevels: number;
  skippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[] | null;
  basePrice: string | null;
  basePriceType: string | null;
  basePriceTimestamp: string | null;
  basePriceMetaJson: any;
  entryDipPct: string | null;
  // Cycle anchor canonical fields (enriched from basePriceMetaJson)
  cycleAnchorPrice: number | null;
  cycleAnchorSource: string | null;
  cycleAnchorLabel: string | null;
  cycleAnchorTimestamp: string | null;
  cycleAnchorAgeHours: number | null;
  cycleAnchorIsFrozen: boolean;
  // Snake case fallbacks (from ORM serialization)
  cycle_anchor_price?: number | null;
  cycle_anchor_source?: string | null;
  cycle_anchor_label?: string | null;
  cycle_anchor_timestamp?: string | null;
  cycle_anchor_age_hours?: number | null;
  cycle_anchor_is_frozen?: boolean;
  protectionArmedAt: string | null;
  protectionStopPrice: string | null;
  lastManualEditAt: string | null;
  lastManualEditReason: string | null;
  editHistoryJson: any;
  // Lote 4: cost basis tracking
  totalCostBasisUsd: string | null;
  realizedCostBasisUsd: string | null;
  partialSellCount: number;
  lastPartialSellAt: string | null;
  startedAt: string;
  closedAt: string | null;
  orders?: IdcaOrder[];
}

export interface IdcaOrder {
  id: number;
  cycleId: number;
  pair: string;
  mode: string;
  orderType: string;
  buyIndex: number | null;
  side: string;
  price: string;
  quantity: string;
  grossValueUsd: string;
  feesUsd: string;
  slippageUsd: string;
  netValueUsd: string;
  triggerReason: string | null;
  humanReason: string | null;
  exchangeOrderId: string | null;
  executedAt: string;
  executionStatus: string | null;
  voidedReason: string | null;
}

export interface IdcaEvent {
  id: number;
  cycleId: number | null;
  pair: string | null;
  mode: string | null;
  eventType: string;
  severity: string;
  message: string;
  payloadJson: any;
  createdAt: string;
}

export interface IdcaSimulationWallet {
  balance: number;
  totalInvested: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  cycles: IdcaSimulationWalletCycle[];
}

export interface IdcaSimulationWalletCycle {
  // Add properties for IdcaSimulationWalletCycle
}

export interface LadderPreviewLevel {
  level: number;
  dipPct: number;
  triggerPrice: number;
  sizePct: number;
  atrpMultiplier: number;
  isActive: boolean;
}

export interface LadderPreview {
  levels: LadderPreviewLevel[];
  totalLevels: number;
  maxDrawdown: number;
  totalSize: number;
  isLimitedByMaxLevels?: boolean;
  marketContext: {
    anchorPrice: number;
    currentPrice: number;
    atrPct?: number;
    vwapZone?: string;
  };
  profile: "aggressive" | "balanced" | "conservative" | "custom";
  sliderIntensity: number;
}

export interface MarketContextQualityDetail {
  status: "ok" | "partial" | "poor";
  reason: "ok" | "warming_up_cache" | "insufficient_candles" | "stale_market_data" | "missing_atrp" | "missing_vwap_zone" | "missing_anchor";
  candleCount: number;
  requiredForOptimal: number;
  hasVwap: boolean;
  hasAtrp: boolean;
}

export interface IdcaVwapReliability {
  usableForEntry: boolean;
  usableForContext: boolean;
  status: string;
  reason: string;
  candlesUsed?: number;
  minCandlesRequired?: number;
  anchorAgeHours?: number;
  volumeQualityScore?: number;
  divergencePctVsHybrid?: number;
  checkedAt?: string;
}

export interface IdcaReferenceContext {
  pair: string;
  effectiveEntryReference: number;
  referenceSource: "vwap_anchor" | "smart_anchor" | "hybrid_v2" | "hybrid_fallback" | "manual_imported" | "unknown";
  referenceLabel: string;
  referenceReason: string;
  vwapUsed: boolean;
  vwapReliability: IdcaVwapReliability;
  vwapStatus: string;
  vwapRejectReason: string | null;
  hybridCandidatePrice: number | null;
  hybridCandidateMethod: string | null;
  hybridReason: string | null;
  anchorPrice: number | null;
  anchorTimestamp: string | null;
  anchorUpdatedAt: string | null;
  anchorAgeHours: number | null;
  anchorStatus: "active" | "stale" | "locked" | "fallback" | "imported" | "unknown";
  anchorReason: string;
  previousAnchor: {
    anchorPrice: number;
    anchorTimestamp: number;
    replacedAt?: number;
    invalidationReason?: string;
  } | null;
}

export interface MarketContextPreview {
  pair: string;
  anchorPrice: number;
  anchorTimestamp?: string;
  currentPrice: number;
  drawdownPct: number;
  vwapZone?: "below_lower3" | "below_lower2" | "below_lower1" | "between_bands" | "above_upper1" | "above_upper2" | "above_upper3";
  atrPct?: number;
  dataQuality: "excellent" | "good" | "poor" | "insufficient";
  priceUpdatedAt?: string;
  lastUpdated?: string;
  anchorPriceUpdatedAt?: string;
  anchorAgeHours?: number;
  anchorSource?: "vwap" | "window_high" | "frozen";
  qualityDetail?: MarketContextQualityDetail;
  // Ancla dinámica viva (para contexto de mercado visual - siempre usa basePrice/hybrid actual)
  marketAnchorLive?: number;
  marketAnchorLiveSource?: "hybrid_v2" | "swing_high_24h" | "swing_high_48h" | "vwap_context" | "unknown";
  marketAnchorLiveTimestamp?: string;
  marketAnchorLiveAgeHours?: number;
  drawdownFromLiveAnchorPct?: number;
  // Referencia efectiva de entrada (puede usar frozen anchor si hay ciclo activo)
  effectiveEntryReference?: number;
  effectiveReferenceSource?: "vwap_anchor" | "hybrid_v2_fallback";
  effectiveReferenceLabel?: string;
  technicalBasePrice: number;
  technicalBaseType: string;
  technicalBaseReason?: string;
  technicalBaseTimestamp?: string;
  frozenAnchorPrice?: number;
  frozenAnchorTs?: number;
  frozenAnchorAgeHours?: number;
  frozenAnchorCandleAgeHours?: number;
  referenceChangedRecently: boolean;
  referenceUpdatedAt?: string;
  referenceContext?: IdcaReferenceContext | null;
  // FASE D: Metadata del precio base para fallback de timestamp
  basePriceMeta?: {
    selectedMethod?: string;
    selectedAnchorTime?: string;
  };
}

/** Niveles de calidad de datos FASE C */
export type DataQualityLevel =
  | "none"
  | "insufficient"
  | "minimal"
  | "minimum_context"
  | "good_context"
  | "full_macro_context";

export interface MarketDataHealthResult {
  pair: string;
  timeframe: string;
  source: "kraken" | "mds_cache" | "db_fallback" | "unknown";
  candleCount: number;
  requiredCandles: number;
  sufficientCandles: number;
  minimumCandles: number;
  missingCandles: number;
  lastCandleTimestamp: number | null;
  lastCandleAgeMinutes: number | null;
  timeframeMinutes: number;
  estimatedReadyAt: string | null;
  hasGaps: boolean;
  gapCount: number;
  backfillStatus: "no_necesario" | "solicitado" | "completado" | "fallido" | "en_progreso";
  /** Estado de salud de datos timeframe-aware (FASE B) */
  dataReadinessState: "ready" | "lagging" | "stale" | "stopped" | "warmup" | "degraded";
  /** FASE C: Calidad de datos según profundidad */
  quality: DataQualityLevel;
  /** FASE C: Usable para entradas nuevas */
  usableForEntry: boolean;
  /** FASE C: Usable para contexto técnico */
  usableForContext: boolean;
  /** FASE C: Usable para análisis macro */
  usableForMacro: boolean;
  /** FASE C: Indica si viene de fallback */
  isFallback: boolean;
  canUseDynamicAnchor: boolean;
  canOpenNewIdcaCycle: boolean;
  /** Permite gestión de ciclos activos con precio spot */
  allowsActiveCycleManagement: boolean;
  /** Bloquea nuevas entradas main */
  blocksNewMain: boolean;
  reason: string;
  checkedAt: string;
}

export interface IdcaSummary {
  mode: string;
  schedulerMode?: string;
  liveCyclesCount?: number;
  liveCapitalUsedUsd?: number;
  hasLiveCyclesWithSimulationScheduler?: boolean;
  allocatedCapitalUsd: number;
  capitalUsedUsd: number;
  capitalFreeUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  activeCyclesCount: number;
  trailingActiveCount: number;
  buysToday: number;
  sellsToday: number;
  smartModeEnabled: boolean;
  simulationWallet: IdcaSimulationWallet;
  cycles: IdcaCycle[];
}

export interface IdcaSimulationWallet {
  id: number;
  initialBalanceUsd: string;
  availableBalanceUsd: string;
  usedBalanceUsd: string;
  realizedPnlUsd: string;
  unrealizedPnlUsd: string;
  totalEquityUsd: string;
  totalCyclesSimulated: number;
  totalOrdersSimulated: number;
  lastResetAt: string;
}

export interface IdcaHealth {
  isRunning: boolean;
  lastTickAt: string | null;
  lastError: string | null;
  tickCount: number;
  schedulerActive: boolean;
  mode: string;
  enabled: boolean;
  toggleEnabled: boolean;
  globalPause: boolean;
}

// ─── Hooks ─────────────────────────────────────────────────────────

export function useIdcaControls() {
  return useQuery<IdcaControls>({
    queryKey: ["idca", "controls"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/controls`);
      if (!res.ok) throw new Error("Failed to fetch IDCA controls");
      return res.json();
    },
    refetchInterval: 10000,
  });
}

export function useIdcaConfig() {
  return useQuery<IdcaConfig>({
    queryKey: ["idca", "config"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/config`);
      if (!res.ok) throw new Error("Failed to fetch IDCA config");
      return res.json();
    },
  });
}

export function useIdcaAssetConfigs() {
  return useQuery<IdcaAssetConfig[]>({
    queryKey: ["idca", "assetConfigs"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/asset-configs`);
      if (!res.ok) throw new Error("Failed to fetch IDCA asset configs");
      return res.json();
    },
  });
}

export function useIdcaSummary() {
  return useQuery<IdcaSummary>({
    queryKey: ["idca", "summary"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/summary`);
      if (!res.ok) throw new Error("Failed to fetch IDCA summary");
      return res.json();
    },
    refetchInterval: 15000,
  });
}

export function useIdcaCycles(filters?: { mode?: string; pair?: string; status?: string; limit?: number }) {
  return useQuery<IdcaCycle[]>({
    queryKey: ["idca", "cycles", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.mode) params.set("mode", filters.mode);
      if (filters?.pair) params.set("pair", filters.pair);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const res = await fetch(`${PREFIX}/cycles?${params}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA cycles");
      return res.json();
    },
    refetchInterval: 15000,
  });
}

export function useIdcaActiveCycles() {
  return useQuery<IdcaCycle[]>({
    queryKey: ["idca", "cycles", "active"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/cycles/active`);
      if (!res.ok) throw new Error("Failed to fetch active cycles");
      return res.json();
    },
    refetchInterval: 10000,
  });
}

export function useIdcaOrders(filters?: { mode?: string; pair?: string; limit?: number }) {
  return useQuery<IdcaOrder[]>({
    queryKey: ["idca", "orders", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.mode) params.set("mode", filters.mode);
      if (filters?.pair) params.set("pair", filters.pair);
      if (filters?.limit) params.set("limit", String(filters.limit || 50));
      const res = await fetch(`${PREFIX}/orders?${params}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA orders");
      return res.json();
    },
    refetchInterval: 15000,
  });
}

export function useIdcaEvents(filters?: {
  cycleId?: number;
  eventType?: string;
  mode?: string;
  pair?: string;
  severity?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'severity';
  orderDirection?: 'asc' | 'desc';
}) {
  // Stable query key: convert Date objects to second-precision ISO strings
  // so the key doesn't change on every render (Date.now() changes by ms).
  const stableKey = {
    ...filters,
    dateFrom: filters?.dateFrom ? truncDateToSec(filters.dateFrom) : undefined,
    dateTo: filters?.dateTo ? truncDateToSec(filters.dateTo) : undefined,
  };
  return useQuery<IdcaEvent[]>({
    queryKey: ["idca", "events", stableKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.cycleId) params.set("cycleId", String(filters.cycleId));
      if (filters?.eventType) params.set("eventType", filters.eventType);
      if (filters?.mode) params.set("mode", filters.mode);
      if (filters?.pair) params.set("pair", filters.pair);
      if (filters?.severity) params.set("severity", filters.severity);
      if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom.toISOString());
      if (filters?.dateTo) params.set("dateTo", filters.dateTo.toISOString());
      if (filters?.limit) params.set("limit", String(filters.limit));
      if (filters?.offset) params.set("offset", String(filters.offset));
      if (filters?.orderBy) params.set("orderBy", filters.orderBy);
      if (filters?.orderDirection) params.set("orderDirection", filters.orderDirection);
      
      const res = await fetch(`${PREFIX}/events?${params}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA events");
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useIdcaEventsCount(filters?: {
  cycleId?: number;
  eventType?: string;
  mode?: string;
  pair?: string;
  severity?: string;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const stableKey = {
    ...filters,
    dateFrom: filters?.dateFrom ? truncDateToSec(filters.dateFrom) : undefined,
    dateTo: filters?.dateTo ? truncDateToSec(filters.dateTo) : undefined,
  };
  return useQuery<{ count: number }>({
    queryKey: ["idca", "events", "count", stableKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.cycleId) params.set("cycleId", String(filters.cycleId));
      if (filters?.eventType) params.set("eventType", filters.eventType);
      if (filters?.mode) params.set("mode", filters.mode);
      if (filters?.pair) params.set("pair", filters.pair);
      if (filters?.severity) params.set("severity", filters.severity);
      if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom.toISOString());
      if (filters?.dateTo) params.set("dateTo", filters.dateTo.toISOString());
      
      const res = await fetch(`${PREFIX}/events/count?${params}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA events count");
      return res.json();
    },
    refetchInterval: 30000,
  });
}

export function useIdcaEventsPurge() {
  const qc = useQueryClient();
  return useMutation<
    { success: boolean; deletedCount: number; retentionDays: number; message: string },
    Error,
    { retentionDays?: number; batchSize?: number }
  >({
    mutationFn: async (options = {}) => {
      const res = await apiRequest("POST", `${PREFIX}/events/purge`, options);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "events"] });
      qc.invalidateQueries({ queryKey: ["idca", "events", "count"] });
    },
  });
}

export function useIdcaSimulationWallet() {
  return useQuery<IdcaSimulationWallet>({
    queryKey: ["idca", "simulationWallet"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/simulation/wallet`);
      if (!res.ok) throw new Error("Failed to fetch simulation wallet");
      return res.json();
    },
    refetchInterval: 15000,
  });
}

export function useIdcaHealth() {
  return useQuery<IdcaHealth>({
    queryKey: ["idca", "health"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/health`);
      if (!res.ok) throw new Error("Failed to fetch IDCA health");
      return res.json();
    },
    refetchInterval: 10000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────

export function useUpdateIdcaControls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<IdcaControls>) => {
      const res = await apiRequest("PATCH", `${PREFIX}/controls`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "controls"] });
      qc.invalidateQueries({ queryKey: ["idca", "health"] });
    },
  });
}

export function useUpdateIdcaConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<IdcaConfig>) => {
      const res = await apiRequest("PATCH", `${PREFIX}/config`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useUpdateAssetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pair, ...patch }: Partial<IdcaAssetConfig> & { pair: string }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/asset-configs/${encodeURIComponent(pair)}`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "assetConfigs"] });
      // Invalidar queries de ciclos para refrescar datos actualizados (ej: trailingPct)
      qc.invalidateQueries({ queryKey: ["idca", "cycles"] });
    },
  });
}

export function useUpdateTrailingBuyPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `${PREFIX}/config/telegram-trailing-buy`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useEmergencyCloseAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${PREFIX}/emergency/close-all`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useResetSimulationWallet() {
  const qc = useQueryClient();
  return useMutation<{
    wallet: IdcaSimulationWallet;
    cyclesClosed: number;
    ordersDeleted: number;
    eventsDeleted: number;
  }, Error, number | undefined>({
    mutationFn: async (initialBalance?: number) => {
      const res = await apiRequest("POST", `${PREFIX}/simulation/reset`, { initialBalance });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to reset simulation");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useIdcaTelegramTest() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${PREFIX}/telegram/test`);
      return res.json();
    },
  });
}

export function useIdcaTelegramStatus() {
  return useQuery({
    queryKey: [PREFIX, "telegram", "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `${PREFIX}/telegram/status`);
      return res.json() as Promise<{
        enabled: boolean;
        chatIdConfigured: boolean;
        serviceInitialized: boolean;
        mode: string;
        cooldownSeconds: number;
        simulationAlertsEnabled: boolean;
        toggles: Record<string, boolean>;
      }>;
    },
    refetchInterval: 30000,
  });
}

// ─── Import Position ──────────────────────────────────────────────

export interface ImportableStatus {
  mode: string;
  pairs: Record<string, { canImport: boolean; hasActiveCycle: boolean; reason?: string }>;
}

export interface ImportPositionPayload {
  pair: string;
  quantity: number | string;
  avgEntryPrice: number | string;
  capitalUsedUsd?: number | string;
  sourceType?: string;
  soloSalida?: boolean;
  notes?: string;
  openedAt?: string;
  feesPaidUsd?: number | string;
  isManualCycle?: boolean;
  exchangeSource?: string;
  estimatedFeePct?: number | string;
  estimatedFeeUsd?: number | string;
  feesOverrideManual?: boolean;
  warningAcknowledged?: boolean;
}

export interface ExchangeFeePreset {
  key: string;
  label: string;
  makerFeePct: number | null;
  takerFeePct: number | null;
  defaultFeePct: number;
  defaultFeeMode: string;
  useConfigurableDefault: boolean;
  description: string;
}

export function useExchangeFeePresets() {
  return useQuery<{ presets: Record<string, ExchangeFeePreset>; defaultExchange: string }>({
    queryKey: ["idca", "exchangeFeePresets"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/exchange-fee-presets`);
      if (!res.ok) throw new Error("Failed to fetch exchange fee presets");
      return res.json();
    },
    staleTime: 60000,
  });
}

export function useImportableStatus() {
  return useQuery<ImportableStatus>({
    queryKey: ["idca", "importableStatus"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/importable-status`);
      if (!res.ok) throw new Error("Failed to fetch importable status");
      return res.json();
    },
    staleTime: 10000,
  });
}

export function useImportPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ImportPositionPayload) => {
      const res = await apiRequest("POST", `${PREFIX}/import-position`, payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useToggleSoloSalida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleId, soloSalida }: { cycleId: number; soloSalida: boolean }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/cycles/${cycleId}/solo-salida`, { soloSalida });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useToggleTimeStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleId, disabled }: { cycleId: number; disabled: boolean }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/cycles/${cycleId}/time-stop`, { disabled });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useDeleteManualCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cycleId: number) => {
      const res = await apiRequest("DELETE", `${PREFIX}/cycles/${cycleId}/manual`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useDeleteCycleForce() {
  const qc = useQueryClient();
  return useMutation<{
    success: boolean;
    deleted: boolean;
    reason: string;
    ordersDeleted: number;
    eventsDeleted: number;
    cycleId: number;
    pair?: string;
    mode?: string;
  }, Error, number>({
    mutationFn: async (cycleId: number) => {
      const res = await apiRequest("DELETE", `${PREFIX}/cycles/${cycleId}/force`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to delete cycle");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

// ─── Manual Close Cycle ────────────────────────────────────────────

export interface ManualCloseCycleResult {
  success: boolean;
  cycleId: number;
  pair: string;
  mode: string;
  sellPrice: number;
  quantity: number;
  grossValueUsd: number;
  netValueUsd: number;
  realizedPnlUsd: number;
  realizedPnlPct: number;
}

export function useManualCloseCycle() {
  const qc = useQueryClient();
  return useMutation<ManualCloseCycleResult, Error, number>({
    mutationFn: async (cycleId: number) => {
      const res = await apiRequest("POST", `${PREFIX}/cycles/${cycleId}/close-manual`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to close cycle");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

// ─── Delete Orders ─────────────────────────────────────────────────

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; deleted: boolean; orderId: number }, Error, number>({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("DELETE", `${PREFIX}/orders/${orderId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to delete order");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca", "orders"] });
    },
  });
}

export function useDeleteAllOrders() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; deletedCount: number; mode?: string; cycleId?: number }, Error, { mode?: string; cycleId?: number }>({
    mutationFn: async ({ mode, cycleId }: { mode?: string; cycleId?: number } = {}) => {
      const params = new URLSearchParams();
      if (mode) params.set("mode", mode);
      if (cycleId) params.set("cycleId", String(cycleId));
      const res = await apiRequest("DELETE", `${PREFIX}/orders?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to delete orders");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useSetCycleStatus() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; cycle: any }, Error, { cycleId: number; status: 'active' | 'paused' | 'blocked' }>({
    mutationFn: async ({ cycleId, status }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/cycles/${cycleId}/status`, { status });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to set cycle status");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

export function useIdcaClosedCycles(limit: number = 50) {
  return useQuery<IdcaCycle[]>({
    queryKey: ["idca", "cycles", "closed", limit],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/cycles?status=closed&limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch closed cycles");
      return res.json();
    },
    refetchInterval: 30000,
  });
}

export function useIdcaCycleEvents(cycleId: number | null) {
  return useQuery<IdcaEvent[]>({
    queryKey: ["idca", "events", "cycle", cycleId],
    queryFn: async () => {
      if (!cycleId) return [];
      const res = await fetch(`${PREFIX}/events?cycleId=${cycleId}&limit=100`);
      if (!res.ok) throw new Error("Failed to fetch cycle events");
      return res.json();
    },
    enabled: !!cycleId,
    staleTime: 30000,
  });
}

export function useIdcaCycleOrders(cycleId: number | null) {
  return useQuery<IdcaOrder[]>({
    queryKey: ["idca", "cycles", cycleId, "orders"],
    queryFn: async () => {
      if (!cycleId) return [];
      const res = await fetch(`${PREFIX}/cycles/${cycleId}`);
      if (!res.ok) throw new Error("Failed to fetch cycle orders");
      const data = await res.json();
      return data.orders || [];
    },
    enabled: !!cycleId,
    staleTime: 30000,
  });
}

// ─── Edit Imported Cycle ──────────────────────────────────────────

export interface EditImportedCyclePayload {
  avgEntryPrice?: number | string;
  quantity?: number | string;
  capitalUsedUsd?: number | string;
  exchangeSource?: string;
  startedAt?: string;
  soloSalida?: boolean;
  notes?: string;
  feesPaidUsd?: number | string;
  estimatedFeePct?: number | string;
  editReason: string;
  editAcknowledged: boolean;
}

export interface EditImportedCycleResult {
  success: boolean;
  cycle: IdcaCycle;
  activityCheck: {
    case: "A_no_activity" | "B_with_activity";
    buyCount: number;
    safetyBuys: number;
    postImportSells: number;
    warnings: string[];
  };
  editHistory: {
    editedAt: string;
    reason: string;
    case: string;
    changes: Record<string, { old: string | number | null; new: string | number | null }>;
    derivedImpact: Record<string, { old: string | number | null; new: string | number | null }>;
  };
}

export function useEditImportedCycle() {
  const qc = useQueryClient();
  return useMutation<EditImportedCycleResult, Error, { cycleId: number; payload: EditImportedCyclePayload }>({
    mutationFn: async ({ cycleId, payload }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/cycles/${cycleId}/edit-imported`, payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to edit imported cycle");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

// ─── Market Context Preview ───────────────────────────────────────

export function useMarketContextPreview(pair: string) {
  return useQuery<MarketContextPreview, Error>({
    queryKey: ["idca", "market-context-preview", pair],
    queryFn: async () => {
      const res = await apiRequest("GET", `${PREFIX}/market-context/preview/${encodeURIComponent(pair)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to fetch market context preview");
      }
      return res.json();
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  });
}

export function useAllMarketContextPreviews() {
  return useQuery<MarketContextPreview[], Error>({
    queryKey: ["idca", "market-context-preview-all"],
    queryFn: async () => {
      const res = await apiRequest("GET", `${PREFIX}/market-context/preview`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to fetch all market context previews");
      }
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useMarketDataHealth(pair: string) {
  return useQuery<MarketDataHealthResult, Error>({
    queryKey: ["idca", "market-data-health", pair],
    queryFn: async () => {
      const res = await apiRequest("GET", `${PREFIX}/market-data-health/${encodeURIComponent(pair)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to fetch market data health");
      }
      return res.json();
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
}

export function useAllMarketDataHealth() {
  return useQuery<MarketDataHealthResult[], Error>({
    queryKey: ["idca", "market-data-health-all"],
    queryFn: async () => {
      const res = await apiRequest("GET", `${PREFIX}/market-data-health`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to fetch all market data health");
      }
      return res.json();
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
}

// ─── Ladder ATRP Preview ───────────────────────────────────────────

export function useLadderPreview(pair: string, profile: "aggressive" | "balanced" | "conservative" | "custom", sliderIntensity: number, depthMode?: "normal" | "deep" | "manual", targetCoveragePct?: number, manualLevelEnabled?: boolean, manualMultipliers?: number[], manualSizeDistribution?: number[]) {
  return useQuery<LadderPreview, Error>({
    queryKey: ["idca", "ladder-preview", pair, profile, sliderIntensity, depthMode, targetCoveragePct, manualLevelEnabled, manualMultipliers, manualSizeDistribution],
    queryFn: async () => {
      const params = new URLSearchParams({
        profile,
        sliderIntensity: sliderIntensity.toString(),
      });
      if (depthMode) params.append("depthMode", depthMode);
      if (targetCoveragePct !== undefined) params.append("targetCoveragePct", targetCoveragePct.toString());
      if (manualLevelEnabled !== undefined) params.append("manualLevelEnabled", manualLevelEnabled.toString());
      if (manualMultipliers) params.append("manualMultipliers", manualMultipliers.join(","));
      if (manualSizeDistribution) params.append("manualSizeDistribution", manualSizeDistribution.join(","));
      const res = await apiRequest("GET", `${PREFIX}/ladder/preview/${encodeURIComponent(pair)}?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to fetch ladder preview");
      }
      return res.json();
    },
    staleTime: 30000,
    enabled: !!pair && !!profile && sliderIntensity >= 0 && sliderIntensity <= 100,
  });
}

// ─── Ladder ATRP Config Mutations ───────────────────────────────────

export function useUpdateLadderAtrpConfig() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, { pair: string; config: any }>({
    mutationFn: async ({ pair, config }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/asset-configs/${encodeURIComponent(pair)}`, {
        ladderAtrpConfigJson: config,
        ladderAtrpEnabled: config.enabled,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to update ladder ATRP config");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
      qc.invalidateQueries({ queryKey: ["idca", "ladder-preview"] });
    },
  });
}

export function useUpdateTrailingBuyLevel1Config() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, { pair: string; config: any }>({
    mutationFn: async ({ pair, config }) => {
      const res = await apiRequest("PATCH", `${PREFIX}/asset-configs/${encodeURIComponent(pair)}`, {
        trailingBuyLevel1ConfigJson: config,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to update trailing buy level 1 config");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["idca"] });
    },
  });
}

// ─── Lote 4: Exit Instructions ────────────────────────────────────

export type ExitInstructionStatus =
  | "pending" | "executing" | "executed"
  | "cancelled" | "failed" | "failed_requires_review";

export type ExitInstructionType = "immediate" | "price_target" | "scheduled_time";

export interface IdcaExitInstruction {
  id: number;
  cycleId: number;
  pair: string;
  mode: string;
  type: ExitInstructionType;
  triggerPrice: string | null;
  triggerDirection: "above" | "below" | null;
  triggerTime: string | null;
  timezone: string;
  closePct: string;
  requestedQuantity: string | null;
  status: ExitInstructionStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  executingStartedAt: string | null;
  executionClientOrderId: string | null;
  executedAt: string | null;
  executionExchangeOrderId: string | null;
  executionPrice: string | null;
  executionQuantity: string | null;
  costBasisSoldUsd: string | null;
  realizedPnlIncrementUsd: string | null;
  remainingCapitalUsedUsd: string | null;
  remainingCycleQuantityAfter: string | null;
  grossValueUsd: string | null;
  feesUsd: string | null;
  netValueUsd: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  failureReason: string | null;
  notes: string | null;
}

export interface ExitInstructionsResponse {
  instructions: IdcaExitInstruction[];
  activeInstruction: IdcaExitInstruction | null;
}

export function useExitInstructions(cycleId: number | null) {
  return useQuery<ExitInstructionsResponse>({
    queryKey: ["idca", "exit-instructions", cycleId],
    queryFn: async () => {
      if (!cycleId) return { instructions: [], activeInstruction: null };
      const res = await apiRequest("GET", `${PREFIX}/cycles/${cycleId}/exit-instructions`);
      if (!res.ok) throw new Error("Failed to fetch exit instructions");
      return res.json();
    },
    enabled: !!cycleId,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

export function useCreateExitInstruction() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean; instruction: IdcaExitInstruction }, Error, {
    cycleId: number;
    type: ExitInstructionType;
    closePct: number;
    triggerPrice?: number;
    triggerDirection?: "above" | "below";
    triggerTime?: string;
    timezone?: string;
    notes?: string;
  }>({
    mutationFn: async ({ cycleId, ...body }) => {
      const res = await apiRequest("POST", `${PREFIX}/cycles/${cycleId}/exit-instructions`, body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to create exit instruction");
      }
      return res.json();
    },
    onSuccess: (_data, { cycleId }) => {
      qc.invalidateQueries({ queryKey: ["idca", "exit-instructions", cycleId] });
      qc.invalidateQueries({ queryKey: ["idca", "cycles"] });
    },
  });
}

export function useCancelExitInstruction() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, { cycleId: number; instrId?: number }>({
    mutationFn: async ({ cycleId, instrId }) => {
      const url = instrId
        ? `${PREFIX}/cycles/${cycleId}/exit-instructions/${instrId}`
        : `${PREFIX}/cycles/${cycleId}/exit-instructions`;
      const res = await apiRequest("DELETE", url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Failed to cancel exit instruction");
      }
      return res.json();
    },
    onSuccess: (_data, { cycleId }) => {
      qc.invalidateQueries({ queryKey: ["idca", "exit-instructions", cycleId] });
      qc.invalidateQueries({ queryKey: ["idca", "cycles"] });
    },
  });
}

// ─── Terminal Logs ─────────────────────────────────────────────────

export interface IdcaTerminalLog {
  id: number;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | string;
  pair: string | null;
  mode: string | null;
  source: string;
  eventType: string | null;
  event: string | null;
  message: string;
  raw: string | null;
  payload: Record<string, unknown> | null;
}

export interface IdcaTerminalLogsResponse {
  logs: IdcaTerminalLog[];
  count: number;
  hasMore?: boolean;
  success?: boolean;
  fallback?: boolean;
  source?: string;
}

// ─── Hook principal: usa /logs (server_logs filtrado por IDCA) ──────────────

export function useIdcaLogs(filters: {
  pair?: string;
  mode?: string;
  level?: string;
  search?: string;
  hours?: number;
  limit?: number;
  enabled?: boolean;
}) {
  const stableKey = { ...filters };

  return useQuery<IdcaTerminalLogsResponse>({
    queryKey: ["idca", "logs-v2", stableKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.pair)   params.set("pair",   filters.pair);
      if (filters.mode)   params.set("mode",   filters.mode);
      if (filters.level)  params.set("level",  filters.level);
      if (filters.search) params.set("search", filters.search);
      if (filters.hours)  params.set("hours",  String(filters.hours));
      if (filters.limit)  params.set("limit",  String(filters.limit));

      // Intentar nuevo endpoint /logs primero
      try {
        const res = await fetch(`${PREFIX}/logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success !== false) return data;
        }
      } catch (_e) {
        // fallback below
      }

      // Fallback al endpoint antiguo terminal/logs
      const fallbackParams = new URLSearchParams();
      if (filters.pair)  fallbackParams.set("pair",  filters.pair);
      if (filters.mode)  fallbackParams.set("mode",  filters.mode);
      if (filters.level) fallbackParams.set("level", filters.level);
      if (filters.search) fallbackParams.set("q",    filters.search);
      if (filters.limit) fallbackParams.set("limit", String(filters.limit));
      const fallbackRes = await fetch(`${PREFIX}/terminal/logs?${fallbackParams}`);
      if (!fallbackRes.ok) throw new Error("Failed to fetch IDCA logs");
      const fallbackData = await fallbackRes.json();
      return {
        ...fallbackData,
        success: true,
        source: 'terminal_fallback',
        logs: (fallbackData.logs ?? []).map((l: any) => ({
          ...l,
          event: l.eventType ?? null,
          raw: l.message ?? null,
        })),
      };
    },
    staleTime: 5000,
    refetchInterval: filters.enabled !== false ? 8000 : false,
  });
}

// ─── Hook legacy (compatibilidad) — llama al mismo hook ────────────────────

export function useIdcaTerminalLogs(filters: {
  pair?: string;
  mode?: string;
  level?: string;
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  enabled?: boolean;
}) {
  const hours = filters.from
    ? Math.ceil((Date.now() - filters.from.getTime()) / (60 * 60 * 1000))
    : 24;

  return useIdcaLogs({
    pair:    filters.pair,
    mode:    filters.mode,
    level:   filters.level,
    search:  filters.q,
    hours:   Math.min(hours, 168),
    limit:   filters.limit,
    enabled: filters.enabled,
  });
}

// --- Entry Diagnostics (Sprint 2) ---

export interface IdcaEntryDiagnosticPair {
  pair: string;
  currentPrice: number;
  entryMode: string;
  referencePrice: number;
  referenceMethod: string;
  drawdownFromReferencePct: number;
  requiredDistancePct: number;
  atrPct: number;
  candleCount: number;
  decisionClass: string;
  confidenceScore: number;
  confidenceGrade: string;
  marketRegime: string;
  hardBlocked: boolean;
  hardBlockers: string[];
  degradingBlockers: string[];
  familyScores: {
    valueScore: number;
    confirmationScore: number;
    riskScore: number;
    dataScore: number;
    regimeScore: number;
  };
  canArmTrailingBuy: boolean;
  finalRequiredDistancePct: number;
  timestamp: string;
  error?: string;
}

export interface IdcaEntryDiagnosticsResponse {
  pairs: Record<string, IdcaEntryDiagnosticPair>;
  generatedAt: string;
}

export function useIdcaEntryDiagnostics() {
  return useQuery<IdcaEntryDiagnosticsResponse>({
    queryKey: ["idca", "entry-diagnostics"],
    queryFn: async () => {
      const res = await fetch(`${PREFIX}/entry-diagnostics`);
      if (!res.ok) throw new Error("Failed to fetch entry diagnostics");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 20000,
  });
}
