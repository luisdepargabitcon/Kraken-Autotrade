/**
 * TelegramIdcaHybridTab — IDCA Hybrid/Grid alert config
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Brain, ArrowRight, Check, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function TelegramIdcaHybridTab() {
  const { data: config } = useQuery({
    queryKey: ["idcaHybridConfig"],
    queryFn: async () => {
      const res = await fetch("/api/idca/config");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm">IDCA Hybrid / Grid</CardTitle>
              <CardDescription className="text-xs">Alertas de grid inteligente y hybrid guard</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-2">
            <p>• <strong>Grid Observer</strong>: se muestra como <span className="text-blue-400">"Grid simulado"</span>, nunca como "Grid ejecutado"</p>
            <p>• <strong>Hybrid Guard</strong>: alertas de watch creation, re-entry signals, order executions</p>
            <p>• Las alertas se envían a canales activos con <code>alertTrades=true</code></p>
            <p>• Validación centralizada: chat ID debe estar activo en <code>telegram_chats</code></p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
          </div>
          <Link href="/grid-isolated">
            <Button variant="outline" size="sm" className="w-full">
              Configurar Grid Isolated <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
