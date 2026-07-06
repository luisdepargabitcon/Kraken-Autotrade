/**
 * TelegramSettingsTab — Global config, token, kill switch
 */
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Power, Send, Check, Eye, EyeOff, AlertTriangle, Zap, Clock, Users, RefreshCw, TrendingUp, Heart, BarChart3, AlertCircle, Shield } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface GlobalConfig {
  id?: number;
  telegramGlobalEnabled: boolean;
  telegramSilentMode: boolean;
  telegramMinSeverity: string;
  telegramDefaultDedupeMinutes: number;
  telegramDefaultRateLimitPerHour: number;
  telegramQuietHoursConfig: { enabled?: boolean; start?: string; end?: string; timezone?: string };
  telegramEnvironmentLabel: string;
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
  errorAlertChatId?: string | null;
  signalRejectionAlertChatId?: string | null;
}

interface TelegramChatLite {
  id: number;
  name: string;
  chatId: string;
  isActive: boolean;
}

export default function TelegramSettingsTab() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<string>("default");

  const { data: config, isLoading } = useQuery<GlobalConfig>({
    queryKey: ["telegramGlobalConfig"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/global-config");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: apiConfig } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: botConfig } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: telegramChats = [] } = useQuery<TelegramChatLite[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateBotConfig = useMutation({
    mutationFn: async (patch: Partial<BotConfig>) => {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Configuración actualizada");
    },
    onError: () => toast.error("Error al actualizar configuración"),
  });

  const sendCustomMessage = useMutation({
    mutationFn: async () => {
      let payload: any = { message: customMessage };
      if (selectedDestination !== "default") payload.chatRefId = parseInt(selectedDestination);
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mensaje enviado");
      setCustomMessage("");
    },
    onError: () => toast.error("Error al enviar mensaje"),
  });

  const formatCooldown = (seconds: number): string => {
    if (seconds === 0) return "Sin límite";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  useEffect(() => {
    if (apiConfig) {
      setChatId(apiConfig.telegramChatId || "");
    }
  }, [apiConfig]);

  const updateConfig = useMutation({
    mutationFn: async (patch: Partial<GlobalConfig>) => {
      const res = await fetch("/api/telegram/global-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramGlobalConfig"] });
      toast.success("Configuración global actualizada");
    },
    onError: () => toast.error("Error al actualizar configuración"),
  });

  const connectTelegram = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, chatId }),
      });
      if (!res.ok) throw new Error("Failed to connect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiConfig"] });
      toast.success("Telegram conectado correctamente");
    },
    onError: () => toast.error("Error al conectar Telegram"),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "🧪 Test desde Centro Telegram Unificado" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => toast.success("Test enviado"),
    onError: () => toast.error("Error enviando test"),
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  const isConnected = apiConfig?.telegramConnected;

  return (
    <div className="space-y-4">
      {/* Kill Switch */}
      <Card className={config?.telegramGlobalEnabled ? "border-green-500/30" : "border-red-500/30"}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${config?.telegramGlobalEnabled ? "bg-green-500/20" : "bg-red-500/20"}`}>
                <Power className={`h-5 w-5 ${config?.telegramGlobalEnabled ? "text-green-400" : "text-red-400"}`} />
              </div>
              <div>
                <CardTitle className="text-sm">Kill Switch Global</CardTitle>
                <CardDescription className="text-xs">Bloquea TODOS los envíos de Telegram</CardDescription>
              </div>
            </div>
            <Switch
              checked={config?.telegramGlobalEnabled ?? true}
              onCheckedChange={(v) => updateConfig.mutate({ telegramGlobalEnabled: v })}
            />
          </div>
        </CardHeader>
        <CardContent>
          {!config?.telegramGlobalEnabled && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span><strong>KILL SWITCH ACTIVO</strong> — Ningún mensaje será enviado. Solo CRITICAL puede pasar si silent mode está off.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Send className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">Conexión Bot</CardTitle>
              <CardDescription className="text-xs">Token y Chat ID principal</CardDescription>
            </div>
            {isConnected ? (
              <div className="flex items-center gap-2 text-green-500">
                <Check className="h-4 w-4" /><span className="text-xs font-mono">CONECTADO</span>
              </div>
            ) : (
              <span className="text-xs font-mono text-yellow-500">DESCONECTADO</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label className="text-xs">Bot Token (de @BotFather)</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="123456789:ABCdef..."
                className="font-mono bg-background/50 pr-10 text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full"
                onClick={() => setShowToken(!showToken)}>
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Chat ID principal</Label>
            <Input placeholder="-1001234567890" className="font-mono bg-background/50 text-xs"
              value={chatId} onChange={(e) => setChatId(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={!token || !chatId || connectTelegram.isPending}
              onClick={() => connectTelegram.mutate()}>
              {connectTelegram.isPending ? "Conectando..." : isConnected ? "Reconectar" : "Conectar"}
            </Button>
            <Button size="sm" variant="outline" disabled={!isConnected || sendTest.isPending}
              onClick={() => sendTest.mutate()}>
              <Send className="h-3 w-3 mr-1" /> Test
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Enviar mensaje de prueba a canal específico */}
      {isConnected && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Send className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <CardTitle className="text-sm">Enviar Mensaje de Prueba</CardTitle>
                <CardDescription className="text-xs">Envía un mensaje a un canal específico</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={selectedDestination} onValueChange={setSelectedDestination}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Chat por defecto</SelectItem>
                {telegramChats.map((chat) => (
                  <SelectItem key={chat.id} value={chat.id.toString()}>
                    {chat.name} ({chat.chatId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Textarea placeholder="Mensaje de prueba..." className="bg-background/50 min-h-[60px] flex-1 text-xs"
                value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} />
              <Button className="self-end" size="sm"
                onClick={() => sendCustomMessage.mutate()}
                disabled={!customMessage.trim() || sendCustomMessage.isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alertas Globales (toggles maestros) */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Zap className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Alertas Globales</CardTitle>
              <CardDescription className="text-xs">Toggles maestros por categoría, independiente del canal</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
              <div className="space-y-0.5">
                <Label className="text-xs">Errores de Nonce</Label>
                <p className="text-[10px] text-muted-foreground">Errores persistentes de nonce con Kraken</p>
              </div>
              <Switch checked={botConfig?.nonceErrorAlertsEnabled ?? true}
                onCheckedChange={(v) => updateBotConfig.mutate({ nonceErrorAlertsEnabled: v })} />
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
              <div className="space-y-0.5">
                <Label className="text-xs">Rechazo de Señales</Label>
                <p className="text-[10px] text-muted-foreground">Filtros MTF / Anti-Cresta bloquean compra</p>
              </div>
              <Switch checked={botConfig?.signalRejectionAlertsEnabled ?? true}
                onCheckedChange={(v) => updateBotConfig.mutate({ signalRejectionAlertsEnabled: v })} />
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
              <div className="space-y-0.5">
                <Label className="text-xs">Snapshot de Compra</Label>
                <p className="text-[10px] text-muted-foreground">Snapshot técnico al ejecutar una compra</p>
              </div>
              <Switch checked={botConfig?.buySnapshotAlertsEnabled ?? true}
                onCheckedChange={(v) => updateBotConfig.mutate({ buySnapshotAlertsEnabled: v })} />
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
              <div className="space-y-0.5">
                <Label className="text-xs">Alerta de Spread</Label>
                <p className="text-[10px] text-muted-foreground">Alerta cuando el spread rechaza una operación</p>
              </div>
              <Switch checked={botConfig?.spreadTelegramAlertEnabled ?? true}
                onCheckedChange={(v) => updateBotConfig.mutate({ spreadTelegramAlertEnabled: v })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Destino de alertas especiales */}
      <Card className="border-red-500/20 bg-red-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <Shield className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Destino de Alertas Especiales</CardTitle>
              <CardDescription className="text-xs">Dirige alertas críticas y de rechazo a canales específicos</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Errores Críticos</Label>
              <Select value={botConfig?.errorAlertChatId ?? "all"}
                onValueChange={(v) => updateBotConfig.mutate({ errorAlertChatId: v === "all" ? null : v })}>
                <SelectTrigger className="bg-background/50 h-9 text-xs"><SelectValue placeholder="Seleccionar destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Todos los chats activos</span></SelectItem>
                  {telegramChats.filter(c => c.isActive).map(chat => (
                    <SelectItem key={chat.id} value={chat.chatId}>{chat.name} <span className="text-muted-foreground font-mono text-xs">({chat.chatId})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">PRICE_INVALID, API_ERROR, DATABASE_ERROR, TRADING_ERROR, SYSTEM_ERROR</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Rechazo de Señales</Label>
              <Select value={botConfig?.signalRejectionAlertChatId ?? "all"}
                onValueChange={(v) => updateBotConfig.mutate({ signalRejectionAlertChatId: v === "all" ? null : v })}>
                <SelectTrigger className="bg-background/50 h-9 text-xs"><SelectValue placeholder="Seleccionar destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Todos los chats activos</span></SelectItem>
                  {telegramChats.filter(c => c.isActive).map(chat => (
                    <SelectItem key={chat.id} value={chat.chatId}>{chat.name} <span className="text-muted-foreground font-mono text-xs">({chat.chatId})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Filtros MTF estricto y Anti-Cresta</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cooldowns */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Clock className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Cooldowns</CardTitle>
              <CardDescription className="text-xs">Tiempo mínimo entre notificaciones del mismo tipo</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { key: 'notifCooldownStopUpdated', label: 'Stop Actualiz.', icon: <RefreshCw className="h-3.5 w-3.5 text-orange-400" />, max: 3600, def: 60 },
              { key: 'notifCooldownRegimeChange', label: 'Cambio Régimen', icon: <TrendingUp className="h-3.5 w-3.5 text-purple-400" />, max: 3600, def: 300 },
              { key: 'notifCooldownHeartbeat', label: 'Heartbeat', icon: <Heart className="h-3.5 w-3.5 text-red-400" />, max: 86400, def: 3600 },
              { key: 'notifCooldownTrades', label: 'Trades', icon: <BarChart3 className="h-3.5 w-3.5 text-green-400" />, max: 3600, def: 0 },
              { key: 'notifCooldownErrors', label: 'Errores', icon: <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />, max: 3600, def: 60 },
            ].map(({ key, label, icon, max, def }) => (
              <div key={key} className="p-3 border border-border rounded-lg bg-card/30 space-y-2">
                <div className="flex items-center gap-1.5">{icon}<Label className="text-xs">{label}</Label></div>
                <div className="flex items-center gap-1">
                  <Input type="number" min="0" max={max}
                    defaultValue={(botConfig as any)?.[key] ?? def}
                    key={`${key}-${(botConfig as any)?.[key]}`}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0) updateBotConfig.mutate({ [key]: val } as any);
                    }}
                    className="font-mono w-full h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground shrink-0">s</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{formatCooldown((botConfig as any)?.[key] ?? def)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Silent Mode + Severity */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Modo Silencioso y Severidad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Modo silencioso</Label>
              <p className="text-xs text-muted-foreground">Solo alertas CRITICAL pasan</p>
            </div>
            <Switch
              checked={config?.telegramSilentMode ?? false}
              onCheckedChange={(v) => updateConfig.mutate({ telegramSilentMode: v })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Severidad mínima</Label>
            <Select
              value={config?.telegramMinSeverity ?? "LOW"}
              onValueChange={(v) => updateConfig.mutate({ telegramMinSeverity: v })}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">LOW — Todas</SelectItem>
                <SelectItem value="MEDIUM">MEDIUM — Media y superior</SelectItem>
                <SelectItem value="HIGH">HIGH — Alta y superior</SelectItem>
                <SelectItem value="CRITICAL">CRITICAL — Solo críticas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Dedupe + Rate Limit */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Deduplicación y Rate Limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Dedupe minutos (global)</Label>
              <Input type="number" min={1} max={60}
                value={config?.telegramDefaultDedupeMinutes ?? 5}
                onChange={(e) => updateConfig.mutate({ telegramDefaultDedupeMinutes: parseInt(e.target.value) || 5 })}
                className="font-mono bg-background/50 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Rate limit / hora (global)</Label>
              <Input type="number" min={1} max={200}
                value={config?.telegramDefaultRateLimitPerHour ?? 30}
                onChange={(e) => updateConfig.mutate({ telegramDefaultRateLimitPerHour: parseInt(e.target.value) || 30 })}
                className="font-mono bg-background/50 text-xs" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Horas Silenciosas</CardTitle>
            <Switch
              checked={config?.telegramQuietHoursConfig?.enabled ?? false}
              onCheckedChange={(v) => updateConfig.mutate({
                telegramQuietHoursConfig: { ...config?.telegramQuietHoursConfig, enabled: v }
              })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Inicio</Label>
              <Input type="time" value={config?.telegramQuietHoursConfig?.start ?? "22:00"}
                onChange={(e) => updateConfig.mutate({
                  telegramQuietHoursConfig: { ...config?.telegramQuietHoursConfig, start: e.target.value }
                })}
                className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fin</Label>
              <Input type="time" value={config?.telegramQuietHoursConfig?.end ?? "08:00"}
                onChange={(e) => updateConfig.mutate({
                  telegramQuietHoursConfig: { ...config?.telegramQuietHoursConfig, end: e.target.value }
                })}
                className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Zona</Label>
              <Input value={config?.telegramQuietHoursConfig?.timezone ?? "Europe/Madrid"}
                onChange={(e) => updateConfig.mutate({
                  telegramQuietHoursConfig: { ...config?.telegramQuietHoursConfig, timezone: e.target.value }
                })}
                className="text-xs" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment label */}
      <Card className="border-border/50">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Etiqueta de entorno</Label>
              <p className="text-xs text-muted-foreground">Prefijo en mensajes (ej: staging, production)</p>
            </div>
            <Input value={config?.telegramEnvironmentLabel ?? "staging"}
              onChange={(e) => updateConfig.mutate({ telegramEnvironmentLabel: e.target.value })}
              className="w-40 text-xs font-mono" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
