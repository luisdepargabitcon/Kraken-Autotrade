import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Activity, 
  CandlestickChart,
  CircleDot,
  Zap,
  Target,
  BarChart3,
  Layers,
  Square,
  X,
  Loader2,
  Trash2,
  AlertTriangle,
  Timer,
  TimerOff
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface OpenPosition {
  id: number;
  pair: string;
  entryPrice: string;
  amount: string;
  highestPrice: string;
  openedAt: string;
  currentPrice: string;
  unrealizedPnlUsd: string;
  unrealizedPnlPct: string;
  netPnlUsd: string;
  netPnlPct: string;
  entryValueUsd: string;
  currentValueUsd: string;
  entryStrategyId: string;
  entrySignalTf: string;
  signalConfidence: string | null;
  lotId?: string | null;
  entryMode?: string | null;
  timeStopDisabled?: boolean;
  timeStopExpiredAt?: string | null;
  entryFee?: string | null;
}

interface ClosedTrade {
  id: number;
  tradeId: string;
  exchange?: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  status: string;
  entryPrice: string | null;
  totalUsd: string;
  entryValueUsd: string | null;
  realizedPnlUsd: string | null;
  realizedPnlPct: string | null;
  executedAt: string | null;
  createdAt: string;
}

interface ClosedTradesResponse {
  trades: ClosedTrade[];
  total: number;
  limit: number;
  offset: number;
}

export default function Terminal() {
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [pairFilter, setPairFilter] = useState<string>("all");
  const [exchangeFilter, setExchangeFilter] = useState<string>("all");
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("positions");
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [deletingOrphanKey, setDeletingOrphanKey] = useState<string | null>(null);
  const [togglingTimeStopKey, setTogglingTimeStopKey] = useState<string | null>(null);
  const [orphanDialogOpen, setOrphanDialogOpen] = useState(false);
  const [orphanToDelete, setOrphanToDelete] = useState<{ lotId: string; pair: string; amount: string } | null>(null);
  const [dustPositions, setDustPositions] = useState<Set<string>>(new Set());
  const [selectedPosition, setSelectedPosition] = useState<OpenPosition | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const getPositionKey = (pair: string, lotId?: string | null) => lotId || pair;

  const { data: botConfig } = useQuery<{ 
    positionMode?: string; 
    activePairs?: string[];
    sgMaxOpenLotsPerPair?: number;
    sgBePct?: string;
    sgTrailStartPct?: string;
    sgTrailDistancePct?: string;
    sgTpPct?: string;
    sgTimeStopHours?: number;
    adaptiveExitEnabled?: boolean;
    takerFeePct?: string;
  }>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: openPositions, isLoading: loadingPositions, refetch: refetchPositions, isFetching: fetchingPositions } = useQuery<OpenPosition[]>({
    queryKey: ["openPositions"],
    queryFn: async () => {
      const res = await fetch("/api/open-positions");
      if (!res.ok) throw new Error("Failed to fetch open positions");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const lotsCountByPair = useMemo(() => {
    if (!openPositions) return new Map<string, { count: number; max: number }>();
    const maxLots = botConfig?.sgMaxOpenLotsPerPair || 1;
    const counts = new Map<string, { count: number; max: number }>();
    for (const pos of openPositions) {
      const current = counts.get(pos.pair);
      counts.set(pos.pair, { count: (current?.count || 0) + 1, max: maxLots });
    }
    return counts;
  }, [openPositions, botConfig?.sgMaxOpenLotsPerPair]);

  const getLotsCountByPair = (pair: string) => {
    return lotsCountByPair.get(pair) || { count: 0, max: botConfig?.sgMaxOpenLotsPerPair || 1 };
  };

  const { data: closedData, isLoading: loadingClosed, refetch: refetchClosed, isFetching: fetchingClosed } = useQuery<ClosedTradesResponse>({
    queryKey: ["closedTrades", limit, offset, pairFilter, exchangeFilter, resultFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        result: resultFilter,
        type: typeFilter,
      });
      if (pairFilter !== "all") {
        params.set("pair", pairFilter);
      }
      if (exchangeFilter !== "all") {
        params.set("exchange", exchangeFilter);
      }
      const res = await fetch(`/api/trades/closed?${params}`);
      if (!res.ok) throw new Error("Failed to fetch closed trades");
      return res.json();
    },
  });

  const handleSyncFromKraken = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/trades/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Sincronizado",
          description: `Se importaron ${data.synced} operaciones de Kraken (${data.total} en historial)`,
        });
        refetchClosed();
      } else {
        toast({
          title: "Error",
          description: data.error || "Error al sincronizar",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Error de conexión",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncFromRevolutX = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/trades/sync-revolutx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(pairFilter !== "all" ? { pair: pairFilter } : {}), limit: 100, allowAssumedSide: true }),
      });
      const data = await res.json();

      if (res.ok) {
        toast({
          title: "Sincronizado",
          description: `RevolutX ${data.scope || (pairFilter !== "all" ? pairFilter : "ALL")}: +${data.synced} (fetched ${data.fetched}, skipped ${data.skipped})`,
        });
        refetchClosed();
      } else {
        toast({
          title: "Error",
          description: data.message || data.error || "Error al sincronizar RevolutX",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Error de conexión",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };


  const closePositionMutation = useMutation({
    mutationFn: async ({ pair, lotId, amount }: { pair: string; lotId?: string | null; amount?: string }) => {
      const pairEncoded = pair.replace("/", "-");
      const body: { reason: string; lotId?: string } = { reason: "Cierre manual desde dashboard" };
      if (lotId) body.lotId = lotId;
      const res = await fetch(`/api/positions/${pairEncoded}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // Check for DUST response (comes as 200 with isDust flag)
      if (data.isDust && lotId) {
        return { ...data, _isDust: true, _lotId: lotId, _pair: pair, _amount: amount };
      }
      if (!res.ok) {
        throw new Error(data.message || "Error al cerrar posición");
      }
      return data;
    },
    onMutate: ({ pair, lotId }) => {
      setClosingKey(getPositionKey(pair, lotId));
    },
    onSuccess: (data) => {
      // Handle DUST position - show dialog to delete orphan
      if (data._isDust && data._lotId) {
        setDustPositions(prev => new Set(prev).add(data._lotId));
        setOrphanToDelete({ lotId: data._lotId, pair: data._pair, amount: data._amount || "?" });
        setOrphanDialogOpen(true);
        toast({
          title: "Posición DUST",
          description: data.message || "Balance real menor al mínimo de Kraken",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: data.message?.includes("DRY_RUN") ? "Cierre Simulado" : "Posición Cerrada",
        description: `${data.pair}: PnL ${parseFloat(data.realizedPnlUsd) >= 0 ? '+' : ''}$${data.realizedPnlUsd} (${parseFloat(data.realizedPnlPct) >= 0 ? '+' : ''}${data.realizedPnlPct}%)`,
      });
      queryClient.invalidateQueries({ queryKey: ["openPositions"] });
      queryClient.invalidateQueries({ queryKey: ["closedTrades"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setClosingKey(null);
    },
  });

  // Mutation for deleting orphan DUST positions
  const deleteOrphanMutation = useMutation({
    mutationFn: async ({ lotId }: { lotId: string }) => {
      const res = await fetch(`/api/positions/${lotId}/orphan`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "orphan_dust_cleanup" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Error al eliminar posición huérfana");
      }
      return res.json();
    },
    onMutate: ({ lotId }) => {
      setDeletingOrphanKey(lotId);
    },
    onSuccess: (data) => {
      toast({
        title: "Posición Huérfana Eliminada",
        description: `${data.pair}: Registro interno eliminado (sin orden a Kraken)`,
      });
      setDustPositions(prev => {
        const next = new Set(prev);
        next.delete(data.lotId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["openPositions"] });
      queryClient.invalidateQueries({ queryKey: ["closedTrades"] });
      setOrphanDialogOpen(false);
      setOrphanToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setDeletingOrphanKey(null);
    },
  });

  // Mutation for reconciling positions with exchange (multi-exchange support)
  const reconcileMutation = useMutation({
    mutationFn: async ({ exchange, autoClean }: { exchange: string; autoClean: boolean }) => {
      const res = await fetch("/api/positions/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange, autoClean }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || data.message || "Error al reconciliar");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const { summary } = data;
      if (summary?.deleted > 0 || summary?.updated > 0) {
        toast({
          title: "Reconciliación Completada",
          description: `${data.exchange}: ${summary.deleted} eliminadas, ${summary.updated} actualizadas`,
        });
        queryClient.invalidateQueries({ queryKey: ["openPositions"] });
      } else {
        toast({
          title: "Todo OK",
          description: `${data.exchange}: Posiciones del bot sincronizadas`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClosePosition = (pair: string, lotId?: string | null, amount?: string) => {
    const displayId = lotId ? lotId.substring(0, 8) : pair;
    if (confirm(`¿Cerrar ${lotId ? `lote ${displayId}` : `posición`} de ${pair}? Esta acción no se puede deshacer.`)) {
      closePositionMutation.mutate({ pair, lotId, amount });
    }
  };

  const handleDeleteOrphan = (lotId: string, pair: string, amount: string) => {
    setOrphanToDelete({ lotId, pair, amount });
    setOrphanDialogOpen(true);
  };

  const confirmDeleteOrphan = () => {
    if (orphanToDelete) {
      deleteOrphanMutation.mutate({ lotId: orphanToDelete.lotId });
    }
  };

  const handleReconcileRevolutX = () => {
    if (confirm(`¿Reconciliar posiciones con Revolut X?\n\n✅ Posiciones del bot sin balance → ELIMINADAS\n✅ Posiciones del bot con qty diferente → ACTUALIZADAS\n❌ Holdings externos SIN posición del bot → NO se crean\n\nREGLA: open_positions = solo posiciones del bot, nunca balances externos.`)) {
      reconcileMutation.mutate({ exchange: 'revolutx', autoClean: true });
    }
  };

  const handleReconcileKraken = () => {
    if (confirm(`¿Reconciliar posiciones con Kraken?\n\n✅ Posiciones del bot sin balance → ELIMINADAS\n✅ Posiciones del bot con qty diferente → ACTUALIZADAS\n❌ Holdings externos SIN posición del bot → NO se crean\n\nREGLA: open_positions = solo posiciones del bot, nunca balances externos.`)) {
      reconcileMutation.mutate({ exchange: 'kraken', autoClean: true });
    }
  };

  const handleToggleTimeStop = async (lotId: string, currentlyDisabled: boolean, pair: string) => {
    setTogglingTimeStopKey(lotId);
    try {
      const res = await fetch(`/api/positions/${lotId}/time-stop`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !currentlyDisabled }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: !currentlyDisabled ? "Time-Stop Desactivado" : "Time-Stop Reactivado",
          description: `${pair}: ${data.message}`,
        });
        queryClient.invalidateQueries({ queryKey: ["openPositions"] });
      } else {
        toast({
          title: "Error",
          description: data.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTogglingTimeStopKey(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num >= 1000) {
      return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  };

  const formatStrategyLabel = (strategyId: string, timeframe: string) => {
    const strategyMap: Record<string, string> = {
      "momentum": "MOM",
      "momentum_candles_5m": "MOM",
      "momentum_candles_15m": "MOM",
      "momentum_candles_1h": "MOM",
      "mean_reversion": "REV",
      "scalping": "SCA",
      "grid": "GRD",
    };
    const tfMap: Record<string, string> = {
      "cycle": "CYC",
      "5m": "5M",
      "15m": "15M",
      "1h": "1H",
    };
    const strategyName = strategyMap[strategyId] || strategyId.split('_')[0]?.substring(0, 3).toUpperCase() || "MOM";
    const tfLabel = tfMap[timeframe] || timeframe.toUpperCase();
    const isCandles = timeframe !== "cycle";
    return { strategyName, tfLabel, isCandles };
  };

  const calculateExitStatus = (pos: OpenPosition) => {
    const currentPnlPct = parseFloat(pos.unrealizedPnlPct);
    const openedAt = new Date(pos.openedAt);
    const now = new Date();
    const hoursOpen = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60);
    
    const bePct = parseFloat(botConfig?.sgBePct || "2.5");
    const trailStartPct = parseFloat(botConfig?.sgTrailStartPct || "3.0");
    const trailDistancePct = parseFloat(botConfig?.sgTrailDistancePct || "1.5");
    const tpPct = parseFloat(botConfig?.sgTpPct || "5.0");
    const timeStopHours = botConfig?.sgTimeStopHours || 48;
    const adaptiveEnabled = botConfig?.adaptiveExitEnabled || false;
    
    const beActive = currentPnlPct >= bePct;
    const beProgress = Math.min(100, (currentPnlPct / bePct) * 100);
    const beRemaining = Math.max(0, bePct - currentPnlPct);
    
    const trailActive = currentPnlPct >= trailStartPct;
    const trailProgress = Math.min(100, (currentPnlPct / trailStartPct) * 100);
    const trailRemaining = Math.max(0, trailStartPct - currentPnlPct);
    
    const tpProgress = Math.min(100, (currentPnlPct / tpPct) * 100);
    const tpRemaining = Math.max(0, tpPct - currentPnlPct);
    
    const timeStopProgress = Math.min(100, (hoursOpen / timeStopHours) * 100);
    const timeStopRemaining = Math.max(0, timeStopHours - hoursOpen);
    const timeStopDisabled = pos.timeStopDisabled || false;
    
    let nextExit = "Ninguna activa";
    let nextExitType = "none";
    if (currentPnlPct >= tpPct) {
      nextExit = "Take-Profit (objetivo alcanzado)";
      nextExitType = "tp";
    } else if (trailActive) {
      nextExit = "Trailing Stop activo";
      nextExitType = "trail";
    } else if (beActive) {
      nextExit = "Break-Even protegiendo";
      nextExitType = "be";
    } else if (!timeStopDisabled && hoursOpen >= timeStopHours) {
      nextExit = "Time-Stop (tiempo excedido)";
      nextExitType = "time";
    } else if (currentPnlPct < 0) {
      nextExit = "Stop-Loss de emergencia";
      nextExitType = "sl";
    } else {
      nextExit = "Esperando condiciones de salida";
      nextExitType = "waiting";
    }
    
    return {
      bePct, beActive, beProgress, beRemaining,
      trailStartPct, trailActive, trailProgress, trailRemaining, trailDistancePct,
      tpPct, tpProgress, tpRemaining,
      timeStopHours, timeStopProgress, timeStopRemaining, timeStopDisabled,
      hoursOpen, adaptiveEnabled, nextExit, nextExitType, currentPnlPct
    };
  };

  const totalPages = closedData ? Math.ceil(closedData.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  const handlePrevPage = () => {
    if (offset > 0) {
      setOffset(Math.max(0, offset - limit));
    }
  };

  const handleNextPage = () => {
    if (closedData && offset + limit < closedData.total) {
      setOffset(offset + limit);
    }
  };

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
    setOffset(0);
  };

  const handleExchangeFilterChange = (value: string) => {
    setExchangeFilter(value);
    setOffset(0);
  };

  const handlePairFilterChange = (value: string) => {
    setPairFilter(value);
    setOffset(0);
  };

  const handleResultFilterChange = (value: string) => {
    setResultFilter(value);
    setOffset(0);
  };

  const handleLimitChange = (value: string) => {
    const newLimit = value === "all" ? 1000 : parseInt(value);
    setLimit(newLimit);
    setOffset(0);
  };

  const availablePairs = (botConfig?.activePairs && botConfig.activePairs.length > 0)
    ? botConfig.activePairs
    : ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

  const totalUnrealizedPnl = openPositions?.reduce((sum, pos) => sum + parseFloat(pos.unrealizedPnlUsd), 0) || 0;
  const positionsCount = openPositions?.length || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div 
        className="fixed inset-0 z-0 opacity-15 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        
        <main className="flex-1 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto w-full">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 rounded-lg flex items-center justify-center border border-cyan-500/30">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight text-foreground">TERMINAL</h1>
                <p className="text-xs text-muted-foreground font-mono">POSICIONES Y OPERACIONES</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div 
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                  botConfig?.positionMode === 'DCA' 
                    ? 'bg-purple-500/10 border-purple-500/30' 
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}
                data-testid="badge-position-mode"
              >
                {botConfig?.positionMode === 'DCA' 
                  ? <Layers className="h-3 w-3 text-purple-400" /> 
                  : <Square className="h-3 w-3 text-amber-400" />
                }
                <span className="font-mono text-xs text-muted-foreground">MODO:</span>
                <span className={`font-mono text-sm font-bold ${
                  botConfig?.positionMode === 'DCA' ? 'text-purple-400' : 'text-amber-400'
                }`}>
                  {botConfig?.positionMode || 'SINGLE'}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-card/50 rounded-lg border border-border/50">
                <CircleDot className={`h-3 w-3 ${positionsCount > 0 ? 'text-green-400 animate-pulse' : 'text-muted-foreground'}`} />
                <span className="font-mono text-xs text-muted-foreground">ACTIVAS:</span>
                <span className="font-mono text-sm font-bold">{positionsCount}</span>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${totalUnrealizedPnl >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                {totalUnrealizedPnl >= 0 ? <TrendingUp className="h-3 w-3 text-green-400" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
                <span className="font-mono text-xs text-muted-foreground">P&L:</span>
                <span className={`font-mono text-sm font-bold ${totalUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <TabsList className="bg-card/50 border border-border/50 p-1">
                <TabsTrigger 
                  value="positions" 
                  className="font-mono text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
                  data-testid="tab-positions"
                >
                  <Target className="h-3.5 w-3.5 mr-1.5" />
                  POSICIONES
                </TabsTrigger>
                <TabsTrigger 
                  value="history" 
                  className="font-mono text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
                  data-testid="tab-history"
                >
                  <Activity className="h-3.5 w-3.5 mr-1.5" />
                  HISTORIAL
                </TabsTrigger>
              </TabsList>

              {activeTab === "positions" && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetchPositions()}
                  disabled={fetchingPositions}
                  className="font-mono text-xs border-border/50 hover:border-cyan-500/50 hover:text-cyan-400"
                  data-testid="button-refresh-positions"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingPositions ? 'animate-spin' : ''}`} />
                  ACTUALIZAR
                </Button>
              )}

              {activeTab === "history" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
                    <SelectTrigger className="w-[90px] h-8 text-xs font-mono bg-card/50 border-border/50" data-testid="select-type-filter">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">TODAS</SelectItem>
                      <SelectItem value="buy">COMPRAS</SelectItem>
                      <SelectItem value="sell">VENTAS</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={exchangeFilter} onValueChange={handleExchangeFilterChange}>
                    <SelectTrigger className="w-[110px] h-8 text-xs font-mono bg-card/50 border-border/50" data-testid="select-exchange-filter">
                      <SelectValue placeholder="Exchange" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">TODOS</SelectItem>
                      <SelectItem value="kraken">KRAKEN</SelectItem>
                      <SelectItem value="revolutx">REVOLUTX</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={pairFilter} onValueChange={handlePairFilterChange}>
                    <SelectTrigger className="w-[100px] h-8 text-xs font-mono bg-card/50 border-border/50" data-testid="select-pair-filter">
                      <SelectValue placeholder="Par" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">TODOS</SelectItem>
                      {availablePairs.map(pair => (
                        <SelectItem key={pair} value={pair}>{pair}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={resultFilter} onValueChange={handleResultFilterChange}>
                    <SelectTrigger className="w-[100px] h-8 text-xs font-mono bg-card/50 border-border/50" data-testid="select-result-filter">
                      <SelectValue placeholder="Resultado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">TODAS</SelectItem>
                      <SelectItem value="winner">GANADORAS</SelectItem>
                      <SelectItem value="loser">PERDEDORAS</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={limit.toString()} onValueChange={handleLimitChange}>
                    <SelectTrigger className="w-[70px] h-8 text-xs font-mono bg-card/50 border-border/50" data-testid="select-limit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="all">TODO</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleSyncFromKraken}
                    disabled={syncing}
                    className="text-xs font-mono border-border/50 hover:border-cyan-500/50 hover:text-cyan-400"
                    data-testid="button-sync-kraken"
                    title="Importa historial de trades desde Kraken API"
                  >
                    <Download className={`h-3.5 w-3.5 mr-1 ${syncing ? 'animate-pulse' : ''}`} />
                    SYNC KRAKEN
                  </Button>

                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => refetchClosed()}
                    disabled={fetchingClosed}
                    className="text-xs font-mono border-border/50 hover:border-purple-500/50 hover:text-purple-400"
                    data-testid="button-refresh-revolutx"
                    title="SYNC RevolutX (historial privado) para el par seleccionado. Requiere elegir un par en el filtro."
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${fetchingClosed ? 'animate-spin' : ''}`} />
                    REFRESH REVOLUTX
                  </Button>

                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleSyncFromRevolutX}
                    disabled={syncing}
                    className="text-xs font-mono border-border/50 hover:border-purple-500/50 hover:text-purple-400"
                    data-testid="button-sync-revolutx"
                    title="Importa historial privado de RevolutX (ALL por defecto; si eliges un par, sincroniza solo ese par)."
                  >
                    <Download className={`h-3.5 w-3.5 mr-1 ${syncing ? 'animate-pulse' : ''}`} />
                    SYNC REVOLUTX
                  </Button>

                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => refetchClosed()}
                    disabled={fetchingClosed}
                    className="text-muted-foreground hover:text-cyan-400"
                    data-testid="button-refresh-closed"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${fetchingClosed ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              )}
            </div>

            <TabsContent value="positions" className="mt-0">
              <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
                <CardHeader className="py-3 px-4 border-b border-border/30">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                      <Zap className="h-4 w-4 text-cyan-400" />
                      POSICIONES ABIERTAS
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">
                        {openPositions?.length || 0} activa{openPositions?.length !== 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleReconcileRevolutX}
                          disabled={reconcileMutation.isPending}
                          className="h-7 text-[10px] font-mono border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                          data-testid="button-reconcile-revolutx"
                          title="Sincroniza posiciones con balances reales de Revolut X"
                        >
                          {reconcileMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          RECONCILIAR RX
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleReconcileKraken}
                          disabled={reconcileMutation.isPending}
                          className="h-7 text-[10px] font-mono border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                          data-testid="button-reconcile-kraken"
                          title="Sincroniza posiciones con balances reales de Kraken"
                        >
                          {reconcileMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          RECONCILIAR KR
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingPositions ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400"></div>
                    </div>
                  ) : openPositions && openPositions.length > 0 ? (
                    <div className="divide-y divide-border/20">
                      {openPositions.map((pos) => {
                        const pnlUsd = parseFloat(pos.unrealizedPnlUsd);
                        const pnlPct = parseFloat(pos.unrealizedPnlPct);
                        const isProfit = pnlUsd >= 0;
                        const strategyInfo = formatStrategyLabel(pos.entryStrategyId || "momentum", pos.entrySignalTf || "cycle");
                        
                        return (
                          <div 
                            key={pos.id}
                            className="flex flex-col lg:flex-row lg:items-center justify-between p-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                            data-testid={`position-row-${pos.id}`}
                            onClick={() => setSelectedPosition(pos)}
                          >
                            <div className="flex items-center gap-4 mb-3 lg:mb-0">
                              <div className="relative">
                                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${isProfit ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                  {isProfit ? <TrendingUp className="h-5 w-5 text-green-400" /> : <TrendingDown className="h-5 w-5 text-red-400" />}
                                </div>
                                <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-400 rounded-full border-2 border-background animate-pulse" />
                              </div>
                              <div>
                                <div className="font-mono font-bold text-base flex items-center gap-2">
                                  {pos.pair}
                                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-mono ${strategyInfo.isCandles ? 'border-cyan-500/50 text-cyan-400' : 'border-primary/50 text-primary'}`}>
                                    {strategyInfo.isCandles ? <CandlestickChart className="h-2.5 w-2.5 mr-0.5" /> : <Activity className="h-2.5 w-2.5 mr-0.5" />}
                                    {strategyInfo.strategyName}/{strategyInfo.tfLabel}
                                  </Badge>
                                  {pos.entryMode && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono border-orange-500/50 text-orange-400">
                                      <Layers className="h-2.5 w-2.5 mr-0.5" />
                                      {pos.entryMode}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(pos.openedAt)}
                                  <span className="text-[10px] opacity-60">| Lote: {pos.lotId?.substring(0, 8) || 'N/A'}</span>
                                  {botConfig?.positionMode === 'SMART_GUARD' && (
                                    <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1" title="Slots usados / máximo">
                                      {getLotsCountByPair(pos.pair).count}/{getLotsCountByPair(pos.pair).max}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4">
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 lg:gap-4 flex-1">
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase">Cantidad</div>
                                  <div className="font-mono font-medium text-sm">{parseFloat(pos.amount).toFixed(6)}</div>
                                </div>
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase">Precio Entrada</div>
                                  <div className="font-mono font-medium text-sm">${formatPrice(pos.entryPrice)}</div>
                                </div>
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase" title="Valor de entrada en USD">Valor Entrada</div>
                                  <div className="font-mono font-medium text-sm text-blue-400">${parseFloat(pos.entryValueUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase">Precio Actual</div>
                                  <div className="font-mono font-medium text-sm">${formatPrice(pos.currentPrice)}</div>
                                </div>
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase" title="Valor actual en USD">Valor Actual</div>
                                  <div className="font-mono font-medium text-sm text-cyan-400">${parseFloat(pos.currentValueUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                                <div>
                                  <div className="font-mono text-[10px] text-muted-foreground uppercase" title="P&L Neto (después de comisiones estimadas)">P&L Neto</div>
                                  {(() => {
                                    const netUsd = parseFloat(pos.netPnlUsd || "0");
                                    const netPct = parseFloat(pos.netPnlPct || "0");
                                    const isNetProfit = netUsd >= 0;
                                    return (
                                      <div className={`font-mono font-bold text-sm flex items-center gap-1 ${isNetProfit ? 'text-emerald-400' : 'text-orange-400'}`}>
                                        {isNetProfit ? '+' : '-'}${Math.abs(netUsd).toFixed(2)}
                                        <span className="text-xs opacity-75">({netPct >= 0 ? '+' : ''}{netPct.toFixed(2)}%)</span>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                              <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {pos.lotId && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleToggleTimeStop(pos.lotId!, pos.timeStopDisabled || false, pos.pair)}
                                    disabled={togglingTimeStopKey === pos.lotId}
                                    className={pos.timeStopDisabled 
                                      ? "text-yellow-400 border-yellow-400/50 hover:bg-yellow-400/10" 
                                      : "text-emerald-400 border-emerald-400/50 hover:bg-emerald-400/10"}
                                    data-testid={`button-toggle-timestop-${pos.lotId}`}
                                    title={pos.timeStopDisabled ? "Time-stop desactivado - Click para reactivar" : "Time-stop activo - Click para desactivar"}
                                  >
                                    {togglingTimeStopKey === pos.lotId ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : pos.timeStopDisabled ? (
                                      <TimerOff className="h-4 w-4" />
                                    ) : (
                                      <Timer className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleClosePosition(pos.pair, pos.lotId, pos.amount)}
                                  disabled={closingKey === getPositionKey(pos.pair, pos.lotId)}
                                  data-testid={`button-close-position-${pos.lotId || pos.id}`}
                                >
                                  {closingKey === getPositionKey(pos.pair, pos.lotId) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <X className="h-4 w-4" />
                                  )}
                                  <span className="hidden sm:inline ml-1">Cerrar</span>
                                </Button>
                                {pos.lotId && dustPositions.has(pos.lotId) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteOrphan(pos.lotId!, pos.pair, pos.amount)}
                                    disabled={deletingOrphanKey === pos.lotId}
                                    className="text-orange-400 border-orange-400/50 hover:bg-orange-400/10"
                                    data-testid={`button-delete-orphan-${pos.lotId}`}
                                    title="Eliminar registro interno sin enviar orden a Kraken"
                                  >
                                    {deletingOrphanKey === pos.lotId ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                    <span className="hidden lg:inline ml-1">Huérfana</span>
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-16">
                      <div className="h-16 w-16 mx-auto bg-muted/20 rounded-full flex items-center justify-center mb-4">
                        <Target className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <p className="font-mono text-muted-foreground text-sm">NO HAY POSICIONES ABIERTAS</p>
                      <p className="text-xs text-muted-foreground mt-1">Las posiciones aparecerán cuando el bot compre activos</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
                <CardHeader className="py-3 px-4 border-b border-border/30">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                      <Activity className="h-4 w-4 text-cyan-400" />
                      HISTORIAL DE OPERACIONES
                    </CardTitle>
                    <span className="text-xs font-mono text-muted-foreground">
                      {closedData?.total || 0} operaciones
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {exchangeFilter === 'revolutx' && typeFilter === 'all' && closedData?.trades?.length ? (
                    closedData.trades.some(t => t.type === 'sell') ? null : (
                      <div className="px-4 py-2 border-b border-border/20 bg-amber-500/5">
                        <div className="font-mono text-xs text-amber-300">
                          No hay VENTAS (SELL) en esta página. Puede haber SELLs en páginas posteriores. Prueba el filtro "VENTAS" o aumenta el límite.
                        </div>
                      </div>
                    )
                  ) : null}
                  {loadingClosed ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400"></div>
                    </div>
                  ) : closedData && closedData.trades.length > 0 ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px]">
                          <thead>
                            <tr className="border-b border-border/30 text-left">
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal">Tipo</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal">Par</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal">Fecha</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal text-right">Cantidad</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal text-right">Precio</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal text-right" title="Valor total de la operación en USD">Total USD</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal text-right">P&L</th>
                              <th className="py-3 px-3 font-mono text-[10px] text-muted-foreground uppercase font-normal text-center">Estado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {closedData.trades.map((trade) => {
                              const pnlUsd = trade.realizedPnlUsd ? parseFloat(trade.realizedPnlUsd) : null;
                              const pnlPct = trade.realizedPnlPct ? parseFloat(trade.realizedPnlPct) : null;
                              const isProfit = pnlUsd !== null && pnlUsd >= 0;
                              const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                              const rawEx = (trade.exchange || '').toLowerCase();
                              const inferredEx = (() => {
                                if (rawEx === 'kraken' || rawEx === 'revolutx') return rawEx;
                                const id = trade.tradeId || '';
                                if (id.startsWith('RX-') || uuidV4Regex.test(id)) return 'revolutx';
                                if (id.startsWith('KRAKEN-')) return 'kraken';
                                return 'kraken';
                              })();
                              const isRx = inferredEx === 'revolutx';
                              
                              return (
                                <tr 
                                  key={trade.id}
                                  className="hover:bg-white/[0.02] transition-colors"
                                  data-testid={`closed-trade-row-${trade.id}`}
                                >
                                  <td className="py-3 px-3">
                                    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono font-bold ${trade.type === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                      {trade.type === 'buy' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                      {trade.type === 'buy' ? 'BUY' : 'SELL'}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3">
                                    <span className="font-mono font-medium text-sm">{trade.pair}</span>
                                  </td>
                                  <td className="py-3 px-3">
                                    <span className="font-mono text-xs text-muted-foreground">{formatDate(trade.executedAt || trade.createdAt)}</span>
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    <span className="font-mono text-sm">{parseFloat(trade.amount).toFixed(6)}</span>
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    <span className="font-mono text-sm">${formatPrice(trade.price)}</span>
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    <span className="font-mono text-sm font-medium text-cyan-400" title="Cantidad × Precio">
                                      ${parseFloat(trade.totalUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    {pnlUsd !== null ? (
                                      <span className={`font-mono font-bold text-sm ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                        {isProfit ? '+' : ''}${pnlUsd.toFixed(2)}
                                        <span className="text-xs opacity-75 ml-1">
                                          ({pnlPct !== null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) : '0'}%)
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="font-mono text-sm text-muted-foreground">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-center">
                                    <Badge 
                                      variant="outline"
                                      className={`font-mono text-[10px] ${
                                        trade.status === 'filled' 
                                          ? 'border-green-500/50 text-green-400 bg-green-500/10' 
                                          : trade.status === 'pending' 
                                            ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' 
                                            : 'border-red-500/50 text-red-400 bg-red-500/10'
                                      }`}
                                    >
                                      {trade.status === 'filled' ? 'OK' : trade.status.toUpperCase()}
                                    </Badge>
                                  </td>
                                  <td className="py-3 px-3">
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={`font-mono text-[10px] px-1.5 py-0 ${trade.type === 'buy' ? 'border-green-500/50 text-green-400' : 'border-red-500/50 text-red-400'}`}
                                      >
                                        {trade.type === 'buy' ? (
                                          <ArrowUpRight className="h-3 w-3 mr-0.5" />
                                        ) : (
                                          <ArrowDownRight className="h-3 w-3 mr-0.5" />
                                        )}
                                        {trade.type.toUpperCase()}
                                      </Badge>
                                      <Badge
                                        variant="outline"
                                        className={`font-mono text-[10px] px-1.5 py-0 ${isRx ? 'border-violet-500/50 text-violet-300' : 'border-cyan-500/50 text-cyan-400'}`}
                                        title={isRx ? 'Revolut X' : 'Kraken'}
                                      >
                                        {isRx ? 'REV. X' : 'KRAKEN'}
                                      </Badge>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {totalPages > 1 && (
                        <div className="flex items-center justify-between p-4 border-t border-border/30">
                          <span className="text-xs font-mono text-muted-foreground">
                            {offset + 1}-{Math.min(offset + limit, closedData.total)} de {closedData.total}
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handlePrevPage}
                              disabled={offset === 0}
                              className="h-7 px-2 font-mono text-xs border-border/50"
                              data-testid="button-prev-page"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <span className="text-xs font-mono text-muted-foreground px-2">
                              {currentPage}/{totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleNextPage}
                              disabled={offset + limit >= closedData.total}
                              className="h-7 px-2 font-mono text-xs border-border/50"
                              data-testid="button-next-page"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-16">
                      <div className="h-16 w-16 mx-auto bg-muted/20 rounded-full flex items-center justify-center mb-4">
                        <Clock className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <p className="font-mono text-muted-foreground text-sm">NO HAY OPERACIONES</p>
                      <p className="text-xs text-muted-foreground mt-1">Las operaciones aparecerán cuando el bot venda activos</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Dialog de confirmación para eliminar posición huérfana */}
      <AlertDialog open={orphanDialogOpen} onOpenChange={setOrphanDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-400">
              <AlertTriangle className="h-5 w-5" />
              Eliminar Posición Huérfana
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Esta acción <strong>solo elimina el registro interno</strong> del bot (base de datos).
                <strong> NO envía ninguna orden a Kraken.</strong>
              </p>
              {orphanToDelete && (
                <div className="bg-muted/30 rounded-md p-3 font-mono text-sm">
                  <div><span className="text-muted-foreground">Par:</span> {orphanToDelete.pair}</div>
                  <div><span className="text-muted-foreground">Lote:</span> {orphanToDelete.lotId.substring(0, 12)}...</div>
                  <div><span className="text-muted-foreground">Cantidad:</span> {parseFloat(orphanToDelete.amount).toFixed(8)}</div>
                </div>
              )}
              <p className="text-orange-400 text-sm">
                Úsalo cuando el balance real en Kraken sea menor al mínimo (posición DUST) 
                o cuando ya vendiste manualmente fuera del bot.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteOrphan}
              className="bg-orange-500 hover:bg-orange-600"
              disabled={deleteOrphanMutation.isPending}
            >
              {deleteOrphanMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Eliminar de BD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de detalles de posición */}
      <Dialog open={!!selectedPosition} onOpenChange={(open) => !open && setSelectedPosition(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              <Target className="h-5 w-5 text-primary" />
              Detalles de Posición - {selectedPosition?.pair}
            </DialogTitle>
          </DialogHeader>
          
          {selectedPosition && (() => {
            const exitStatus = calculateExitStatus(selectedPosition);
            const takerFeeRate = parseFloat(botConfig?.takerFeePct || "0.40") / 100;
            const storedEntryFee = selectedPosition.entryFee ? parseFloat(selectedPosition.entryFee) : null;
            const realEntryFee = storedEntryFee != null && !isNaN(storedEntryFee) ? storedEntryFee : null;
            const estimatedEntryFee = parseFloat(selectedPosition.entryValueUsd) * takerFeeRate;
            const displayEntryFee = realEntryFee ?? estimatedEntryFee;
            const isEntryFeeReal = realEntryFee != null;
            const estimatedExitFee = parseFloat(selectedPosition.currentValueUsd) * takerFeeRate;
            const grossUsd = parseFloat(selectedPosition.unrealizedPnlUsd || "0");
            const grossPct = parseFloat(selectedPosition.unrealizedPnlPct || "0");
            const netUsd = parseFloat(selectedPosition.netPnlUsd || "0");
            const netPct = parseFloat(selectedPosition.netPnlPct || "0");
            const isGrossProfit = grossUsd >= 0;
            const isNetProfit = netUsd >= 0;
            
            return (
              <div className="space-y-4">
                {/* Banner informativo */}
                {exitStatus.adaptiveEnabled ? (
                  <div className="p-3 rounded-lg border bg-cyan-500/10 border-cyan-500/30">
                    <div className="text-xs text-cyan-400 uppercase mb-1">Motor ATR Activo</div>
                    <div className="text-sm text-muted-foreground">
                      Los valores de salida se calculan dinámicamente según volatilidad y régimen de mercado. 
                      Los umbrales mostrados abajo son <span className="text-cyan-400">referencias base</span>, no valores finales.
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border bg-muted/20 border-muted">
                    <div className="text-xs text-muted-foreground uppercase mb-1">Umbrales Configurados</div>
                    <div className="text-sm text-muted-foreground">
                      Valores SMART_GUARD según configuración actual.
                    </div>
                  </div>
                )}

                {/* Resumen (modo original): números clave visibles */}
                <div className="p-3 rounded-lg bg-muted/20 border border-muted space-y-2">
                  <div className="text-xs text-muted-foreground uppercase">Resumen</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">Precio Entrada</div>
                      <div className="font-mono text-sm">${formatPrice(selectedPosition.entryPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">Precio Actual</div>
                      <div className="font-mono text-sm">${formatPrice(selectedPosition.currentPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">Valor Entrada</div>
                      <div className="font-mono text-sm">${parseFloat(selectedPosition.entryValueUsd).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">Valor Actual</div>
                      <div className="font-mono text-sm">${parseFloat(selectedPosition.currentValueUsd).toFixed(2)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-mono">PnL (bruto)</div>
                          <div className={`font-mono text-sm ${isGrossProfit ? 'text-green-400' : 'text-red-400'}`}>
                            {isGrossProfit ? '+' : '-'}${Math.abs(grossUsd).toFixed(2)} ({grossPct >= 0 ? '+' : ''}{grossPct.toFixed(2)}%)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-muted-foreground uppercase font-mono">PnL (neto)</div>
                          <div className={`font-mono text-sm ${isNetProfit ? 'text-emerald-400' : 'text-orange-400'}`}>
                            {isNetProfit ? '+' : '-'}${Math.abs(netUsd).toFixed(2)} ({netPct >= 0 ? '+' : ''}{netPct.toFixed(2)}%)
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Abierta: {formatDate(selectedPosition.openedAt)} · {exitStatus.hoursOpen.toFixed(1)}h
                  </div>
                </div>

                {/* Break-Even */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Break-Even ({exitStatus.bePct}%)</span>
                    <span className={`text-sm font-mono ${exitStatus.beActive ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {exitStatus.beActive ? '✓ ACTIVO' : `Falta +${exitStatus.beRemaining.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${exitStatus.beActive ? 'bg-green-500' : 'bg-blue-500/50'}`}
                      style={{ width: `${Math.max(0, exitStatus.beProgress)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    PnL actual: {exitStatus.currentPnlPct >= 0 ? '+' : ''}{exitStatus.currentPnlPct.toFixed(2)}%
                  </div>
                </div>

                {/* Trailing Stop */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Trailing ({exitStatus.trailStartPct}% inicio, {exitStatus.trailDistancePct}% distancia)</span>
                    <span className={`text-sm font-mono ${exitStatus.trailActive ? 'text-cyan-400' : 'text-muted-foreground'}`}>
                      {exitStatus.trailActive ? '✓ SIGUIENDO' : `Falta +${exitStatus.trailRemaining.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${exitStatus.trailActive ? 'bg-cyan-500' : 'bg-cyan-500/30'}`}
                      style={{ width: `${Math.max(0, exitStatus.trailProgress)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    PnL actual: {exitStatus.currentPnlPct >= 0 ? '+' : ''}{exitStatus.currentPnlPct.toFixed(2)}%
                  </div>
                </div>

                {/* Take-Profit */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Take-Profit ({exitStatus.tpPct}%)</span>
                    <span className={`text-sm font-mono ${exitStatus.currentPnlPct >= exitStatus.tpPct ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {exitStatus.currentPnlPct >= exitStatus.tpPct ? '✓ OBJETIVO' : `Falta +${exitStatus.tpRemaining.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${exitStatus.currentPnlPct >= exitStatus.tpPct ? 'bg-green-500' : 'bg-green-500/30'}`}
                      style={{ width: `${Math.max(0, exitStatus.tpProgress)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    PnL actual: {exitStatus.currentPnlPct >= 0 ? '+' : ''}{exitStatus.currentPnlPct.toFixed(2)}%
                  </div>
                </div>

                {/* Time-Stop */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Time-Stop ({exitStatus.timeStopHours}h)</span>
                    <span className={`text-sm font-mono ${
                      exitStatus.timeStopDisabled ? 'text-yellow-400' :
                      exitStatus.hoursOpen >= exitStatus.timeStopHours ? 'text-orange-400' : 'text-muted-foreground'
                    }`}>
                      {exitStatus.timeStopDisabled ? '⏸ PAUSADO' :
                       exitStatus.hoursOpen >= exitStatus.timeStopHours ? '⏱ EXPIRADO' :
                       `${exitStatus.timeStopRemaining.toFixed(1)}h restantes`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${
                        exitStatus.timeStopDisabled ? 'bg-yellow-500/50' :
                        exitStatus.hoursOpen >= exitStatus.timeStopHours ? 'bg-orange-500' : 'bg-orange-500/30'
                      }`}
                      style={{ width: `${Math.max(0, exitStatus.timeStopProgress)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tiempo abierto: {exitStatus.hoursOpen.toFixed(1)} horas
                  </div>
                </div>

                {/* Comisiones */}
                <div className="p-3 rounded-lg bg-muted/20 border border-muted space-y-1">
                  <div className="text-xs text-muted-foreground uppercase mb-2">Comisiones</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Entrada {isEntryFeeReal ? '(real)' : '(estimada)'}:
                    </span>
                    <span className={`font-mono ${isEntryFeeReal ? 'text-red-400' : 'text-red-400/70'}`}>
                      -${displayEntryFee.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Salida (estimada):</span>
                    <span className="font-mono text-red-400/70">-${estimatedExitFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-muted">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-mono text-red-400">-${(displayEntryFee + estimatedExitFee).toFixed(2)}</span>
                  </div>
                </div>

                {/* Info adicional */}
                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-muted">
                  <div className="flex justify-between">
                    <span>Lote ID:</span>
                    <span className="font-mono">{selectedPosition.lotId || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Estrategia:</span>
                    <span className="font-mono">{selectedPosition.entryStrategyId}/{selectedPosition.entrySignalTf}</span>
                  </div>
                  {selectedPosition.signalConfidence && (
                    <div className="flex justify-between">
                      <span>Confianza entrada:</span>
                      <span className="font-mono">{parseFloat(selectedPosition.signalConfidence).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
