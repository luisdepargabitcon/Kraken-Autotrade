/**
 * TelegramChannelsTab — Manage telegram_chats (active/inactive/deleted)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Check, X, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface TelegramChat {
  id: number;
  chatId: string;
  name: string;
  isActive: boolean;
  alertTrades: boolean;
  alertErrors: boolean;
  alertSystem: boolean;
  alertBalance: boolean;
  alertHeartbeat: boolean;
  alertPreferences: Record<string, boolean>;
}

const ALERT_SUBTYPES: { category: string; icon: string; subtypes: { key: string; label: string; hint?: string }[] }[] = [
  {
    category: "Trading Activo",
    icon: "📊",
    subtypes: [
      { key: "trade_buy", label: "Compras ejecutadas" },
      { key: "trade_sell", label: "Ventas ejecutadas" },
      { key: "trade_pending", label: "Órdenes pendientes" },
      { key: "trade_filled", label: "Órdenes completadas" },
      { key: "trade_stoploss", label: "Stop-Loss activado" },
      { key: "trade_takeprofit", label: "Take-Profit activado" },
      { key: "trade_breakeven", label: "Break-Even activado" },
      { key: "trade_trailing", label: "Trailing Stop activado" },
      { key: "trade_timestop", label: "Time-Stop activado" },
      { key: "trade_daily_pnl", label: "Resumen diario P&L" },
      { key: "trade_spread_rejected", label: "Spread rechazado" },
      { key: "entry_intent", label: "Intención de entrada" },
      { key: "trade_entry_blocked_degraded", label: "Compra bloqueada (degradado)" },
    ],
  },
  {
    category: "Riesgo / Smart Guard",
    icon: "🛡️",
    subtypes: [
      { key: "balance_exposure", label: "Exposición de balance" },
      { key: "smart_exit_threshold", label: "Smart Exit: umbral" },
      { key: "smart_exit_executed", label: "Smart Exit: ejecutado" },
      { key: "smart_exit_regime", label: "Smart Exit: régimen" },
    ],
  },
  {
    category: "Estrategia / Régimen",
    icon: "🧭",
    subtypes: [
      { key: "strategy_regime_change", label: "Cambio de régimen" },
      { key: "strategy_router_transition", label: "Transición de router" },
    ],
  },
  {
    category: "Informes / Sistema",
    icon: "📋",
    subtypes: [
      { key: "daily_report", label: "Reporte diario (14:00)" },
      { key: "heartbeat_periodic", label: "Heartbeat periódico" },
      { key: "system_bot_started", label: "Bot iniciado" },
      { key: "system_bot_paused", label: "Bot pausado/detenido" },
      { key: "system_market_data_degraded_on", label: "Market data degradado (ON)" },
      { key: "system_market_data_degraded_off", label: "Market data recuperado (OFF)" },
    ],
  },
  {
    category: "Errores / Sistema",
    icon: "🚨",
    subtypes: [
      { key: "error_critical", label: "Errores críticos" },
      { key: "error_api", label: "Errores de API" },
      { key: "error_nonce", label: "Errores de Nonce" },
    ],
  },
  {
    category: "Fiscal Crypto",
    icon: "🧾",
    subtypes: [
      { key: "fisco_sync_daily", label: "Sync diario fiscal" },
      { key: "fisco_sync_manual", label: "Sync manual fiscal" },
      { key: "fisco_report_generated", label: "Informe fiscal generado" },
      { key: "fisco_error_sync", label: "Error de sincronización fiscal" },
    ],
  },
];

export default function TelegramChannelsTab() {
  const queryClient = useQueryClient();
  const [newChatId, setNewChatId] = useState("");
  const [newChatName, setNewChatName] = useState("");
  const [expandedChats, setExpandedChats] = useState<Record<number, boolean>>({});
  const toggleExpanded = (id: number) => setExpandedChats(prev => ({ ...prev, [id]: !prev[id] }));

  const { data: chats = [], isLoading } = useQuery<TelegramChat[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addChat = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: newChatId, name: newChatName }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
      setNewChatId(""); setNewChatName("");
      toast.success("Canal añadido");
    },
    onError: () => toast.error("Error al añadir canal"),
  });

  const updateChat = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TelegramChat> & { id: number }) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => toast.error("Error al actualizar canal"),
  });

  const deleteChat = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/chats/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
      toast.success("Canal eliminado");
    },
    onError: () => toast.error("Error al eliminar canal"),
  });

  const activeCount = chats.filter(c => c.isActive).length;
  const inactiveCount = chats.filter(c => !c.isActive).length;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <Users className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">Canales de Telegram</CardTitle>
              <CardDescription className="text-xs">
                {activeCount} activos · {inactiveCount} inactivos · {chats.length} total
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add new channel */}
          <div className="flex items-end gap-2 p-3 rounded-lg border border-border/50 bg-muted/20">
            <div className="flex-1">
              <Label className="text-xs">Chat ID</Label>
              <Input placeholder="-1001234567890" value={newChatId} onChange={(e) => setNewChatId(e.target.value)}
                className="font-mono text-xs" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Nombre</Label>
              <Input placeholder="Mi canal" value={newChatName} onChange={(e) => setNewChatName(e.target.value)}
                className="text-xs" />
            </div>
            <Button size="sm" disabled={!newChatId || !newChatName || addChat.isPending}
              onClick={() => addChat.mutate()}>
              <Plus className="h-3 w-3 mr-1" /> Añadir
            </Button>
          </div>

          {/* Channel list */}
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Cargando...</div>
          ) : chats.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">No hay canales registrados</div>
          ) : (
            <div className="space-y-2">
              {chats.map((chat) => (
                <div key={chat.id} className={`p-3 rounded-lg border ${chat.isActive ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${chat.isActive ? "text-green-400 border-green-500/40" : "text-red-400 border-red-500/40"}`}>
                        {chat.isActive ? "ACTIVO" : "INACTIVO"}
                      </Badge>
                      <span className="text-sm font-medium">{chat.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">{chat.chatId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={chat.isActive}
                        onCheckedChange={(v) => updateChat.mutate({ id: chat.id, isActive: v })} />
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]"
                        onClick={() => toggleExpanded(chat.id)}>
                        {expandedChats[chat.id] ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                        Alertas
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => deleteChat.mutate(chat.id)}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "alertTrades", label: "Trades" },
                      { key: "alertErrors", label: "Errores" },
                      { key: "alertSystem", label: "Sistema" },
                      { key: "alertBalance", label: "Balance" },
                      { key: "alertHeartbeat", label: "Heartbeat" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px]">
                        {chat[key as keyof TelegramChat] ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <X className="h-3 w-3 text-red-400" />
                        )}
                        {label}
                      </div>
                    ))}
                  </div>

                  {expandedChats[chat.id] && (
                    <div className="mt-2 pt-2 border-t border-border/30 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {ALERT_SUBTYPES.map((category) => {
                        const allChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] ?? true);
                        const noneChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] === false);
                        return (
                          <div key={category.category} className="space-y-1 p-2 bg-card/50 rounded-md border border-border/30">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                <span>{category.icon}</span> {category.category}
                              </p>
                              <div className="flex gap-0.5">
                                <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                  disabled={allChecked}
                                  onClick={() => {
                                    const newPrefs = { ...(chat.alertPreferences || {}) };
                                    category.subtypes.forEach(s => { newPrefs[s.key] = true; });
                                    updateChat.mutate({ id: chat.id, alertPreferences: newPrefs });
                                  }}>Todo</Button>
                                <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                  disabled={noneChecked}
                                  onClick={() => {
                                    const newPrefs = { ...(chat.alertPreferences || {}) };
                                    category.subtypes.forEach(s => { newPrefs[s.key] = false; });
                                    updateChat.mutate({ id: chat.id, alertPreferences: newPrefs });
                                  }}>Ninguno</Button>
                              </div>
                            </div>
                            <div className="space-y-0.5">
                              {category.subtypes.map((subtype) => {
                                const isChecked = chat.alertPreferences?.[subtype.key] ?? true;
                                return (
                                  <label key={subtype.key} className="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" className="h-3 w-3" checked={isChecked}
                                      onChange={(e) => {
                                        const newPrefs = { ...(chat.alertPreferences || {}), [subtype.key]: e.target.checked };
                                        updateChat.mutate({ id: chat.id, alertPreferences: newPrefs });
                                      }} />
                                    <span className="text-[10px] leading-tight">{subtype.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
