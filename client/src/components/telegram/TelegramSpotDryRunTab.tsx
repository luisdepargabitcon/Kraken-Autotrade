/**
 * TelegramSpotDryRunTab — SPOT Dry Run alert config
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FlaskConical } from "lucide-react";

export default function TelegramSpotDryRunTab() {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <FlaskConical className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-sm">SPOT Dry Run</CardTitle>
              <CardDescription className="text-xs">Alertas de simulación de trading</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• Las alertas de Dry Run se envían con el prefijo <code className="text-amber-400">[DRY-RUN]</code></p>
            <p>• Se envían a canales activos con <code>alertTrades=true</code></p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
            <p>• Los cooldowns son compartidos con SPOT real</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
