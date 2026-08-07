import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, Target, History, Search, Info, AlertCircle } from "lucide-react";
import { GridUnifiedLevelLadder } from "./GridUnifiedLevelLadder";

interface GridLevelsCompactPanelProps {
  operational?: any;
}

export type LevelFilter = "entradas" | "rungs" | "salidas" | "historico";

export function buildGridLevelFilterCounts(operational: any) {
  const levels = operational?.levels ?? {};
  return {
    entradas: (levels.entryLevels ?? []).length,
    rungs: (levels.referenceRungs ?? []).length,
    salidas: (operational?.cycleOwnedExits ?? []).length + (levels.legacyTargetLevels ?? []).length,
    historico: (levels.historicalLevels ?? []).length,
  };
}

export function resolveGridLevelRows(operational: any, filter: LevelFilter, historyLimit = 20): any[] | { cycleOwnedExits: any[]; legacyTargetLevels: any[] } {
  const levels = operational?.levels ?? {};
  if (filter === "entradas") return levels.entryLevels ?? [];
  if (filter === "rungs") return levels.referenceRungs ?? [];
  if (filter === "historico") return (levels.historicalLevels ?? []).slice(0, historyLimit);
  return {
    cycleOwnedExits: operational?.cycleOwnedExits ?? [],
    legacyTargetLevels: levels.legacyTargetLevels ?? [],
  };
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function levelLabel(side: string, isTargetOfOpenCycle: boolean): string {
  if (side === "BUY") return "BUY entrada";
  if (isTargetOfOpenCycle) return "SELL objetivo de ciclo";
  return "SELL referencia";
}

function statusColor(status: string): string {
  switch (status) {
    case "planned":
      return "bg-muted/10 text-muted-foreground border-border/50";
    case "open":
    case "active":
      return "text-cyan-400 border-cyan-500/30 bg-cyan-500/10";
    case "filled":
      return "text-green-400 border-green-500/30 bg-green-500/10";
    case "replaced":
    case "expired":
      return "text-muted-foreground border-border/50 bg-muted/10";
    case "cancelled":
      return "text-red-400 border-red-500/30 bg-red-500/10";
    default:
      return "text-muted-foreground border-border/50 bg-muted/10";
  }
}

interface LevelRowProps {
  level: any;
  index: number;
}

function CycleOwnedExitRow({ exit, index }: { exit: any; index: number }) {
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
            SELL objetivo V3
          </Badge>
          <Badge variant="outline" className={exit.requiresReview ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"}>
            {exit.requiresReview ? "Revisión requerida" : exit.makerState ?? "Target calculado"}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
        <div><span className="block text-[10px] uppercase tracking-wider">Compra</span><span className="font-mono text-foreground">{fmtPrice(exit.buyPrice)}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Target SELL</span><span className="font-mono text-foreground">{fmtPrice(exit.targetSellPrice)}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Cantidad</span><span className="font-mono text-foreground">{fmtQty(exit.quantity)}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Ciclo asociado</span><span className="text-foreground">#{exit.cycleNumber}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Neto esperado</span><span className={exit.expectedNetUsd != null && exit.expectedNetUsd >= 0 ? "text-green-400" : "text-red-400"}>{exit.expectedNetUsd == null ? "—" : `${exit.expectedNetUsd >= 0 ? "+" : ""}$${exit.expectedNetUsd.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Neto objetivo</span><span className="text-foreground">{exit.netTargetPct == null ? "—" : `${exit.netTargetPct.toLocaleString("es-ES", { maximumFractionDigits: 4 })}%`}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Maker solicitado</span><span className="font-mono text-foreground">{fmtPrice(exit.requestedMakerPrice)}</span></div>
        <div><span className="block text-[10px] uppercase tracking-wider">Rango</span><span className="text-foreground">{exit.rangeRelation === "current" ? "Vigente" : "Anterior"}</span></div>
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle económico y técnico</summary>
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <p>cycleId: {exit.cycleId}</p>
          <p>policyVersion: {exit.policyVersion ?? "—"}</p>
          <p>targetKind: {exit.targetKind ?? "—"}</p>
          <p>owner: {exit.targetOwner}</p>
          <p>Distancia objetivo: {exit.targetDistancePctFromBuy == null ? "—" : `${exit.targetDistancePctFromBuy.toLocaleString("es-ES", { maximumFractionDigits: 4 })}%`}</p>
          <p>Fees exchange: {exit.exchangeFeesUsd == null ? "—" : `$${exit.exchangeFeesUsd.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
          <p>Reserva fiscal: {exit.taxReserveUsd == null ? "—" : `$${exit.taxReserveUsd.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
          <p>Microestructura: {exit.executionMicrostructureSource ?? "—"}</p>
          <p>Constraints: {exit.constraintsSource ?? "—"}</p>
        </div>
      </details>
    </div>
  );
}

function LevelRow({ level, index }: LevelRowProps) {
  return (
    <div className="rounded-lg border border-border/50 p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusColor(level.status)}>
            {levelLabel(level.side, level.targetOfOpenCycle)}
          </Badge>
          {level.targetOfOpenCycle && (
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10 text-xs">
              <Target className="h-3 w-3 mr-1" />
              Vinculado a ciclo
            </Badge>
          )}
          {level.rangeRelation === "previous" && !level.targetOfOpenCycle && (
            <Badge variant="outline" className="text-muted-foreground text-xs">
              Histórico
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Precio</span>
          <span className="font-mono text-foreground">{fmtPrice(level.price)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Cantidad</span>
          <span className="font-mono text-foreground">{fmtQty(level.quantity)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Estado</span>
          <span className="text-foreground">{level.statusLabel}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Ciclo asociado</span>
          <span className="text-foreground">{level.cycleNumber != null ? `#${level.cycleNumber}` : "—"}</span>
        </div>
      </div>

      {level.estimatedNetProfit != null && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">Resultado estimado:</span>{" "}
          <span className={level.estimatedNetProfit >= 0 ? "text-green-400" : "text-red-400"}>
            {level.estimatedNetProfit >= 0 ? "+" : ""}${level.estimatedNetProfit.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <p>ID: {level.id}</p>
          <p>Rango: {level.rangeRelation === "current" ? "Vigente" : "Anterior"}</p>
          {level.rangeVersionId && <p>rangeVersionId: {level.rangeVersionId}</p>}
          {level.cycleId && <p>cycleId: {level.cycleId}</p>}
          {level.createdAt && <p>Creado: {new Date(level.createdAt).toLocaleString("es-ES")}</p>}
        </div>
      </details>
    </div>
  );
}

export function GridLevelsCompactPanel({ operational }: GridLevelsCompactPanelProps) {
  const market = operational?.market ?? {};
  const entryRange = market.entryRange ?? {};
  const levelDiagnostic = entryRange.levelDiagnostic ?? null;
  const actualLevels = entryRange.actualLevels ?? null;
  const requestedLevels = entryRange.requestedLevels ?? null;
  const levelsMismatch = actualLevels != null && requestedLevels != null && actualLevels < requestedLevels;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Niveles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Level count diagnostic */}
        {levelsMismatch && levelDiagnostic && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-medium text-amber-400">
                {actualLevels} niveles activos en lugar de {requestedLevels} solicitados
              </p>
              <p className="text-muted-foreground">
                Rango efectivo: {levelDiagnostic.effectiveRangePct?.toFixed(2)}% · Separación mínima: {levelDiagnostic.minSpacingPct?.toFixed(2)}% · Máx. por lado: {levelDiagnostic.maxLevelsPerSide}
              </p>
            </div>
          </div>
        )}

        <GridUnifiedLevelLadder operational={operational} />
      </CardContent>
    </Card>
  );
}
