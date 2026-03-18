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
  return useMutation({
    mutationFn: async (initialBalance?: number) => {
      const res = await apiRequest("POST", `${PREFIX}/simulation/reset`, { initialBalance });
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
