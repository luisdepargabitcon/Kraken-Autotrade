/**
 * TelegramFiscoTab — FISCO alert config (channel selector + toggles)
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { FileText, ArrowRight } from "lucide-react";

export default function TelegramFiscoTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <FileText className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Fiscalidad — Alertas Telegram</CardTitle>
              <CardDescription className="text-xs">Sincronización, informes y errores fiscales</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• <strong>Sincronización diaria</strong>: Alerta cuando el cron diario sincroniza</p>
            <p>• <strong>Sincronización manual</strong>: Alerta al sincronizar desde UI o Telegram</p>
            <p>• <strong>Informe fiscal generado</strong>: Alerta cuando se genera un informe</p>
            <p>• <strong>Errores de sincronización</strong>: Alerta cuando falla la sync</p>
            <p>• Dual-path eliminado: solo envía via <code>sendAlertWithSubtype</code></p>
            <p>• El chat ID debe estar activo en <code>telegram_chats</code></p>
          </div>
          <Link href="/fiscal">
            <Button variant="outline" size="sm" className="w-full">
              Configurar alertas fiscales <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
