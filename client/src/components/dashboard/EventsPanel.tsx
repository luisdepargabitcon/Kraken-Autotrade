import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, 
  AlertTriangle, 
  XCircle, 
  Info,
  RefreshCw,
  Filter
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BotEvent {
  id: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  type: string;
  message: string;
  meta: Record<string, any> | null;
}

export function EventsPanel() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchEvents = async () => {
    try {
      const response = await fetch("/api/events?limit=50");
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
      }
    } catch (error) {
      console.error("Error fetching events:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    
    if (autoRefresh) {
      const interval = setInterval(fetchEvents, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const filteredEvents = levelFilter === "all" 
    ? events 
    : events.filter(e => e.level === levelFilter);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "ERROR":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "WARN":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-cyan-500" />;
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "ERROR":
        return <Badge variant="destructive" className="text-xs">ERROR</Badge>;
      case "WARN":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">WARN</Badge>;
      default:
        return <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-xs">INFO</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    const typeColors: Record<string, string> = {
      TRADE_EXECUTED: "bg-green-500/20 text-green-400 border-green-500/30",
      TRADE_BLOCKED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      TRADE_FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
      DAILY_LIMIT_HIT: "bg-red-500/20 text-red-400 border-red-500/30",
      BOT_STARTED: "bg-green-500/20 text-green-400 border-green-500/30",
      BOT_STOPPED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
      KRAKEN_ERROR: "bg-red-500/20 text-red-400 border-red-500/30",
      SIGNAL_GENERATED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      STOP_LOSS_HIT: "bg-red-500/20 text-red-400 border-red-500/30",
      TAKE_PROFIT_HIT: "bg-green-500/20 text-green-400 border-green-500/30",
    };
    
    const colorClass = typeColors[type] || "bg-primary/20 text-primary border-primary/30";
    return <Badge className={`${colorClass} text-xs`}>{type.replace(/_/g, " ")}</Badge>;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("es-ES", { 
      hour: "2-digit", 
      minute: "2-digit",
      second: "2-digit"
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("es-ES", { 
      day: "2-digit",
      month: "2-digit"
    });
  };

  return (
    <Card className="glass-panel border-border/50" data-testid="events-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Eventos del Bot</CardTitle>
            {autoRefresh && (
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">En vivo</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[100px] h-8 text-xs" data-testid="filter-level">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="INFO">Info</SelectItem>
                <SelectItem value="WARN">Warn</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setAutoRefresh(!autoRefresh)}
              data-testid="toggle-autorefresh"
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? "text-green-500" : "text-muted-foreground"}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[400px] pr-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Activity className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">No hay eventos registrados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEvents.map((event) => (
                <TooltipProvider key={event.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div 
                        className="p-3 rounded-lg border border-border/50 bg-card/30 hover:bg-card/50 transition-colors cursor-pointer"
                        data-testid={`event-row-${event.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {getLevelIcon(event.level)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {getLevelBadge(event.level)}
                              {getTypeBadge(event.type)}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatDate(event.timestamp)} {formatTime(event.timestamp)}
                              </span>
                            </div>
                            <p className="text-sm text-foreground truncate">
                              {event.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    {event.meta && (
                      <TooltipContent side="left" className="max-w-sm">
                        <div className="text-xs">
                          <p className="font-semibold mb-1">Detalles:</p>
                          <pre className="whitespace-pre-wrap text-muted-foreground">
                            {JSON.stringify(event.meta, null, 2)}
                          </pre>
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
