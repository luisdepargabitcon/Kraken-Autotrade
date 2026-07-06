/**
 * TelegramSmartExitTab — Smart Exit notification config
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Bell, ArrowRight } from "lucide-react";

export default function TelegramSmartExitTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Bell className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Smart Exit — Notificaciones</CardTitle>
              <CardDescription className="text-xs">Alertas de salida inteligente</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• <strong>Umbral alcanzado</strong>: Score supera el umbral configurado</p>
            <p>• <strong>Salida ejecutada</strong>: Smart Exit cierra posición</p>
            <p>• <strong>Cambio de régimen</strong>: Régimen de mercado cambia</p>
            <p>• <strong>Fee-band</strong>: No genera tormenta de alertas (deduplicada)</p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
          </div>
          <Link href="/trading">
            <Button variant="outline" size="sm" className="w-full">
              Configurar Smart Exit <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
