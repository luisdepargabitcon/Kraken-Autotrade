import { useState, useRef, useEffect, useMemo } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { useEventsWebSocket, BotEvent } from "@/hooks/useEventsWebSocket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Wifi, WifiOff, RefreshCw, Trash2, Pause, Play, 
  Download, Copy, Search, X, ChevronDown, ChevronRight,
  AlertCircle, AlertTriangle, Info
} from "lucide-react";
import { cn } from "@/lib/utils";

const LEVEL_COLORS: Record<string, string> = {
  INFO: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WARN: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ERROR: "bg-red-500/20 text-red-400 border-red-500/30",
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  INFO: <Info className="h-3 w-3" />,
  WARN: <AlertTriangle className="h-3 w-3" />,
  ERROR: <AlertCircle className="h-3 w-3" />,
};

const DEFAULT_EVENT_TYPES = [
  "TRADE_EXECUTED", "TRADE_BLOCKED", "TRADE_FAILED", "TRADE_ADJUSTED", "TRADE_REJECTED_LOW_PROFIT", "TRADE_SKIPPED",
  "STOP_LOSS_HIT", "TAKE_PROFIT_HIT", "TRAILING_STOP_HIT",
  "BOT_STARTED", "BOT_STOPPED", "BOT_PAUSED", "BOT_RESUMED",
  "ENGINE_TICK", "MARKET_SCAN_SUMMARY",
  "DAILY_LIMIT_HIT", "DAILY_LIMIT_RESET", "PAIR_COOLDOWN",
  "KRAKEN_ERROR", "KRAKEN_CONNECTED", "TELEGRAM_ERROR", "TELEGRAM_CONNECTED", "NONCE_ERROR",
  "POSITION_OPENED", "POSITION_CLOSED", "ORPHAN_POSITION_CLEANED",
  "SIGNAL_GENERATED", "BALANCE_CHECK", "SYSTEM_ERROR",
];

const DEFAULT_PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

export default function Monitor() {
  const { events, status, error, connect, disconnect, clearEvents, isConnected } = useEventsWebSocket();
  
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<BotEvent | null>(null);
  const [searchText, setSearchText] = useState("");
  const [levelFilter, setLevelFilter] = useState<string[]>(["INFO", "WARN", "ERROR"]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [pairFilter, setPairFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevEventsLengthRef = useRef(events.length);

  useEffect(() => {
    if (autoScroll && events.length > prevEventsLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevEventsLengthRef.current = events.length;
  }, [events.length, autoScroll]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (levelFilter.length > 0 && !levelFilter.includes(event.level)) return false;
      if (typeFilter.length > 0 && !typeFilter.includes(event.type)) return false;
      if (pairFilter.length > 0) {
        const eventPair = event.meta?.pair;
        if (!eventPair || !pairFilter.includes(eventPair)) return false;
      }
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const messageMatch = event.message.toLowerCase().includes(searchLower);
        const typeMatch = event.type.toLowerCase().includes(searchLower);
        const metaMatch = event.meta ? JSON.stringify(event.meta).toLowerCase().includes(searchLower) : false;
        if (!messageMatch && !typeMatch && !metaMatch) return false;
      }
      return true;
    });
  }, [events, levelFilter, typeFilter, pairFilter, searchText]);

  const stats = useMemo(() => {
    const last24h = events.filter(e => {
      const eventTime = new Date(e.timestamp).getTime();
      const now = Date.now();
      return now - eventTime < 24 * 60 * 60 * 1000;
    });
    return {
      total: events.length,
      errors: last24h.filter(e => e.level === "ERROR").length,
      warnings: last24h.filter(e => e.level === "WARN").length,
      trades: last24h.filter(e => e.type === "TRADE_EXECUTED").length,
    };
  }, [events]);

  const availableEventTypes = useMemo(() => {
    const fromEvents = events.map(e => e.type);
    const combined = new Set([...DEFAULT_EVENT_TYPES, ...fromEvents]);
    return Array.from(combined).sort();
  }, [events]);

  const availablePairs = useMemo(() => {
    const fromEvents = events.map(e => e.meta?.pair).filter((p): p is string => Boolean(p));
    const combined = new Set([...DEFAULT_PAIRS, ...fromEvents]);
    return Array.from(combined).sort();
  }, [events]);

  const handleCopyEvent = (event: BotEvent) => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(JSON.stringify(filteredEvents, null, 2));
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `krakenbot-logs-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleLevel = (level: string) => {
    setLevelFilter(prev => 
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const formatDate = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <div className="p-4 md:p-6 max-w-[1800px] mx-auto">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Monitor</h1>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "gap-1",
                    isConnected ? "border-green-500 text-green-400" : 
                    status === "reconnecting" ? "border-yellow-500 text-yellow-400" :
                    "border-red-500 text-red-400"
                  )}
                  data-testid="badge-ws-status"
                >
                  {isConnected ? <Wifi className="h-3 w-3" /> : 
                   status === "reconnecting" ? <RefreshCw className="h-3 w-3 animate-spin" /> :
                   <WifiOff className="h-3 w-3" />}
                  {status === "connected" ? "Conectado" : 
                   status === "reconnecting" ? "Reconectando..." : 
                   status === "connecting" ? "Conectando..." : "Desconectado"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground hidden sm:flex gap-3">
                  <span>Eventos: {stats.total}</span>
                  <span className="text-red-400">Errores 24h: {stats.errors}</span>
                  <span className="text-yellow-400">Avisos 24h: {stats.warnings}</span>
                  <span className="text-green-400">Trades 24h: {stats.trades}</span>
                </div>
              </div>
            </div>

            <Card className="border-border/50">
              <CardHeader className="py-3 px-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="pl-8 h-8 w-40 sm:w-60"
                        data-testid="input-search"
                      />
                      {searchText && (
                        <button 
                          onClick={() => setSearchText("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                        >
                          <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        </button>
                      )}
                    </div>
                    
                    <div className="flex gap-1">
                      {["INFO", "WARN", "ERROR"].map(level => (
                        <Button
                          key={level}
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 px-2 text-xs",
                            levelFilter.includes(level) ? LEVEL_COLORS[level] : "opacity-40"
                          )}
                          onClick={() => toggleLevel(level)}
                          data-testid={`button-filter-${level.toLowerCase()}`}
                        >
                          {LEVEL_ICONS[level]}
                          <span className="hidden sm:inline ml-1">{level}</span>
                        </Button>
                      ))}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setShowFilters(!showFilters)}
                    >
                      Filtros
                      {showFilters ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronRight className="ml-1 h-3 w-3" />}
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setAutoScroll(!autoScroll)}
                      title={autoScroll ? "Pausar auto-scroll" : "Reanudar auto-scroll"}
                      data-testid="button-autoscroll"
                    >
                      {autoScroll ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={clearEvents}
                      title="Limpiar"
                      data-testid="button-clear"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleCopyAll}
                      title="Copiar todo"
                      data-testid="button-copy-all"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleDownload}
                      title="Descargar"
                      data-testid="button-download"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {!isConnected && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={connect}
                        data-testid="button-reconnect"
                      >
                        Reconectar
                      </Button>
                    )}
                  </div>
                </div>

                {showFilters && (
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                    <div className="flex flex-wrap gap-1" data-testid="filter-type-container">
                      <span className="text-xs text-muted-foreground mr-2">Tipo:</span>
                      {availableEventTypes.map((type: string) => (
                        <Badge
                          key={type}
                          variant="outline"
                          className={cn(
                            "cursor-pointer text-xs",
                            typeFilter.includes(type) ? "bg-primary/20" : "opacity-50"
                          )}
                          onClick={() => setTypeFilter(prev => 
                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                          )}
                          data-testid={`filter-type-${type}`}
                        >
                          {type.replace(/_/g, " ")}
                        </Badge>
                      ))}
                      {typeFilter.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => setTypeFilter([])} data-testid="button-clear-type-filter">
                          Limpiar
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1" data-testid="filter-pair-container">
                      <span className="text-xs text-muted-foreground mr-2">Par:</span>
                      {availablePairs.map((pair: string) => (
                        <Badge
                          key={pair}
                          variant="outline"
                          className={cn(
                            "cursor-pointer text-xs",
                            pairFilter.includes(pair) ? "bg-primary/20" : "opacity-50"
                          )}
                          onClick={() => setPairFilter(prev => 
                            prev.includes(pair) ? prev.filter(p => p !== pair) : [...prev, pair]
                          )}
                          data-testid={`filter-pair-${pair.replace("/", "-")}`}
                        >
                          {pair}
                        </Badge>
                      ))}
                      {pairFilter.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => setPairFilter([])} data-testid="button-clear-pair-filter">
                          Limpiar
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardHeader>
              
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-320px)]" ref={scrollRef}>
                  <div className="font-mono text-xs divide-y divide-border/30">
                    {filteredEvents.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        {events.length === 0 ? "Esperando eventos..." : "No hay eventos que coincidan con los filtros"}
                      </div>
                    ) : (
                      filteredEvents.map((event, idx) => (
                        <div
                          key={event.id || `${event.timestamp}-${idx}`}
                          className={cn(
                            "px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors",
                            selectedEvent?.id === event.id && "bg-muted/50"
                          )}
                          onClick={() => setSelectedEvent(event)}
                          data-testid={`event-row-${event.id || idx}`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground whitespace-nowrap">
                              {formatDate(event.timestamp)} {formatTimestamp(event.timestamp)}
                            </span>
                            <Badge 
                              variant="outline" 
                              className={cn("text-[10px] px-1.5 py-0", LEVEL_COLORS[event.level])}
                            >
                              {event.level}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/50">
                              {event.type.replace(/_/g, " ")}
                            </Badge>
                            {event.meta?.pair && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {event.meta.pair}
                              </Badge>
                            )}
                            <span className="text-foreground truncate flex-1">
                              {event.message}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="w-full lg:w-80 xl:w-96" data-testid="event-detail-panel">
            <Card className="border-border/50 sticky top-20">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Detalle del evento</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {selectedEvent ? (
                  <div className="space-y-3 text-xs" data-testid="event-detail-content">
                    <div className="flex justify-between items-start">
                      <Badge className={cn(LEVEL_COLORS[selectedEvent.level])} data-testid="detail-level-badge">
                        {selectedEvent.level}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => handleCopyEvent(selectedEvent)}
                        data-testid="button-copy-event"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copiar
                      </Button>
                    </div>
                    
                    <div>
                      <span className="text-muted-foreground">Timestamp:</span>
                      <p className="font-mono" data-testid="detail-timestamp">{new Date(selectedEvent.timestamp).toLocaleString("es-ES")}</p>
                    </div>
                    
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <p className="font-mono" data-testid="detail-type">{selectedEvent.type}</p>
                    </div>
                    
                    <div>
                      <span className="text-muted-foreground">Mensaje:</span>
                      <p className="break-words" data-testid="detail-message">{selectedEvent.message}</p>
                    </div>
                    
                    {selectedEvent.meta && (
                      <div>
                        <span className="text-muted-foreground">Meta:</span>
                        <pre className="mt-1 p-2 bg-muted/50 rounded text-[10px] overflow-x-auto max-h-60" data-testid="detail-meta">
                          {JSON.stringify(selectedEvent.meta, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm" data-testid="detail-empty-message">
                    Selecciona un evento para ver los detalles
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
