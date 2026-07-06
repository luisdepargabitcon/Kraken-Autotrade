/**
 * TelegramSystemTab — System / critical errors alert config
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, Shield } from "lucide-react";

export default function TelegramSystemTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Sistema / Errores Críticos</CardTitle>
              <CardDescription className="text-xs">Alertas de errores del sistema, API y base de datos</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• <strong>Tipos de error</strong>: PRICE_INVALID, API_ERROR, DATABASE_ERROR, TRADING_ERROR, SYSTEM_ERROR</p>
            <p>• <strong>HTML escapado</strong>: ErrorAlertService escapa HTML en mensaje, contexto, código y stack trace</p>
            <p>• <strong>Sin fallback de instancia</strong>: ErrorAlertService usa el TelegramService inyectado, no crea uno propio</p>
            <p>• <strong>Deduplicación</strong>: DATABASE_ERROR repetido se deduplica automáticamente</p>
            <p>• <strong>Severidad</strong>: Los errores CRITICAL pasan incluso en modo silencioso</p>
            <p>• Respeta kill switch global (excepto CRITICAL con silent mode off)</p>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg border border-green-500/20 bg-green-500/5 text-xs">
            <Shield className="h-4 w-4 text-green-400 shrink-0" />
            <span className="text-green-400">ErrorAlertService corregido: HTML escapado, sin instancia fallback, sin 409 conflicts</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
