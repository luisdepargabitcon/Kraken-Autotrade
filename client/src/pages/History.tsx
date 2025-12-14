import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpRight, ArrowDownRight, Clock, DollarSign, TrendingUp, TrendingDown, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

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
}

interface ClosedTrade {
  id: number;
  tradeId: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  status: string;
  entryPrice: string | null;
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

export default function History() {
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [pairFilter, setPairFilter] = useState<string>("all");
  const [resultFilter, setResultFilter] = useState<string>("all");

  const { data: openPositions, isLoading: loadingPositions, refetch: refetchPositions, isFetching: fetchingPositions } = useQuery<OpenPosition[]>({
    queryKey: ["openPositions"],
    queryFn: async () => {
      const res = await fetch("/api/open-positions");
      if (!res.ok) throw new Error("Failed to fetch open positions");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: closedData, isLoading: loadingClosed, refetch: refetchClosed, isFetching: fetchingClosed } = useQuery<ClosedTradesResponse>({
    queryKey: ["closedTrades", limit, offset, pairFilter, resultFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        result: resultFilter,
      });
      if (pairFilter !== "all") {
        params.set("pair", pairFilter);
      }
      const res = await fetch(`/api/trades/closed?${params}`);
      if (!res.ok) throw new Error("Failed to fetch closed trades");
      return res.json();
    },
  });

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
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const handleLimitChange = (value: string) => {
    const newLimit = value === "all" ? 1000 : parseInt(value);
    setLimit(newLimit);
    setOffset(0);
  };

  const availablePairs = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div 
        className="fixed inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-4 md:space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-3xl font-bold font-sans tracking-tight">Posiciones y Operaciones</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Posiciones abiertas y historial de operaciones cerradas.</p>
            </div>
          </div>

          <Card className="glass-panel border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-mono">POSICIONES ABIERTAS</CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => refetchPositions()}
                disabled={fetchingPositions}
                className="text-muted-foreground hover:text-primary"
                data-testid="button-refresh-positions"
              >
                <RefreshCw className={`h-4 w-4 ${fetchingPositions ? 'animate-spin' : ''}`} />
              </Button>
            </CardHeader>
            <CardContent>
              {loadingPositions ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : openPositions && openPositions.length > 0 ? (
                <div className="space-y-3">
                  {openPositions.map((pos) => {
                    const pnlUsd = parseFloat(pos.unrealizedPnlUsd);
                    const pnlPct = parseFloat(pos.unrealizedPnlPct);
                    const isProfit = pnlUsd >= 0;
                    
                    return (
                      <div 
                        key={pos.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 bg-card/50 rounded-lg border border-border/30 hover:border-border/50 transition-colors gap-3 sm:gap-4"
                        data-testid={`position-row-${pos.id}`}
                      >
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className="p-1.5 md:p-2 rounded-lg bg-blue-500/20">
                            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-blue-500" />
                          </div>
                          <div>
                            <div className="font-mono font-medium text-sm md:text-base">
                              {pos.pair}
                            </div>
                            <div className="text-xs md:text-sm text-muted-foreground flex items-center gap-2">
                              <Clock className="h-3 w-3" />
                              {formatDate(pos.openedAt)}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between sm:justify-end gap-4 md:gap-6 ml-9 sm:ml-0">
                          <div className="text-left sm:text-right">
                            <div className="font-mono text-xs text-muted-foreground">Cantidad</div>
                            <div className="font-mono font-medium text-sm">{parseFloat(pos.amount).toFixed(6)}</div>
                          </div>
                          <div className="text-left sm:text-right">
                            <div className="font-mono text-xs text-muted-foreground">Entrada</div>
                            <div className="font-mono font-medium text-sm flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              {formatPrice(pos.entryPrice)}
                            </div>
                          </div>
                          <div className="text-left sm:text-right">
                            <div className="font-mono text-xs text-muted-foreground">Actual</div>
                            <div className="font-mono font-medium text-sm flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              {formatPrice(pos.currentPrice)}
                            </div>
                          </div>
                          <div className="text-left sm:text-right min-w-[100px]">
                            <div className="font-mono text-xs text-muted-foreground">P&L No Realizado</div>
                            <div className={`font-mono font-bold text-sm flex items-center gap-1 ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                              {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              ${Math.abs(pnlUsd).toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No hay posiciones abiertas</p>
                  <p className="text-sm text-muted-foreground mt-1">Las posiciones aparecerán aquí cuando el bot compre activos.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <CardTitle className="text-lg font-mono">OPERACIONES</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={pairFilter} onValueChange={setPairFilter}>
                    <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="select-pair-filter">
                      <SelectValue placeholder="Par" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {availablePairs.map(pair => (
                        <SelectItem key={pair} value={pair}>{pair}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={resultFilter} onValueChange={setResultFilter}>
                    <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="select-result-filter">
                      <SelectValue placeholder="Resultado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="winner">Ganadoras</SelectItem>
                      <SelectItem value="loser">Perdedoras</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={limit.toString()} onValueChange={handleLimitChange}>
                    <SelectTrigger className="w-[80px] h-8 text-xs" data-testid="select-limit">
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
                    variant="ghost" 
                    size="sm" 
                    onClick={() => refetchClosed()}
                    disabled={fetchingClosed}
                    className="text-muted-foreground hover:text-primary"
                    data-testid="button-refresh-closed"
                  >
                    <RefreshCw className={`h-4 w-4 ${fetchingClosed ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingClosed ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : closedData && closedData.trades.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {closedData.trades.map((trade) => {
                      const pnlUsd = trade.realizedPnlUsd ? parseFloat(trade.realizedPnlUsd) : null;
                      const pnlPct = trade.realizedPnlPct ? parseFloat(trade.realizedPnlPct) : null;
                      const isProfit = pnlUsd !== null && pnlUsd >= 0;
                      
                      return (
                        <div 
                          key={trade.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 bg-card/50 rounded-lg border border-border/30 hover:border-border/50 transition-colors gap-3 sm:gap-4"
                          data-testid={`closed-trade-row-${trade.id}`}
                        >
                          <div className="flex items-center gap-3 md:gap-4">
                            <div className={`p-1.5 md:p-2 rounded-lg ${pnlUsd !== null ? (isProfit ? 'bg-green-500/20' : 'bg-red-500/20') : 'bg-gray-500/20'}`}>
                              {pnlUsd !== null ? (
                                isProfit ? (
                                  <ArrowUpRight className="h-4 w-4 md:h-5 md:w-5 text-green-500" />
                                ) : (
                                  <ArrowDownRight className="h-4 w-4 md:h-5 md:w-5 text-red-500" />
                                )
                              ) : (
                                <ArrowDownRight className="h-4 w-4 md:h-5 md:w-5 text-gray-500" />
                              )}
                            </div>
                            <div>
                              <div className="font-mono font-medium text-sm md:text-base">
                                VENTA {trade.pair}
                              </div>
                              <div className="text-xs md:text-sm text-muted-foreground flex items-center gap-2">
                                <Clock className="h-3 w-3" />
                                {formatDate(trade.executedAt || trade.createdAt)}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between sm:justify-end gap-4 md:gap-6 ml-9 sm:ml-0">
                            <div className="text-left sm:text-right">
                              <div className="font-mono text-xs text-muted-foreground">Cantidad</div>
                              <div className="font-mono font-medium text-sm">{parseFloat(trade.amount).toFixed(6)}</div>
                            </div>
                            {trade.entryPrice && (
                              <div className="text-left sm:text-right">
                                <div className="font-mono text-xs text-muted-foreground">Entrada</div>
                                <div className="font-mono font-medium text-sm flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" />
                                  {formatPrice(trade.entryPrice)}
                                </div>
                              </div>
                            )}
                            <div className="text-left sm:text-right">
                              <div className="font-mono text-xs text-muted-foreground">Salida</div>
                              <div className="font-mono font-medium text-sm flex items-center gap-1">
                                <DollarSign className="h-3 w-3" />
                                {formatPrice(trade.price)}
                              </div>
                            </div>
                            <div className="text-left sm:text-right min-w-[100px]">
                              <div className="font-mono text-xs text-muted-foreground">P&L Realizado</div>
                              {pnlUsd !== null ? (
                                <div className={`font-mono font-bold text-sm flex items-center gap-1 ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                                  {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  ${Math.abs(pnlUsd).toFixed(2)} ({pnlPct !== null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) : '0'}%)
                                </div>
                              ) : (
                                <div className="font-mono text-sm text-muted-foreground">-</div>
                              )}
                            </div>
                            <Badge 
                              variant={trade.status === 'filled' ? 'default' : trade.status === 'pending' ? 'secondary' : 'destructive'}
                              className="font-mono text-xs"
                            >
                              {trade.status === 'filled' ? 'OK' : trade.status.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/30">
                      <span className="text-sm text-muted-foreground">
                        Mostrando {offset + 1}-{Math.min(offset + limit, closedData.total)} de {closedData.total}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handlePrevPage}
                          disabled={offset === 0}
                          data-testid="button-prev-page"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-mono">
                          {currentPage} / {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleNextPage}
                          disabled={offset + limit >= closedData.total}
                          data-testid="button-next-page"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No hay operaciones cerradas</p>
                  <p className="text-sm text-muted-foreground mt-1">Las operaciones aparecerán aquí cuando el bot venda activos.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
