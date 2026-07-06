/**
 * TelegramSpotTab — SPOT / Trading activo alert config
 * Links to Notifications page for detailed cooldown config.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowRight } from "lucide-react";

export default function TelegramSpotTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <CardTitle className="text-sm">SPOT / Trading Activo</CardTitle>
              <CardDescription className="text-xs">Alertas de compras, ventas, cambios de régimen y heartbeat</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p className="font-medium text-muted-foreground">Configuración centralizada:</p>
            <p>• Las alertas de SPOT se envían a canales activos con <code>alertTrades=true</code></p>
            <p>• Los cooldowns se configuran desde la página de Notificaciones</p>
            <p>• El kill switch global bloquea todo si está OFF</p>
            <p>• La deduplicación evita alertas repetidas</p>
          </div>
          <Link href="/notifications">
            <Button variant="outline" size="sm" className="w-full">
              Configurar cooldowns y preferencias <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
