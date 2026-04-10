/**
 * React hooks for the Institutional DCA module.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const PREFIX = "/api/institutional-dca";

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
  [key: string]: any;
}

export interface IdcaAssetConfig {
  id: number;
  pair: string;
  enabled: boolean;
  minDipPct: string;
  dipReference: string;
  requireReboundConfirmation: boolean;
  trailingBuyEnabled: boolean;
  safetyOrdersJson: { dipPct: number; sizePctOfAssetBudget: number }[];
  maxSafetyOrders: number;
  takeProfitPct: string;
  dynamicTakeProfit: boolean;
  trailingPct: string;
  partialTakeProfitPct: string;
  breakevenEnabled: boolean;
  protectionActivationPct: string;
  trailingActivationPct: string;
  trailingMarginPct: string;
  cooldownMinutesBetweenBuys: number;
  maxCycleDurationHours: number;
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
  entryDipPct: string | null;
  protectionArmedAt: string | null;
  protectionStopPrice: string | null;
  lastManualEditAt: string | null;
  lastManualEditReason: string | null;
  editHistoryJson: any;
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

export interface IdcaSummary {
  mode: string;
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
  simulationWallet: any;
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

export function useIdcaEvents(filters?: { cycleId?: number; eventType?: string; limit?: number }) {
  return useQuery<IdcaEvent[]>({
    queryKey: ["idca", "events", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.cycleId) params.set("cycleId", String(filters.cycleId));
      if (filters?.eventType) params.set("eventType", filters.eventType);
      if (filters?.limit) params.set("limit", String(filters.limit || 100));
      const res = await fetch(`${PREFIX}/events?${params}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA events");
      return res.json();
    },
    refetchInterval: 15000,
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
