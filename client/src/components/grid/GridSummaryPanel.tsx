import { useState, useEffect, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GridMarketContextPanel } from "./GridMarketContextPanel";
import { GridWalletSummaryPanel } from "./GridWalletSummaryPanel";
import { GridLiveActivityPanel } from "./GridLiveActivityPanel";
import { GridLevelsPanel } from "./GridLevelsPanel";
import { GridCyclesPanel } from "./GridCyclesPanel";
import { GridRangeHistoryPanel } from "./GridRangeHistoryPanel";
import { Activity, Shield, Wallet, Zap, Layers, CheckCircle2, XCircle, AlertTriangle, Settings2, Cpu, GripVertical, RotateCcw } from "lucide-react";

// ─── Drag & drop section ordering ────────────────────────────
const SECTION_IDS = ["cartera", "estado", "controles", "contexto", "niveles", "ciclos", "actividad", "historico"] as const;
type SectionId = typeof SECTION_IDS[number];

const DEFAULT_ORDER: SectionId[] = ["cartera", "estado", "controles", "contexto", "niveles", "ciclos", "actividad", "historico"];
const STORAGE_KEY = "grid-summary-section-order";

function loadOrder(): SectionId[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === SECTION_IDS.length) {
        const allPresent = SECTION_IDS.every(id => parsed.includes(id));
        if (allPresent) return parsed as SectionId[];
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_ORDER;
}

function DraggableSection({
  id, index, draggedId, dragOverId, onDragStart, onDragOver, onDrop, onDragEnd, onReset, children,
}: {
  id: SectionId;
  index: number;
  draggedId: SectionId | null;
  dragOverId: SectionId | null;
  onDragStart: (id: SectionId) => void;
  onDragOver: (e: React.DragEvent, id: SectionId) => void;
  onDrop: (id: SectionId) => void;
  onDragEnd: () => void;
  onReset: () => void;
  children: ReactNode;
}) {
  const isDragging = draggedId === id;
  const isDragOver = dragOverId === id && draggedId !== id;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); onDragStart(id); }}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={() => onDrop(id)}
      onDragEnd={onDragEnd}
      className={`relative group transition-all ${
        isDragging ? "opacity-40 scale-[0.98]" : ""
      } ${isDragOver ? "ring-2 ring-blue-500/60 rounded-xl" : ""}`}
    >
      {/* Drag handle — desktop only, appears on hover */}
      <div className="hidden md:flex absolute -top-3 left-1/2 -translate-x-1/2 z-20 cursor-grab active:cursor-grabbing items-center gap-1 px-2 py-0.5 rounded-md bg-muted/80 border border-border/60 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
        <GripVertical className="h-3 w-3" />
        <span className="text-[10px] font-mono">#{index + 1} · arrastrar</span>
      </div>
      {/* Reset button — only on first section */}
      {index === 0 && (
        <div className="hidden md:flex absolute -top-3 right-0 z-20">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Restaurar orden
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}

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

  // ─── Normalized motor status (same logic as GridHeaderHero) ───
  const motorLabel = mode === "OFF" ? "MOTOR DETENIDO" : isActive ? "MOTOR ACTIVO" : "MOTOR PAUSADO";
  const motorBg = mode === "OFF" ? "text-muted-foreground border-muted-foreground/30" : isActive ? "bg-green-600" : "text-amber-400 border-amber-400/50";

  // ─── Drag & drop state ──────────────────────────────────────
  const [order, setOrder] = useState<SectionId[]>(loadOrder);
  const [draggedId, setDraggedId] = useState<SectionId | null>(null);
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  }, [order]);

  const handleDragStart = (id: SectionId) => setDraggedId(id);
  const handleDragOver = (e: React.DragEvent, id: SectionId) => { e.preventDefault(); setDragOverId(id); };
  const handleDrop = (id: SectionId) => {
    if (draggedId && draggedId !== id) {
      setOrder(prev => {
        const newOrder = [...prev];
        const fromIdx = newOrder.indexOf(draggedId);
        const toIdx = newOrder.indexOf(id);
        newOrder.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, draggedId);
        return newOrder;
      });
    }
    setDraggedId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };
  const resetOrder = () => setOrder(DEFAULT_ORDER);

  // ─── Section content map ────────────────────────────────────
  const sections: Record<SectionId, ReactNode> = {
    cartera: (
      <GridWalletSummaryPanel
        wallet={wallet}
        config={config}
        status={status}
        onGoToTab={onGoToTab}
      />
    ),
    estado: (
      <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-card/50 to-amber-500/5 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-amber-400" />
              <CardTitle className="text-base font-mono font-bold text-amber-400">
                ESTADO GENERAL DEL GRID
              </CardTitle>
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-500/70">
                GRID ISOLATED
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={modeColor(mode) as any} className="text-sm font-mono">
                {mode}
              </Badge>
              {mode === "OFF" ? (
                <Badge variant="outline" className={`text-sm font-mono ${motorBg}`}>
                  {motorLabel}
                </Badge>
              ) : isActive ? (
                <Badge variant="default" className="text-sm font-mono bg-green-600">
                  {motorLabel}
                </Badge>
              ) : (
                <Badge variant="outline" className={`text-sm font-mono ${motorBg}`}>
                  {motorLabel}
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
            <p className="font-medium text-sm">{functionalStatus?.message || "Sincronizando estado..."}</p>
          </div>

          {/* KPIs del Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border-b border-amber-500/10 bg-amber-500/10">
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">NIVELES PLANIFICADOS</p>
              <p className="font-mono text-lg font-bold">{summary?.currentPlannedLevelsCount ?? summary?.plannedLevelsCount ?? status?.openLevels ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{summary?.realOpenOrdersCount ?? 0} órdenes reales · {summary?.currentRangeLevelsCount ?? 0} en rango activo</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">CICLOS ABIERTOS</p>
              <p className="font-mono text-lg font-bold">{summary?.activeOpenCyclesCount ?? status?.activeOpenCyclesCount ?? summary?.openCyclesCount ?? status?.openCycles ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{summary?.closedCyclesCount ?? 0} cerrados · {summary?.orphanOpenCyclesCount ?? status?.orphanOpenCyclesCount ?? 0} orphan</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">PNL NETO TOTAL</p>
              <p className={`font-mono text-lg font-bold ${(status?.totalNetPnlUsd ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {(status?.totalNetPnlUsd ?? 0) >= 0 ? "+" : ""}${(status?.totalNetPnlUsd ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{status?.totalCyclesCompleted || 0} ciclos completados</p>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">ÚLTIMO TICK</p>
              <p className="font-mono text-lg font-bold text-blue-400">
                {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("es-ES") : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{lastTickReason || "Sin tick reciente"}</p>
            </div>
          </div>

          {/* Conteos canónicos detallados */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-sm">Total niveles:</span>
              <span className="font-mono font-bold ml-1">{summary?.totalLevels ?? 0}</span>
              <span className="text-[10px] text-muted-foreground ml-1">(global/histórico)</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-sm">Rango actual:</span>
              <span className="font-mono font-bold ml-1">{summary?.currentRangeLevelsCount ?? 0}</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-sm">Históricos:</span>
              <span className="font-mono font-bold ml-1">{summary?.replacedLevelsCount ?? 0} reemplazados</span>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2">
              <span className="text-muted-foreground text-sm">Filled:</span>
              <span className="font-mono font-bold ml-1">{summary?.filledLevelsCount ?? 0} ({summary?.simulatedFilledLevelsCount ?? 0} simulados)</span>
            </div>
          </div>

          {/* Estado de seguridad */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-amber-500/10">
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">CIRCUIT BREAKER</p>
              <div className="flex items-center gap-1.5">
                {status?.circuitBreakerOpen ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.circuitBreakerOpen ? "text-red-400" : "text-green-400"}`}>
                  {status?.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">PUMP/DUMP GUARD</p>
              <div className="flex items-center gap-1.5">
                {status?.pumpDumpState === "normal" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.pumpDumpState === "normal" ? "text-green-400" : "text-amber-400"}`}>
                  {status?.pumpDumpState?.toUpperCase() || "NORMAL"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">RECONCILIACIÓN</p>
              <div className="flex items-center gap-1.5">
                {status?.lastReconciliationOk ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className={`font-mono text-sm font-bold ${status?.lastReconciliationOk ? "text-green-400" : "text-red-400"}`}>
                  {status?.lastReconciliationOk ? "OK" : "PENDIENTE"}
                </span>
              </div>
            </div>
            <div className="bg-card/50 p-3">
              <p className="text-xs font-mono text-muted-foreground mb-1">RANGO ACTIVO</p>
              <div className="flex items-center gap-1.5">
                {range && range.status !== "sin_rango_activo" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-400" />
                )}
                <span className={`font-mono text-sm font-bold ${range && range.status !== "sin_rango_activo" ? "text-green-400" : "text-amber-400"}`}>
                  {range && range.status !== "sin_rango_activo" ? "ACTIVO" : "SIN RANGO"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    ),
    controles: (
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
                  className="text-sm font-mono h-8"
                  onClick={() => onModeChange(m)}
                  disabled={modeMutationPending}
                >
                  {m}
                </Button>
              ))}
            </div>

            {/* Motor toggle */}
            <div className="flex items-center gap-2 ml-auto">
              {isActive && mode !== "OFF" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-sm h-8"
                  onClick={() => onActivate(false)}
                  disabled={activatePending}
                >
                  <Settings2 className="h-4 w-4 mr-1" />
                  PAUSAR MOTOR
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  className="text-sm h-8"
                  onClick={() => onActivate(true)}
                  disabled={activatePending || mode === "OFF"}
                >
                  <Activity className="h-4 w-4 mr-1" />
                  ACTIVAR MOTOR
                </Button>
              )}
            </div>

            {/* Shadow validate */}
            <Button
              size="sm"
              variant="outline"
              className="text-sm h-8"
              onClick={onShadowValidate}
              disabled={shadowValidatePending}
            >
              <Zap className="h-4 w-4 mr-1" />
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
    ),
    contexto: (
      <GridMarketContextPanel
        range={range}
        status={status}
        mode={mode}
        onGoToTab={onGoToTab}
      />
    ),
    niveles: (
      <GridLevelsPanel
        levels={levels}
        mode={mode}
        currentPrice={auditData?.marketContext?.currentPrice}
        onGoToTab={onGoToTab}
        levelsSummary={auditData?.levelsSummary}
        netProfitTargetPct={auditData?.summary?.netProfitTargetPct}
      />
    ),
    ciclos: (
      <GridCyclesPanel
        cycles={cycles}
        onGoToTab={onGoToTab}
        activeRangeVersionId={status?.activeRangeVersionId ?? null}
      />
    ),
    actividad: <GridLiveActivityPanel />,
    historico: <GridRangeHistoryPanel rangeHistory={rangeHistory} />,
  };

  return (
    <div className="space-y-5 pt-2">
      {/* Draggable sections — full width, one below another */}
      {order.map((id, idx) => (
        <DraggableSection
          key={id}
          id={id}
          index={idx}
          draggedId={draggedId}
          dragOverId={dragOverId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onReset={resetOrder}
        >
          {sections[id]}
        </DraggableSection>
      ))}
    </div>
  );
}
