/**
 * TelegramAiTab — IA / Shadow Mode / Autoafinación alert config
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export default function TelegramAiTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/20 rounded-lg">
              <Sparkles className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-sm">IA / Shadow Mode / Autoafinación</CardTitle>
              <CardDescription className="text-xs">Alertas de decisiones IA y autoafinación</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• <strong>Shadow Mode</strong>: Decisiones IA en modo observación (sin ejecución real)</p>
            <p>• <strong>Autoafinación</strong>: Ajustes automáticos de parámetros</p>
            <p>• Las alertas se envían a canales activos con <code>alertSystem=true</code></p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
            <p>• Severidad mínima configurable desde Ajustes globales</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
