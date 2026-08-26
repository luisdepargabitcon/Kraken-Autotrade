import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, ShieldCheck, Lock, Info, Activity } from "lucide-react";
import type { SpotAiStatus } from "../spotAiTypes";

export function ObservacionTab({ status }: { status: SpotAiStatus }) {
  return (
    <div className="space-y-3">
      {/* Advisory-only mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Eye className="h-4 w-4 text-purple-400" />
            Modo Observación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Eye className="h-3 w-3" /> Estado
              </div>
              <div className="text-sm font-bold text-purple-400">ACTIVO</div>
            </div>
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <ShieldCheck className="h-3 w-3" /> Control trading
              </div>
              <div className="text-sm font-bold text-green-400">NINGUNO</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Activity className="h-3 w-3" /> Snapshots
              </div>
              <div className="text-sm font-bold">{status.totalSnapshots}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Lock className="h-3 w-3" /> Auto-activación
              </div>
              <div className="text-sm font-bold text-red-400">BLOQUEADA</div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-2">
            <p className="text-xs font-semibold text-purple-300">Qué hace el modo observación</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Captura snapshots de cada ciclo Forward Twin (SCAN, SUPERVISOR, FILL)</li>
              <li>• Extrae features del snapshot en tiempo de predicción — sin lookahead</li>
              <li>• Calcula labels a partir del resultado real del trade tras cierre</li>
              <li>• Construye dataset de entrenamiento con split temporal y group split por lotId</li>
              <li>• <strong className="text-white">No interviene</strong> en decisiones de entrada, salida, sizing ni gestión</li>
            </ul>
          </div>

          <div className="p-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/30">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-amber-400">Restricciones permanentes</p>
                <p className="mt-1">La IA Forward Twin <strong className="text-white">no puede</strong>:</p>
                <ul className="mt-1 space-y-0.5">
                  <li>• Colocar órdenes reales o simuladas</li>
                  <li>• Bloquear o permitir entradas</li>
                  <li>• Forzar salidas o mover stops</li>
                  <li>• Cambiar sizing o capital asignado</li>
                  <li>• Modificar parámetros del SpotEngine</li>
                  <li>• Activarse automáticamente (auto-retrain = NO)</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data collection pipeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Pipeline de Recopilación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { step: "1", title: "Captura", desc: "SpotEngine → captureScan/captureSupervisor/captureFill → ring buffer in-memory" },
            { step: "2", title: "Flush", desc: "Timer periódico → batch INSERT a spot_forward_twin_snapshots (PostgreSQL)" },
            { step: "3", title: "Feature extraction", desc: "buildFeaturesFromSnapshot() — lectura pura del snapshot, sin lookahead" },
            { step: "4", title: "Label computation", desc: "buildEntryLabels/buildGivebackLabels — tras cierre del trade, nunca antes" },
            { step: "5", title: "Dataset assembly", desc: "buildDataset() — split temporal 60/20/20 + group split por lotId" },
            { step: "6", title: "Training (manual)", desc: "POST /api/spot/ai/train — bloqueado si < 100 trades etiquetados" },
          ].map((s) => (
            <div key={s.step} className="flex gap-3 items-start p-2 rounded-lg bg-white/5 border border-white/10">
              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <span className="text-[10px] font-bold font-mono text-primary">{s.step}</span>
              </div>
              <div>
                <div className="text-xs font-semibold">{s.title}</div>
                <div className="text-[11px] text-muted-foreground">{s.desc}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
