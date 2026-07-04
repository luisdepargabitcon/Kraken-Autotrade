import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GridMarketContextPanel } from "./GridMarketContextPanel";
import { GridWalletSummaryPanel } from "./GridWalletSummaryPanel";
import { GridLiveActivityPanel } from "./GridLiveActivityPanel";
import { GridLevelsPanel } from "./GridLevelsPanel";
import { GridCyclesPanel } from "./GridCyclesPanel";
import { GridRangeHistoryPanel } from "./GridRangeHistoryPanel";
import { Activity, Shield, Wallet, Zap, Layers, CheckCircle2, XCircle, AlertTriangle, Settings2, Cpu } from "lucide-react";

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
  onActivate: (active: boolean) => void;
  onShadowValidate: () => void;
  activatePending: boolean;
  shadowValidatePending: boolean;
}

export function GridSummaryPanel({
  config, status, auditData, levels, cycles, unlockCheck,
  modeColor, onModeChange, onAcknowledge, onReconcile,
  modeMutationPending, acknowledgePending, reconcilePending,
  onGoToTab, onActivate, onShadowValidate, activatePending, shadowValidatePending,
}: GridSummaryPanelProps) {
  const mode = config?.mode || "OFF";
  const isActive = config?.isActive ?? false;
  const isRunning = (status as any)?.isRunning ?? false;
  const lastTickAt = (status as any)?.lastTickAt ?? null;
  const lastTickReason = (status as any)?.lastTickReason ?? null;
  const functionalStatus = auditData?.functionalStatus;
  const range = auditData?.range;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const wallet = auditData?.wallet;
  const safety = auditData?.safety;
  const decisions: any[] = auditData?.decisions || [];
  const summary = auditData?.summary;

  return (
    <div className="space-y-4">
      {/* ═══ 1. CARTERA GRID (arriba, antes que nada) ═══ */}
      <GridWalletSummaryPanel
        wallet={wallet}
        config={config}
        status={status}
        onGoToTab={onGoToTab}
      />

      {/* ═══ 2. ESTADO GENERAL DEL GRID ═══ */}
      <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-card/50 to-amber-500/5 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-amber-400" />
              <CardTitle className="text-sm font-mono font-bold text-amber-400">
                ESTADO GENERAL DEL GRID
              </CardTitle>
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500/70">
                GRID ISOLATED
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={modeColor(mode) as any} className="text-xs font-mono">
                {mode}
              </Badge>
              {isActive ? (
                <Badge variant="default" className="text-xs font-mono bg-green-600">
                  MOTOR ACTIVO
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs font-mono text-amber-400 border-amber-400/50">
                  MOTOR PAUSADO
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mensaje de estado funcional */}
          <div className={`rounded-lg p-3 text-sm ${
            functionalStatus?.state === "active" ? "bg-green-500/10 text-green-700 dark:text-green-300" :
            functionalStatus?.state === "inactive" || functionalStatus?.state === "off" ? "bg-orange-500/10 text-orange-700 dark:text-orange-300" :
            "bg-blue-500/10 text-blue-700 dark:text-blue-300"
          }`}>
            <p className="font-medium">{functionalStatus?.message || "Estado funcional no disponible."}</p>
          </div>

          {/* KPIs del Grid — grid horizontal como IDCA */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border-b border-amber-500/10 bg-amber-500/10">
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">NIVELES PLANIFICADOS</p>
              <p className="font-mono text-lg font-bold">{summary?.plannedLevelsTotal ?? summary?.plannedLevelsCount ?? status?.openLevels ?? 0}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{summary?.realOpenOrdersCount ?? 0} órdenes reales abiertas</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">CICLOS ABIERTOS</p>
              <p className="font-mono text-lg font-bold">{summary?.openCyclesCount ?? status?.openCycles ?? 0}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{summary?.closedCyclesCount ?? 0} cerrados · ${status?.capitalReservedUsd?.toFixed(0) || 0} reservado</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">PNL NETO TOTAL</p>
              <p className={`font-mono text-lg font-bold ${(status?.totalNetPnlUsd ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {(status?.totalNetPnlUsd ?? 0) >= 0 ? "+" : ""}${(status?.totalNetPnlUsd ?? 0).toFixed(2)}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{status?.totalCyclesCompleted || 0} ciclos completados</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">ÚLTIMO TICK</p>
              <p className="font-mono text-lg font-bold text-blue-400">
                {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("es-ES") : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{lastTickReason || "Sin tick reciente"}</p>
            </div>
          </div>

          {/* Conteos canónicos detallados (g1) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-xs">Total niveles:</span>
              <span className="font-mono font-bold ml-1">{summary?.totalLevels ?? 0}</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-xs">Rango actual:</span>
              <span className="font-mono font-bold ml-1">{summary?.currentRangeLevelsCount ?? 0}</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-xs">Históricos:</span>
              <span className="font-mono font-bold ml-1">{summary?.replacedLevelsCount ?? 0} reemplazados</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-xs">Filled:</span>
              <span className="font-mono font-bold ml-1">{summary?.filledLevelsCount ?? 0} ({summary?.simulatedFilledLevelsCount ?? 0} simulados)</span>
            </div>
          </div>

          {/* Estado de seguridad — checklist horizontal */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-amber-500/10">
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">CIRCUIT BREAKER</p>
              <div className="flex items-center gap-1.5">
                {status?.circuitBreakerOpen ? (
                  <XCircle className="h-3 w-3 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.circuitBreakerOpen ? "text-red-400" : "text-green-400"}`}>
                  {status?.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">PUMP/DUMP GUARD</p>
              <div className="flex items-center gap-1.5">
                {status?.pumpDumpState === "normal" ? (
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.pumpDumpState === "normal" ? "text-green-400" : "text-amber-400"}`}>
                  {status?.pumpDumpState?.toUpperCase() || "NORMAL"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">RECONCILIACIÓN</p>
              <div className="flex items-center gap-1.5">
                {status?.lastReconciliationOk ? (
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.lastReconciliationOk ? "text-green-400" : "text-red-400"}`}>
                  {status?.lastReconciliationOk ? "OK" : "PENDIENTE"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">RANGO ACTIVO</p>
              <div className="flex items-center gap-1.5">
                {range && range.status !== "sin_rango_activo" ? (
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                ) : (
                  <XCircle className="h-3 w-3 text-amber-400" />
                )}
                <span className={`font-mono text-sm font-bold ${range && range.status !== "sin_rango_activo" ? "text-green-400" : "text-amber-400"}`}>
                  {range && range.status !== "sin_rango_activo" ? "ACTIVO" : "SIN RANGO"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════ CONTROLES DE MODO Y MOTOR ══════════ */}
      {/* Card horizontal con controles, similar a ControlsBar de IDCA */}
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            {/* Mode selector */}
            <div className="flex items-center gap-1">
              {["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"].map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "default" : "outline"}
                  className="text-xs font-mono h-7"
                  onClick={() => onModeChange(m)}
                  disabled={modeMutationPending}
                >
                  {m}
                </Button>
              ))}
            </div>

            {/* Motor toggle */}
            <div className="flex items-center gap-2 ml-auto">
              {isActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => onActivate(false)}
                  disabled={activatePending}
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  PAUSAR MOTOR
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs h-7"
                  onClick={() => onActivate(true)}
                  disabled={activatePending}
                >
                  <Activity className="h-3 w-3 mr-1" />
                  ACTIVAR MOTOR
                </Button>
              )}
            </div>

            {/* Shadow validate */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={onShadowValidate}
              disabled={shadowValidatePending}
            >
              <Zap className="h-3 w-3 mr-1" />
              SHADOW VALIDATE
            </Button>
          </div>

          {/* Mode Lock Safety Checks */}
          {(mode === "OFF" || mode === "SHADOW") && unlockCheck && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-semibold">Condiciones de Desbloqueo REAL:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.revolutxInitialized ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Revolut X Inicializado
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.revolutxHasBalance ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Balance Disponible
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.reconciliationPassed ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Reconciliación OK
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.capitalReserved ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Capital Reservado
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.modeLockAcknowledged ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Lock Reconocido
                </div>
                <div className="flex items-center gap-2">
                  {unlockCheck?.checks?.dailyOrderLimitRespected ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                  Límite Diario OK
                </div>
              </div>
              {!unlockCheck?.checks?.modeLockAcknowledged && unlockCheck?.postOnlySupported && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAcknowledge}
                  disabled={acknowledgePending}
                >
                  Reconocer Mode Lock
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ 3. CONTEXTO DE MERCADO Y BANDA ACTIVA ═══ */}
      <GridMarketContextPanel
        range={range}
        status={status}
        mode={mode}
        onGoToTab={onGoToTab}
      />

      {/* ═══ 4. NIVELES + CICLOS ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GridLevelsPanel
          levels={levels}
          mode={mode}
          currentPrice={auditData?.marketContext?.currentPrice}
          onGoToTab={onGoToTab}
        />
        <GridCyclesPanel
          cycles={cycles}
          onGoToTab={onGoToTab}
        />
      </div>

      {/* ═══ 5. ACTIVIDAD EN DIRECTO ═══ */}
      <GridLiveActivityPanel />

      {/* ═══ 6. HISTÓRICO DE CAMBIOS DE BANDA ═══ */}
      <GridRangeHistoryPanel rangeHistory={rangeHistory} />
    </div>
  );
}
