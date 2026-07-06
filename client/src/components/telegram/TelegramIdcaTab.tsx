/**
 * TelegramIdcaTab — IDCA alert config (redirects to centralized config)
 * Shows current IDCA telegram settings with link to full config on IDCA page.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CircleDollarSign, ArrowRight, Check, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function TelegramIdcaTab() {
  const { data: config } = useQuery({
    queryKey: ["idcaConfig"],
    queryFn: async () => {
      const res = await fetch("/api/idca/config");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const isConnected = config?.telegramEnabled && !!config?.telegramChatId;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <CircleDollarSign className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <CardTitle className="text-sm">IDCA — Alertas Telegram</CardTitle>
                <CardDescription className="text-xs">DCA Inteligente</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className={isConnected ? "text-green-400 border-green-500/40" : "text-red-400 border-red-500/40"}>
              {isConnected ? "✓ Conectado" : "✗ Desconectado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between p-2 rounded border border-border/30">
              <span>Telegram habilitado</span>
              {config?.telegramEnabled ? <Check className="h-4 w-4 text-green-400" /> : <X className="h-4 w-4 text-red-400" />}
            </div>
            <div className="flex items-center justify-between p-2 rounded border border-border/30">
              <span>Chat ID</span>
              <span className="font-mono text-[10px]">{config?.telegramChatId || "—"}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded border border-border/30">
              <span>Cooldown</span>
              <span className="font-mono text-[10px]">{config?.telegramCooldownSeconds || 0}s</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded border border-border/30">
              <span>Alertas simulación</span>
              {config?.simulationTelegramEnabled ? <Check className="h-4 w-4 text-green-400" /> : <X className="h-4 w-4 text-red-400" />}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs">
            <p className="text-blue-400 font-medium">Validación centralizada activa:</p>
            <p className="text-muted-foreground mt-1">El chat ID debe estar activo en <code>telegram_chats</code> para recibir alertas. Si el canal está inactivo o eliminado, no se envía.</p>
          </div>
          <Link href="/dca">
            <Button variant="outline" size="sm" className="w-full">
              Configurar toggles detallados en IDCA <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
