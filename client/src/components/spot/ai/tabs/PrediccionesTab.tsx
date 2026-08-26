import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, EyeOff } from "lucide-react";
import type { AdvisoryLog } from "../spotAiTypes";

export function PrediccionesTab() {
  const { data } = useQuery<{ predictions: AdvisoryLog[]; count: number }>({
    queryKey: ["/api/spot/ai/predictions"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/predictions"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 15000,
  });

  const predictions = data?.predictions ?? [];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4 text-green-400" />
            Predicciones Advisory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {predictions.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[10px]">{data?.count} predicciones</Badge>
                <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-400">Solo observación</Badge>
              </div>
              <div className="space-y-1">
                {predictions.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-white/5 border border-white/[0.06]">
                    <span className="text-muted-foreground w-16 flex-shrink-0">
                      {new Date(p.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="font-mono font-semibold w-20 flex-shrink-0 truncate">{p.pair}</span>
                    <span className="text-blue-300 flex-1 truncate">
                      {p.prob_1R !== undefined ? `P(1R)=${(p.prob_1R * 100).toFixed(0)}%` : "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{p.modelVersion}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <EyeOff className="h-10 w-10 opacity-30" />
              <p className="text-sm">Sin predicciones advisory</p>
              <p className="text-xs text-center">
                Las predicciones aparecerán cuando un modelo ACTIVE_ADVISORY esté disponible.<br />
                Mientras tanto, el sistema sigue recopilando datos para entrenamiento.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advisory explanation */}
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-white">¿Qué son las predicciones advisory?</p>
            <p>Son <strong className="text-white">recomendaciones calculadas</strong> por el modelo de IA a partir de los features del snapshot en tiempo real.</p>
            <p><strong className="text-white">No tienen efecto</strong> sobre las operaciones. El SpotEngine ignora completamente estas predicciones.</p>
            <p>Sirven para validar offline si el modelo añade valor antes de considerar cualquier integración futura.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
