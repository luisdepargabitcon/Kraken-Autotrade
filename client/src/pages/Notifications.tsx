import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Bell, Clock, Plus, Trash2, Users, Check, AlertTriangle, TrendingUp, Heart, AlertCircle, RefreshCw, Send, MessageSquare, Shield, BarChart3, Zap, Calculator, Brain, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";

interface AlertPreferences {
  // Trading
  trade_buy?: boolean;
  trade_sell?: boolean;
  trade_breakeven?: boolean;
  trade_trailing?: boolean;
  trade_stoploss?: boolean;
  trade_takeprofit?: boolean;
  trade_timestop?: boolean;
  trade_daily_pnl?: boolean;
  trade_pending?: boolean;
  trade_filled?: boolean;
  trade_spread_rejected?: boolean;
  // Strategy / Regime
  strategy_regime_change?: boolean;
  strategy_router_transition?: boolean;
  // System
  system_bot_started?: boolean;
  system_bot_paused?: boolean;
  daily_report?: boolean;
  // Errors
  error_critical?: boolean;
  error_api?: boolean;
  error_nonce?: boolean;
  // Risk / Balance
  balance_exposure?: boolean;
  // Heartbeat
  heartbeat_periodic?: boolean;
  // Smart Exit
  smart_exit_threshold?: boolean;
  smart_exit_executed?: boolean;
  smart_exit_regime?: boolean;
  // FISCO
  fisco_sync_daily?: boolean;
  fisco_sync_manual?: boolean;
  fisco_report_generated?: boolean;
  fisco_error_sync?: boolean;
  // Entry intent
  entry_intent?: boolean;
  // Market Data Degraded
  system_market_data_degraded_on?: boolean;
  system_market_data_degraded_off?: boolean;
  trade_entry_blocked_degraded?: boolean;
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
  signalRejectionAlertsEnabled: boolean;
  buySnapshotAlertsEnabled: boolean;
  spreadTelegramAlertEnabled: boolean;
  spreadTelegramCooldownMs: number;
  errorAlertChatId?: string | null;
  signalRejectionAlertChatId?: string | null;
}

export default function Notifications() {
  const queryClient = useQueryClient();
  
  const [newChatName, setNewChatName] = useState("");
  const [newChatId, setNewChatId] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<string>("default");
  const [manualChatId, setManualChatId] = useState("");
  const [saveManualChat, setSaveManualChat] = useState(false);
  const [manualChatName, setManualChatName] = useState("");
  const [newAlertPreferences, setNewAlertPreferences] = useState<AlertPreferences>({
    trade_buy: true, trade_sell: true, trade_stoploss: true, trade_takeprofit: true,
    trade_breakeven: true, trade_trailing: true, trade_timestop: true, trade_daily_pnl: true,
    trade_pending: true, trade_filled: true, trade_spread_rejected: false,
    strategy_regime_change: true, strategy_router_transition: true,
    system_bot_started: true, system_bot_paused: true, daily_report: true,
    error_critical: true, error_api: true, error_nonce: true,
    balance_exposure: false,
    heartbeat_periodic: false,
    smart_exit_threshold: true, smart_exit_executed: true, smart_exit_regime: false,
    fisco_sync_daily: true, fisco_sync_manual: true, fisco_report_generated: true, fisco_error_sync: true,
    entry_intent: false,
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateAlertPreference = (chatId: number, key: keyof AlertPreferences, value: boolean, currentPrefs?: AlertPreferences) => {
    const newPrefs = { ...(currentPrefs || {}), [key]: value };
    updateChatMutation.mutate({ id: chatId, alertPreferences: newPrefs });
  };

  const ALERT_SUBTYPES: { category: string; icon: string; description: string; subtypes: { key: keyof AlertPreferences; label: string; hint?: string }[] }[] = [
    {
      category: "Trading",
      icon: "📊",
      description: "Compras, ventas y ejecuciones de trading",
      subtypes: [
        { key: "trade_buy", label: "Compras ejecutadas", hint: "Alerta al confirmar una compra" },
        { key: "trade_sell", label: "Ventas ejecutadas", hint: "Alerta al confirmar una venta" },
        { key: "trade_pending", label: "Órdenes pendientes", hint: "Alerta al enviar una orden al exchange" },
        { key: "trade_filled", label: "Órdenes completadas", hint: "Alerta cuando una orden pendiente se completa" },
        { key: "trade_stoploss", label: "Stop-Loss activado", hint: "Alerta al activarse un stop-loss" },
        { key: "trade_takeprofit", label: "Take-Profit activado", hint: "Alerta al activarse un take-profit" },
        { key: "trade_breakeven", label: "Break-Even activado", hint: "Alerta al activarse el break-even" },
        { key: "trade_trailing", label: "Trailing Stop activado", hint: "Alerta al activarse el trailing stop" },
        { key: "trade_timestop", label: "Time-Stop activado", hint: "Alerta cuando una posición supera el tiempo máximo" },
        { key: "trade_daily_pnl", label: "Resumen diario P&L", hint: "Resumen de ganancias/pérdidas del día" },
        { key: "trade_spread_rejected", label: "Spread rechazado", hint: "Alerta cuando el spread bloquea una compra" },
        { key: "entry_intent", label: "Intención de entrada", hint: "Alerta cuando se detecta señal pero aún no se ejecuta" },
        { key: "trade_entry_blocked_degraded", label: "Compra bloqueada (degradado)", hint: "Alerta cuando una compra se bloquea por datos de mercado degradados" },
      ],
    },
    {
      category: "Riesgo / Smart Guard",
      icon: "🛡️",
      description: "Alertas de gestión de riesgo y Smart Exit",
      subtypes: [
        { key: "balance_exposure", label: "Exposición de balance", hint: "Alerta al superar límites de exposición" },
        { key: "smart_exit_threshold", label: "Smart Exit: umbral", hint: "Alerta cuando un activo alcanza umbral de salida" },
        { key: "smart_exit_executed", label: "Smart Exit: ejecutado", hint: "Alerta cuando Smart Exit cierra una posición" },
        { key: "smart_exit_regime", label: "Smart Exit: régimen", hint: "Alerta cuando Smart Exit detecta cambio de régimen" },
      ],
    },
    {
      category: "Estrategia / Régimen",
      icon: "🧭",
      description: "Cambios de régimen de mercado y transiciones de estrategia",
      subtypes: [
        { key: "strategy_regime_change", label: "Cambio de régimen", hint: "TREND ↔ RANGE ↔ TRANSITION" },
        { key: "strategy_router_transition", label: "Transición de router", hint: "Cambio de estrategia del router dinámico" },
      ],
    },
    {
      category: "Informes / Sistema",
      icon: "📋",
      description: "Reportes diarios, heartbeat y estado del bot",
      subtypes: [
        { key: "daily_report", label: "Reporte diario (14:00)", hint: "Informe completo diario del bot" },
        { key: "heartbeat_periodic", label: "Heartbeat periódico", hint: "Verificación automática de que el bot está vivo" },
        { key: "system_bot_started", label: "Bot iniciado", hint: "Alerta al arrancar el bot" },
        { key: "system_bot_paused", label: "Bot pausado/detenido", hint: "Alerta al detener el bot" },
        { key: "system_market_data_degraded_on", label: "Market data degradado (ON)", hint: "Alerta al activarse modo degradado de datos" },
        { key: "system_market_data_degraded_off", label: "Market data recuperado (OFF)", hint: "Alerta al recuperarse los datos de mercado" },
      ],
    },
    {
      category: "Errores / Sistema",
      icon: "🚨",
      description: "Errores críticos, fallos de API y errores de nonce",
      subtypes: [
        { key: "error_critical", label: "Errores críticos", hint: "PRICE_INVALID, DATABASE_ERROR, SYSTEM_ERROR, etc." },
        { key: "error_api", label: "Errores de API", hint: "Fallos de comunicación con exchanges" },
        { key: "error_nonce", label: "Errores de Nonce", hint: "Errores persistentes de nonce con Kraken" },
      ],
    },
    {
      category: "Fiscal / FISCO",
      icon: "🧾",
      description: "Sincronización fiscal, informes y errores FISCO",
      subtypes: [
        { key: "fisco_sync_daily", label: "Sync diario FISCO", hint: "Alerta de sincronización fiscal automática" },
        { key: "fisco_sync_manual", label: "Sync manual FISCO", hint: "Alerta de sincronización fiscal manual" },
        { key: "fisco_report_generated", label: "Informe fiscal generado", hint: "Alerta al generar un informe fiscal" },
        { key: "fisco_error_sync", label: "Error sync FISCO", hint: "Alerta de error en sincronización fiscal" },
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
        trade_breakeven: true, trade_trailing: true, trade_timestop: true, trade_daily_pnl: true,
        trade_pending: true, trade_filled: true, trade_spread_rejected: false,
        strategy_regime_change: true, strategy_router_transition: true,
        system_bot_started: true, system_bot_paused: true, daily_report: true,
        error_critical: true, error_api: true, error_nonce: true,
        balance_exposure: false, heartbeat_periodic: false,
        smart_exit_threshold: true, smart_exit_executed: true, smart_exit_regime: false,
        fisco_sync_daily: true, fisco_sync_manual: true, fisco_report_generated: true, fisco_error_sync: true,
        entry_intent: false,
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
      let payload: any = { message: customMessage };
      
      if (selectedDestination === "manual") {
        payload.chatId = manualChatId;
        
        if (saveManualChat && manualChatName.trim()) {
          // First save the chat, then send message
          const saveRes = await fetch("/api/telegram/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: manualChatName.trim(),
              chatId: manualChatId,
              alertPreferences: newAlertPreferences,
            }),
          });
          if (!saveRes.ok) {
            const error = await saveRes.json();
            throw new Error(error.error || "Failed to save chat");
          }
          queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
        }
      } else if (selectedDestination !== "default") {
        payload.chatRefId = parseInt(selectedDestination);
      }
      
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mensaje enviado a Telegram");
      setCustomMessage("");
      setManualChatId("");
      setSaveManualChat(false);
      setManualChatName("");
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

  const activeChatsCount = telegramChats.filter(c => c.isActive).length;
  const totalSubtypes = ALERT_SUBTYPES.reduce((acc, cat) => acc + cat.subtypes.length, 0);

  return (
    <TooltipProvider>
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
        
        <main className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-6">
          {/* HEADER */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold font-sans tracking-tight flex items-center gap-3" data-testid="title-notifications">
                <Bell className="h-8 w-8 text-primary" />
                Notificaciones
              </h1>
              <p className="text-muted-foreground mt-1">Centro unificado de alertas Telegram. Toda la configuración de notificaciones desde aquí.</p>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className={`h-2.5 w-2.5 rounded-full ${apiConfig?.telegramConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                {apiConfig?.telegramConnected ? 'Conectado' : 'Desconectado'}
              </div>
              <span className="text-border">|</span>
              <span>{activeChatsCount} canal{activeChatsCount !== 1 ? 'es' : ''} activo{activeChatsCount !== 1 ? 's' : ''}</span>
              <span className="text-border">|</span>
              <span>{totalSubtypes} tipos de alerta</span>
            </div>
          </div>

          {/* TELEGRAM NOT CONNECTED WARNING */}
          {!apiConfig?.telegramConnected && (
            <Card className="glass-panel border-yellow-500/50 bg-yellow-500/10">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
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

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 1: TELEGRAM STATUS + TEST */}
            {/* ═══════════════════════════════════════════════════════ */}
            {apiConfig?.telegramConnected && (
              <Card className="glass-panel border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <MessageSquare className="h-5 w-5 text-green-400" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">Enviar Mensaje de Prueba</CardTitle>
                      <CardDescription>Envía un mensaje para verificar que Telegram funciona correctamente.</CardDescription>
                    </div>
                    <div className="flex items-center gap-1.5 text-green-500 bg-green-500/10 px-2.5 py-1 rounded-full">
                      <Check className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">CONECTADO</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-2">
                      <Select value={selectedDestination} onValueChange={setSelectedDestination}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Destino" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Chat por defecto</SelectItem>
                          {telegramChats?.map((chat) => (
                            <SelectItem key={chat.id} value={chat.id.toString()}>
                              {chat.name} ({chat.chatId})
                            </SelectItem>
                          ))}
                          <SelectItem value="manual">Chat manual (ID)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedDestination === "manual" && (
                    <div className="space-y-2 p-3 border border-border rounded-lg bg-card/30">
                      <Input
                        placeholder="Chat ID (ej: -1001234567890)"
                        value={manualChatId}
                        onChange={(e) => setManualChatId(e.target.value)}
                        className="font-mono h-9"
                      />
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="saveManualChat"
                          checked={saveManualChat}
                          onCheckedChange={(checked) => setSaveManualChat(checked as boolean)}
                        />
                        <Label htmlFor="saveManualChat" className="text-xs">Guardar este chat</Label>
                      </div>
                      {saveManualChat && (
                        <Input
                          placeholder="Nombre del chat"
                          value={manualChatName}
                          onChange={(e) => setManualChatName(e.target.value)}
                          className="h-9"
                        />
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Mensaje de prueba..."
                      className="bg-background/50 min-h-[60px] flex-1"
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      data-testid="input-custom-message"
                    />
                    <Button 
                      className="self-end"
                      onClick={() => sendMessageMutation.mutate()}
                      disabled={
                        !customMessage.trim() || 
                        sendMessageMutation.isPending ||
                        (selectedDestination === "manual" && !manualChatId.trim())
                      }
                      data-testid="button-send-message"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Comandos disponibles: /estado, /pausar, /reanudar, /balance, /cartera, /posiciones, /ultimas, /ayuda
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 2: GLOBAL TOGGLES */}
            {/* ═══════════════════════════════════════════════════════ */}
            <Card className="glass-panel border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Zap className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Alertas Globales</CardTitle>
                    <CardDescription>Toggles maestros que controlan categorías completas de alertas independientemente del canal.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Alertas de Error de Nonce</Label>
                      <p className="text-xs text-muted-foreground">Errores persistentes de nonce con Kraken</p>
                    </div>
                    <Switch 
                      checked={config?.nonceErrorAlertsEnabled ?? true}
                      onCheckedChange={(checked) => updateConfigMutation.mutate({ nonceErrorAlertsEnabled: checked })}
                      data-testid="switch-nonce-alerts"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Rechazo de Señales</Label>
                      <p className="text-xs text-muted-foreground">Filtros MTF / Anti-Cresta bloquean compra</p>
                    </div>
                    <Switch 
                      checked={config?.signalRejectionAlertsEnabled ?? true}
                      onCheckedChange={(checked) => updateConfigMutation.mutate({ signalRejectionAlertsEnabled: checked })}
                      data-testid="switch-signal-rejection-alerts"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Snapshot de Compra</Label>
                      <p className="text-xs text-muted-foreground">Snapshot técnico al ejecutar una compra</p>
                    </div>
                    <Switch 
                      checked={config?.buySnapshotAlertsEnabled ?? true}
                      onCheckedChange={(checked) => updateConfigMutation.mutate({ buySnapshotAlertsEnabled: checked })}
                      data-testid="switch-buy-snapshot-alerts"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Alerta de Spread</Label>
                      <p className="text-xs text-muted-foreground">Alerta cuando el spread rechaza una operación</p>
                    </div>
                    <Switch 
                      checked={config?.spreadTelegramAlertEnabled ?? true}
                      onCheckedChange={(checked) => updateConfigMutation.mutate({ spreadTelegramAlertEnabled: checked })}
                      data-testid="switch-spread-telegram-alert"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 3: ROUTING — ERROR / REJECTION CHAT DESTINATIONS */}
            {/* ═══════════════════════════════════════════════════════ */}
            <Card className="glass-panel border-red-500/20 bg-red-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <Shield className="h-5 w-5 text-red-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Destino de Alertas Especiales</CardTitle>
                    <CardDescription>Dirige alertas críticas y de rechazo a canales específicos.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Errores Críticos</Label>
                    <Select 
                      value={config?.errorAlertChatId ?? "all"}
                      onValueChange={(value) => {
                        const chatId = value === "all" ? null : value;
                        updateConfigMutation.mutate({ errorAlertChatId: chatId });
                      }}
                      data-testid="select-error-alert-chat"
                    >
                      <SelectTrigger className="bg-background/50 h-9">
                        <SelectValue placeholder="Seleccionar destino" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Todos los chats activos</span>
                        </SelectItem>
                        {telegramChats.filter(chat => chat.isActive).map(chat => (
                          <SelectItem key={chat.id} value={chat.chatId}>
                            {chat.name} <span className="text-muted-foreground font-mono text-xs">({chat.chatId})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">PRICE_INVALID, API_ERROR, DATABASE_ERROR, TRADING_ERROR, SYSTEM_ERROR</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Rechazo de Señales</Label>
                    <Select
                      value={config?.signalRejectionAlertChatId ?? "all"}
                      onValueChange={(value) => {
                        const chatId = value === "all" ? null : value;
                        updateConfigMutation.mutate({ signalRejectionAlertChatId: chatId });
                      }}
                      data-testid="select-signal-rejection-alert-chat"
                    >
                      <SelectTrigger className="bg-background/50 h-9">
                        <SelectValue placeholder="Seleccionar destino" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Todos los chats activos</span>
                        </SelectItem>
                        {telegramChats.filter(chat => chat.isActive).map(chat => (
                          <SelectItem key={chat.id} value={chat.chatId}>
                            {chat.name} <span className="text-muted-foreground font-mono text-xs">({chat.chatId})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Filtros MTF estricto y Anti-Cresta</p>
                  </div>
                </div>

                <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <div className="flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <strong>Actualmente:</strong>{" "}
                      Errores → {config?.errorAlertChatId ? (telegramChats.find(c => c.chatId === config.errorAlertChatId)?.name || config.errorAlertChatId) : "Todos"}{" | "}
                      Rechazos → {config?.signalRejectionAlertChatId ? (telegramChats.find(c => c.chatId === config.signalRejectionAlertChatId)?.name || config.signalRejectionAlertChatId) : "Todos"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 4: COOLDOWNS */}
            {/* ═══════════════════════════════════════════════════════ */}
            <Card className="glass-panel border-border/50">
              <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleSection('cooldowns')}>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Clock className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">Cooldowns</CardTitle>
                    <CardDescription>Tiempo mínimo entre notificaciones del mismo tipo.</CardDescription>
                  </div>
                  {expandedSections['cooldowns'] ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </div>
              </CardHeader>
              {(expandedSections['cooldowns'] ?? true) && (
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {[
                      { key: 'notifCooldownStopUpdated', label: 'Stop Actualiz.', icon: <RefreshCw className="h-3.5 w-3.5 text-orange-400" />, max: 3600, def: 60 },
                      { key: 'notifCooldownRegimeChange', label: 'Cambio Régimen', icon: <TrendingUp className="h-3.5 w-3.5 text-purple-400" />, max: 3600, def: 300 },
                      { key: 'notifCooldownHeartbeat', label: 'Heartbeat', icon: <Heart className="h-3.5 w-3.5 text-red-400" />, max: 86400, def: 3600 },
                      { key: 'notifCooldownTrades', label: 'Trades', icon: <BarChart3 className="h-3.5 w-3.5 text-green-400" />, max: 3600, def: 0 },
                      { key: 'notifCooldownErrors', label: 'Errores', icon: <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />, max: 3600, def: 60 },
                    ].map(({ key, label, icon, max, def }) => (
                      <div key={key} className="p-3 border border-border rounded-lg bg-card/30 space-y-2">
                        <div className="flex items-center gap-1.5">
                          {icon}
                          <Label className="text-xs">{label}</Label>
                        </div>
                        <div className="flex items-center gap-1">
                          <Input 
                            type="number"
                            min="0"
                            max={max}
                            defaultValue={(config as any)?.[key] ?? def}
                            key={`${key}-${(config as any)?.[key]}`}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value);
                              if (!isNaN(val) && val >= 0) {
                                updateConfigMutation.mutate({ [key]: val } as any);
                              }
                            }}
                            className="font-mono w-full h-8 text-sm"
                          />
                          <span className="text-[10px] text-muted-foreground shrink-0">s</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{formatCooldown((config as any)?.[key] ?? def)}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 5: TELEGRAM CHANNELS + PER-CHAT ALERT PREFS */}
            {/* ═══════════════════════════════════════════════════════ */}
            <Card className="glass-panel border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Users className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">Canales de Telegram</CardTitle>
                    <CardDescription>Configura qué alertas recibe cada canal. Cada tipo se controla individualmente por chat.</CardDescription>
                  </div>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{telegramChats.length} canal{telegramChats.length !== 1 ? 'es' : ''}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* EXISTING CHATS */}
                {telegramChats.length > 0 && (
                  <div className="space-y-3">
                    {telegramChats.map((chat) => (
                      <div key={chat.id} className={`border rounded-lg transition-colors ${chat.isActive ? 'border-border bg-card/30' : 'border-border/30 bg-card/10 opacity-60'}`}>
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={chat.isActive}
                              onCheckedChange={(checked) => updateChatMutation.mutate({ id: chat.id, isActive: checked })}
                              data-testid={`switch-chat-active-${chat.id}`}
                            />
                            <div>
                              <p className="font-medium text-sm">{chat.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{chat.chatId}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => toggleSection(`chat-${chat.id}`)}
                            >
                              {expandedSections[`chat-${chat.id}`] ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                              Alertas
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteChatMutation.mutate(chat.id)}
                              data-testid={`button-delete-chat-${chat.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        
                        {expandedSections[`chat-${chat.id}`] && (
                          <div className="border-t border-border/50 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {ALERT_SUBTYPES.map((category) => {
                              const allChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] ?? true);
                              const noneChecked = category.subtypes.every(s => chat.alertPreferences?.[s.key] === false);
                              return (
                                <div key={category.category} className="space-y-1.5 p-2.5 bg-card/50 rounded-md border border-border/30">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                                      <span>{category.icon}</span> {category.category}
                                    </p>
                                    <div className="flex gap-0.5">
                                      <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                        onClick={() => {
                                          const newPrefs = { ...(chat.alertPreferences || {}) };
                                          category.subtypes.forEach(s => { newPrefs[s.key] = true; });
                                          updateChatMutation.mutate({ id: chat.id, alertPreferences: newPrefs });
                                        }}
                                        disabled={allChecked}>Todo</Button>
                                      <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                        onClick={() => {
                                          const newPrefs = { ...(chat.alertPreferences || {}) };
                                          category.subtypes.forEach(s => { newPrefs[s.key] = false; });
                                          updateChatMutation.mutate({ id: chat.id, alertPreferences: newPrefs });
                                        }}
                                        disabled={noneChecked}>Ninguno</Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {category.subtypes.map((subtype) => {
                                      const isChecked = chat.alertPreferences?.[subtype.key] ?? true;
                                      return (
                                        <div key={subtype.key} className="flex items-center gap-1.5">
                                          <Checkbox
                                            id={`${chat.id}-${subtype.key}`}
                                            checked={isChecked}
                                            onCheckedChange={(checked) => 
                                              updateAlertPreference(chat.id, subtype.key, checked as boolean, chat.alertPreferences)
                                            }
                                            className="h-3.5 w-3.5"
                                            data-testid={`checkbox-${subtype.key}-${chat.id}`}
                                          />
                                          <Label htmlFor={`${chat.id}-${subtype.key}`} className="text-[11px] cursor-pointer leading-tight">
                                            {subtype.label}
                                          </Label>
                                          {subtype.hint && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Info className="h-3 w-3 text-muted-foreground/50 shrink-0 cursor-help" />
                                              </TooltipTrigger>
                                              <TooltipContent side="top" className="max-w-[200px] text-xs">
                                                {subtype.hint}
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
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

                {/* ADD NEW CHAT */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium text-muted-foreground">Añadir nuevo canal</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Nombre del canal</Label>
                      <Input
                        placeholder="Ej: Canal Señales"
                        value={newChatName}
                        onChange={(e) => setNewChatName(e.target.value)}
                        className="h-9"
                        data-testid="input-new-chat-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Chat ID</Label>
                      <Input
                        placeholder="Ej: -1001234567890"
                        value={newChatId}
                        onChange={(e) => setNewChatId(e.target.value)}
                        className="h-9 font-mono"
                        data-testid="input-new-chat-id"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-3">
                    {ALERT_SUBTYPES.map((category) => {
                      const allChecked = category.subtypes.every(s => newAlertPreferences[s.key] ?? true);
                      const noneChecked = category.subtypes.every(s => newAlertPreferences[s.key] === false);
                      return (
                        <div key={category.category} className="space-y-1.5 p-2.5 bg-card/50 rounded-md border border-border/30">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                              <span>{category.icon}</span> {category.category}
                            </p>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                onClick={() => {
                                  const updated = { ...newAlertPreferences };
                                  category.subtypes.forEach(s => { updated[s.key] = true; });
                                  setNewAlertPreferences(updated);
                                }}
                                disabled={allChecked}>Todo</Button>
                              <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]"
                                onClick={() => {
                                  const updated = { ...newAlertPreferences };
                                  category.subtypes.forEach(s => { updated[s.key] = false; });
                                  setNewAlertPreferences(updated);
                                }}
                                disabled={noneChecked}>Ninguno</Button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {category.subtypes.map((subtype) => (
                              <div key={subtype.key} className="flex items-center gap-1.5">
                                <Checkbox
                                  id={`new-${subtype.key}`}
                                  checked={newAlertPreferences[subtype.key] ?? true}
                                  onCheckedChange={(checked) => 
                                    setNewAlertPreferences(prev => ({ ...prev, [subtype.key]: checked as boolean }))
                                  }
                                  className="h-3.5 w-3.5"
                                  data-testid={`checkbox-new-${subtype.key}`}
                                />
                                <Label htmlFor={`new-${subtype.key}`} className="text-[11px] cursor-pointer leading-tight">
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
                    className="w-full"
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

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SECTION 6: SUMMARY FOOTER */}
            {/* ═══════════════════════════════════════════════════════ */}
            <Card className="glass-panel border-border/50 bg-card/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <p className="font-medium text-sm text-foreground">Resumen de categorías de alerta ({totalSubtypes} tipos)</p>
                    {ALERT_SUBTYPES.map(cat => (
                      <p key={cat.category}>
                        <strong>{cat.icon} {cat.category}:</strong>{" "}
                        {cat.subtypes.map(s => s.label).join(", ")}
                      </p>
                    ))}
                    <p className="pt-1 text-muted-foreground/60">Todas las notificaciones de Telegram se gestionan desde esta página. Usa los botones "Todo/Ninguno" para cambios rápidos por categoría.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
    </TooltipProvider>
  );
}
