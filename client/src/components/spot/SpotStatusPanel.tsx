import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Zap, Shield, Power } from "lucide-react";

interface SpotStatus {
  executionMode: string;
  realActivationAllowed: boolean;
  feeModel: {
    exchange: string;
    makerFeePct: number;
    takerFeePct: number;
    quality: string;
  };
  activeIntents: number;
  trackedPositions: number;
  policyVersion: string;
}

interface SpotStatusPanelProps {
  status: SpotStatus | null;
  onModeChange: (mode: "OFF" | "SHADOW") => Promise<boolean>;
}

export function SpotStatusPanel({ status, onModeChange }: SpotStatusPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = status?.executionMode ?? "OFF";
  const isOff = mode === "OFF";
  const isShadow = mode === "SHADOW";
  const isReal = mode === "REAL";

  async function handleModeChange(target: "OFF" | "SHADOW") {
    if (pending) return;
    setPending(true);
    setError(null);
    const ok = await onModeChange(target);
    if (!ok) {
      setError("No se pudo cambiar el modo. Verifique la conexión.");
    }
    setPending(false);
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Estado del Motor SPOT
            </CardTitle>
            <Badge
              variant={isOff ? "secondary" : isShadow ? "default" : "destructive"}
              className="font-mono"
            >
              {mode}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode selector */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Modo de ejecución</p>
            <div className="flex gap-2">
              <Button
                variant={isOff ? "default" : "outline"}
                size="sm"
                onClick={() => handleModeChange("OFF")}
                disabled={pending || isOff}
                className="flex items-center gap-1.5"
              >
                <Power className="h-3.5 w-3.5" />
                OFF
              </Button>
              <Button
                variant={isShadow ? "default" : "outline"}
                size="sm"
                onClick={() => handleModeChange("SHADOW")}
                disabled={pending || isShadow}
                className="flex items-center gap-1.5"
              >
                <Zap className="h-3.5 w-3.5" />
                SHADOW
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="flex items-center gap-1.5 opacity-50"
                title="REAL no autorizado"
              >
                <Shield className="h-3.5 w-3.5" />
                REAL
              </Button>
            </div>
            {isReal && (
              <p className="text-xs text-red-400">
                REAL activo — no autorizado por configuración
              </p>
            )}
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Intents activos" value={status?.activeIntents ?? 0} />
            <StatBox label="Posiciones trackeadas" value={status?.trackedPositions ?? 0} />
            <StatBox
              label="Fee maker"
              value={`${(status?.feeModel?.makerFeePct ?? 0).toFixed(3)}%`}
            />
            <StatBox
              label="Fee taker"
              value={`${(status?.feeModel?.takerFeePct ?? 0).toFixed(3)}%`}
            />
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
            <span>
              Exchange: <span className="text-foreground">{status?.feeModel?.exchange ?? "—"}</span>
            </span>
            <span>
              Calidad fees: <span className="text-foreground">{status?.feeModel?.quality ?? "—"}</span>
            </span>
            <span>
              Policy: <span className="text-foreground">{status?.policyVersion ?? "—"}</span>
            </span>
            <span>
              REAL: <span className={status?.realActivationAllowed ? "text-red-400" : "text-emerald-400"}>
                {status?.realActivationAllowed ? "PERMITIDO" : "BLOQUEADO"}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono font-semibold mt-0.5">{value}</p>
    </div>
  );
}
