import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { BarChart3, GitCompare, TrendingUp, TrendingDown } from "lucide-react";
import type { ValidationData, GivebackData } from "../spotAiTypes";

export function ValidacionTab() {
  const { data: validation } = useQuery<ValidationData>({
    queryKey: ["/api/spot/ai/validation"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/validation"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });
  const { data: giveback } = useQuery<GivebackData>({
    queryKey: ["/api/spot/ai/giveback"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/giveback"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-3">
      {/* Baseline vs Candidate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-blue-400" />
            Comparación Baseline vs Candidato
          </CardTitle>
        </CardHeader>
        <CardContent>
          {validation ? (
            validation.available ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Baseline */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-blue-500/40 text-blue-400">BASELINE</Badge>
                    <span className="text-sm font-semibold">{validation.baseline?.name ?? "—"}</span>
                  </div>
                  {validation.baseline ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Stat label="Trades" value={validation.baseline.trades} />
                      <Stat label="Wins" value={validation.baseline.wins} color="text-green-400" />
                      <Stat label="Losses" value={validation.baseline.losses} color="text-red-400" />
                      <Stat label="PnL" value={`$${validation.baseline.pnl.toFixed(2)}`} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin baseline evaluado.</p>
                  )}
                </div>
                {/* Candidate */}
                <div className={`p-3 rounded-lg border space-y-2 ${validation.candidate ? "bg-green-500/10 border-green-500/20" : "bg-white/[0.02] border-white/[0.08]"}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={validation.candidate ? "border-green-500/40 text-green-400" : "border-gray-500/40 text-gray-400"}>
                      CANDIDATE
                    </Badge>
                    <span className="text-sm font-semibold">{validation.candidate?.name ?? "Sin candidato"}</span>
                  </div>
                  {validation.candidate ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Stat label="Trades" value={validation.candidate.trades} />
                      <Stat label="Wins" value={validation.candidate.wins} color="text-green-400" />
                      <Stat label="Losses" value={validation.candidate.losses} color="text-red-400" />
                      <Stat label="PnL" value={`$${validation.candidate.pnl.toFixed(2)}`} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin modelo candidato para comparar.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground">
                <p className="text-sm">Validación no disponible</p>
                <p className="text-xs">{validation.reason === "NO_CANDIDATE" ? "No hay modelo candidato." : "Evaluación no realizada."}</p>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Cargando validación...</p>
          )}
        </CardContent>
      </Card>

      {/* Confusion matrix */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-400" />
            Matriz de Confusión
          </CardTitle>
        </CardHeader>
        <CardContent>
          {validation?.confusionMatrix ? (
            <div className="grid grid-cols-2 gap-2 max-w-xs">
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                <div className="text-xs text-muted-foreground">TP</div>
                <div className="text-xl font-bold text-green-400">{validation.confusionMatrix.tp}</div>
              </div>
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                <div className="text-xs text-muted-foreground">FP</div>
                <div className="text-xl font-bold text-red-400">{validation.confusionMatrix.fp}</div>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                <div className="text-xs text-muted-foreground">TN</div>
                <div className="text-xl font-bold text-green-400">{validation.confusionMatrix.tn}</div>
              </div>
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                <div className="text-xs text-muted-foreground">FN</div>
                <div className="text-xl font-bold text-red-400">{validation.confusionMatrix.fn}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin matriz de confusión — requiere modelo entrenado y evaluación offline.</p>
          )}
        </CardContent>
      </Card>

      {/* Key metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-400" />
            Métricas Clave
          </CardTitle>
        </CardHeader>
        <CardContent>
          {validation ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Stat label="Trades evaluados" value={validation.evaluatedTrades} />
              <Stat label="Winner rejection rate" value={validation.winnerRejectionRate !== null ? `${(validation.winnerRejectionRate * 100).toFixed(1)}%` : "—"} />
              <Stat label="Loser avoidance rate" value={validation.loserAvoidanceRate !== null ? `${(validation.loserAvoidanceRate * 100).toFixed(1)}%` : "—"} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando...</p>
          )}
        </CardContent>
      </Card>

      {/* Giveback intelligence */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-amber-400" />
            Inteligencia de Giveback
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {giveback ? (
            giveback.available ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Trades con MFE positivo" value={giveback.tradesWithPositiveMfe ?? "—"} />
                  <Stat label="MFE ≥ 0.5R" value={giveback.mfeGte0_5R ?? "—"} />
                  <Stat label="MFE ≥ 1R" value={giveback.mfeGte1R ?? "—"} />
                  <Stat label="MFE ≥ 2R" value={giveback.mfeGte2R ?? "—"} />
                  <Stat label="Profit → Loss" value={giveback.profitToLoss ?? "—"} />
                  <Stat label="Giveback total USD" value={giveback.givebackTotalUsd !== null ? `$${giveback.givebackTotalUsd.toFixed(2)}` : "—"} />
                  <Stat label="MFE total" value={giveback.mfeTotal !== null ? `$${giveback.mfeTotal.toFixed(2)}` : "—"} />
                  <Stat label="PnL capturado" value={giveback.pnlCaptured !== null ? `$${giveback.pnlCaptured.toFixed(2)}` : "—"} />
                </div>
                {giveback.captureEfficiency !== null && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Eficiencia de captura</span>
                      <span className="text-lg font-bold text-amber-400">{(giveback.captureEfficiency * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Proporción del MFE total que se convirtió en PnL realizado.
                    </div>
                  </div>
                )}
                {giveback.highGivebackCases.length > 0 && (
                  <div className="overflow-x-auto">
                    <p className="text-xs text-muted-foreground mb-2">Casos de giveback alto:</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Par</TableHead>
                          <TableHead className="text-xs">LotId</TableHead>
                          <TableHead className="text-xs text-right">MFE (R)</TableHead>
                          <TableHead className="text-xs text-right">Giveback %</TableHead>
                          <TableHead className="text-xs text-right">Final (R)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {giveback.highGivebackCases.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs font-mono">{c.pair}</TableCell>
                            <TableCell className="text-xs font-mono">{c.lotId}</TableCell>
                            <TableCell className="text-xs text-right text-green-400">{c.mfeR.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right text-amber-400">{(c.givebackPct * 100).toFixed(1)}%</TableCell>
                            <TableCell className="text-xs text-right">{c.finalR.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground">
                <p className="text-sm">Analytics de giveback no disponible</p>
                <p className="text-xs">{giveback.reason === "NO_COMPLETED_FORWARD_TRADES" ? "No hay trades completos en Forward Twin." : "Datos insuficientes."}</p>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Cargando giveback...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="p-2 rounded bg-white/5 border border-white/10">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold font-mono ${color ?? ""}`}>{value}</div>
    </div>
  );
}
