/**
 * SpotAiForwardTwinPanel — UI panel for IA SPOT FORWARD TWIN.
 *
 * Shows collection status, progress, model states.
 * Advisory-only — no trading controls.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, Database, Eye, ShieldCheck, Activity } from "lucide-react";

interface SpotAiStatus {
  status: string;
  featureSchemaVersion: number;
  totalSnapshots: number;
  labeledTrades: number;
  minTradesToTrain: number;
  preferredTradesToTrain: number;
  entryModelVersion: string | null;
  givebackModelVersion: string | null;
  entryModelStatus: string | null;
  givebackModelStatus: string | null;
  autoRetrain: boolean;
  aiTradingControl: string;
  legacyDataMixed: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  COLLECTING: "RECOPILANDO",
  READY_TO_TRAIN: "LISTO PARA ENTRENAR",
  TRAINING: "ENTRENANDO",
  VALIDATING: "VALIDANDO",
  ADVISORY: "ADVISORY ACTIVO",
  DISABLED: "DESACTIVADO",
};

const STATUS_COLORS: Record<string, string> = {
  COLLECTING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  READY_TO_TRAIN: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  TRAINING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  VALIDATING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ADVISORY: "bg-green-500/20 text-green-400 border-green-500/30",
  DISABLED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export function SpotAiForwardTwinPanel() {
  const { data: status, isLoading } = useQuery<SpotAiStatus>({
    queryKey: ["/api/spot/ai/status"],
    queryFn: async () => {
      const res = await fetch("/api/spot/ai/status");
      if (!res.ok) throw new Error("Failed to fetch AI status");
      return res.json();
    },
    refetchInterval: 15000,
  });

  if (isLoading || !status) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando estado IA Forward Twin...
        </CardContent>
      </Card>
    );
  }

  const progressPct = Math.min(
    100,
    (status.labeledTrades / status.minTradesToTrain) * 100,
  );
  const preferredPct = Math.min(
    100,
    (status.labeledTrades / status.preferredTradesToTrain) * 100,
  );

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5" />
            IA SPOT Forward Twin
          </CardTitle>
          <Badge className={STATUS_COLORS[status.status] ?? STATUS_COLORS["COLLECTING"]}>
            {STATUS_LABELS[status.status] ?? status.status}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Database className="h-3 w-3" />
                Snapshots capturados
              </div>
              <div className="text-2xl font-bold">{status.totalSnapshots}</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                Trades etiquetados
              </div>
              <div className="text-2xl font-bold">{status.labeledTrades}</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="h-3 w-3" />
                Modo
              </div>
              <div className="text-sm font-semibold">Solo observación</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />
                Control de trading
              </div>
              <div className="text-sm font-semibold text-green-400">NINGUNO</div>
            </div>
          </div>

          {/* Progress bars */}
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progreso mínimo</span>
                <span>{status.labeledTrades} / {status.minTradesToTrain}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progreso preferido</span>
                <span>{status.labeledTrades} / {status.preferredTradesToTrain}</span>
              </div>
              <Progress value={preferredPct} className="h-2" />
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Feature Schema v{status.featureSchemaVersion} · Auto-retrain: {status.autoRetrain ? "Sí" : "No"} ·
            Dataset mixto legacy: {status.legacyDataMixed ? "Sí" : "No"}
          </div>
        </CardContent>
      </Card>

      {/* Model Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Entry Model</CardTitle>
          </CardHeader>
          <CardContent>
            {status.entryModelVersion ? (
              <div className="space-y-1">
                <Badge variant="outline">{status.entryModelStatus}</Badge>
                <div className="text-xs text-muted-foreground">v{status.entryModelVersion}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No entrenado</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Giveback Model</CardTitle>
          </CardHeader>
          <CardContent>
            {status.givebackModelVersion ? (
              <div className="space-y-1">
                <Badge variant="outline">{status.givebackModelStatus}</Badge>
                <div className="text-xs text-muted-foreground">v{status.givebackModelVersion}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No entrenado</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
