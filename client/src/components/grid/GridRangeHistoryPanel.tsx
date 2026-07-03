import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

interface GridRangeHistoryPanelProps {
  rangeHistory: any[];
}

export function GridRangeHistoryPanel({ rangeHistory }: GridRangeHistoryPanelProps) {
  if (!rangeHistory || rangeHistory.length === 0) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Histórico de cambios de banda
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[200px] overflow-y-auto">
          {rangeHistory.slice(0, 8).map((ev, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border p-2 text-sm">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{ev.eventType}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-ES") : ""}
                  </span>
                </div>
                <p className="text-sm">{ev.reason || ev.naturalMessage || ev.message}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
