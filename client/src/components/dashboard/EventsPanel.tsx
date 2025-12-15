import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertTriangle, 
  XCircle, 
  Info,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEventsFeed } from "@/context/EventsWebSocketContext";
import { BotEvent } from "@/hooks/useEventsWebSocket";
import { cn } from "@/lib/utils";

export function EventsPanel() {
  const { events: allEvents, status, clearEvents, connect, isConnected } = useEventsFeed();
  const events = allEvents.slice(0, 50);

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
      TRADE_SKIPPED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
      DAILY_LIMIT_HIT: "bg-red-500/20 text-red-400 border-red-500/30",
      BOT_STARTED: "bg-green-500/20 text-green-400 border-green-500/30",
      BOT_STOPPED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
      KRAKEN_ERROR: "bg-red-500/20 text-red-400 border-red-500/30",
      SIGNAL_GENERATED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      STOP_LOSS_HIT: "bg-red-500/20 text-red-400 border-red-500/30",
      TAKE_PROFIT_HIT: "bg-green-500/20 text-green-400 border-green-500/30",
      ENGINE_TICK: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      MARKET_SCAN_SUMMARY: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
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
    <Card className="h-full" data-testid="events-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Eventos del Bot
            <Badge 
              variant="outline" 
              className={cn(
                "gap-1 text-xs",
                isConnected ? "border-green-500 text-green-400" : 
                status === "reconnecting" ? "border-yellow-500 text-yellow-400" :
                "border-red-500 text-red-400"
              )}
              data-testid="events-ws-status"
            >
              {isConnected ? <Wifi className="h-3 w-3" /> : 
               status === "reconnecting" ? <RefreshCw className="h-3 w-3 animate-spin" /> :
               <WifiOff className="h-3 w-3" />}
              {isConnected ? "Live" : status === "reconnecting" ? "..." : "Off"}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={clearEvents}
              title="Limpiar eventos"
              data-testid="button-clear-events"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {!isConnected && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={connect}
                title="Reconectar"
                data-testid="button-reconnect-events"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[300px]">
          <div className="space-y-2">
            {events.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                {isConnected ? "Esperando eventos..." : "Conectando..."}
              </div>
            ) : (
              events.slice(0, 20).map((event, idx) => (
                <div
                  key={event.id || `${event.timestamp}-${idx}`}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  data-testid={`event-item-${event.id || idx}`}
                >
                  {getLevelIcon(event.level)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getTypeBadge(event.type)}
                      {event.meta?.pair && (
                        <Badge variant="outline" className="text-xs">
                          {event.meta.pair}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                        {formatDate(event.timestamp)} {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 mt-1 line-clamp-2">
                      {event.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
