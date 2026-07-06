/**
 * TelegramIdcaHybridTab — IDCA Hybrid/Grid alert config (FASE UX: editable alert rules)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Brain, Save } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface GridAlertDefinition {
  type: string;
  label: string;
  defaultEnabled: boolean;
  defaultSeverity: string;
  defaultDedupeMinutes: number;
  maxMessagesPerHour: number;
  observerOnlyType: boolean;
  naturalTemplate: string;
}

interface AlertRule {
  id: number;
  chatId: number;
  mode: string;
  alertType: string;
  enabled: boolean;
  minSeverity: string;
  cooldownSeconds: number;
}

export default function TelegramIdcaHybridTab() {
  const queryClient = useQueryClient();
  const [editingRules, setEditingRules] = useState<Record<number, Partial<AlertRule>>>({});

  const { data: catalog = [] } = useQuery<GridAlertDefinition[]>({
    queryKey: ["gridAlertCatalog"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/grid-alert-catalog");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: alertRules = [] } = useQuery<AlertRule[]>({
    queryKey: ["telegramAlertRules"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/alert-rules");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<AlertRule> & { id: number }) => {
      const res = await fetch(`/api/telegram/alert-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramAlertRules"] });
      toast.success("Regla actualizada");
    },
    onError: () => toast.error("Error al actualizar regla"),
  });

  const gridRules = alertRules.filter(r => r.mode === "grid" || r.mode === "idca-hybrid");

  const getRuleForAlertType = (alertType: string) => {
    return gridRules.find(r => r.alertType === alertType);
  };

  const handleToggleEnabled = (rule: AlertRule) => {
    updateRule.mutate({ id: rule.id, enabled: !rule.enabled });
  };

  const handleSeverityChange = (rule: AlertRule, severity: string) => {
    updateRule.mutate({ id: rule.id, minSeverity: severity });
  };

  const handleCooldownChange = (rule: AlertRule, cooldown: number) => {
    updateRule.mutate({ id: rule.id, cooldownSeconds: cooldown });
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Grid / Hybrid — {catalog.length} alertas configurables</CardTitle>
              <CardDescription className="text-xs">Reglas de alerta para Grid/Hybrid</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-1">
            <p>• <strong>Regla de lenguaje</strong>: si <code>observer_only=true</code>, nunca "ejecutado"/"orden creada" — siempre "simulado"/"informativo"/"sin orden real"</p>
            <p>• Las alertas se envían a canales activos con las reglas habilitadas</p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {catalog.map((alert) => {
              const rule = getRuleForAlertType(alert.type);
              if (!rule) return null;

              return (
                <div key={alert.type} className="p-3 rounded-lg border border-border/30 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[10px] flex-1">{alert.type}</span>
                    <Badge variant="outline" className={`text-[9px] ${
                      alert.observerOnlyType ? "text-violet-400 border-violet-500/40" : "text-green-400 border-green-500/40"
                    }`}>
                      {alert.observerOnlyType ? "SIMULADO" : "REAL"}
                    </Badge>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggleEnabled(rule)}
                      className="ml-2"
                    />
                  </div>
                  <p className="text-muted-foreground">{alert.naturalTemplate}</p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <Label className="text-[9px]">Severidad mínima</Label>
                      <select
                        value={rule.minSeverity}
                        onChange={(e) => handleSeverityChange(rule, e.target.value)}
                        className="w-full h-7 px-2 rounded border border-input bg-background text-[10px]"
                      >
                        <option value="LOW">LOW</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="HIGH">HIGH</option>
                        <option value="CRITICAL">CRITICAL</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[9px]">Cooldown (seg)</Label>
                      <Input
                        type="number"
                        value={rule.cooldownSeconds}
                        onChange={(e) => handleCooldownChange(rule, parseInt(e.target.value) || 0)}
                        className="h-7 text-[10px]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
