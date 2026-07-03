import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Activity, TrendingUp, TrendingDown, Wallet, Zap, Shield, BarChart3, Layers, Radio, Cpu, CheckCircle2, XCircle } from "lucide-react";
import { GridActivityLive } from "./GridActivityLive";

interface GridSummaryPanelProps {
  config: any;
  status: any;
  auditData: any;
  levels: any[];
  cycles: any[];
  unlockCheck: any;
  modeColor: (mode: string) => string;
  onModeChange: (mode: string) => void;
  onAcknowledge: () => void;
  onReconcile: () => void;
  modeMutationPending: boolean;
  acknowledgePending: boolean;
  reconcilePending: boolean;
  onGoToTab: (tab: string) => void;
}

export function GridSummaryPanel({
  config, status, auditData, levels, cycles, unlockCheck,
  modeColor, onModeChange, onAcknowledge, onReconcile,
  modeMutationPending, acknowledgePending, reconcilePending,
  onGoToTab,
}: GridSummaryPanelProps) {
  const mode = config?.mode || "OFF";
  const range = auditData?.range;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const hasActiveRange = range && range.status !== "sin_rango_activo";
  const hasLimits = hasActiveRange && range.lowerPrice != null && range.upperPrice != null;
  const wallet = auditData?.wallet;
  const safety = auditData?.safety;
  const decisions: any[] = auditData?.decisions || [];

  const rangeModeText = mode === "OFF"
    ? "Último rango activo generado en SHADOW. Actualmente el Grid está en OFF, por lo que no está usando el rango para operar."
    : mode === "SHADOW"
    ? "Rango activo en SHADOW. El sistema simula niveles sin enviar órdenes reales."
    : "Rango activo en modo real.";

  const marketRegime = range?.method || range?.regime || "—";
  const pumpDumpState = status?.pumpDumpState || "normal";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Main content — 8 cols */}
      <div className="lg:col-span-8 space-y-4">

        {/* 4.1 Estado del mercado y rango activo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Estado del mercado y rango activo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Par</p>
                <p className="text-sm font-mono font-bold">{config?.pair || "BTC/USD"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Régimen de mercado</p>
                <p className="text-sm font-bold">{marketRegime}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Pump/Dump</p>
                <Badge variant={pumpDumpState === "normal" ? "default" : "destructive"}>
                  {pumpDumpState === "normal" ? "Normal" : pumpDumpState.toUpperCase()}
                </Badge>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Modo actual</p>
                <Badge variant={modeColor(mode) as any}>{mode}</Badge>
              </div>
            </div>

            {hasActiveRange ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio inferior</p>
                    <p className="text-sm font-bold text-red-500">
                      {range.lowerPrice != null ? `$${Number(range.lowerPrice).toFixed(2)}` : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio central</p>
                    <p className="text-sm font-bold">
                      {range.centerPrice != null ? `$${Number(range.centerPrice).toFixed(2)}` : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio superior</p>
                    <p className="text-sm font-bold text-green-500">
                      {range.upperPrice != null ? `$${Number(range.upperPrice).toFixed(2)}` : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Anchura</p>
                    <p className="text-sm font-bold">{range.widthPct != null ? `${Number(range.widthPct).toFixed(2)}%` : "—"}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Niveles generados</p>
                    <p className="text-sm font-bold">{range.levelsGenerated ?? "—"}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Estado de la banda</p>
                    <Badge variant={range.status === "activo" || range.status === "active" ? "default" : "secondary"}>
                      {range.status}
                    </Badge>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Creado</p>
                    <p className="text-sm">{range.createdAt ? new Date(range.createdAt).toLocaleString("es-ES") : "—"}</p>
                  </div>
                </div>

                {!hasLimits && (
                  <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 p-3 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                    <span>Rango activo detectado, pero faltan límites inferior/superior en la metadata.</span>
                  </div>
                )}

                <div className="rounded-lg bg-blue-500/10 p-3 text-sm">
                  <p className="text-blue-700 dark:text-blue-300">
                    <strong>{rangeModeText}</strong>
                  </p>
                  {range.naturalReason && (
                    <p className="text-blue-700 dark:text-blue-300 mt-1">
                      {range.naturalReason}
                    </p>
                  )}
                  {range.impact && (
                    <p className="text-blue-700 dark:text-blue-300 mt-1">
                      <strong>Impacto:</strong> {range.impact}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
                No hay rango activo todavía. El Grid está en {mode} y espera una evaluación válida del mercado para generar bandas.
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4.2 Bandas/Rangos activos — tabla compacta */}
        {hasActiveRange && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Bandas / Rangos activos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 px-2">Par</th>
                      <th className="text-left py-2 px-2">Inferior</th>
                      <th className="text-left py-2 px-2">Central</th>
                      <th className="text-left py-2 px-2">Superior</th>
                      <th className="text-left py-2 px-2">Anchura</th>
                      <th className="text-left py-2 px-2">Niveles</th>
                      <th className="text-left py-2 px-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-mono">{range.pair}</td>
                      <td className="py-2 px-2 text-red-500">{range.lowerPrice != null ? `$${Number(range.lowerPrice).toFixed(2)}` : "—"}</td>
                      <td className="py-2 px-2">{range.centerPrice != null ? `$${Number(range.centerPrice).toFixed(2)}` : "—"}</td>
                      <td className="py-2 px-2 text-green-500">{range.upperPrice != null ? `$${Number(range.upperPrice).toFixed(2)}` : "—"}</td>
                      <td className="py-2 px-2">{range.widthPct != null ? `${Number(range.widthPct).toFixed(2)}%` : "—"}</td>
                      <td className="py-2 px-2">{range.levelsGenerated ?? "—"}</td>
                      <td className="py-2 px-2"><Badge variant="default">{range.status}</Badge></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => onGoToTab("bandas")}>
                  Ver historial completo
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4.3 Histórico de cambios de banda */}
        {rangeHistory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Histórico de cambios de banda
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {rangeHistory.slice(0, 6).map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border p-2 text-sm">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{ev.eventType}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-ES") : ""}
                        </span>
                      </div>
                      <p className="text-sm">{ev.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4.4 Actividad en tiempo real */}
        <GridActivityLive />

        {/* 4.5 Niveles activos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Niveles activos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {levels && levels.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 px-2">Nivel</th>
                      <th className="text-left py-2 px-2">Estado</th>
                      <th className="text-left py-2 px-2">Precio</th>
                      <th className="text-left py-2 px-2">Capital</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.slice(0, 8).map((level: any) => (
                      <tr key={level.id} className="border-b">
                        <td className="py-2 px-2">
                          <Badge variant={level.side === "BUY" ? "default" : "outline"}>{level.side}</Badge>
                        </td>
                        <td className="py-2 px-2"><Badge variant="secondary">{level.status}</Badge></td>
                        <td className="py-2 px-2 font-mono">${level.price?.toFixed(2)}</td>
                        <td className="py-2 px-2">${level.notionalUsd?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {levels.length > 8 && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => onGoToTab("niveles")}>
                    Ver todos los {levels.length} niveles
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No hay niveles activos. El Grid está en {mode} o todavía no ha generado niveles operativos.
                {hasActiveRange && " El último rango activo se conserva para auditoría."}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4.6 Ciclos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Ciclos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cycles && cycles.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">Ciclos activos</p>
                    <p className="text-lg font-bold">{cycles.filter((c: any) => c.status === "open" || c.status === "active").length}</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">Completados</p>
                    <p className="text-lg font-bold text-green-500">{cycles.filter((c: any) => c.status === "completed").length}</p>
                  </div>
                </div>
                {cycles.slice(0, 5).map((cycle: any) => (
                  <div key={cycle.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">#{cycle.cycleNumber}</span>
                      <Badge variant={cycle.status === "completed" ? "default" : "outline"}>{cycle.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-mono">${cycle.buyPrice?.toFixed(2)} → ${cycle.sellPrice?.toFixed(2) || "—"}</span>
                      {cycle.netPnlUsd !== 0 && (
                        <span className={cycle.netPnlUsd > 0 ? "text-green-500" : "text-red-500"}>
                          {cycle.netPnlUsd > 0 ? "+" : ""}${cycle.netPnlUsd?.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {cycles.length > 5 && (
                  <Button variant="outline" size="sm" onClick={() => onGoToTab("ciclos")}>
                    Ver todos los ciclos
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No hay ciclos abiertos. El Grid todavía no ha reservado capital en ningún ciclo.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar — 4 cols */}
      <div className="lg:col-span-4 space-y-4">

        {/* 5.1 Cartera Grid compacta */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Cartera Grid
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-sm font-bold">${wallet?.totalUsd?.toFixed(2) ?? "1.000,00"}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">Reservado</p>
                <p className="text-sm font-bold">${wallet?.reservedUsd?.toFixed(2) ?? "0,00"}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">Libre</p>
                <p className="text-sm font-bold text-green-500">${wallet?.freeUsd?.toFixed(2) ?? "1.000,00"}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">Máximo</p>
                <p className="text-sm font-bold">${wallet?.maxUsd?.toFixed(2) ?? "5.000,00"}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Modo:</span>
              <Badge variant="outline">{wallet?.mode || "automatic"}</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Reinvertir:</span>
              <Badge variant={config?.gridWalletCompoundProfits ? "default" : "secondary"}>
                {config?.gridWalletCompoundProfits ? "Sí" : "No"}
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => onGoToTab("cartera")}>
              Editar configuración de capital
            </Button>
          </CardContent>
        </Card>

        {/* 5.2 Política de ejecución */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4" />
              Política de ejecución
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-muted/30 p-3 text-sm">
              <p className="font-semibold">3 intentos maker + 4º taker controlado</p>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>3 intentos maker con post_only</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>4º intento allow_taker controlado</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>Fallback con slippage y fee-aware</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>Auditoría obligatoria de fallback</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>Requiere beneficio neto suficiente</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => onGoToTab("ejecucion")}>
              Ver configuración completa
            </Button>
          </CardContent>
        </Card>

        {/* 5.3 Estado del motor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Estado del motor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Modo actual</span>
                <Badge variant={modeColor(mode) as any}>{mode}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reconciliación</span>
                {safety?.reconciliationPassed ? (
                  <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> OK</span>
                ) : (
                  <span className="flex items-center gap-1 text-orange-500"><XCircle className="h-3 w-3" /> Pendiente</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Mode Lock</span>
                {safety?.modeLockAcknowledged ? (
                  <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Reconocido</span>
                ) : (
                  <span className="flex items-center gap-1 text-orange-500"><XCircle className="h-3 w-3" /> No reconocido</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Límite diario</span>
                {safety?.dailyOrderLimitRespected ? (
                  <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> OK</span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3 w-3" /> Excedido</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Circuit Breaker</span>
                {status?.circuitBreakerOpen ? (
                  <Badge variant="destructive" className="text-xs">Abierto</Badge>
                ) : (
                  <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Cerrado</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pump/Dump</span>
                <Badge variant={pumpDumpState === "normal" ? "default" : "destructive"} className="text-xs">
                  {pumpDumpState === "normal" ? "Normal" : pumpDumpState.toUpperCase()}
                </Badge>
              </div>
            </div>

            {/* Mode controls */}
            <div className="flex flex-wrap gap-1.5 pt-2 border-t">
              {["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"].map((m) => (
                <Button
                  key={m}
                  variant={mode === m ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => onModeChange(m)}
                  disabled={modeMutationPending}
                >
                  {m}
                </Button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-1.5">
              {!safety?.modeLockAcknowledged && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={onAcknowledge}
                  disabled={acknowledgePending}
                >
                  Reconocer Mode Lock
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={onReconcile}
                disabled={reconcilePending}
              >
                Ejecutar reconciliación
              </Button>
            </div>

            {/* Decisions summary */}
            {decisions.length > 0 && (
              <div className="pt-2 border-t space-y-1">
                <p className="text-xs font-semibold">Últimas decisiones:</p>
                {decisions.slice(0, 2).map((d, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium">{d.detected}:</span> {d.decided}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
