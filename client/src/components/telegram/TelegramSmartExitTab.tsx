/**
 * TelegramSmartExitTab — Smart Exit notification config (FASE D5: migrated from SmartExitTab.tsx)
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface SmartExitNotifications {
  enabled: boolean;
  notifyOnThresholdHit: boolean;
  notifyOnExecutedExit: boolean;
  notifyOnRegimeChange: boolean;
  includeSnapshot: boolean;
  includePnl: boolean;
  includeReasons: boolean;
  cooldownSec: number;
  minScoreToNotify: number;
  oneAlertPerEvent: boolean;
}

const DEFAULT_NOTIFICATIONS: SmartExitNotifications = {
  enabled: true,
  notifyOnThresholdHit: true,
  notifyOnExecutedExit: true,
  notifyOnRegimeChange: false,
  includeSnapshot: true,
  includePnl: true,
  includeReasons: true,
  cooldownSec: 300,
  minScoreToNotify: 3,
  oneAlertPerEvent: true,
};

export default function TelegramSmartExitTab() {
  const queryClient = useQueryClient();

  const { data: botConfig, isLoading } = useQuery<any>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const smartExitConfig = botConfig?.smartExitConfig ?? {};
  const notifications: SmartExitNotifications = { ...DEFAULT_NOTIFICATIONS, ...(smartExitConfig.notifications ?? {}) };

  const updateNotifications = useMutation({
    mutationFn: async (patch: Partial<SmartExitNotifications>) => {
      const merged = { ...smartExitConfig, notifications: { ...notifications, ...patch } };
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smartExitConfig: merged }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Smart Exit notificaciones actualizadas");
    },
    onError: () => toast.error("Error al actualizar"),
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Bell className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-sm">Smart Exit — Notificaciones</CardTitle>
                <CardDescription className="text-xs">Alertas de salida inteligente enviadas por Telegram</CardDescription>
              </div>
            </div>
            <Switch checked={notifications.enabled}
              onCheckedChange={(v) => updateNotifications.mutate({ enabled: v })} />
          </div>
        </CardHeader>
        {notifications.enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: "notifyOnThresholdHit" as const, label: "Umbral alcanzado", desc: "Score supera el umbral" },
                { key: "notifyOnExecutedExit" as const, label: "Salida ejecutada", desc: "Smart Exit cierra posición" },
                { key: "notifyOnRegimeChange" as const, label: "Cambio de régimen", desc: "Régimen de mercado cambia" },
              ].map((n) => (
                <div key={n.key} className="flex items-center justify-between p-2 rounded-lg border border-border/30">
                  <div>
                    <div className="text-xs font-medium">{n.label}</div>
                    <div className="text-[10px] text-muted-foreground">{n.desc}</div>
                  </div>
                  <Switch
                    checked={notifications[n.key] as boolean}
                    onCheckedChange={(v) => updateNotifications.mutate({ [n.key]: v } as Partial<SmartExitNotifications>)}
                  />
                </div>
              ))}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Cooldown</Label>
                  <span className="text-xs font-mono text-muted-foreground">{notifications.cooldownSec}s</span>
                </div>
                <Slider value={[notifications.cooldownSec]} min={60} max={900} step={60}
                  onValueChange={([v]) => updateNotifications.mutate({ cooldownSec: v })} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Score mín. para notificar</Label>
                  <span className="text-xs font-mono text-muted-foreground">{notifications.minScoreToNotify}</span>
                </div>
                <Slider value={[notifications.minScoreToNotify]} min={1} max={10} step={1}
                  onValueChange={([v]) => updateNotifications.mutate({ minScoreToNotify: v })} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: "includeSnapshot" as const, label: "Incluir snapshot técnico" },
                { key: "includePnl" as const, label: "Incluir P&L" },
                { key: "includeReasons" as const, label: "Incluir razones de salida" },
              ].map((n) => (
                <div key={n.key} className="flex items-center justify-between p-2 rounded-lg border border-border/30">
                  <Label className="text-xs">{n.label}</Label>
                  <Switch checked={notifications[n.key] as boolean}
                    onCheckedChange={(v) => updateNotifications.mutate({ [n.key]: v } as Partial<SmartExitNotifications>)} />
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
