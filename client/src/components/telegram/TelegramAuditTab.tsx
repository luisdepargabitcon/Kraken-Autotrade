/**
 * TelegramAuditTab — Alert events audit (sent/blocked/failed)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface AlertEvent {
  id: number;
  sourceModule: string;
  mode: string;
  alertType: string;
  severity: string;
  status: string;
  blockReason: string | null;
  chatId: string | null;
  pair: string | null;
  dedupeKey: string | null;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  sent: "text-green-400 border-green-500/40 bg-green-500/10",
  blocked_by_global_disabled: "text-red-400 border-red-500/40 bg-red-500/10",
  blocked_by_missing_channel: "text-orange-400 border-orange-500/40 bg-orange-500/10",
  blocked_by_channel_disabled: "text-orange-400 border-orange-500/40 bg-orange-500/10",
  blocked_by_dedupe: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
  blocked_by_rate_limit: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
  blocked_by_mode_disabled: "text-blue-400 border-blue-500/40 bg-blue-500/10",
  failed: "text-red-400 border-red-500/40 bg-red-500/10",
};

export default function TelegramAuditTab() {
  const [limit, setLimit] = useState(100);

  const { data: events = [], isLoading, refetch, isFetching } = useQuery<AlertEvent[]>({
    queryKey: ["telegramAlertEvents", limit],
    queryFn: async () => {
      const res = await fetch(`/api/telegram/alert-events?limit=${limit}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const sentCount = events.filter(e => e.status === "sent").length;
  const blockedCount = events.filter(e => e.status.startsWith("blocked")).length;
  const failedCount = events.filter(e => e.status === "failed").length;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <History className="h-5 w-5 text-indigo-400" />
              </div>
              <div>
                <CardTitle className="text-sm">Auditoría / Historial</CardTitle>
                <CardDescription className="text-xs">
                  {sentCount} enviados · {blockedCount} bloqueados · {failedCount} fallidos
                </CardDescription>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Cargando...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Sin eventos de alerta registrados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 px-2 text-muted-foreground">Fecha</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Módulo</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Tipo</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Sev</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Estado</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Par</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Chat</th>
                    <th className="text-left py-2 px-2 text-muted-foreground">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr key={evt.id} className="border-b border-border/20">
                      <td className="py-1.5 px-2 font-mono text-[10px]">{new Date(evt.createdAt).toLocaleString("es-ES")}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{evt.sourceModule}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{evt.alertType}</td>
                      <td className="py-1.5 px-2 text-[10px]">{evt.severity}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className={`text-[10px] ${statusColor[evt.status] || "text-muted-foreground"}`}>
                          {evt.status}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{evt.pair || "—"}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{evt.chatId || "—"}</td>
                      <td className="py-1.5 px-2 text-[10px] text-muted-foreground">{evt.blockReason || evt.errorMessage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
