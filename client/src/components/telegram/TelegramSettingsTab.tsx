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
import { Power, Send, Check, Eye, EyeOff, AlertTriangle } from "lucide-react";
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

export default function TelegramSettingsTab() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);

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
