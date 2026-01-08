import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Bell, Clock, Plus, Trash2, Users, Check, AlertTriangle, TrendingUp, Heart, AlertCircle, RefreshCw, Send, MessageSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";

interface AlertPreferences {
  trade_buy?: boolean;
  trade_sell?: boolean;
  trade_breakeven?: boolean;
  trade_trailing?: boolean;
  trade_stoploss?: boolean;
  trade_takeprofit?: boolean;
  trade_daily_pnl?: boolean;
  strategy_regime_change?: boolean;
  strategy_router_transition?: boolean;
  system_bot_started?: boolean;
  system_bot_paused?: boolean;
  error_api?: boolean;
  error_nonce?: boolean;
  balance_exposure?: boolean;
  heartbeat_periodic?: boolean;
}

interface TelegramChat {
  id: number;
  name: string;
  chatId: string;
  alertTrades: boolean;
  alertErrors: boolean;
  alertSystem: boolean;
  alertBalance: boolean;
  alertHeartbeat: boolean;
  alertPreferences?: AlertPreferences;
  isActive: boolean;
}

interface BotConfig {
  notifCooldownStopUpdated: number;
  notifCooldownRegimeChange: number;
  notifCooldownHeartbeat: number;
  notifCooldownTrades: number;
  notifCooldownErrors: number;
  nonceErrorAlertsEnabled: boolean;
}

export default function Notifications() {
  const queryClient = useQueryClient();
  
  const [newChatName, setNewChatName] = useState("");
  const [newChatId, setNewChatId] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [newAlertPreferences, setNewAlertPreferences] = useState<AlertPreferences>({
    trade_buy: true, trade_sell: true, trade_stoploss: true, trade_takeprofit: true,
    trade_breakeven: true, trade_trailing: true, trade_daily_pnl: true,
    strategy_regime_change: true, strategy_router_transition: true,
    system_bot_started: true, system_bot_paused: true,
    error_api: true, error_nonce: true,
    balance_exposure: false,
    heartbeat_periodic: false,
  });

  const updateAlertPreference = (chatId: number, key: keyof AlertPreferences, value: boolean, currentPrefs?: AlertPreferences) => {
    const newPrefs = { ...(currentPrefs || {}), [key]: value };
    updateChatMutation.mutate({ id: chatId, alertPreferences: newPrefs });
  };

  const ALERT_SUBTYPES: { category: string; subtypes: { key: keyof AlertPreferences; label: string }[] }[] = [
    {
      category: "Trades",
      subtypes: [
        { key: "trade_buy", label: "Compras" },
        { key: "trade_sell", label: "Ventas" },
        { key: "trade_stoploss", label: "Stop-Loss" },
        { key: "trade_takeprofit", label: "Take-Profit" },
        { key: "trade_breakeven", label: "Break-Even" },
        { key: "trade_trailing", label: "Trailing Stop" },
        { key: "trade_daily_pnl", label: "Resumen diario P&L" },
      ],
    },
    {
      category: "Estrategia",
      subtypes: [
        { key: "strategy_regime_change", label: "Cambio de régimen" },
        { key: "strategy_router_transition", label: "Transición de router" },
      ],
    },
    {
      category: "Sistema",
      subtypes: [
        { key: "system_bot_started", label: "Bot iniciado" },
        { key: "system_bot_paused", label: "Bot pausado" },
      ],
    },
    {
      category: "Errores",
      subtypes: [
        { key: "error_api", label: "Errores de API" },
        { key: "error_nonce", label: "Errores de Nonce" },
      ],
    },
    {
      category: "Balance",
      subtypes: [
        { key: "balance_exposure", label: "Alertas de exposición" },
      ],
    },
    {
      category: "Heartbeat",
      subtypes: [
        { key: "heartbeat_periodic", label: "Verificación periódica" },
      ],
    },
  ];

  const { data: config } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const { data: telegramChats = [] } = useQuery<TelegramChat[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed to fetch chats");
      return res.json();
    },
  });

  const { data: apiConfig } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed to fetch api config");
      return res.json();
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<BotConfig>) => {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Configuración actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración");
    },
  });

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newChatName,
          chatId: newChatId,
          alertPreferences: newAlertPreferences,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create chat");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Chat añadido correctamente");
      setNewChatName("");
      setNewChatId("");
      setNewAlertPreferences({
        trade_buy: true, trade_sell: true, trade_stoploss: true, trade_takeprofit: true,
        trade_breakeven: true, trade_trailing: true, trade_daily_pnl: true,
        strategy_regime_change: true, strategy_router_transition: true,
        system_bot_started: true, system_bot_paused: true,
        error_api: true, error_nonce: true,
        balance_exposure: false,
        heartbeat_periodic: false,
      });
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Chat eliminado");
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => {
      toast.error("Error al eliminar chat");
    },
  });

  const updateChatMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<TelegramChat>) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => {
      toast.error("Error al actualizar chat");
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: customMessage }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mensaje enviado a Telegram");
      setCustomMessage("");
    },
    onError: () => {
      toast.error("Error al enviar mensaje");
    },
  });

  const formatCooldown = (seconds: number): string => {
    if (seconds === 0) return "Sin límite";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    return `${Math.floor(seconds / 3600)}h`;
  };

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
        
        <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold font-sans tracking-tight flex items-center gap-3" data-testid="title-notifications">
                <Bell className="h-8 w-8 text-primary" />
                Notificaciones
              </h1>
              <p className="text-muted-foreground mt-1">Gestiona los canales de Telegram y controla qué alertas recibir.</p>
            </div>
          </div>

          {!apiConfig?.telegramConnected && (
            <Card className="glass-panel border-yellow-500/50 bg-yellow-500/10">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <p className="text-sm">
                  Telegram no está conectado. Ve a{" "}
                  <Link href="/integrations">
                    <span className="text-primary underline cursor-pointer">Integraciones</span>
                  </Link>{" "}
                  para configurar las credenciales del bot.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6">
            {apiConfig?.telegramConnected && (
              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <MessageSquare className="h-6 w-6 text-green-400" />
                    </div>
                    <div className="flex-1">
                      <CardTitle>Probar Conexión</CardTitle>
                      <CardDescription>Envía un mensaje de prueba para verificar que Telegram funciona.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Escribe un mensaje para enviar a Telegram..."
                    className="bg-background/50 min-h-[80px]"
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    data-testid="input-custom-message"
                  />
                  <Button 
                    className="w-full"
                    onClick={() => sendMessageMutation.mutate()}
                    disabled={!customMessage.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-message"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sendMessageMutation.isPending ? "Enviando..." : "Enviar Mensaje de Prueba"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Comandos disponibles en Docker/NAS: /estado, /pausar, /reanudar, /ultimas, /ayuda, /balance
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Clock className="h-6 w-6 text-blue-400" />
                  </div>
                  <div>
                    <CardTitle>Cooldown de Notificaciones</CardTitle>
                    <CardDescription>Tiempo mínimo entre notificaciones del mismo tipo para evitar spam.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-orange-400" />
                      <Label>Stop Actualizado</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number"
                        min="0"
                        max="3600"
                        defaultValue={config?.notifCooldownStopUpdated ?? 60}
                        key={`stop-${config?.notifCooldownStopUpdated}`}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateConfigMutation.mutate({ notifCooldownStopUpdated: val });
                          }
                        }}
                        className="font-mono w-24"
                        data-testid="input-cooldown-stop"
                      />
                      <span className="text-sm text-muted-foreground">segundos</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Actual: {formatCooldown(config?.notifCooldownStopUpdated ?? 60)}
                    </p>
                  </div>

                  <div className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-purple-400" />
                      <Label>Cambio de Régimen</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number"
                        min="0"
                        max="3600"
                        defaultValue={config?.notifCooldownRegimeChange ?? 300}
                        key={`regime-${config?.notifCooldownRegimeChange}`}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateConfigMutation.mutate({ notifCooldownRegimeChange: val });
                          }
                        }}
                        className="font-mono w-24"
                        data-testid="input-cooldown-regime"
                      />
                      <span className="text-sm text-muted-foreground">segundos</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Actual: {formatCooldown(config?.notifCooldownRegimeChange ?? 300)}
                    </p>
                  </div>

                  <div className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                    <div className="flex items-center gap-2">
                      <Heart className="h-4 w-4 text-red-400" />
                      <Label>Heartbeat</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number"
                        min="0"
                        max="86400"
                        defaultValue={config?.notifCooldownHeartbeat ?? 3600}
                        key={`heartbeat-${config?.notifCooldownHeartbeat}`}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateConfigMutation.mutate({ notifCooldownHeartbeat: val });
                          }
                        }}
                        className="font-mono w-24"
                        data-testid="input-cooldown-heartbeat"
                      />
                      <span className="text-sm text-muted-foreground">segundos</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Actual: {formatCooldown(config?.notifCooldownHeartbeat ?? 3600)}
                    </p>
                  </div>

                  <div className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-400" />
                      <Label>Errores</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number"
                        min="0"
                        max="3600"
                        defaultValue={config?.notifCooldownErrors ?? 60}
                        key={`errors-${config?.notifCooldownErrors}`}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateConfigMutation.mutate({ notifCooldownErrors: val });
                          }
                        }}
                        className="font-mono w-24"
                        data-testid="input-cooldown-errors"
                      />
                      <span className="text-sm text-muted-foreground">segundos</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Actual: {formatCooldown(config?.notifCooldownErrors ?? 60)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Alertas de Error de Nonce</Label>
                    <p className="text-sm text-muted-foreground">
                      Envía alerta por Telegram si hay errores persistentes de nonce con Kraken
                    </p>
                  </div>
                  <Switch 
                    checked={config?.nonceErrorAlertsEnabled ?? true}
                    onCheckedChange={(checked) => updateConfigMutation.mutate({ nonceErrorAlertsEnabled: checked })}
                    data-testid="switch-nonce-alerts"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Users className="h-6 w-6 text-green-400" />
                  </div>
                  <div>
                    <CardTitle>Canales de Telegram</CardTitle>
                    <CardDescription>Configura qué tipo de alertas recibe cada canal o chat.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {telegramChats.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">Canales configurados</h3>
                    {telegramChats.map((chat) => (
                      <div key={chat.id} className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={chat.isActive}
                              onCheckedChange={(checked) => updateChatMutation.mutate({ id: chat.id, isActive: checked })}
                              data-testid={`switch-chat-active-${chat.id}`}
                            />
                            <div>
                              <p className="font-medium">{chat.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{chat.chatId}</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteChatMutation.mutate(chat.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-chat-${chat.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                          {ALERT_SUBTYPES.map((category) => {
                            const allChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] ?? true);
                            const noneChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] === false);
                            return (
                              <div key={category.category} className="space-y-2 p-3 bg-card/50 rounded-md border border-border/50">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-medium text-muted-foreground">{category.category}</p>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 px-1.5 text-[10px]"
                                      onClick={() => {
                                        const newPrefs = { ...(chat.alertPreferences || {}) };
                                        category.subtypes.forEach(s => { newPrefs[s.key] = true; });
                                        updateChatMutation.mutate({ id: chat.id, alertPreferences: newPrefs });
                                      }}
                                      disabled={allChecked}
                                      data-testid={`btn-all-${category.category}-${chat.id}`}
                                    >
                                      Todo
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 px-1.5 text-[10px]"
                                      onClick={() => {
                                        const newPrefs = { ...(chat.alertPreferences || {}) };
                                        category.subtypes.forEach(s => { newPrefs[s.key] = false; });
                                        updateChatMutation.mutate({ id: chat.id, alertPreferences: newPrefs });
                                      }}
                                      disabled={noneChecked}
                                      data-testid={`btn-none-${category.category}-${chat.id}`}
                                    >
                                      Ninguno
                                    </Button>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  {category.subtypes.map((subtype) => {
                                    const isChecked = chat.alertPreferences?.[subtype.key] ?? true;
                                    return (
                                      <div key={subtype.key} className="flex items-center gap-2">
                                        <Checkbox
                                          id={`${chat.id}-${subtype.key}`}
                                          checked={isChecked}
                                          onCheckedChange={(checked) => 
                                            updateAlertPreference(chat.id, subtype.key, checked as boolean, chat.alertPreferences)
                                          }
                                          data-testid={`checkbox-${subtype.key}-${chat.id}`}
                                        />
                                        <Label htmlFor={`${chat.id}-${subtype.key}`} className="text-xs cursor-pointer">
                                          {subtype.label}
                                        </Label>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-border pt-6">
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">Añadir nuevo canal</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nombre del canal</Label>
                      <Input
                        placeholder="Ej: Canal Señales"
                        value={newChatName}
                        onChange={(e) => setNewChatName(e.target.value)}
                        data-testid="input-new-chat-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Chat ID</Label>
                      <Input
                        placeholder="Ej: -1001234567890"
                        value={newChatId}
                        onChange={(e) => setNewChatId(e.target.value)}
                        data-testid="input-new-chat-id"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {ALERT_SUBTYPES.map((category) => {
                      const allChecked = category.subtypes.every(s => newAlertPreferences[s.key] ?? true);
                      const noneChecked = category.subtypes.every(s => newAlertPreferences[s.key] === false);
                      return (
                        <div key={category.category} className="space-y-2 p-3 bg-card/50 rounded-md border border-border/50">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-muted-foreground">{category.category}</p>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => {
                                  const updated = { ...newAlertPreferences };
                                  category.subtypes.forEach(s => { updated[s.key] = true; });
                                  setNewAlertPreferences(updated);
                                }}
                                disabled={allChecked}
                              >
                                Todo
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => {
                                  const updated = { ...newAlertPreferences };
                                  category.subtypes.forEach(s => { updated[s.key] = false; });
                                  setNewAlertPreferences(updated);
                                }}
                                disabled={noneChecked}
                              >
                                Ninguno
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {category.subtypes.map((subtype) => (
                              <div key={subtype.key} className="flex items-center gap-2">
                                <Checkbox
                                  id={`new-${subtype.key}`}
                                  checked={newAlertPreferences[subtype.key] ?? true}
                                  onCheckedChange={(checked) => 
                                    setNewAlertPreferences(prev => ({ ...prev, [subtype.key]: checked as boolean }))
                                  }
                                  data-testid={`checkbox-new-${subtype.key}`}
                                />
                                <Label htmlFor={`new-${subtype.key}`} className="text-xs cursor-pointer">
                                  {subtype.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Button 
                    className="mt-4 w-full"
                    onClick={() => createChatMutation.mutate()}
                    disabled={!newChatName || !newChatId || createChatMutation.isPending}
                    data-testid="button-add-chat"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Añadir Canal
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel border-border/50 bg-card/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-500 mt-0.5" />
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p><strong>Trades:</strong> Compras, ventas, SL, TP, BE, trailing, y resumen diario P&L</p>
                    <p><strong>Errores:</strong> Fallos de API y errores de nonce</p>
                    <p><strong>Sistema:</strong> Bot iniciado/pausado</p>
                    <p><strong>Estrategia:</strong> Cambios de régimen y transiciones del router</p>
                    <p><strong>Balance:</strong> Alertas de exposición</p>
                    <p><strong>Heartbeat:</strong> Verificación periódica de actividad</p>
                    <p className="text-xs pt-2 text-muted-foreground/70">Cada tipo de alerta se controla individualmente. Usa los botones "Todo/Ninguno" para cambios rápidos por categoría.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
