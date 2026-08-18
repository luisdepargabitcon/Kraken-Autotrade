import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Zap, Shield, Power, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

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

interface RealReadiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: {
    realActivationAllowed: boolean;
    exchangeInitialized: boolean;
    exchangeName: string | null;
    balanceReachable: boolean;
    feeModelValid: boolean;
    takerFeePct: number | null;
    makerFeePct: number | null;
    activePairsConfigured: boolean;
    activePairsCount: number;
    pairMetadataLoaded: boolean;
    pairMetadataLoadedCount: number;
    pairMetadataTotalCount: number;
    uncertainPositionsCount: number;
    pendingFillPositionsCount: number;
    exitPendingPositionsCount: number;
    legacyEntriesCount: number;
    shadowPositionsOpen: boolean;
    shadowPositionsCount: number;
    apiCredentialsConfigured: boolean;
    realAdapterImplemented: boolean;
    entryScannerCount: number;
    positionSupervisorCount: number;
  };
}

interface SpotStatusPanelProps {
  status: SpotStatus | null;
  onModeChange: (mode: "OFF" | "SHADOW" | "REAL") => Promise<boolean>;
}

export function SpotStatusPanel({ status, onModeChange }: SpotStatusPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorBlockers, setErrorBlockers] = useState<string[]>([]);
  const [showRealConfirm, setShowRealConfirm] = useState(false);
  const [readiness, setReadiness] = useState<RealReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  const mode = status?.executionMode ?? "OFF";
  const isOff = mode === "OFF";
  const isShadow = mode === "SHADOW";
  const isReal = mode === "REAL";

  async function fetchReadiness() {
    setReadinessLoading(true);
    try {
      const res = await fetch("/api/spot/real-readiness");
      if (res.ok) {
        const data = await res.json();
        setReadiness(data);
      }
    } catch {
      // ignore
    }
    setReadinessLoading(false);
  }

  useEffect(() => {
    if (showRealConfirm && !readiness) {
      fetchReadiness();
    }
  }, [showRealConfirm, readiness]);

  async function handleModeChange(target: "OFF" | "SHADOW" | "REAL") {
    if (pending) return;
    setPending(true);
    setError(null);
    setErrorBlockers([]);
    try {
      const ok = await onModeChange(target);
      if (!ok) {
        setError("No se pudo cambiar el modo. Verifique la conexión.");
      }
    } catch (err: any) {
      setError(err.message || "Network error");
      if (err?.blockers && Array.isArray(err.blockers)) {
        setErrorBlockers(err.blockers as string[]);
      }
    }
    setPending(false);
  }

  function handleRealClick() {
    setShowRealConfirm(true);
  }

  async function handleRealConfirm() {
    setShowRealConfirm(false);
    await handleModeChange("REAL");
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
                variant={isReal ? "destructive" : "outline"}
                size="sm"
                onClick={handleRealClick}
                disabled={pending || isReal || !status?.realActivationAllowed}
                className="flex items-center gap-1.5"
                title={status?.realActivationAllowed ? "Activar modo REAL" : "REAL no autorizado"}
              >
                <Shield className="h-3.5 w-3.5" />
                REAL
              </Button>
            </div>
            {isReal && (
              <p className="text-xs text-red-400 font-semibold">
                REAL activo — órdenes reales en ejecución
              </p>
            )}
            {error && (
              <div className="space-y-1">
                <p className="text-xs text-red-400">{error}</p>
                {errorBlockers.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-red-400 font-semibold">Bloqueantes persistidos:</p>
                    {errorBlockers.map((b, i) => (
                      <p key={i} className="text-[10px] text-red-400">• {b}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* REAL Confirmation Modal */}
            {showRealConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowRealConfirm(false)}>
                <div className="bg-card border border-border rounded-lg p-6 max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-red-400" />
                    <h3 className="text-base font-bold">Activar modo REAL</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Vas a activar ejecución con órdenes reales en el exchange. Esta acción enviará compras y ventas reales.
                  </p>
                  {readinessLoading && <p className="text-xs text-muted-foreground">Verificando preparación...</p>}
                  {readiness && (
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold">Verificaciones comprehensivas:</p>
                        <ReadinessCheck label="REAL autorizado" ok={readiness.checks.realActivationAllowed} />
                        <ReadinessCheck label={`Exchange: ${readiness.checks.exchangeName ?? "—"}`} ok={readiness.checks.exchangeInitialized} />
                        <ReadinessCheck label="Balance reachable" ok={readiness.checks.balanceReachable} />
                        <ReadinessCheck label="Fee model válido" ok={readiness.checks.feeModelValid} />
                        <ReadinessCheck label={`Pares activos (${readiness.checks.activePairsCount})`} ok={readiness.checks.activePairsConfigured} />
                        <ReadinessCheck label={`Metadata de pares (${readiness.checks.pairMetadataLoadedCount}/${readiness.checks.pairMetadataTotalCount})`} ok={readiness.checks.pairMetadataLoaded} />
                        <ReadinessCheck label="Sin posiciones UNCERTAIN" ok={readiness.checks.uncertainPositionsCount === 0} />
                        <ReadinessCheck label="Sin PENDING_FILL" ok={readiness.checks.pendingFillPositionsCount === 0} />
                        <ReadinessCheck label="Sin EXIT_PENDING" ok={readiness.checks.exitPendingPositionsCount === 0} />
                        <ReadinessCheck label="Sin entradas legacy" ok={readiness.checks.legacyEntriesCount === 0} />
                        <ReadinessCheck label="Credenciales API" ok={readiness.checks.apiCredentialsConfigured} />
                        <ReadinessCheck label="RealAdapter implementado" ok={readiness.checks.realAdapterImplemented} />
                      </div>
                      {readiness.blockers.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-red-400">Bloqueantes ({readiness.blockers.length}):</p>
                          {readiness.blockers.map((b, i) => (
                            <p key={i} className="text-xs text-red-400">• {b}</p>
                          ))}
                        </div>
                      )}
                      {readiness.warnings.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-yellow-400">Advertencias ({readiness.warnings.length}):</p>
                          {readiness.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-yellow-400">• {w}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowRealConfirm(false)}>
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleRealConfirm}
                      disabled={pending || !readiness?.ready}
                    >
                      Confirmar REAL
                    </Button>
                  </div>
                </div>
              </div>
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

function ReadinessCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? (
        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400" />
      )}
      <span className={`text-xs ${ok ? "text-foreground" : "text-red-400"}`}>{label}</span>
    </div>
  );
}
