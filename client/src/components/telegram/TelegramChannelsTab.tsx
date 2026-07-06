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
  isDefault: boolean;
  alertTrades: boolean;
  alertErrors: boolean;
  alertSystem: boolean;
  alertBalance: boolean;
  alertHeartbeat: boolean;
  alertPreferences: Record<string, boolean>;
  tokenId: number | null;
  enabledModes: string[] | null;
  enabledAlerts: string[] | null;
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

const MODE_OPTIONS = [
  { value: "SPOT_REAL", label: "SPOT Real" },
  { value: "SPOT_DRY_RUN", label: "SPOT Dry Run" },
  { value: "IDCA", label: "IDCA" },
  { value: "GRID", label: "Grid / Hybrid" },
  { value: "SMART_EXIT", label: "Smart Exit" },
  { value: "FISCO", label: "Fiscalidad" },
  { value: "SYSTEM", label: "Sistema" },
  { value: "AI_SHADOW", label: "IA / Shadow" },
];

const ALERT_OPTIONS = [
  { value: "trades", label: "Trades" },
  { value: "errors", label: "Errores" },
  { value: "system", label: "Sistema" },
  { value: "balance", label: "Balance" },
  { value: "heartbeat", label: "Heartbeat" },
  { value: "grid", label: "Grid" },
  { value: "fiscal", label: "Fiscal" },
  { value: "smart_exit", label: "Smart Exit" },
  { value: "shadow", label: "Shadow" },
];

export default function TelegramChannelsTab() {
  const queryClient = useQueryClient();
  const [newChatId, setNewChatId] = useState("");
  const [newChatName, setNewChatName] = useState("");
  const [newIsActive, setNewIsActive] = useState(false);
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [newTokenId, setNewTokenId] = useState<number | null>(null);
  const [newEnabledModes, setNewEnabledModes] = useState<string[]>([]);
  const [newEnabledAlerts, setNewEnabledAlerts] = useState<string[]>([]);
  const [expandedChats, setExpandedChats] = useState<Record<number, boolean>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingChat, setEditingChat] = useState<TelegramChat | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<TelegramChat>>({});
  const toggleExpanded = (id: number) => setExpandedChats(prev => ({ ...prev, [id]: !prev[id] }));

  const { data: chats = [], isLoading } = useQuery<TelegramChat[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/channels");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: tokens = [] } = useQuery<{ id: number; name: string; isActive: boolean; isDefault: boolean; tokenLast4: string }[]>({
    queryKey: ["telegramTokens"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/tokens");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addChat = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: newChatId,
          name: newChatName,
          isActive: newIsActive,
          isDefault: newIsDefault,
          tokenId: newTokenId,
          enabledModes: newEnabledModes,
          enabledAlerts: newEnabledAlerts,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
      setNewChatId("");
      setNewChatName("");
      setNewIsActive(false);
      setNewIsDefault(false);
      setNewTokenId(null);
      setNewEnabledModes([]);
      setNewEnabledAlerts([]);
      setShowAddForm(false);
      toast.success("Canal añadido");
    },
    onError: () => toast.error("Error al añadir canal"),
  });

  const updateChat = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TelegramChat> & { id: number }) => {
      const res = await fetch(`/api/telegram/channels/${id}`, {
        method: "PUT",
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

  const toggleActive = (chat: TelegramChat) => {
    if (!chat.isActive && chat.alertPreferences?.importedFromLegacy) {
      if (!confirm("Este canal fue importado desde configuración legacy. Si lo activas puede volver a recibir alertas. Las reglas seguirán desactivadas hasta que las configures manualmente.")) {
        return;
      }
    }
    updateChat.mutate({ id: chat.id, isActive: !chat.isActive });
  };

  const startEdit = (chat: TelegramChat) => {
    setEditingChat(chat);
    setEditFormData({
      name: chat.name,
      chatId: chat.chatId,
      isActive: chat.isActive,
      isDefault: chat.isDefault,
      tokenId: chat.tokenId,
      enabledModes: chat.enabledModes,
      enabledAlerts: chat.enabledAlerts,
    });
  };

  const saveEdit = () => {
    if (!editingChat) return;
    updateChat.mutate(
      { id: editingChat.id, ...editFormData },
      {
        onSuccess: () => {
          setEditingChat(null);
          setEditFormData({});
          toast.success("Canal actualizado");
        },
      }
    );
  };

  const deleteChat = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/channels/${id}`, { method: "DELETE" });
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
          {/* Add new channel button */}
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} className="w-full">
            <Plus className="h-3 w-3 mr-1" /> {showAddForm ? "Cancelar" : "Añadir canal"}
          </Button>

          {/* Add channel form */}
          {showAddForm && (
            <div className="p-4 rounded-lg border border-border/50 bg-muted/30 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Chat ID</Label>
                  <Input placeholder="-1001234567890" value={newChatId} onChange={(e) => setNewChatId(e.target.value)}
                    className="font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Nombre</Label>
                  <Input placeholder="Mi canal" value={newChatName} onChange={(e) => setNewChatName(e.target.value)}
                    className="text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={newIsActive} onCheckedChange={setNewIsActive} />
                  <Label className="text-xs">Activo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={newIsDefault} onCheckedChange={setNewIsDefault} />
                  <Label className="text-xs">Canal por defecto</Label>
                </div>
              </div>

              <div>
                <Label className="text-xs">Token asociado</Label>
                <select
                  value={newTokenId ?? ""}
                  onChange={(e) => setNewTokenId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
                >
                  <option value="">Sin token</option>
                  {tokens.filter(t => t.isActive).map(t => (
                    <option key={t.id} value={t.id}>{t.name} (****{t.tokenLast4})</option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-xs mb-1 block">Modos permitidos</Label>
                <div className="flex flex-wrap gap-1">
                  {MODE_OPTIONS.map(mode => (
                    <label key={mode.value} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px] cursor-pointer hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="h-3 w-3"
                        checked={newEnabledModes.includes(mode.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewEnabledModes([...newEnabledModes, mode.value]);
                          } else {
                            setNewEnabledModes(newEnabledModes.filter(m => m !== mode.value));
                          }
                        }}
                      />
                      {mode.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs mb-1 block">Alertas permitidas</Label>
                <div className="flex flex-wrap gap-1">
                  {ALERT_OPTIONS.map(alert => (
                    <label key={alert.value} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px] cursor-pointer hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="h-3 w-3"
                        checked={newEnabledAlerts.includes(alert.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewEnabledAlerts([...newEnabledAlerts, alert.value]);
                          } else {
                            setNewEnabledAlerts(newEnabledAlerts.filter(a => a !== alert.value));
                          }
                        }}
                      />
                      {alert.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" disabled={!newChatId || !newChatName || addChat.isPending}
                  onClick={() => addChat.mutate()} className="flex-1">
                  <Plus className="h-3 w-3 mr-1" /> Guardar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>
          )}

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
                        onCheckedChange={() => toggleActive(chat)} />
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]"
                        onClick={() => startEdit(chat)}>
                        Editar
                      </Button>
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

      {/* Edit Modal */}
      {editingChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Editar canal</h3>
              <Button size="icon" variant="ghost" onClick={() => setEditingChat(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nombre</Label>
                <Input value={editFormData.name || ""} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} className="text-xs" />
              </div>
              <div>
                <Label className="text-xs">Chat ID</Label>
                <Input value={editFormData.chatId || ""} onChange={(e) => setEditFormData({ ...editFormData, chatId: e.target.value })} className="font-mono text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={editFormData.isActive} onCheckedChange={(v) => setEditFormData({ ...editFormData, isActive: v })} />
                <Label className="text-xs">Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editFormData.isDefault} onCheckedChange={(v) => setEditFormData({ ...editFormData, isDefault: v })} />
                <Label className="text-xs">Canal por defecto</Label>
              </div>
            </div>

            <div>
              <Label className="text-xs">Token asociado</Label>
              <select
                value={editFormData.tokenId ?? ""}
                onChange={(e) => setEditFormData({ ...editFormData, tokenId: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
              >
                <option value="">Sin token</option>
                {tokens.filter(t => t.isActive).map(t => (
                  <option key={t.id} value={t.id}>{t.name} (****{t.tokenLast4})</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Modos permitidos</Label>
              <div className="flex flex-wrap gap-1">
                {MODE_OPTIONS.map(mode => (
                  <label key={mode.value} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px] cursor-pointer hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={editFormData.enabledModes?.includes(mode.value)}
                      onChange={(e) => {
                        const current = editFormData.enabledModes || [];
                        if (e.target.checked) {
                          setEditFormData({ ...editFormData, enabledModes: [...current, mode.value] });
                        } else {
                          setEditFormData({ ...editFormData, enabledModes: current.filter(m => m !== mode.value) });
                        }
                      }}
                    />
                    {mode.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Alertas permitidas</Label>
              <div className="flex flex-wrap gap-1">
                {ALERT_OPTIONS.map(alert => (
                  <label key={alert.value} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px] cursor-pointer hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={editFormData.enabledAlerts?.includes(alert.value)}
                      onChange={(e) => {
                        const current = editFormData.enabledAlerts || [];
                        if (e.target.checked) {
                          setEditFormData({ ...editFormData, enabledAlerts: [...current, alert.value] });
                        } else {
                          setEditFormData({ ...editFormData, enabledAlerts: current.filter(a => a !== alert.value) });
                        }
                      }}
                    />
                    {alert.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={saveEdit} disabled={updateChat.isPending} className="flex-1">
                Guardar cambios
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingChat(null)} className="flex-1">
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
